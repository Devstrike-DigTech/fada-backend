# FADA Backend — Event-Driven Architecture

All cross-module communication in FADA happens via domain events on the internal event bus.
No module imports another module's service directly.

---

## Event Naming Convention

```
{domain}.{entity}.{past_tense_verb}

Examples:
  auth.customer.registered
  inventory.drug.added
  reservation.picked_up
  subscription.plan.upgraded
```

---

## Complete Event Registry

### Auth Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `auth.customer.registered` | `{ userId, fadaId, email }` | AuthModule | PointsModule, NotificationsModule |
| `auth.pharmacist.registered` | `{ userId, fadaId, email, pharmacyId }` | AuthModule | PharmacyModule, PointsModule, NotificationsModule |
| `auth.email.verified` | `{ userId, email }` | AuthModule | — |
| `auth.guest.session.created` | `{ deviceId, guestToken }` | AuthModule | — |

### Pharmacy Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `pharmacy.branch.created` | `{ pharmacyId, branchId }` | PharmacyModule | — |
| `pharmacy.branch.deactivated` | `{ pharmacyId, branchId }` | PharmacyModule | InventoryModule |
| `pharmacy.profile.updated` | `{ pharmacyId }` | PharmacyModule | SearchModule |

### Inventory Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `inventory.drug.added` | `{ drugId, branchId, pharmacyId }` | InventoryModule | SearchModule, PointsModule, AnalyticsModule |
| `inventory.drug.updated` | `{ drugId, branchId }` | InventoryModule | SearchModule |
| `inventory.drug.deleted` | `{ drugId, branchId }` | InventoryModule | SearchModule, AdsModule |
| `inventory.stock.low` | `{ drugId, branchId, currentStock }` | InventoryModule | NotificationsModule |
| `inventory.stock.out` | `{ drugId, branchId }` | InventoryModule | ReservationModule, NotificationsModule, SearchModule |
| `inventory.batch.completed` | `{ jobId, branchId, added, errors }` | InventoryModule | NotificationsModule, SearchModule |

### Reservation Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `reservation.created` | `{ reservationId, customerId, branchId, items[] }` | ReservationModule | NotificationsModule, AnalyticsModule |
| `reservation.confirmed` | `{ reservationId, customerId, branchId }` | ReservationModule | InventoryModule, NotificationsModule, AnalyticsModule |
| `reservation.cancelled` | `{ reservationId, customerId, cancelledBy }` | ReservationModule | InventoryModule, NotificationsModule |
| `reservation.picked_up` | `{ reservationId, customerId, pharmacyId, servedBy }` | ReservationModule | PointsModule, NotificationsModule, AnalyticsModule |
| `reservation.expired` | `{ reservationId, customerId }` | ReservationModule (cron) | NotificationsModule, InventoryModule |

### Subscription Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `subscription.plan.activated` | `{ pharmacyId, planId, planName }` | SubscriptionModule | PharmacyModule, AdsModule, PointsModule, NotificationsModule |
| `subscription.plan.upgraded` | `{ pharmacyId, fromPlan, toPlan }` | SubscriptionModule | InventoryModule, PharmacyModule, AdsModule, NotificationsModule |
| `subscription.plan.downgraded` | `{ pharmacyId, fromPlan, toPlan }` | SubscriptionModule | InventoryModule, PharmacyModule, AdsModule, NotificationsModule |
| `subscription.plan.expired` | `{ pharmacyId, planId }` | SubscriptionModule | PharmacyModule, NotificationsModule |
| `subscription.payment.failed` | `{ pharmacyId, amount, provider }` | SubscriptionModule | NotificationsModule |

### Ads Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `ad.campaign.activated` | `{ campaignId, pharmacyId }` | AdsModule | PointsModule, NotificationsModule |
| `ad.campaign.expired` | `{ campaignId, pharmacyId }` | AdsModule | NotificationsModule |
| `ad.impression.recorded` | `{ campaignId, pharmacyId }` | AdsModule | AnalyticsModule |
| `ad.click.recorded` | `{ campaignId, pharmacyId, customerId? }` | AdsModule | AnalyticsModule |

### Points Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `points.earned` | `{ userId, delta, reason, newBalance }` | PointsModule | NotificationsModule |
| `points.level.upgraded` | `{ userId, fromLevel, toLevel }` | PointsModule | NotificationsModule |

### Search Events

| Event | Payload | Emitted By | Listened By |
|---|---|---|---|
| `search.query.recorded` | `{ userId?, query, type, resultsCount, radiusUsed }` | SearchModule | AnalyticsModule |

---

## Key Event Flows

### Flow 1: Customer Completes Reservation Pickup
```
Pharmacist scans QR / enters code
  → POST /reservations/verify
  → ReservationModule: status → served
  → Emits: reservation.picked_up

    → PointsModule:
        customer +10 points
        pharmacy +20 points
        Check if level threshold crossed
        If crossed → emit points.level.upgraded

    → NotificationsModule:
        Push to customer: "Pickup confirmed 🎉"
        In-app notification to both

    → AnalyticsModule:
        Increment pharmacy fulfilled_reservations count
        Update daily snapshot
```

### Flow 2: Drug Goes Out of Stock
```
PUT /inventory/:branchId/drugs/:drugId  (stock update to 0)
  → InventoryModule: stock_status → out_of_stock
  → Emits: inventory.stock.out

    → ReservationModule:
        Find all PENDING reservations for this drug
        Auto-cancel each one
        Emit: reservation.cancelled for each

    → NotificationsModule:
        Push to pharmacist: "⚠️ {Drug} is out of stock"
        Push to affected customers: "Your reservation was cancelled — drug unavailable"

    → SearchModule:
        Update drug availability indicator in search index
```

### Flow 3: Pharmacy Upgrades Subscription
```
POST /subscriptions/pharmacy/:id/upgrade
  → Paystack payment initiated
  → Customer completes payment on Paystack
  → Paystack fires webhook → POST /subscriptions/webhook/paystack
  → SubscriptionModule: verifies signature, updates PharmacySubscription
  → Emits: subscription.plan.upgraded

    → InventoryModule:
        Update slot limit enforcement for pharmacy

    → PharmacyModule:
        Unlock additional branch creation if new plan allows

    → AdsModule:
        Unlock ad creation if tier supports it
        Apply new ad discount percentage

    → NotificationsModule:
        Push to pharmacist: "Plan upgraded to {Plan} ✅"
        Email confirmation
```

### Flow 4: New Reservation Created
```
POST /reservations
  → ReservationModule:
        Generate alphanumeric code (RSVXXXXX)
        Generate QR code → upload to R2 → store URL
        Create Reservation + ReservationItems
        Set expires_at = now + 2 hours
  → Emits: reservation.created

    → NotificationsModule:
        Push to pharmacist: "New reservation from {Customer}"
        In-app notification added to pharmacy feed

    → AnalyticsModule:
        Increment pharmacy pending_reservations count
```

### Flow 5: Batch Drug Upload
```
POST /inventory/:branchId/drugs/batch-upload
  → File uploaded to Cloudflare R2
  → BatchUploadJob record created (status: queued)
  → BullMQ job dispatched

    → Worker:
        Pull file from R2
        Parse CSV/Excel rows
        Validate each row (NAFDAC format, required fields, slot limits)
        Insert valid rows
        Collect errors with row numbers
        Update BatchUploadJob to completed
        Emit: inventory.batch.completed

    → NotificationsModule:
        Push to pharmacist: "Upload complete: {added} added, {errors} errors"

    → SearchModule:
        Index all newly added drugs

    → WebSocket:
        Emit progress updates to pharmacist's upload room
```

### Flow 6: Reservation Auto-Expiry (Cron Job)
```
BullMQ cron runs every 15 minutes
  → Query: reservations WHERE status='pending' AND expires_at < NOW()
  → For each expired reservation:
      ReservationModule: status → expired
      Emit: reservation.expired

        → NotificationsModule:
            Push to customer: "Your reservation has expired"
            In-app notification

        → InventoryModule:
            Restore stock for each reservation item
            Recompute stock_status
```

### Flow 7: Search with Geo-Fence Expansion
```
GET /search/drugs?q=panadol&lat=6.5&lng=3.3
  → SearchModule:
      1. Try radius = 2km → 0 results
      2. Expand to 5km → 0 results
      3. Expand to 10km → 3 results ← return these
  → Guest check: if guest, increment Redis key, check daily limit
  → Log to CustomerSearchHistory
  → Emit: search.query.recorded

    → AnalyticsModule:
        Update search trend data
```

---

## Event Payload Types (TypeScript)

Located at: `src/common/types/events.types.ts`

```typescript
export interface AuthCustomerRegisteredPayload {
  userId: string;
  fadaId: string;
  email: string;
}

export interface InventoryDrugAddedPayload {
  drugId: string;
  branchId: string;
  pharmacyId: string;
}

export interface InventoryStockOutPayload {
  drugId: string;
  branchId: string;
  drugName: string;
}

export interface ReservationPickedUpPayload {
  reservationId: string;
  customerId: string;
  pharmacyId: string;
  servedBy: string;
}

export interface SubscriptionPlanUpgradedPayload {
  pharmacyId: string;
  fromPlan: string;
  toPlan: string;
  newSlotLimit: number;
  newBranchLimit: number;
}

// ... (all events follow same pattern)

export const EVENTS = {
  AUTH: {
    CUSTOMER_REGISTERED: 'auth.customer.registered',
    PHARMACIST_REGISTERED: 'auth.pharmacist.registered',
    EMAIL_VERIFIED: 'auth.email.verified',
    GUEST_SESSION_CREATED: 'auth.guest.session.created',
  },
  PHARMACY: {
    BRANCH_CREATED: 'pharmacy.branch.created',
    PROFILE_UPDATED: 'pharmacy.profile.updated',
  },
  INVENTORY: {
    DRUG_ADDED: 'inventory.drug.added',
    DRUG_UPDATED: 'inventory.drug.updated',
    DRUG_DELETED: 'inventory.drug.deleted',
    STOCK_LOW: 'inventory.stock.low',
    STOCK_OUT: 'inventory.stock.out',
    BATCH_COMPLETED: 'inventory.batch.completed',
  },
  RESERVATION: {
    CREATED: 'reservation.created',
    CONFIRMED: 'reservation.confirmed',
    CANCELLED: 'reservation.cancelled',
    PICKED_UP: 'reservation.picked_up',
    EXPIRED: 'reservation.expired',
  },
  SUBSCRIPTION: {
    PLAN_ACTIVATED: 'subscription.plan.activated',
    PLAN_UPGRADED: 'subscription.plan.upgraded',
    PLAN_DOWNGRADED: 'subscription.plan.downgraded',
    PLAN_EXPIRED: 'subscription.plan.expired',
    PAYMENT_FAILED: 'subscription.payment.failed',
  },
  ADS: {
    CAMPAIGN_ACTIVATED: 'ad.campaign.activated',
    CAMPAIGN_EXPIRED: 'ad.campaign.expired',
    IMPRESSION_RECORDED: 'ad.impression.recorded',
    CLICK_RECORDED: 'ad.click.recorded',
  },
  POINTS: {
    EARNED: 'points.earned',
    LEVEL_UPGRADED: 'points.level.upgraded',
  },
  SEARCH: {
    QUERY_RECORDED: 'search.query.recorded',
  },
} as const;
```
