import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [PassportModule],
  controllers: [StaffController],
  providers: [StaffService, PrismaService],
  exports: [StaffService],
})
export class StaffModule {}
