import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RetentionService } from './retention.service';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { RetentionController } from './retention.controller';

@Module({
  imports: [forwardRef(() => WhatsAppModule)],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionSchedulerService, PrismaService],
  exports: [RetentionService],
})
export class RetentionModule {}
