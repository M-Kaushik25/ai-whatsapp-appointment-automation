import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class BusinessService {
  constructor(private prisma: PrismaService) {}

  async getProfile(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId }
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return business;
  }

  async updateSettings(businessId: string, settings: any) {
    // In a real app we'd merge settings, here we just stringify
    return this.prisma.business.update({
      where: { id: businessId },
      data: { settings: JSON.stringify(settings) }
    });
  }
}
