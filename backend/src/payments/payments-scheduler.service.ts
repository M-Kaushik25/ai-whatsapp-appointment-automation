import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentsSchedulerService {
  private readonly logger = new Logger(PaymentsSchedulerService.name);
  private isProcessing = false;

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Cron job running every 60 seconds to expire unpaid initiated payments
   */
  @Cron('*/60 * * * * *')
  async handlePaymentsCron() {
    if (this.isProcessing) {
      this.logger.debug('Skipping payments expiration cron tick: previous execution is still running');
      return;
    }

    this.isProcessing = true;
    try {
      const expired = await this.paymentsService.processExpiredPayments();
      if (expired > 0) {
        this.logger.log(`Payments scheduler expired ${expired} payment(s)`);
      }
    } catch (err: any) {
      this.logger.error(`Payments scheduler error: ${err?.message}`, err?.stack);
    } finally {
      this.isProcessing = false;
    }
  }
}
