import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PaymentsService } from './payments.service';
import { PaymentsSchedulerService } from './payments-scheduler.service';
import { PaymentsController } from './payments.controller';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { RazorpayPaymentProvider } from './providers/razorpay-payment.provider';

@Module({
  imports: [
    forwardRef(() => WhatsAppModule),
    forwardRef(() => AppointmentsModule),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsSchedulerService,
    MockPaymentProvider,
    RazorpayPaymentProvider,
    PrismaService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
