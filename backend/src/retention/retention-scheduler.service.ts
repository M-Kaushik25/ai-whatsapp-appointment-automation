import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

@Injectable()
export class RetentionSchedulerService {
  private readonly logger = new Logger(RetentionSchedulerService.name);
  private isProcessing = false;

  constructor(private readonly retentionService: RetentionService) {}

  /**
   * Cron job running every 30 seconds to process due rebooking follow-ups
   */
  @Cron('*/30 * * * * *')
  async handleRetentionCron() {
    if (this.isProcessing) {
      this.logger.debug('Skipping retention cron tick: previous execution is still running');
      return;
    }

    this.isProcessing = true;
    try {
      // 1. Recover stale processing locks (> 5 mins)
      await this.retentionService.recoverStaleProcessingLocks(5);

      // 2. Process due pending follow-ups
      const processed = await this.retentionService.processDueFollowUps();
      if (processed > 0) {
        this.logger.log(`Retention scheduler processed ${processed} follow-up(s)`);
      }
    } catch (err: any) {
      this.logger.error(`Retention scheduler error: ${err?.message}`, err?.stack);
    } finally {
      this.isProcessing = false;
    }
  }
}
