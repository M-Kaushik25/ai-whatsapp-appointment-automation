export interface SendTextMessageOptions {
  phoneNumberId: string;
  accessToken: string;
  recipientPhone: string;
  text: string;
}

export interface SendTextMessageResult {
  success: boolean;
  whatsappMessageId?: string;
  error?: string;
}

export interface TestConnectionOptions {
  phoneNumberId: string;
  accessToken: string;
}

export interface TestConnectionResult {
  success: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  error?: string;
}

export interface IWhatsAppProvider {
  sendTextMessage(options: SendTextMessageOptions): Promise<SendTextMessageResult>;
  testConnection(options: TestConnectionOptions): Promise<TestConnectionResult>;
  verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined, appSecret: string): boolean;
}
