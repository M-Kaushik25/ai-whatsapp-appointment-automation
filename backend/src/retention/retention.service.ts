import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normalizePhone } from '../customers/customers.service';
import {
  FollowUpType,
  FollowUpStatus,
  FollowUpSkipReason,
} from './retention.types';
import {
  UpdateRetentionSettingsDto,
  RetentionFiltersDto,
} from './dto/retention.dto';

// In-memory mutex map to serialize concurrent background processing per follow-up
const retentionLocks = new Map<string, Promise<void>>();

async function acquireRetentionLock(followUpId: string): Promise<() => void> {
  while (retentionLocks.has(followUpId)) {
    await retentionLocks.get(followUpId);
  }
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    release = () => {
      retentionLocks.delete(followUpId);
      resolve();
    };
  });
  retentionLocks.set(followUpId, lockPromise);
  return release;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
  ) {}

  /**
   * Get or create default retention settings for a business (Multi-Tenant Isolated)
   */
  async getOrCreateSettings(businessId: string) {
    let settings = await this.prisma.businessRetentionSettings.findUnique({
      where: { businessId },
    });

    if (!settings) {
      settings = await this.prisma.businessRetentionSettings.create({
        data: {
          businessId,
          rebookingFollowUpEnabled: true,
          rebookingFollowUpDays: 30,
        },
      });
    }

    return settings;
  }

  /**
   * Update retention settings for a business (Multi-Tenant Isolated)
   */
  async updateSettings(businessId: string, dto: UpdateRetentionSettingsDto) {
    await this.getOrCreateSettings(businessId);

    if (dto.rebookingFollowUpDays !== undefined && dto.rebookingFollowUpDays <= 0) {
      throw new BadRequestException('Rebooking follow-up days must be greater than 0');
    }

    const updated = await this.prisma.businessRetentionSettings.update({
      where: { businessId },
      data: {
        ...(dto.rebookingFollowUpEnabled !== undefined && {
          rebookingFollowUpEnabled: dto.rebookingFollowUpEnabled,
        }),
        ...(dto.rebookingFollowUpDays !== undefined && {
          rebookingFollowUpDays: dto.rebookingFollowUpDays,
        }),
      },
    });

    this.logger.log(`Updated retention settings for business ${businessId}`);
    return updated;
  }

  /**
   * Lifecycle Hook: Called when an appointment is completed.
   * If retention follow-ups are enabled, creates a PENDING CustomerFollowUp record.
   */
  async handleAppointmentCompleted(businessId: string, appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, businessId },
        include: {
          business: true,
          customer: true,
        },
      });

      if (!appointment) {
        this.logger.warn(`Cannot handleAppointmentCompleted: Appointment ${appointmentId} not found`);
        return;
      }

      if (appointment.status !== 'COMPLETED') {
        this.logger.warn(
          `Cannot schedule follow-up: Appointment ${appointmentId} status is '${appointment.status}', expected 'COMPLETED'`
        );
        return;
      }

      const settings = await this.getOrCreateSettings(businessId);
      if (!settings.rebookingFollowUpEnabled) {
        this.logger.log(
          `Skipping retention follow-up for appt ${appointmentId}: retention follow-ups disabled for business ${businessId}`
        );
        return;
      }

      // Idempotency key per appointment and follow-up type
      const idempotencyKey = `rebooking_${appointment.id}`;
      const existing = await this.prisma.customerFollowUp.findUnique({
        where: { idempotencyKey },
      });

      if (existing) {
        this.logger.log(`Retention follow-up already exists for appt ${appointment.id}`);
        return;
      }

      // Calculate scheduledAt: appointment date/time + configured days
      const days = settings.rebookingFollowUpDays || 30;
      const baseDate = new Date(appointment.endAt || appointment.startAt);
      const scheduledAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

      // Check if customer already has a newer appointment booked after this source appointment
      const newerBooking = await this.prisma.appointment.findFirst({
        where: {
          businessId,
          customerId: appointment.customerId,
          id: { not: appointment.id },
          startAt: { gt: appointment.startAt },
          status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
        },
      });

      const initialStatus = newerBooking ? FollowUpStatus.SKIPPED : FollowUpStatus.PENDING;
      const initialSkipReason = newerBooking ? FollowUpSkipReason.CUSTOMER_REBOOKED : null;

      const followUp = await this.prisma.customerFollowUp.create({
        data: {
          businessId,
          customerId: appointment.customerId,
          sourceAppointmentId: appointment.id,
          type: FollowUpType.REBOOKING,
          scheduledAt,
          status: initialStatus,
          skipReason: initialSkipReason,
          idempotencyKey,
          payload: JSON.stringify({
            customerName: appointment.customer.name,
            serviceId: appointment.serviceId,
            followUpDays: days,
          }),
        },
      });

      this.logger.log(
        `Created retention follow-up ${followUp.id} for appt ${appointment.id} (Status: ${initialStatus}, Due: ${scheduledAt.toISOString()})`
      );
      return followUp;
    } catch (err: any) {
      this.logger.error(
        `Error in handleAppointmentCompleted for appt ${appointmentId}: ${err?.message}`,
        err?.stack
      );
    }
  }

  /**
   * Lifecycle Hook: Called when a customer books a new appointment.
   * Cancels/skips any earlier PENDING follow-ups for that customer.
   */
  async handleCustomerRebooked(
    businessId: string,
    customerId: string,
    newAppointmentStartAt: Date
  ) {
    try {
      const pendingFollowUps = await this.prisma.customerFollowUp.findMany({
        where: {
          businessId,
          customerId,
          status: FollowUpStatus.PENDING,
          sourceAppointment: {
            startAt: { lt: newAppointmentStartAt },
          },
        },
      });

      if (pendingFollowUps.length === 0) return;

      const idsToSkip = pendingFollowUps.map((f) => f.id);
      await this.prisma.customerFollowUp.updateMany({
        where: {
          id: { in: idsToSkip },
          status: FollowUpStatus.PENDING,
        },
        data: {
          status: FollowUpStatus.SKIPPED,
          skipReason: FollowUpSkipReason.CUSTOMER_REBOOKED,
          lastError: `Skipped because customer rebooked a new appointment on ${newAppointmentStartAt.toISOString()}`,
        },
      });

      this.logger.log(
        `Skipped ${idsToSkip.length} pending retention follow-up(s) for customer ${customerId} due to new booking`
      );
    } catch (err: any) {
      this.logger.error(
        `Error in handleCustomerRebooked for customer ${customerId}: ${err?.message}`,
        err?.stack
      );
    }
  }

  /**
   * Scheduler processor: queries all due PENDING follow-ups and dispatches them
   */
  async processDueFollowUps(): Promise<number> {
    const now = new Date();

    const dueFollowUps = await this.prisma.customerFollowUp.findMany({
      where: {
        status: FollowUpStatus.PENDING,
        scheduledAt: { lte: now },
      },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
    });

    if (dueFollowUps.length === 0) {
      return 0;
    }

    let processedCount = 0;
    for (const item of dueFollowUps) {
      const dispatched = await this.dispatchFollowUp(item.id);
      if (dispatched) {
        processedCount++;
      }
    }

    return processedCount;
  }

  /**
   * Atomic, concurrency-safe follow-up dispatcher
   */
  async dispatchFollowUp(followUpId: string): Promise<boolean> {
    const releaseLock = await acquireRetentionLock(followUpId);
    try {
      // 1. Atomic status transition: PENDING -> PROCESSING
      // If another concurrent worker claimed it, count is 0
      const lockResult = await this.prisma.customerFollowUp.updateMany({
        where: {
          id: followUpId,
          status: FollowUpStatus.PENDING,
        },
        data: {
          status: FollowUpStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });

      if (lockResult.count === 0) {
        // Follow-up already claimed or processed by another worker
        return false;
      }

      // 2. Fetch locked record with relations
      const followUp = await this.prisma.customerFollowUp.findUnique({
        where: { id: followUpId },
        include: {
          business: {
            include: {
              retentionSettings: true,
            },
          },
          customer: true,
          sourceAppointment: true,
        },
      });

      if (!followUp) return false;

      // 3. Pre-Flight Validation 1: Check business retention settings
      const settings =
        followUp.business.retentionSettings ||
        (await this.getOrCreateSettings(followUp.businessId));

      if (!settings.rebookingFollowUpEnabled) {
        await this.prisma.customerFollowUp.update({
          where: { id: followUpId },
          data: {
            status: FollowUpStatus.SKIPPED,
            skipReason: FollowUpSkipReason.SETTINGS_DISABLED,
            lastError: 'Business retention follow-ups are currently disabled',
          },
        });
        return false;
      }

      // 4. Pre-Flight Validation 2: Check Customer Status & Phone
      if (followUp.customer.status !== 'ACTIVE') {
        await this.prisma.customerFollowUp.update({
          where: { id: followUpId },
          data: {
            status: FollowUpStatus.SKIPPED,
            skipReason: FollowUpSkipReason.CUSTOMER_INACTIVE,
            lastError: `Customer status is ${followUp.customer.status}`,
          },
        });
        return false;
      }

      const normalizedPhone = normalizePhone(followUp.customer.phone);
      const isValidPhone = Boolean(normalizedPhone && /^\+[1-9]\d{6,14}$/.test(normalizedPhone));
      if (!isValidPhone) {
        await this.prisma.customerFollowUp.update({
          where: { id: followUpId },
          data: {
            status: FollowUpStatus.SKIPPED,
            skipReason: FollowUpSkipReason.NO_WHATSAPP,
            lastError: 'Customer phone number is invalid or missing',
          },
        });
        return false;
      }

      // 5. Pre-Flight Validation 3: Check Source Appointment Status
      if (followUp.sourceAppointment.status !== 'COMPLETED') {
        await this.prisma.customerFollowUp.update({
          where: { id: followUpId },
          data: {
            status: FollowUpStatus.CANCELLED,
            lastError: `Source appointment status is '${followUp.sourceAppointment.status}', not COMPLETED`,
          },
        });
        return false;
      }

      // 6. Pre-Flight Validation 4: Immediate Rebooking Check
      // Has the customer booked another appointment after the source appointment?
      const newerBooking = await this.prisma.appointment.findFirst({
        where: {
          businessId: followUp.businessId,
          customerId: followUp.customerId,
          id: { not: followUp.sourceAppointmentId },
          startAt: { gt: followUp.sourceAppointment.startAt },
          status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
        },
      });

      if (newerBooking) {
        await this.prisma.customerFollowUp.update({
          where: { id: followUpId },
          data: {
            status: FollowUpStatus.SKIPPED,
            skipReason: FollowUpSkipReason.CUSTOMER_REBOOKED,
            lastError: `Customer rebooked an appointment for ${newerBooking.startAt.toISOString()}`,
          },
        });
        this.logger.log(
          `Skipped follow-up ${followUpId}: customer rebooked newer appointment ${newerBooking.id}`
        );
        return false;
      }

      // 7. Construct Deterministic WhatsApp Message
      const customerName = followUp.customer.name || 'there';
      const businessName = followUp.business.name || 'our salon';
      const messageText = `Hi ${customerName} 👋\n\nIt's been a while since your last appointment at ${businessName}.\n\nWould you like to book another appointment?\n\nReply BOOK to get started.`;

      // 8. Send WhatsApp Message via Provider Abstraction
      try {
        const sentRecord = await this.whatsAppService.sendTextMessage(followUp.businessId, {
          recipientPhone: normalizedPhone,
          text: messageText,
        });

        // 9. Mark SENT
        await this.prisma.customerFollowUp.update({
          where: { id: followUpId },
          data: {
            status: FollowUpStatus.SENT,
            sentAt: new Date(),
            providerMessageId: sentRecord.whatsappMessageId,
            lastError: null,
          },
        });

        this.logger.log(
          `Retention follow-up ${followUpId} successfully sent to ${normalizedPhone}`
        );
        return true;
      } catch (sendErr: any) {
        const errMessage = sendErr?.message || 'WhatsApp message dispatch error';
        this.logger.warn(`Failed to send retention follow-up ${followUpId}: ${errMessage}`);

        const currentAttempts = followUp.attempts;
        if (currentAttempts >= followUp.maxAttempts) {
          await this.prisma.customerFollowUp.update({
            where: { id: followUpId },
            data: {
              status: FollowUpStatus.FAILED,
              lastError: `Max retry attempts reached (${followUp.maxAttempts}). Last error: ${errMessage}`,
            },
          });
        } else {
          // Reset to PENDING for subsequent retry
          await this.prisma.customerFollowUp.update({
            where: { id: followUpId },
            data: {
              status: FollowUpStatus.PENDING,
              lastError: `Attempt ${currentAttempts} failed: ${errMessage}`,
            },
          });
        }
        return false;
      }
    } finally {
      releaseLock();
    }
  }

  /**
   * Stale PROCESSING lock recovery mechanism (e.g. after sudden server crash)
   */
  async recoverStaleProcessingLocks(leaseTimeoutMinutes = 5): Promise<number> {
    const threshold = new Date(Date.now() - leaseTimeoutMinutes * 60 * 1000);

    const staleRecords = await this.prisma.customerFollowUp.findMany({
      where: {
        status: FollowUpStatus.PROCESSING,
        updatedAt: { lte: threshold },
      },
    });

    let recovered = 0;
    for (const record of staleRecords) {
      if (record.attempts >= record.maxAttempts) {
        await this.prisma.customerFollowUp.update({
          where: { id: record.id },
          data: {
            status: FollowUpStatus.FAILED,
            lastError: `Stale lock lease expired after ${record.attempts} attempts`,
          },
        });
      } else {
        await this.prisma.customerFollowUp.update({
          where: { id: record.id },
          data: {
            status: FollowUpStatus.PENDING,
            lastError: 'Recovered from unacknowledged PROCESSING state',
          },
        });
      }
      recovered++;
    }

    if (recovered > 0) {
      this.logger.warn(`Recovered ${recovered} stale retention processing lock(s)`);
    }

    return recovered;
  }

  /**
   * Discover and schedule follow-ups for historical COMPLETED appointments missing records
   */
  async syncHistoricalCompletedAppointments(businessId: string) {
    const settings = await this.getOrCreateSettings(businessId);
    if (!settings.rebookingFollowUpEnabled) {
      return { synced: 0, message: 'Retention follow-ups are disabled for this business' };
    }

    const completedAppts = await this.prisma.appointment.findMany({
      where: {
        businessId,
        status: 'COMPLETED',
      },
      include: {
        customer: true,
      },
    });

    let syncedCount = 0;
    for (const appt of completedAppts) {
      const idempotencyKey = `rebooking_${appt.id}`;
      const existing = await this.prisma.customerFollowUp.findUnique({
        where: { idempotencyKey },
      });

      if (!existing) {
        await this.handleAppointmentCompleted(businessId, appt.id);
        syncedCount++;
      }
    }

    return { synced: syncedCount, totalCompleted: completedAppts.length };
  }

  // ==========================================
  // DASHBOARD APIS (TENANT ISOLATED)
  // ==========================================

  /**
   * Find all follow-ups for a business with pagination, filtering & search
   */
  async findAll(businessId: string, filters: RetentionFiltersDto = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { businessId };

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }
    if (filters.customerId) {
      where.customerId = filters.customerId;
    }
    if (filters.sourceAppointmentId) {
      where.sourceAppointmentId = filters.sourceAppointmentId;
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { customer: { name: { contains: q } } },
        { customer: { phone: { contains: q } } },
        { sourceAppointmentId: { contains: q } },
        { providerMessageId: { contains: q } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.customerFollowUp.count({ where }),
      this.prisma.customerFollowUp.findMany({
        where,
        include: {
          customer: true,
          sourceAppointment: {
            include: {
              service: true,
              staff: true,
            },
          },
        },
        orderBy: { scheduledAt: 'desc' },
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

  /**
   * Find single follow-up details (Tenant Isolated)
   */
  async findOne(businessId: string, id: string) {
    const followUp = await this.prisma.customerFollowUp.findFirst({
      where: { id, businessId },
      include: {
        customer: true,
        sourceAppointment: {
          include: {
            service: true,
            staff: true,
          },
        },
      },
    });

    if (!followUp) {
      throw new NotFoundException('Follow-up record not found');
    }

    return followUp;
  }

  /**
   * Retention KPI statistics for dashboard
   */
  async getStats(businessId: string) {
    const [total, pending, sent, skipped, failed] = await Promise.all([
      this.prisma.customerFollowUp.count({ where: { businessId } }),
      this.prisma.customerFollowUp.count({ where: { businessId, status: FollowUpStatus.PENDING } }),
      this.prisma.customerFollowUp.count({ where: { businessId, status: FollowUpStatus.SENT } }),
      this.prisma.customerFollowUp.count({ where: { businessId, status: FollowUpStatus.SKIPPED } }),
      this.prisma.customerFollowUp.count({ where: { businessId, status: FollowUpStatus.FAILED } }),
    ]);

    return {
      total,
      pending,
      sent,
      skipped,
      failed,
    };
  }
}
