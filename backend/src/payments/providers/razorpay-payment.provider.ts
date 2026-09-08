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
export class RazorpayPaymentProvider implements IPaymentProvider {
  private readonly logger = new Logger(RazorpayPaymentProvider.name);

  async createOrder(
    options: CreateOrderOptions,
    credentials?: { keyId?: string; keySecret?: string }
  ): Promise<CreateOrderResult> {
    const keyId = credentials?.keyId || process.env.RAZORPAY_KEY_ID;
    const keySecret = credentials?.keySecret || process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('Razorpay API credentials (KEY_ID and KEY_SECRET) are required.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const amountInPaise = Math.round(options.amount * 100);

    const body = {
      amount: amountInPaise,
      currency: options.currency || 'INR',
      receipt: `rcpt_${options.paymentId.slice(0, 12)}`,
      notes: {
        businessId: options.businessId,
        appointmentId: options.appointmentId,
        paymentId: options.paymentId,
      },
    };

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Razorpay order creation failed: ${response.status} ${errText}`);
      throw new Error(`Razorpay order creation failed: ${errText}`);
    }

    const data = await response.json();
    const paymentLink = `https://rzp.io/i/${data.id}`;

    return {
      providerOrderId: data.id,
      paymentLink,
      provider: 'RAZORPAY',
      rawResponse: data,
    };
  }

  async verifyWebhook(
    rawBody: string | Buffer,
    signature: string,
    secret: string
  ): Promise<WebhookVerificationResult> {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(bodyStr)
      .digest('hex');

    const isValid = signature === expectedSignature;

    if (!isValid) {
      this.logger.warn(`Invalid Razorpay webhook signature.`);
      return { isValid: false };
    }

    try {
      const payload = JSON.parse(bodyStr);
      const event = payload.event;
      const paymentEntity = payload.payload?.payment?.entity;

      return {
        isValid: true,
        event,
        providerOrderId: paymentEntity?.order_id,
        providerPaymentId: paymentEntity?.id,
        providerSignature: signature,
        amount: paymentEntity?.amount ? paymentEntity.amount / 100 : undefined,
        currency: paymentEntity?.currency || 'INR',
        failureReason: paymentEntity?.error_description || undefined,
        metadata: paymentEntity?.notes || {},
      };
    } catch (err) {
      this.logger.error(`Error parsing Razorpay webhook body: ${err}`);
      return { isValid: false };
    }
  }

  async refund(
    options: RefundOptions,
    credentials?: { keyId?: string; keySecret?: string }
  ): Promise<RefundResult> {
    const keyId = credentials?.keyId || process.env.RAZORPAY_KEY_ID;
    const keySecret = credentials?.keySecret || process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials required for refund.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const amountInPaise = Math.round(options.amount * 100);

    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${options.providerPaymentId}/refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          amount: amountInPaise,
          notes: {
            reason: options.reason || 'Customer appointment refund',
            paymentId: options.paymentId,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Razorpay refund failed: ${errText}`);
      throw new Error(`Razorpay refund failed: ${errText}`);
    }

    const data = await response.json();
    return {
      refundId: data.id,
      status: data.status,
      amount: data.amount / 100,
      currency: data.currency,
    };
  }
}
