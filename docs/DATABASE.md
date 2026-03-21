# FADA Backend — Database Design

---

## Database: PostgreSQL + PostGIS

Single PostgreSQL instance with the PostGIS extension enabled for geo-spatial queries.

---

## Core Entities & Relationships

```
User (1) ──────────────── (1) CustomerProfile
User (1) ──────────────── (1) PharmacistProfile
User (1) ──────────────── (N) DeviceToken
User (1) ──────────────── (N) RefreshToken
User (1) ──────────────── (N) CustomerAddress
User (1) ──────────────── (1) PointsLedger

PharmacistProfile (N) ──── (1) Pharmacy
Pharmacy (1) ──────────── (N) Branch
Pharmacy (1) ──────────── (1) PharmacySubscription
Pharmacy (1) ──────────── (N) PharmacyImage
Pharmacy (1) ──────────── (N) AdCampaign
Branch (1) ─────────────── (N) PharmacyWorkingHours
Branch (1) ─────────────── (N) Drug
Branch (1) ─────────────── (N) Reservation

Drug (N) ──────────────── (N) DrugCategory  [junction: DrugCategoryMap]
Drug (1) ──────────────── (N) DrugImage
Drug (1) ──────────────── (N) DrugIndication
Drug (1) ──────────────── (N) DrugContraindication
Drug (N) ──────────────── (N) AilmentTag     [junction: DrugAilmentTag]
Drug (N) ──────────────── (N) Drug           [self: DrugAlternative]
Drug (1) ──────────────── (N) AdCampaign

Reservation (1) ────────── (N) ReservationItem
Reservation (1) ────────── (N) ReservationStatusHistory
ReservationItem (N) ─────── (1) Drug

CustomerDrugList (1) ────── (N) CustomerDrugListItem
CustomerDrugListItem (N) ── (1) Drug

SubscriptionPlan (1) ────── (N) PharmacySubscription
PharmacySubscription (1) ── (N) BillingRecord

PointsLedger (1) ────────── (N) PointsTransaction

NotificationRecord (N) ──── (1) User
SupportTicket (N) ────────── (1) User
```

---

## Entity Definitions

### User
```
id              UUID, PK
fada_id         VARCHAR UNIQUE  (CUSXXXXXXX or PHMXXXXXXX)
email           VARCHAR UNIQUE
password_hash   VARCHAR nullable (null for OAuth-only users)
phone           VARCHAR nullable
phone_verified  BOOLEAN default false
role            ENUM: customer | pharmacist | admin
oauth_provider  ENUM: google | apple | null
oauth_id        VARCHAR nullable
is_active       BOOLEAN default true
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### CustomerProfile
```
id              UUID, PK
user_id         UUID FK → User
full_name       VARCHAR
date_of_birth   DATE nullable
gender          ENUM: male | female | other | prefer_not_to_say nullable
avatar_url      VARCHAR nullable
```

### CustomerAddress
```
id              UUID, PK
customer_id     UUID FK → User
label           VARCHAR nullable  (e.g. "Home", "Work")
address_line    VARCHAR
city            VARCHAR nullable
state           VARCHAR nullable
country         VARCHAR default 'Nigeria'
location        GEOGRAPHY(POINT) nullable  (PostGIS)
is_default      BOOLEAN default false
created_at      TIMESTAMP
```

### PharmacistProfile
```
id              UUID, PK
user_id         UUID FK → User
first_name      VARCHAR
last_name       VARCHAR
license_type    VARCHAR  (from PCN license types)
license_number  VARCHAR
pcn_verified    BOOLEAN default false
pcn_verified_at TIMESTAMP nullable
pharmacy_id     UUID FK → Pharmacy nullable  (set after pharmacy created)
role_in_pharmacy ENUM: owner | operator | staff
```

### Pharmacy
```
id              UUID, PK
fada_id         VARCHAR UNIQUE  (PHMXXXXXXX)
owner_id        UUID FK → User
name            VARCHAR
email           VARCHAR nullable
phone           VARCHAR nullable
description     TEXT nullable
cac_number      VARCHAR nullable
cac_verified    BOOLEAN default false
cac_verified_at TIMESTAMP nullable
country         VARCHAR default 'Nigeria'
state           VARCHAR nullable
city            VARCHAR nullable
address         VARCHAR nullable
landmark        VARCHAR nullable
location        GEOGRAPHY(POINT) nullable  (PostGIS)
founded_year    INT nullable  (for "X years active" calculation)
is_verified     BOOLEAN default false
is_active       BOOLEAN default true
reputation_level INT default 1  (LVL system)
reputation_points INT default 0
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### Branch
```
id              UUID, PK
pharmacy_id     UUID FK → Pharmacy
name            VARCHAR
address         VARCHAR nullable
landmark        VARCHAR nullable
location        GEOGRAPHY(POINT) nullable
is_head_branch  BOOLEAN default false
is_active       BOOLEAN default true
created_at      TIMESTAMP
```

### PharmacyWorkingHours
```
id              UUID, PK
branch_id       UUID FK → Branch
day_of_week     ENUM: sunday | monday | tuesday | wednesday | thursday | friday | saturday
open_time       TIME nullable
close_time      TIME nullable
is_closed       BOOLEAN default false
```

### PharmacyImage
```
id              UUID, PK
pharmacy_id     UUID FK → Pharmacy
url             VARCHAR
cloudinary_id   VARCHAR nullable
is_primary      BOOLEAN default false
created_at      TIMESTAMP
```

### DrugCategory
```
id              UUID, PK
name            VARCHAR UNIQUE  (Oral Drugs | Infusion Drugs | Injectable Drugs | Antiseptics | Others)
slug            VARCHAR UNIQUE
icon_url        VARCHAR nullable
description     TEXT nullable
sort_order      INT default 0
```

### Drug
```
id              UUID, PK
branch_id       UUID FK → Branch
nafdac_number   VARCHAR nullable
nafdac_verified BOOLEAN default false
name            VARCHAR
generic_name    VARCHAR nullable
alias_name      VARCHAR nullable  (e.g. "Coartem" for Artemether)
manufacturer    VARCHAR nullable
composition     TEXT nullable
drug_type       ENUM: oral | infusion | injectable | antiseptic | other
package_type    VARCHAR nullable  (e.g. "Bottle", "Pack", "Card", "Carton")
adult_dosage    VARCHAR nullable
children_dosage VARCHAR nullable
price           DECIMAL(12,2)
currency        VARCHAR default 'NGN'
stock_amount    INT default 0
stock_status    ENUM: in_stock | low_stock | out_of_stock  (computed)
low_stock_threshold INT default 5
is_prescription BOOLEAN default false
expiry_date     DATE nullable
search_vector   TSVECTOR  (generated, GIN indexed)
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### DrugCategoryMap (junction)
```
drug_id         UUID FK → Drug
category_id     UUID FK → DrugCategory
PRIMARY KEY (drug_id, category_id)
```

### DrugIndication
```
id              UUID, PK
drug_id         UUID FK → Drug
indication      VARCHAR  (e.g. "Headache", "Fever", "Malaria")
```

### DrugContraindication
```
id              UUID, PK
drug_id         UUID FK → Drug
contraindication VARCHAR  (e.g. "Hypertension", "Pregnancy")
```

### AilmentTag
```
id              UUID, PK
name            VARCHAR UNIQUE
slug            VARCHAR UNIQUE
description     TEXT nullable
```

### DrugAilmentTag (junction)
```
drug_id         UUID FK → Drug
ailment_tag_id  UUID FK → AilmentTag
PRIMARY KEY (drug_id, ailment_tag_id)
```

### DrugAlternative (self-referencing)
```
drug_id             UUID FK → Drug
alternative_drug_id UUID FK → Drug
PRIMARY KEY (drug_id, alternative_drug_id)
```

### DrugImage
```
id              UUID, PK
drug_id         UUID FK → Drug
url             VARCHAR
cloudinary_id   VARCHAR nullable
is_primary      BOOLEAN default false
sort_order      INT default 0
```

### Reservation
```
id              UUID, PK
customer_id     UUID FK → User
branch_id       UUID FK → Branch
qr_code_url     VARCHAR nullable
alphanumeric_code VARCHAR UNIQUE  (RSVXXXXX format)
status          ENUM: pending | confirmed | served | cancelled | expired
notes           TEXT nullable
total_amount    DECIMAL(12,2) nullable
expires_at      TIMESTAMP
served_by       UUID FK → User nullable  (pharmacist who served)
served_at       TIMESTAMP nullable
cancelled_by    UUID FK → User nullable
cancelled_at    TIMESTAMP nullable
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### ReservationItem
```
id              UUID, PK
reservation_id  UUID FK → Reservation
drug_id         UUID FK → Drug
quantity        INT default 1
unit_price      DECIMAL(12,2)  (price at time of reservation)
subtotal        DECIMAL(12,2)
status          ENUM: available | unavailable
```

### ReservationStatusHistory
```
id              UUID, PK
reservation_id  UUID FK → Reservation
from_status     VARCHAR
to_status       VARCHAR
changed_by      UUID FK → User nullable
note            TEXT nullable
changed_at      TIMESTAMP
```

### SubscriptionPlan
```
id              UUID, PK
name            VARCHAR  (Sokka | Toph | Katara | Zuko | Aang)
slug            VARCHAR UNIQUE
color           VARCHAR nullable  (brand color per plan)
monthly_price   DECIMAL(10,2)
quarterly_price DECIMAL(10,2) nullable
annual_price    DECIMAL(10,2) nullable
inventory_slot_limit   INT
branch_limit    INT default 1
has_analytics   BOOLEAN default false
has_ads         BOOLEAN default false
ad_discount_pct INT default 0
sort_order      INT default 0
is_active       BOOLEAN default true
```

### PharmacySubscription
```
id              UUID, PK
pharmacy_id     UUID FK → Pharmacy
plan_id         UUID FK → SubscriptionPlan
billing_interval ENUM: monthly | quarterly | annually
status          ENUM: active | past_due | cancelled | trialing | expired
paystack_subscription_code VARCHAR nullable
paystack_customer_code     VARCHAR nullable
flutterwave_plan_id        VARCHAR nullable
current_period_start TIMESTAMP
current_period_end   TIMESTAMP
cancelled_at         TIMESTAMP nullable
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### BillingRecord
```
id              UUID, PK
subscription_id UUID FK → PharmacySubscription
amount          DECIMAL(10,2)
currency        VARCHAR default 'NGN'
payment_provider ENUM: paystack | flutterwave
provider_reference VARCHAR nullable
status          ENUM: paid | failed | pending | refunded
paid_at         TIMESTAMP nullable
created_at      TIMESTAMP
```

### AdCampaign
```
id              UUID, PK
pharmacy_id     UUID FK → Pharmacy
drug_id         UUID FK → Drug nullable
title           VARCHAR
description     TEXT nullable
creative_url    VARCHAR nullable
target_radius_km INT default 10
target_state    VARCHAR nullable
timeslot_start  TIMESTAMP
timeslot_end    TIMESTAMP
budget_ngn      DECIMAL(10,2) nullable
status          ENUM: draft | active | paused | expired | cancelled
impressions_count INT default 0
clicks_count    INT default 0
rating          DECIMAL(3,2) nullable  (average star rating)
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### PointsLedger
```
id              UUID, PK
user_id         UUID FK → User
balance         INT default 0
lifetime_earned INT default 0
updated_at      TIMESTAMP
```

### PointsTransaction
```
id              UUID, PK
ledger_id       UUID FK → PointsLedger
delta           INT  (positive = earned, negative = redeemed)
reason          ENUM: registration | reservation_completed | drug_added | ad_launched | profile_completed | other
reference_id    UUID nullable  (polymorphic: reservation ID, drug ID, etc.)
note            VARCHAR nullable
created_at      TIMESTAMP
```

### NotificationRecord
```
id              UUID, PK
recipient_id    UUID FK → User
title           VARCHAR
body            TEXT
type            ENUM: push | in_app | sms | email
channel_payload JSONB nullable  (raw push payload / email data)
is_read         BOOLEAN default false
read_at         TIMESTAMP nullable
created_at      TIMESTAMP
```

### DeviceToken
```
id              UUID, PK
user_id         UUID FK → User
token           VARCHAR UNIQUE  (FCM token)
platform        ENUM: ios | android
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### CustomerSavedDrug
```
customer_id     UUID FK → User
drug_id         UUID FK → Drug
created_at      TIMESTAMP
PRIMARY KEY (customer_id, drug_id)
```

### CustomerSavedPharmacy
```
customer_id     UUID FK → User
pharmacy_id     UUID FK → Pharmacy
created_at      TIMESTAMP
PRIMARY KEY (customer_id, pharmacy_id)
```

### CustomerDrugList
```
id              UUID, PK
customer_id     UUID FK → User
name            VARCHAR  (e.g. "Daddy's Drug")
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### CustomerDrugListItem
```
id              UUID, PK
list_id         UUID FK → CustomerDrugList
drug_id         UUID FK → Drug
quantity        INT default 1
added_at        TIMESTAMP
```

### CustomerSearchHistory
```
id              UUID, PK
customer_id     UUID FK → User nullable  (null for guests)
device_id       VARCHAR nullable
query           VARCHAR
search_type     ENUM: drug | ailment | pharmacy
results_count   INT default 0
radius_used_km  INT nullable
created_at      TIMESTAMP
```

### SupportTicket
```
id              UUID, PK
submitter_id    UUID FK → User nullable
complaint_type  VARCHAR
description     TEXT
status          ENUM: pending | in_review | resolved | closed
resolved_at     TIMESTAMP nullable
created_at      TIMESTAMP
updated_at      TIMESTAMP
```

### FeatureSuggestion
```
id              UUID, PK
submitter_id    UUID FK → User nullable
title           VARCHAR
description     TEXT
status          ENUM: submitted | reviewing | planned | shipped | declined
created_at      TIMESTAMP
```

### FeatureFlag
```
id              UUID, PK
key             VARCHAR UNIQUE  (e.g. 'purchase.enabled')
is_enabled      BOOLEAN default false
description     TEXT nullable
updated_at      TIMESTAMP
```

### AppContent (CMS)
```
id              UUID, PK
key             VARCHAR UNIQUE  (app_info | disclaimer | terms | privacy | credits | future_features)
title           VARCHAR
content         TEXT  (rich text / markdown)
updated_at      TIMESTAMP
```

### GoodCauseProject
```
id              UUID, PK
title           VARCHAR
description     TEXT
image_url       VARCHAR nullable
is_active       BOOLEAN default true
sort_order      INT default 0
created_at      TIMESTAMP
```

### GoodCauseTestimonial
```
id              UUID, PK
author_name     VARCHAR
author_avatar   VARCHAR nullable
content         TEXT
is_active       BOOLEAN default true
created_at      TIMESTAMP
```

---

## Indexes

```sql
-- Full-text search on drugs
CREATE INDEX idx_drug_search_vector ON drugs USING GIN(search_vector);

-- Geo-spatial index on branch locations
CREATE INDEX idx_branch_location ON branches USING GIST(location);

-- Geo-spatial index on customer addresses
CREATE INDEX idx_customer_address_location ON customer_addresses USING GIST(location);

-- Geo-spatial index on pharmacy locations
CREATE INDEX idx_pharmacy_location ON pharmacies USING GIST(location);

-- Common query patterns
CREATE INDEX idx_drug_branch_id ON drugs(branch_id);
CREATE INDEX idx_drug_stock_status ON drugs(stock_status);
CREATE INDEX idx_reservation_customer ON reservations(customer_id);
CREATE INDEX idx_reservation_branch ON reservations(branch_id);
CREATE INDEX idx_reservation_status ON reservations(status);
CREATE INDEX idx_reservation_code ON reservations(alphanumeric_code);
CREATE INDEX idx_reservation_expires ON reservations(expires_at) WHERE status = 'pending';
CREATE INDEX idx_pharmacy_sub ON pharmacy_subscriptions(pharmacy_id, status);
CREATE INDEX idx_ad_campaign_status ON ad_campaigns(status, timeslot_end);
CREATE INDEX idx_notification_recipient ON notification_records(recipient_id, is_read);
CREATE INDEX idx_search_history_customer ON customer_search_history(customer_id, created_at);
```

---

## PostGIS Setup

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pg_trgm for fuzzy text search (optional for v2)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drug search vector (generated column)
ALTER TABLE drugs ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(name, '') || ' ' ||
      coalesce(generic_name, '') || ' ' ||
      coalesce(alias_name, '') || ' ' ||
      coalesce(manufacturer, '') || ' ' ||
      coalesce(composition, '')
    )
  ) STORED;
```

---

## Naming Conventions

| Concept | Convention | Example |
|---|---|---|
| Table names | snake_case, plural | `drug_categories` |
| Column names | snake_case | `created_at` |
| Foreign keys | `{entity}_id` | `branch_id` |
| Junction tables | `{entity_a}_{entity_b}` | `drug_category_map` |
| Enum values | lowercase, underscore | `out_of_stock` |
| UUIDs | v4, generated by app | `gen_random_uuid()` |
