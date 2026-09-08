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
export class MetaWhatsAppProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(MetaWhatsAppProvider.name);
  private readonly baseUrl = process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com/v20.0';

  async sendTextMessage(options: SendTextMessageOptions): Promise<SendTextMessageResult> {
    const { phoneNumberId, accessToken, recipientPhone, text } = options;
    const url = `${this.baseUrl}/${phoneNumberId}/messages`;

    // Strip leading '+' for Meta API recipient format (e.g. +919876543210 -> 919876543210)
    const cleanTo = recipientPhone.replace(/^\+/, '');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
          type: 'text',
          text: { body: text },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.error(`Meta API Send Error: ${JSON.stringify(data)}`);
        return {
          success: false,
          error: data?.error?.message || `Meta API error with status ${response.status}`,
        };
      }

      const whatsappMessageId = data?.messages?.[0]?.id || `wamid.${Date.now()}`;
      return {
        success: true,
        whatsappMessageId,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown Meta API error';
      this.logger.error(`Meta WhatsApp send request failed: ${msg}`);
      return {
        success: false,
        error: msg,
      };
    }
  }

  async testConnection(options: TestConnectionOptions): Promise<TestConnectionResult> {
    const { phoneNumberId, accessToken } = options;
    const url = `${this.baseUrl}/${phoneNumberId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.error(`Meta Test Connection Error: ${JSON.stringify(data)}`);
        return {
          success: false,
          error: data?.error?.message || `Failed to verify credentials with status ${response.status}`,
        };
      }

      return {
        success: true,
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error connecting to Meta';
      return {
        success: false,
        error: msg,
      };
    }
  }

  verifySignature(rawBody: string | Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader || !appSecret) {
      return false;
    }

    try {
      // Signature header format: sha256=<signature_hash>
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
    } catch (err) {
      this.logger.error(`Error verifying signature: ${err}`);
      return false;
    }
  }
}
