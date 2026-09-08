# Appointment Booking Engine & Slot Calculation Algorithm

This document details the internal mathematics, constraints, slot generation algorithm, and state lifecycle governing appointment bookings in **WhatsApp SaaS**.

---

## 1. End-to-End Customer Booking Journey

```mermaid
sequenceDiagram
    autonumber
    actor Customer as WhatsApp Customer
    participant Meta as Meta WhatsApp Cloud API
    participant Bot as WhatsApp FSM Engine
    participant Avail as Availability Service
    participant Appt as Appointments Service
    participant Mutex as In-Memory Staff Mutex
    participant DB as Prisma / Database
    participant Pay as Payment Engine

    Customer->>Meta: "Hi, I want to book an appointment"
    Meta->>Bot: Webhook POST (message: "Hi...")
    Bot-->>Customer: "Welcome to Radiant Salon! Please select a service:\n1. Haircut ($30)\n2. Hair Coloring ($85)"
    
    Customer->>Meta: "1"
    Meta->>Bot: Webhook POST (selection: 1)
    Bot-->>Customer: "Great! Please reply with your desired date (YYYY-MM-DD):"
    
    Customer->>Meta: "2026-09-10"
    Meta->>Bot: Webhook POST (date: "2026-09-10")
    Bot->>Avail: getAvailableStaffForService(serviceId, date)
    Avail->>DB: Query Staff & Working Hours
    DB-->>Avail: Active staff members
    Avail-->>Bot: Staff list
    Bot-->>Customer: "Select a specialist:\n1. Alex Rivera\n2. Any available staff"

    Customer->>Meta: "1"
    Meta->>Bot: Webhook POST (staffId)
    Bot->>Avail: getAvailableSlots(businessId, serviceId, staffId, date)
    Avail->>DB: Query Working Hours, Breaks, Leaves, Holidays, Appointments
    Avail-->>Bot: Returns open slots: ["10:00", "11:00", "14:00", "15:00"]
    Bot-->>Customer: "Available times on 2026-09-10:\n1. 10:00 AM\n2. 11:00 AM\n3. 02:00 PM\n4. 03:00 PM"

    Customer->>Meta: "2"
    Meta->>Bot: Webhook POST (slotIndex: 2 -> 11:00 AM)
    Bot-->>Customer: "Confirm Booking:\nService: Haircut\nStaff: Alex Rivera\nDate: 2026-09-10 at 11:00 AM\nTotal: $30\n\nReply 'YES' to confirm or 'CANCEL'."

    Customer->>Meta: "YES"
    Meta->>Bot: Webhook POST ("YES")
    Bot->>Appt: createAppointment({ businessId, customerId, serviceId, staffId, startTime })
    Appt->>Mutex: acquireStaffLock(staffId)
    Mutex-->>Appt: Lock acquired
    Appt->>DB: Double-check overlapping bookings
    DB-->>Appt: 0 conflicts found
    Appt->>Pay: evaluateDepositRequirement(businessId, serviceId)
    alt Deposit Required
        Pay-->>Appt: Generate Razorpay Payment Link
        Appt->>DB: Save Appointment (status: PENDING)
        Mutex-->>Appt: Release lock
        Appt-->>Bot: Appointment Created with Payment Link
        Bot-->>Customer: "Booking reserved! Please complete your deposit within 15 minutes to confirm:\n👉 https://rzp.io/i/example"
    else No Deposit Required
        Appt->>DB: Save Appointment (status: CONFIRMED)
        Mutex-->>Appt: Release lock
        Appt-->>Bot: Appointment Confirmed
        Bot-->>Customer: "🎉 Confirmed! Your booking ID is #APT-1049. We look forward to seeing you!"
    end
```

---

## 2. Slot Calculation Algorithm

The availability engine (`src/availability/availability.service.ts`) calculates open booking slots dynamically without pre-generating static calendar entries. This guarantees real-time accuracy across changes in staff rosters, breaks, and emergency leaves.

### Inputs to the Algorithm
1. `businessId`: Tenant identifier.
2. `serviceId`: Determines `duration` (in minutes) and `bufferTime` (turnaround padding).
3. `staffId`: The selected team member (or wildcard for all qualified staff).
4. `date`: Target date in `YYYY-MM-DD` format.

```
Total Required Time Window = Service Duration + Service Buffer Time
```
*Example: A 45-minute massage with 15 minutes of room sanitization requires a continuous 60-minute window.*

---

### Step-by-Step Slot Filtering Pipeline

```mermaid
flowchart TD
    Start([Request: Service, Staff, Date]) --> Step1[1. Check Business Holiday]
    Step1 -- Holiday Exists --> NoSlots([Return 0 Slots: Business Closed])
    Step1 -- Not a Holiday --> Step2[2. Fetch Staff Schedule for Day of Week]
    
    Step2 -- Staff Not Working Today --> NoSlots
    Step2 -- Staff Active --> Step3[3. Check Staff Leave on Target Date]
    
    Step3 -- Staff on Full/Partial Leave --> NoSlots
    Step3 -- Staff Available --> Step4[4. Generate Candidate Time Grid]
    
    Step4 --> Step5[5. Filter Out Configured Staff Breaks]
    Step5 --> Step6[6. Filter Out Existing Active Appointments]
    Step6 --> Step7[7. Ensure Slot Starts in Future if Today]
    Step7 --> Output([Return Formatted Available Slots])
```

#### Detailed Pipeline Stages:

1. **Business Holiday Validation**:
   - Queries `prisma.holiday.findFirst({ where: { businessId, date } })`.
   - If present, the business is completely closed. Return an empty array `[]`.

2. **Staff Shift & Working Hours**:
   - Extracts the day of the week (`SUNDAY` through `SATURDAY`).
   - Queries `prisma.staffWorkingHours.findFirst({ where: { staffId, dayOfWeek } })`.
   - Reads `startTime` (e.g., `09:00`) and `endTime` (e.g., `18:00`). If `isWorking = false`, return `[]`.

3. **Staff Approved Leave**:
   - Queries `prisma.staffLeave.findMany({ where: { staffId, startDate <= date, endDate >= date, status: 'APPROVED' } })`.
   - If an approved leave covers this date, return `[]`.

4. **Candidate Time Grid Generation**:
   - Iterates in increments matching the service interval (e.g., every 30 or 60 minutes) from shift start to shift end minus duration:
     $$\text{slotEndTime} = \text{slotStartTime} + \text{duration} + \text{bufferTime}$$
   - Any candidate slot whose $\text{slotEndTime} > \text{shiftEndTime}$ is immediately discarded.

5. **Staff Break Subtraction**:
   - Queries `prisma.staffBreak.findMany({ where: { staffId, dayOfWeek } })`.
   - Any candidate slot overlapping with a staff break (e.g., Lunch `13:00 - 14:00`) is pruned:
     $$\text{Overlap} \iff (\text{slotStart} < \text{breakEnd}) \land (\text{slotEnd} > \text{breakStart})$$

6. **Existing Appointment Conflict Pruning**:
   - Queries `prisma.appointment.findMany({ where: { staffId, date, status: { in: ['PENDING', 'CONFIRMED'] } } })`.
   - Any candidate slot overlapping with an existing active appointment is pruned.
   - Cancelled (`CANCELLED`) and No-Show (`NO_SHOW`) appointments do not block slots.

7. **Past-Time Pruning (Same-Day Requests)**:
   - If the requested date is today, candidate slots earlier than `currentTime + leadTime` (e.g., 30 minutes notice) are filtered out.

---

## 3. Appointment Lifecycle & State Machine

Every appointment moves through well-defined lifecycle states:

```mermaid
stateDiagram-v2
    [*] --> PENDING: Created via WhatsApp (Deposit Pending)
    [*] --> CONFIRMED: Created via Dashboard or Deposit Not Required
    
    PENDING --> CONFIRMED: Deposit Paid via Razorpay Webhook
    PENDING --> CANCELLED: Payment Link Expired (TTL Timeout)
    PENDING --> CANCELLED: Customer Aborts Booking
    
    CONFIRMED --> COMPLETED: Customer Checked In & Service Rendered
    CONFIRMED --> CANCELLED: Customer or Business Cancels Before Visit
    CONFIRMED --> NO_SHOW: Customer Failed to Arrive
    
    COMPLETED --> [*]
    CANCELLED --> [*]
    NO_SHOW --> [*]
```

### State Definitions

| Status | Description | Slot Release Behavior |
| :--- | :--- | :--- |
| `PENDING` | Slot temporarily held awaiting customer deposit payment (15 min TTL). | **Held**: Blocks other customers from booking this slot. |
| `CONFIRMED` | Fully confirmed booking with or without deposit. Reminders will fire. | **Held**: Slot is strictly locked. |
| `COMPLETED` | Appointment fulfilled. Triggers 30-day retention campaign counter. | **Released**: Becomes historical record. |
| `CANCELLED` | Booking cancelled by customer or business, or expired unpaid. | **Instantly Released**: Slot immediately becomes available to others. |
| `NO_SHOW` | Customer did not show up. Retained for customer reliability analytics. | **Released**: Historical record. |

---

## 4. Concurrency Protection & Overlap Prevention

Race conditions occur when two customers concurrently request the last remaining slot (e.g., 10:00 AM with Stylist Sarah):

```
Time T0: Customer A requests 10:00 AM (Sarah)
Time T1: Customer B requests 10:00 AM (Sarah)
```

Without concurrency locks, both requests query the database at T2, both observe that 10:00 AM is free, and both insert appointments at T3, producing a **double-booking**.

### Solution: In-Memory Mutex Lock (`acquireStaffLock`)
In `AppointmentsService`:
```typescript
async create(data: CreateAppointmentDto) {
  // 1. Acquire mutex lock scoped to this specific staff member
  const releaseLock = await this.acquireStaffLock(data.staffId);
  try {
    // 2. Re-verify inside critical section
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        staffId: data.staffId,
        status: { in: ['PENDING', 'CONFIRMED'] },
        OR: [
          { startTime: { lte: data.startTime }, endTime: { gt: data.startTime } },
          { startTime: { lt: data.endTime }, endTime: { gte: data.endTime } },
          { startTime: { gte: data.startTime }, endTime: { lte: data.endTime } },
        ],
      },
    });

    if (conflict) {
      throw new ConflictException('This time slot was just booked by another customer.');
    }

    // 3. Persist appointment safely
    return await this.prisma.appointment.create({ data });
  } finally {
    // 4. Release lock so queued requests can proceed safely
    releaseLock();
  }
}
```

This guarantees that concurrent requests for the **same staff member are strictly serialized**, while bookings for **different staff members execute at full parallel throughput**.
