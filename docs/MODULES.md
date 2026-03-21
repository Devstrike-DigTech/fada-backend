# FADA Backend — Module Reference

Each module is a NestJS bounded context. This document serves as the single reference for what each module owns, exposes, and communicates.

---

## Module Overview

| # | Module | Serves | Phase |
|---|---|---|---|
| 1 | AuthModule | Both apps | Phase 2 |
| 2 | PharmacyModule | Pharmacy app | Phase 3 |
| 3 | InventoryModule | Pharmacy app | Phase 4 |
| 4 | SearchModule | Customer app | Phase 5 |
| 5 | ReservationModule | Both apps | Phase 6 |
| 6 | SubscriptionModule | Pharmacy app | Phase 7 |
| 7 | AdsModule | Both apps | Phase 8 |
| 8 | CustomerProfileModule | Customer app | Phase 9 |
| 9 | SavesModule | Customer app | Phase 9 |
| 10 | PointsModule | Both apps | Phase 10 |
| 11 | NotificationsModule | Both apps | Phase 11 |
| 12 | SupportModule | Both apps | Phase 12 |
| 13 | ContentModule | Both apps | Phase 12 |
| 14 | AnalyticsModule | Pharmacy app | Phase 13 |
| 15 | FeatureFlagModule | Platform | Phase 1 |

---

## 1. AuthModule
**Path:** `src/modules/auth/`

**Owns:** User records, JWT lifecycle, OAuth tokens, OTP codes, guest sessions, refresh tokens

**Internal Structure:**
```
auth/
├── auth.module.ts
├── auth.controller.ts      (registration + login endpoints)
├── auth.service.ts         (business logic)
├── otp.service.ts          (OTP generation, verification, TTL)
├── fada-id.service.ts      (FADA ID generation: CUS/PHM prefix)
├── guest.service.ts        (guest token + Redis rate limits)
├── strategies/
│   ├── jwt.strategy.ts
│   ├── google.strategy.ts
│   └── apple.strategy.ts
└── dto/
    ├── register-customer.dto.ts
    ├── register-pharmacist.dto.ts
    ├── login.dto.ts
    └── reset-password.dto.ts
```

**Key Endpoints:**
- `POST /auth/register/customer`
- `POST /auth/register/pharmacist`
- `POST /auth/verify/email`
- `POST /auth/login`
- `GET  /auth/login/google`
- `POST /auth/login/apple`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET  /auth/guest/token`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`

---

## 2. PharmacyModule
**Path:** `src/modules/pharmacy/`

**Owns:** Pharmacy profiles, branches, working hours, pharmacy images, verification status, reputation level

**Internal Structure:**
```
pharmacy/
├── pharmacy.module.ts
├── pharmacy.controller.ts
├── pharmacy.service.ts
├── branch.service.ts
├── working-hours.service.ts
├── verification.service.ts    (PCN + CAC verification jobs)
├── reputation.service.ts      (LVL computation)
├── listeners/
│   └── pharmacy.listeners.ts  (auth.pharmacist.registered → create pharmacy)
└── dto/
```

**Key Endpoints:**
- `GET  /pharmacies/:id`
- `PUT  /pharmacies/:id/profile`
- `POST /pharmacies/:id/images`
- `GET  /pharmacies/:id/branches`
- `POST /pharmacies/:id/branches`
- `PUT  /pharmacies/:id/branches/:branchId`
- `GET  /pharmacies/:id/branches/:branchId/working-hours`
- `PUT  /pharmacies/:id/branches/:branchId/working-hours`

---

## 3. InventoryModule
**Path:** `src/modules/inventory/`

**Owns:** Drug records, drug categories, NAFDAC cache, drug images, batch upload jobs, drug alternatives, stock level management

**Internal Structure:**
```
inventory/
├── inventory.module.ts
├── inventory.controller.ts
├── inventory.service.ts
├── nafdac.service.ts          (NAFDAC number lookup + cache)
├── stock.service.ts           (stock computation, threshold checks)
├── batch-upload/
│   ├── batch-upload.service.ts
│   ├── batch-upload.processor.ts  (BullMQ worker)
│   ├── parsers/
│   │   ├── csv.parser.ts
│   │   └── excel.parser.ts
│   └── validators/
│       └── drug-row.validator.ts
├── listeners/
│   └── inventory.listeners.ts
└── dto/
    ├── create-drug.dto.ts
    ├── update-drug.dto.ts
    └── batch-upload.dto.ts
```

**Key Endpoints:**
- `GET  /inventory/categories`
- `GET  /inventory/nafdac/:number`
- `GET  /inventory/:branchId/drugs`
- `POST /inventory/:branchId/drugs`
- `GET  /inventory/:branchId/drugs/:drugId`
- `PUT  /inventory/:branchId/drugs/:drugId`
- `DELETE /inventory/:branchId/drugs/:drugId`
- `POST /inventory/:branchId/drugs/:drugId/images`
- `POST /inventory/:branchId/drugs/batch-upload`
- `GET  /inventory/:branchId/drugs/batch-upload/:jobId`
- `GET  /inventory/batch-upload/template` (download CSV template)
- `POST /inventory/:branchId/drugs/:drugId/alternatives`

---

## 4. SearchModule
**Path:** `src/modules/search/`

**Owns:** Search logic, ailment-to-drug mappings, geo-query execution, search history recording

**Note:** This module reads from Inventory and Pharmacy tables but does not own them. It is a read-model module.

**Internal Structure:**
```
search/
├── search.module.ts
├── search.controller.ts
├── search.service.ts          (orchestrates search types)
├── drug-search.service.ts     (FTS + PostGIS combined)
├── ailment-search.service.ts
├── pharmacy-search.service.ts
├── geo.service.ts             (radius expansion logic)
├── guest-rate-limit.middleware.ts
├── listeners/
│   └── search.listeners.ts   (index sync on drug changes)
└── dto/
    └── search-query.dto.ts
```

**Key Endpoints:**
- `GET /search/drugs`
- `GET /search/ailments`
- `GET /search/pharmacies`
- `GET /search/pharmacies/:id/drugs` (search within pharmacy)
- `GET /search/drugs/:drugId`
- `GET /search/drugs/:drugId/availability`

**Geo-Fence Radius Tiers:** 2km → 5km → 10km → 20km → 50km

---

## 5. ReservationModule
**Path:** `src/modules/reservation/`

**Owns:** Reservation lifecycle, QR code generation, alphanumeric codes, verification flow, expiry jobs

**Internal Structure:**
```
reservation/
├── reservation.module.ts
├── reservation.controller.ts
├── reservation.service.ts
├── code.service.ts            (QR + alphanumeric RSVXXXXX generation)
├── verification.service.ts    (pharmacist verify endpoint)
├── expiry.processor.ts        (BullMQ cron: check + expire)
├── listeners/
│   └── reservation.listeners.ts  (inventory.stock.out → auto-cancel)
└── dto/
    ├── create-reservation.dto.ts
    └── create-list-reservation.dto.ts
```

**Key Endpoints:**
- `POST /reservations`
- `POST /reservations/from-list`
- `GET  /reservations/:id`
- `GET  /reservations/customer/:customerId`
- `GET  /reservations/pharmacy/:pharmacyId`
- `POST /reservations/verify`
- `PUT  /reservations/:id/serve`
- `PUT  /reservations/:id/cancel`

---

## 6. SubscriptionModule
**Path:** `src/modules/subscription/`

**Owns:** Subscription plans, pharmacy subscriptions, billing records, payment webhook handling

**Internal Structure:**
```
subscription/
├── subscription.module.ts
├── subscription.controller.ts
├── subscription.service.ts
├── webhook.controller.ts      (Paystack + Flutterwave webhooks)
├── paystack-webhook.handler.ts
├── flutterwave-webhook.handler.ts
├── plan-seeder.ts             (seeds Sokka→Aang plans on startup)
└── dto/
```

**Key Endpoints:**
- `GET  /subscriptions/plans`
- `GET  /subscriptions/pharmacy/:pharmacyId`
- `POST /subscriptions/pharmacy/:pharmacyId/subscribe`
- `POST /subscriptions/pharmacy/:pharmacyId/upgrade`
- `POST /subscriptions/pharmacy/:pharmacyId/cancel`
- `GET  /subscriptions/pharmacy/:pharmacyId/billing-history`
- `POST /subscriptions/webhook/paystack`
- `POST /subscriptions/webhook/flutterwave`

---

## 7. AdsModule
**Path:** `src/modules/ads/`

**Owns:** Ad campaigns, timeslots, impression/click tracking, ad analytics, ad feed for customers

**Internal Structure:**
```
ads/
├── ads.module.ts
├── ads.controller.ts
├── analytics.controller.ts
├── ads.service.ts
├── ad-feed.service.ts         (geo-targeted customer ad serving)
├── impression.service.ts      (impression + click recording)
├── listeners/
│   └── ads.listeners.ts
└── dto/
```

**Key Endpoints:**
- `GET  /ads/feed`
- `GET  /ads/:id`
- `POST /ads/impressions`
- `POST /ads/clicks`
- `GET  /ads/pharmacy/:pharmacyId/campaigns`
- `POST /ads/pharmacy/:pharmacyId/campaigns`
- `PUT  /ads/pharmacy/:pharmacyId/campaigns/:id`
- `DELETE /ads/pharmacy/:pharmacyId/campaigns/:id`
- `GET  /ads/pharmacy/:pharmacyId/campaigns/:id/analytics`

---

## 8. CustomerProfileModule
**Path:** `src/modules/customer-profile/`

**Owns:** Customer profile data, address management, profile completion tracking

**Key Endpoints:**
- `GET  /customer/profile`
- `PUT  /customer/profile`
- `GET  /customer/addresses`
- `POST /customer/addresses`
- `PUT  /customer/addresses/:id`
- `DELETE /customer/addresses/:id`

---

## 9. SavesModule
**Path:** `src/modules/saves/`

**Owns:** Saved drugs, saved pharmacies, named drug lists, list items

**Key Endpoints:**
- `GET  /saves/drugs`
- `POST /saves/drugs/:drugId`
- `DELETE /saves/drugs/:drugId`
- `GET  /saves/pharmacies`
- `POST /saves/pharmacies/:pharmacyId`
- `DELETE /saves/pharmacies/:pharmacyId`
- `GET  /saves/lists`
- `POST /saves/lists`
- `GET  /saves/lists/:id`
- `PUT  /saves/lists/:id`
- `DELETE /saves/lists/:id`
- `POST /saves/lists/:id/drugs`
- `DELETE /saves/lists/:id/drugs/:drugId`

---

## 10. PointsModule
**Path:** `src/modules/points/`

**Owns:** Points ledger, transactions, level thresholds, LVL computation

**Internal Structure:**
```
points/
├── points.module.ts
├── points.controller.ts
├── points.service.ts
├── level.service.ts
├── listeners/
│   └── points.listeners.ts   (handles all earning events)
└── dto/
```

**Key Endpoints:**
- `GET /points/customer/:customerId`
- `GET /points/customer/:customerId/history`
- `GET /points/pharmacy/:pharmacyId`
- `GET /points/pharmacy/:pharmacyId/history`
- `GET /points/levels`

---

## 11. NotificationsModule
**Path:** `src/modules/notifications/`

**Owns:** Notification records, device tokens, preferences, dispatch queue

**Internal Structure:**
```
notifications/
├── notifications.module.ts
├── notifications.controller.ts
├── notifications.service.ts
├── notifications.processor.ts    (BullMQ worker)
├── providers/
│   ├── fcm.provider.ts
│   ├── termii.provider.ts
│   └── resend.provider.ts
├── templates/                    (notification message templates)
│   ├── reservation.templates.ts
│   ├── inventory.templates.ts
│   └── subscription.templates.ts
├── listeners/
│   └── notifications.listeners.ts
└── dto/
```

**Key Endpoints:**
- `POST /notifications/device-tokens`
- `DELETE /notifications/device-tokens/:token`
- `GET  /notifications/history`
- `PUT  /notifications/:id/read`
- `PUT  /notifications/read-all`
- `PUT  /notifications/preferences`

---

## 12. SupportModule
**Path:** `src/modules/support/`

**Owns:** Support tickets, feature suggestions

**Key Endpoints:**
- `POST /support/complaints`
- `GET  /support/complaints`
- `POST /support/suggestions`
- `GET  /support/contact`

---

## 13. ContentModule
**Path:** `src/modules/content/`

**Owns:** Static app content, Good Cause projects and testimonials

**Key Endpoints:**
- `GET /content/app-info`
- `GET /content/disclaimer`
- `GET /content/terms-of-service`
- `GET /content/privacy-policy`
- `GET /content/credits`
- `GET /content/future-features`
- `GET /content/good-cause/projects`
- `GET /content/good-cause/testimonials`

---

## 14. AnalyticsModule
**Path:** `src/modules/analytics/`

**Owns:** Aggregated pharmacy metrics, search trends, ad performance snapshots

**Note:** Subscription-gated. Only pharmacies on eligible plans can access analytics endpoints.

**Key Endpoints:**
- `GET /analytics/pharmacy/:id/overview`
- `GET /analytics/pharmacy/:id/reservations`
- `GET /analytics/pharmacy/:id/inventory`
- `GET /analytics/pharmacy/:id/search-appearances`
- `GET /analytics/pharmacy/:id/ads`

---

## 15. FeatureFlagModule
**Path:** `src/modules/feature-flags/`

**Owns:** Feature flag registry (Redis-backed for fast reads)

**Usage:**
```typescript
// In any service
constructor(private readonly featureFlags: FeatureFlagService) {}

async someMethod() {
  if (await this.featureFlags.isEnabled('purchase.enabled')) {
    // activate purchase flow
  }
}
```

**Known Flags:**
| Flag | Default | Description |
|---|---|---|
| `purchase.enabled` | false | Activate buy/checkout flow |
| `ai_suggestions.enabled` | false | AI drug recommendations |
| `edu_content.enabled` | false | Pharmaceutical education cards |
| `smart_list.enabled` | false | AI-powered shopping lists |
| `delivery.enabled` | false | Delivery fulfillment channel |
| `typesense.enabled` | false | Switch FTS to Typesense |
