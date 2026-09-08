import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [PassportModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, PrismaService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
