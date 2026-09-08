import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WHATSAPP_PROVIDER_TOKEN } from './providers/whatsapp-provider.token';
import { IWhatsAppProvider } from './providers/whatsapp-provider.interface';
import { SaveWhatsAppConfigDto } from './dto/save-config.dto';
import { SendWhatsAppTextMessageDto } from './dto/send-message.dto';
import { normalizePhone } from '../customers/customers.service';
import { WhatsAppConversationService } from '../whatsapp-conversation/whatsapp-conversation.service';

export interface WhatsAppMessageFiltersDto {
  direction?: string; // INBOUND, OUTBOUND, ALL
  status?: string;
  customerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER_TOKEN)
    private readonly provider: IWhatsAppProvider,
    @Inject(forwardRef(() => WhatsAppConversationService))
    private readonly conversationService: WhatsAppConversationService,
  ) {}

  /**
   * Helper to mask sensitive tokens for safe client presentation
   */
  private maskSecret(secret?: string | null): string | null {
    if (!secret) return null;
    if (secret.length <= 8) return '••••••••';
    return `••••••••••••${secret.slice(-4)}`;
  }

  /**
   * Get WhatsApp configuration for a business (Secrets masked)
   */
  async getConfig(businessId: string) {
    const config = await this.prisma.whatsAppIntegration.findUnique({
      where: { businessId },
    });

    if (!config) {
      return {
        configured: false,
        status: 'DISCONNECTED',
        webhookVerified: false,
        phoneNumberId: null,
        businessAccountId: null,
        displayPhoneNumber: null,
        hasAccessToken: false,
        hasAppSecret: false,
        verifyToken: null,
        lastError: null,
      };
    }

    return {
      configured: true,
      id: config.id,
      status: config.status,
      webhookVerified: config.webhookVerified,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      displayPhoneNumber: config.displayPhoneNumber,
      hasAccessToken: !!config.accessToken,
      maskedAccessToken: this.maskSecret(config.accessToken),
      hasAppSecret: !!config.appSecret,
      maskedAppSecret: this.maskSecret(config.appSecret),
      verifyToken: config.verifyToken,
      lastError: config.lastError,
      updatedAt: config.updatedAt,
    };
  }

  /**
   * Save or update WhatsApp configuration for a business
   */
  async saveConfig(businessId: string, dto: SaveWhatsAppConfigDto) {
    const existing = await this.prisma.whatsAppIntegration.findUnique({
      where: { businessId },
    });

    const updateData: any = {
      phoneNumberId: dto.phoneNumberId,
      businessAccountId: dto.businessAccountId || undefined,
      displayPhoneNumber: dto.displayPhoneNumber || undefined,
      verifyToken: dto.verifyToken || undefined,
    };

    if (dto.accessToken && !dto.accessToken.startsWith('•••')) {
      updateData.accessToken = dto.accessToken;
    }
    if (dto.appSecret && !dto.appSecret.startsWith('•••')) {
      updateData.appSecret = dto.appSecret;
    }

    if (existing) {
      const updated = await this.prisma.whatsAppIntegration.update({
        where: { businessId },
        data: updateData,
      });
      this.logger.log(`Updated WhatsApp config for business ${businessId}`);
      return this.getConfig(businessId);
    } else {
      const created = await this.prisma.whatsAppIntegration.create({
        data: {
          businessId,
          ...updateData,
          status: 'DISCONNECTED',
        },
      });
      this.logger.log(`Created WhatsApp config for business ${businessId}`);
      return this.getConfig(businessId);
    }
  }

  /**
   * Test WhatsApp API connectivity with provider
   */
  async testConnection(businessId: string) {
    const config = await this.prisma.whatsAppIntegration.findUnique({
      where: { businessId },
    });

    if (!config || !config.phoneNumberId || !config.accessToken) {
      throw new BadRequestException(
        'WhatsApp Phone Number ID and Access Token must be configured first.'
      );
    }

    const result = await this.provider.testConnection({
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
    });

    if (result.success) {
      await this.prisma.whatsAppIntegration.update({
        where: { businessId },
        data: {
          status: 'CONNECTED',
          displayPhoneNumber: result.displayPhoneNumber || config.displayPhoneNumber,
          lastError: null,
        },
      });

      return {
        success: true,
        status: 'CONNECTED',
        displayPhoneNumber: result.displayPhoneNumber || config.displayPhoneNumber,
        verifiedName: result.verifiedName,
      };
    } else {
      await this.prisma.whatsAppIntegration.update({
        where: { businessId },
        data: {
          status: 'ERROR',
          lastError: result.error || 'Connection verification failed',
        },
      });

      return {
        success: false,
        status: 'ERROR',
        error: result.error || 'Connection verification failed',
      };
    }
  }

  /**
   * Verify Meta GET Webhook Challenge
   */
  async verifyWebhookChallenge(mode?: string, token?: string, challenge?: string): Promise<string> {
    if (mode !== 'subscribe' || !token || !challenge) {
      this.logger.warn(`Invalid webhook challenge params: mode=${mode}`);
      throw new ForbiddenException('Invalid webhook verification parameters');
    }

    // Check against global env or any registered integration verifyToken
    const envToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (envToken && envToken === token) {
      this.logger.log('Webhook verified via global environment verify token');
      return challenge;
    }

    const matchingIntegration = await this.prisma.whatsAppIntegration.findFirst({
      where: { verifyToken: token },
    });

    if (!matchingIntegration) {
      this.logger.warn(`Verify token mismatch for incoming challenge`);
      throw new ForbiddenException('Verify token does not match');
    }

    await this.prisma.whatsAppIntegration.update({
      where: { id: matchingIntegration.id },
      data: { webhookVerified: true },
    });

    this.logger.log(
      `Webhook verified successfully for business ${matchingIntegration.businessId}`
    );
    return challenge;
  }

  /**
   * Process Meta Incoming Webhook Events (Messages & Statuses) with Idempotency & Cryptographic Signature Check
   */
  async processWebhook(
    rawBody: string | Buffer,
    signatureHeader: string | undefined,
    payload: any,
  ) {
    if (!payload || payload.object !== 'whatsapp_business_account' || !payload.entry) {
      return { status: 'ignored_unsupported_object' };
    }

    for (const entry of payload.entry) {
      if (!entry.changes) continue;

      for (const change of entry.changes) {
        if (change.field !== 'messages' || !change.value) continue;

        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;

        if (!phoneNumberId) {
          this.logger.warn('Webhook change missing phone_number_id');
          continue;
        }

        // 1. Resolve Tenant / Business
        const integration = await this.prisma.whatsAppIntegration.findUnique({
          where: { phoneNumberId },
        });

        if (!integration) {
          this.logger.warn(`No business configured for WhatsApp Phone Number ID: ${phoneNumberId}`);
          continue;
        }

        // 2. Cryptographic signature check if appSecret is configured
        if (integration.appSecret) {
          const isValidSig = this.provider.verifySignature(
            rawBody,
            signatureHeader,
            integration.appSecret
          );
          if (!isValidSig) {
            this.logger.error(
              `Webhook signature verification failed for business ${integration.businessId}`
            );
            throw new ForbiddenException('Invalid webhook signature');
          }
        }

        // 3. Process Incoming Messages
        if (value.messages && Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            await this.handleIncomingMessage(integration.businessId, msg, value.contacts);
          }
        }

        // 4. Process Status Updates (SENT -> DELIVERED -> READ / FAILED)
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const statusObj of value.statuses) {
            await this.handleStatusUpdate(integration.businessId, statusObj);
          }
        }
      }
    }

    return { status: 'processed' };
  }

  /**
   * Handle an individual inbound message with Idempotency and Customer mapping
   */
  private async handleIncomingMessage(businessId: string, msg: any, contacts: any[] = []) {
    const whatsappMessageId = msg.id;
    if (!whatsappMessageId) return;

    // Strict Idempotency Check: Don't duplicate message records
    const existingMessage = await this.prisma.whatsAppMessage.findUnique({
      where: { whatsappMessageId },
    });

    if (existingMessage) {
      this.logger.log(`Idempotent ignore: Message ${whatsappMessageId} already processed.`);
      return;
    }

    // Map sender to Customer via Phone Normalization
    const rawFrom = msg.from;
    const normalizedSenderPhone = normalizePhone(rawFrom);

    let customerName = 'WhatsApp Customer';
    if (contacts && contacts.length > 0) {
      const contact = contacts.find((c) => c.wa_id === rawFrom || c.wa_id === normalizedSenderPhone.replace(/^\+/, ''));
      if (contact?.profile?.name) {
        customerName = contact.profile.name;
      }
    }

    let customer: any;
    try {
      customer = await this.prisma.customer.upsert({
        where: {
          businessId_phone: {
            businessId,
            phone: normalizedSenderPhone,
          },
        },
        update: {},
        create: {
          businessId,
          phone: normalizedSenderPhone,
          name: customerName,
          status: 'ACTIVE',
        },
      });
    } catch {
      customer = await this.prisma.customer.findUnique({
        where: {
          businessId_phone: {
            businessId,
            phone: normalizedSenderPhone,
          },
        },
      });
    }

    // Extract text / body
    let bodyText: string | null = null;
    let messageType = 'TEXT';

    if (msg.type === 'text') {
      bodyText = msg.text?.body || null;
      messageType = 'TEXT';
    } else if (msg.type === 'interactive') {
      messageType = 'INTERACTIVE';
      bodyText = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || JSON.stringify(msg.interactive);
    } else if (msg.type === 'image') {
      messageType = 'IMAGE';
      bodyText = msg.image?.caption || '[Image]';
    } else if (msg.type === 'document') {
      messageType = 'DOCUMENT';
      bodyText = msg.document?.caption || msg.document?.filename || '[Document]';
    } else {
      messageType = (msg.type || 'UNKNOWN').toUpperCase();
      bodyText = `[${messageType}]`;
    }

    const timestamp = msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000) : new Date();

    try {
      await this.prisma.whatsAppMessage.create({
        data: {
          businessId,
          customerId: customer?.id || null,
          whatsappMessageId,
          direction: 'INBOUND',
          messageType,
          text: bodyText,
          status: 'RECEIVED',
          rawPayload: JSON.stringify(msg),
          timestamp,
        },
      });

      this.logger.log(
        `Stored inbound WhatsApp message ${whatsappMessageId} from ${normalizedSenderPhone} for business ${businessId}`
      );

      // Trigger Conversational Booking State Machine
      if (customer?.id && this.conversationService) {
        await this.conversationService.handleMessage(
          businessId,
          customer.id,
          normalizedSenderPhone,
          bodyText || '',
        );
      }
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.log(`Idempotent duplicate ignore for message ${whatsappMessageId}`);
        return;
      }
      throw err;
    }
  }

  /**
   * Handle message status transitions (SENT -> DELIVERED -> READ / FAILED)
   */
  private async handleStatusUpdate(businessId: string, statusObj: any) {
    const whatsappMessageId = statusObj.id;
    if (!whatsappMessageId) return;

    const existingMessage = await this.prisma.whatsAppMessage.findUnique({
      where: { whatsappMessageId },
    });

    if (!existingMessage) {
      return;
    }

    const nextStatus = statusObj.status?.toUpperCase() || 'UNKNOWN';

    await this.prisma.whatsAppMessage.update({
      where: { id: existingMessage.id },
      data: {
        status: nextStatus,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Updated WhatsApp message ${whatsappMessageId} status to ${nextStatus}`);
  }

  /**
   * Send outbound WhatsApp text message
   */
  async sendTextMessage(businessId: string, dto: SendWhatsAppTextMessageDto) {
    const config = await this.prisma.whatsAppIntegration.findUnique({
      where: { businessId },
    });

    if (!config || !config.phoneNumberId || !config.accessToken) {
      throw new BadRequestException('WhatsApp integration is not configured or missing credentials');
    }

    const normalizedPhone = normalizePhone(dto.recipientPhone);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid recipient phone number');
    }

    // Call Provider
    const result = await this.provider.sendTextMessage({
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
      recipientPhone: normalizedPhone,
      text: dto.text,
    });

    // Find or create customer
    let customer = await this.prisma.customer.findUnique({
      where: {
        businessId_phone: {
          businessId,
          phone: normalizedPhone,
        },
      },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          businessId,
          phone: normalizedPhone,
          name: 'WhatsApp Customer',
          status: 'ACTIVE',
        },
      });
    }

    const whatsappMessageId = result.whatsappMessageId || `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const messageRecord = await this.prisma.whatsAppMessage.create({
      data: {
        businessId,
        customerId: customer.id,
        whatsappMessageId,
        direction: 'OUTBOUND',
        messageType: 'TEXT',
        text: dto.text,
        status: result.success ? 'SENT' : 'FAILED',
        rawPayload: JSON.stringify({ result }),
        timestamp: new Date(),
      },
      include: {
        customer: true,
      },
    });

    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to send WhatsApp message via Meta Cloud API');
    }

    return messageRecord;
  }

  /**
   * List paginated messages for a business (Multi-Tenant Isolated)
   */
  async findAllMessages(businessId: string, filters: WhatsAppMessageFiltersDto) {
    const page = Math.max(Number(filters.page) || 1, 1);
    const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = { businessId };

    if (filters.direction && filters.direction !== 'ALL') {
      where.direction = filters.direction;
    }

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    if (filters.search) {
      const s = filters.search.trim();
      where.OR = [
        { text: { contains: s } },
        { customer: { name: { contains: s } } },
        { customer: { phone: { contains: s } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.whatsAppMessage.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
