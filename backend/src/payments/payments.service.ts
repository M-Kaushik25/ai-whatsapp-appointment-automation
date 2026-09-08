import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { RazorpayPaymentProvider } from './providers/razorpay-payment.provider';
import { IPaymentProvider } from './payment-provider.interface';
import {
  PaymentType,
  PaymentStatus,
  PaymentMode,
  PaymentProviderName,
} from './payment.types';
import {
  UpdatePaymentSettingsDto,
  PaymentFiltersDto,
  RefundPaymentDto,
} from './dto/payment.dto';

// In-memory mutex maps to serialize concurrent payments and webhooks
const appointmentPaymentLocks = new Map<string, Promise<void>>();
const paymentRecordLocks = new Map<string, Promise<void>>();

async function acquireLock(map: Map<string, Promise<void>>, key: string): Promise<() => void> {
  while (map.has(key)) {
    await map.get(key);
  }
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    release = () => {
      map.delete(key);
      resolve();
    };
  });
  map.set(key, lockPromise);
  return release;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
    private readonly mockProvider: MockPaymentProvider,
    private readonly razorpayProvider: RazorpayPaymentProvider,
  ) {}

  private getProvider(providerName: string): IPaymentProvider {
    if (providerName === PaymentProviderName.RAZORPAY) {
      return this.razorpayProvider;
    }
    return this.mockProvider;
  }

  /**
   * Get or create business payment settings
   */
  async getOrCreateSettings(businessId: string) {
    let settings = await this.prisma.businessPaymentSettings.findUnique({
      where: { businessId },
    });

    if (!settings) {
      settings = await this.prisma.businessPaymentSettings.create({
        data: {
          businessId,
          paymentEnabled: false,
          paymentMode: PaymentMode.NONE,
          depositAmount: 0,
          depositPercentage: 0,
          currency: 'INR',
          paymentExpiryMinutes: 30,
          autoCancelUnpaidAppointments: false,
          provider: PaymentProviderName.MOCK,
        },
      });
    }

    return settings;
  }

  /**
   * Update payment settings for a business (Tenant-Isolated, masks secret keys)
   */
  async updateSettings(businessId: string, dto: UpdatePaymentSettingsDto) {
    await this.getOrCreateSettings(businessId);

    if (dto.paymentMode && !Object.values(PaymentMode).includes(dto.paymentMode as PaymentMode)) {
      throw new BadRequestException(`Invalid payment mode: ${dto.paymentMode}`);
    }

    if (dto.depositAmount !== undefined && dto.depositAmount < 0) {
      throw new BadRequestException('Deposit amount must be greater than or equal to 0');
    }

    if (dto.depositPercentage !== undefined && (dto.depositPercentage < 0 || dto.depositPercentage > 100)) {
      throw new BadRequestException('Deposit percentage must be between 0 and 100');
    }

    if (dto.paymentExpiryMinutes !== undefined && dto.paymentExpiryMinutes <= 0) {
      throw new BadRequestException('Payment expiry minutes must be greater than 0');
    }

    const updated = await this.prisma.businessPaymentSettings.update({
      where: { businessId },
      data: {
        ...(dto.paymentEnabled !== undefined && { paymentEnabled: dto.paymentEnabled }),
        ...(dto.paymentMode !== undefined && { paymentMode: dto.paymentMode }),
        ...(dto.depositAmount !== undefined && { depositAmount: dto.depositAmount }),
        ...(dto.depositPercentage !== undefined && { depositPercentage: dto.depositPercentage }),
        ...(dto.currency !== undefined && { currency: dto.currency.toUpperCase() }),
        ...(dto.paymentExpiryMinutes !== undefined && { paymentExpiryMinutes: dto.paymentExpiryMinutes }),
        ...(dto.autoCancelUnpaidAppointments !== undefined && { autoCancelUnpaidAppointments: dto.autoCancelUnpaidAppointments }),
        ...(dto.provider !== undefined && { provider: dto.provider.toUpperCase() }),
        ...(dto.keyId !== undefined && { keyId: dto.keyId }),
        ...(dto.keySecret !== undefined && { keySecret: dto.keySecret }),
        ...(dto.webhookSecret !== undefined && { webhookSecret: dto.webhookSecret }),
      },
    });

    this.logger.log(`Updated payment settings for business ${businessId} (Mode: ${updated.paymentMode})`);
    return this.maskSettings(updated);
  }

  /**
   * Mask sensitive keys in settings object before sending to client
   */
  maskSettings(settings: any) {
    return {
      ...settings,
      keySecret: settings.keySecret ? '••••••••' + settings.keySecret.slice(-4) : null,
      webhookSecret: settings.webhookSecret ? '••••••••' + settings.webhookSecret.slice(-4) : null,
    };
  }

  /**
   * Server-authoritative calculation of required payment for an appointment
   */
  async calculateRequiredPayment(businessId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, businessId },
      include: { service: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const settings = await this.getOrCreateSettings(businessId);

    if (!settings.paymentEnabled || settings.paymentMode === PaymentMode.NONE) {
      return {
        required: false,
        amount: 0,
        type: PaymentType.DEPOSIT,
        currency: settings.currency || 'INR',
        mode: PaymentMode.NONE,
      };
    }

    const price = appointment.price;
    let amount = 0;
    let type = PaymentType.DEPOSIT;

    switch (settings.paymentMode) {
      case PaymentMode.FULL_PAYMENT:
        amount = price;
        type = PaymentType.FULL_PAYMENT;
        break;

      case PaymentMode.FIXED_DEPOSIT:
        amount = Math.min(price, settings.depositAmount);
        type = PaymentType.DEPOSIT;
        break;

      case PaymentMode.PERCENTAGE_DEPOSIT:
        const pct = Math.min(100, Math.max(0, settings.depositPercentage));
        amount = Math.round(((price * pct) / 100) * 100) / 100;
        type = PaymentType.DEPOSIT;
        break;

      default:
        amount = 0;
        break;
    }

    // Safety boundary: amount cannot exceed appointment price
    amount = Math.min(price, Math.max(0, amount));

    return {
      required: amount > 0,
      amount,
      type,
      currency: settings.currency || 'INR',
      mode: settings.paymentMode,
    };
  }

  /**
   * Create or retrieve an existing payment order & link for an appointment
   */
  async createPaymentForAppointment(businessId: string, appointmentId: string, customType?: string) {
    const releaseLock = await acquireLock(appointmentPaymentLocks, appointmentId);

    try {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, businessId },
        include: {
          customer: true,
          service: true,
          business: true,
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') {
        throw new BadRequestException(`Cannot create payment for appointment with status '${appointment.status}'`);
      }

      const calculation = await this.calculateRequiredPayment(businessId, appointmentId);
      if (!calculation.required || calculation.amount <= 0) {
        return null;
      }

      // Check if a valid reusable payment already exists
      const existingPayment = await this.prisma.payment.findFirst({
        where: {
          appointmentId,
          businessId,
          status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING, PaymentStatus.PAID] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingPayment) {
        if (existingPayment.status === PaymentStatus.PAID) {
          throw new BadRequestException('Payment has already been completed for this appointment');
        }

        // If reusable and not expired, return existing
        const now = new Date();
        if (existingPayment.expiresAt && existingPayment.expiresAt > now && existingPayment.paymentLink) {
          this.logger.log(`Reusing active payment order ${existingPayment.providerOrderId} for appointment ${appointmentId}`);
          return existingPayment;
        }
      }

      const settings = await this.getOrCreateSettings(businessId);
      const expiryMinutes = settings.paymentExpiryMinutes || 30;
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

      // Create PENDING payment record
      const paymentType = customType || calculation.type;
      const idempotencyKey = `pay_${appointment.id}_${Date.now()}`;

      const payment = await this.prisma.payment.create({
        data: {
          businessId,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          amount: calculation.amount,
          currency: calculation.currency,
          type: paymentType,
          status: PaymentStatus.PENDING,
          provider: settings.provider || PaymentProviderName.MOCK,
          expiresAt,
          idempotencyKey,
        },
      });

      // Invoke Provider to generate Order and Link
      const provider = this.getProvider(settings.provider || PaymentProviderName.MOCK);
      const orderResult = await provider.createOrder(
        {
          businessId,
          paymentId: payment.id,
          appointmentId: appointment.id,
          amount: calculation.amount,
          currency: calculation.currency,
          customerName: appointment.customer.name,
          customerPhone: appointment.customer.phone,
          description: `Appointment Deposit: ${appointment.service.name}`,
          expiryMinutes,
        },
        { keyId: settings.keyId || undefined, keySecret: settings.keySecret || undefined }
      );

      // Update payment record to INITIATED
      const updatedPayment = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.INITIATED,
          providerOrderId: orderResult.providerOrderId,
          paymentLink: orderResult.paymentLink,
        },
      });

      // Update appointment depositAmount
      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: {
          depositAmount: calculation.amount,
        },
      });

      this.logger.log(
        `Generated payment link for appointment ${appointment.id}: ${updatedPayment.paymentLink} (Amount: ₹${calculation.amount})`
      );

      return updatedPayment;
    } finally {
      releaseLock();
    }
  }

  /**
   * Handle Webhook from Payment Provider (Cryptographically verified & Idempotent)
   */
  async handleWebhook(rawBody: string | Buffer, signature: string, headers?: Record<string, any>) {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    let parsed: any;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      throw new BadRequestException('Malformed webhook JSON payload');
    }

    // Resolve Provider and Order ID from payload
    const providerOrderId =
      parsed.payload?.payment?.entity?.order_id ||
      parsed.order_id ||
      parsed.providerOrderId;

    const paymentIdFromNotes =
      parsed.payload?.payment?.entity?.notes?.paymentId ||
      parsed.notes?.paymentId;

    if (!providerOrderId && !paymentIdFromNotes) {
      this.logger.warn('Webhook payload missing provider order ID and payment ID');
      return { received: true, processed: false, reason: 'Missing order reference' };
    }

    // Locate Payment record in database
    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          ...(providerOrderId ? [{ providerOrderId }] : []),
          ...(paymentIdFromNotes ? [{ id: paymentIdFromNotes }] : []),
        ],
      },
      include: {
        business: {
          include: {
            paymentSettings: true,
          },
        },
        appointment: {
          include: {
            service: true,
            customer: true,
          },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Payment record not found for webhook order: ${providerOrderId || paymentIdFromNotes}`);
      return { received: true, processed: false, reason: 'Payment record not found' };
    }

    // Cryptographic Signature Verification
    const settings = payment.business.paymentSettings;
    const webhookSecret = settings?.webhookSecret || process.env.PAYMENT_WEBHOOK_SECRET || 'mock_webhook_secret';
    const provider = this.getProvider(payment.provider);

    const verification = await provider.verifyWebhook(rawBody, signature, webhookSecret);
    if (!verification.isValid) {
      this.logger.error(`Webhook signature verification failed for payment ${payment.id}`);
      throw new UnauthorizedException('Invalid payment webhook signature');
    }

    // Mutex Lock for atomic state transition & idempotency
    const releaseLock = await acquireLock(paymentRecordLocks, payment.id);

    try {
      // Re-read latest payment under lock
      const currentPayment = await this.prisma.payment.findUnique({
        where: { id: payment.id },
      });

      if (!currentPayment) {
        return { received: true, processed: false };
      }

      // Webhook Idempotency: If already PAID, return without repeating operations
      if (currentPayment.status === PaymentStatus.PAID) {
        this.logger.log(`Idempotent webhook: Payment ${payment.id} is already marked PAID`);
        return { received: true, processed: true, duplicate: true };
      }

      // Enforce valid transitions: only PENDING or INITIATED can transition to PAID or FAILED
      if (![PaymentStatus.PENDING, PaymentStatus.INITIATED].includes(currentPayment.status as PaymentStatus)) {
        this.logger.warn(
          `Invalid state transition attempt from '${currentPayment.status}' to PAID for payment ${payment.id}`
        );
        return { received: true, processed: false, reason: 'Invalid transition' };
      }

      const event = verification.event || parsed.event || 'payment.captured';
      const isSuccess = ['payment.captured', 'order.paid', 'payment.success'].includes(event);

      if (isSuccess) {
        // Update payment to PAID
        const paidAt = new Date();
        const updatedPayment = await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.PAID,
            paidAt,
            providerPaymentId: verification.providerPaymentId || `pay_${Date.now()}`,
            providerSignature: signature,
            failureReason: null,
          },
        });

        // Update Appointment payment status
        const isFull =
          payment.type === PaymentType.FULL_PAYMENT ||
          payment.amount >= payment.appointment.price;

        const newPaymentStatus = isFull ? 'PAID' : 'PARTIALLY_PAID';

        await this.prisma.appointment.update({
          where: { id: payment.appointmentId },
          data: {
            paymentStatus: newPaymentStatus,
            depositAmount: payment.amount,
          },
        });

        this.logger.log(
          `Payment ${payment.id} succeeded. Appointment ${payment.appointmentId} updated to ${newPaymentStatus}`
        );

        // Send WhatsApp Payment Confirmation to Customer (Safe & Non-blocking)
        const customerPhone = payment.appointment.customer?.phone;
        if (customerPhone) {
          const successMsg = `Payment Received! ✅\n\nBusiness: *${payment.business.name}*\nService: *${payment.appointment.service.name}*\nAmount Paid: *₹${payment.amount}*\nPayment Ref: *#${payment.id.slice(0, 8).toUpperCase()}*\n\nYour appointment is confirmed and secured. See you soon!`;
          this.whatsAppService
            .sendTextMessage(payment.businessId, {
              recipientPhone: customerPhone,
              text: successMsg,
            })
            .catch((err) => {
              this.logger.error(`Failed to send WhatsApp payment confirmation: ${err?.message}`);
            });
        }

        return { received: true, processed: true, paymentId: updatedPayment.id };
      } else if (['payment.failed', 'order.failed'].includes(event)) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: verification.failureReason || 'Provider reported payment failure',
          },
        });

        this.logger.warn(`Payment ${payment.id} marked as FAILED`);
        return { received: true, processed: true, failed: true };
      }

      return { received: true, processed: false, reason: `Unhandled event: ${event}` };
    } finally {
      releaseLock();
    }
  }

  /**
   * Cancel pending/initiated payments when an appointment is cancelled
   */
  async handleAppointmentCancelled(businessId: string, appointmentId: string) {
    try {
      const activePayments = await this.prisma.payment.findMany({
        where: {
          businessId,
          appointmentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIATED] },
        },
      });

      if (activePayments.length === 0) return;

      await this.prisma.payment.updateMany({
        where: {
          businessId,
          appointmentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIATED] },
        },
        data: {
          status: PaymentStatus.CANCELLED,
          failureReason: 'Appointment was cancelled',
        },
      });

      this.logger.log(`Cancelled ${activePayments.length} pending payment(s) for appointment ${appointmentId}`);
    } catch (err: any) {
      this.logger.error(`Error in handleAppointmentCancelled: ${err?.message}`);
    }
  }

  /**
   * Expire past-due initiated payments and handle auto-cancellation if configured
   */
  async processExpiredPayments(): Promise<number> {
    const now = new Date();

    const expiredPayments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.INITIATED,
        expiresAt: { lte: now },
      },
      include: {
        business: {
          include: {
            paymentSettings: true,
          },
        },
      },
      take: 50,
    });

    if (expiredPayments.length === 0) return 0;

    let expiredCount = 0;
    for (const p of expiredPayments) {
      await this.prisma.payment.update({
        where: { id: p.id },
        data: {
          status: PaymentStatus.EXPIRED,
          failureReason: 'Payment window expired before completion',
        },
      });
      expiredCount++;

      // Auto-cancel appointment if configured by business
      if (p.business.paymentSettings?.autoCancelUnpaidAppointments) {
        try {
          await this.appointmentsService.cancel(p.businessId, p.appointmentId);
          this.logger.log(`Auto-cancelled appointment ${p.appointmentId} due to expired deposit`);
        } catch (err: any) {
          this.logger.error(`Failed to auto-cancel appointment ${p.appointmentId}: ${err?.message}`);
        }
      }
    }

    if (expiredCount > 0) {
      this.logger.log(`Processed ${expiredCount} expired payment(s)`);
    }

    return expiredCount;
  }

  /**
   * Refund a paid payment (Tenant Isolated)
   */
  async refundPayment(businessId: string, paymentId: string, dto: RefundPaymentDto) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, businessId },
      include: {
        business: {
          include: {
            paymentSettings: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment record not found');
    }

    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException(`Cannot refund payment with status '${payment.status}'. Only PAID payments can be refunded.`);
    }

    const refundAmount = dto.amount !== undefined ? dto.amount : payment.amount;
    if (refundAmount <= 0 || refundAmount > payment.amount) {
      throw new BadRequestException(`Invalid refund amount. Must be between 0 and ${payment.amount}`);
    }

    const settings = payment.business.paymentSettings;
    const provider = this.getProvider(payment.provider);

    const refundResult = await provider.refund(
      {
        businessId,
        paymentId: payment.id,
        providerPaymentId: payment.providerPaymentId || 'pay_manual',
        amount: refundAmount,
        currency: payment.currency,
        reason: dto.reason,
      },
      { keyId: settings?.keyId || undefined, keySecret: settings?.keySecret || undefined }
    );

    // Update payment record to REFUNDED
    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.REFUNDED,
        failureReason: `Refunded: ${dto.reason || 'Requested by business'} (Refund ID: ${refundResult.refundId})`,
      },
    });

    // Reset appointment payment status if full refund
    if (refundAmount >= payment.amount) {
      await this.prisma.appointment.update({
        where: { id: payment.appointmentId },
        data: {
          paymentStatus: 'UNPAID',
          depositAmount: 0,
        },
      });
    }

    this.logger.log(`Successfully refunded payment ${payment.id}: ₹${refundAmount}`);
    return updated;
  }

  /**
   * Find all payments for a business with pagination & filtering (Tenant-Isolated)
   */
  async findAll(businessId: string, filters: PaymentFiltersDto = {}) {
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
        { customer: { name: { contains: q } } },
        { customer: { phone: { contains: q } } },
        { providerOrderId: { contains: q } },
        { providerPaymentId: { contains: q } },
        { appointmentId: { contains: q } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
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
        orderBy: { createdAt: 'desc' },
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
   * Find single payment record (Tenant-Isolated)
   */
  async findOne(businessId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
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

    if (!payment) {
      throw new NotFoundException('Payment record not found');
    }

    return payment;
  }

  /**
   * Get payments overview statistics for dashboard
   */
  async getStats(businessId: string) {
    const [total, paid, pending, failed, expired, refunded, paidPayments] = await Promise.all([
      this.prisma.payment.count({ where: { businessId } }),
      this.prisma.payment.count({ where: { businessId, status: PaymentStatus.PAID } }),
      this.prisma.payment.count({ where: { businessId, status: { in: [PaymentStatus.PENDING, PaymentStatus.INITIATED] } } }),
      this.prisma.payment.count({ where: { businessId, status: PaymentStatus.FAILED } }),
      this.prisma.payment.count({ where: { businessId, status: PaymentStatus.EXPIRED } }),
      this.prisma.payment.count({ where: { businessId, status: PaymentStatus.REFUNDED } }),
      this.prisma.payment.findMany({
        where: { businessId, status: PaymentStatus.PAID },
        select: { amount: true },
      }),
    ]);

    const totalRevenue = paidPayments.reduce((sum, p) => sum + p.amount, 0);

    return {
      total,
      paid,
      pending,
      failed,
      expired,
      refunded,
      totalRevenue,
    };
  }
}
