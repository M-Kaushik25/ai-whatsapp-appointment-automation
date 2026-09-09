# Production Deployment & Infrastructure Guide

This guide details how to deploy the **WhatsApp SaaS** platform to production environments using **Docker**, **PostgreSQL**, **PM2 / systemd**, and **Nginx** with Let's Encrypt SSL.

---

## 1. Production Architecture Topology

```mermaid
flowchart TB
    Internet((Public Internet)) --> Nginx[Nginx Reverse Proxy / SSL Termination\nPort 80 & 443]
    
    subgraph Host["Production Server (Ubuntu 22.04 LTS / Debian 12)"]
        Nginx -->|Proxy /api/v1/*| BackendService[NestJS Backend Service\nPort 3001 via PM2]
        Nginx -->|Proxy /*| FrontendService[Next.js SSR Client\nPort 3000 via PM2]
        
        BackendService --> PostgresContainer[PostgreSQL 15 Alpine Container\nPort 5432 via Docker Compose]
    end

    BackendService <-->|HTTPS REST| MetaAPI[Meta Graph API Cloud v20.0]
    BackendService <-->|HTTPS REST| RazorpayAPI[Razorpay Payment Gateway]
```

---

## 2. Prerequisites & Server Sizing

- **Operating System**: Ubuntu 22.04 LTS or Debian 12.
- **Minimum Specs**: 2 vCPU, 4GB RAM, 20GB SSD.
- **Tools Required**: Docker Engine, Docker Compose, Node.js (v20+ LTS), npm/pnpm, Nginx, Certbot.
- **Domain**: A registered domain pointing to your server IP (e.g., `app.yourdomain.com`).

---

## 3. Step-by-Step Deployment Procedure

### Step 1: Clone Repository & Setup Environment Files
```bash
git clone https://github.com/M-Kaushik25/ai-whatsapp-appointment-automation.git /var/www/ai-whatsapp-appointment-automation
cd /var/www/ai-whatsapp-appointment-automation
cp .env.example .env
```

Edit `/var/www/whatsapp-saas/.env`:
```ini
NODE_ENV=production
PORT=3001
DATABASE_URL="postgresql://postgres:StrongPassword123@localhost:5432/whatsapp_saas"
JWT_SECRET="generate-a-64-character-cryptographically-secure-secret"

# Meta Cloud API
WHATSAPP_USE_MOCK=false
WHATSAPP_VERIFY_TOKEN="meta-challenge-verify-token-xyz"
WHATSAPP_API_BASE_URL="https://graph.facebook.com/v20.0"

# Razorpay
RAZORPAY_KEY_ID="rzp_live_your_key_id"
RAZORPAY_KEY_SECRET="your_live_secret"
PAYMENT_WEBHOOK_SECRET="your_webhook_secret"

# Frontend
NEXT_PUBLIC_API_URL="https://app.yourdomain.com/api/v1"
```

---

### Step 2: Launch PostgreSQL Database via Docker Compose
In the root directory:
```bash
# Start PostgreSQL daemon
docker compose up -d

# Verify database is healthy
docker compose ps
```

---

### Step 3: Switch Prisma Schema to PostgreSQL & Run Migrations
In `backend/prisma/schema.prisma`, ensure the datasource provider is set to PostgreSQL:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Deploy schema migrations:
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
```

Optional: Seed standard initial business demo data:
```bash
npm run seed
```

---

### Step 4: Build Backend & Frontend
```bash
# Build Backend
cd /var/www/whatsapp-saas/backend
npm run build

# Build Frontend
cd /var/www/whatsapp-saas/frontend
npm install
npm run build
```

---

### Step 5: Process Management with PM2
Install PM2 globally to maintain process persistence and auto-restarts:
```bash
npm install -g pm2

# Start Backend
cd /var/www/whatsapp-saas/backend
pm2 start dist/main.js --name "whatsapp-saas-backend"

# Start Frontend
cd /var/www/whatsapp-saas/frontend
pm2 start npm --name "whatsapp-saas-frontend" -- start

# Save PM2 state for system reboots
pm2 save
pm2 startup
```

---

### Step 6: Configure Nginx Reverse Proxy & SSL

Create an Nginx server block at `/etc/nginx/sites-available/whatsapp-saas`:

```nginx
server {
    server_name app.yourdomain.com;

    # Backend API and Webhooks
    location /api/v1/ {
        proxy_pass http://127.0.0.1:3001/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Frontend Dashboard (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and provision SSL via Certbot:
```bash
ln -s /etc/nginx/sites-available/whatsapp-saas /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Issue Let's Encrypt Certificate
certbot --nginx -d app.yourdomain.com
```

---

## 4. Webhook Configuration Guides

### Meta WhatsApp Cloud Webhook
1. Navigate to the **Meta Developers Portal** -> Your App -> **WhatsApp** -> **Configuration**.
2. Click **Edit** on Webhook URL.
3. **Callback URL**: `https://app.yourdomain.com/api/v1/whatsapp/webhook`
4. **Verify Token**: Must match `WHATSAPP_VERIFY_TOKEN` in your `.env`.
5. Click **Verify and Save**.
6. Under **Webhook Fields**, subscribe to **`messages`**.

### Razorpay Payment Webhook
1. Go to **Razorpay Dashboard** -> **Settings** -> **Webhooks**.
2. Click **Add New Webhook**.
3. **Webhook URL**: `https://app.yourdomain.com/api/v1/payments/webhook`
4. **Secret**: Must match `PAYMENT_WEBHOOK_SECRET` in your `.env`.
5. Check events: `order.paid`, `payment.captured`, `payment.failed`.
