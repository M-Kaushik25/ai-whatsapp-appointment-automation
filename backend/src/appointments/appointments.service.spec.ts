import { describe, it, expect, beforeEach } from 'vitest';
import { AppointmentsService } from './appointments.service';
import { PrismaService } from '../prisma.service';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('AppointmentsService', () => {
  let appointmentsService: AppointmentsService;
  let prisma: PrismaService;

  let bizA: string;
  let bizB: string;
  let serviceId: string;
  let staffId: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    appointmentsService = new AppointmentsService(prisma);

    const unique = Math.random().toString(36).substring(7) + Date.now().toString();
    bizA = `biz-appt-a-${unique}`;
    bizB = `biz-appt-b-${unique}`;

    // Create Business A
    await prisma.business.create({
      data: {
        id: bizA,
        name: 'Appt Biz A',
        slug: bizA,
        settings: JSON.stringify({
          timezone: 'Asia/Kolkata',
          bufferMinutes: 0,
          minimumBookingNoticeMinutes: 0, // 0 for test convenience
          maximumAdvanceBookingDays: 30,
        }),
      },
    });

    // Create Business B
    await prisma.business.create({
      data: {
        id: bizB,
        name: 'Appt Biz B',
        slug: bizB,
      },
    });

    // Create Service (30 min)
    const svc = await prisma.service.create({
      data: {
        businessId: bizA,
        name: `Precision Cut ${unique}`,
        durationMinutes: 30,
        price: 500,
        depositType: 'FIXED',
        depositValue: 100,
        active: true,
      },
    });
    serviceId = svc.id;

    // Create Staff
    const st = await prisma.staff.create({
      data: {
        businessId: bizA,
        name: `Arun ${unique}`,
        active: true,
      },
    });
    staffId = st.id;

    // Assign service to staff
    await prisma.staffService.create({
      data: {
        businessId: bizA,
        staffId: st.id,
        serviceId: svc.id,
      },
    });

    // Set working hours for every day 08:00 - 20:00
    for (let day = 0; day <= 6; day++) {
      await prisma.staffWorkingHours.create({
        data: {
          businessId: bizA,
          staffId: st.id,
          dayOfWeek: day,
          startTime: '08:00',
          endTime: '20:00',
          enabled: true,
        },
      });
    }
  });

  describe('Sequential Booking & Validations', () => {
    it('should create an appointment and calculate endAt and deposit', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const startAt = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 10, 0, 0));

      const appt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Aarav Patel',
        customerPhone: '+919999911111',
      });

      expect(appt.id).toBeDefined();
      expect(appt.status).toBe('CONFIRMED');
      expect(appt.price).toBe(500);
      expect(appt.depositAmount).toBe(100);

      const expectedEnd = new Date(startAt.getTime() + 30 * 60 * 1000);
      expect(new Date(appt.endAt).toISOString()).toBe(expectedEnd.toISOString());
    });

    it('should prevent booking an already booked slot (sequential duplicate)', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 3);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 14, 0, 0));

      // 1st booking
      await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Customer One',
        customerPhone: '+919999922222',
      });

      // 2nd booking attempt for exact same slot must throw ConflictException
      await expect(
        appointmentsService.createAppointment(bizA, {
          serviceId,
          staffId,
          startAt: startAt.toISOString(),
          customerName: 'Customer Two',
          customerPhone: '+919999933333',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should make slot available again after appointment cancellation', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 4);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 15, 0, 0));

      const appt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Cancel Test Customer',
        customerPhone: '+919999944444',
      });

      // Cancel appointment
      await appointmentsService.cancel(bizA, appt.id);

      // Same slot can now be booked by another customer
      const newAppt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Replacement Customer',
        customerPhone: '+919999955555',
      });

      expect(newAppt.id).toBeDefined();
      expect(newAppt.status).toBe('CONFIRMED');
    });

    it('should reject booking in the past', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

      await expect(
        appointmentsService.createAppointment(bizA, {
          serviceId,
          staffId,
          startAt: pastDate.toISOString(),
          customerName: 'Past Booker',
          customerPhone: '+919999966666',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should enforce multi-tenant isolation', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 5);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 16, 0, 0));

      const appt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Tenant Customer',
        customerPhone: '+919999977777',
      });

      // Business B cannot view or cancel Business A appointment
      await expect(appointmentsService.findOne(bizB, appt.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(appointmentsService.cancel(bizB, appt.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Status Lifecycle Transitions (Phase 5)', () => {
    it('should transition CONFIRMED to COMPLETED', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 7);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 10, 0, 0));

      const appt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Complete Test',
        customerPhone: '+919999988888',
      });

      const completed = await appointmentsService.complete(bizA, appt.id);
      expect(completed.status).toBe('COMPLETED');
    });

    it('should transition CONFIRMED to NO_SHOW', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 7);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 11, 0, 0));

      const appt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'NoShow Test',
        customerPhone: '+919999988889',
      });

      const noShow = await appointmentsService.markNoShow(bizA, appt.id);
      expect(noShow.status).toBe('NO_SHOW');
    });

    it('should reject invalid transition (e.g. CANCELLED -> COMPLETED)', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 7);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 12, 0, 0));

      const appt = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Invalid Trans Test',
        customerPhone: '+919999988890',
      });

      await appointmentsService.cancel(bizA, appt.id);

      await expect(appointmentsService.complete(bizA, appt.id)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Search, Filters, Pagination & Daily Stats (Phase 5)', () => {
    it('should filter appointments by search term across customer name and phone', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 8);
      const startAt1 = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 10, 0, 0));
      const startAt2 = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 11, 0, 0));

      await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt1.toISOString(),
        customerName: 'Special Unique Name',
        customerPhone: '+919111122222',
      });

      await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt2.toISOString(),
        customerName: 'Another Regular Customer',
        customerPhone: '+919333344444',
      });

      const searchResults = (await appointmentsService.findAll(bizA, { search: 'Special Unique' })) as any[];
      expect(searchResults.length).toBe(1);
      expect(searchResults[0].customer.name).toBe('Special Unique Name');
    });

    it('should support pagination metadata', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 9);
      const startAt = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 10, 0, 0));

      await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt.toISOString(),
        customerName: 'Paginated Customer',
        customerPhone: '+919555566666',
      });

      const paginatedResult = (await appointmentsService.findAll(bizA, { page: 1, limit: 10 })) as any;
      expect(paginatedResult.items).toBeDefined();
      expect(paginatedResult.total).toBeGreaterThanOrEqual(1);
      expect(paginatedResult.page).toBe(1);
      expect(paginatedResult.limit).toBe(10);
      expect(paginatedResult.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('should calculate daily stats and revenue excluding cancelled appointments', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 10);
      const dateStr = targetDate.toISOString().slice(0, 10);

      const startAt1 = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 10, 0, 0));
      const startAt2 = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 11, 0, 0));

      const a1 = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt1.toISOString(),
        customerName: 'Stats Confirmed',
        customerPhone: '+919777788881',
      });

      const a2 = await appointmentsService.createAppointment(bizA, {
        serviceId,
        staffId,
        startAt: startAt2.toISOString(),
        customerName: 'Stats Cancelled',
        customerPhone: '+919777788882',
      });

      await appointmentsService.cancel(bizA, a2.id);

      const stats = await appointmentsService.getDailyStats(bizA, dateStr);
      expect(stats.total).toBe(2);
      expect(stats.confirmed).toBe(1);
      expect(stats.cancelled).toBe(1);
      expect(stats.estimatedRevenue).toBe(500); // Only a1 price (500), a2 is cancelled
    });
  });

  describe('CONCURRENCY TEST — Double-Booking Prevention', () => {
    it('should handle 10 concurrent booking requests for the exact same slot: exactly 1 succeeds, 9 fail', async () => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 6);
      const slotTime = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), 11, 0, 0));
      const slotIso = slotTime.toISOString();

      // Launch 10 simultaneous booking attempts using Promise.allSettled
      const promises = Array.from({ length: 10 }, (_, i) =>
        appointmentsService.createAppointment(bizA, {
          serviceId,
          staffId,
          startAt: slotIso,
          customerName: `Concurrent Customer ${i + 1}`,
          customerPhone: `+91988880000${i}`,
        }),
      );

      const results = await Promise.allSettled(promises);

      const successful = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      console.log(`Concurrency Test Results: Successful=${successful.length}, Rejected=${rejected.length}`);

      // EXACTLY ONE booking must succeed
      expect(successful.length).toBe(1);

      // EXACTLY NINE bookings must be rejected
      expect(rejected.length).toBe(9);

      // All rejections must be ConflictException
      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          expect(rej.reason).toBeInstanceOf(ConflictException);
        }
      }

      // Verify only 1 appointment exists in DB for that slot
      const countInDb = await prisma.appointment.count({
        where: {
          staffId,
          businessId: bizA,
          startAt: slotTime,
          status: 'CONFIRMED',
        },
      });
      expect(countInDb).toBe(1);
    });
  });
});
