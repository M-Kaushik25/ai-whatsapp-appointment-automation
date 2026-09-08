import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CreateCustomerDto {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateCustomerDto {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface CustomerFiltersDto {
  search?: string;
  status?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  let cleaned = rawPhone.replace(/[\s\-\(\)\.]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
  }

  if (cleaned.startsWith('+91')) {
    return cleaned;
  }

  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return `+91${cleaned.substring(1)}`;
  }

  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  return cleaned;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private prisma: PrismaService) {}

  async create(businessId: string, dto: CreateCustomerDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Customer name is required');
    }
    if (dto.name.trim().length > 150) {
      throw new BadRequestException('Customer name must be less than 150 characters');
    }

    if (!dto.phone || !dto.phone.trim()) {
      throw new BadRequestException('Customer phone is required');
    }

    const normalized = normalizePhone(dto.phone.trim());
    if (normalized.length < 8 || normalized.length > 20) {
      throw new BadRequestException('Invalid phone number format');
    }

    if (dto.email && dto.email.trim()) {
      if (!isValidEmail(dto.email.trim())) {
        throw new BadRequestException('Invalid email address format');
      }
    }

    const existing = await this.prisma.customer.findUnique({
      where: {
        businessId_phone: {
          businessId,
          phone: normalized,
        },
      },
    });

    if (existing) {
      throw new ConflictException('A customer with this phone number already exists.');
    }

    const tagsJson = JSON.stringify(dto.tags || []);

    const customer = await this.prisma.customer.create({
      data: {
        businessId,
        name: dto.name.trim(),
        phone: normalized,
        email: dto.email?.trim() || null,
        notes: dto.notes?.trim() || null,
        tags: tagsJson,
        status: dto.status || 'ACTIVE',
      },
    });

    this.logger.log(`Created customer: ${customer.id} (${customer.name}) for business ${businessId}`);
    return customer;
  }

  async findAll(businessId: string, filters: CustomerFiltersDto = {}) {
    const where: any = { businessId };

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      const normalizedQ = normalizePhone(q);
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { phone: { contains: normalizedQ } },
        { email: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    if (filters.sort === 'oldest') {
      orderBy = { createdAt: 'asc' };
    } else if (filters.sort === 'name_asc') {
      orderBy = { name: 'asc' };
    } else if (filters.sort === 'name_desc') {
      orderBy = { name: 'desc' };
    }

    if (filters.page && filters.limit) {
      const page = Math.max(1, Number(filters.page));
      const limit = Math.max(1, Number(filters.limit));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        this.prisma.customer.count({ where }),
        this.prisma.customer.findMany({
          where,
          include: {
            _count: {
              select: { appointments: true },
            },
          },
          orderBy,
          skip,
          take: limit,
        }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }

    return this.prisma.customer.findMany({
      where,
      include: {
        _count: {
          select: { appointments: true },
        },
      },
      orderBy,
    });
  }

  async findOne(businessId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, businessId },
      include: {
        appointments: {
          orderBy: { startAt: 'desc' },
          include: {
            service: true,
            staff: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const now = new Date();
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;
    let totalSpending = 0;
    let lastVisit: Date | null = null;
    let nextAppointment: Date | null = null;

    for (const a of customer.appointments) {
      if (a.status === 'COMPLETED') completed++;
      else if (a.status === 'CANCELLED') cancelled++;
      else if (a.status === 'NO_SHOW') noShow++;

      if (a.status !== 'CANCELLED') {
        totalSpending += a.price;
      }

      const start = new Date(a.startAt);
      if (start <= now && (a.status === 'COMPLETED' || a.status === 'CONFIRMED')) {
        if (!lastVisit || start > lastVisit) {
          lastVisit = start;
        }
      }

      if (start >= now && (a.status === 'CONFIRMED' || a.status === 'PENDING')) {
        if (!nextAppointment || start < nextAppointment) {
          nextAppointment = start;
        }
      }
    }

    const totalAppointments = customer.appointments.length;
    const avgAppointmentValue = completed > 0 ? totalSpending / completed : 0;

    let parsedTags: string[] = [];
    try {
      parsedTags = JSON.parse(customer.tags || '[]');
    } catch {
      parsedTags = [];
    }

    return {
      ...customer,
      tagsList: parsedTags,
      stats: {
        totalAppointments,
        completed,
        cancelled,
        noShow,
        totalSpending,
        avgAppointmentValue: Math.round(avgAppointmentValue),
        lastVisit,
        nextAppointment,
      },
    };
  }

  async update(businessId: string, id: string, dto: UpdateCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Customer not found');
    }

    const data: any = {};

    if (dto.name !== undefined) {
      if (!dto.name.trim()) {
        throw new BadRequestException('Customer name cannot be empty');
      }
      data.name = dto.name.trim();
    }

    if (dto.phone !== undefined) {
      const normalized = normalizePhone(dto.phone.trim());
      if (normalized.length < 8 || normalized.length > 20) {
        throw new BadRequestException('Invalid phone number format');
      }

      if (normalized !== existing.phone) {
        const duplicate = await this.prisma.customer.findUnique({
          where: {
            businessId_phone: {
              businessId,
              phone: normalized,
            },
          },
        });
        if (duplicate) {
          throw new ConflictException('A customer with this phone number already exists.');
        }
      }
      data.phone = normalized;
    }

    if (dto.email !== undefined) {
      if (dto.email && dto.email.trim()) {
        if (!isValidEmail(dto.email.trim())) {
          throw new BadRequestException('Invalid email address format');
        }
        data.email = dto.email.trim();
      } else {
        data.email = null;
      }
    }

    if (dto.notes !== undefined) {
      data.notes = dto.notes?.trim() || null;
    }

    if (dto.tags !== undefined) {
      data.tags = JSON.stringify(dto.tags);
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async remove(businessId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, businessId },
      include: {
        _count: {
          select: { appointments: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer._count.appointments > 0) {
      throw new BadRequestException(
        'Cannot delete a customer with appointment history. Mark as INACTIVE instead.',
      );
    }

    return this.prisma.customer.delete({
      where: { id },
    });
  }

  async findAppointments(
    businessId: string,
    id: string,
    filters: { page?: number; limit?: number } = {},
  ) {
    await this.findOne(businessId, id);

    const where = { businessId, customerId: id };
    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.max(1, Number(filters.limit || 10));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        include: {
          service: true,
          staff: true,
        },
        orderBy: { startAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getSummaryStats(businessId: string) {
    const [total, active, inactive, customers] = await Promise.all([
      this.prisma.customer.count({ where: { businessId } }),
      this.prisma.customer.count({ where: { businessId, status: 'ACTIVE' } }),
      this.prisma.customer.count({ where: { businessId, status: 'INACTIVE' } }),
      this.prisma.customer.findMany({
        where: { businessId },
        select: {
          id: true,
          createdAt: true,
          _count: { select: { appointments: true } },
        },
      }),
    ]);

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    let newThisMonth = 0;
    let returningCustomers = 0;

    for (const c of customers) {
      if (new Date(c.createdAt) >= startOfMonth) {
        newThisMonth++;
      }
      if (c._count.appointments > 1) {
        returningCustomers++;
      }
    }

    return {
      totalCustomers: total,
      active,
      inactive,
      newThisMonth,
      returningCustomers,
    };
  }
}
