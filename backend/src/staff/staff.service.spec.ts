import { describe, it, expect, beforeEach } from 'vitest';
import { StaffService } from './staff.service';
import { PrismaService } from '../prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('StaffService', () => {
  let staffService: StaffService;
  let prisma: PrismaService;

  const uniqueSuffix = Date.now().toString();
  const bizA = `biz-staff-a-${uniqueSuffix}`;
  const bizB = `biz-staff-b-${uniqueSuffix}`;

  beforeEach(async () => {
    prisma = new PrismaService();
    staffService = new StaffService(prisma);

    await prisma.business.upsert({
      where: { slug: bizA },
      update: {},
      create: { id: bizA, name: 'Staff Biz A', slug: bizA },
    });
    await prisma.business.upsert({
      where: { slug: bizB },
      update: {},
      create: { id: bizB, name: 'Staff Biz B', slug: bizB },
    });
  });

  describe('Staff CRUD & Multi-Tenancy', () => {
    it('should create staff and initialize default working hours', async () => {
      const staff = await staffService.create(bizA, {
        name: 'John Doe',
        phone: '+919999999999',
        email: 'john@example.com',
      });

      expect(staff.name).toBe('John Doe');
      expect(staff.workingHours.length).toBe(7);

      // Biz B cannot access Biz A staff
      await expect(staffService.findOne(bizB, staff.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject staff creation with empty name', async () => {
      await expect(
        staffService.create(bizA, { name: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Working Hours & Schedule Validation', () => {
    it('should reject invalid working hours where start >= end', async () => {
      const staff = await staffService.create(bizA, { name: 'Time Tester' });

      await expect(
        staffService.setWorkingHours(bizA, staff.id, [
          { dayOfWeek: 1, startTime: '19:00', endTime: '10:00', enabled: true },
        ]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Breaks Validation', () => {
    it('should reject break outside working hours', async () => {
      const staff = await staffService.create(bizA, { name: 'Break Tester' });

      // Monday is 10:00 - 19:00
      await expect(
        staffService.addBreak(bizA, staff.id, {
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '09:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject overlapping breaks on the same day', async () => {
      const staff = await staffService.create(bizA, { name: 'Overlap Break Tester' });

      // First break 13:00 - 14:00
      await staffService.addBreak(bizA, staff.id, {
        dayOfWeek: 1,
        startTime: '13:00',
        endTime: '14:00',
      });

      // Overlapping break 13:30 - 14:30
      await expect(
        staffService.addBreak(bizA, staff.id, {
          dayOfWeek: 1,
          startTime: '13:30',
          endTime: '14:30',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Leave Validation', () => {
    it('should reject leave where start date is after end date', async () => {
      const staff = await staffService.create(bizA, { name: 'Leave Tester' });

      await expect(
        staffService.addLeave(bizA, staff.id, {
          startDate: '2026-09-20',
          endDate: '2026-09-10',
          reason: 'Invalid order',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject overlapping leave periods', async () => {
      const staff = await staffService.create(bizA, { name: 'Overlap Leave Tester' });

      await staffService.addLeave(bizA, staff.id, {
        startDate: '2026-09-10',
        endDate: '2026-09-15',
        reason: 'Vacation',
      });

      await expect(
        staffService.addLeave(bizA, staff.id, {
          startDate: '2026-09-12',
          endDate: '2026-09-18',
          reason: 'Overlap',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
