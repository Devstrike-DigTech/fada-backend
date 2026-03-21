# FADA Backend — Development Phases

> Each phase is self-contained and can be picked up independently.
> Phases should be completed in order as later phases depend on earlier ones.

---

## Phase Status Legend
- 🔲 Not Started
- 🔄 In Progress
- ✅ Complete
- ⏸ Paused

---

## Phase 1 — Foundation & Infrastructure Setup
**Status:** 🔲 Not Started
**Estimated Effort:** 2–3 days

### Goals
Set up the project skeleton, development tooling, infrastructure services, and shared modules that all feature modules depend on.

### Tasks
- [ ] Initialize NestJS project with TypeScript strict mode
- [ ] Configure ESLint + Prettier
- [ ] Set up `tsconfig.json` with path aliases (`@modules/*`, `@common/*`, `@infra/*`)
- [ ] Create `docker-compose.yml` (PostgreSQL + PostGIS, Redis)
- [ ] Create `Dockerfile` for production
- [ ] Set up `@nestjs/config` with validated environment schema (Joi)
- [ ] Create all config files (`app.config.ts`, `database.config.ts`, `redis.config.ts`, etc.)
- [ ] Set up Prisma ORM with PostgreSQL
- [ ] Enable PostGIS extension in database
- [ ] Create `PrismaService` with connection lifecycle hooks
- [ ] Create `RedisService` (ioredis)
- [ ] Set up BullMQ with `QueueModule` and queue name constants
- [ ] Create `EventBusService` (wraps NestJS EventEmitter2)
- [ ] Create `StorageService` (Cloudflare R2 abstraction)
- [ ] Create `CloudinaryService` (image uploads + transforms)
- [ ] Create `PaymentInterface` + `PaystackService` stub
- [ ] Create `FlutterwaveService` stub
- [ ] Set up `Socket.IO` gateway with Redis adapter
- [ ] Create global HTTP exception filter
- [ ] Create response transform interceptor (standard API envelope)
- [ ] Create global validation pipe
- [ ] Set up Swagger/OpenAPI docs (`/api/docs`)
- [ ] Write `.env.example` with all required variables
- [ ] Set up `jest` for unit + e2e testing
- [ ] Create `src/common/types/events.types.ts` (all event payload types)

### Deliverables
- Running NestJS server on `localhost:3000`
- Swagger docs at `localhost:3000/api/docs`
- PostgreSQL + Redis running via Docker
- All infrastructure services injectable across modules

---

## Phase 2 — Auth Module
**Status:** 🔲 Not Started
**Estimated Effort:** 3–4 days
**Depends on:** Phase 1

### Goals
Complete authentication for both pharmacists and customers including registration, verification, login, OAuth, guest sessions, and password recovery.

### Tasks

#### Customer Registration
- [ ] `POST /auth/register/customer` — multi-step registration
  - Step 1: Full name
  - Step 2: Email
  - Step 3: Phone number
  - Step 4: Date of birth
  - Step 5: Gender
  - Step 6: Password (with strength validation)
- [ ] Email OTP generation + Termii/Resend dispatch (5-digit code, 10 min TTL)
- [ ] `POST /auth/verify/email` — verify OTP
- [ ] Welcome email + FADA ID generation (`CUSXXXXXXX` format)

#### Pharmacist Registration
- [ ] `POST /auth/register/pharmacist` — multi-step registration
  - Step 1: First + Last name
  - Step 2: Email + OTP verification
  - Step 3: Phone, License Type (dropdown), License Number, Password
  - Step 4: Pharmacy Name, Email, Phone, CAC Number, Country, Address, Landmark, GPS location
- [ ] License Type seeding (PCN license types)
- [ ] Background PCN license verification job (async)
- [ ] Background CAC number verification job (async)
- [ ] Pharmacy FADA ID generation (`PHMXXXXXXX` format)

#### Login
- [ ] `POST /auth/login` — Email/FADA ID + Password
- [ ] `GET /auth/login/google` + callback — Google OAuth (Passport)
- [ ] Apple Sign-In — `POST /auth/login/apple`
- [ ] JWT access token (15 min) + refresh token (30 days) pair
- [ ] Refresh token stored in Redis (with device binding)
- [ ] `POST /auth/refresh` — rotate refresh token
- [ ] `POST /auth/logout` — revoke refresh token

#### Guest Sessions
- [ ] `GET /auth/guest/token` — issue anonymous JWT with guest flag + device fingerprint
- [ ] Guest rate limits enforced via Redis:
  - 3 searches/day: `guest:{deviceId}:searches:{date}`
  - 1 reservation/day: `guest:{deviceId}:reservations:{date}`

#### Password Recovery
- [ ] `POST /auth/password/forgot` — send OTP to email
- [ ] `POST /auth/password/verify-otp` — verify OTP
- [ ] `POST /auth/password/reset` — set new password (must differ from previous)

#### Guards & Strategies
- [ ] `JwtAuthGuard` — validates access token
- [ ] `RolesGuard` — enforces `@Roles('customer' | 'pharmacist' | 'admin')`
- [ ] `GuestGuard` — allows guest JWTs with limited access
- [ ] `PublicDecorator` — bypasses auth for public endpoints
- [ ] `CurrentUserDecorator` — injects user from request

#### Events Emitted
- `auth.customer.registered`
- `auth.pharmacist.registered`
- `auth.email.verified`
- `auth.phone.verified`
- `auth.guest.session.created`

### Deliverables
- Full auth flow for both user types
- JWT-secured endpoints
- Guest mode with Redis-enforced limits
- PCN + CAC async verification jobs

---

## Phase 3 — Pharmacy & Branch Module
**Status:** 🔲 Not Started
**Estimated Effort:** 2–3 days
**Depends on:** Phase 2

### Goals
Pharmacy profile management, branch management, working hours, GPS location, verification status display, and reputation levels.

### Tasks
- [ ] `GET /pharmacies/:id` — public pharmacy profile
- [ ] `PUT /pharmacies/:id/profile` — update pharmacy profile
- [ ] `POST /pharmacies/:id/images` — upload pharmacy photos (Cloudinary)
- [ ] `GET /pharmacies/:id/branches` — list branches
- [ ] `POST /pharmacies/:id/branches` — create branch (subscription-limited)
- [ ] `PUT /pharmacies/:id/branches/:branchId` — update branch
- [ ] `DELETE /pharmacies/:id/branches/:branchId` — deactivate branch
- [ ] Working hours CRUD (`PharmacyWorkingHours` — 7 rows per pharmacy)
- [ ] Verification status display (`pcn_verified`, `cac_verified`)
- [ ] Pharmacy reputation level computation (LVL system — based on points/activity)
- [ ] "X years active" calculation from `founded_year` or `created_at`
- [ ] Event listener: `auth.pharmacist.registered` → auto-create Pharmacy record

#### Events Emitted
- `pharmacy.branch.created`
- `pharmacy.branch.deactivated`
- `pharmacy.profile.updated`

#### Events Listened To
- `auth.pharmacist.registered`
- `subscription.plan.downgraded` → enforce branch count limits

### Deliverables
- Pharmacy profile + branch management APIs
- Working hours management
- Pharmacy photos

---

## Phase 4 — Inventory Module
**Status:** 🔲 Not Started
**Estimated Effort:** 4–5 days
**Depends on:** Phase 3

### Goals
Full drug inventory management including single entry, batch upload, NAFDAC lookup, categories, alternatives, and stock tracking.

### Tasks

#### NAFDAC Cache
- [ ] `GET /inventory/nafdac/:number` — lookup NAFDAC number
- [ ] Seed NAFDAC cache from public NAFDAC registry data
- [ ] Weekly refresh cron job

#### Drug CRUD
- [ ] `GET /inventory/:branchId/drugs` — paginated drug list per branch
- [ ] `POST /inventory/:branchId/drugs` — add single drug (NAFDAC-first)
- [ ] `GET /inventory/:branchId/drugs/:drugId` — drug detail
- [ ] `PUT /inventory/:branchId/drugs/:drugId` — edit drug (sectional: Drug Info / Usage Info / Inventory Info)
- [ ] `DELETE /inventory/:branchId/drugs/:drugId` — delete drug (with confirmation)
- [ ] Drug fields: name, manufacturer, composition, category (multi), indication (multi), alias, alternative drug, dosage (adult + children), contraindication (multi), price, package type, stock amount, prescription flag, images
- [ ] Slot limit enforcement (check against subscription plan before insert)
- [ ] Stock status auto-computation: `in_stock` / `low_stock` / `out_of_stock`
- [ ] `POST /inventory/:branchId/drugs/:drugId/images` — upload drug images (Cloudinary)

#### Batch Upload
- [ ] `POST /inventory/:branchId/drugs/batch-upload` — upload CSV/Excel file
- [ ] BullMQ processor: parse → validate → map to schema → insert → report
- [ ] `GET /inventory/:branchId/drugs/batch-upload/:jobId` — poll job status
- [ ] Downloadable template CSV endpoint
- [ ] Progress via WebSocket room

#### Categories
- [ ] `GET /inventory/categories` — list all drug categories
- [ ] Predefined categories: Oral Drugs, Infusion Drugs, Injectable Drugs, Antiseptics, Others
- [ ] Drug-category junction (drug can belong to multiple categories)

#### Alternatives
- [ ] `POST /inventory/:branchId/drugs/:drugId/alternatives` — link alternative drug
- [ ] `GET /inventory/:branchId/drugs/:drugId/alternatives`

#### Events Emitted
- `inventory.drug.added`
- `inventory.drug.updated`
- `inventory.drug.deleted`
- `inventory.stock.low`
- `inventory.stock.out`
- `inventory.batch.completed`

#### Events Listened To
- `reservation.confirmed` → decrement stock
- `reservation.cancelled` → restore stock
- `subscription.plan.changed` → update slot enforcement

### Deliverables
- Full inventory CRUD with NAFDAC lookup
- Batch upload pipeline with job tracking
- Category management
- Stock level auto-management

---

## Phase 5 — Search & Discovery Module
**Status:** 🔲 Not Started
**Estimated Effort:** 3–4 days
**Depends on:** Phase 4

### Goals
Drug, ailment, and pharmacy search with geo-fencing + radius expansion. Guest rate limiting. Search history.

### Tasks
- [ ] `GET /search/drugs` — drug search (FTS + PostGIS geo-fence)
  - Params: `q`, `lat`, `lng`, `radius`, `category`, `page`, `limit`
  - Tiered radius expansion: 2km → 5km → 10km → 20km → 50km if 0 results
  - Returns: drug name, pharmacy address, distance (KM), price, stock count
- [ ] `GET /search/ailments` — ailment search → returns drugs treating the ailment
- [ ] `GET /search/pharmacies` — pharmacy search by name/location
  - Returns: pharmacy name, address, distance, LVL badge
- [ ] `GET /search/pharmacies/:id/drugs` — search within a specific pharmacy
- [ ] `GET /search/drugs/:drugId` — full drug profile (customer-facing)
- [ ] `GET /search/drugs/:drugId/availability` — which nearby pharmacies have this drug
- [ ] Guest rate limit middleware (3 searches/day via Redis)
- [ ] Search query logging → `CustomerSearchHistory`
- [ ] Ailment tag seeding (common Nigerian drug ailments)

#### PostgreSQL FTS Setup
- [ ] `search_vector` generated column on `drugs` table
- [ ] GIN index on `search_vector`
- [ ] PostGIS `GIST` index on `branches.location`
- [ ] Combined geo + FTS query with `ST_DWithin`

#### Events Emitted
- `search.query.recorded`

#### Events Listened To
- `inventory.drug.added` → update search index
- `inventory.drug.updated` → update search index
- `inventory.drug.deleted` → remove from index

### Deliverables
- Drug/ailment/pharmacy search with geo-fencing + radius expansion
- Guest search rate limiting
- Search history recording

---

## Phase 6 — Reservation Module
**Status:** 🔲 Not Started
**Estimated Effort:** 3–4 days
**Depends on:** Phase 5

### Goals
Full reservation lifecycle: create, verify, serve, cancel, expire. QR + alphanumeric code generation. Guest reservation limits. Batch reservation from saved lists.

### Tasks
- [ ] `POST /reservations` — create single drug reservation
- [ ] `POST /reservations/from-list` — batch reservation from CustomerDrugList
- [ ] `GET /reservations/:id` — reservation detail (includes QR code URL + alphanumeric code)
- [ ] `GET /reservations/customer/:customerId` — customer's reservation history
- [ ] `GET /reservations/pharmacy/:pharmacyId` — pharmacy's reservation feed (Pending/Served/Expired)
- [ ] `POST /reservations/verify` — pharmacist verifies (QR scan or manual code entry)
  - Returns: drug info, quantity, total, customer name, call number
- [ ] `PUT /reservations/:id/serve` — mark as served
- [ ] `PUT /reservations/:id/cancel` — cancel (customer or pharmacist)
- [ ] QR code generation (node `qrcode` lib → PNG → R2 → URL)
- [ ] Alphanumeric code generation (`RSVXXXXX` format — nanoid, uppercase + digits)
- [ ] Guest reservation limit (Redis: `guest:{deviceId}:reservations:{date}`)
- [ ] Login prompt trigger (soft prompt after 1 guest reservation)
- [ ] BullMQ cron every 15 min → expire stale pending reservations
- [ ] Reservation status history trail

#### Events Emitted
- `reservation.created`
- `reservation.confirmed`
- `reservation.cancelled`
- `reservation.picked_up`
- `reservation.expired`

#### Events Listened To
- `inventory.stock.out` → auto-cancel pending reservations for that drug

### Deliverables
- Full reservation CRUD with QR + code generation
- Pharmacist verification + serve flow
- Guest rate limiting
- Automatic expiry job

---

## Phase 7 — Subscription & Payments Module
**Status:** 🔲 Not Started
**Estimated Effort:** 3–4 days
**Depends on:** Phase 3

### Goals
Subscription plan management, Paystack integration, billing cycles, webhook handling.

### Tasks

#### Plans
- [ ] Seed subscription plans:
  | Plan | Monthly | Quarterly | Annually |
  |---|---|---|---|
  | Sokka | (free/lowest) | — | — |
  | Toph | ₦2,500 | — | — |
  | Katara | ₦5,000 | ₦20,500 | ₦67,500 |
  | Zuko | ₦7,500 | — | — |
  | Aang | ₦10,000 | — | — |
- [ ] `GET /subscriptions/plans` — list all plans with features

#### Subscription Management
- [ ] `GET /subscriptions/pharmacy/:pharmacyId` — current subscription
- [ ] `POST /subscriptions/pharmacy/:pharmacyId/subscribe` — initiate subscription
- [ ] `POST /subscriptions/pharmacy/:pharmacyId/upgrade` — upgrade plan
- [ ] `POST /subscriptions/pharmacy/:pharmacyId/cancel` — cancel subscription
- [ ] `GET /subscriptions/pharmacy/:pharmacyId/billing-history`

#### Paystack Integration
- [ ] Initialize transaction → redirect to Paystack hosted page
- [ ] `POST /subscriptions/webhook/paystack` — handle: `charge.success`, `subscription.create`, `subscription.disable`, `invoice.payment_failed`
- [ ] HMAC-SHA512 signature verification on all webhooks
- [ ] Store `paystack_subscription_code` + `paystack_customer_code`

#### Flutterwave Fallback
- [ ] `POST /subscriptions/webhook/flutterwave`
- [ ] Same event handling as Paystack via `IPaymentProvider` interface

#### Events Emitted
- `subscription.plan.activated`
- `subscription.plan.upgraded`
- `subscription.plan.downgraded`
- `subscription.plan.expired`
- `subscription.payment.failed`

### Deliverables
- All 5 subscription plans seeded
- Paystack recurring billing integrated
- Webhook handling with signature verification
- Flutterwave fallback interface

---

## Phase 8 — Ads & Promotions Module
**Status:** 🔲 Not Started
**Estimated Effort:** 3 days
**Depends on:** Phase 7

### Goals
Pharmacy-side ad campaign management. Customer-side ad serving (geo-targeted). Impression + click tracking. Distributor drug profiles.

### Tasks
- [ ] `GET /ads/pharmacy/:pharmacyId/campaigns` — list campaigns
- [ ] `POST /ads/pharmacy/:pharmacyId/campaigns` — create campaign (tied to drug + timeslot)
- [ ] `PUT /ads/pharmacy/:pharmacyId/campaigns/:id` — update
- [ ] `DELETE /ads/pharmacy/:pharmacyId/campaigns/:id` — delete/pause
- [ ] `GET /ads/pharmacy/:pharmacyId/campaigns/:id/analytics`
- [ ] `GET /ads/feed` — customer-facing: active ads near customer location
- [ ] `POST /ads/impressions` — record ad impression (client calls when ad renders)
- [ ] `POST /ads/clicks` — record ad click
- [ ] `GET /ads/:id` — ad detail page (for customer "Ad Info" screen)
- [ ] Drug type filter on promotions (Orals, Infusions, Injectibles, Antiseptics, Others)
- [ ] Rating system on ads/drugs (star ratings)
- [ ] Subscription tier gating (only eligible plans can create ads)
- [ ] Ad discount application based on subscription plan

#### Events Emitted
- `ad.campaign.activated`
- `ad.campaign.expired`
- `ad.impression.recorded`
- `ad.click.recorded`

#### Events Listened To
- `subscription.plan.activated` → unlock ad creation
- `inventory.drug.deleted` → pause linked campaigns

### Deliverables
- Full ad campaign CRUD for pharmacies
- Geo-targeted ad feed for customers
- Impression/click analytics

---

## Phase 9 — Customer Features Module
**Status:** 🔲 Not Started
**Estimated Effort:** 3 days
**Depends on:** Phase 6

### Goals
Saves (drugs, pharmacies, lists), custom addresses, profile details, and search history management.

### Tasks

#### Profile
- [ ] `GET /customer/profile` — customer profile
- [ ] `PUT /customer/profile` — update profile (name, email, phone, gender, DOB)
- [ ] `GET /customer/profile/details` — profile details screen data

#### Addresses
- [ ] `GET /customer/addresses` — list saved addresses
- [ ] `POST /customer/addresses` — add address
- [ ] `PUT /customer/addresses/:id` — update address
- [ ] `DELETE /customer/addresses/:id` — remove address

#### Saves
- [ ] `GET /saves/drugs` — bookmarked drugs
- [ ] `POST /saves/drugs/:drugId` — save a drug
- [ ] `DELETE /saves/drugs/:drugId` — unsave
- [ ] `GET /saves/pharmacies` — bookmarked pharmacies
- [ ] `POST /saves/pharmacies/:pharmacyId` — save pharmacy
- [ ] `DELETE /saves/pharmacies/:pharmacyId` — unsave

#### Drug Lists
- [ ] `GET /saves/lists` — all drug lists
- [ ] `POST /saves/lists` — create named list
- [ ] `PUT /saves/lists/:id` — rename list
- [ ] `DELETE /saves/lists/:id` — delete list
- [ ] `POST /saves/lists/:id/drugs` — add drug to list
- [ ] `DELETE /saves/lists/:id/drugs/:drugId` — remove drug from list
- [ ] `GET /saves/lists/:id` — list detail with drugs

#### Search History
- [ ] `GET /customer/history/searches` — past searches (Repeat action)
- [ ] `DELETE /customer/history/searches/:id` — remove from history
- [ ] `POST /customer/history/searches/:id/repeat` — trigger repeat search

#### Reservation History
- [ ] `GET /customer/history/reservations` — past reservations with status

### Deliverables
- Saves system (drugs, pharmacies, named lists)
- Multiple address management
- Search + reservation history
- Batch reserve from list (calls reservation module)

---

## Phase 10 — Points & Reputation Module
**Status:** 🔲 Not Started
**Estimated Effort:** 2 days
**Depends on:** Phase 6

### Goals
FADA points ledger for customers and pharmacies. Reputation level (LVL) system for pharmacies. Points earning rules tied to domain events.

### Tasks
- [ ] `GET /points/customer/:customerId` — balance + level
- [ ] `GET /points/customer/:customerId/history` — transaction log
- [ ] `GET /points/pharmacy/:pharmacyId` — pharmacy points + LVL
- [ ] `GET /points/pharmacy/:pharmacyId/history`
- [ ] `GET /points/levels` — all reputation levels + requirements
- [ ] Points earning rules:
  | Event | Customer Points | Pharmacy Points |
  |---|---|---|
  | Registration | +50 | +100 |
  | Reservation completed | +10 | +20 |
  | Drug added to inventory | — | +5 |
  | Ad campaign activated | — | +15 |
  | Profile completed | +20 | +30 |
- [ ] Level thresholds for LVL 1 → LVL N
- [ ] LVL badge computation for pharmacy search results

#### Events Listened To
- `auth.customer.registered`
- `auth.pharmacist.registered`
- `reservation.picked_up`
- `inventory.drug.added`
- `ad.campaign.activated`

#### Events Emitted
- `points.earned`
- `points.level.upgraded`

### Deliverables
- Points ledger for both user types
- LVL reputation system for pharmacies
- Event-driven points earning

---

## Phase 11 — Notifications Module
**Status:** 🔲 Not Started
**Estimated Effort:** 2–3 days
**Depends on:** Phase 2

### Goals
Push (FCM), in-app, SMS (Termii), and email (Resend) notification dispatch. Device token registry. Notification history + preferences.

### Tasks
- [ ] `POST /notifications/device-tokens` — register FCM token
- [ ] `DELETE /notifications/device-tokens/:token` — deregister
- [ ] `GET /notifications/history` — in-app notification list
- [ ] `PUT /notifications/:id/read` — mark as read
- [ ] `PUT /notifications/read-all` — mark all as read
- [ ] `PUT /notifications/preferences` — toggle notification types
- [ ] FCM push provider (`firebase-admin`)
- [ ] Termii SMS provider
- [ ] Resend email provider
- [ ] BullMQ `notifications` queue — all dispatch goes through queue for retry
- [ ] Notification templates for all event types

#### Notification Triggers (Events Listened To)
| Event | Recipient | Channel |
|---|---|---|
| `reservation.created` | Pharmacist | Push + In-app |
| `reservation.confirmed` | Customer | Push + In-app |
| `reservation.cancelled` | Both | Push + In-app |
| `reservation.picked_up` | Customer | Push + In-app |
| `reservation.expired` | Customer | Push + In-app |
| `inventory.stock.low` | Pharmacist | Push + In-app |
| `inventory.stock.out` | Pharmacist | Push + In-app + SMS |
| `subscription.payment.failed` | Pharmacist | Push + Email + SMS |
| `subscription.plan.expired` | Pharmacist | Push + Email |
| `ad.campaign.expired` | Pharmacist | Push + In-app |
| `points.level.upgraded` | Both | Push + In-app |

### Deliverables
- Multi-channel notification dispatch
- BullMQ-backed queue with retry
- Device token management
- Notification history + preferences

---

## Phase 12 — Support & Content Module
**Status:** 🔲 Not Started
**Estimated Effort:** 2 days
**Depends on:** Phase 2

### Goals
Support tickets/complaints, feature suggestions, static content pages, and "To Good Cause" CSR section.

### Tasks

#### Support
- [ ] `POST /support/complaints` — file complaint (Type + Description)
- [ ] `GET /support/complaints` — customer's complaint history
- [ ] `PUT /support/complaints/:id` — update complaint status (admin)
- [ ] `POST /support/suggestions` — suggest a feature
- [ ] `GET /support/contact` — contact info (phone, email)

#### Static Content
- [ ] `GET /content/app-info` — app identity, motive, mission, dates
- [ ] `GET /content/disclaimer`
- [ ] `GET /content/terms-of-service`
- [ ] `GET /content/privacy-policy`
- [ ] `GET /content/credits`
- [ ] `GET /content/future-features`

#### Good Cause
- [ ] `GET /content/good-cause/projects`
- [ ] `GET /content/good-cause/testimonials`
- [ ] Admin CRUD for managing projects + testimonials

### Deliverables
- Support ticket system
- Static content API
- Good Cause CSR section

---

## Phase 13 — Analytics Module
**Status:** 🔲 Not Started
**Estimated Effort:** 2–3 days
**Depends on:** Phase 8

### Goals
Pharmacy performance dashboards (subscription-gated). Search trend data. Ad analytics. Reservation metrics.

### Tasks
- [ ] `GET /analytics/pharmacy/:id/overview` — summary stats for period
- [ ] `GET /analytics/pharmacy/:id/reservations` — reservation metrics
- [ ] `GET /analytics/pharmacy/:id/inventory` — inventory stats (most reserved drugs, low stock)
- [ ] `GET /analytics/pharmacy/:id/search-appearances` — how often pharmacy appeared in search
- [ ] `GET /analytics/pharmacy/:id/ads` — ad performance (impressions, clicks, CTR)
- [ ] Daily snapshot aggregation cron job
- [ ] Subscription tier gating on analytics endpoints
- [ ] Search trend aggregation

#### Events Listened To
- `reservation.picked_up`
- `search.query.recorded`
- `ad.impression.recorded`
- `ad.click.recorded`
- `inventory.drug.added`
- `inventory.drug.deleted`

### Deliverables
- Pharmacy analytics dashboard APIs
- Gated by subscription tier
- Daily snapshot cron jobs

---

## Phase 14 — Real-Time & WebSockets
**Status:** 🔲 Not Started
**Estimated Effort:** 2 days
**Depends on:** Phase 6, Phase 11

### Goals
Socket.IO real-time updates for reservation status changes. Live pharmacy reservation feed. Batch upload progress streaming.

### Tasks
- [ ] Socket.IO gateway with JWT authentication on connect
- [ ] Redis adapter for horizontal scaling
- [ ] Room naming + authorization:
  - `reservation:{id}` — both customer and pharmacist
  - `pharmacy:{id}:reservations` — pharmacist reservation feed
  - `customer:{id}:reservations` — customer reservation updates
  - `batch-upload:{jobId}` — upload progress
- [ ] Emit on reservation status change
- [ ] Emit batch upload progress updates
- [ ] Guard: prevent unauthorized room joins

### Deliverables
- Live reservation status updates (customer + pharmacist)
- Real-time pharmacy reservation feed
- Batch upload progress streaming

---

## Phase 15 — Testing, Security & Deployment
**Status:** 🔲 Not Started
**Estimated Effort:** 5–7 days
**Depends on:** All phases

### Goals
Comprehensive test coverage, security hardening, production Docker setup, and deployment pipeline.

### Tasks

#### Testing
- [ ] Unit tests for all service classes (jest)
- [ ] E2E tests for critical flows:
  - Customer registration + login
  - Pharmacist registration + verification
  - Drug search + reservation flow
  - Subscription + payment flow
- [ ] Integration tests for event bus listeners

#### Security
- [ ] Helmet.js HTTP security headers
- [ ] Rate limiting (Throttler) on all public endpoints
- [ ] Request size limits (prevent payload attacks)
- [ ] CORS configuration (whitelist frontend origins)
- [ ] SQL injection prevention (Prisma parameterized queries — default)
- [ ] JWT secret rotation strategy
- [ ] Webhook signature verification (Paystack, Flutterwave)
- [ ] Sensitive field scrubbing in logs

#### Deployment
- [ ] Multi-stage Dockerfile (build → production)
- [ ] `docker-compose.prod.yml`
- [ ] Railway deployment configuration
- [ ] Environment variable management (Railway secrets)
- [ ] Database migration strategy for production
- [ ] Health check endpoint `GET /health`
- [ ] Liveness + readiness probes
- [ ] PM2 or Railway process management
- [ ] CI/CD pipeline (GitHub Actions):
  - Lint + test on PR
  - Deploy to staging on merge to `develop`
  - Deploy to production on merge to `main`

### Deliverables
- >70% test coverage on business logic
- Production-hardened Docker image
- CI/CD pipeline
- Railway deployment

---

## Dependencies Map

```
Phase 1 (Foundation)
  └── Phase 2 (Auth)
        ├── Phase 3 (Pharmacy)
        │     ├── Phase 4 (Inventory)
        │     │     └── Phase 5 (Search)
        │     │           └── Phase 6 (Reservation)
        │     │                 └── Phase 9 (Customer Features)
        │     │                 └── Phase 10 (Points)
        │     └── Phase 7 (Subscription)
        │           └── Phase 8 (Ads)
        │                 └── Phase 13 (Analytics)
        └── Phase 11 (Notifications)  ← listens to events from 3–10
        └── Phase 12 (Support & Content)
              Phase 14 (Real-Time) ← needs Phase 6 + 11
              Phase 15 (Testing & Deployment) ← needs all
```

---

## Notes for Picking Up

When resuming work after a pause:
1. Check this file for the last completed phase
2. Check `git log` for the last commit
3. Run `npm run test` to verify existing code still passes
4. Run `npx prisma migrate dev` if schema has pending changes
5. Check `.env` for any new variables added since last session
