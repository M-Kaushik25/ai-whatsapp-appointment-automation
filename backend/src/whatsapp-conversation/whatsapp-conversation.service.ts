import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normalizePhone } from '../customers/customers.service';
import { PaymentsService } from '../payments/payments.service';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessionLocks = new Map<string, Promise<void>>();

async function acquireSessionLock(sessionId: string): Promise<() => void> {
  while (sessionLocks.has(sessionId)) {
    await sessionLocks.get(sessionId);
  }
  let release: () => void = () => {};
  const lockPromise = new Promise<void>((resolve) => {
    release = () => {
      sessionLocks.delete(sessionId);
      resolve();
    };
  });
  sessionLocks.set(sessionId, lockPromise);
  return release;
}

export interface ConversationContextData {
  services?: { id: string; name: string; price: number; durationMinutes: number }[];
  dates?: { dateStr: string; label: string }[];
  staffList?: { id: string; name: string }[];
  slots?: { startAt: string; endAt: string; label: string; staffId?: string }[];
  tempData?: Record<string, any>;
}

@Injectable()
export class WhatsAppConversationService {
  private readonly logger = new Logger(WhatsAppConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService?: PaymentsService,
  ) {}

  /**
   * Main entrypoint for processing an incoming WhatsApp message in the booking conversation
   */
  async handleMessage(
    businessId: string,
    customerId: string,
    rawPhoneNumber: string,
    messageText: string,
  ): Promise<string> {
    const phoneNumber = normalizePhone(rawPhoneNumber);
    const text = messageText ? messageText.trim() : '';

    this.logger.log(
      `[CONVERSATION] Inbound message from ${phoneNumber} for business ${businessId}: "${text}"`
    );

    // 1. Get or create active session
    let session = await this.getOrCreateSession(businessId, customerId, phoneNumber);

    const releaseLock = await acquireSessionLock(session.id);

    try {
      // Re-read latest session under lock
      session = (await this.prisma.whatsAppConversationSession.findUnique({
        where: { id: session.id },
      })) || session;

      // 2. Fetch Business profile (name, settings)
      const business = await this.prisma.business.findUnique({
        where: { id: businessId },
      });
      const businessName = business?.name || 'Our Salon';

    // 3. Global command interceptors
    const lowerText = text.toLowerCase();

    if (['cancel', 'stop', 'exit'].includes(lowerText)) {
      await this.prisma.whatsAppConversationSession.update({
        where: { id: session.id },
        data: { state: 'CANCELLED', expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
      const reply = `Your booking session has been cancelled. Reply "Hi" whenever you'd like to book an appointment!`;
      await this.sendReply(businessId, phoneNumber, reply);
      return reply;
    }

    if (['hi', 'hello', 'hey', 'start', 'restart', 'menu', 'book', 'yes'].includes(lowerText)) {
      return this.handleGreetingAndShowServices(businessId, session, businessName);
    }

    if (lowerText === 'back') {
      return this.handleBackNavigation(businessId, session, businessName);
    }

    // 4. Dispatch based on current session state
    let reply = '';
    switch (session.state) {
      case 'IDLE':
      case 'CANCELLED':
      case 'BOOKED':
        reply = await this.handleGreetingAndShowServices(businessId, session, businessName);
        break;

      case 'SELECTING_SERVICE':
        reply = await this.handleServiceSelection(businessId, session, text);
        break;

      case 'SELECTING_DATE':
        reply = await this.handleDateSelection(businessId, session, text);
        break;

      case 'SELECTING_STAFF':
        reply = await this.handleStaffSelection(businessId, session, text);
        break;

      case 'SELECTING_SLOT':
        reply = await this.handleSlotSelection(businessId, session, text);
        break;

      case 'CONFIRMING':
        reply = await this.handleConfirmation(businessId, session, text, businessName);
        break;

      default:
        reply = await this.handleGreetingAndShowServices(businessId, session, businessName);
        break;
    }

    return reply;
    } finally {
      releaseLock();
    }
  }

  /**
   * Session retrieval, reuse and expiration logic
   */
  private async getOrCreateSession(businessId: string, customerId: string, phoneNumber: string) {
    const existing = await this.prisma.whatsAppConversationSession.findUnique({
      where: {
        businessId_phoneNumber: {
          businessId,
          phoneNumber,
        },
      },
    });

    const now = new Date();

    if (existing) {
      // Check if session has expired
      if (existing.expiresAt < now) {
        this.logger.log(`Session for ${phoneNumber} expired. Resetting to IDLE.`);
        return this.prisma.whatsAppConversationSession.update({
          where: { id: existing.id },
          data: {
            state: 'IDLE',
            serviceId: null,
            serviceName: null,
            staffId: null,
            staffName: null,
            selectedDate: null,
            selectedSlot: null,
            appointmentId: null,
            contextData: null,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          },
        });
      }

      // Touch expiration time
      return this.prisma.whatsAppConversationSession.update({
        where: { id: existing.id },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
    }

    // Create new session
    return this.prisma.whatsAppConversationSession.create({
      data: {
        businessId,
        customerId,
        phoneNumber,
        state: 'IDLE',
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  /**
   * Handle greeting and present active services catalog from database
   */
  private async handleGreetingAndShowServices(
    businessId: string,
    session: any,
    businessName: string,
  ): Promise<string> {
    const services = await this.prisma.service.findMany({
      where: { businessId, active: true },
      orderBy: { name: 'asc' },
    });

    if (services.length === 0) {
      const reply = `Welcome to *${businessName}*! 👋\n\nWe currently do not have any services available for online booking. Please check back later.`;
      await this.sendReply(businessId, session.phoneNumber, reply);
      return reply;
    }

    const contextServices = services.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      durationMinutes: s.durationMinutes,
    }));

    let serviceMenu = `Welcome to *${businessName}*! 👋\n\nPlease select a service to book:\n\n`;
    contextServices.forEach((s, idx) => {
      serviceMenu += `${idx + 1}️⃣ *${s.name}* — ₹${s.price} (${s.durationMinutes} min)\n`;
    });
    serviceMenu += `\nReply with the number (e.g. *1*).`;

    await this.prisma.whatsAppConversationSession.update({
      where: { id: session.id },
      data: {
        state: 'SELECTING_SERVICE',
        serviceId: null,
        serviceName: null,
        staffId: null,
        staffName: null,
        selectedDate: null,
        selectedSlot: null,
        appointmentId: null,
        contextData: JSON.stringify({ services: contextServices }),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    await this.sendReply(businessId, session.phoneNumber, serviceMenu);
    return serviceMenu;
  }

  /**
   * Handle service selection from user input
   */
  private async handleServiceSelection(businessId: string, session: any, text: string): Promise<string> {
    const context: ConversationContextData = session.contextData ? JSON.parse(session.contextData) : {};
    const services = context.services || [];

    const num = parseInt(text, 10);
    let selectedService = null;

    if (!isNaN(num) && num >= 1 && num <= services.length) {
      selectedService = services[num - 1];
    } else {
      // Try matching by exact or partial name
      selectedService = services.find((s) => s.name.toLowerCase().includes(text.toLowerCase()));
    }

    if (!selectedService) {
      const retryMsg = `I couldn't find that service. Please reply with a valid number (1 to ${services.length}).`;
      await this.sendReply(businessId, session.phoneNumber, retryMsg);
      return retryMsg;
    }

    // Generate next 5 bookable dates
    const dates: { dateStr: string; label: string }[] = [];
    const today = new Date();

    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);

      let label = '';
      if (i === 0) {
        label = `Today (${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
      } else if (i === 1) {
        label = `Tomorrow (${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
      } else {
        label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      }
      dates.push({ dateStr, label });
    }

    let dateMenu = `You selected *${selectedService.name}* (₹${selectedService.price}).\n\nChoose an appointment date:\n\n`;
    dates.forEach((d, idx) => {
      dateMenu += `${idx + 1}️⃣ ${d.label}\n`;
    });
    dateMenu += `\nReply with the number (e.g. *1*) or type *back*.`;

    await this.prisma.whatsAppConversationSession.update({
      where: { id: session.id },
      data: {
        state: 'SELECTING_DATE',
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        contextData: JSON.stringify({
          ...context,
          selectedService,
          dates,
        }),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    await this.sendReply(businessId, session.phoneNumber, dateMenu);
    return dateMenu;
  }

  /**
   * Handle date selection from user input
   */
  private async handleDateSelection(businessId: string, session: any, text: string): Promise<string> {
    const context: ConversationContextData = session.contextData ? JSON.parse(session.contextData) : {};
    const dates = context.dates || [];

    const num = parseInt(text, 10);
    let selectedDateObj = null;

    if (!isNaN(num) && num >= 1 && num <= dates.length) {
      selectedDateObj = dates[num - 1];
    } else {
      // Check if user entered a specific date format YYYY-MM-DD
      selectedDateObj = dates.find((d) => d.dateStr === text.trim() || d.label.toLowerCase().includes(text.toLowerCase()));
    }

    if (!selectedDateObj) {
      const retryMsg = `Please choose a valid date number (1 to ${dates.length}) or type *back*.`;
      await this.sendReply(businessId, session.phoneNumber, retryMsg);
      return retryMsg;
    }

    const selectedDate = selectedDateObj.dateStr;

    // Check staff providing this service
    const staffServices = await this.prisma.staffService.findMany({
      where: {
        businessId,
        serviceId: session.serviceId,
        staff: { active: true },
      },
      include: { staff: true },
    });

    const activeStaff = staffServices.map((ss) => ({ id: ss.staff.id, name: ss.staff.name }));

    // If multiple staff members exist, prompt staff selection
    if (activeStaff.length > 1) {
      const staffMenuOptions = [
        { id: 'ANY', name: 'Any Available Specialist' },
        ...activeStaff,
      ];

      let staffMenu = `Great! Date: *${selectedDateObj.label}*\n\nWho would you like to book with?\n\n`;
      staffMenuOptions.forEach((st, idx) => {
        staffMenu += `${idx + 1}️⃣ ${st.name}\n`;
      });
      staffMenu += `\nReply with the number (e.g. *1*) or type *back*.`;

      await this.prisma.whatsAppConversationSession.update({
        where: { id: session.id },
        data: {
          state: 'SELECTING_STAFF',
          selectedDate,
          contextData: JSON.stringify({
            ...context,
            selectedDate: selectedDateObj,
            staffList: staffMenuOptions,
          }),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });

      await this.sendReply(businessId, session.phoneNumber, staffMenu);
      return staffMenu;
    }

    // Otherwise, single staff or auto-assign -> directly load available slots
    const singleStaffId = activeStaff.length === 1 ? activeStaff[0].id : undefined;
    const singleStaffName = activeStaff.length === 1 ? activeStaff[0].name : undefined;

    return this.loadAndPresentAvailableSlots(
      businessId,
      session,
      selectedDate,
      selectedDateObj.label,
      singleStaffId,
      singleStaffName,
      context,
    );
  }

  /**
   * Handle staff selection
   */
  private async handleStaffSelection(businessId: string, session: any, text: string): Promise<string> {
    const context: ConversationContextData = session.contextData ? JSON.parse(session.contextData) : {};
    const staffList = context.staffList || [];

    const num = parseInt(text, 10);
    let chosenStaff = null;

    if (!isNaN(num) && num >= 1 && num <= staffList.length) {
      chosenStaff = staffList[num - 1];
    } else {
      chosenStaff = staffList.find((st) => st.name.toLowerCase().includes(text.toLowerCase()));
    }

    if (!chosenStaff) {
      const retryMsg = `Please choose a valid staff number (1 to ${staffList.length}) or type *back*.`;
      await this.sendReply(businessId, session.phoneNumber, retryMsg);
      return retryMsg;
    }

    const staffId = chosenStaff.id === 'ANY' ? undefined : chosenStaff.id;
    const staffName = chosenStaff.id === 'ANY' ? 'Any Available Specialist' : chosenStaff.name;

    const dateLabel = context.dates?.find((d) => d.dateStr === session.selectedDate)?.label || session.selectedDate;

    return this.loadAndPresentAvailableSlots(
      businessId,
      session,
      session.selectedDate,
      dateLabel,
      staffId,
      staffName,
      context,
    );
  }

  /**
   * Load available slots using Phase 4 AvailabilityService and present them
   */
  private async loadAndPresentAvailableSlots(
    businessId: string,
    session: any,
    dateStr: string,
    dateLabel: string,
    staffId: string | undefined,
    staffName: string | undefined,
    context: ConversationContextData,
  ): Promise<string> {
    try {
      const activeServiceId = session.serviceId || context.services?.[0]?.id;
      const availResponse = await this.availabilityService.getAvailableSlots(
        businessId,
        {
          serviceId: activeServiceId,
          staffId: staffId || 'ANY',
          date: dateStr,
        },
      );

      const rawSlots = (availResponse?.slots || []).filter((s) => s.available);

      if (!rawSlots || rawSlots.length === 0) {
        const noSlotsMsg = `⚠️ No available appointment slots on *${dateLabel}* for this selection.\n\nPlease reply with *back* to choose another date or staff.`;
        await this.sendReply(businessId, session.phoneNumber, noSlotsMsg);
        return noSlotsMsg;
      }

      // Take top 8 available slots for clean mobile readability
      const displaySlots = rawSlots.slice(0, 8).map((s) => {
        return {
          startAt: s.start,
          endAt: s.end,
          label: s.startTime,
          staffId: s.staffId || staffId,
          staffName: s.staffName || staffName,
        };
      });

      let slotMenu = `Available times for *${session.serviceName}* on *${dateLabel}*:\n\n`;
      displaySlots.forEach((slot, idx) => {
        slotMenu += `${idx + 1}️⃣ ${slot.label}\n`;
      });
      slotMenu += `\nReply with the number (e.g. *1*) or type *back*.`;

      await this.prisma.whatsAppConversationSession.update({
        where: { id: session.id },
        data: {
          state: 'SELECTING_SLOT',
          selectedDate: dateStr,
          staffId: staffId || null,
          staffName: staffName || null,
          contextData: JSON.stringify({
            ...context,
            slots: displaySlots,
          }),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });

      await this.sendReply(businessId, session.phoneNumber, slotMenu);
      return slotMenu;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error calculating availability';
      this.logger.error(`Availability calculation error: ${msg}`);
      const errReply = `Could not load slots for that date. Please reply *back* to try again.`;
      await this.sendReply(businessId, session.phoneNumber, errReply);
      return errReply;
    }
  }

  /**
   * Handle slot selection and show final summary confirmation
   */
  private async handleSlotSelection(businessId: string, session: any, text: string): Promise<string> {
    const context: ConversationContextData = session.contextData ? JSON.parse(session.contextData) : {};
    const slots = context.slots || [];

    const num = parseInt(text, 10);
    let selectedSlot = null;

    if (!isNaN(num) && num >= 1 && num <= slots.length) {
      selectedSlot = slots[num - 1];
    } else {
      selectedSlot = slots.find((s) => s.label.toLowerCase().includes(text.toLowerCase()));
    }

    if (!selectedSlot) {
      const retryMsg = `Please choose a valid slot number (1 to ${slots.length}) or type *back*.`;
      await this.sendReply(businessId, session.phoneNumber, retryMsg);
      return retryMsg;
    }

    const service = context.services?.find((s) => s.id === session.serviceId);
    const servicePrice = service?.price ?? 0;
    const durationMinutes = service?.durationMinutes ?? 30;

    const startDate = new Date(selectedSlot.startAt);
    const dateFormatted = startDate.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    const timeFormatted = startDate.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    let summary = `*Appointment Summary* 📋\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━\n`;
    summary += `• Service: *${session.serviceName}*\n`;
    summary += `• Staff: *${session.staffName || 'Assigned Specialist'}*\n`;
    summary += `• Date: *${dateFormatted}*\n`;
    summary += `• Time: *${timeFormatted}*\n`;
    summary += `• Duration: *${durationMinutes} mins*\n`;
    summary += `• Price: *₹${servicePrice}*\n\n`;
    summary += `Please confirm your booking:\n`;
    summary += `1️⃣ *Confirm Booking*\n`;
    summary += `2️⃣ *Change Time / Date*`;

    await this.prisma.whatsAppConversationSession.update({
      where: { id: session.id },
      data: {
        state: 'CONFIRMING',
        selectedSlot: selectedSlot.startAt,
        staffId: selectedSlot.staffId || session.staffId,
        contextData: JSON.stringify({
          ...context,
          selectedSlot,
          servicePrice,
          durationMinutes,
          dateFormatted,
          timeFormatted,
        }),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    await this.sendReply(businessId, session.phoneNumber, summary);
    return summary;
  }

  /**
   * Handle confirmation: Idempotent booking transaction invocation
   */
  private async handleConfirmation(
    businessId: string,
    session: any,
    text: string,
    businessName: string,
  ): Promise<string> {
    const lower = text.toLowerCase().trim();

    // If user requests change
    if (['2', 'change', 'no'].includes(lower)) {
      const context: ConversationContextData = session.contextData ? JSON.parse(session.contextData) : {};
      const dateLabel = context.dates?.find((d) => d.dateStr === session.selectedDate)?.label || session.selectedDate;

      return this.loadAndPresentAvailableSlots(
        businessId,
        session,
        session.selectedDate,
        dateLabel,
        session.staffId || undefined,
        session.staffName || undefined,
        context,
      );
    }

    if (!['1', 'confirm', 'yes', 'ok'].includes(lower)) {
      const retryMsg = `Reply with *1* to Confirm Booking or *2* to Change.`;
      await this.sendReply(businessId, session.phoneNumber, retryMsg);
      return retryMsg;
    }

    // Strict Idempotency Check: if session already booked, return confirmation
    if (session.state === 'BOOKED' && session.appointmentId) {
      const existingAppt = await this.prisma.appointment.findUnique({
        where: { id: session.appointmentId },
      });
      if (existingAppt) {
        const duplicateConfirmation = `Your appointment is already confirmed! 🎉\n\nBooking ID: #${existingAppt.id.slice(0, 8).toUpperCase()}`;
        await this.sendReply(businessId, session.phoneNumber, duplicateConfirmation);
        return duplicateConfirmation;
      }
    }

    const context = session.contextData ? JSON.parse(session.contextData) : {};

    // Get customer info
    const customer = await this.prisma.customer.findUnique({
      where: { id: session.customerId },
    });

    if (customer?.status === 'INACTIVE') {
      const inactiveMsg = `⚠️ We couldn't complete your booking because your customer account is inactive. Please contact the business directly.`;
      await this.sendReply(businessId, session.phoneNumber, inactiveMsg);
      return inactiveMsg;
    }

    const customerName = customer?.name || 'WhatsApp Customer';

    // If staff was not selected, find any available staff for that service
    let staffIdToBook = session.staffId;
    if (!staffIdToBook || staffIdToBook === 'ANY') {
      const eligibleStaff = await this.prisma.staffService.findFirst({
        where: {
          businessId,
          serviceId: session.serviceId,
          staff: { active: true },
        },
      });
      staffIdToBook = eligibleStaff?.staffId;
    }

    if (!staffIdToBook) {
      const errReply = `Sorry, no active staff is available for this service. Reply "Hi" to restart.`;
      await this.sendReply(businessId, session.phoneNumber, errReply);
      return errReply;
    }

    try {
      // Authoritative Phase 4 Booking Creation (inherits concurrency lock & double-booking protection)
      const appointment = await this.appointmentsService.createAppointment(businessId, {
        serviceId: session.serviceId,
        staffId: staffIdToBook,
        startAt: session.selectedSlot,
        customerName,
        customerPhone: session.phoneNumber,
        notes: 'Booked via WhatsApp Business Automation',
      });

      // Update session to BOOKED
      await this.prisma.whatsAppConversationSession.update({
        where: { id: session.id },
        data: {
          state: 'BOOKED',
          appointmentId: appointment.id,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });

      // Check if payment is required and generate link
      let paymentLinkMsg = '';
      if (this.paymentsService) {
        try {
          const payment = await this.paymentsService.createPaymentForAppointment(businessId, appointment.id);
          if (payment && payment.paymentLink) {
            paymentLinkMsg = `\n\n💳 *Payment Required to Secure Slot*\n• Amount: *₹${payment.amount}* (${payment.type === 'FULL_PAYMENT' ? 'Full Payment' : 'Deposit'})\n• Payment Link: ${payment.paymentLink}\n\nPlease complete the payment to secure your booking.`;
          }
        } catch (payErr: any) {
          this.logger.warn(`Could not create payment for appt ${appointment.id}: ${payErr?.message}`);
        }
      }

      const refCode = appointment.id.slice(0, 8).toUpperCase();
      let successMsg = `🎉 *Booking Confirmed!*\n\n`;
      successMsg += `• Service: *${session.serviceName}*\n`;
      successMsg += `• Date: *${context.dateFormatted}*\n`;
      successMsg += `• Time: *${context.timeFormatted}*\n`;
      successMsg += `• Price: *₹${appointment.price}*\n\n`;
      successMsg += `Booking Ref: *#${refCode}*${paymentLinkMsg}\n\n`;
      successMsg += `Thank you for booking with *${businessName}*! We look forward to seeing you.`;

      await this.sendReply(businessId, session.phoneNumber, successMsg);
      return successMsg;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Slot unavailable';
      this.logger.warn(`Booking conflict for ${session.phoneNumber}: ${errMsg}`);

      // Gracefully handle slot conflict: reload remaining available slots
      await this.prisma.whatsAppConversationSession.update({
        where: { id: session.id },
        data: { state: 'SELECTING_SLOT' },
      });

      const dateLabel = context.dateFormatted || session.selectedDate;
      const slotRetryMsg = `⚠️ *Sorry, that slot was just booked by another customer.*\n\nPlease choose another available time:`;
      const freshSlotsMsg = await this.loadAndPresentAvailableSlots(
        businessId,
        session,
        session.selectedDate,
        dateLabel,
        session.staffId || undefined,
        session.staffName || undefined,
        context,
      );

      const combinedMsg = `${slotRetryMsg}\n\n${freshSlotsMsg}`;
      await this.sendReply(businessId, session.phoneNumber, combinedMsg);
      return combinedMsg;
    }
  }

  /**
   * Handle 'back' command step-by-step
   */
  private async handleBackNavigation(businessId: string, session: any, businessName: string): Promise<string> {
    const context = session.contextData ? JSON.parse(session.contextData) : {};

    switch (session.state) {
      case 'CONFIRMING': {
        const dateLabel = context.dateFormatted || session.selectedDate;
        return this.loadAndPresentAvailableSlots(
          businessId,
          session,
          session.selectedDate,
          dateLabel,
          session.staffId || undefined,
          session.staffName || undefined,
          context,
        );
      }
      case 'SELECTING_SLOT':
      case 'SELECTING_STAFF':
        return this.handleGreetingAndShowServices(businessId, session, businessName);

      case 'SELECTING_DATE':
      case 'SELECTING_SERVICE':
      default:
        return this.handleGreetingAndShowServices(businessId, session, businessName);
    }
  }

  /**
   * Send WhatsApp reply message via WhatsAppService
   */
  private async sendReply(businessId: string, recipientPhone: string, text: string) {
    try {
      await this.whatsAppService.sendTextMessage(businessId, {
        recipientPhone,
        text,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error sending WhatsApp reply';
      this.logger.error(`Failed to send WhatsApp conversation reply: ${msg}`);
    }
  }

  /**
   * List all conversation sessions for admin visibility (Multi-tenant)
   */
  async findAllSessions(businessId: string) {
    return this.prisma.whatsAppConversationSession.findMany({
      where: { businessId },
      orderBy: { updatedAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });
  }
}
