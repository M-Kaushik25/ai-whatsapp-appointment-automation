import { describe, it, expect, beforeEach } from 'vitest';
import { ServicesService } from './services.service';
import { PrismaService } from '../prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('ServicesService', () => {
  let service: ServicesService;
  let prisma: PrismaService;

  const mockBusinessIdA = 'biz-a-1111';

  beforeEach(() => {
    prisma = new PrismaService();
    service = new ServicesService(prisma);
  });

  describe('Validation Rules', () => {
    it('should reject service with empty name', async () => {
      await expect(
        service.create(mockBusinessIdA, {
          name: '',
          durationMinutes: 30,
          price: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-positive duration', async () => {
      await expect(
        service.create(mockBusinessIdA, {
          name: 'Haircut',
          durationMinutes: 0,
          price: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative price', async () => {
      await expect(
        service.create(mockBusinessIdA, {
          name: 'Haircut',
          durationMinutes: 30,
          price: -100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative deposit', async () => {
      await expect(
        service.create(mockBusinessIdA, {
          name: 'Haircut',
          durationMinutes: 30,
          price: 500,
          depositType: 'FIXED',
          depositValue: -10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject percentage deposit greater than 100', async () => {
      await expect(
        service.create(mockBusinessIdA, {
          name: 'Haircut',
          durationMinutes: 30,
          price: 500,
          depositType: 'PERCENTAGE',
          depositValue: 120,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject fixed deposit exceeding price', async () => {
      await expect(
        service.create(mockBusinessIdA, {
          name: 'Haircut',
          durationMinutes: 30,
          price: 500,
          depositType: 'FIXED',
          depositValue: 600,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Multi-tenant isolation & Duplicate names', () => {
    it('should allow two different businesses to have service with the same name', async () => {
      // Create mock businesses in DB if needed or test with isolated names
      const uniqueSuffix = Date.now().toString();
      const serviceName = `Custom Service ${uniqueSuffix}`;

      // Clean up previous runs
      await prisma.service.deleteMany({
        where: { name: serviceName },
      });

      // Ensure businesses exist
      await prisma.business.upsert({
        where: { slug: `biz-a-${uniqueSuffix}` },
        update: {},
        create: { id: `biz-a-${uniqueSuffix}`, name: 'Biz A', slug: `biz-a-${uniqueSuffix}` },
      });
      await prisma.business.upsert({
        where: { slug: `biz-b-${uniqueSuffix}` },
        update: {},
        create: { id: `biz-b-${uniqueSuffix}`, name: 'Biz B', slug: `biz-b-${uniqueSuffix}` },
      });

      // Business A creates service
      const svcA = await service.create(`biz-a-${uniqueSuffix}`, {
        name: serviceName,
        durationMinutes: 45,
        price: 300,
      });
      expect(svcA.name).toBe(serviceName);

      // Business B can create service with same name
      const svcB = await service.create(`biz-b-${uniqueSuffix}`, {
        name: serviceName,
        durationMinutes: 60,
        price: 400,
      });
      expect(svcB.name).toBe(serviceName);

      // Duplicate in Business A must throw ConflictException
      await expect(
        service.create(`biz-a-${uniqueSuffix}`, {
          name: serviceName,
          durationMinutes: 30,
          price: 250,
        }),
      ).rejects.toThrow(ConflictException);

      // Business A cannot access Business B's service
      await expect(
        service.findOne(`biz-a-${uniqueSuffix}`, svcB.id),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
