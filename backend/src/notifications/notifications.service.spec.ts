import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  NotificationsService,
  NotificationType,
  NotificationStatus,
} from './notifications.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('NotificationsService (Phase 9 Unit & Integration Tests)', () => {
  let service: NotificationsService;
  let prismaMock: any;
  let whatsAppServiceMock: any;

  const sampleBusinessId = 'biz_12345';
  const sampleBusinessId2 = 'biz_99999';
  const sampleAppointmentId = 'appt_abc123';

  const sampleBusiness = {
    id: sampleBusinessId,
    name: 'Glow Luxury Salon',
    slug: 'glow-luxury-salon',
    phone: '+919876543210',
    settings: JSON.stringify({ timezone: 'Asia/Kolkata' }),
  };

  const sampleCustomer = {
    id: 'cust_001',
    businessId: sampleBusinessId,
    name: 'Rahul Sharma',
    phone: '+919876500001',
    status: 'ACTIVE',
  };

  const sampleStaff = {
    id: 'staff_001',
    businessId: sampleBusinessId,
    name: 'John Doe',
  };

  const sampleService = {
    id: 'svc_001',
    businessId: sampleBusinessId,
    name: 'Executive Haircut',
    durationMinutes: 45,
    price: 500,
  };

  const sampleAppointment = {
    id: sampleAppointmentId,
    businessId: sampleBusinessId,
    customerId: sampleCustomer.id,
    customer: sampleCustomer,
    staffId: sampleStaff.id,
    staff: sampleStaff,
    serviceId: sampleService.id,
    service: sampleService,
    business: sampleBusiness,
    startAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours in future
    endAt: new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60 * 1000),
    status: 'CONFIRMED',
    price: 500,
  };

  const defaultSettings = {
    id: 'sett_001',
    businessId: sampleBusinessId,
    remindersEnabled: true,
    firstReminderMinutes: 1440, // 24h
    firstReminderEnabled: true,
    secondReminderMinutes: 120,  // 2h
    secondReminderEnabled: true,
    ownerNotificationEnabled: true,
    ownerNotificationPhone: '+919876543210',
  };

  beforeEach(() => {
    prismaMock = {
      businessReminderSettings: {
        findUnique: vi.fn().mockResolvedValue(defaultSettings),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sett_new', ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...defaultSettings, ...data })),
      },
      appointment: {
        findFirst: vi.fn().mockResolvedValue(sampleAppointment),
      },
      appointmentNotification: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `notif_${Math.random().toString(36).slice(2, 9)}`,
            attempts: 0,
            maxAttempts: 3,
            status: NotificationStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          }),
        ),
        update: vi.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({
            id: where.id,
            ...data,
          }),
        ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    whatsAppServiceMock = {
      sendTextMessage: vi.fn().mockResolvedValue({
        whatsappMessageId: 'wamid.HBgLMTIzNDU2Nzg5',
        status: 'SENT',
      }),
    };

    service = new NotificationsService(prismaMock, whatsAppServiceMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================
  // 1. SETTINGS & VALIDATION
  // ==========================================
  describe('Reminder Settings & Validation', () => {
    it('should get or create default reminder settings', async () => {
      prismaMock.businessReminderSettings.findUnique.mockResolvedValue(null);
      const res = await service.getOrCreateReminderSettings(sampleBusinessId);
      expect(res.remindersEnabled).toBe(true);
      expect(res.firstReminderMinutes).toBe(1440);
      expect(res.secondReminderMinutes).toBe(120);
    });

    it('should reject non-positive reminder intervals', async () => {
      await expect(
        service.updateReminderSettings(sampleBusinessId, { firstReminderMinutes: -10 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject second reminder greater than or equal to first reminder', async () => {
      await expect(
        service.updateReminderSettings(sampleBusinessId, {
          firstReminderMinutes: 60,
          secondReminderMinutes: 120,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should normalize valid owner phone number', async () => {
      await service.updateReminderSettings(sampleBusinessId, {
        ownerNotificationPhone: '9876543210',
      });
      expect(prismaMock.businessReminderSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerNotificationPhone: '+919876543210',
          }),
        }),
      );
    });
  });

  // ==========================================
  // 2. TIMEZONE HANDLING
  // ==========================================
  describe('Timezone-aware Date & Time Formatting', () => {
    it('should format UTC timestamp in Asia/Kolkata correctly', () => {
      // 2026-09-12 05:00:00 UTC is 10:30 AM IST (UTC+5:30)
      const date = new Date(Date.UTC(2026, 8, 12, 5, 0, 0));
      const { formattedDate, formattedTime } = service.formatDateTimeInTz(date, 'Asia/Kolkata');

      expect(formattedDate).toContain('12 September 2026');
      expect(formattedTime.toUpperCase()).toBe('10:30 AM');
    });

    it('should handle different timezones like America/New_York (UTC-4 in Sep)', () => {
      const date = new Date(Date.UTC(2026, 8, 12, 14, 30, 0));
      const { formattedTime } = service.formatDateTimeInTz(date, 'America/New_York');
      expect(formattedTime.toUpperCase()).toBe('10:30 AM');
    });
  });

  // ==========================================
  // 3. BOOKING CREATION & CONFIRMATION
  // ==========================================
  describe('Appointment Created Event Hook', () => {
    it('should create customer booking confirmation and owner alert', async () => {
      await service.handleAppointmentCreated(sampleBusinessId, sampleAppointmentId);

      // Customer confirmation + Owner alert + 24h reminder + 2h reminder
      expect(prismaMock.appointmentNotification.create).toHaveBeenCalledTimes(4);

      // 1. Customer confirmation
      expect(prismaMock.appointmentNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.BOOKING_CONFIRMATION,
            recipientPhone: '+919876500001',
            idempotencyKey: `booking_conf_${sampleAppointmentId}`,
          }),
        }),
      );

      // 2. Owner booking notification
      expect(prismaMock.appointmentNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.OWNER_BOOKING_NOTIFICATION,
            recipientPhone: '+919876543210',
            idempotencyKey: `owner_notif_${sampleAppointmentId}`,
          }),
        }),
      );
    });

    it('should not throw or crash if appointment lookup returns null', async () => {
      prismaMock.appointment.findFirst.mockResolvedValue(null);
      await expect(
        service.handleAppointmentCreated(sampleBusinessId, 'non_existent'),
      ).resolves.not.toThrow();
    });

    it('should skip past reminder slots for near-term appointments (e.g. booked 30 mins before)', async () => {
      const nearTermAppointment = {
        ...sampleAppointment,
        startAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
      };
      prismaMock.appointment.findFirst.mockResolvedValue(nearTermAppointment);

      await service.handleAppointmentCreated(sampleBusinessId, sampleAppointmentId);

      // Should only create customer conf + owner alert; 24h and 2h reminders should be skipped because they are in the past
      expect(prismaMock.appointmentNotification.create).toHaveBeenCalledTimes(2);
    });
  });

  // ==========================================
  // 4. IDEMPOTENCY & DUPLICATE PROTECTION
  // ==========================================
  describe('Idempotency & Duplicate Protection', () => {
    it('should be strictly idempotent on 10 repeated booking event triggers', async () => {
      const createdKeys = new Set<string>();
      prismaMock.appointmentNotification.findUnique.mockImplementation(({ where }) => {
        if (where.idempotencyKey && createdKeys.has(where.idempotencyKey)) {
          return Promise.resolve({ id: 'existing', idempotencyKey: where.idempotencyKey });
        }
        return Promise.resolve(null);
      });

      prismaMock.appointmentNotification.create.mockImplementation(({ data }) => {
        if (data.idempotencyKey) {
          createdKeys.add(data.idempotencyKey);
        }
        return Promise.resolve({ id: `notif_${createdKeys.size}`, ...data });
      });

      // Fire 10 times consecutively
      for (let i = 0; i < 10; i++) {
        await service.handleAppointmentCreated(sampleBusinessId, sampleAppointmentId);
      }

      // Exactly 4 notification records created in total (Customer Conf, Owner Alert, 24h Reminder, 2h Reminder)
      expect(createdKeys.size).toBe(4);
    });
  });

  // ==========================================
  // 5. RESCHEDULE HOOK
  // ==========================================
  describe('Rescheduling Lifecycle Hook', () => {
    it('should cancel existing pending reminders and schedule new reminders with reschedule confirmation', async () => {
      const oldStartAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const newStartAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      const rescheduledAppointment = {
        ...sampleAppointment,
        startAt: newStartAt,
      };
      prismaMock.appointment.findFirst.mockResolvedValue(rescheduledAppointment);

      await service.handleAppointmentRescheduled(
        sampleBusinessId,
        sampleAppointmentId,
        oldStartAt,
        newStartAt,
      );

      // Invalidate existing PENDING reminders
      expect(prismaMock.appointmentNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            appointmentId: sampleAppointmentId,
            type: NotificationType.APPOINTMENT_REMINDER,
            status: NotificationStatus.PENDING,
          }),
          data: expect.objectContaining({
            status: NotificationStatus.CANCELLED,
          }),
        }),
      );

      // Reschedule confirmation created
      expect(prismaMock.appointmentNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.RESCHEDULE_CONFIRMATION,
            recipientPhone: '+919876500001',
          }),
        }),
      );
    });
  });

  // ==========================================
  // 6. CANCELLATION HOOK
  // ==========================================
  describe('Cancellation Lifecycle Hook', () => {
    it('should cancel all pending notifications and send cancellation confirmation', async () => {
      await service.handleAppointmentCancelled(sampleBusinessId, sampleAppointmentId);

      // Invalidate all pending notifications
      expect(prismaMock.appointmentNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            appointmentId: sampleAppointmentId,
            status: NotificationStatus.PENDING,
          }),
          data: expect.objectContaining({
            status: NotificationStatus.CANCELLED,
          }),
        }),
      );

      // Cancellation confirmation created
      expect(prismaMock.appointmentNotification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: NotificationType.CANCELLATION_CONFIRMATION,
            recipientPhone: '+919876500001',
          }),
        }),
      );
    });
  });

  // ==========================================
  // 7. COMPLETION & NO-SHOW HOOKS
  // ==========================================
  describe('Completion & No-Show Lifecycle Hooks', () => {
    it('should cancel pending reminders on completion', async () => {
      await service.handleAppointmentCompleted(sampleBusinessId, sampleAppointmentId);
      expect(prismaMock.appointmentNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            appointmentId: sampleAppointmentId,
            status: NotificationStatus.PENDING,
          }),
          data: expect.objectContaining({
            status: NotificationStatus.CANCELLED,
          }),
        }),
      );
    });

    it('should cancel pending reminders on markNoShow', async () => {
      await service.handleAppointmentNoShow(sampleBusinessId, sampleAppointmentId);
      expect(prismaMock.appointmentNotification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            appointmentId: sampleAppointmentId,
            status: NotificationStatus.PENDING,
          }),
          data: expect.objectContaining({
            status: NotificationStatus.CANCELLED,
          }),
        }),
      );
    });
  });

  // ==========================================
  // 8. CONCURRENCY LOCK & RETRY HANDLING
  // ==========================================
  describe('Scheduler Concurrency & Bounded Retries', () => {
    it('should process exactly 1 message when 10 concurrent workers compete for the same notification', async () => {
      let isClaimed = false;
      prismaMock.appointmentNotification.updateMany.mockImplementation(({ where }) => {
        if (where.status === NotificationStatus.PENDING && !isClaimed) {
          isClaimed = true;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });

      prismaMock.appointmentNotification.findUnique.mockResolvedValue({
        id: 'notif_conc_1',
        businessId: sampleBusinessId,
        recipientPhone: '+919876500001',
        type: NotificationType.APPOINTMENT_REMINDER,
        status: NotificationStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
        business: sampleBusiness,
        appointment: sampleAppointment,
        customer: sampleCustomer,
      });

      // 10 workers simultaneously attempting to dispatch notification 'notif_conc_1'
      const workerPromises = Array.from({ length: 10 }).map(() =>
        service.dispatchNotification('notif_conc_1'),
      );

      const results = await Promise.all(workerPromises);

      const successCount = results.filter((res) => res === true).length;
      expect(successCount).toBe(1);
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledTimes(1);
    });

    it('should retry on provider failure and mark FAILED after max attempts (3)', async () => {
      whatsAppServiceMock.sendTextMessage.mockRejectedValue(
        new Error('Meta API rate limit exceeded'),
      );

      // Attempt 1: attempts = 1 (< max 3) -> should reset to PENDING
      prismaMock.appointmentNotification.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.appointmentNotification.findUnique.mockResolvedValue({
        id: 'notif_fail_1',
        businessId: sampleBusinessId,
        recipientPhone: '+919876500001',
        type: NotificationType.APPOINTMENT_REMINDER,
        status: NotificationStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
        business: sampleBusiness,
        appointment: sampleAppointment,
        customer: sampleCustomer,
      });

      const dispatch1 = await service.dispatchNotification('notif_fail_1');
      expect(dispatch1).toBe(false);
      expect(prismaMock.appointmentNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_fail_1' },
          data: expect.objectContaining({
            status: NotificationStatus.PENDING,
          }),
        }),
      );

      // Attempt 3: attempts = 3 (>= max 3) -> should mark FAILED
      prismaMock.appointmentNotification.findUnique.mockResolvedValue({
        id: 'notif_fail_1',
        businessId: sampleBusinessId,
        recipientPhone: '+919876500001',
        type: NotificationType.APPOINTMENT_REMINDER,
        status: NotificationStatus.PROCESSING,
        attempts: 3,
        maxAttempts: 3,
        business: sampleBusiness,
        appointment: sampleAppointment,
        customer: sampleCustomer,
      });

      const dispatch3 = await service.dispatchNotification('notif_fail_1');
      expect(dispatch3).toBe(false);
      expect(prismaMock.appointmentNotification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif_fail_1' },
          data: expect.objectContaining({
            status: NotificationStatus.FAILED,
            lastError: expect.stringContaining('Max retry attempts reached'),
          }),
        }),
      );
    });
  });

  // ==========================================
  // 9. TENANT ISOLATION
  // ==========================================
  describe('Tenant Isolation', () => {
    it('should strictly isolate notifications by businessId on findAll', async () => {
      await service.findAll(sampleBusinessId, { status: 'SENT' });
      expect(prismaMock.appointmentNotification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: sampleBusinessId,
            status: 'SENT',
          }),
        }),
      );
    });

    it('should throw NotFoundException when accessing notification belonging to another business', async () => {
      prismaMock.appointmentNotification.findFirst.mockResolvedValue(null);
      await expect(
        service.findOne(sampleBusinessId2, 'notif_belonging_to_biz1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
