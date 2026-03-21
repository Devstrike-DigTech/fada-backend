# FADA Backend — Find Any Drug Anywhere

> **Project Unisach** | Built by Devstrike Digital Limited
> Backend API powering the FADA Pharmacy App and Customer App

---

## What is FADA?

FADA (Find Any Drug Anywhere) is a two-sided healthcare marketplace connecting pharmacies and customers across Nigeria. Customers can search for specific drugs, find nearby pharmacies that have them in stock, and reserve them before making the trip — eliminating wasted journeys and drug unavailability frustration.

### Two Client Applications
| App | Users | Purpose |
|---|---|---|
| **Pharmacy App** | Pharmacists / Operators | Inventory management, reservation handling, ads, subscriptions |
| **Customer App** | End users / Guests | Drug discovery, pharmacy search, reservations, drug lists |

---

## Tech Stack

| Concern | Technology | Reason |
|---|---|---|
| Runtime | Node.js + TypeScript | Nigerian talent pool, I/O performance |
| Framework | NestJS | Module enforcement, DI, auto OpenAPI |
| Primary DB | PostgreSQL + PostGIS | Relational integrity, geo-queries, FTS |
| ORM | Prisma | Type-safe queries, clean migrations |
| Cache | Redis (Upstash) | Rate limits, session store, pub/sub |
| Queue | BullMQ (Redis-backed) | Job processing, cron, retry logic |
| File Storage | Cloudflare R2 + Cloudinary | Zero egress cost, image transforms |
| Search v1 | PostgreSQL FTS (tsvector) | Sufficient at launch, no extra infra |
| Search v2 | Typesense | Typo-tolerant, simple ops |
| Real-Time | Socket.IO + Redis adapter | Live reservation status |
| Auth | JWT + Passport.js | Multi-role, Google OAuth, Apple Sign-In |
| SMS / OTP | Termii | Best Nigerian SMS delivery |
| Push Notifications | Firebase FCM | Free, cross-platform |
| Email | Resend | Transactional email |
| Payments | Paystack (primary) + Flutterwave (fallback) | NGN subscriptions |
| Deployment | Docker + Railway → AWS ECS Fargate | Low ops overhead |
| Architecture | Modular Monolith | Clean bounded contexts, extractable later |

---

## Architecture Style

**Modular Monolith** — each NestJS module is a bounded context that:
- Owns its own data (tables), logic, and API surface
- Communicates with other modules **only via an internal event bus** (no direct service cross-imports)
- Can be extracted into a standalone microservice when scale demands it

---

## Project Structure

```
fada-backend/
├── prisma/                     # Database schema + migrations
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts                 # App bootstrap
│   ├── app.module.ts           # Root module
│   ├── config/                 # Environment configuration
│   ├── common/                 # Shared guards, decorators, pipes, types
│   │   ├── decorators/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── filters/
│   │   ├── pipes/
│   │   ├── dto/
│   │   └── types/
│   ├── infrastructure/         # Technical cross-cutting concerns
│   │   ├── database/           # Prisma service + PostGIS helpers
│   │   ├── redis/              # Redis service
│   │   ├── queue/              # BullMQ setup + queue names
│   │   ├── storage/            # R2 + Cloudinary abstractions
│   │   ├── payments/           # Paystack + Flutterwave
│   │   ├── sockets/            # Socket.IO gateway
│   │   └── events/             # Internal event bus (EventEmitter2)
│   ├── modules/                # Feature modules (bounded contexts)
│   │   ├── auth/
│   │   ├── pharmacy/
│   │   ├── inventory/
│   │   ├── search/
│   │   ├── reservation/
│   │   ├── subscription/
│   │   ├── ads/
│   │   ├── points/
│   │   ├── notifications/
│   │   ├── analytics/
│   │   ├── saves/
│   │   ├── support/
│   │   ├── content/
│   │   ├── customer-profile/
│   │   └── feature-flags/
│   └── jobs/                   # Standalone scheduled jobs
├── docs/                       # Architecture + design documentation
│   ├── ARCHITECTURE.md
│   ├── PHASES.md
│   ├── DATABASE.md
│   ├── MODULES.md
│   ├── EVENTS.md
│   ├── API.md
│   ├── TECH_STACK.md
│   ├── SETUP.md
│   └── diagrams/               # Mermaid system design diagrams
│       ├── system-overview.md
│       ├── auth-flow.md
│       ├── reservation-flow.md
│       ├── search-flow.md
│       ├── inventory-flow.md
│       ├── subscription-flow.md
│       └── entity-relationships.md
├── test/
│   ├── e2e/
│   └── unit/
├── .env.example
├── docker-compose.yml
├── Dockerfile
└── README.md
```

---

## Development Phases

| Phase | Name | Status |
|---|---|---|
| **Phase 1** | Foundation & Infrastructure Setup | 🔲 Not Started |
| **Phase 2** | Auth Module | 🔲 Not Started |
| **Phase 3** | Pharmacy & Branch Module | 🔲 Not Started |
| **Phase 4** | Inventory Module | 🔲 Not Started |
| **Phase 5** | Search & Discovery Module | 🔲 Not Started |
| **Phase 6** | Reservation Module | 🔲 Not Started |
| **Phase 7** | Subscription & Payments Module | 🔲 Not Started |
| **Phase 8** | Ads & Promotions Module | 🔲 Not Started |
| **Phase 9** | Customer Features Module | 🔲 Not Started |
| **Phase 10** | Points & Reputation Module | 🔲 Not Started |
| **Phase 11** | Notifications Module | 🔲 Not Started |
| **Phase 12** | Support & Content Module | 🔲 Not Started |
| **Phase 13** | Analytics Module | 🔲 Not Started |
| **Phase 14** | Real-Time & WebSockets | 🔲 Not Started |
| **Phase 15** | Testing, Security & Deployment | 🔲 Not Started |

> See `docs/PHASES.md` for full breakdown of each phase.

---

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start infrastructure (PostgreSQL, Redis)
docker-compose up -d

# Run database migrations
npx prisma migrate dev

# Start development server
npm run start:dev
```

---

## Environment Variables

See `.env.example` for the full list. Key variables:

```env
DATABASE_URL=
REDIS_URL=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
PAYSTACK_SECRET_KEY=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
FIREBASE_SERVICE_ACCOUNT=
TERMII_API_KEY=
RESEND_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_TEAM_ID=
PCN_REGISTRY_API_KEY=
CAC_REGISTRY_API_KEY=
```

---

## Key Contacts

| Role | Name |
|---|---|
| Project Lead / Backend Architect | Richard Uzor |
| Company | Devstrike Digital Limited |
| Product | FADA — Find Any Drug Anywhere |

---

## License

Private & Confidential — Property of Devstrike Digital Limited. All rights reserved.
