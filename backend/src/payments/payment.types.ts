export enum PaymentType {
  DEPOSIT = 'DEPOSIT',
  FULL_PAYMENT = 'FULL_PAYMENT',
  REFUND = 'REFUND',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  INITIATED = 'INITIATED',
  PAID = 'PAID',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentMode {
  NONE = 'NONE',
  FIXED_DEPOSIT = 'FIXED_DEPOSIT',
  PERCENTAGE_DEPOSIT = 'PERCENTAGE_DEPOSIT',
  FULL_PAYMENT = 'FULL_PAYMENT',
}

export enum PaymentProviderName {
  MOCK = 'MOCK',
  RAZORPAY = 'RAZORPAY',
}

export interface CreateOrderOptions {
  businessId: string;
  paymentId: string;
  appointmentId: string;
  amount: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  description: string;
  expiryMinutes?: number;
}

export interface CreateOrderResult {
  providerOrderId: string;
  paymentLink: string;
  provider: string;
  rawResponse?: any;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  event?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerSignature?: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  metadata?: Record<string, any>;
}

export interface RefundOptions {
  businessId: string;
  paymentId: string;
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: string;
  amount: number;
  currency: string;
}
