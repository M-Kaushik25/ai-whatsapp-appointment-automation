import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentsService } from './payments.service';
import {
  PaymentType,
  PaymentStatus,
  PaymentMode,
  PaymentProviderName,
} from './payment.types';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('PaymentsService (Phase 11 Unit & Integration Tests)', () => {
  let service: PaymentsService;
  let prismaMock: any;
  let whatsAppServiceMock: any;
  let appointmentsServiceMock: any;
  let mockProvider: any;
  let razorpayProvider: any;

  const sampleBusinessId = 'biz_pay_100';
  const sampleBusinessId2 = 'biz_pay_200';
  const sampleAppointmentId = 'appt_pay_001';
  const samplePaymentId = 'pay_rec_001';
  const sampleCustomerId = 'cust_pay_001';
  const sampleSecret = 'mock_webhook_secret_key_123';

  const sampleBusiness = {
    id: sampleBusinessId,
    name: 'Elite Salon & Spa',
    slug: 'elite-salon-spa',
    phone: '+919876543210',
    settings: JSON.stringify({ timezone: 'Asia/Kolkata' }),
  };

  const sampleCustomer = {
    id: sampleCustomerId,
    businessId: sampleBusinessId,
    name: 'Rohan Verma',
    phone: '+919876512345',
    status: 'ACTIVE',
  };

  const sampleService = {
    id: 'svc_pay_001',
    businessId: sampleBusinessId,
    name: 'Hair Spa & Styling',
    durationMinutes: 60,
    price: 1500,
    depositType: 'NONE',
    depositValue: 0,
  };

  const sampleAppointment = {
    id: sampleAppointmentId,
    businessId: sampleBusinessId,
    customerId: sampleCustomerId,
    customer: sampleCustomer,
    serviceId: sampleService.id,
    service: sampleService,
    business: sampleBusiness,
    startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    endAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
    status: 'CONFIRMED',
    price: 1500,
    depositAmount: 0,
    paymentStatus: 'UNPAID',
  };

  const defaultPaymentSettings = {
    id: 'pay_sett_001',
    businessId: sampleBusinessId,
    paymentEnabled: true,
    paymentMode: PaymentMode.FIXED_DEPOSIT,
    depositAmount: 300,
    depositPercentage: 20,
    currency: 'INR',
    paymentExpiryMinutes: 30,
    autoCancelUnpaidAppointments: false,
    provider: PaymentProviderName.MOCK,
    webhookSecret: sampleSecret,
    keyId: 'key_123',
    keySecret: 'sec_123',
  };

  beforeEach(() => {
    let storedPayment: any = null;
    prismaMock = {
      businessPaymentSettings: {
        findUnique: vi.fn().mockResolvedValue(defaultPaymentSettings),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pay_sett_new', ...data })),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...defaultPaymentSettings, ...data })),
      },
      appointment: {
        findFirst: vi.fn().mockResolvedValue(sampleAppointment),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...sampleAppointment, ...data })),
      },
      payment: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(storedPayment)),
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(storedPayment)),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => {
          storedPayment = { id: samplePaymentId, ...data };
          return Promise.resolve(storedPayment);
        }),
        update: vi.fn().mockImplementation(({ where, data }) => {
          storedPayment = { ...(storedPayment || {}), id: where.id, ...data };
          return Promise.resolve(storedPayment);
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    whatsAppServiceMock = {
      sendTextMessage: vi.fn().mockResolvedValue({
        id: 'msg_001',
        whatsappMessageId: 'wamid_pay_123',
        status: 'SENT',
      }),
    };

    appointmentsServiceMock = {
      cancel: vi.fn().mockResolvedValue({ ...sampleAppointment, status: 'CANCELLED' }),
    };

    mockProvider = {
      createOrder: vi.fn().mockImplementation(async (opts) => ({
        providerOrderId: `order_mock_${opts.paymentId}`,
        paymentLink: `https://pay.mockgateway.com/order/${opts.paymentId}`,
        provider: 'MOCK',
      })),
      verifyWebhook: vi.fn().mockImplementation(async (rawBody, signature, secret) => {
        const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
        const expected = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
        if (signature !== expected) {
          return { isValid: false };
        }
        const parsed = JSON.parse(bodyStr);
        return {
          isValid: true,
          event: parsed.event || 'payment.captured',
          providerOrderId: parsed.order_id || 'order_mock_001',
          providerPaymentId: 'pay_mock_confirmed_123',
          amount: 300,
          currency: 'INR',
        };
      }),
      refund: vi.fn().mockResolvedValue({
        refundId: 'rfnd_mock_123',
        status: 'processed',
        amount: 300,
        currency: 'INR',
      }),
    };

    razorpayProvider = {
      createOrder: vi.fn(),
      verifyWebhook: vi.fn(),
      refund: vi.fn(),
    };

    service = new PaymentsService(
      prismaMock,
      whatsAppServiceMock,
      appointmentsServiceMock,
      mockProvider,
      razorpayProvider,
    );
  });

  // =========================================================================
  // A. PAYMENT SETTINGS & VALIDATION
  // =========================================================================
  describe('A. Payment Settings & Validation', () => {
    it('should retrieve existing or create default settings', async () => {
      const settings = await service.getOrCreateSettings(sampleBusinessId);
      expect(settings).toBeDefined();
      expect(settings.paymentMode).toBe(PaymentMode.FIXED_DEPOSIT);
    });

    it('should update settings and mask sensitive secret keys', async () => {
      const updated = await service.updateSettings(sampleBusinessId, {
        paymentMode: PaymentMode.PERCENTAGE_DEPOSIT,
        depositPercentage: 25,
        webhookSecret: 'super_secret_webhook_key',
      });

      expect(updated.paymentMode).toBe(PaymentMode.PERCENTAGE_DEPOSIT);
      expect(updated.depositPercentage).toBe(25);
      expect(updated.webhookSecret).toContain('••••••••');
    });

    it('should reject invalid percentage (> 100 or < 0)', async () => {
      await expect(
        service.updateSettings(sampleBusinessId, { depositPercentage: 150 })
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateSettings(sampleBusinessId, { depositPercentage: -10 })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid deposit amount (< 0)', async () => {
      await expect(
        service.updateSettings(sampleBusinessId, { depositAmount: -50 })
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // B. SERVER-AUTHORITATIVE AMOUNT CALCULATION
  // =========================================================================
  describe('B. Amount Calculation', () => {
    it('should calculate fixed deposit amount accurately', async () => {
      const calc = await service.calculateRequiredPayment(sampleBusinessId, sampleAppointmentId);

      expect(calc.required).toBe(true);
      expect(calc.amount).toBe(300);
      expect(calc.type).toBe(PaymentType.DEPOSIT);
    });

    it('should calculate percentage deposit amount accurately', async () => {
      prismaMock.businessPaymentSettings.findUnique.mockResolvedValueOnce({
        ...defaultPaymentSettings,
        paymentMode: PaymentMode.PERCENTAGE_DEPOSIT,
        depositPercentage: 20, // 20% of 1500 = 300
      });

      const calc = await service.calculateRequiredPayment(sampleBusinessId, sampleAppointmentId);

      expect(calc.required).toBe(true);
      expect(calc.amount).toBe(300);
      expect(calc.type).toBe(PaymentType.DEPOSIT);
    });

    it('should calculate full payment amount accurately', async () => {
      prismaMock.businessPaymentSettings.findUnique.mockResolvedValueOnce({
        ...defaultPaymentSettings,
        paymentMode: PaymentMode.FULL_PAYMENT,
      });

      const calc = await service.calculateRequiredPayment(sampleBusinessId, sampleAppointmentId);

      expect(calc.required).toBe(true);
      expect(calc.amount).toBe(1500);
      expect(calc.type).toBe(PaymentType.FULL_PAYMENT);
    });

    it('should return required: false if paymentMode is NONE or paymentEnabled is false', async () => {
      prismaMock.businessPaymentSettings.findUnique.mockResolvedValueOnce({
        ...defaultPaymentSettings,
        paymentEnabled: false,
      });

      const calc = await service.calculateRequiredPayment(sampleBusinessId, sampleAppointmentId);
      expect(calc.required).toBe(false);
      expect(calc.amount).toBe(0);
    });

    it('should cap fixed deposit amount at the appointment price', async () => {
      prismaMock.businessPaymentSettings.findUnique.mockResolvedValueOnce({
        ...defaultPaymentSettings,
        paymentMode: PaymentMode.FIXED_DEPOSIT,
        depositAmount: 5000, // exceeds price of 1500
      });

      const calc = await service.calculateRequiredPayment(sampleBusinessId, sampleAppointmentId);
      expect(calc.amount).toBe(1500);
    });
  });

  // =========================================================================
  // C. PAYMENT ORDER & LINK CREATION
  // =========================================================================
  describe('C. Payment Creation', () => {
    it('should create payment order and return payment link for appointment', async () => {
      const payment = await service.createPaymentForAppointment(sampleBusinessId, sampleAppointmentId);

      expect(payment).toBeDefined();
      expect(payment?.amount).toBe(300);
      expect(payment?.paymentLink).toContain('https://pay.mockgateway.com');
      expect(prismaMock.payment.create).toHaveBeenCalled();
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: sampleAppointmentId },
        data: { depositAmount: 300 },
      });
    });

    it('should reject payment creation for CANCELLED appointment', async () => {
      prismaMock.appointment.findFirst.mockResolvedValueOnce({
        ...sampleAppointment,
        status: 'CANCELLED',
      });

      await expect(
        service.createPaymentForAppointment(sampleBusinessId, sampleAppointmentId)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reuse active non-expired payment instead of creating duplicate records', async () => {
      const existing = {
        id: 'pay_existing_001',
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        status: PaymentStatus.INITIATED,
        amount: 300,
        providerOrderId: 'order_mock_existing',
        paymentLink: 'https://pay.mockgateway.com/order/existing',
        expiresAt: new Date(Date.now() + 20 * 60 * 1000), // 20 mins left
      };
      prismaMock.payment.findFirst.mockResolvedValueOnce(existing);

      const payment = await service.createPaymentForAppointment(sampleBusinessId, sampleAppointmentId);

      expect(payment?.id).toBe('pay_existing_001');
      expect(prismaMock.payment.create).not.toHaveBeenCalled();
    });

    it('should reject payment creation if appointment is already PAID', async () => {
      const existingPaid = {
        id: 'pay_paid_001',
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        status: PaymentStatus.PAID,
      };
      prismaMock.payment.findFirst.mockResolvedValueOnce(existingPaid);

      await expect(
        service.createPaymentForAppointment(sampleBusinessId, sampleAppointmentId)
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // D. WEBHOOK CRYPTOGRAPHIC SIGNATURE & IDEMPOTENCY
  // =========================================================================
  describe('D. Webhook Security & Idempotency', () => {
    it('should process webhook with valid HMAC signature and transition status to PAID', async () => {
      const payload = {
        event: 'payment.captured',
        order_id: 'order_mock_pay_rec_001',
      };
      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', sampleSecret).update(rawBody).digest('hex');

      const paymentRecord = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        amount: 300,
        type: PaymentType.DEPOSIT,
        status: PaymentStatus.INITIATED,
        provider: 'MOCK',
        business: {
          ...sampleBusiness,
          paymentSettings: defaultPaymentSettings,
        },
        appointment: sampleAppointment,
      };

      prismaMock.payment.findFirst.mockResolvedValue(paymentRecord);
      prismaMock.payment.findUnique.mockResolvedValue(paymentRecord);

      const result = await service.handleWebhook(rawBody, signature);

      expect(result.processed).toBe(true);
      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: samplePaymentId },
        data: expect.objectContaining({
          status: PaymentStatus.PAID,
          providerPaymentId: 'pay_mock_confirmed_123',
        }),
      });
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: sampleAppointmentId },
        data: {
          paymentStatus: 'PARTIALLY_PAID',
          depositAmount: 300,
        },
      });
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledWith(
        sampleBusinessId,
        expect.objectContaining({
          recipientPhone: '+919876512345',
          text: expect.stringContaining('Payment Received!'),
        })
      );
    });

    it('should reject webhook with invalid signature with UnauthorizedException', async () => {
      const payload = { event: 'payment.captured', order_id: 'order_mock_001' };
      const rawBody = JSON.stringify(payload);
      const invalidSignature = 'invalid_spoofed_signature';

      const paymentRecord = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        amount: 300,
        status: PaymentStatus.INITIATED,
        provider: 'MOCK',
        business: {
          ...sampleBusiness,
          paymentSettings: defaultPaymentSettings,
        },
        appointment: sampleAppointment,
      };

      prismaMock.payment.findFirst.mockResolvedValue(paymentRecord);

      await expect(
        service.handleWebhook(rawBody, invalidSignature)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should be strictly idempotent: 10 duplicate webhooks result in 1 state change and 1 notification', async () => {
      const payload = {
        event: 'payment.captured',
        order_id: 'order_mock_pay_rec_001',
      };
      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', sampleSecret).update(rawBody).digest('hex');

      let isPaid = false;
      const paymentRecord = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        amount: 300,
        type: PaymentType.DEPOSIT,
        status: PaymentStatus.INITIATED,
        provider: 'MOCK',
        business: {
          ...sampleBusiness,
          paymentSettings: defaultPaymentSettings,
        },
        appointment: sampleAppointment,
      };

      prismaMock.payment.findFirst.mockResolvedValue(paymentRecord);
      prismaMock.payment.findUnique.mockImplementation(() => {
        return Promise.resolve({
          ...paymentRecord,
          status: isPaid ? PaymentStatus.PAID : PaymentStatus.INITIATED,
        });
      });
      prismaMock.payment.update.mockImplementation(({ data }) => {
        if (data.status === PaymentStatus.PAID) {
          isPaid = true;
        }
        return Promise.resolve({ ...paymentRecord, ...data });
      });

      // Send 10 identical duplicate webhooks sequentially
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await service.handleWebhook(rawBody, signature));
      }

      // First webhook processes; remaining 9 detect duplicate status
      expect(results[0].processed).toBe(true);
      expect(results.filter((r) => r.duplicate === true).length).toBe(9);

      // Exactly 1 database update to PAID & exactly 1 WhatsApp message
      expect(prismaMock.payment.update).toHaveBeenCalledTimes(1);
      expect(whatsAppServiceMock.sendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // E. STATE MACHINE ENFORCEMENT
  // =========================================================================
  describe('E. State Machine Transitions', () => {
    it('should reject invalid transition from PAID to FAILED', async () => {
      const payload = { event: 'payment.failed', order_id: 'order_mock_001' };
      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', sampleSecret).update(rawBody).digest('hex');

      const paidPayment = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        amount: 300,
        status: PaymentStatus.PAID,
        provider: 'MOCK',
        business: {
          ...sampleBusiness,
          paymentSettings: defaultPaymentSettings,
        },
        appointment: sampleAppointment,
      };

      prismaMock.payment.findFirst.mockResolvedValue(paidPayment);
      prismaMock.payment.findUnique.mockResolvedValue(paidPayment);

      const result = await service.handleWebhook(rawBody, signature);
      expect(result.duplicate).toBe(true);
      expect(prismaMock.payment.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // F. CANCELLATION & RESCHEDULING INTEGRATION
  // =========================================================================
  describe('F. Cancellation & Rescheduling Integration', () => {
    it('should cancel active PENDING and INITIATED payments when appointment is cancelled', async () => {
      prismaMock.payment.findMany.mockResolvedValueOnce([
        { id: 'pay_active_1', status: PaymentStatus.INITIATED },
      ]);

      await service.handleAppointmentCancelled(sampleBusinessId, sampleAppointmentId);

      expect(prismaMock.payment.updateMany).toHaveBeenCalledWith({
        where: {
          businessId: sampleBusinessId,
          appointmentId: sampleAppointmentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIATED] },
        },
        data: expect.objectContaining({
          status: PaymentStatus.CANCELLED,
        }),
      });
    });
  });

  // =========================================================================
  // G. REFUND PROCESSING
  // =========================================================================
  describe('G. Refund Processing', () => {
    it('should process full refund on a PAID payment', async () => {
      const paidPayment = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        amount: 300,
        currency: 'INR',
        status: PaymentStatus.PAID,
        provider: 'MOCK',
        providerPaymentId: 'pay_mock_123',
        business: {
          ...sampleBusiness,
          paymentSettings: defaultPaymentSettings,
        },
      };

      prismaMock.payment.findFirst.mockResolvedValueOnce(paidPayment);

      const refunded = await service.refundPayment(sampleBusinessId, samplePaymentId, {
        amount: 300,
        reason: 'Customer requested cancellation',
      });

      expect(mockProvider.refund).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: samplePaymentId,
          amount: 300,
        }),
        expect.anything()
      );
      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: samplePaymentId },
        data: expect.objectContaining({
          status: PaymentStatus.REFUNDED,
        }),
      });
      expect(prismaMock.appointment.update).toHaveBeenCalledWith({
        where: { id: sampleAppointmentId },
        data: { paymentStatus: 'UNPAID', depositAmount: 0 },
      });
    });

    it('should reject refund if payment status is not PAID', async () => {
      const pendingPayment = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        status: PaymentStatus.INITIATED,
        amount: 300,
      };

      prismaMock.payment.findFirst.mockResolvedValueOnce(pendingPayment);

      await expect(
        service.refundPayment(sampleBusinessId, samplePaymentId, { amount: 300 })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject refund amount exceeding paid amount', async () => {
      const paidPayment = {
        id: samplePaymentId,
        businessId: sampleBusinessId,
        status: PaymentStatus.PAID,
        amount: 300,
      };

      prismaMock.payment.findFirst.mockResolvedValueOnce(paidPayment);

      await expect(
        service.refundPayment(sampleBusinessId, samplePaymentId, { amount: 500 })
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // H. EXPIRATION & AUTO-CANCELLATION
  // =========================================================================
  describe('H. Expiration & Auto-Cancellation', () => {
    it('should expire past-due initiated payments and auto-cancel appointment if enabled', async () => {
      const expiredPayment = {
        id: 'pay_exp_001',
        businessId: sampleBusinessId,
        appointmentId: sampleAppointmentId,
        status: PaymentStatus.INITIATED,
        expiresAt: new Date(Date.now() - 5 * 60 * 1000), // expired 5 mins ago
        business: {
          paymentSettings: {
            autoCancelUnpaidAppointments: true,
          },
        },
      };

      prismaMock.payment.findMany.mockResolvedValueOnce([expiredPayment]);

      const count = await service.processExpiredPayments();

      expect(count).toBe(1);
      expect(prismaMock.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay_exp_001' },
        data: expect.objectContaining({
          status: PaymentStatus.EXPIRED,
        }),
      });
      expect(appointmentsServiceMock.cancel).toHaveBeenCalledWith(
        sampleBusinessId,
        sampleAppointmentId
      );
    });
  });

  // =========================================================================
  // I. MULTI-TENANT ISOLATION
  // =========================================================================
  describe('I. Multi-Tenant Isolation', () => {
    it('should strictly query payments for the authenticated business context', async () => {
      await service.findAll(sampleBusinessId, { status: 'PAID' });

      expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            businessId: sampleBusinessId,
            status: 'PAID',
          }),
        })
      );
    });

    it('should throw NotFoundException if Business A tries to access Business B payment', async () => {
      prismaMock.payment.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne(sampleBusinessId, 'pay_from_other_business')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // =========================================================================
  // J. CONCURRENCY PROTECTION (2, 5, 10 WORKERS)
  // =========================================================================
  describe('J. Concurrency Protection', () => {
    it('should handle 10 concurrent payment creation requests safely without conflicting records', async () => {
      const promises = Array.from({ length: 10 }).map(() =>
        service.createPaymentForAppointment(sampleBusinessId, sampleAppointmentId)
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(10);
      results.forEach((r) => {
        expect(r).toBeDefined();
        expect(r?.amount).toBe(300);
      });
    });
  });
});
