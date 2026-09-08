import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface QueryAvailabilityDto {
  serviceId: string;
  staffId?: string; // specific staff ID or 'ANY'
  date: string;     // "YYYY-MM-DD"
}

export interface SlotItem {
  start: string;      // ISO UTC string
  end: string;        // ISO UTC string
  startTime: string;  // Local "HH:mm"
  endTime: string;    // Local "HH:mm"
  available: boolean;
  staffId?: string;
  staffName?: string;
}

export interface AvailabilityResponse {
  date: string;
  timezone: string;
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    price: number;
    depositAmount: number;
  };
  staff?: {
    id: string;
    name: string;
  } | null;
  slots: SlotItem[];
}

function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  async getAvailableSlots(
    businessId: string,
    query: QueryAvailabilityDto,
  ): Promise<AvailabilityResponse> {
    const { serviceId, staffId = 'ANY', date } = query;

    if (!serviceId) {
      throw new BadRequestException('serviceId is required');
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Valid date in format YYYY-MM-DD is required');
    }

    // 1. Fetch Business & Settings
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

    const timezone = settings.timezone || 'Asia/Kolkata';
    const bufferMinutes = Number(settings.bufferMinutes || 0);
    const minimumBookingNoticeMinutes = Number(settings.minimumBookingNoticeMinutes || 60);
    const maximumAdvanceBookingDays = Number(settings.maximumAdvanceBookingDays || 30);

    // 2. Fetch Service
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, businessId },
    });
    if (!service || !service.active) {
      throw new BadRequestException('Service not found or is currently inactive');
    }

    // Calculate deposit
    let depositAmount = 0;
    if (service.depositType === 'FIXED') {
      depositAmount = service.depositValue;
    } else if (service.depositType === 'PERCENTAGE') {
      depositAmount = (service.price * service.depositValue) / 100;
    }

    // 3. Date & Advance Window Validation
    // Parse target date (YYYY-MM-DD)
    const [year, month, day] = date.split('-').map(Number);
    const targetDateStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const targetDateEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    const dayOfWeek = targetDateStart.getUTCDay(); // 0 = Sunday .. 6 = Saturday

    const now = new Date();
    // Max advance check
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maximumAdvanceBookingDays);
    maxDate.setHours(23, 59, 59, 999);

    if (targetDateStart > maxDate) {
      return {
        date,
        timezone,
        service: {
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          price: service.price,
          depositAmount,
        },
        staff: staffId !== 'ANY' ? { id: staffId, name: '' } : null,
        slots: [],
      };
    }

    // 4. Business Holiday Check
    const holiday = await this.prisma.businessHoliday.findFirst({
      where: {
        businessId,
        date: {
          gte: targetDateStart,
          lte: targetDateEnd,
        },
      },
    });

    if (holiday) {
      return {
        date,
        timezone,
        service: {
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          price: service.price,
          depositAmount,
        },
        staff: null,
        slots: [],
      };
    }

    // 5. Resolve Staff List
    let eligibleStaff: any[] = [];
    if (staffId && staffId !== 'ANY') {
      const st = await this.prisma.staff.findFirst({
        where: { id: staffId, businessId, active: true },
        include: {
          services: { where: { serviceId } },
          workingHours: { where: { dayOfWeek } },
          breaks: { where: { dayOfWeek } },
        },
      });

      if (!st) {
        throw new NotFoundException('Staff member not found or inactive');
      }

      if (st.services.length === 0) {
        throw new BadRequestException('Selected staff member does not provide this service');
      }

      eligibleStaff = [st];
    } else {
      // Find all active staff providing this service
      eligibleStaff = await this.prisma.staff.findMany({
        where: {
          businessId,
          active: true,
          services: { some: { serviceId } },
        },
        include: {
          workingHours: { where: { dayOfWeek } },
          breaks: { where: { dayOfWeek } },
        },
      });
    }

    if (eligibleStaff.length === 0) {
      return {
        date,
        timezone,
        service: {
          id: service.id,
          name: service.name,
          durationMinutes: service.durationMinutes,
          price: service.price,
          depositAmount,
        },
        staff: null,
        slots: [],
      };
    }

    // 6. Generate Slots per Staff
    const allAvailableSlots: SlotItem[] = [];

    for (const st of eligibleStaff) {
      // Check staff leave
      const onLeave = await this.prisma.staffLeave.findFirst({
        where: {
          staffId: st.id,
          startDate: { lte: targetDateEnd },
          endDate: { gte: targetDateStart },
        },
      });

      if (onLeave) {
        continue; // Staff is on leave this entire day
      }

      // Check working hours
      const wh = st.workingHours?.[0];
      if (!wh || !wh.enabled) {
        continue; // Staff is off on this day
      }

      const workStartMin = parseTimeToMinutes(wh.startTime);
      const workEndMin = parseTimeToMinutes(wh.endTime);

      // Staff Breaks
      const breaks = (st.breaks || []).map((b: any) => ({
        startMin: parseTimeToMinutes(b.startTime),
        endMin: parseTimeToMinutes(b.endTime),
      }));

      // Existing Appointments for this staff on this day
      const appointments = await this.prisma.appointment.findMany({
        where: {
          staffId: st.id,
          businessId,
          status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
          startAt: { lt: targetDateEnd },
          endAt: { gt: targetDateStart },
        },
      });

      const existingApptIntervals = appointments.map((a) => {
        const aStart = new Date(a.startAt);
        const aEnd = new Date(a.endAt);
        const startMin = aStart.getUTCHours() * 60 + aStart.getUTCMinutes();
        const endMin = aEnd.getUTCHours() * 60 + aEnd.getUTCMinutes();
        return { startMin, endMin: endMin + bufferMinutes };
      });

      // Candidate Slot Generation (30-minute stepping)
      const slotStep = 30;
      for (
        let slotStart = workStartMin;
        slotStart + service.durationMinutes <= workEndMin;
        slotStart += slotStep
      ) {
        const slotEnd = slotStart + service.durationMinutes;

        // Construct UTC DateTimes for this candidate slot
        const slotStartHour = Math.floor(slotStart / 60);
        const slotStartMinute = slotStart % 60;
        const slotEndHour = Math.floor(slotEnd / 60);
        const slotEndMinute = slotEnd % 60;

        const slotStartUtc = new Date(
          Date.UTC(year, month - 1, day, slotStartHour, slotStartMinute, 0),
        );
        const slotEndUtc = new Date(
          Date.UTC(year, month - 1, day, slotEndHour, slotEndMinute, 0),
        );

        // Minimum Notice Check (against current time)
        const earliestAllowedBooking = new Date(
          now.getTime() + minimumBookingNoticeMinutes * 60 * 1000,
        );
        if (slotStartUtc < earliestAllowedBooking) {
          continue;
        }

        // Break Conflict Check
        const hasBreakConflict = breaks.some((b: any) => {
          return slotStart < b.endMin && slotEnd > b.startMin;
        });
        if (hasBreakConflict) {
          continue;
        }

        // Appointment Conflict Check
        const hasApptConflict = existingApptIntervals.some((a) => {
          return slotStart < a.endMin && slotEnd > a.startMin;
        });
        if (hasApptConflict) {
          continue;
        }

        allAvailableSlots.push({
          start: slotStartUtc.toISOString(),
          end: slotEndUtc.toISOString(),
          startTime: minutesToTimeString(slotStart),
          endTime: minutesToTimeString(slotEnd),
          available: true,
          staffId: st.id,
          staffName: st.name,
        });
      }
    }

    // Sort slots chronologically
    allAvailableSlots.sort((a, b) => (a.start > b.start ? 1 : -1));

    // Deduplicate slots if querying for 'ANY' staff so the client sees unique time slots
    const uniqueSlots: SlotItem[] = [];
    const seenTimes = new Set<string>();

    for (const slot of allAvailableSlots) {
      if (staffId === 'ANY') {
        if (!seenTimes.has(slot.startTime)) {
          seenTimes.add(slot.startTime);
          uniqueSlots.push(slot);
        }
      } else {
        uniqueSlots.push(slot);
      }
    }

    return {
      date,
      timezone,
      service: {
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        depositAmount,
      },
      staff:
        eligibleStaff.length === 1
          ? { id: eligibleStaff[0].id, name: eligibleStaff[0].name }
          : null,
      slots: uniqueSlots,
    };
  }
}
