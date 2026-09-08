import { describe, it, expect, beforeEach } from 'vitest';
import { HolidaysService } from './holidays.service';
import { PrismaService } from '../prisma.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('HolidaysService', () => {
  let holidaysService: HolidaysService;
  let prisma: PrismaService;

  const uniqueSuffix = Date.now().toString();
  const bizA = `biz-holidays-a-${uniqueSuffix}`;
  const bizB = `biz-holidays-b-${uniqueSuffix}`;

  beforeEach(async () => {
    prisma = new PrismaService();
    holidaysService = new HolidaysService(prisma);

    await prisma.business.upsert({
      where: { slug: bizA },
      update: {},
      create: { id: bizA, name: 'Holiday Biz A', slug: bizA },
    });
    await prisma.business.upsert({
      where: { slug: bizB },
      update: {},
      create: { id: bizB, name: 'Holiday Biz B', slug: bizB },
    });
  });

  describe('Holidays CRUD & Multi-Tenancy', () => {
    it('should create holiday and prevent duplicate on same date for same business', async () => {
      const date = new Date('2026-10-02T00:00:00.000Z');

      const holidayA = await holidaysService.create(bizA, {
        name: 'Gandhi Jayanti',
        date,
      });

      expect(holidayA.name).toBe('Gandhi Jayanti');

      // Duplicate for Biz A should throw ConflictException
      await expect(
        holidaysService.create(bizA, {
          name: 'National Holiday',
          date,
        }),
      ).rejects.toThrow(ConflictException);

      // Same date for Biz B is allowed
      const holidayB = await holidaysService.create(bizB, {
        name: 'Gandhi Jayanti',
        date,
      });
      expect(holidayB.name).toBe('Gandhi Jayanti');

      // Biz A cannot find Biz B holiday
      await expect(holidaysService.findOne(bizA, holidayB.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
