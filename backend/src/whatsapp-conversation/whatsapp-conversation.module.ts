import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppConversationController } from './whatsapp-conversation.controller';
import { WhatsAppConversationService } from './whatsapp-conversation.service';
import { PrismaService } from '../prisma.service';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    AvailabilityModule,
    forwardRef(() => AppointmentsModule),
    forwardRef(() => WhatsAppModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [WhatsAppConversationController],
  providers: [WhatsAppConversationService, PrismaService],
  exports: [WhatsAppConversationService],
})
export class WhatsAppConversationModule {}
