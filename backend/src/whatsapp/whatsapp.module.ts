import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../prisma.service';
import { WHATSAPP_PROVIDER_TOKEN } from './providers/whatsapp-provider.token';
import { MetaWhatsAppProvider } from './providers/meta-whatsapp.provider';
import { MockWhatsAppProvider } from './providers/mock-whatsapp.provider';
import { WhatsAppConversationModule } from '../whatsapp-conversation/whatsapp-conversation.module';

@Module({
  imports: [forwardRef(() => WhatsAppConversationModule)],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    PrismaService,
    MetaWhatsAppProvider,
    MockWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER_TOKEN,
      useFactory: (metaProvider: MetaWhatsAppProvider, mockProvider: MockWhatsAppProvider) => {
        const useMock = process.env.WHATSAPP_USE_MOCK === 'true' || process.env.NODE_ENV === 'test';
        return useMock ? mockProvider : metaProvider;
      },
      inject: [MetaWhatsAppProvider, MockWhatsAppProvider],
    },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
