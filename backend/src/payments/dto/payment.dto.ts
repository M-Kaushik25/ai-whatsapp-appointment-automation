export interface UpdatePaymentSettingsDto {
  paymentEnabled?: boolean;
  paymentMode?: string; // NONE, FIXED_DEPOSIT, PERCENTAGE_DEPOSIT, FULL_PAYMENT
  depositAmount?: number;
  depositPercentage?: number;
  currency?: string;
  paymentExpiryMinutes?: number;
  autoCancelUnpaidAppointments?: boolean;
  provider?: string; // MOCK, RAZORPAY
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

export interface CreatePaymentDto {
  appointmentId: string;
  type?: string; // DEPOSIT, FULL_PAYMENT
}

export interface PaymentFiltersDto {
  status?: string;
  type?: string;
  appointmentId?: string;
  customerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface RefundPaymentDto {
  amount?: number;
  reason?: string;
}
