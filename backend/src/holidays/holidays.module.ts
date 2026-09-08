import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { HolidaysService } from './holidays.service';
import { HolidaysController } from './holidays.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [PassportModule],
  controllers: [HolidaysController],
  providers: [HolidaysService, PrismaService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
