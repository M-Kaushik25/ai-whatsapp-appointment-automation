import { describe, it, expect, beforeEach } from 'vitest';
import { CustomersService, normalizePhone } from './customers.service';
import { PrismaService } from '../prisma.service';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('CustomersService & Phone Normalization', () => {
  let customersService: CustomersService;
  let prisma: PrismaService;

  let bizA: string;
  let bizB: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    customersService = new CustomersService(prisma);

    const unique = Math.random().toString(36).substring(7) + Date.now().toString();
    bizA = `biz-crm-a-${unique}`;
    bizB = `biz-crm-b-${unique}`;

    await prisma.business.create({
      data: {
        id: bizA,
        name: 'CRM Biz A',
        slug: bizA,
      },
    });

    await prisma.business.create({
      data: {
        id: bizB,
        name: 'CRM Biz B',
        slug: bizB,
      },
    });
  });

  describe('Phone Normalization Helper', () => {
    it('should normalize 10-digit Indian numbers to E.164 +91 format', () => {
      expect(normalizePhone('9876543210')).toBe('+919876543210');
      expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
      expect(normalizePhone('09876543210')).toBe('+919876543210');
      expect(normalizePhone('+91-98765-43210')).toBe('+919876543210');
      expect(normalizePhone('919876543210')).toBe('+919876543210');
    });

    it('should preserve international numbers with + prefix', () => {
      expect(normalizePhone('+1 202 555 0123')).toBe('+12025550123');
      expect(normalizePhone('+44 20 7946 0912')).toBe('+442079460912');
    });
  });

  describe('Customer Creation & Duplicate Prevention', () => {
    it('should create customer with normalized phone and default ACTIVE status', async () => {
      const customer = await customersService.create(bizA, {
        name: 'Rohit Sharma',
        phone: '9876543210',
        email: 'rohit@example.com',
        tags: ['VIP', 'Regular'],
        notes: 'Prefers afternoon appointments',
      });

      expect(customer.id).toBeDefined();
      expect(customer.name).toBe('Rohit Sharma');
      expect(customer.phone).toBe('+919876543210');
      expect(customer.status).toBe('ACTIVE');
      expect(JSON.parse(customer.tags)).toEqual(['VIP', 'Regular']);
    });

    it('should reject duplicate customer with differently formatted phone in the same business', async () => {
      await customersService.create(bizA, {
        name: 'First User',
        phone: '9876543210',
      });

      // Attempt to create another with '+91 98765 43210' must throw ConflictException
      await expect(
        customersService.create(bizA, {
          name: 'Duplicate User',
          phone: '+91 98765 43210',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow the same phone number in a different business (multi-tenant isolation)', async () => {
      const custA = await customersService.create(bizA, {
        name: 'User In Biz A',
        phone: '9876543210',
      });

      const custB = await customersService.create(bizB, {
        name: 'User In Biz B',
        phone: '9876543210',
      });

      expect(custA.id).toBeDefined();
      expect(custB.id).toBeDefined();
      expect(custA.id).not.toBe(custB.id);
    });

    it('should validate customer input (empty name, invalid email)', async () => {
      await expect(
        customersService.create(bizA, {
          name: '',
          phone: '9876543210',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        customersService.create(bizA, {
          name: 'Valid Name',
          phone: '9876543210',
          email: 'invalid-email-string',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Customer Update, Status & Safe Deletion', () => {
    it('should update customer fields and re-normalize phone', async () => {
      const cust = await customersService.create(bizA, {
        name: 'Initial Name',
        phone: '9876543210',
      });

      const updated = await customersService.update(bizA, cust.id, {
        name: 'Updated Name',
        phone: '9123456789',
        status: 'INACTIVE',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.phone).toBe('+919123456789');
      expect(updated.status).toBe('INACTIVE');
    });

    it('should allow deleting customer with 0 appointments', async () => {
      const cust = await customersService.create(bizA, {
        name: 'Delete Me',
        phone: '9999988888',
      });

      await customersService.remove(bizA, cust.id);

      await expect(customersService.findOne(bizA, cust.id)).rejects.toThrow(NotFoundException);
    });

    it('should reject deleting customer who has appointment history', async () => {
      const cust = await customersService.create(bizA, {
        name: 'Booked Customer',
        phone: '9888877777',
      });

      const svc = await prisma.service.create({
        data: {
          businessId: bizA,
          name: 'Test Svc ' + Date.now(),
          durationMinutes: 30,
          price: 500,
        },
      });

      const st = await prisma.staff.create({
        data: {
          businessId: bizA,
          name: 'Test Staff',
        },
      });

      // Create an appointment for this customer
      await prisma.appointment.create({
        data: {
          businessId: bizA,
          customerId: cust.id,
          serviceId: svc.id,
          staffId: st.id,
          startAt: new Date(),
          endAt: new Date(Date.now() + 30 * 60 * 1000),
          status: 'COMPLETED',
          price: 500,
        },
      });

      // Deleting this customer must throw BadRequestException
      await expect(customersService.remove(bizA, cust.id)).rejects.toThrow(BadRequestException);
    });
  });

  describe('Search, Filters, Pagination & Summary Stats', () => {
    it('should search customers by name and phone', async () => {
      await customersService.create(bizA, { name: 'Priya Sharma', phone: '9811122233' });
      await customersService.create(bizA, { name: 'Arun Verma', phone: '9844455566' });

      const byName = (await customersService.findAll(bizA, { search: 'Priya' })) as any[];
      expect(byName.length).toBe(1);
      expect(byName[0].name).toBe('Priya Sharma');

      const byPhone = (await customersService.findAll(bizA, { search: '98444' })) as any[];
      expect(byPhone.length).toBe(1);
      expect(byPhone[0].name).toBe('Arun Verma');
    });

    it('should return pagination metadata', async () => {
      await customersService.create(bizA, { name: 'User 1', phone: '9111100001' });
      await customersService.create(bizA, { name: 'User 2', phone: '9111100002' });

      const result = (await customersService.findAll(bizA, { page: 1, limit: 1 })) as any;
      expect(result.items.length).toBe(1);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(1);
      expect(result.totalPages).toBeGreaterThanOrEqual(2);
    });

    it('should compute customer profile statistics', async () => {
      const cust = await customersService.create(bizA, { name: 'Stats Customer', phone: '9777766666' });

      const svc = await prisma.service.create({
        data: {
          businessId: bizA,
          name: 'Spa Svc ' + Date.now(),
          durationMinutes: 60,
          price: 1200,
        },
      });

      const st = await prisma.staff.create({
        data: {
          businessId: bizA,
          name: 'Spa Specialist',
        },
      });

      // Completed appt
      await prisma.appointment.create({
        data: {
          businessId: bizA,
          customerId: cust.id,
          serviceId: svc.id,
          staffId: st.id,
          startAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          endAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
          status: 'COMPLETED',
          price: 1200,
        },
      });

      // Cancelled appt (should not be counted in revenue)
      await prisma.appointment.create({
        data: {
          businessId: bizA,
          customerId: cust.id,
          serviceId: svc.id,
          staffId: st.id,
          startAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          endAt: new Date(Date.now() - 47 * 60 * 60 * 1000),
          status: 'CANCELLED',
          price: 1200,
        },
      });

      const details = await customersService.findOne(bizA, cust.id);
      expect(details.stats.totalAppointments).toBe(2);
      expect(details.stats.completed).toBe(1);
      expect(details.stats.cancelled).toBe(1);
      expect(details.stats.totalSpending).toBe(1200); // Only completed appt counted
      expect(details.stats.avgAppointmentValue).toBe(1200);
      expect(details.stats.lastVisit).toBeDefined();
    });
  });
});
