import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CreateStaffDto {
  name: string;
  phone?: string;
  email?: string;
  active?: boolean;
}

export interface UpdateStaffDto {
  name?: string;
  phone?: string;
  email?: string;
  active?: boolean;
}

export interface WorkingHourItemDto {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  enabled: boolean;
}

export interface BreakDto {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface LeaveDto {
  startDate: string | Date;
  endDate: string | Date;
  reason?: string;
}

function timeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) {
    throw new BadRequestException(`Invalid time format "${timeStr}". Expected HH:mm`);
  }
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new BadRequestException(`Invalid time values in "${timeStr}".`);
  }
  return h * 60 + m;
}

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}

  async findAll(businessId: string, activeOnly?: boolean) {
    const where: any = { businessId };
    if (activeOnly) {
      where.active = true;
    }
    return this.prisma.staff.findMany({
      where,
      include: {
        services: {
          include: {
            service: true,
          },
        },
        workingHours: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(businessId: string, id: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id, businessId },
      include: {
        services: {
          include: {
            service: true,
          },
        },
        workingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        breaks: {
          orderBy: { dayOfWeek: 'asc' },
        },
        leaves: {
          orderBy: { startDate: 'asc' },
        },
      },
    });

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  async create(businessId: string, dto: CreateStaffDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Staff name is required');
    }

    const staff = await this.prisma.staff.create({
      data: {
        businessId,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        active: dto.active !== undefined ? Boolean(dto.active) : true,
      },
    });

    // Initialize default working hours: Mon-Sat 10:00-19:00, Sun disabled
    const defaultHours = [
      { dayOfWeek: 0, startTime: '10:00', endTime: '19:00', enabled: false }, // Sun
      { dayOfWeek: 1, startTime: '10:00', endTime: '19:00', enabled: true },  // Mon
      { dayOfWeek: 2, startTime: '10:00', endTime: '19:00', enabled: true },  // Tue
      { dayOfWeek: 3, startTime: '10:00', endTime: '19:00', enabled: true },  // Wed
      { dayOfWeek: 4, startTime: '10:00', endTime: '19:00', enabled: true },  // Thu
      { dayOfWeek: 5, startTime: '10:00', endTime: '19:00', enabled: true },  // Fri
      { dayOfWeek: 6, startTime: '10:00', endTime: '19:00', enabled: true },  // Sat
    ];

    for (const h of defaultHours) {
      await this.prisma.staffWorkingHours.create({
        data: {
          businessId,
          staffId: staff.id,
          dayOfWeek: h.dayOfWeek,
          startTime: h.startTime,
          endTime: h.endTime,
          enabled: h.enabled,
        },
      });
    }

    return this.findOne(businessId, staff.id);
  }

  async update(businessId: string, id: string, dto: UpdateStaffDto) {
    await this.findOne(businessId, id);

    if (dto.name !== undefined && (!dto.name || !dto.name.trim())) {
      throw new BadRequestException('Staff name cannot be empty');
    }

    return this.prisma.staff.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
        ...(dto.email !== undefined && { email: dto.email?.trim() || null }),
        ...(dto.active !== undefined && { active: Boolean(dto.active) }),
      },
    });
  }

  async remove(businessId: string, id: string) {
    await this.findOne(businessId, id);
    return this.prisma.staff.delete({
      where: { id },
    });
  }

  // --- STAFF-SERVICES ASSIGNMENT ---

  async getStaffServices(businessId: string, staffId: string) {
    await this.findOne(businessId, staffId);
    const records = await this.prisma.staffService.findMany({
      where: { staffId, businessId },
      include: { service: true },
    });
    return records.map((r) => r.service);
  }

  async setStaffServices(businessId: string, staffId: string, serviceIds: string[]) {
    await this.findOne(businessId, staffId);

    if (!Array.isArray(serviceIds)) {
      throw new BadRequestException('serviceIds must be an array of IDs');
    }

    // Validate that all services belong to this business
    if (serviceIds.length > 0) {
      const validServices = await this.prisma.service.findMany({
        where: {
          id: { in: serviceIds },
          businessId,
        },
      });

      if (validServices.length !== serviceIds.length) {
        throw new BadRequestException('One or more service IDs are invalid or belong to another business');
      }
    }

    // Atomic replacement of assignments
    return this.prisma.$transaction(async (tx) => {
      await tx.staffService.deleteMany({
        where: { staffId },
      });

      for (const serviceId of serviceIds) {
        await tx.staffService.create({
          data: {
            businessId,
            staffId,
            serviceId,
          },
        });
      }

      return tx.staffService.findMany({
        where: { staffId },
        include: { service: true },
      });
    });
  }

  // --- WORKING HOURS ---

  async getWorkingHours(businessId: string, staffId: string) {
    await this.findOne(businessId, staffId);
    return this.prisma.staffWorkingHours.findMany({
      where: { staffId, businessId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async setWorkingHours(businessId: string, staffId: string, schedule: WorkingHourItemDto[]) {
    await this.findOne(businessId, staffId);

    if (!Array.isArray(schedule)) {
      throw new BadRequestException('schedule must be an array');
    }

    // Validate each schedule item
    for (const item of schedule) {
      if (item.dayOfWeek < 0 || item.dayOfWeek > 6) {
        throw new BadRequestException(`Invalid dayOfWeek: ${item.dayOfWeek}. Must be 0-6.`);
      }

      if (item.enabled) {
        const startMin = timeToMinutes(item.startTime);
        const endMin = timeToMinutes(item.endTime);
        if (startMin >= endMin) {
          throw new BadRequestException(
            `Invalid hours for day ${item.dayOfWeek}: startTime (${item.startTime}) must be before endTime (${item.endTime})`,
          );
        }
      }
    }

    // Upsert each day's working hours
    return this.prisma.$transaction(async (tx) => {
      for (const item of schedule) {
        await tx.staffWorkingHours.upsert({
          where: {
            staffId_dayOfWeek: {
              staffId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          update: {
            startTime: item.startTime,
            endTime: item.endTime,
            enabled: Boolean(item.enabled),
          },
          create: {
            businessId,
            staffId,
            dayOfWeek: item.dayOfWeek,
            startTime: item.startTime,
            endTime: item.endTime,
            enabled: Boolean(item.enabled),
          },
        });
      }

      return tx.staffWorkingHours.findMany({
        where: { staffId },
        orderBy: { dayOfWeek: 'asc' },
      });
    });
  }

  // --- BREAKS ---

  async getBreaks(businessId: string, staffId: string) {
    await this.findOne(businessId, staffId);
    return this.prisma.staffBreak.findMany({
      where: { staffId, businessId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async addBreak(businessId: string, staffId: string, dto: BreakDto) {
    await this.findOne(businessId, staffId);

    if (dto.dayOfWeek < 0 || dto.dayOfWeek > 6) {
      throw new BadRequestException(`Invalid dayOfWeek ${dto.dayOfWeek}`);
    }

    const breakStart = timeToMinutes(dto.startTime);
    const breakEnd = timeToMinutes(dto.endTime);

    if (breakStart >= breakEnd) {
      throw new BadRequestException('Break start time must be before break end time');
    }

    // Check staff working hours for that day
    const workingHours = await this.prisma.staffWorkingHours.findUnique({
      where: {
        staffId_dayOfWeek: {
          staffId,
          dayOfWeek: dto.dayOfWeek,
        },
      },
    });

    if (!workingHours || !workingHours.enabled) {
      throw new BadRequestException(`Staff is not working on day ${dto.dayOfWeek}`);
    }

    const workStart = timeToMinutes(workingHours.startTime);
    const workEnd = timeToMinutes(workingHours.endTime);

    if (breakStart < workStart || breakEnd > workEnd) {
      throw new BadRequestException(
        `Break (${dto.startTime} - ${dto.endTime}) must be within working hours (${workingHours.startTime} - ${workingHours.endTime})`,
      );
    }

    // Check overlapping breaks
    const existingBreaks = await this.prisma.staffBreak.findMany({
      where: { staffId, dayOfWeek: dto.dayOfWeek },
    });

    for (const b of existingBreaks) {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);

      if (Math.max(breakStart, bStart) < Math.min(breakEnd, bEnd)) {
        throw new BadRequestException(
          `Break overlaps with existing break (${b.startTime} - ${b.endTime})`,
        );
      }
    }

    return this.prisma.staffBreak.create({
      data: {
        businessId,
        staffId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
  }

  async updateBreak(businessId: string, staffId: string, breakId: string, dto: BreakDto) {
    await this.findOne(businessId, staffId);

    const existing = await this.prisma.staffBreak.findFirst({
      where: { id: breakId, staffId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Break not found');
    }

    const dayOfWeek = dto.dayOfWeek !== undefined ? dto.dayOfWeek : existing.dayOfWeek;
    const startTimeStr = dto.startTime || existing.startTime;
    const endTimeStr = dto.endTime || existing.endTime;

    const breakStart = timeToMinutes(startTimeStr);
    const breakEnd = timeToMinutes(endTimeStr);

    if (breakStart >= breakEnd) {
      throw new BadRequestException('Break start time must be before break end time');
    }

    // Check staff working hours
    const workingHours = await this.prisma.staffWorkingHours.findUnique({
      where: {
        staffId_dayOfWeek: {
          staffId,
          dayOfWeek,
        },
      },
    });

    if (!workingHours || !workingHours.enabled) {
      throw new BadRequestException(`Staff is not working on day ${dayOfWeek}`);
    }

    const workStart = timeToMinutes(workingHours.startTime);
    const workEnd = timeToMinutes(workingHours.endTime);

    if (breakStart < workStart || breakEnd > workEnd) {
      throw new BadRequestException(
        `Break (${startTimeStr} - ${endTimeStr}) must be within working hours (${workingHours.startTime} - ${workingHours.endTime})`,
      );
    }

    // Check overlap with other breaks
    const otherBreaks = await this.prisma.staffBreak.findMany({
      where: { staffId, dayOfWeek, id: { not: breakId } },
    });

    for (const b of otherBreaks) {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);

      if (Math.max(breakStart, bStart) < Math.min(breakEnd, bEnd)) {
        throw new BadRequestException(
          `Break overlaps with existing break (${b.startTime} - ${b.endTime})`,
        );
      }
    }

    return this.prisma.staffBreak.update({
      where: { id: breakId },
      data: {
        dayOfWeek,
        startTime: startTimeStr,
        endTime: endTimeStr,
      },
    });
  }

  async deleteBreak(businessId: string, staffId: string, breakId: string) {
    await this.findOne(businessId, staffId);
    const existing = await this.prisma.staffBreak.findFirst({
      where: { id: breakId, staffId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Break not found');
    }
    return this.prisma.staffBreak.delete({
      where: { id: breakId },
    });
  }

  // --- LEAVE ---

  async getLeaves(businessId: string, staffId: string) {
    await this.findOne(businessId, staffId);
    return this.prisma.staffLeave.findMany({
      where: { staffId, businessId },
      orderBy: { startDate: 'asc' },
    });
  }

  async addLeave(businessId: string, staffId: string, dto: LeaveDto) {
    await this.findOne(businessId, staffId);

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format for startDate or endDate');
    }

    if (start > end) {
      throw new BadRequestException('Leave start date must be on or before end date');
    }

    // Check overlapping leaves
    const existingLeaves = await this.prisma.staffLeave.findMany({
      where: { staffId },
    });

    for (const l of existingLeaves) {
      const lStart = new Date(l.startDate);
      const lEnd = new Date(l.endDate);

      if (start <= lEnd && end >= lStart) {
        throw new BadRequestException(
          `Leave overlaps with existing leave (${lStart.toISOString().slice(0, 10)} to ${lEnd.toISOString().slice(0, 10)})`,
        );
      }
    }

    return this.prisma.staffLeave.create({
      data: {
        businessId,
        staffId,
        startDate: start,
        endDate: end,
        reason: dto.reason?.trim() || null,
      },
    });
  }

  async updateLeave(businessId: string, staffId: string, leaveId: string, dto: LeaveDto) {
    await this.findOne(businessId, staffId);

    const existing = await this.prisma.staffLeave.findFirst({
      where: { id: leaveId, staffId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Leave not found');
    }

    const start = dto.startDate ? new Date(dto.startDate) : new Date(existing.startDate);
    const end = dto.endDate ? new Date(dto.endDate) : new Date(existing.endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    if (start > end) {
      throw new BadRequestException('Leave start date must be on or before end date');
    }

    const otherLeaves = await this.prisma.staffLeave.findMany({
      where: { staffId, id: { not: leaveId } },
    });

    for (const l of otherLeaves) {
      const lStart = new Date(l.startDate);
      const lEnd = new Date(l.endDate);

      if (start <= lEnd && end >= lStart) {
        throw new BadRequestException(
          `Leave overlaps with existing leave (${lStart.toISOString().slice(0, 10)} to ${lEnd.toISOString().slice(0, 10)})`,
        );
      }
    }

    return this.prisma.staffLeave.update({
      where: { id: leaveId },
      data: {
        startDate: start,
        endDate: end,
        reason: dto.reason !== undefined ? (dto.reason?.trim() || null) : existing.reason,
      },
    });
  }

  async deleteLeave(businessId: string, staffId: string, leaveId: string) {
    await this.findOne(businessId, staffId);
    const existing = await this.prisma.staffLeave.findFirst({
      where: { id: leaveId, staffId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Leave not found');
    }
    return this.prisma.staffLeave.delete({
      where: { id: leaveId },
    });
  }
}
