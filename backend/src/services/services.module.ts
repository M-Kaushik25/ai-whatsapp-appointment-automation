import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [PassportModule],
  controllers: [ServicesController],
  providers: [ServicesService, PrismaService],
  exports: [ServicesService],
})
export class ServicesModule {}
