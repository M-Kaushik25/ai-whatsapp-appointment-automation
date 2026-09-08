import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { ServicesModule } from './services/services.module';
import { StaffModule } from './staff/staff.module';
import { HolidaysModule } from './holidays/holidays.module';
import { AvailabilityModule } from './availability/availability.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { CustomersModule } from './customers/customers.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { WhatsAppConversationModule } from './whatsapp-conversation/whatsapp-conversation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RetentionModule } from './retention/retention.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    BusinessModule,
    ServicesModule,
    StaffModule,
    HolidaysModule,
    AvailabilityModule,
    AppointmentsModule,
    CustomersModule,
    WhatsAppModule,
    WhatsAppConversationModule,
    NotificationsModule,
    RetentionModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
