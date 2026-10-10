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
**Status:** ✅ Complete
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
**Status:** ✅ Complete
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
**Status:** ✅ Complete
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
**Status:** ✅ Complete
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
**Status:** ✅ Complete
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
**Status:** ✅ Complete
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
**Status:** ✅ Complete
**Estimated Effort:** 3–4 days
**Depends on:** Phase 3

### Goals
Subscription plan management, Paystack integration, billing cycles, webhook handling.

### Tasks

#### Plans
- [x] Seed subscription plans:
  | Plan | Monthly | Quarterly | Annually |
  |---|---|---|---|
  | Sokka | (free/lowest) | — | — |
  | Toph | ₦2,500 | — | — |
  | Katara | ₦5,000 | ₦20,500 | ₦67,500 |
  | Zuko | ₦7,500 | — | — |
  | Aang | ₦10,000 | — | — |
- [x] `GET /subscriptions/plans` — list all plans with features

#### Subscription Management
- [x] `GET /subscriptions/pharmacy/:pharmacyId` — current subscription
- [x] `POST /subscriptions/pharmacy/:pharmacyId/subscribe` — initiate subscription
- [x] `POST /subscriptions/pharmacy/:pharmacyId/upgrade` — upgrade plan
- [x] `POST /subscriptions/pharmacy/:pharmacyId/cancel` — cancel subscription
- [x] `GET /subscriptions/pharmacy/:pharmacyId/billing-history`

#### Paystack Integration
- [x] Initialize transaction → redirect to Paystack hosted page
- [x] `POST /subscriptions/webhook/paystack` — handle: `charge.success`, `subscription.create`, `subscription.disable`, `invoice.payment_failed`
- [x] HMAC-SHA512 signature verification on all webhooks
- [x] Store `paystack_subscription_code` + `paystack_customer_code`

#### Flutterwave Fallback
- [x] `POST /subscriptions/webhook/flutterwave`
- [x] Same event handling as Paystack via `IPaymentProvider` interface

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

### Implementation notes (as built)
- Module: `src/modules/subscription/` — `SubscriptionService` (lifecycle), `SubscriptionEntitlementsService`
  (plan limits, imported by Pharmacy and Inventory), `SubscriptionController`, `SubscriptionWebhookController`,
  registration listener (assigns the free Sokka plan), hourly billing sweep in `src/jobs/subscription/`.
- Providers: `src/infrastructure/payments/` — `PaystackService` (primary, recurring via Paystack Plans)
  and `FlutterwaveService` (fallback) behind one `IPaymentProvider`; selected by `PAYMENT_DEFAULT_PROVIDER`
  or per request.
- Extra endpoints: `GET /subscriptions/payments/verify/:reference` (app polls after checkout) and
  `GET /subscriptions/payments/callback` (hosted-checkout return URL, public).
- Plan-change rules: upgrades with > `SUBSCRIPTION_IMMEDIATE_CHANGE_THRESHOLD_DAYS` left are pro-rated
  and charged now; otherwise, and for all downgrades, the change is scheduled for the next renewal.
  One change per `SUBSCRIPTION_PLAN_CHANGE_COOLDOWN_DAYS`.
- Failed renewals open a `SUBSCRIPTION_GRACE_PERIOD_DAYS` window (`past_due`, still entitled); when it
  ends the pharmacy drops to Sokka. Cancellation keeps access until period end.
- Pricing: quarterly = 3 × monthly − 10 %, annual = 12 × monthly − 25 % for every paid plan. The
  Katara quarterly/annual figures in the table above (₦20,500 / ₦67,500) exceed 3× and 12× monthly and
  look like a typo, so the seed uses the discount rule instead — confirm with product.
- Migration `20261009120000_phase7_subscriptions` adds pending-change, grace, provider-code and
  billing-purpose columns. Schema has `BillingPurpose` enum.

---

## Phase 8 — Ads & Promotions Module
**Status:** ✅ Complete
**Estimated Effort:** 3 days
**Depends on:** Phase 7

### Goals
Pharmacy-side ad campaign management. Customer-side ad serving (geo-targeted). Impression + click tracking. Distributor drug profiles.

### Tasks
- [x] `GET /ads/pharmacy/:pharmacyId/campaigns` — list campaigns
- [x] `POST /ads/pharmacy/:pharmacyId/campaigns` — create campaign (tied to drug + timeslot)
- [x] `PUT /ads/pharmacy/:pharmacyId/campaigns/:id` — update
- [x] `DELETE /ads/pharmacy/:pharmacyId/campaigns/:id` — delete/pause
- [x] `GET /ads/pharmacy/:pharmacyId/campaigns/:id/analytics`
- [x] `GET /ads/feed` — customer-facing: active ads near customer location
- [x] `POST /ads/impressions` — record ad impression (client calls when ad renders)
- [x] `POST /ads/clicks` — record ad click
- [x] `GET /ads/:id` — ad detail page (for customer "Ad Info" screen)
- [x] Drug type filter on promotions (Orals, Infusions, Injectibles, Antiseptics, Others)
- [x] Rating system on ads/drugs (star ratings)
- [x] Subscription tier gating (only eligible plans can create ads)
- [x] Ad discount application based on subscription plan

### Implementation notes (as built)
- Module `src/modules/ads/`: `AdsService` (campaign CRUD, quote, checkout, geo feed, impressions/clicks,
  ratings, review, hourly lifecycle sweep in `src/jobs/ads/`), `AdsController`. Pricing in `ad-pricing.ts`:
  ₦250 × daily frequency × weekly days × duration weeks, less the plan's `adDiscountPct`, less promotions.
- Campaign lifecycle: `draft` → (paid + approved + slot started) → `active` → `expired`. Pharmacies can
  pause/resume/cancel; content edits send a campaign back to `pending` review and pause it if live.
- Payment reuses the subscription checkout (`SubscriptionService.startCheckout`, purpose `ad_campaign`);
  the paid webhook emits `ads.payment.successful` which `AdsListeners` applies. Ad spend shows in billing history.
- Feed (`GET /ads/feed`): active, approved, paid campaigns inside their slot, within
  `LEAST(campaign.targetRadiusKm, viewer radius)` of the campaign's head-branch coordinates, served on ISO
  weekdays 1..`weeklyDays`, capped at `dailyFrequency` counted impressions per viewer per day. Falls back to
  `targetState` without coordinates. Impressions dedupe per viewer per campaign per hour (Redis).
- Ratings: one 1–5 star rating per customer per ad (`ad_ratings`), average denormalised on the campaign.
- **Promotions** (`src/modules/promotions/`): back-office seasonal discounts and promo codes
  (`percentage` | `fixed_amount`, optional cap, scope `subscriptions` | `ads` | `both`, plan/interval
  restrictions, date window, total and per-pharmacy redemption limits, `autoApply` for seasonal promos).
  Applied inside every checkout; `promoCode` accepted on subscribe / upgrade / ad checkout. A ₦0 result
  completes without the payment provider.
- **Back office** (`src/modules/admin/`): `GET /admin/dashboard/overview` and `/audit-logs`;
  `/admin/subscriptions` (list, detail, revenue, assign-plan comp, extend, cancel);
  `/admin/ads` (overview, list, detail, approve/reject, force pause/resume/cancel);
  `/admin/promotions` CRUD. Every admin action is written to `admin_audit_logs`.
- Migration `20261009130000_phase8_ads_promotions` (ad campaign pricing/review columns, `ad_events`,
  `ad_ratings`, `promotions`, `promotion_redemptions`, `admin_audit_logs`, billing-record promo/ad links).
- Not done here: drug-level ratings (ratings are per ad) — belongs with reservation rating in Phase 9.

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
**Status:** ✅ Complete
**Estimated Effort:** 3 days
**Depends on:** Phase 6

### Goals
Saves (drugs, pharmacies, lists), custom addresses, profile details, and search history management.

### Tasks

#### Profile
- [x] `GET /customer/profile` — customer profile
- [x] `PUT /customer/profile` — update profile (name, email, phone, gender, DOB)
- [x] `GET /customer/profile/details` — profile details screen data

#### Addresses
- [x] `GET /customer/addresses` — list saved addresses
- [x] `POST /customer/addresses` — add address
- [x] `PUT /customer/addresses/:id` — update address
- [x] `DELETE /customer/addresses/:id` — remove address

#### Saves
- [x] `GET /saves/drugs` — bookmarked drugs
- [x] `POST /saves/drugs/:drugId` — save a drug
- [x] `DELETE /saves/drugs/:drugId` — unsave
- [x] `GET /saves/pharmacies` — bookmarked pharmacies
- [x] `POST /saves/pharmacies/:pharmacyId` — save pharmacy
- [x] `DELETE /saves/pharmacies/:pharmacyId` — unsave

#### Drug Lists
- [x] `GET /saves/lists` — all drug lists
- [x] `POST /saves/lists` — create named list
- [x] `PUT /saves/lists/:id` — rename list
- [x] `DELETE /saves/lists/:id` — delete list
- [x] `POST /saves/lists/:id/drugs` — add drug to list
- [x] `DELETE /saves/lists/:id/drugs/:drugId` — remove drug from list
- [x] `GET /saves/lists/:id` — list detail with drugs

#### Search History
- [x] `GET /customer/history/searches` — past searches (Repeat action)
- [x] `DELETE /customer/history/searches/:id` — remove from history
- [x] `POST /customer/history/searches/:id/repeat` — trigger repeat search

#### Reservation History
- [x] `GET /customer/history/reservations` — past reservations with status

### Deliverables
- Saves system (drugs, pharmacies, named lists)
- Multiple address management
- Search + reservation history
- Batch reserve from list (calls reservation module)

### Implementation notes (as built)
- Module `src/modules/customer/`: `CustomerController` (`/customer/*`) and `SavesController` (`/saves/*`),
  services for profile/addresses, saves/lists, and history. Imports SearchModule and ReservationModule.
- Profile update covers name, phone, gender, DOB. **Email is excluded** (verified login identity; change it
  via the auth OTP flow). Avatar stays on `PATCH /users/me/avatar`. Response carries a `completion`
  block (percent, missing fields) and emits `customer.profile.completed` for Phase 10 points.
- Addresses: max 10, first one is default, deleting the default promotes the oldest remaining.
- Saves: idempotent save/unsave; `GET /saves/status?drugIds=&pharmacyIds=` for heart icons; list
  endpoints accept `latitude`/`longitude` to return `distanceKm`.
- Lists: max 20 lists × 50 drugs, quantities, case-insensitive unique names. `GET /saves/lists/:id`
  groups items by branch and flags `canReserveInOneTrip`. `POST /saves/lists/:id/reserve` creates one
  reservation at a branch via `ReservationService.createReservation`; drugs stocked elsewhere are skipped
  and reported.
- Search history is written by `SearchHistoryListener` from `search.performed` events (now tagged with
  `searchType`; pharmacy search emits one too). Same query within 10 min updates the row; 200 rows kept per
  customer. Guest searches are stored under `deviceId` = guest token. `POST /customer/history/searches/:id/repeat`
  re-runs the search through SearchService with the current location.
- Reservation history delegates to `ReservationService.listCustomerReservations`.
- No schema change: all Phase 9 tables existed since `initv1`.

---

## Phase 10 — Points & Reputation Module
**Status:** ✅ Complete
**Estimated Effort:** 2 days
**Depends on:** Phase 6

### Goals
FADA points ledger for customers and pharmacies. Reputation level (LVL) system for pharmacies. Points earning rules tied to domain events.

### Tasks
- [x] `GET /points/customer/:customerId` — balance + level
- [x] `GET /points/customer/:customerId/history` — transaction log
- [x] `GET /points/pharmacy/:pharmacyId` — pharmacy points + LVL
- [x] `GET /points/pharmacy/:pharmacyId/history`
- [x] `GET /points/levels` — all reputation levels + requirements
- [x] Points earning rules:
  | Event | Customer Points | Pharmacy Points |
  |---|---|---|
  | Registration | +50 | +100 |
  | Reservation completed | +10 | +20 |
  | Drug added to inventory | — | +5 |
  | Ad campaign activated | — | +15 |
  | Profile completed | +20 | +30 |
- [x] Level thresholds for LVL 1 → LVL N
- [x] LVL badge computation for pharmacy search results

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

### Implementation notes (as built)
- Module `src/modules/points/`. One `PointsLedger` per owner — `userId` for customers, `pharmacyId` for
  pharmacies (migration `20261010100000_phase10_points` makes `user_id` nullable and adds `pharmacy_id`,
  `level`, `balance_after`, `metadata`, `created_by_id`).
- **Idempotent awards**: unique `(ledger_id, reason, reference_id)`; a redelivered event is a no-op.
  `pharmacy.drug_added` is capped at 50 awards per UTC day so bulk uploads cannot farm points.
- Events actually listened to (the spec's names were placeholders): `auth.user.verified` (+50, paid on
  verification not sign-up), `pharmacy.registered` (+100), `reservation.served` (+10 / +20),
  `inventory.drug.added` (+5), `ads.campaign.activated` (+15), `customer.profile.completed` (+20),
  `pharmacy.profile.completed` (+30 — new event emitted by PharmacyService when contact, address, GPS,
  description, a photo and working hours are all present).
- Levels (`points.levels.ts`): LVL 1 Newcomer 0 → 2 Regular 100 → 3 Trusted 300 → 4 Established 750 →
  5 Reputable 1500 → 6 Elite 3000 → 7 Legend 6000, from **lifetime** points so levels never drop.
  Pharmacy level/points are mirrored to `pharmacies.reputation_level/points`, which search already returns.
- Extra endpoints: `GET /points/rules`, `GET /points/leaderboard/pharmacies?state=`, and back-office
  `POST /admin/points/adjust` (credit/debit with note; audited).
- Emits `points.earned`, `points.redeemed` (negative deltas), `points.level.upgraded`, `points.adjusted`.

---

## Phase 11 — Notifications Module
**Status:** ✅ Complete
**Estimated Effort:** 2–3 days
**Depends on:** Phase 2

### Goals
Push (FCM), in-app, SMS (Termii), and email (Resend) notification dispatch. Device token registry. Notification history + preferences.

### Tasks
- [x] `POST /notifications/device-tokens` — register FCM token
- [x] `DELETE /notifications/device-tokens/:token` — deregister
- [x] `GET /notifications/history` — in-app notification list
- [x] `PUT /notifications/:id/read` — mark as read
- [x] `PUT /notifications/read-all` — mark all as read
- [x] `PUT /notifications/preferences` — toggle notification types
- [x] FCM push provider (`firebase-admin`)
- [x] Termii SMS provider
- [x] Resend email provider
- [x] BullMQ `notifications` queue — all dispatch goes through queue for retry
- [x] Notification templates for all event types

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

### Implementation notes (as built)
- Providers (`src/infrastructure/notifications/`, global `NotificationProvidersModule`): `EmailService` (Resend),
  `FcmService` (firebase-admin, lazy init), `TermiiService` (normalises 0803… → 234803…). Each reports
  `isConfigured`; unconfigured channels are recorded as `skipped`, never crash boot.
- Feature module `src/modules/notifications/`: `NotificationsService.notify()` writes one `in_app` record per
  recipient (pushed live over the socket as a `notification` event with `unreadCount`) and one `queued`
  record per push / SMS / email, delivered by `NotificationsProcessor` on the `notifications` Bull queue
  (4 attempts, exponential backoff). Outcomes (`sent` / `failed` / `skipped` + error) are stored on the row.
- Transactional emails other modules already emit (`notification.email.send_requested`: OTP, staff invites,
  PCN/CAC results) now go through the queue with 5 retries instead of being sent inline.
- **Dedupe**: unique `(recipient, type, dedupe_key)`; keys are derived from the event (e.g.
  `reservation.created:<id>`, low-stock once per drug per day, payment-failed once per grace window).
- **Preferences**: push / SMS / email toggles + muted categories. `account` and `billing` cannot be muted and
  their emails ignore the email toggle. In-app history is always kept; mutes only silence interruptions.
- Triggers (real event names): reservation created → branch team; confirmed / ready / served / cancelled by
  pharmacy / stock-out cancelled / expired → customer; cancelled by customer → branch team; stock low → team;
  stock out → team (push) + owner (SMS); batch upload done → managers; subscription activated (paid plans),
  payment failed (push + email + SMS), plan ended, cancelled → owner; plan changed → managers; ad approved /
  rejected / live / ended → managers; level up → customer or pharmacy managers.
- Extra endpoints: `GET /notifications/unread-count`, `DELETE /notifications/:id`; back office
  `POST /admin/notifications/broadcast` (customers / pharmacists / all / user list; fanned out 200 at a time)
  and `GET /admin/notifications/stats`.
- Retention: daily 03:30 job deletes read in-app rows > 180 days and delivery rows > 90 days.
- Migration `20261010120000_phase11_notifications`. Also fixed: `cac-verified` / `cac-failed` emails had no
  template and were rendering the OTP layout.
- New env: `TERMII_CHANNEL` (generic | dnd), `NOTIFICATIONS_DEFAULT_COUNTRY_CODE`, `APP_DEEP_LINK_SCHEME`.

---

## Phase 12 — Support & Content Module
**Status:** ✅ Complete
**Estimated Effort:** 2 days
**Depends on:** Phase 2

### Goals
Support tickets/complaints, feature suggestions, static content pages, and "To Good Cause" CSR section.

### Tasks

#### Support
- [x] `POST /support/complaints` — file complaint (Type + Description)
- [x] `GET /support/complaints` — customer's complaint history
- [x] `PUT /support/complaints/:id` — update complaint status (admin)
- [x] `POST /support/suggestions` — suggest a feature
- [x] `GET /support/contact` — contact info (phone, email)

#### Static Content
- [x] `GET /content/app-info` — app identity, motive, mission, dates
- [x] `GET /content/disclaimer`
- [x] `GET /content/terms-of-service`
- [x] `GET /content/privacy-policy`
- [x] `GET /content/credits`
- [x] `GET /content/future-features`

#### Good Cause
- [x] `GET /content/good-cause/projects`
- [x] `GET /content/good-cause/testimonials`
- [x] Admin CRUD for managing projects + testimonials

### Deliverables
- Support ticket system
- Static content API
- Good Cause CSR section

### Implementation notes (as built)
- **Support** (`src/modules/support/`): tickets get a human number (`TKT-7K3QX9`), category (slugs mirror the
  app dropdown), subject, description (≥ 20 chars), optional reservation / pharmacy context (authorised: your
  own reservation, or one at your pharmacy), auto priority by category, and a message thread. Users follow up
  on their tickets; a follow-up reopens a resolved ticket, closed is final. 10 tickets and 10 suggestions per
  user per 24 h. Optional `SUPPORT_INBOX_EMAIL` gets a copy of every new ticket.
- The spec's admin `PUT /support/complaints/:id` lives in the back office instead: `/admin/support/tickets`
  (queue, detail with internal notes and linked reservation/pharmacy, PATCH status/priority/assignee/
  resolution, replies or internal notes), `/admin/support/suggestions`, `/admin/support/summary`
  (also on the dashboard overview).
- Notifications: ticket received (in-app), staff reply (push + in-app), status change (push + in-app; email
  when resolved/closed), suggestion status change. Support uses category `account`, which cannot be muted.
- **Content** (`src/modules/content/`): pages `app_info`, `disclaimer`, `terms_of_service`, `privacy_policy`,
  `credits`, `future_features`, `contact` stored as markdown / html / JSON with `version`, publish flag and
  legal effective date. Defaults in `content.defaults.ts` were generated from the customer app's current
  screens; public reads fall back to them when no row exists, the seed creates missing rows only. Redis-cached
  (10 min), invalidated on edit. `GET /content` lists versions so apps refetch only changed pages.
- **Good Cause**: projects with status, target/raised ₦, beneficiaries, states reached, dates, image;
  testimonials optionally linked to a project. `GET /content/good-cause` returns computed stats (patients
  helped, donated, states reached) plus projects and testimonials in one call. Back office CRUD + image
  uploads at `/admin/content/good-cause/*`. The app's mock projects/testimonials are NOT seeded.
- Migration `20261010140000_phase12_support_content`.
- Open items for product/legal: terms say users must be 18+ but profile validation (Phase 9) accepts 13+;
  terms name Lagos courts and the app info says Lagos while launch is Enugu; legal text is the app's draft.

---

## Phase 13 — Analytics Module
**Status:** ✅ Complete
**Estimated Effort:** 2–3 days
**Depends on:** Phase 8

### Goals
Pharmacy performance dashboards (subscription-gated). Search trend data. Ad analytics. Reservation metrics.

### Tasks
- [x] `GET /analytics/pharmacy/:id/overview` — summary stats for period
- [x] `GET /analytics/pharmacy/:id/reservations` — reservation metrics
- [x] `GET /analytics/pharmacy/:id/inventory` — inventory stats (most reserved drugs, low stock)
- [x] `GET /analytics/pharmacy/:id/search-appearances` — how often pharmacy appeared in search
- [x] `GET /analytics/pharmacy/:id/ads` — ad performance (impressions, clicks, CTR)
- [x] Daily snapshot aggregation cron job
- [x] Subscription tier gating on analytics endpoints
- [x] Search trend aggregation

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

### Implementation notes (as built)
- Module `src/modules/analytics/`. Days are **Africa/Lagos calendar days** (`analytics-dates.ts`, tested).
- **Source of truth**: reservations, drugs, ad events, saves and billing are aggregated straight from their
  tables (`AnalyticsAggregatorService.computePharmacyDay`), so no event-driven copy can drift. The spec's
  "events listened to" are therefore not needed, except search: `SearchService` now emits
  `search.results.served` (pharmacy ids on the returned page), and `SearchTrackingService` keeps per-day Redis
  counters (appearances, per-pharmacy top queries, top and zero-result queries, search totals; 9-day TTL).
- **Snapshots**: `analytics.snapshot` queue, 00:20 Africa/Lagos → `pharmacy_daily_stats`,
  `platform_daily_stats`, `search_trends_daily` for yesterday, then backfills any gap in the past 7 days.
  Rewrites are idempotent; if Redis counters for a day have expired, stored search numbers are kept.
  Dashboards read snapshots for past days and compute today (and missing days in the last week) live.
- Pharmacy endpoints `/analytics/pharmacy/:id/{access,overview,reservations,inventory,search-appearances,ads}`
  with `?period=7d|30d|90d|365d` or `?from=&to=`. Owner/operator only; gated on the plan's `hasAnalytics`
  (Zuko / Aang); `access` tells the app whether to show the dashboard or an upgrade prompt. Admins bypass.
- Highlights: % change vs previous period, fulfilment rate, reservations per 100 search appearances, average
  minutes to confirm/serve, busiest hours/weekdays (Lagos time), most reserved/saved drugs, restock and
  30-day expiry lists, the queries a pharmacy appeared for, and platform-wide **unmet demand** (searches with
  zero results) so pharmacies can stock what customers cannot find.
- Back office `/admin/analytics/{platform,search-trends,pharmacies/leaderboard}` and
  `POST /admin/analytics/snapshots/rebuild` (≤ 90 past days, audited).
- Migration `20261010160000_phase13_analytics` (+ supporting indexes on reservation timestamps).
- Verified against a throwaway Postgres: all migrations apply, schema has **zero drift**, seed runs, and an
  end-to-end script exercised every aggregator and dashboard method (32 checks). That check found that no
  migration ever created the `ready` reservation status; fixed by `20261010170000_reservation_ready_status`.

---

## Phase 14 — Real-Time & WebSockets
**Status:** ✅ Complete
**Estimated Effort:** 2 days
**Depends on:** Phase 6, Phase 11

### Goals
Socket.IO real-time updates for reservation status changes. Live pharmacy reservation feed. Batch upload progress streaming.

### Tasks
- [x] Socket.IO gateway with JWT authentication on connect
- [x] Redis adapter for horizontal scaling
- [x] Room naming + authorization:
  - `reservation:{id}` — both customer and pharmacist
  - `pharmacy:{id}:reservations` — pharmacist reservation feed
  - `customer:{id}:reservations` — customer reservation updates
  - `batch-upload:{jobId}` — upload progress
- [x] Emit on reservation status change
- [x] Emit batch upload progress updates
- [x] Guard: prevent unauthorized room joins

### Deliverables
- Live reservation status updates (customer + pharmacist)
- Real-time pharmacy reservation feed
- Batch upload progress streaming

### Implementation notes (as built)
- Client contract: **`docs/REALTIME.md`** (connect, rooms, acks, events, limits).
- `SocketGateway` authenticates in a handshake middleware (access JWT + active account), so unauthenticated
  sockets never open. Personal rooms auto-join; others via `subscribe` / `unsubscribe` with acks, checked by
  `SocketAuthService` (room names parsed strictly in `socket-rooms.ts`; unknown names rejected). Extra rooms
  beyond the spec: `branch:{id}:reservations`, `pharmacy:{id}:billing`, `admin:feed`.
- `RedisIoAdapter` (main.ts) shares rooms across instances; falls back to in-memory if Redis is down at boot.
- `RealtimeModule` maps domain events to rooms: reservation created / every status change / expiry, batch
  upload progress (now streamed about every 2 %, plus a failure event when the file cannot be read),
  subscription and ad-payment updates, support ticket replies, admin activity feed.
- Fixed along the way: `ALLOWED_ORIGINS` was never wired (CORS was always `*`); `main.ts` read a
  non-existent `app.nodeEnv`, so Swagger stayed on in production.
- Verified live on 2026-10-10: two app instances on a throwaway Postgres + Redis, real Socket.IO clients —
  handshake rejection, room authorization, cross-instance delivery via Redis, a reservation walked through
  confirm → ready → served over HTTP with single delivery per socket, live in-app notifications, rate limit
  (31 checks). Points, notifications and history rows were written correctly; no errors in either log.

---

## Phase 15 — Testing, Security & Deployment
**Status:** ✅ Complete
**Estimated Effort:** 5–7 days
**Depends on:** All phases

### Goals
Comprehensive test coverage, security hardening, production Docker setup, and deployment pipeline.

### Tasks

#### Testing
- [x] Unit tests for all service classes (jest)
- [x] E2E tests for critical flows:
  - Customer registration + login
  - Pharmacist registration + verification
  - Drug search + reservation flow
  - Subscription + payment flow
- [x] Integration tests for event bus listeners

#### Security
- [x] Helmet.js HTTP security headers
- [x] Rate limiting (Throttler) on all public endpoints
- [x] Request size limits (prevent payload attacks)
- [x] CORS configuration (whitelist frontend origins)
- [x] SQL injection prevention (Prisma parameterized queries — default)
- [x] JWT secret rotation strategy
- [x] Webhook signature verification (Paystack, Flutterwave)
- [x] Sensitive field scrubbing in logs

#### Deployment
- [x] Multi-stage Dockerfile (build → production)
- [x] `docker-compose.prod.yml`
- [x] Railway deployment configuration
- [x] Environment variable management (Railway secrets)
- [x] Database migration strategy for production
- [x] Health check endpoint `GET /health`
- [x] Liveness + readiness probes
- [x] PM2 or Railway process management
- [x] CI/CD pipeline (GitHub Actions):
  - Lint + test on PR
  - Deploy to staging on merge to `dev`
  - Deploy to production on merge to `main`

### Deliverables
- >70% test coverage on business logic
- Production-hardened Docker image
- CI/CD pipeline
- Railway deployment


### Implementation notes (as built)
- **Tests:** 66 unit tests (`src/**/*.spec.ts`) and 70 e2e tests in 9 suites (`test/e2e/`) that boot the real
  `AppModule` against throwaway Postgres + Redis containers (`npm run test:e2e:docker`). Outbound network is
  blocked in e2e; providers (Paystack, PCN registry, file URLs) are faked per test. Event listeners and Bull
  processors run for real inside the e2e app. Business-logic line coverage (unit + e2e merged): **78.3 %**,
  gated at 70 % in CI. See `docs/TESTING.md`.
- **Security** (`src/app.setup.ts`, `src/common/security/`): Helmet, body limit, CORS allow-list, Redis-backed
  rate limits keyed per user or IP with strict per-route limits on auth, OTP destroyed after 5 wrong guesses,
  password reset/change revokes all sessions, JWT current + previous secret rotation, log scrubbing, request ids.
  Runbooks in `docs/SECURITY.md`.
- **Deployment:** multi-stage non-root `Dockerfile` (tini, HEALTHCHECK), `docker-compose.prod.yml`,
  `railway.json` (migrate + seed as `preDeployCommand`, readiness healthcheck, restart on failure — Railway
  replaces PM2), liveness `/health/live` and readiness `/health/ready`. CI and deploy workflows are
  `.github/workflows/ci.yml` and `deploy.yml`. See `docs/DEPLOYMENT.md`.
- **Smoke-tested image:** built and run against blank Postgres + Redis — migrations, seed, readiness, content
  and container health all pass.
- **Bugs found and fixed by the test work:** pharmacies were never marked verified (new
  `PharmacyVerificationService`); geo drug search returned 500; bulk CSV ignored plan slot limits and turned a
  blank price into a free drug; `add-alternative` always 400'd; 8 PATCH routes never existed (stacked
  decorators); points credit could stall a transaction on a duplicate; Swagger was on in production; CORS
  allow-list was never wired; Resend crashed boot without a key; missing Google/Apple keys crashed boot (now
  503 on those routes only) and `APPLE_CALLBACK_URL` was ignored; `bcrypt`/`uuid` resolved only from a parent
  folder's `node_modules` (switched to the declared `bcryptjs` and Node's `randomUUID`).

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
