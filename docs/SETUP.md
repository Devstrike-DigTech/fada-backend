# FADA Backend — Setup Guide

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | >= 20.x | Runtime |
| npm | >= 10.x | Package manager |
| Docker | >= 24.x | Local PostgreSQL + Redis |
| Git | >= 2.x | Version control |

---

## 1. Clone & Install

```bash
cd /Users/richarduzor/Devs/Fada
# (project is already here at fada-backend/)
cd fada-backend

npm install
```

---

## 2. Environment Setup

```bash
cp .env.example .env
```

Fill in `.env` with local values (see below for each variable explanation).

---

## 3. Start Infrastructure

```bash
# Start PostgreSQL + Redis
docker-compose up -d

# Verify containers are running
docker ps
```

Expected containers:
- `fada_postgres` on port `5432`
- `fada_redis` on port `6379`

---

## 4. Database Setup

```bash
# Run migrations
npx prisma migrate dev

# Seed initial data (subscription plans, drug categories, ailment tags)
npm run seed

# Open Prisma Studio (optional — database GUI)
npx prisma studio
```

---

## 5. Start Development Server

```bash
npm run start:dev
```

Server starts at: `http://localhost:3000`
Swagger docs at: `http://localhost:3000/api/docs`

---

## 6. Verify Setup

```bash
# Health check
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","database":"connected","redis":"connected"}
```

---

## Environment Variables Reference

### App
```env
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
```

### Database
```env
DATABASE_URL=postgresql://fada_user:fada_pass@localhost:5432/fada_db?schema=public
```

### Redis
```env
REDIS_URL=redis://localhost:6379
```

### JWT
```env
JWT_ACCESS_SECRET=your-access-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
```

### Google OAuth
```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/login/google/callback
```

### Apple Sign-In
```env
APPLE_CLIENT_ID=com.devstrike.fada
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
APPLE_CALLBACK_URL=http://localhost:3000/auth/login/apple/callback
```

### Payments
```env
PAYSTACK_SECRET_KEY=sk_test_your-paystack-secret
PAYSTACK_PUBLIC_KEY=pk_test_your-paystack-public
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-your-key
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST-your-key
```

### Storage
```env
CLOUDFLARE_R2_ACCOUNT_ID=your-account-id
CLOUDFLARE_R2_ACCESS_KEY=your-access-key
CLOUDFLARE_R2_SECRET_KEY=your-secret-key
CLOUDFLARE_R2_BUCKET_NAME=fada-storage
CLOUDFLARE_R2_PUBLIC_URL=https://your-bucket.r2.dev

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### Notifications
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...

TERMII_API_KEY=your-termii-api-key
TERMII_SENDER_ID=FADA

RESEND_API_KEY=re_your-resend-api-key
EMAIL_FROM=noreply@thefadaapp.com
```

### External Registries
```env
PCN_REGISTRY_API_URL=https://api.pcn.gov.ng
PCN_REGISTRY_API_KEY=your-pcn-api-key
CAC_REGISTRY_API_URL=https://api.cac.gov.ng
CAC_REGISTRY_API_KEY=your-cac-api-key
NAFDAC_REGISTRY_URL=https://nafdac.gov.ng/api
```

---

## Docker Compose (Development)

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgis/postgis:15-3.3
    container_name: fada_postgres
    environment:
      POSTGRES_DB: fada_db
      POSTGRES_USER: fada_user
      POSTGRES_PASSWORD: fada_pass
    ports:
      - "5432:5432"
    volumes:
      - fada_postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: fada_redis
    ports:
      - "6379:6379"
    volumes:
      - fada_redis_data:/data

volumes:
  fada_postgres_data:
  fada_redis_data:
```

---

## Useful Commands

```bash
# Development
npm run start:dev          # Watch mode
npm run start:debug        # Debug mode

# Database
npx prisma migrate dev     # Apply migrations
npx prisma migrate reset   # Reset database (destructive!)
npx prisma generate        # Regenerate Prisma client
npx prisma studio          # Open database GUI
npm run seed               # Seed initial data

# Testing
npm run test               # Unit tests
npm run test:e2e           # E2E tests
npm run test:cov           # Coverage report

# Linting
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix linting issues
npm run format             # Prettier format

# Build
npm run build              # Production build
npm run start:prod         # Start production build
```

---

## Picking Up After a Break

1. `cd /Users/richarduzor/Devs/Fada/fada-backend`
2. `git pull` (get latest changes)
3. `npm install` (in case new packages were added)
4. `docker-compose up -d` (start DB + Redis)
5. `npx prisma migrate dev` (apply any new migrations)
6. `npm run start:dev`
7. Check `docs/PHASES.md` for current phase status
