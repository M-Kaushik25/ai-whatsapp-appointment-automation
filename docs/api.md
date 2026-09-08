# REST API Reference & Endpoint Catalogue

This document provides a comprehensive catalogue of all REST API endpoints implemented across the **WhatsApp SaaS** backend.

**Base URL**: `http://localhost:3001/api/v1`  
**Authentication**: Bearer Token in `Authorization: Bearer <jwt_token>` header (unless marked **Public**).

---

## 1. System & Health

### Health Check
- **Endpoint**: `GET /health`
- **Auth**: Public
- **Description**: Verifies backend server responsiveness and database connectivity.
- **Response**:
```json
{
  "status": "ok",
  "db": "connected",
  "message": "Backend is running"
}
```

---

## 2. Authentication (`/auth`)

### Business Registration
- **Endpoint**: `POST /auth/register`
- **Auth**: Public
- **Body**:
```json
{
  "businessName": "Radiant Hair Salon",
  "name": "Sarah Connor",
  "email": "owner@radiantsalon.com",
  "password": "SecurePassword123!",
  "phone": "+14155552671"
}
```
- **Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "usr_9918",
    "name": "Sarah Connor",
    "email": "owner@radiantsalon.com",
    "role": "OWNER",
    "businessId": "biz_4401"
  }
}
```

### Business Login
- **Endpoint**: `POST /auth/login`
- **Auth**: Public
- **Body**:
```json
{
  "email": "owner@radiantsalon.com",
  "password": "SecurePassword123!"
}
```

### Current User Profile
- **Endpoint**: `GET /auth/me`
- **Auth**: Bearer JWT
- **Response**: Returns current user entity and associated business metadata.

---

## 3. Business Profile (`/business`)

### Get Profile
- **Endpoint**: `GET /business/profile`
- **Auth**: Bearer JWT
- **Response**: Business name, slug, contact details, operational metadata.

### Update Profile
- **Endpoint**: `PUT /business/profile`
- **Auth**: Bearer JWT (Owner/Admin)
- **Body**: `{ "name": "...", "phone": "...", "address": "..." }`

---

## 4. Services Catalog (`/services`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/services` | List all active services for the tenant |
| `POST` | `/services` | Create new service (duration, buffer, price) |
| `GET` | `/services/:id` | Get service details |
| `PUT` | `/services/:id` | Update service pricing or duration |
| `DELETE` | `/services/:id` | Archive or delete a service |

---

## 5. Staff & Rostering (`/staff`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/staff` | List staff members for tenant |
| `POST` | `/staff` | Create new staff member |
| `GET` | `/staff/:id` | Get staff profile and schedules |
| `PUT` | `/staff/:id` | Update staff contact details |
| `DELETE` | `/staff/:id` | Deactivate staff member |
| `GET` | `/staff/:id/services` | Get services assigned to staff member |
| `PUT` | `/staff/:id/services` | Update service assignments (`serviceIds: []`) |
| `GET` | `/staff/:id/working-hours` | Get weekly shift hours |
| `PUT` | `/staff/:id/working-hours` | Update working hours for days of week |
| `GET` | `/staff/:id/breaks` | List recurring shift breaks |
| `POST` | `/staff/:id/breaks` | Add a recurring break (e.g., Lunch) |
| `DELETE` | `/staff/:id/breaks/:breakId` | Delete a recurring break |
| `GET` | `/staff/:id/leaves` | List time-off and leave requests |
| `POST` | `/staff/:id/leaves` | Submit a staff leave record |
| `DELETE` | `/staff/:id/leaves/:leaveId` | Remove or cancel a leave |

---

## 6. Business Holidays (`/holidays`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/holidays` | List tenant closure dates |
| `POST` | `/holidays` | Add a holiday date (`date: "YYYY-MM-DD"`) |
| `DELETE` | `/holidays/:id` | Remove a holiday closure |

---

## 7. Availability Engine (`/availability`)

### Query Open Slots
- **Endpoint**: `GET /availability/slots`
- **Auth**: Public or Bearer JWT
- **Query Parameters**:
  - `serviceId`: Service being requested.
  - `staffId`: Specific staff member (optional).
  - `date`: Requested date (`YYYY-MM-DD`).
- **Response**:
```json
{
  "date": "2026-09-10",
  "serviceId": "srv_102",
  "availableSlots": [
    { "startTime": "09:00", "endTime": "09:45" },
    { "startTime": "10:00", "endTime": "10:45" },
    { "startTime": "11:00", "endTime": "11:45" },
    { "startTime": "14:00", "endTime": "14:45" }
  ]
}
```

### Query Staff Available for Service
- **Endpoint**: `GET /availability/staff`
- **Auth**: Public or Bearer JWT
- **Query Parameters**: `serviceId`, `date`

---

## 8. Appointments (`/appointments`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/appointments` | List appointments (filters: `status`, `date`, `staffId`) |
| `POST` | `/appointments` | Create appointment (protected by staff mutex lock) |
| `GET` | `/appointments/:id` | Get appointment dossier |
| `PATCH`| `/appointments/:id/status` | Transition status (`CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`) |
| `PATCH`| `/appointments/:id/reschedule` | Reschedule date and time |
| `DELETE`| `/appointments/:id` | Cancel and delete appointment |

---

## 9. Customer CRM (`/customers`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/customers` | List customers with search and pagination |
| `POST` | `/customers` | Register customer manually |
| `GET` | `/customers/:id` | Get customer dossier and visit statistics |
| `PUT` | `/customers/:id` | Update customer phone, email, or internal notes |
| `GET` | `/customers/:id/appointments` | Get complete booking history for customer |

---

## 10. Payments & Gateway (`/payments`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/payments` | List payment transactions |
| `GET` | `/payments/settings` | Get deposit rules and gateway credentials |
| `PUT` | `/payments/settings` | Update deposit mode (`FIXED`, `PERCENTAGE`, `FULL_PAYMENT`) |
| `GET` | `/payments/stats` | Aggregated revenue and deposit metrics |
| `POST` | `/payments/:id/refund` | Trigger Razorpay or mock refund |
| `POST` | `/payments/webhook` | Ingress for Razorpay payment webhooks (Public + HMAC) |

---

## 11. WhatsApp Ingress & Simulator (`/whatsapp`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/whatsapp/webhook` | Meta Webhook subscription challenge verification |
| `POST` | `/whatsapp/webhook` | Meta Webhook inbound message ingress |
| `POST` | `/whatsapp/send` | Outbound WhatsApp message dispatcher |
| `GET` | `/whatsapp/settings` | Get Meta credentials & connection status |
| `PUT` | `/whatsapp/settings` | Save Meta Phone Number ID and Access Token |
| `POST` | `/whatsapp/conversations/simulate` | Interactive test harness for simulator UI |

---

## 12. Automated Reminders (`/notifications` & `/reminder-settings`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/notifications` | Delivery audit logs of automated WhatsApp messages |
| `POST` | `/notifications/:id/resend` | Manually re-trigger a failed notification |
| `GET` | `/reminder-settings` | Get 24h & 2h reminder configurations |
| `PUT` | `/reminder-settings` | Update reminder schedule and custom copy |

---

## 13. Retention Marketing (`/retention`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/retention/settings` | Get 30-day reactivation campaign rules |
| `PUT` | `/retention/settings` | Update retention coupon and days threshold |
| `GET` | `/retention/stats` | Re-engagement conversion rate and metrics |
| `GET` | `/retention/follow-ups` | List pending and sent follow-up messages |
| `POST` | `/retention/sync-historical` | Scan past completed appointments to schedule follow-ups |
