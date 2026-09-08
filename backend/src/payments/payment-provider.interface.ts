import {
  CreateOrderOptions,
  CreateOrderResult,
  WebhookVerificationResult,
  RefundOptions,
  RefundResult,
} from './payment.types';

export interface IPaymentProvider {
  createOrder(options: CreateOrderOptions, credentials?: { keyId?: string; keySecret?: string }): Promise<CreateOrderResult>;
  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): Promise<WebhookVerificationResult>;
  refund(options: RefundOptions, credentials?: { keyId?: string; keySecret?: string }): Promise<RefundResult>;
}
