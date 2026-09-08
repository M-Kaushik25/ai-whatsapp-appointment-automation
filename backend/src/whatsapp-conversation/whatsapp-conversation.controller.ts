import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { WhatsAppConversationService } from './whatsapp-conversation.service';

@Controller('api/v1/whatsapp/conversations')
@UseGuards(AuthGuard('jwt'), TenantGuard)
export class WhatsAppConversationController {
  constructor(
    private readonly conversationService: WhatsAppConversationService,
  ) {}

  @Get()
  async getConversations(@Req() req: any) {
    return this.conversationService.findAllSessions(req.tenantId);
  }
}
