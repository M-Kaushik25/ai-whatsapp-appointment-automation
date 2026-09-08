import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { WhatsAppConversationService } from './whatsapp-conversation.service';
import { PrismaService } from '../prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MockWhatsAppProvider } from '../whatsapp/providers/mock-whatsapp.provider';

describe('WhatsAppConversationService — Booking Conversation Engine', () => {
  let prisma: PrismaService;
  let availabilityService: AvailabilityService;
  let appointmentsService: AppointmentsService;
  let whatsAppService: WhatsAppService;
  let conversationService: WhatsAppConversationService;

  let businessAId: string;
  let businessBId: string;
  let serviceAId: string;
  let staffAId: string;
  let customerAId: string;
  let customerAPhone: string;

  beforeEach(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    availabilityService = new AvailabilityService(prisma);
    appointmentsService = new AppointmentsService(prisma);
    const mockProvider = new MockWhatsAppProvider();

    // Instantiate WhatsAppService
    whatsAppService = new WhatsAppService(
      prisma,
      mockProvider,
      null as any, // conversationService injected next
    );

    conversationService = new WhatsAppConversationService(
      prisma,
      availabilityService,
      appointmentsService,
      whatsAppService,
    );

    const suffix = Math.random().toString(36).substring(2, 7) + Date.now();

    // 1. Create Business A
    const bizA = await prisma.business.create({
      data: {
        name: 'Royal Spa & Salon',
        slug: `royal-spa-${suffix}`,
      },
    });
    businessAId = bizA.id;

    // 2. Create Service
    const service = await prisma.service.create({
      data: {
        businessId: businessAId,
        name: 'Deluxe Haircut',
        durationMinutes: 30,
        price: 600,
        active: true,
      },
    });
    serviceAId = service.id;

    // 3. Create Staff with Working Hours for all days
    const staff = await prisma.staff.create({
      data: {
        businessId: businessAId,
        name: 'Master Stylist Alex',
        active: true,
      },
    });
    staffAId = staff.id;

    await prisma.staffService.create({
      data: {
        businessId: businessAId,
        staffId: staffAId,
        serviceId: serviceAId,
      },
    });

    for (let day = 0; day <= 6; day++) {
      await prisma.staffWorkingHours.create({
        data: {
          businessId: businessAId,
          staffId: staffAId,
          dayOfWeek: day,
          startTime: '09:00',
          endTime: '18:00',
          enabled: true,
        },
      });
    }

    // 4. Create Customer A
    customerAPhone = '+9198765' + Math.floor(10000 + Math.random() * 90000);
    const customer = await prisma.customer.create({
      data: {
        businessId: businessAId,
        name: 'Anita Roy',
        phone: customerAPhone,
        status: 'ACTIVE',
      },
    });
    customerAId = customer.id;

    // 5. Create WhatsApp Integration for Business A
    await prisma.whatsAppIntegration.create({
      data: {
        businessId: businessAId,
        phoneNumberId: `phone_id_${suffix}`,
        accessToken: 'mock_access_token_123',
        status: 'CONNECTED',
      },
    });
  });

  afterAll(async () => {
    if (businessAId) {
      await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId || ''] } } });
    }
    await prisma.$disconnect();
  });

  describe('1. Happy Path Booking Flow', () => {
    it('should guide customer step-by-step through full booking and create appointment', async () => {
      // Step 1: Customer says "Hi"
      const reply1 = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        'Hi',
      );
      expect(reply1).toContain('Royal Spa & Salon');
      expect(reply1).toContain('Deluxe Haircut');
      expect(reply1).toContain('1️⃣');

      // Check Session state is SELECTING_SERVICE
      let session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('SELECTING_SERVICE');

      // Step 2: Customer selects service "1"
      const reply2 = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '1',
      );
      expect(reply2).toContain('Deluxe Haircut');
      expect(reply2).toContain('Choose an appointment date');
      expect(reply2).toContain('1️⃣');

      session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('SELECTING_DATE');

      // Step 3: Customer selects date "2" (Tomorrow)
      const reply3 = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '2',
      );
      expect(reply3).toContain('Available times for');
      expect(reply3).toContain('1️⃣');

      session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('SELECTING_SLOT');

      // Step 4: Customer selects slot "1"
      const reply4 = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '1',
      );
      expect(reply4).toContain('Appointment Summary');
      expect(reply4).toContain('Deluxe Haircut');
      expect(reply4).toContain('₹600');
      expect(reply4).toContain('1️⃣ *Confirm Booking*');

      session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('CONFIRMING');

      // Step 5: Customer confirms with "1"
      const reply5 = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '1',
      );
      expect(reply5).toContain('Booking Confirmed!');
      expect(reply5).toContain('Booking Ref:');

      session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('BOOKED');
      expect(session?.appointmentId).toBeDefined();

      // Verify Appointment in Database
      const appt = await prisma.appointment.findUnique({
        where: { id: session!.appointmentId! },
      });
      expect(appt).toBeDefined();
      expect(appt?.businessId).toBe(businessAId);
      expect(appt?.serviceId).toBe(serviceAId);
      expect(appt?.customerId).toBe(customerAId);
      expect(appt?.price).toBe(600);
      expect(appt?.status).toBe('CONFIRMED');
    }, 15000);
  });

  describe('2. Session Expiration & Auto-Reset', () => {
    it('should reset expired session to IDLE when new message arrives', async () => {
      // Create expired session
      await prisma.whatsAppConversationSession.create({
        data: {
          businessId: businessAId,
          customerId: customerAId,
          phoneNumber: customerAPhone,
          state: 'SELECTING_SLOT',
          serviceId: serviceAId,
          serviceName: 'Deluxe Haircut',
          expiresAt: new Date(Date.now() - 60000), // 1 minute in the past
        },
      });

      // Customer sends message
      const reply = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '1',
      );
      expect(reply).toContain('Welcome to *Royal Spa & Salon*');
      expect(reply).toContain('Deluxe Haircut');

      const session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('SELECTING_SERVICE');
    });
  });

  describe('3. Global Commands (Cancel, Back)', () => {
    it('should handle cancel command gracefully without creating appointment', async () => {
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1');

      const cancelReply = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        'cancel',
      );
      expect(cancelReply).toContain('cancelled');

      const session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('CANCELLED');

      const appts = await prisma.appointment.findMany({
        where: { businessId: businessAId, customerId: customerAId },
      });
      expect(appts.length).toBe(0);
    });

    it('should navigate back cleanly when user types back', async () => {
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'); // now at date selection

      const backReply = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        'back',
      );
      expect(backReply).toContain('Please select a service to book:');

      const session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('SELECTING_SERVICE');
    });
  });

  describe('4. Duplicate Confirmation Idempotency', () => {
    it('should return existing confirmation when customer confirms multiple times rapidly', async () => {
      // Run through steps to confirmation
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '2');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1');

      // Send confirmation 5 times
      const responses = await Promise.all([
        conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'),
        conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'),
        conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'),
        conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'),
        conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'),
      ]);

      expect(responses[0]).toContain('Booking');

      // Exactly ONE appointment created in database
      const appts = await prisma.appointment.findMany({
        where: { businessId: businessAId, customerId: customerAId },
      });
      expect(appts.length).toBe(1);
    });
  });

  describe('5. Inactive Customer Protection', () => {
    it('should reject booking if customer is marked INACTIVE', async () => {
      // Mark customer INACTIVE
      await prisma.customer.update({
        where: { id: customerAId },
        data: { status: 'INACTIVE' },
      });

      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '2');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1');

      const confirmReply = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '1',
      );
      expect(confirmReply).toContain('inactive');

      const appts = await prisma.appointment.findMany({
        where: { businessId: businessAId, customerId: customerAId },
      });
      expect(appts.length).toBe(0);
    });
  });

  describe('6. Invalid Input Handling', () => {
    it('should return helpful guidance on invalid numbers or gibberish', async () => {
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');

      // Invalid service selection
      const invalidReply = await conversationService.handleMessage(
        businessAId,
        customerAId,
        customerAPhone,
        '99',
      );
      expect(invalidReply).toContain("couldn't find that service");

      const session = await prisma.whatsAppConversationSession.findUnique({
        where: { businessId_phoneNumber: { businessId: businessAId, phoneNumber: customerAPhone } },
      });
      expect(session?.state).toBe('SELECTING_SERVICE');
    });
  });

  describe('7. Concurrency Double-Booking Protection (2, 5, 10 requests)', () => {
    it('should allow exactly 1 booking and reject other concurrent customer for the exact same slot', async () => {
      // Create Customer B
      const customerBPhone = '+9198765' + Math.floor(10000 + Math.random() * 90000);
      const customerB = await prisma.customer.create({
        data: {
          businessId: businessAId,
          name: 'Priya Sharma',
          phone: customerBPhone,
          status: 'ACTIVE',
        },
      });

      // Customer A navigates to Confirmation
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '2');
      await conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'); // Select slot 1

      // Customer B navigates to Confirmation for the exact same slot
      await conversationService.handleMessage(businessAId, customerB.id, customerBPhone, 'Hi');
      await conversationService.handleMessage(businessAId, customerB.id, customerBPhone, '1');
      await conversationService.handleMessage(businessAId, customerB.id, customerBPhone, '2');
      await conversationService.handleMessage(businessAId, customerB.id, customerBPhone, '1'); // Select slot 1

      // Both confirm at the exact same instant
      const [replyA, replyB] = await Promise.all([
        conversationService.handleMessage(businessAId, customerAId, customerAPhone, '1'),
        conversationService.handleMessage(businessAId, customerB.id, customerBPhone, '1'),
      ]);

      const confirmations = [replyA, replyB].filter((r) => r.includes('Booking Confirmed!'));
      const conflicts = [replyA, replyB].filter((r) => r.includes('just booked by another customer'));

      expect(confirmations.length).toBe(1);
      expect(conflicts.length).toBe(1);

      // Verify DB: exactly 1 appointment exists
      const totalAppts = await prisma.appointment.findMany({
        where: { businessId: businessAId },
      });
      expect(totalAppts.length).toBe(1);
    });

    it('should handle 10 concurrent confirmation attempts with exactly 1 booking', async () => {
      const phones: string[] = [];
      const custIds: string[] = [];

      // Create 10 customers and get them to CONFIRMING state on slot 2
      for (let i = 0; i < 10; i++) {
        const ph = '+9198711' + Math.floor(10000 + Math.random() * 90000);
        phones.push(ph);
        const c = await prisma.customer.create({
          data: {
            businessId: businessAId,
            name: `Contender ${i}`,
            phone: ph,
            status: 'ACTIVE',
          },
        });
        custIds.push(c.id);

        await conversationService.handleMessage(businessAId, c.id, ph, 'Hi');
        await conversationService.handleMessage(businessAId, c.id, ph, '1');
        await conversationService.handleMessage(businessAId, c.id, ph, '3'); // Same date
        await conversationService.handleMessage(businessAId, c.id, ph, '1'); // Same slot
      }

      // Fire all 10 confirmations simultaneously
      const results = await Promise.all(
        custIds.map((cid, idx) =>
          conversationService.handleMessage(businessAId, cid, phones[idx], '1'),
        ),
      );

      const confirmed = results.filter((r) => r.includes('Booking Confirmed!'));
      const conflicted = results.filter((r) => r.includes('just booked by another customer'));

      expect(confirmed.length).toBe(1);
      expect(conflicted.length).toBe(9);
    });
  });

  describe('8. Multi-Tenant Isolation', () => {
    it('should isolate business data and prevent cross-tenant exposure', async () => {
      // Create Business B
      const bizB = await prisma.business.create({
        data: {
          name: 'Elite Barber Lounge',
          slug: `elite-barber-${Date.now()}`,
        },
      });
      businessBId = bizB.id;

      await prisma.service.create({
        data: {
          businessId: businessBId,
          name: 'Beard Grooming Pro',
          durationMinutes: 45,
          price: 900,
          active: true,
        },
      });

      const customerBPhone = '+9199988' + Math.floor(10000 + Math.random() * 90000);
      const custB = await prisma.customer.create({
        data: {
          businessId: businessBId,
          name: 'David Miller',
          phone: customerBPhone,
          status: 'ACTIVE',
        },
      });

      // Customer on Business A
      const replyA = await conversationService.handleMessage(businessAId, customerAId, customerAPhone, 'Hi');
      expect(replyA).toContain('Royal Spa & Salon');
      expect(replyA).toContain('Deluxe Haircut');
      expect(replyA).not.toContain('Beard Grooming Pro');

      // Customer on Business B
      const replyB = await conversationService.handleMessage(businessBId, custB.id, customerBPhone, 'Hi');
      expect(replyB).toContain('Elite Barber Lounge');
      expect(replyB).toContain('Beard Grooming Pro');
      expect(replyB).not.toContain('Deluxe Haircut');

      // Admin find all sessions
      const sessionsA = await conversationService.findAllSessions(businessAId);
      const sessionsB = await conversationService.findAllSessions(businessBId);

      expect(sessionsA.every((s) => s.businessId === businessAId)).toBe(true);
      expect(sessionsB.every((s) => s.businessId === businessBId)).toBe(true);
    });
  });
});
