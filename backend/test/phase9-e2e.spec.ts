import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NotificationsService, NotificationType, NotificationStatus } from '../src/notifications/notifications.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { WhatsAppService } from '../src/whatsapp/whatsapp.service';
import { MockWhatsAppProvider } from '../src/whatsapp/providers/mock-whatsapp.provider';

describe('Phase 9 End-to-End Lifecycle Verification', () => {
  let prisma: PrismaClient;
  let notificationsService: NotificationsService;
  let appointmentsService: AppointmentsService;
  let whatsAppService: WhatsAppService;
  let mockProvider: MockWhatsAppProvider;

  const testSuffix = Date.now().toString(36);
  let businessId: string;
  let customerId: string;
  let staffId: string;
  let serviceId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    mockProvider = new MockWhatsAppProvider();
    whatsAppService = new WhatsAppService(prisma as any, mockProvider, null as any);
    notificationsService = new NotificationsService(prisma as any, whatsAppService);
    appointmentsService = new AppointmentsService(prisma as any, notificationsService);

    // Seed test business
    const business = await prisma.business.create({
      data: {
        name: `Phase 9 Salon ${testSuffix}`,
        slug: `phase9-salon-${testSuffix}`,
        phone: '+919876543210',
        settings: JSON.stringify({ timezone: 'Asia/Kolkata', bufferMinutes: 0 }),
      },
    });
    businessId = business.id;

    // Seed WhatsApp config
    await prisma.whatsAppIntegration.create({
      data: {
        businessId,
        phoneNumberId: `phone_id_${testSuffix}`,
        accessToken: 'EAAG_test_token_phase9',
        status: 'CONNECTED',
      },
    });

    // Seed Service
    const svc = await prisma.service.create({
      data: {
        businessId,
        name: `Luxury Cut ${testSuffix}`,
        durationMinutes: 30,
        price: 750,
      },
    });
    serviceId = svc.id;

    // Seed Staff
    const stf = await prisma.staff.create({
      data: {
        businessId,
        name: 'Master Barber Sam',
        workingHours: {
          create: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            businessId,
            dayOfWeek: day,
            startTime: '08:00',
            endTime: '20:00',
            enabled: true,
          })),
        },
        services: {
          create: {
            businessId,
            serviceId: svc.id,
          },
        },
      },
    });
    staffId = stf.id;

    // Seed Customer
    const cust = await prisma.customer.create({
      data: {
        businessId,
        name: 'Vikram Seth',
        phone: '+919988776655',
        status: 'ACTIVE',
      },
    });
    customerId = cust.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.appointmentNotification.deleteMany({ where: { businessId } });
    await prisma.appointment.deleteMany({ where: { businessId } });
    await prisma.businessReminderSettings.deleteMany({ where: { businessId } });
    await prisma.whatsAppMessage.deleteMany({ where: { businessId } });
    await prisma.whatsAppIntegration.deleteMany({ where: { businessId } });
    await prisma.customer.deleteMany({ where: { businessId } });
    await prisma.staffService.deleteMany({ where: { businessId } });
    await prisma.staffWorkingHours.deleteMany({ where: { businessId } });
    await prisma.staff.deleteMany({ where: { businessId } });
    await prisma.service.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it('1. should create appointment, dispatch customer confirmation & owner alert, and schedule 24h & 2h reminders', async () => {
    // 3 days in future at 10:00 AM UTC (3:30 PM IST)
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    futureDate.setUTCHours(10, 0, 0, 0);

    const appt = await appointmentsService.createAppointment(businessId, {
      serviceId,
      staffId,
      startAt: futureDate.toISOString(),
      customerName: 'Vikram Seth',
      customerPhone: '+919988776655',
    });

    expect(appt.id).toBeDefined();
    expect(appt.status).toBe('CONFIRMED');

    // Verify Notifications in DB
    const notifications = await prisma.appointmentNotification.findMany({
      where: { appointmentId: appt.id },
      orderBy: { scheduledAt: 'asc' },
    });

    // Should have 4 notifications:
    // 1. BOOKING_CONFIRMATION (SENT)
    // 2. OWNER_BOOKING_NOTIFICATION (SENT)
    // 3. APPOINTMENT_REMINDER (24h before - PENDING)
    // 4. APPOINTMENT_REMINDER (2h before - PENDING)
    expect(notifications.length).toBe(4);

    const bookingConf = notifications.find((n) => n.type === NotificationType.BOOKING_CONFIRMATION);
    expect(bookingConf).toBeDefined();
    expect(bookingConf?.status).toBe(NotificationStatus.SENT);
    expect(bookingConf?.recipientPhone).toBe('+919988776655');

    const ownerNotif = notifications.find((n) => n.type === NotificationType.OWNER_BOOKING_NOTIFICATION);
    expect(ownerNotif).toBeDefined();
    expect(ownerNotif?.status).toBe(NotificationStatus.SENT);
    expect(ownerNotif?.recipientPhone).toBe('+919876543210');

    const reminders = notifications.filter((n) => n.type === NotificationType.APPOINTMENT_REMINDER);
    expect(reminders.length).toBe(2);
    expect(reminders.every((r) => r.status === NotificationStatus.PENDING)).toBe(true);

    // Verify 24h reminder scheduledAt = appt.startAt - 24 hours
    const firstReminder = reminders.find((r) => JSON.parse(r.payload || '{}').reminderType === 'FIRST');
    expect(firstReminder?.scheduledAt.getTime()).toBe(appt.startAt.getTime() - 24 * 60 * 60 * 1000);

    // Verify 2h reminder scheduledAt = appt.startAt - 2 hours
    const secondReminder = reminders.find((r) => JSON.parse(r.payload || '{}').reminderType === 'SECOND');
    expect(secondReminder?.scheduledAt.getTime()).toBe(appt.startAt.getTime() - 2 * 60 * 60 * 1000);
  });

  it('2. should reschedule appointment, invalidate old reminders, create new reminders, and send reschedule confirmation', async () => {
    const appt = await prisma.appointment.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    expect(appt).toBeDefined();

    // Reschedule to 4 days in future at 11:00 AM UTC
    const newFutureDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    newFutureDate.setUTCHours(11, 0, 0, 0);

    const rescheduled = await appointmentsService.reschedule(businessId, appt!.id, {
      startAt: newFutureDate.toISOString(),
    });

    expect(rescheduled.startAt.toISOString()).toBe(newFutureDate.toISOString());

    // Check all notifications for this appointment
    const notifications = await prisma.appointmentNotification.findMany({
      where: { appointmentId: appt!.id },
      orderBy: { createdAt: 'asc' },
    });

    // Old reminders must be CANCELLED
    const cancelledReminders = notifications.filter(
      (n) => n.type === NotificationType.APPOINTMENT_REMINDER && n.status === NotificationStatus.CANCELLED,
    );
    expect(cancelledReminders.length).toBe(2);

    // New active PENDING reminders must be scheduled for the new date
    const activeReminders = notifications.filter(
      (n) => n.type === NotificationType.APPOINTMENT_REMINDER && n.status === NotificationStatus.PENDING,
    );
    expect(activeReminders.length).toBe(2);

    const newFirstReminder = activeReminders.find((r) => JSON.parse(r.payload || '{}').reminderType === 'FIRST');
    expect(newFirstReminder?.scheduledAt.getTime()).toBe(newFutureDate.getTime() - 24 * 60 * 60 * 1000);

    // Reschedule Confirmation must be SENT
    const reschedConf = notifications.find((n) => n.type === NotificationType.RESCHEDULE_CONFIRMATION);
    expect(reschedConf).toBeDefined();
    expect(reschedConf?.status).toBe(NotificationStatus.SENT);
  });

  it('3. should cancel appointment, invalidate all remaining pending reminders, and send cancellation confirmation', async () => {
    const appt = await prisma.appointment.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    expect(appt).toBeDefined();

    const cancelled = await appointmentsService.cancel(businessId, appt!.id);
    expect(cancelled.status).toBe('CANCELLED');

    // All reminders must now be CANCELLED
    const pendingReminders = await prisma.appointmentNotification.findMany({
      where: {
        appointmentId: appt!.id,
        type: NotificationType.APPOINTMENT_REMINDER,
        status: NotificationStatus.PENDING,
      },
    });
    expect(pendingReminders.length).toBe(0);

    // Cancellation confirmation must be SENT
    const cancelConf = await prisma.appointmentNotification.findFirst({
      where: {
        appointmentId: appt!.id,
        type: NotificationType.CANCELLATION_CONFIRMATION,
      },
    });
    expect(cancelConf).toBeDefined();
    expect(cancelConf?.status).toBe(NotificationStatus.SENT);
  });
});
