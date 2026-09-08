import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { WhatsAppService, WhatsAppMessageFiltersDto } from './whatsapp.service';
import { SaveWhatsAppConfigDto } from './dto/save-config.dto';
import { SendWhatsAppTextMessageDto } from './dto/send-message.dto';

@Controller('api/v1/whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  /**
   * Meta Webhook Verification Endpoint (Public GET)
   */
  @Get('webhook')
  async verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const response = await this.whatsAppService.verifyWebhookChallenge(mode, token, challenge);
    return response;
  }

  /**
   * Meta Incoming Webhook Events Endpoint (Public POST)
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: any,
    @Req() req: any,
  ) {
    // If rawBody is available on req (e.g. from bodyParser or raw payload), use it; otherwise fallback to stringified body
    const rawBody = req.rawBody || JSON.stringify(payload);
    return this.whatsAppService.processWebhook(rawBody, signature, payload);
  }

  /**
   * Get WhatsApp Integration Configuration (Authenticated Tenant)
   */
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  @Get('config')
  async getConfig(@Req() req: any) {
    return this.whatsAppService.getConfig(req.tenantId);
  }

  /**
   * Save or Update WhatsApp Integration Configuration (Authenticated Tenant)
   */
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  @Post('config')
  async saveConfig(@Req() req: any, @Body() dto: SaveWhatsAppConfigDto) {
    return this.whatsAppService.saveConfig(req.tenantId, dto);
  }

  /**
   * Test WhatsApp Connectivity with Meta / Provider (Authenticated Tenant)
   */
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  @Post('test-connection')
  async testConnection(@Req() req: any) {
    return this.whatsAppService.testConnection(req.tenantId);
  }

  /**
   * Send Outgoing WhatsApp Message (Authenticated Tenant)
   */
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  @Post('send')
  async sendTextMessage(@Req() req: any, @Body() dto: SendWhatsAppTextMessageDto) {
    return this.whatsAppService.sendTextMessage(req.tenantId, dto);
  }

  /**
   * List Paginated WhatsApp Messages (Authenticated Tenant)
   */
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  @Get('messages')
  async getMessages(@Req() req: any, @Query() query: WhatsAppMessageFiltersDto) {
    return this.whatsAppService.findAllMessages(req.tenantId, query);
  }
}
