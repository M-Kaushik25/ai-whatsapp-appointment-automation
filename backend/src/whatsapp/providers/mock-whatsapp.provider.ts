import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IWhatsAppProvider,
  SendTextMessageOptions,
  SendTextMessageResult,
  TestConnectionOptions,
  TestConnectionResult,
} from './whatsapp-provider.interface';

@Injectable()
export class MockWhatsAppProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(MockWhatsAppProvider.name);

  async sendTextMessage(options: SendTextMessageOptions): Promise<SendTextMessageResult> {
    const { phoneNumberId, recipientPhone, text } = options;
    this.logger.log(
      `[MOCK WHATSAPP] Sending to ${recipientPhone} from PhoneId ${phoneNumberId}: "${text}"`
    );

    if (recipientPhone.includes('invalid') || recipientPhone.length < 5) {
      return {
        success: false,
        error: 'Invalid recipient phone number',
      };
    }

    const whatsappMessageId = `mock_wamid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      success: true,
      whatsappMessageId,
    };
  }

  async testConnection(options: TestConnectionOptions): Promise<TestConnectionResult> {
    const { phoneNumberId, accessToken } = options;

    if (!phoneNumberId || !accessToken || accessToken.toLowerCase().includes('invalid')) {
      return {
        success: false,
        error: 'Invalid Phone Number ID or Access Token in Mock provider',
      };
    }

    return {
      success: true,
      displayPhoneNumber: '+91 98765 43210',
      verifiedName: 'Demo Business WhatsApp',
    };
  }

  verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader || !appSecret) {
      return false;
    }

    try {
      const parts = signatureHeader.split('=');
      if (parts.length !== 2 || parts[0] !== 'sha256') {
        return false;
      }

      const expectedSignature = parts[1];
      const hmac = crypto.createHmac('sha256', appSecret);
      const computedSignature = hmac.update(rawBody).digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const computedBuffer = Buffer.from(computedSignature, 'hex');

      if (expectedBuffer.length !== computedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
    } catch {
      return false;
    }
  }
}
