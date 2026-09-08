import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RetentionService,
} from './retention.service';
import {
  FollowUpType,
  FollowUpStatus,
  FollowUpSkipReason,
} from './retention.types';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('RetentionService (Phase 10 Unit & Integration Tests)', () => {
  let service: RetentionService;
  let prismaMock: any;
  let whatsAppServiceMock: any;

  const sampleBusinessId = 'biz_retention_100';
  const sampleBusinessId2 = 'biz_retention_200';
  const sampleAppointmentId = 'appt_completed_001';

  const sampleBusiness = {
    id: sampleBusinessId,
    name: 'Royal Hair Studio',
    slug: 'royal-hair-studio',
    phone: '+919876543210',
    settings: JSON.stringify({ timezone: 'Asia/Kolkata' }),
  };

  const sampleCustomer = {
    id: 'cust_101',
    businessId: sampleBusinessId,
    name: 'Rahul Sharma',
    phone: '+919876511111',
    status: 'ACTIVE',
  };

  const sampleService = {
    id: 'svc_101',
    businessId: sampleBusinessId,
    name: 'Deluxe Haircut',
    durationMinutes: 30,
    price: 600,
  };

  const sampleStaff = {
    id: 'staff_101',
    businessId: sampleBusinessId,
    name: 'Master Barber Vikram',
  };

  const completedAppointment = {
    id: sampleAppointmentId,
    businessId: sampleBusinessId,
    customerId: sampleCustomer.id,
    customer: sampleCustomer,
    staffId: sampleStaff.id,
    staff: sampleStaff,
    serviceId: sampleService.id,
    service: sampleService,
    business: sampleBusiness,
    startAt: new Date('2026-08-01T10:00:00.000Z'),
    endAt: new Date('2026-08-01T10:30:00.000Z'),
    status: 'COMPLETED',
    price: 600,
  };

  const defaultRetentionSettings = {
    id: 'ret_sett_001',
    businessId: sampleBusinessId,
    rebookingFollowUpEnabled: true,
    rebookingFollowUpDays: 30,
  };

  beforeEach(() => {
    prismaMock = {
      businessRetentionSettings: {
        findUnique: vi.fn().mockResolvedValue(defaultRetentionSettings),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ret_sett_new', ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...defaultRetentionSettings, ...data })),
      },
      appointment: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where?.id === sampleAppointmentId || (where?.businessId && !where?.startAt?.gt)) {
            return Promise.resolve(completedAppointment);
          }
          return Promise.resolve(null);
        }),
        findMany: vi.fn().mockResolvedValue([completedAppointment]),
        count: vi.fn().mockResolvedValue(1),
      },
      customerFollowUp: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'followup_1', ...data })),
        update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    whatsAppServiceMock = {
      sendTextMessage: vi.fn().mockResolvedValue({
        id: 'msg_001',
        whatsappMessageId: 'wamid_retention_123',
        status: 'SENT',
      }),
    };

    service = new RetentionService(prismaMock, whatsAppServiceMock);
  });

  // =========================================================================
  // A. FOLLOW-UP CREATION & TIMEZONE HANDLING
  // =========================================================================
  describe('A. Follow-Up Creation', () => {
    it('should create a PENDING follow-up when an appointment is completed and retention is enabled', async () => {
      const created = await service.handleAppointmentCompleted(sampleBusinessId, sampleAppointmentId);

      expect(created).toBeDefined();
      expect(prismaMock.customerFollowUp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: sampleBusinessId,
          customerId: sampleCustomer.id,
          sourceAppointmentId: sampleAppointmentId,
          type: FollowUpType.REBOOKING,
          status: FollowUpStatus.PENDING,
          idempotencyKey: `rebooking_${sampleAppointmentId}`,
        }),
      });

      // Scheduled 30 days after completed appointment endAt
      const expectedScheduled = new Date(completedAppointment.endAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(created?.scheduledAt.getTime()).toBe(expectedScheduled.getTime());
    });

    it('should not create a follow-up if appointment status is not COMPLETED (e.g. CANCELLED)', async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        ...completedAppointment,
        status: 'CANCELLED',
      });

      const result = await service.handleAppointmentCompleted(sampleBusinessId, sampleAppointmentId);
      expect(result).toBeUndefined();
      expect(prismaMock.customerFollowUp.create).not.toHaveBeenCalled();
    });

    it('should not create a follow-up if retention follow-ups are disabled for the business', async () => {
      prismaMock.businessRetentionSettings.findUnique.mockResolvedValueOnce({
        ...defaultRetentionSettings,
        rebookingFollowUpEnabled: false,
      });

      const result = await service.handleAppointmentCompleted(sampleBusinessId, sampleAppointmentId);
      expect(result).toBeUndefined();
      expect(prismaMock.customerFollowUp.create).not.toHaveBeenCalled();
    });

    it('should calculate scheduledAt using custom configured days (e.g. 14 days)', async () => {
      prismaMock.businessRetentionSettings.findUnique.mockResolvedValueOnce({
        ...defaultRetentionSettings,
        rebookingFollowUpDays: 14,
      });

      const created = await service.handleAppointmentCompleted(sampleBusinessId, sampleAppointmentId);
      const expectedScheduled = new Date(completedAppointment.endAt.getTime() + 14 * 24 * 60 * 60 * 1000);
      expect(created?.scheduledAt.getTime()).toBe(expectedScheduled.getTime());
    });
  });

  // =========================================================================
  // B. ELIGIBILITY & PRE-FLIGHT VALIDATIONS
  // =========================================================================
  describe('B. Eligibility & Pre-Flight Validations', () => {
    it('should skip follow-up if customer is INACTIVE', async () => {
      const followUpRecord = {
        id: 'fu_inactive_001',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: { ...sampleCustomer, status: 'INACTIVE' },
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      prismaMock.customerFollowUp.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce(followUpRecord);

      const dispatched = await service.dispatchFollowUp('fu_inactive_001');

      expect(dispatched).toBe(false);
      expect(whatsAppServiceMock.sendTextMessage).not.toHaveBeenCalled();
      expect(prismaMock.customerFollowUp.update).toHaveBeenCalledWith({
        where: { id: 'fu_inactive_001' },
        data: expect.objectContaining({
          status: FollowUpStatus.SKIPPED,
          skipReason: FollowUpSkipReason.CUSTOMER_INACTIVE,
        }),
      });
    });

    it('should skip follow-up if customer phone is invalid or missing', async () => {
      const followUpRecord = {
        id: 'fu_nophone_001',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: { ...sampleCustomer, phone: 'invalid-phone' },
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      prismaMock.customerFollowUp.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce(followUpRecord);

      const dispatched = await service.dispatchFollowUp('fu_nophone_001');

      expect(dispatched).toBe(false);
      expect(whatsAppServiceMock.sendTextMessage).not.toHaveBeenCalled();
      expect(prismaMock.customerFollowUp.update).toHaveBeenCalledWith({
        where: { id: 'fu_nophone_001' },
        data: expect.objectContaining({
          status: FollowUpStatus.SKIPPED,
          skipReason: FollowUpSkipReason.NO_WHATSAPP,
        }),
      });
    });

    it('should skip follow-up if customer booked a newer appointment before follow-up dispatch', async () => {
      const followUpRecord = {
        id: 'fu_rebooked_001',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      prismaMock.customerFollowUp.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce(followUpRecord);
      // Mock that customer booked another appointment on August 20
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        id: 'appt_new_002',
        startAt: new Date('2026-08-20T10:00:00.000Z'),
        status: 'CONFIRMED',
      });

      const dispatched = await service.dispatchFollowUp('fu_rebooked_001');

      expect(dispatched).toBe(false);
      expect(whatsAppServiceMock.sendTextMessage).not.toHaveBeenCalled();
      expect(prismaMock.customerFollowUp.update).toHaveBeenCalledWith({
        where: { id: 'fu_rebooked_001' },
        data: expect.objectContaining({
          status: FollowUpStatus.SKIPPED,
          skipReason: FollowUpSkipReason.CUSTOMER_REBOOKED,
        }),
      });
    });
  });

  // =========================================================================
  // C. IDEMPOTENCY & REBOOKING SUPPRESSION
  // =========================================================================
  describe('C. Idempotency & Rebooking Suppression', () => {
    it('should prevent duplicate follow-up creation when appointment completion is called multiple times', async () => {
      // Mock existing follow-up
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce({
        id: 'existing_followup_1',
        idempotencyKey: `rebooking_${sampleAppointmentId}`,
      });

      const result = await service.handleAppointmentCompleted(sampleBusinessId, sampleAppointmentId);

      expect(result).toBeUndefined();
      expect(prismaMock.customerFollowUp.create).not.toHaveBeenCalled();
    });

    it('should immediately mark pending follow-ups as SKIPPED when customer rebooks a new appointment', async () => {
      prismaMock.customerFollowUp.findMany.mockResolvedValueOnce([
        { id: 'pending_fu_1' },
        { id: 'pending_fu_2' },
      ]);

      const newBookingDate = new Date('2026-08-15T10:00:00.000Z');
      await service.handleCustomerRebooked(sampleBusinessId, sampleCustomer.id, newBookingDate);

      expect(prismaMock.customerFollowUp.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['pending_fu_1', 'pending_fu_2'] },
          status: FollowUpStatus.PENDING,
        },
        data: expect.objectContaining({
          status: FollowUpStatus.SKIPPED,
          skipReason: FollowUpSkipReason.CUSTOMER_REBOOKED,
        }),
      });
    });
  });

  // =========================================================================
  // D. CONCURRENCY PROTECTION (2, 5, 10 WORKERS)
  // =========================================================================
  describe('D. Concurrency Protection', () => {
    it('should allow exactly 1 send when 2 concurrent workers attempt to dispatch the same follow-up', async () => {
      const followUpRecord = {
        id: 'fu_concurrent_2',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      let claimed = false;
      prismaMock.customerFollowUp.updateMany.mockImplementation(() => {
        if (!claimed) {
          claimed = true;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });
      prismaMock.customerFollowUp.findUnique.mockResolvedValue(followUpRecord);
      prismaMock.appointment.findFirst.mockResolvedValue(null);

      const results = await Promise.all([
        service.dispatchFollowUp('fu_concurrent_2'),
        service.dispatchFollowUp('fu_concurrent_2'),
      ]);

      const successfulDispatches = results.filter((r) => r === true);
      expect(successfulDispatches.length).toBe(1);
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledTimes(1);
    });

    it('should allow exactly 1 send when 5 concurrent workers attempt to dispatch the same follow-up', async () => {
      const followUpRecord = {
        id: 'fu_concurrent_5',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      let claimed = false;
      prismaMock.customerFollowUp.updateMany.mockImplementation(() => {
        if (!claimed) {
          claimed = true;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });
      prismaMock.customerFollowUp.findUnique.mockResolvedValue(followUpRecord);
      prismaMock.appointment.findFirst.mockResolvedValue(null);

      const results = await Promise.all([
        service.dispatchFollowUp('fu_concurrent_5'),
        service.dispatchFollowUp('fu_concurrent_5'),
        service.dispatchFollowUp('fu_concurrent_5'),
        service.dispatchFollowUp('fu_concurrent_5'),
        service.dispatchFollowUp('fu_concurrent_5'),
      ]);

      const successfulDispatches = results.filter((r) => r === true);
      expect(successfulDispatches.length).toBe(1);
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledTimes(1);
    });

    it('should allow exactly 1 send when 10 concurrent workers attempt to dispatch the same follow-up', async () => {
      const followUpRecord = {
        id: 'fu_concurrent_10',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      let claimed = false;
      prismaMock.customerFollowUp.updateMany.mockImplementation(() => {
        if (!claimed) {
          claimed = true;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });
      prismaMock.customerFollowUp.findUnique.mockResolvedValue(followUpRecord);
      prismaMock.appointment.findFirst.mockResolvedValue(null);

      const promises = Array.from({ length: 10 }).map(() =>
        service.dispatchFollowUp('fu_concurrent_10')
      );
      const results = await Promise.all(promises);

      const successfulDispatches = results.filter((r) => r === true);
      expect(successfulDispatches.length).toBe(1);
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // E. RETRY MECHANISM & BOUNDED RETRIES
  // =========================================================================
  describe('E. Retry Mechanism', () => {
    it('should reset status to PENDING for retry when provider fails on attempt 1', async () => {
      const followUpRecord = {
        id: 'fu_fail_1',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      prismaMock.customerFollowUp.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce(followUpRecord);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      whatsAppServiceMock.sendTextMessage.mockRejectedValueOnce(new Error('Meta API 503 Server Busy'));

      const dispatched = await service.dispatchFollowUp('fu_fail_1');

      expect(dispatched).toBe(false);
      expect(prismaMock.customerFollowUp.update).toHaveBeenCalledWith({
        where: { id: 'fu_fail_1' },
        data: expect.objectContaining({
          status: FollowUpStatus.PENDING,
          lastError: expect.stringContaining('Attempt 1 failed: Meta API 503 Server Busy'),
        }),
      });
    });

    it('should transition status to FAILED when max retry attempts (3) are exhausted', async () => {
      const followUpRecord = {
        id: 'fu_fail_3',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 3, // 3rd attempt
        maxAttempts: 3,
      };

      prismaMock.customerFollowUp.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce(followUpRecord);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);
      whatsAppServiceMock.sendTextMessage.mockRejectedValueOnce(new Error('Meta API Connection Timeout'));

      const dispatched = await service.dispatchFollowUp('fu_fail_3');

      expect(dispatched).toBe(false);
      expect(prismaMock.customerFollowUp.update).toHaveBeenCalledWith({
        where: { id: 'fu_fail_3' },
        data: expect.objectContaining({
          status: FollowUpStatus.FAILED,
          lastError: expect.stringContaining('Max retry attempts reached (3)'),
        }),
      });
    });
  });

  // =========================================================================
  // F. WHATSAPP MESSAGE CONTENT & SENDER
  // =========================================================================
  describe('F. WhatsApp Message Content', () => {
    it('should format message with real customer name, business name and BOOK prompt', async () => {
      const followUpRecord = {
        id: 'fu_msg_content',
        businessId: sampleBusinessId,
        customerId: sampleCustomer.id,
        customer: sampleCustomer,
        sourceAppointment: completedAppointment,
        business: { ...sampleBusiness, retentionSettings: defaultRetentionSettings },
        status: FollowUpStatus.PROCESSING,
        attempts: 1,
        maxAttempts: 3,
      };

      prismaMock.customerFollowUp.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaMock.customerFollowUp.findUnique.mockResolvedValueOnce(followUpRecord);
      prismaMock.appointment.findFirst.mockResolvedValueOnce(null);

      const dispatched = await service.dispatchFollowUp('fu_msg_content');

      expect(dispatched).toBe(true);
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledWith(
        sampleBusinessId,
        expect.objectContaining({
          recipientPhone: '+919876511111',
          text: expect.stringContaining('Hi Rahul Sharma 👋'),
        })
      );
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledWith(
        sampleBusinessId,
        expect.objectContaining({
          text: expect.stringContaining('Royal Hair Studio'),
        })
      );
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledWith(
        sampleBusinessId,
        expect.objectContaining({
          text: expect.stringContaining('Reply BOOK to get started.'),
        })
      );
    });
  });

  // =========================================================================
  // G. MULTI-TENANT ISOLATION
  // =========================================================================
  describe('G. Multi-Tenant Isolation', () => {
    it('should strictly query follow-ups for the authenticated business context', async () => {
      await service.findAll(sampleBusinessId, { status: 'PENDING' });

      expect(prismaMock.customerFollowUp.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: sampleBusinessId,
            status: 'PENDING',
          }),
        })
      );
    });

    it('should throw NotFoundException if Business A tries to fetch Business B follow-up', async () => {
      prismaMock.customerFollowUp.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne(sampleBusinessId, 'fu_from_other_biz')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should reject invalid follow-up days (<= 0)', async () => {
      await expect(
        service.updateSettings(sampleBusinessId, { rebookingFollowUpDays: 0 })
      ).rejects.toThrow(BadRequestException);
    });
  });
});
