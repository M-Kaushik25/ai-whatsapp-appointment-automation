import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('api/v1')
export class AppController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  async checkHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', message: 'Backend is running' };
    } catch (e: any) {
      return { status: 'error', db: 'disconnected', message: e.message };
    }
  }
}
