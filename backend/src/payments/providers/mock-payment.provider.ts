import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { IPaymentProvider } from '../payment-provider.interface';
import {
  CreateOrderOptions,
  CreateOrderResult,
  WebhookVerificationResult,
  RefundOptions,
  RefundResult,
} from '../payment.types';

@Injectable()
export class MockPaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  async createOrder(options: CreateOrderOptions): Promise<CreateOrderResult> {
    const providerOrderId = `order_mock_${options.paymentId.slice(0, 8)}_${Date.now()}`;
    const paymentLink = `https://pay.mockgateway.com/order/${providerOrderId}?amount=${options.amount}&curr=${options.currency}`;

    this.logger.log(
      `[MOCK PAYMENT] Created order ${providerOrderId} for appointment ${options.appointmentId}: ₹${options.amount}`
    );

    return {
      providerOrderId,
      paymentLink,
      provider: 'MOCK',
      rawResponse: {
        id: providerOrderId,
        entity: 'order',
        amount: Math.round(options.amount * 100),
        currency: options.currency,
        status: 'created',
      },
    };
  }

  async verifyWebhook(
    rawBody: string | Buffer,
    signature: string,
    secret: string
  ): Promise<WebhookVerificationResult> {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    // Expected HMAC SHA-256 signature
    const expectedSignature = crypto
      .createHmac('sha256', secret || 'mock_webhook_secret')
      .update(bodyStr)
      .digest('hex');

    const isValid = signature === expectedSignature;

    if (!isValid) {
      this.logger.warn(`[MOCK PAYMENT] Invalid webhook signature. Received: ${signature}, Expected: ${expectedSignature}`);
      return { isValid: false };
    }

    try {
      const payload = JSON.parse(bodyStr);
      const event = payload.event || 'payment.captured';
      const paymentData = payload.payload?.payment?.entity || payload;

      return {
        isValid: true,
        event,
        providerOrderId: paymentData.order_id || paymentData.providerOrderId,
        providerPaymentId: paymentData.id || `pay_mock_${Date.now()}`,
        providerSignature: signature,
        amount: paymentData.amount ? paymentData.amount / 100 : undefined,
        currency: paymentData.currency || 'INR',
        failureReason: paymentData.error_description || undefined,
        metadata: paymentData.notes || {},
      };
    } catch (err) {
      this.logger.error(`[MOCK PAYMENT] Error parsing webhook payload: ${err}`);
      return { isValid: false };
    }
  }

  async refund(options: RefundOptions): Promise<RefundResult> {
    const refundId = `rfnd_mock_${Date.now()}`;
    this.logger.log(
      `[MOCK PAYMENT] Processed refund ${refundId} for payment ${options.providerPaymentId}: ₹${options.amount}`
    );

    return {
      refundId,
      status: 'processed',
      amount: options.amount,
      currency: options.currency,
    };
  }
}
