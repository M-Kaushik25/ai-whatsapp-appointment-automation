import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, PassportModule],
  controllers: [BusinessController],
  providers: [BusinessService, PrismaService],
})
export class BusinessModule {}

