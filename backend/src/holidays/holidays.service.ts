import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CreateHolidayDto {
  date: string | Date;
  name: string;
}

export interface UpdateHolidayDto {
  date?: string | Date;
  name?: string;
}

@Injectable()
export class HolidaysService {
  constructor(private prisma: PrismaService) {}

  async findAll(businessId: string) {
    return this.prisma.businessHoliday.findMany({
      where: { businessId },
      orderBy: { date: 'asc' },
    });
  }

  async findOne(businessId: string, id: string) {
    const holiday = await this.prisma.businessHoliday.findFirst({
      where: { id, businessId },
    });
    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }
    return holiday;
  }

  async create(businessId: string, dto: CreateHolidayDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Holiday name is required');
    }

    const date = new Date(dto.date);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid holiday date');
    }

    // Normalize to date-only if needed or exact timestamp check
    const existing = await this.prisma.businessHoliday.findFirst({
      where: {
        businessId,
        date,
      },
    });

    if (existing) {
      throw new ConflictException('A holiday is already configured for this date');
    }

    return this.prisma.businessHoliday.create({
      data: {
        businessId,
        date,
        name: dto.name.trim(),
      },
    });
  }

  async update(businessId: string, id: string, dto: UpdateHolidayDto) {
    const current = await this.findOne(businessId, id);

    let date = current.date;
    if (dto.date) {
      date = new Date(dto.date);
      if (isNaN(date.getTime())) {
        throw new BadRequestException('Invalid holiday date');
      }

      const duplicate = await this.prisma.businessHoliday.findFirst({
        where: {
          businessId,
          date,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictException('A holiday is already configured for this date');
      }
    }

    if (dto.name !== undefined && (!dto.name || !dto.name.trim())) {
      throw new BadRequestException('Holiday name cannot be empty');
    }

    return this.prisma.businessHoliday.update({
      where: { id },
      data: {
        date,
        ...(dto.name !== undefined && { name: dto.name.trim() }),
      },
    });
  }

  async remove(businessId: string, id: string) {
    await this.findOne(businessId, id);
    return this.prisma.businessHoliday.delete({
      where: { id },
    });
  }
}
