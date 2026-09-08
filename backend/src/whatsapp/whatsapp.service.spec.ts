import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../prisma.service';
import { MockWhatsAppProvider } from './providers/mock-whatsapp.provider';
import * as crypto from 'crypto';

describe('WhatsAppService — WhatsApp Business Integration Foundation', () => {
  let prisma: PrismaService;
  let provider: MockWhatsAppProvider;
  let service: WhatsAppService;

  let businessAId: string;
  let businessBId: string;
  let phoneNumberIdA: string;
  let phoneNumberIdB: string;
  let appSecretA: string;
  let verifyTokenA: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    provider = new MockWhatsAppProvider();
    service = new WhatsAppService(prisma, provider);

    const suffix = Math.random().toString(36).substring(2, 7) + Date.now();
    phoneNumberIdA = `phone_id_${suffix}_a`;
    phoneNumberIdB = `phone_id_${suffix}_b`;
    appSecretA = `app_sec_${suffix}`;
    verifyTokenA = `ver_tok_${suffix}`;

    // Create Business A
    const bizA = await prisma.business.create({
      data: {
        name: 'WhatsApp Test Business A',
        slug: `wa-biz-a-${suffix}`,
      },
    });
    businessAId = bizA.id;

    // Create Business B
    const bizB = await prisma.business.create({
      data: {
        name: 'WhatsApp Test Business B',
        slug: `wa-biz-b-${suffix}`,
      },
    });
    businessBId = bizB.id;
  });

  afterAll(async () => {
    if (businessAId) {
      await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    }
    await prisma.$disconnect();
  });

  describe('1. Configuration & Secret Masking', () => {
    it('should save WhatsApp credentials and retrieve them with masked secrets', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        businessAccountId: 'waba_acc_12345',
        displayPhoneNumber: '+91 98765 43210',
        accessToken: 'EAAG_test_access_token_secret_9999',
        appSecret: appSecretA,
        verifyToken: verifyTokenA,
      });

      const config = await service.getConfig(businessAId);
      expect(config.configured).toBe(true);
      expect(config.phoneNumberId).toBe(phoneNumberIdA);
      expect(config.displayPhoneNumber).toBe('+91 98765 43210');
      expect(config.hasAccessToken).toBe(true);
      expect(config.maskedAccessToken).toContain('••••••••');
      expect(config.maskedAccessToken).not.toContain('EAAG_test_access_token_secret_9999');
      expect(config.hasAppSecret).toBe(true);
      expect(config.maskedAppSecret).toContain('••••••••');
      expect(config.maskedAppSecret).not.toContain(appSecretA);
    });

    it('should test connection successfully and update status to CONNECTED', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        accessToken: 'valid_mock_access_token',
      });

      const result = await service.testConnection(businessAId);
      expect(result.success).toBe(true);
      expect(result.status).toBe('CONNECTED');

      const config = await service.getConfig(businessAId);
      expect(config.status).toBe('CONNECTED');
    });
  });

  describe('2. Meta Webhook Challenge Verification (GET)', () => {
    it('should verify valid challenge and update webhookVerified to true', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        verifyToken: verifyTokenA,
      });

      const challenge = '1158201444';
      const result = await service.verifyWebhookChallenge('subscribe', verifyTokenA, challenge);
      expect(result).toBe(challenge);

      const config = await service.getConfig(businessAId);
      expect(config.webhookVerified).toBe(true);
    });

    it('should reject invalid verify token with ForbiddenException', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        verifyToken: verifyTokenA,
      });

      await expect(
        service.verifyWebhookChallenge('subscribe', 'wrong_token', '1158201444')
      ).rejects.toThrow();
    });
  });

  describe('3. Webhook Signature Verification (HMAC SHA-256)', () => {
    it('should accept valid signature and process payload', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        appSecret: appSecretA,
      });

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '919876543210',
                    phone_number_id: phoneNumberIdA,
                  },
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid_${Date.now()}_sig_test`,
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      type: 'text',
                      text: { body: 'Hello with signature' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const hmac = crypto.createHmac('sha256', appSecretA);
      const signatureHash = hmac.update(rawBody).digest('hex');
      const signatureHeader = `sha256=${signatureHash}`;

      const res = await service.processWebhook(rawBody, signatureHeader, payload);
      expect(res.status).toBe('processed');
    });

    it('should reject invalid or spoofed signature with ForbiddenException', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        appSecret: appSecretA,
      });

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: phoneNumberIdA },
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid_${Date.now()}_spoofed`,
                      type: 'text',
                      text: { body: 'Spoofed message' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const fakeSignatureHeader = `sha256=invalid_fake_hash_1234567890abcdef`;

      await expect(
        service.processWebhook(rawBody, fakeSignatureHeader, payload)
      ).rejects.toThrow();
    });
  });

  describe('4. Inbound Message Receipt & Customer Mapping', () => {
    it('should map incoming sender phone to Customer and create INBOUND message', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
      });

      const messageId = `wamid_${Date.now()}_customer_map`;
      const senderPhone = '9876543210'; // 10-digit number -> should normalize to +919876543210

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: phoneNumberIdA },
                  contacts: [{ profile: { name: 'Rahul Dravid' }, wa_id: '919876543210' }],
                  messages: [
                    {
                      from: senderPhone,
                      id: messageId,
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      type: 'text',
                      text: { body: 'Hi, I want to check availability' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await service.processWebhook(JSON.stringify(payload), undefined, payload);

      // Verify Customer was created with normalized phone
      const customer = await prisma.customer.findUnique({
        where: {
          businessId_phone: {
            businessId: businessAId,
            phone: '+919876543210',
          },
        },
      });
      expect(customer).toBeDefined();
      expect(customer?.name).toBe('Rahul Dravid');

      // Verify Message was saved
      const message = await prisma.whatsAppMessage.findUnique({
        where: { whatsappMessageId: messageId },
      });
      expect(message).toBeDefined();
      expect(message?.businessId).toBe(businessAId);
      expect(message?.customerId).toBe(customer?.id);
      expect(message?.direction).toBe('INBOUND');
      expect(message?.text).toBe('Hi, I want to check availability');
      expect(message?.status).toBe('RECEIVED');
    });
  });

  describe('5. Message Idempotency (Replay Protection)', () => {
    it('should process identical webhook 10 times without creating duplicate messages or customers', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
      });

      const idempotencyMsgId = `wamid_${Date.now()}_idempotent_test`;
      const senderPhone = '9988776655';

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: phoneNumberIdA },
                  contacts: [{ profile: { name: 'Idempotency User' }, wa_id: '919988776655' }],
                  messages: [
                    {
                      from: senderPhone,
                      id: idempotencyMsgId,
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      type: 'text',
                      text: { body: 'Idempotency body' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      // Send identical webhook 10 times concurrently
      await Promise.all(
        Array.from({ length: 10 }).map(() =>
          service.processWebhook(JSON.stringify(payload), undefined, payload)
        )
      );

      // Verify exactly ONE message in database
      const messages = await prisma.whatsAppMessage.findMany({
        where: { whatsappMessageId: idempotencyMsgId },
      });
      expect(messages.length).toBe(1);

      // Verify exactly ONE customer in database
      const customers = await prisma.customer.findMany({
        where: {
          businessId: businessAId,
          phone: '+919988776655',
        },
      });
      expect(customers.length).toBe(1);
    });
  });

  describe('6. Outbound Messaging & Status Lifecycle', () => {
    it('should send outbound message and update status via status webhook', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        accessToken: 'mock_token',
      });

      const outbound = await service.sendTextMessage(businessAId, {
        recipientPhone: '+919876543210',
        text: 'Hello from Business A',
      });

      expect(outbound.direction).toBe('OUTBOUND');
      expect(outbound.status).toBe('SENT');
      expect(outbound.whatsappMessageId).toBeDefined();

      // Process Delivery Status Webhook
      const deliveryPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: phoneNumberIdA },
                  statuses: [
                    {
                      id: outbound.whatsappMessageId,
                      status: 'delivered',
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      recipient_id: '919876543210',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await service.processWebhook(JSON.stringify(deliveryPayload), undefined, deliveryPayload);

      const deliveredMsg = await prisma.whatsAppMessage.findUnique({
        where: { id: outbound.id },
      });
      expect(deliveredMsg?.status).toBe('DELIVERED');

      // Process Read Status Webhook
      const readPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: phoneNumberIdA },
                  statuses: [
                    {
                      id: outbound.whatsappMessageId,
                      status: 'read',
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      recipient_id: '919876543210',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await service.processWebhook(JSON.stringify(readPayload), undefined, readPayload);

      const readMsg = await prisma.whatsAppMessage.findUnique({
        where: { id: outbound.id },
      });
      expect(readMsg?.status).toBe('READ');
    });
  });

  describe('7. Multi-Tenant Isolation', () => {
    it('should strictly isolate WhatsApp messages between Business A and Business B', async () => {
      await service.saveConfig(businessAId, {
        phoneNumberId: phoneNumberIdA,
        accessToken: 'token_a',
      });
      await service.saveConfig(businessBId, {
        phoneNumberId: phoneNumberIdB,
        accessToken: 'token_b',
      });

      // Send message in Business A
      await service.sendTextMessage(businessAId, {
        recipientPhone: '+919111122222',
        text: 'Message for Business A client',
      });

      // Send message in Business B
      await service.sendTextMessage(businessBId, {
        recipientPhone: '+919333344444',
        text: 'Message for Business B client',
      });

      // Business A queries messages
      const msgsA = await service.findAllMessages(businessAId, {});
      expect(msgsA.items.length).toBe(1);
      expect(msgsA.items[0].text).toBe('Message for Business A client');

      // Business B queries messages
      const msgsB = await service.findAllMessages(businessBId, {});
      expect(msgsB.items.length).toBe(1);
      expect(msgsB.items[0].text).toBe('Message for Business B client');
    });
  });
});
