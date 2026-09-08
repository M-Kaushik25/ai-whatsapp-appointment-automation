# Testing Strategy & Quality Assurance

This document details the testing architecture, test suites, mocking strategy, and verification commands used in **WhatsApp SaaS**.

---

## 1. Testing Framework Overview

The project uses **Vitest** for both unit testing and end-to-end (E2E) testing, providing:
- Fast startup and execution times.
- Native TypeScript and ESM support.
- Deep integration with NestJS dependency injection test utilities (`@nestjs/testing`).

---

## 2. Running Test Suites

All test commands are executed inside the `backend` directory:

```bash
cd backend

# Run all unit test suites
npm run test

# Run tests in interactive watch mode
npm run test:watch

# Generate code coverage report
npm run test:cov

# Run End-to-End (E2E) integration test suites
npm run test:e2e
```

---

## 3. Unit Test Architecture & Availability Verification

The core business logic resides in the **Availability Engine** (`src/availability/availability.service.spec.ts`).

### Verified Test Cases:
1. **`should return available slots within working hours`**:
   - Confirms that for a standard 9:00 AM - 5:00 PM shift, the engine generates consecutive, non-overlapping candidate slots aligned with service duration and buffer time.
2. **`should exclude slots during staff breaks`**:
   - Injects a break between 12:00 PM and 1:00 PM.
   - Verifies that any slot overlapping with this interval is eliminated.
3. **`should exclude slots during staff leaves`**:
   - Confirms that when a staff member has an approved leave for the requested date, zero slots are returned.
4. **`should exclude slots overlapping with existing appointments`**:
   - Injects an existing confirmed appointment.
   - Asserts that the booked time slot is purged from candidate availability.

### Sample Test Implementation:
```typescript
it('should exclude slots during staff breaks', async () => {
  mockPrismaService.holiday.findFirst.mockResolvedValue(null);
  mockPrismaService.staffLeave.findMany.mockResolvedValue([]);
  mockPrismaService.staffWorkingHours.findFirst.mockResolvedValue({
    isWorking: true,
    startTime: '09:00',
    endTime: '17:00',
  });
  mockPrismaService.staffBreak.findMany.mockResolvedValue([
    { startTime: '12:00', endTime: '13:00' },
  ]);
  mockPrismaService.appointment.findMany.mockResolvedValue([]);

  const slots = await service.getAvailableSlots('biz-1', 'srv-1', 'staff-1', '2026-09-10');
  
  const hasNoonSlot = slots.some((s) => s.startTime === '12:00' || s.startTime === '12:30');
  expect(hasNoonSlot).toBe(false);
});
```

---

## 4. Mock Providers Architecture

To enable continuous integration (CI) and local testing without external third-party accounts, the application provides pluggable mock providers:

### 1. `MockWhatsAppProvider` (`src/whatsapp/providers/mock-whatsapp.provider.ts`)
- Emulates the Meta Graph API.
- Implements `sendTextMessage`, `sendButtonMessage`, and `sendTemplateMessage`.
- Records dispatched messages in memory for inspection and simulator UI feedback.

### 2. `MockPaymentProvider` (`src/payments/providers/mock-payment.provider.ts`)
- Emulates Razorpay payment link generation and payment verification.
- Generates mock payment URLs (`https://mock-payment.local/pay/...`).
- Simulates instantaneous payment approval without credit card or bank credentials.

---

## 5. Adding New Test Suites

When adding new domain modules, follow the established NestJS testing pattern:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { YourNewService } from './your-new.service';

describe('YourNewService', () => {
  let service: YourNewService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourNewService,
        {
          provide: PrismaService,
          useValue: {
            appointment: { findMany: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<YourNewService>(YourNewService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```
