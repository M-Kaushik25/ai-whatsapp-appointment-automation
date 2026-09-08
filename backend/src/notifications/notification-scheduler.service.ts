import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private isRunning = false;

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Cron job running every 30 seconds to find and dispatch due notifications
   */
  @Cron('*/30 * * * * *')
  async handleCron() {
    if (this.isRunning) {
      // Avoid overlapping scheduler executions if one run takes slightly longer
      return;
    }

    this.isRunning = true;
    try {
      const processed = await this.notificationsService.processDueNotifications();
      if (processed > 0) {
        this.logger.log(`Cron scheduler processed ${processed} due appointment notifications`);
      }
    } catch (err: any) {
      this.logger.error(`Error in notification scheduler cron: ${err?.message}`, err?.stack);
    } finally {
      this.isRunning = false;
    }
  }
}
