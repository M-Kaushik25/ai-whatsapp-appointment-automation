import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { PrismaService } from '../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RetentionModule } from '../retention/retention.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    PassportModule,
    AvailabilityModule,
    forwardRef(() => NotificationsModule),
    forwardRef(() => RetentionModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, PrismaService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
