import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { NotificationsService } from './notifications.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationsController } from './notifications.controller';
import { ReminderSettingsController } from './reminder-settings.controller';

@Module({
  imports: [forwardRef(() => WhatsAppModule)],
  controllers: [NotificationsController, ReminderSettingsController],
  providers: [PrismaService, NotificationsService, NotificationSchedulerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
