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
  NotificationFiltersDto,
  UpdateReminderSettingsDto,
} from './dto/notification.dto';

export enum NotificationType {
  BOOKING_CONFIRMATION = 'BOOKING_CONFIRMATION',
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
  RESCHEDULE_CONFIRMATION = 'RESCHEDULE_CONFIRMATION',
  CANCELLATION_CONFIRMATION = 'CANCELLATION_CONFIRMATION',
  OWNER_BOOKING_NOTIFICATION = 'OWNER_BOOKING_NOTIFICATION',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// In-memory worker lock map to serialize concurrent background processing per notification
const notificationLocks = new Map<string, Promise<void>>();

async function acquireNotificationLock(notificationId: string): Promise<() => void> {
  while (notificationLocks.has(notificationId)) {
    await notificationLocks.get(notificationId);
  }
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    release = () => {
      notificationLocks.delete(notificationId);
      resolve();
    };
  });
  notificationLocks.set(notificationId, lockPromise);
  return release;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
  ) {}

  /**
   * Helper to format UTC Date in a given Timezone
   */
  formatDateTimeInTz(date: Date, timezone: string = 'Asia/Kolkata') {
    try {
      const dateFormatter = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: timezone,
      });
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });

      return {
        formattedDate: dateFormatter.format(date),
        formattedTime: timeFormatter.format(date),
      };
    } catch {
      // Fallback if invalid timezone passed
      return {
        formattedDate: date.toISOString().slice(0, 10),
        formattedTime: date.toISOString().slice(11, 16),
      };
    }
  }

  /**
   * Get business timezone from business settings
   */
  private parseBusinessTimezone(businessSettings?: string | null): string {
    if (!businessSettings) return 'Asia/Kolkata';
    try {
      const parsed = JSON.parse(businessSettings);
      return parsed.timezone || 'Asia/Kolkata';
    } catch {
      return 'Asia/Kolkata';
    }
  }

  /**
   * Get or create business reminder settings with sensible defaults
   */
  async getOrCreateReminderSettings(businessId: string) {
    let settings = await this.prisma.businessReminderSettings.findUnique({
      where: { businessId },
    });

    if (!settings) {
      settings = await this.prisma.businessReminderSettings.create({
        data: {
          businessId,
          remindersEnabled: true,
          firstReminderMinutes: 1440, // 24 hours
          firstReminderEnabled: true,
          secondReminderMinutes: 120, // 2 hours
          secondReminderEnabled: true,
          ownerNotificationEnabled: true,
        },
      });
    }

    return settings;
  }

  /**
   * Update business reminder settings (Tenant Isolated)
   */
  async updateReminderSettings(
    businessId: string,
    dto: UpdateReminderSettingsDto,
  ) {
    await this.getOrCreateReminderSettings(businessId);

    if (dto.firstReminderMinutes !== undefined && dto.firstReminderMinutes <= 0) {
      throw new BadRequestException('First reminder minutes must be a positive integer');
    }
    if (dto.secondReminderMinutes !== undefined && dto.secondReminderMinutes <= 0) {
      throw new BadRequestException('Second reminder minutes must be a positive integer');
    }
    if (
      dto.firstReminderMinutes !== undefined &&
      dto.secondReminderMinutes !== undefined &&
      dto.secondReminderMinutes >= dto.firstReminderMinutes
    ) {
      throw new BadRequestException('Second reminder must be scheduled closer to the appointment than the first reminder');
    }

    let ownerPhone = dto.ownerNotificationPhone;
    if (ownerPhone && ownerPhone.trim()) {
      const norm = normalizePhone(ownerPhone);
      if (!norm) {
        throw new BadRequestException('Invalid owner notification phone number format');
      }
      ownerPhone = norm;
    }

    const updated = await this.prisma.businessReminderSettings.update({
      where: { businessId },
      data: {
        remindersEnabled: dto.remindersEnabled,
        firstReminderMinutes: dto.firstReminderMinutes,
        firstReminderEnabled: dto.firstReminderEnabled,
        secondReminderMinutes: dto.secondReminderMinutes,
        secondReminderEnabled: dto.secondReminderEnabled,
        ownerNotificationEnabled: dto.ownerNotificationEnabled,
        ownerNotificationPhone: ownerPhone,
      },
    });

    this.logger.log(`Updated reminder settings for business ${businessId}`);
    return updated;
  }

  // ==========================================
  // APPOINTMENT LIFECYCLE EVENT HANDLERS
  // ==========================================

  /**
   * Lifecycle Hook: Called after an appointment is successfully created.
   * 1. Sends immediate Customer Booking Confirmation (Idempotent)
   * 2. Sends immediate Owner Booking Notification (Idempotent)
   * 3. Calculates and schedules future APPOINTMENT_REMINDER records
   */
  async handleAppointmentCreated(businessId: string, appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, businessId },
        include: {
          business: true,
          customer: true,
          staff: true,
          service: true,
        },
      });

      if (!appointment) {
        this.logger.warn(`Cannot handleAppointmentCreated: Appointment ${appointmentId} not found`);
        return;
      }

      const settings = await this.getOrCreateReminderSettings(businessId);
      const timezone = this.parseBusinessTimezone(appointment.business.settings);
      const { formattedDate, formattedTime } = this.formatDateTimeInTz(appointment.startAt, timezone);
      const refCode = appointment.id.slice(0, 8).toUpperCase();

      // 1. Immediate Customer Booking Confirmation (Idempotent)
      const customerPhone = normalizePhone(appointment.customer.phone);
      if (customerPhone) {
        const confirmationIdempotency = `booking_conf_${appointment.id}`;
        const confirmationText = `Appointment confirmed! 🎉\n\nBusiness: ${appointment.business.name}\nService: ${appointment.service.name}\nDate: ${formattedDate}\nTime: ${formattedTime}\nStaff: ${appointment.staff.name}\nPrice: ₹${appointment.price}\n\nBooking reference: #${refCode}\n\nThank you! We look forward to seeing you.`;

        const existingConf = await this.prisma.appointmentNotification.findUnique({
          where: { idempotencyKey: confirmationIdempotency },
        });

        if (!existingConf) {
          const notif = await this.prisma.appointmentNotification.create({
            data: {
              businessId,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              type: NotificationType.BOOKING_CONFIRMATION,
              recipientPhone: customerPhone,
              scheduledAt: new Date(),
              status: NotificationStatus.PENDING,
              idempotencyKey: confirmationIdempotency,
              payload: JSON.stringify({ message: confirmationText }),
            },
          });

          await this.dispatchNotification(notif.id);
        }
      }

      // 2. Immediate Owner Booking Notification (Idempotent)
      if (settings.ownerNotificationEnabled) {
        const ownerDestination = settings.ownerNotificationPhone || appointment.business.phone;
        const normalizedOwnerPhone = ownerDestination ? normalizePhone(ownerDestination) : null;

        if (normalizedOwnerPhone) {
          const ownerIdempotency = `owner_notif_${appointment.id}`;
          const ownerText = `📅 New Appointment Booked\n\nBusiness: ${appointment.business.name}\nCustomer: ${appointment.customer.name}\nPhone: ${appointment.customer.phone}\n\nService: ${appointment.service.name}\nStaff: ${appointment.staff.name}\nDate: ${formattedDate}\nTime: ${formattedTime}\nPrice: ₹${appointment.price}\n\nBooking reference: #${refCode}`;

          const existingOwnerNotif = await this.prisma.appointmentNotification.findUnique({
            where: { idempotencyKey: ownerIdempotency },
          });

          if (!existingOwnerNotif) {
            const ownerNotif = await this.prisma.appointmentNotification.create({
              data: {
                businessId,
                appointmentId: appointment.id,
                customerId: appointment.customerId,
                type: NotificationType.OWNER_BOOKING_NOTIFICATION,
                recipientPhone: normalizedOwnerPhone,
                scheduledAt: new Date(),
                status: NotificationStatus.PENDING,
                idempotencyKey: ownerIdempotency,
                payload: JSON.stringify({ message: ownerText }),
              },
            });

            await this.dispatchNotification(ownerNotif.id);
          }
        }
      }

      // 3. Schedule Future Reminders (if reminders are enabled)
      if (settings.remindersEnabled && customerPhone) {
        await this.scheduleRemindersForAppointment(appointment, settings);
      }
    } catch (err: any) {
      this.logger.error(`Error in handleAppointmentCreated for appt ${appointmentId}: ${err?.message}`, err?.stack);
    }
  }

  /**
   * Helper: Calculate and schedule 24h / 2h reminders for an appointment
   */
  private async scheduleRemindersForAppointment(
    appointment: any,
    settings: any,
  ) {
    const now = new Date();
    const apptStart = new Date(appointment.startAt);

    // 1st Reminder (Default 24h = 1440 mins before)
    if (settings.firstReminderEnabled && settings.firstReminderMinutes > 0) {
      const firstScheduledAt = new Date(apptStart.getTime() - settings.firstReminderMinutes * 60 * 1000);
      if (firstScheduledAt > now) {
        const firstKey = `reminder_1_${appointment.id}_${settings.firstReminderMinutes}_${firstScheduledAt.getTime()}`;
        const existing = await this.prisma.appointmentNotification.findUnique({
          where: { idempotencyKey: firstKey },
        });

        if (!existing) {
          await this.prisma.appointmentNotification.create({
            data: {
              businessId: appointment.businessId,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              type: NotificationType.APPOINTMENT_REMINDER,
              recipientPhone: normalizePhone(appointment.customer.phone) || appointment.customer.phone,
              scheduledAt: firstScheduledAt,
              status: NotificationStatus.PENDING,
              idempotencyKey: firstKey,
              payload: JSON.stringify({ reminderType: 'FIRST', minutesBefore: settings.firstReminderMinutes }),
            },
          });
          this.logger.log(`Scheduled 1st reminder for appt ${appointment.id} at ${firstScheduledAt.toISOString()}`);
        }
      } else {
        this.logger.log(`Skipping 1st reminder for appt ${appointment.id}: scheduled time is in the past`);
      }
    }

    // 2nd Reminder (Default 2h = 120 mins before)
    if (settings.secondReminderEnabled && settings.secondReminderMinutes > 0) {
      const secondScheduledAt = new Date(apptStart.getTime() - settings.secondReminderMinutes * 60 * 1000);
      if (secondScheduledAt > now) {
        const secondKey = `reminder_2_${appointment.id}_${settings.secondReminderMinutes}_${secondScheduledAt.getTime()}`;
        const existing = await this.prisma.appointmentNotification.findUnique({
          where: { idempotencyKey: secondKey },
        });

        if (!existing) {
          await this.prisma.appointmentNotification.create({
            data: {
              businessId: appointment.businessId,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              type: NotificationType.APPOINTMENT_REMINDER,
              recipientPhone: normalizePhone(appointment.customer.phone) || appointment.customer.phone,
              scheduledAt: secondScheduledAt,
              status: NotificationStatus.PENDING,
              idempotencyKey: secondKey,
              payload: JSON.stringify({ reminderType: 'SECOND', minutesBefore: settings.secondReminderMinutes }),
            },
          });
          this.logger.log(`Scheduled 2nd reminder for appt ${appointment.id} at ${secondScheduledAt.toISOString()}`);
        }
      } else {
        this.logger.log(`Skipping 2nd reminder for appt ${appointment.id}: scheduled time is in the past`);
      }
    }
  }

  /**
   * Lifecycle Hook: Called after an appointment is rescheduled
   * 1. Cancels all old pending reminders
   * 2. Schedules new reminders for the new start time
   * 3. Sends Reschedule Confirmation to customer
   */
  async handleAppointmentRescheduled(
    businessId: string,
    appointmentId: string,
    oldStartAt: Date,
    newStartAt: Date,
  ) {
    try {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, businessId },
        include: {
          business: true,
          customer: true,
          staff: true,
          service: true,
        },
      });

      if (!appointment) return;

      // 1. Invalidate & Cancel existing PENDING reminders
      await this.prisma.appointmentNotification.updateMany({
        where: {
          appointmentId: appointment.id,
          type: NotificationType.APPOINTMENT_REMINDER,
          status: NotificationStatus.PENDING,
        },
        data: {
          status: NotificationStatus.CANCELLED,
          lastError: `Cancelled due to appointment rescheduling from ${oldStartAt.toISOString()} to ${newStartAt.toISOString()}`,
        },
      });

      // 2. Schedule new reminders
      const settings = await this.getOrCreateReminderSettings(businessId);
      if (settings.remindersEnabled) {
        await this.scheduleRemindersForAppointment(appointment, settings);
      }

      // 3. Send Reschedule Confirmation
      const customerPhone = normalizePhone(appointment.customer.phone);
      if (customerPhone) {
        const timezone = this.parseBusinessTimezone(appointment.business.settings);
        const { formattedDate, formattedTime } = this.formatDateTimeInTz(newStartAt, timezone);
        const refCode = appointment.id.slice(0, 8).toUpperCase();

        const reschedKey = `resched_conf_${appointment.id}_${newStartAt.getTime()}`;
        const reschedText = `Appointment Rescheduled 🔄\n\nHi ${appointment.customer.name}!\n\nYour appointment with ${appointment.business.name} has been rescheduled successfully.\n\nService: ${appointment.service.name}\nNew Date: ${formattedDate}\nNew Time: ${formattedTime}\nStaff: ${appointment.staff.name}\n\nBooking reference: #${refCode}\n\nSee you soon!`;

        const existingNotif = await this.prisma.appointmentNotification.findUnique({
          where: { idempotencyKey: reschedKey },
        });

        if (!existingNotif) {
          const notif = await this.prisma.appointmentNotification.create({
            data: {
              businessId,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              type: NotificationType.RESCHEDULE_CONFIRMATION,
              recipientPhone: customerPhone,
              scheduledAt: new Date(),
              status: NotificationStatus.PENDING,
              idempotencyKey: reschedKey,
              payload: JSON.stringify({ message: reschedText }),
            },
          });

          await this.dispatchNotification(notif.id);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in handleAppointmentRescheduled: ${err?.message}`, err?.stack);
    }
  }

  /**
   * Lifecycle Hook: Called after an appointment is cancelled
   * 1. Cancels all pending reminders
   * 2. Sends Cancellation Confirmation to customer
   */
  async handleAppointmentCancelled(businessId: string, appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, businessId },
        include: {
          business: true,
          customer: true,
          staff: true,
          service: true,
        },
      });

      if (!appointment) return;

      // 1. Cancel all PENDING reminders for this appointment
      await this.prisma.appointmentNotification.updateMany({
        where: {
          appointmentId: appointment.id,
          status: NotificationStatus.PENDING,
        },
        data: {
          status: NotificationStatus.CANCELLED,
          lastError: 'Cancelled due to appointment cancellation',
        },
      });

      // 2. Send Cancellation Confirmation to Customer
      const customerPhone = normalizePhone(appointment.customer.phone);
      if (customerPhone) {
        const timezone = this.parseBusinessTimezone(appointment.business.settings);
        const { formattedDate, formattedTime } = this.formatDateTimeInTz(appointment.startAt, timezone);
        const refCode = appointment.id.slice(0, 8).toUpperCase();

        const cancelKey = `cancel_conf_${appointment.id}`;
        const cancelText = `Appointment Cancelled ❌\n\nHi ${appointment.customer.name},\n\nYour appointment with ${appointment.business.name} has been cancelled.\n\nService: ${appointment.service.name}\nDate: ${formattedDate}\nTime: ${formattedTime}\n\nBooking reference: #${refCode}\n\nIf this was a mistake, feel free to book again anytime.`;

        const existingNotif = await this.prisma.appointmentNotification.findUnique({
          where: { idempotencyKey: cancelKey },
        });

        if (!existingNotif) {
          const notif = await this.prisma.appointmentNotification.create({
            data: {
              businessId,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              type: NotificationType.CANCELLATION_CONFIRMATION,
              recipientPhone: customerPhone,
              scheduledAt: new Date(),
              status: NotificationStatus.PENDING,
              idempotencyKey: cancelKey,
              payload: JSON.stringify({ message: cancelText }),
            },
          });

          await this.dispatchNotification(notif.id);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in handleAppointmentCancelled: ${err?.message}`, err?.stack);
    }
  }

  /**
   * Lifecycle Hook: Called when appointment is completed or marked no-show
   * Cancels any remaining pending notifications
   */
  async handleAppointmentCompleted(businessId: string, appointmentId: string) {
    try {
      await this.prisma.appointmentNotification.updateMany({
        where: {
          appointmentId,
          businessId,
          status: NotificationStatus.PENDING,
        },
        data: {
          status: NotificationStatus.CANCELLED,
          lastError: 'Cancelled because appointment has already completed',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error in handleAppointmentCompleted: ${err?.message}`);
    }
  }

  async handleAppointmentNoShow(businessId: string, appointmentId: string) {
    try {
      await this.prisma.appointmentNotification.updateMany({
        where: {
          appointmentId,
          businessId,
          status: NotificationStatus.PENDING,
        },
        data: {
          status: NotificationStatus.CANCELLED,
          lastError: 'Cancelled because customer was marked as no-show',
        },
      });
    } catch (err: any) {
      this.logger.error(`Error in handleAppointmentNoShow: ${err?.message}`);
    }
  }

  // ==========================================
  // SCHEDULER & NOTIFICATION DISPATCH ENGINE
  // ==========================================

  /**
   * Process all due PENDING notifications (scheduledAt <= now).
   * Concurrency-safe: atomic update to PROCESSING locks individual records.
   */
  async processDueNotifications(): Promise<number> {
    const now = new Date();

    // 1. Find candidate PENDING notifications
    const dueNotifications = await this.prisma.appointmentNotification.findMany({
      where: {
        status: NotificationStatus.PENDING,
        scheduledAt: { lte: now },
      },
      take: 50,
      orderBy: { scheduledAt: 'asc' },
    });

    if (dueNotifications.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const notif of dueNotifications) {
      const dispatched = await this.dispatchNotification(notif.id);
      if (dispatched) {
        processedCount++;
      }
    }

    return processedCount;
  }

  /**
   * Concurrency-safe, atomic notification dispatcher
   */
  async dispatchNotification(notificationId: string): Promise<boolean> {
    const releaseLock = await acquireNotificationLock(notificationId);
    try {
      // 1. Atomic status transition: PENDING -> PROCESSING
      // If another worker already locked or processed this, count will be 0
      const lockResult = await this.prisma.appointmentNotification.updateMany({
        where: {
          id: notificationId,
          status: NotificationStatus.PENDING,
        },
        data: {
          status: NotificationStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });

      if (lockResult.count === 0) {
        // Notification already claimed by another worker
        return false;
      }

      // 2. Fetch locked notification with complete details
      const notif = await this.prisma.appointmentNotification.findUnique({
        where: { id: notificationId },
        include: {
          business: true,
          appointment: {
            include: {
              customer: true,
              staff: true,
              service: true,
            },
          },
          customer: true,
        },
      });

      if (!notif) return false;

      // 3. Grace Period & Expiration Check
      // If appointment is already cancelled or in the past for a reminder, mark CANCELLED
      const now = new Date();
      if (
        notif.type === NotificationType.APPOINTMENT_REMINDER &&
        notif.appointment.status === 'CANCELLED'
      ) {
        await this.prisma.appointmentNotification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.CANCELLED,
            lastError: 'Appointment is cancelled',
          },
        });
        return false;
      }

      if (
        notif.type === NotificationType.APPOINTMENT_REMINDER &&
        now > new Date(notif.appointment.startAt)
      ) {
        await this.prisma.appointmentNotification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.CANCELLED,
            lastError: 'Reminder expired: Appointment start time has already passed',
          },
        });
        return false;
      }

      // 4. Construct message text
      let textToSend = '';
      if (notif.payload) {
        try {
          const parsed = JSON.parse(notif.payload);
          if (parsed.message) {
            textToSend = parsed.message;
          }
        } catch {}
      }

      if (!textToSend) {
        // Generate reminder message
        const timezone = this.parseBusinessTimezone(notif.business.settings);
        const { formattedDate, formattedTime } = this.formatDateTimeInTz(
          notif.appointment.startAt,
          timezone,
        );
        const refCode = notif.appointment.id.slice(0, 8).toUpperCase();
        const customerName = notif.customer?.name || notif.appointment.customer?.name || 'Customer';

        textToSend = `⏰ Appointment Reminder\n\nHi ${customerName}!\n\nThis is a friendly reminder for your upcoming appointment with ${notif.business.name}.\n\nService: ${notif.appointment.service.name}\nStaff: ${notif.appointment.staff.name}\nDate: ${formattedDate}\nTime: ${formattedTime}\n\nBooking reference: #${refCode}\n\nSee you soon! 😊`;
      }

      // 5. Send via WhatsApp Messaging Service
      try {
        const sentRecord = await this.whatsAppService.sendTextMessage(notif.businessId, {
          recipientPhone: notif.recipientPhone,
          text: textToSend,
        });

        // 6. Record Success
        await this.prisma.appointmentNotification.update({
          where: { id: notificationId },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            providerMessageId: sentRecord.whatsappMessageId,
            lastError: null,
          },
        });

        this.logger.log(
          `Notification ${notificationId} (${notif.type}) delivered to ${notif.recipientPhone}`,
        );
        return true;
      } catch (sendErr: any) {
        const errMessage = sendErr?.message || 'WhatsApp message dispatch error';
        this.logger.warn(`Failed to send notification ${notificationId}: ${errMessage}`);

        const currentAttempts = notif.attempts; // Note: already incremented by 1 in atomic step
        if (currentAttempts >= notif.maxAttempts) {
          // Exceeded retry limit -> mark as FAILED
          await this.prisma.appointmentNotification.update({
            where: { id: notificationId },
            data: {
              status: NotificationStatus.FAILED,
              lastError: `Max retry attempts reached (${notif.maxAttempts}). Last error: ${errMessage}`,
            },
          });
        } else {
          // Reset status to PENDING for subsequent retry attempt
          await this.prisma.appointmentNotification.update({
            where: { id: notificationId },
            data: {
              status: NotificationStatus.PENDING,
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

  // ==========================================
  // DASHBOARD QUERY & MANAGEMENT APIS
  // ==========================================

  /**
   * Find all notifications for a business with pagination and filtering (Multi-Tenant Isolated)
   */
  async findAll(businessId: string, filters: NotificationFiltersDto = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { businessId };

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }
    if (filters.type && filters.type !== 'ALL') {
      where.type = filters.type;
    }
    if (filters.appointmentId) {
      where.appointmentId = filters.appointmentId;
    }
    if (filters.customerId) {
      where.customerId = filters.customerId;
    }
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { recipientPhone: { contains: q } },
        { customer: { name: { contains: q } } },
        { appointmentId: { contains: q } },
        { providerMessageId: { contains: q } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.appointmentNotification.count({ where }),
      this.prisma.appointmentNotification.findMany({
        where,
        include: {
          customer: true,
          appointment: {
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
   * Find single notification details (Tenant Isolated)
   */
  async findOne(businessId: string, id: string) {
    const notif = await this.prisma.appointmentNotification.findFirst({
      where: { id, businessId },
      include: {
        customer: true,
        appointment: {
          include: {
            service: true,
            staff: true,
          },
        },
      },
    });

    if (!notif) {
      throw new NotFoundException('Notification not found');
    }

    return notif;
  }
}
