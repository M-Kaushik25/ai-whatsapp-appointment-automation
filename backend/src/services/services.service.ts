import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CreateServiceDto {
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
  depositType?: 'NONE' | 'FIXED' | 'PERCENTAGE';
  depositValue?: number;
  active?: boolean;
}

export interface UpdateServiceDto {
  name?: string;
  description?: string;
  durationMinutes?: number;
  price?: number;
  depositType?: 'NONE' | 'FIXED' | 'PERCENTAGE';
  depositValue?: number;
  active?: boolean;
}

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  private validateServiceData(data: CreateServiceDto | UpdateServiceDto, currentPrice?: number) {
    if ('name' in data && data.name !== undefined) {
      if (!data.name || !data.name.trim()) {
        throw new BadRequestException('Service name is required');
      }
    }

    if (data.durationMinutes !== undefined) {
      if (typeof data.durationMinutes !== 'number' || data.durationMinutes <= 0) {
        throw new BadRequestException('Duration must be greater than 0 minutes');
      }
    }

    if (data.price !== undefined) {
      if (typeof data.price !== 'number' || data.price < 0) {
        throw new BadRequestException('Price cannot be negative');
      }
    }

    const price = data.price !== undefined ? data.price : (currentPrice ?? 0);
    const depositType = data.depositType ?? 'NONE';
    const depositValue = data.depositValue ?? 0;

    if (depositValue < 0) {
      throw new BadRequestException('Deposit value cannot be negative');
    }

    if (depositType === 'PERCENTAGE') {
      if (depositValue > 100) {
        throw new BadRequestException('Percentage deposit must be between 0 and 100');
      }
    } else if (depositType === 'FIXED') {
      if (depositValue > price) {
        throw new BadRequestException('Fixed deposit cannot exceed service price');
      }
    }
  }

  async findAll(businessId: string, activeOnly?: boolean) {
    const where: any = { businessId };
    if (activeOnly) {
      where.active = true;
    }
    return this.prisma.service.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(businessId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, businessId },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  async create(businessId: string, dto: CreateServiceDto) {
    this.validateServiceData(dto);

    // Check duplicate name within this business
    const existing = await this.prisma.service.findFirst({
      where: {
        businessId,
        name: { equals: dto.name.trim() },
      },
    });

    if (existing) {
      throw new ConflictException(`Service with name "${dto.name}" already exists for this business`);
    }

    return this.prisma.service.create({
      data: {
        businessId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        durationMinutes: Number(dto.durationMinutes),
        price: Number(dto.price),
        depositType: dto.depositType || 'NONE',
        depositValue: Number(dto.depositValue || 0),
        active: dto.active !== undefined ? Boolean(dto.active) : true,
      },
    });
  }

  async update(businessId: string, id: string, dto: UpdateServiceDto) {
    const current = await this.findOne(businessId, id);

    this.validateServiceData(dto, current.price);

    if (dto.name && dto.name.trim() !== current.name) {
      const duplicate = await this.prisma.service.findFirst({
        where: {
          businessId,
          name: { equals: dto.name.trim() },
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictException(`Service with name "${dto.name}" already exists for this business`);
      }
    }

    return this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        ...(dto.durationMinutes !== undefined && { durationMinutes: Number(dto.durationMinutes) }),
        ...(dto.price !== undefined && { price: Number(dto.price) }),
        ...(dto.depositType !== undefined && { depositType: dto.depositType }),
        ...(dto.depositValue !== undefined && { depositValue: Number(dto.depositValue) }),
        ...(dto.active !== undefined && { active: Boolean(dto.active) }),
      },
    });
  }

  async remove(businessId: string, id: string) {
    await this.findOne(businessId, id);
    return this.prisma.service.delete({
      where: { id },
    });
  }
}
