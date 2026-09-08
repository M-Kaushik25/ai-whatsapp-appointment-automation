import { describe, it, expect, beforeEach } from 'vitest';
import { AvailabilityService } from './availability.service';
import { PrismaService } from '../prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('AvailabilityService', () => {
  let availabilityService: AvailabilityService;
  let prisma: PrismaService;

  let bizId: string;
  let service30Id: string;
  let service60Id: string;
  let staffPriyaId: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    availabilityService = new AvailabilityService(prisma);

    const unique = Math.random().toString(36).substring(7) + Date.now().toString();
    bizId = `biz-avail-${unique}`;

    // Create business with settings
    await prisma.business.create({
      data: {
        id: bizId,
        name: 'Avail Biz',
        slug: bizId,
        settings: JSON.stringify({
          timezone: 'Asia/Kolkata',
          bufferMinutes: 0,
          minimumBookingNoticeMinutes: 0, // 0 for test convenience
          maximumAdvanceBookingDays: 30,
        }),
      },
    });

    // Create 30min and 60min services
    const svc30 = await prisma.service.create({
      data: {
        businessId: bizId,
        name: `Haircut ${unique}`,
        durationMinutes: 30,
        price: 500,
        depositType: 'FIXED',
        depositValue: 100,
        active: true,
      },
    });
    service30Id = svc30.id;

    const svc60 = await prisma.service.create({
      data: {
        businessId: bizId,
        name: `Hair Spa ${unique}`,
        durationMinutes: 60,
        price: 1000,
        active: true,
      },
    });
    service60Id = svc60.id;

    // Create Staff Priya
    const staff = await prisma.staff.create({
      data: {
        businessId: bizId,
        name: `Priya ${unique}`,
        active: true,
      },
    });
    staffPriyaId = staff.id;

    // Assign only 30min service to Priya
    await prisma.staffService.create({
      data: {
        businessId: bizId,
        staffId: staff.id,
        serviceId: service30Id,
      },
    });

    // Set Monday (day 1) working hours 10:00 - 19:00
    await prisma.staffWorkingHours.create({
      data: {
        businessId: bizId,
        staffId: staff.id,
        dayOfWeek: 1, // Monday
        startTime: '10:00',
        endTime: '19:00',
        enabled: true,
      },
    });

    // Set Sunday (day 0) disabled
    await prisma.staffWorkingHours.create({
      data: {
        businessId: bizId,
        staffId: staff.id,
        dayOfWeek: 0, // Sunday
        startTime: '10:00',
        endTime: '19:00',
        enabled: false,
      },
    });

    // Add Break on Monday: 13:00 - 14:00
    await prisma.staffBreak.create({
      data: {
        businessId: bizId,
        staffId: staff.id,
        dayOfWeek: 1,
        startTime: '13:00',
        endTime: '14:00',
      },
    });
  });

  describe('Slot Generation Rules', () => {
    it('should generate slots for a working Monday excluding break times', async () => {
      const monday = new Date();
      monday.setDate(monday.getDate() + ((1 + 7 - monday.getDay()) % 7 || 7));
      const mondayStr = monday.toISOString().slice(0, 10);

      const res = await availabilityService.getAvailableSlots(bizId, {
        serviceId: service30Id,
        staffId: staffPriyaId,
        date: mondayStr,
      });

      expect(res.slots.length).toBeGreaterThan(0);
      expect(res.slots.some((s) => s.startTime === '10:00')).toBe(true);
      expect(res.slots.some((s) => s.startTime === '12:30')).toBe(true);

      // 13:00 and 13:30 MUST NOT be present because break is 13:00-14:00
      expect(res.slots.some((s) => s.startTime === '13:00')).toBe(false);
      expect(res.slots.some((s) => s.startTime === '13:30')).toBe(false);

      // 14:00 must be available
      expect(res.slots.some((s) => s.startTime === '14:00')).toBe(true);
    });

    it('should return 0 slots for a closed Sunday', async () => {
      const sunday = new Date();
      sunday.setDate(sunday.getDate() + ((0 + 7 - sunday.getDay()) % 7 || 7));
      const sundayStr = sunday.toISOString().slice(0, 10);

      const res = await availabilityService.getAvailableSlots(bizId, {
        serviceId: service30Id,
        staffId: staffPriyaId,
        date: sundayStr,
      });

      expect(res.slots.length).toBe(0);
    });

    it('should return 0 slots on a business holiday', async () => {
      const holidayDate = new Date();
      holidayDate.setDate(holidayDate.getDate() + 5);
      const holidayStr = holidayDate.toISOString().slice(0, 10);

      const [y, m, d] = holidayStr.split('-').map(Number);
      await prisma.businessHoliday.create({
        data: {
          businessId: bizId,
          date: new Date(Date.UTC(y, m - 1, d, 0, 0, 0)),
          name: 'Festival Holiday',
        },
      });

      const res = await availabilityService.getAvailableSlots(bizId, {
        serviceId: service30Id,
        staffId: staffPriyaId,
        date: holidayStr,
      });

      expect(res.slots.length).toBe(0);
    });

    it('should reject when staff does not offer the requested service', async () => {
      const monday = new Date();
      monday.setDate(monday.getDate() + ((1 + 7 - monday.getDay()) % 7 || 7));
      const mondayStr = monday.toISOString().slice(0, 10);

      await expect(
        availabilityService.getAvailableSlots(bizId, {
          serviceId: service60Id, // Not assigned to Priya
          staffId: staffPriyaId,
          date: mondayStr,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
