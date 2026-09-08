import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { normalizePhone } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RetentionService } from '../retention/retention.service';
import { PaymentsService } from '../payments/payments.service';

export interface CreateAppointmentDto {
  serviceId: string;
  staffId?: string; // specific staff ID or 'ANY'
  startAt: string;  // ISO UTC string
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
}

export interface RescheduleAppointmentDto {
  startAt: string;  // ISO UTC string
}

export interface AppointmentFiltersDto {
  staffId?: string;
  serviceId?: string;
  customerId?: string;
  status?: string;
  date?: string; // YYYY-MM-DD
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// In-memory mutex map to serialize concurrent booking requests per staff member
const staffLocks = new Map<string, Promise<void>>();

async function acquireStaffLock(staffId: string): Promise<() => void> {
  while (staffLocks.has(staffId)) {
    await staffLocks.get(staffId);
  }
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    release = () => {
      staffLocks.delete(staffId);
      resolve();
    };
  });
  staffLocks.set(staffId, lockPromise);
  return release;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService?: NotificationsService,
    @Inject(forwardRef(() => RetentionService))
    private retentionService?: RetentionService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService?: PaymentsService,
  ) {}

  async createAppointment(businessId: string, dto: CreateAppointmentDto) {
    this.logger.log(`Booking attempt: Business ${businessId}, Service ${dto.serviceId}, StartAt ${dto.startAt}`);

    if (!dto.serviceId) {
      throw new BadRequestException('serviceId is required');
    }
    if (!dto.startAt) {
      throw new BadRequestException('startAt is required');
    }
    if (!dto.customerName || !dto.customerName.trim()) {
      throw new BadRequestException('Customer name is required');
    }
    if (!dto.customerPhone || !dto.customerPhone.trim()) {
      throw new BadRequestException('Customer phone is required');
    }

    const startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt timestamp');
    }

    const now = new Date();
    if (startAt < now) {
      throw new BadRequestException('Cannot book an appointment in the past');
    }

    // 1. Load Business Settings
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    let settings: any = {};
    try {
      settings = JSON.parse(business.settings || '{}');
    } catch {
      settings = {};
    }

    const bufferMinutes = Number(settings.bufferMinutes || 0);
    const minimumBookingNoticeMinutes = Number(settings.minimumBookingNoticeMinutes || 60);
    const maximumAdvanceBookingDays = Number(settings.maximumAdvanceBookingDays || 30);

    // Minimum notice check
    if (startAt.getTime() < now.getTime() + minimumBookingNoticeMinutes * 60 * 1000) {
      throw new BadRequestException(`Appointments require at least ${minimumBookingNoticeMinutes} minutes advance notice`);
    }

    // Maximum advance booking check
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maximumAdvanceBookingDays);
    maxDate.setHours(23, 59, 59, 999);
    if (startAt > maxDate) {
      throw new BadRequestException(`Appointments cannot be booked more than ${maximumAdvanceBookingDays} days in advance`);
    }

    // 2. Load Service
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, businessId },
    });
    if (!service || !service.active) {
      throw new BadRequestException('Service not found or is currently inactive');
    }

    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60 * 1000);

    // Calculate deposit
    let depositAmount = 0;
    if (service.depositType === 'FIXED') {
      depositAmount = service.depositValue;
    } else if (service.depositType === 'PERCENTAGE') {
      depositAmount = (service.price * service.depositValue) / 100;
    }

    // 3. Resolve Target Staff
    let targetStaffId = dto.staffId;
    if (!targetStaffId || targetStaffId === 'ANY') {
      // Find candidate staff who offer this service
      const eligibleStaff = await this.prisma.staff.findMany({
        where: {
          businessId,
          active: true,
          services: { some: { serviceId: service.id } },
        },
      });

      if (eligibleStaff.length === 0) {
        throw new BadRequestException('No active staff available for this service');
      }

      // Pick first staff member without a conflict
      let selected: string | null = null;
      for (const st of eligibleStaff) {
        const conflict = await this.prisma.appointment.findFirst({
          where: {
            staffId: st.id,
            businessId,
            status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        });
        if (!conflict) {
          selected = st.id;
          break;
        }
      }

      if (!selected) {
        throw new ConflictException('No staff members are available for the selected time slot');
      }
      targetStaffId = selected;
    }

    // Validate specific staff
    const staff = await this.prisma.staff.findFirst({
      where: { id: targetStaffId, businessId, active: true },
      include: {
        services: { where: { serviceId: service.id } },
      },
    });

    if (!staff) {
      throw new NotFoundException('Selected staff member not found or is inactive');
    }
    if (staff.services.length === 0) {
      throw new BadRequestException('Selected staff member does not provide this service');
    }

    // 4. Validate Shift, Breaks, Leaves, Holidays
    const dayOfWeek = startAt.getUTCDay();
    const dayStart = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), startAt.getUTCDate(), 0, 0, 0));
    const dayEnd = new Date(Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), startAt.getUTCDate(), 23, 59, 59, 999));

    // Holiday check
    const holiday = await this.prisma.businessHoliday.findFirst({
      where: {
        businessId,
        date: { gte: dayStart, lte: dayEnd },
      },
    });
    if (holiday) {
      throw new BadRequestException(`Business is closed on this date (${holiday.name})`);
    }

    // Staff Leave check
    const leave = await this.prisma.staffLeave.findFirst({
      where: {
        staffId: targetStaffId,
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
    });
    if (leave) {
      throw new BadRequestException('Staff member is on leave on this date');
    }

    // Working Hours check
    const workingHours = await this.prisma.staffWorkingHours.findUnique({
      where: {
        staffId_dayOfWeek: {
          staffId: targetStaffId,
          dayOfWeek,
        },
      },
    });
    if (!workingHours || !workingHours.enabled) {
      throw new BadRequestException('Staff member is not scheduled to work on this day');
    }

    const apptStartMin = startAt.getUTCHours() * 60 + startAt.getUTCMinutes();
    const apptEndMin = endAt.getUTCHours() * 60 + endAt.getUTCMinutes();
    const workStartMin = parseTimeToMinutes(workingHours.startTime);
    const workEndMin = parseTimeToMinutes(workingHours.endTime);

    if (apptStartMin < workStartMin || apptEndMin > workEndMin) {
      throw new BadRequestException(
        `Appointment (${startAt.toISOString().slice(11, 16)} - ${endAt.toISOString().slice(11, 16)}) is outside working hours (${workingHours.startTime} - ${workingHours.endTime})`,
      );
    }

    // Staff Breaks check
    const breaks = await this.prisma.staffBreak.findMany({
      where: { staffId: targetStaffId, dayOfWeek },
    });

    for (const b of breaks) {
      const bStart = parseTimeToMinutes(b.startTime);
      const bEnd = parseTimeToMinutes(b.endTime);

      if (apptStartMin < bEnd && apptEndMin > bStart) {
        throw new BadRequestException(`Appointment conflicts with staff break (${b.startTime} - ${b.endTime})`);
      }
    }

    // 5. ATOMIC DOUBLE-BOOKING PREVENTION & TRANSACTION
    const releaseLock = await acquireStaffLock(targetStaffId);
    let createdAppointment: any;
    try {
      createdAppointment = await this.prisma.$transaction(async (tx) => {
        // Strict overlapping check inside transaction
        const endAtWithBuffer = new Date(endAt.getTime() + bufferMinutes * 60 * 1000);
        const existingConflict = await tx.appointment.findFirst({
          where: {
            staffId: targetStaffId,
            businessId,
            status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
            startAt: { lt: endAtWithBuffer },
            endAt: { gt: startAt },
          },
        });

        if (existingConflict) {
          this.logger.warn(`Double-booking prevented: Slot ${startAt.toISOString()} for Staff ${targetStaffId} is already booked.`);
          throw new ConflictException('Selected slot is no longer available. Please choose another time.');
        }

        // Upsert Customer with Normalized Phone
        const normalizedPhone = normalizePhone(dto.customerPhone.trim());
        const existingCustomer = await tx.customer.findUnique({
          where: {
            businessId_phone: {
              businessId,
              phone: normalizedPhone,
            },
          },
        });

        if (existingCustomer && existingCustomer.status === 'INACTIVE') {
          throw new BadRequestException('Customer account is inactive. Please reactivate the customer before booking.');
        }

        const customer = await tx.customer.upsert({
          where: {
            businessId_phone: {
              businessId,
              phone: normalizedPhone,
            },
          },
          update: {
            name: dto.customerName.trim(),
            ...(dto.customerEmail && { email: dto.customerEmail.trim() }),
          },
          create: {
            businessId,
            name: dto.customerName.trim(),
            phone: normalizedPhone,
            email: dto.customerEmail?.trim() || null,
            status: 'ACTIVE',
          },
        });

        // Create Appointment
        const appointment = await tx.appointment.create({
          data: {
            businessId,
            customerId: customer.id,
            staffId: targetStaffId,
            serviceId: service.id,
            startAt,
            endAt,
            status: 'CONFIRMED',
            price: service.price,
            depositAmount,
            paymentStatus: 'UNPAID',
            notes: dto.notes?.trim() || null,
          },
          include: {
            customer: true,
            staff: true,
            service: true,
          },
        });

        this.logger.log(`Booking confirmed: Appointment ID ${appointment.id}`);
        return appointment;
      });

      // Trigger Phase 9 Notification Hook (Asynchronous & Non-blocking)
      if (this.notificationsService) {
        try {
          await this.notificationsService.handleAppointmentCreated(businessId, createdAppointment.id);
        } catch (notifErr: any) {
          this.logger.error(`Failed to dispatch appointment created notifications: ${notifErr?.message}`);
        }
      }

      // Trigger Phase 10 Retention Rebooking Hook (Asynchronous & Non-blocking)
      if (this.retentionService) {
        try {
          await this.retentionService.handleCustomerRebooked(
            businessId,
            createdAppointment.customerId,
            createdAppointment.startAt,
          );
        } catch (retErr: any) {
          this.logger.error(`Failed to handle retention rebooked hook: ${retErr?.message}`);
        }
      }

      return createdAppointment;
    } finally {
      releaseLock();
    }
  }

  async findAll(businessId: string, filters: AppointmentFiltersDto = {}) {
    const where: any = { businessId };

    if (filters.staffId && filters.staffId !== 'ALL') {
      where.staffId = filters.staffId;
    }
    if (filters.serviceId && filters.serviceId !== 'ALL') {
      where.serviceId = filters.serviceId;
    }
    if (filters.customerId && filters.customerId !== 'ALL') {
      where.customerId = filters.customerId;
    }
    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }

    if (filters.date) {
      const [y, m, d] = filters.date.split('-').map(Number);
      const startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      where.startAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    } else if (filters.startDate && filters.endDate) {
      where.startAt = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { customer: { name: { contains: q } } },
        { customer: { phone: { contains: q } } },
        { service: { name: { contains: q } } },
        { notes: { contains: q } },
      ];
    }

    if (filters.page && filters.limit) {
      const page = Math.max(1, Number(filters.page));
      const limit = Math.max(1, Number(filters.limit));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        this.prisma.appointment.count({ where }),
        this.prisma.appointment.findMany({
          where,
          include: {
            customer: true,
            staff: true,
            service: true,
          },
          orderBy: { startAt: 'asc' },
          skip,
          take: limit,
        }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    return this.prisma.appointment.findMany({
      where,
      include: {
        customer: true,
        staff: true,
        service: true,
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async findOne(businessId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, businessId },
      include: {
        customer: true,
        staff: true,
        service: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    return appointment;
  }

  // --- STATUS LIFECYCLE TRANSITIONS ---

  async confirm(businessId: string, id: string) {
    const current = await this.findOne(businessId, id);

    if (current.status === 'CONFIRMED') {
      return current;
    }
    if (current.status === 'CANCELLED' || current.status === 'COMPLETED' || current.status === 'NO_SHOW') {
      throw new BadRequestException(`Cannot confirm an appointment with status '${current.status}'`);
    }

    return this.prisma.appointment.update({
      where: { id },
      data: { status: 'CONFIRMED' },
      include: { customer: true, staff: true, service: true },
    });
  }

  async complete(businessId: string, id: string) {
    const current = await this.findOne(businessId, id);

    if (current.status === 'CANCELLED' || current.status === 'NO_SHOW') {
      throw new BadRequestException(`Cannot complete an appointment with status '${current.status}'`);
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: { customer: true, staff: true, service: true },
    });

    if (this.notificationsService) {
      await this.notificationsService.handleAppointmentCompleted(businessId, id).catch(() => {});
    }

    if (this.retentionService) {
      await this.retentionService.handleAppointmentCompleted(businessId, id).catch(() => {});
    }

    return updated;
  }

  async markNoShow(businessId: string, id: string) {
    const current = await this.findOne(businessId, id);

    if (current.status === 'CANCELLED' || current.status === 'COMPLETED') {
      throw new BadRequestException(`Cannot mark as no-show an appointment with status '${current.status}'`);
    }

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: { status: 'NO_SHOW' },
      include: { customer: true, staff: true, service: true },
    });

    if (this.notificationsService) {
      await this.notificationsService.handleAppointmentNoShow(businessId, id).catch(() => {});
    }

    return updated;
  }

  async reschedule(businessId: string, id: string, dto: RescheduleAppointmentDto) {
    const current = await this.findOne(businessId, id);

    if (current.status === 'CANCELLED') {
      throw new BadRequestException('Cannot reschedule a cancelled appointment');
    }

    const newStartAt = new Date(dto.startAt);
    if (isNaN(newStartAt.getTime())) {
      throw new BadRequestException('Invalid startAt timestamp');
    }

    const now = new Date();
    if (newStartAt < now) {
      throw new BadRequestException('Cannot reschedule to a time in the past');
    }

    const service = current.service;
    const newEndAt = new Date(newStartAt.getTime() + service.durationMinutes * 60 * 1000);
    const targetStaffId = current.staffId;

    // Validate shift, breaks, leaves, holidays
    const dayOfWeek = newStartAt.getUTCDay();
    const dayStart = new Date(Date.UTC(newStartAt.getUTCFullYear(), newStartAt.getUTCMonth(), newStartAt.getUTCDate(), 0, 0, 0));
    const dayEnd = new Date(Date.UTC(newStartAt.getUTCFullYear(), newStartAt.getUTCMonth(), newStartAt.getUTCDate(), 23, 59, 59, 999));

    // Holiday check
    const holiday = await this.prisma.businessHoliday.findFirst({
      where: {
        businessId,
        date: { gte: dayStart, lte: dayEnd },
      },
    });
    if (holiday) {
      throw new BadRequestException(`Business is closed on this date (${holiday.name})`);
    }

    // Leave check
    const leave = await this.prisma.staffLeave.findFirst({
      where: {
        staffId: targetStaffId,
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
    });
    if (leave) {
      throw new BadRequestException('Staff member is on leave on this date');
    }

    // Working hours check
    const workingHours = await this.prisma.staffWorkingHours.findUnique({
      where: {
        staffId_dayOfWeek: {
          staffId: targetStaffId,
          dayOfWeek,
        },
      },
    });
    if (!workingHours || !workingHours.enabled) {
      throw new BadRequestException('Staff member is not scheduled to work on this day');
    }

    const apptStartMin = newStartAt.getUTCHours() * 60 + newStartAt.getUTCMinutes();
    const apptEndMin = newEndAt.getUTCHours() * 60 + newEndAt.getUTCMinutes();
    const workStartMin = parseTimeToMinutes(workingHours.startTime);
    const workEndMin = parseTimeToMinutes(workingHours.endTime);

    if (apptStartMin < workStartMin || apptEndMin > workEndMin) {
      throw new BadRequestException('New time is outside working hours');
    }

    // Breaks check
    const breaks = await this.prisma.staffBreak.findMany({
      where: { staffId: targetStaffId, dayOfWeek },
    });
    for (const b of breaks) {
      const bStart = parseTimeToMinutes(b.startTime);
      const bEnd = parseTimeToMinutes(b.endTime);
      if (apptStartMin < bEnd && apptEndMin > bStart) {
        throw new BadRequestException(`New time conflicts with staff break (${b.startTime} - ${b.endTime})`);
      }
    }

    const releaseLock = await acquireStaffLock(targetStaffId);
    let rescheduledAppt: any;
    try {
      rescheduledAppt = await this.prisma.$transaction(async (tx) => {
        const conflict = await tx.appointment.findFirst({
          where: {
            id: { not: id },
            staffId: targetStaffId,
            businessId,
            status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
            startAt: { lt: newEndAt },
            endAt: { gt: newStartAt },
          },
        });

        if (conflict) {
          throw new ConflictException('The requested time slot is already booked');
        }

        const updated = await tx.appointment.update({
          where: { id },
          data: {
            startAt: newStartAt,
            endAt: newEndAt,
            status: 'CONFIRMED',
          },
          include: {
            customer: true,
            staff: true,
            service: true,
          },
        });

        this.logger.log(`Rescheduled Appointment ID ${id} to ${newStartAt.toISOString()}`);
        return updated;
      });

      // Trigger Reschedule Notification Hook
      if (this.notificationsService) {
        try {
          await this.notificationsService.handleAppointmentRescheduled(
            businessId,
            id,
            current.startAt,
            newStartAt,
          );
        } catch (notifErr: any) {
          this.logger.error(`Failed to handle reschedule notification: ${notifErr?.message}`);
        }
      }

      return rescheduledAppt;
    } finally {
      releaseLock();
    }
  }

  async cancel(businessId: string, id: string) {
    await this.findOne(businessId, id);

    const cancelled = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
      include: {
        customer: true,
        staff: true,
        service: true,
      },
    });

    this.logger.log(`Cancelled Appointment ID ${id}`);

    // Trigger Cancellation Notification Hook
    if (this.notificationsService) {
      try {
        await this.notificationsService.handleAppointmentCancelled(businessId, id);
      } catch (notifErr: any) {
        this.logger.error(`Failed to handle cancel notification: ${notifErr?.message}`);
      }
    }

    // Trigger Payment Cancellation Hook
    if (this.paymentsService) {
      await this.paymentsService.handleAppointmentCancelled(businessId, id).catch(() => {});
    }

    return cancelled;
  }

  // --- DASHBOARD METRICS & SUMMARY ---

  async getDailyStats(businessId: string, dateStr?: string) {
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    const [y, m, d] = targetDate.split('-').map(Number);
    const startOfDay = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

    const appointments = await this.prisma.appointment.findMany({
      where: {
        businessId,
        startAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    let confirmed = 0;
    let pending = 0;
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;
    let estimatedRevenue = 0;

    for (const a of appointments) {
      if (a.status === 'CONFIRMED') confirmed++;
      else if (a.status === 'PENDING') pending++;
      else if (a.status === 'COMPLETED') completed++;
      else if (a.status === 'CANCELLED') cancelled++;
      else if (a.status === 'NO_SHOW') noShow++;

      // Revenue excludes cancelled bookings
      if (a.status !== 'CANCELLED') {
        estimatedRevenue += a.price;
      }
    }

    return {
      date: targetDate,
      total: appointments.length,
      confirmed,
      pending,
      completed,
      cancelled,
      noShow,
      estimatedRevenue,
    };
  }

  async getUpcoming(businessId: string, limit = 10) {
    const now = new Date();
    return this.prisma.appointment.findMany({
      where: {
        businessId,
        startAt: { gte: now },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        customer: true,
        staff: true,
        service: true,
      },
      orderBy: { startAt: 'asc' },
      take: Math.max(1, Number(limit)),
    });
  }
}
