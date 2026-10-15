# FADA Backend — API Reference Overview

All endpoints follow the base URL: `https://api.thefadaapp.com/v1`
Development: `http://localhost:3000`
Swagger docs: `{base_url}/api/docs`

---

## Standard Response Envelope

### Success
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully",
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150
  }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "RESERVATION_EXPIRED",
    "message": "This reservation has already expired",
    "details": []
  },
  "statusCode": 400
}
```

---

## Authentication

All protected endpoints require:
```
Authorization: Bearer {access_token}
```

Guest endpoints require:
```
Authorization: Bearer {guest_token}
X-Device-ID: {device_fingerprint}
```

---

## Endpoints by Module

### Auth (`/auth`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register/customer` | Public | Register customer (multi-step) |
| POST | `/auth/register/pharmacist` | Public | Register pharmacist (multi-step) |
| POST | `/auth/verify-email` | Public | Verify email OTP (returns user + tokens) |
| POST | `/auth/resend-otp` | Public | Resend the email verification code |
| POST | `/auth/login` | Public | Login with email/FADA ID + password |
| GET | `/auth/login/google` | Public | Google OAuth redirect |
| POST | `/auth/login/apple` | Public | Apple Sign-In |
| POST | `/auth/refresh` | Refresh Token | Rotate access + refresh tokens |
| POST | `/auth/logout` | JWT | Revoke refresh token |
| GET | `/auth/guest/token` | Public | Get anonymous guest JWT |
| POST | `/auth/password/forgot` | Public | Request password reset OTP |
| POST | `/auth/password/verify-otp` | Public | Verify reset OTP |
| POST | `/auth/password/reset` | Public | Set new password |

### Pharmacy (`/pharmacy`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/pharmacy` | Pharmacist | Register the pharmacist's pharmacy (creates the head branch) |
| GET | `/pharmacy/me` | Pharmacist | The logged-in pharmacist's pharmacy |
| GET | `/pharmacy/me/verification` | Pharmacist | Verification status: PCN licence and CAC registration, with what is missing |
| GET | `/pharmacy/:id` | Public | Public pharmacy profile |
| PUT | `/pharmacies/:id/profile` | Pharmacist | Update profile |
| POST | `/pharmacies/:id/images` | Pharmacist | Upload pharmacy photos |
| GET | `/pharmacies/:id/branches` | Public | List branches |
| POST | `/pharmacies/:id/branches` | Pharmacist | Create branch |
| PUT | `/pharmacies/:id/branches/:branchId` | Pharmacist | Update branch |
| GET | `/pharmacies/:id/branches/:branchId/working-hours` | Public | Get working hours |
| PUT | `/pharmacies/:id/branches/:branchId/working-hours` | Pharmacist | Set working hours |

### Inventory (`/inventory`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/inventory/categories` | Public | Primary (therapeutic) and secondary (form) categories |
| GET | `/inventory/nafdac?nafdacNumber=` or `?name=` | Pharmacist | NAFDAC lookup by number, or name suggestions |
| GET | `/inventory/branch/:branchId` | Pharmacist/Staff | Paginated drugs. Filters: `search`, `drugType`, `stockStatus`, `prescriptionType`, `categoryId`, `includeExpired`. Sort: `sortBy` = name, updatedAt, stockAmount or price, with `sortOrder` |
| GET | `/inventory/branch/:branchId/summary` | Pharmacist/Staff | Counts by stock status, `byType` counts for all five drug types, expiring soon, and `lastUpdated` drug |
| GET | `/inventory/branch/:branchId/public` | Public | Customer-facing list |
| POST | `/inventory/branch/:branchId/drugs` | Pharmacist/Staff | Add a drug (NAFDAC enrichment when a number is given) |
| GET | `/inventory/drugs/:drugId` | Pharmacist/Staff | Drug detail with indications, contraindications, images, alternatives |
| PATCH | `/inventory/drugs/:drugId` | Pharmacist/Staff | Update a drug |
| PATCH | `/inventory/drugs/:drugId/stock` | Pharmacist/Staff | Set, add or subtract stock, with a reason |
| DELETE | `/inventory/drugs/:drugId` | Pharmacist/Staff | Delete a drug |
| POST/DELETE | `/inventory/drugs/:drugId/images[/:imageId]` | Pharmacist/Staff | Drug images |
| POST/DELETE | `/inventory/drugs/:drugId/alternatives[/:alternativeDrugId]` | Pharmacist/Staff | Link an alternative from the same inventory |
| POST | `/inventory/branch/:branchId/batch-upload` | Pharmacist | CSV batch upload |

### Search (`/search`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/search/drugs` | Public/Guest | Search drugs (geo-fenced) |
| GET | `/search/ailments` | Public/Guest | Search by ailment |
| GET | `/search/pharmacies` | Public/Guest | Search pharmacies |
| GET | `/search/pharmacies/:id/drugs` | Public/Guest | Search within pharmacy |
| GET | `/search/drugs/:drugId` | Public/Guest | Drug information page |
| GET | `/search/drugs/:drugId/availability` | Public/Guest | Which pharmacies have drug |

**Query Parameters for `/search/drugs`:**
```
q         string   Search term
lat       number   Customer latitude
lng       number   Customer longitude
radius    number   Initial radius km (default: auto-expand from 2km)
category  string   Filter by category slug
page      number   Page number (default: 1)
limit     number   Items per page (default: 20)
```

### Reservations (`/reservations`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/reservations` | Customer/Guest | Create reservation |
| POST | `/reservations/from-list` | Customer | Batch reserve from list |
| GET | `/reservations/:id` | Customer/Pharmacist | Reservation detail |
| GET | `/reservations/customer/:customerId` | Customer | Customer's reservations |
| GET | `/reservations/pharmacy/:pharmacyId` | Pharmacist | Pharmacy reservation feed |
| POST | `/reservations/verify` | Pharmacist | Verify QR/code |
| PUT | `/reservations/:id/serve` | Pharmacist | Mark as served |
| PUT | `/reservations/:id/cancel` | Customer/Pharmacist | Cancel reservation |

### Subscriptions (`/subscriptions`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/subscriptions/plans` | Public | List all plans |
| GET | `/subscriptions/pharmacy/:pharmacyId` | Pharmacist | Current subscription |
| POST | `/subscriptions/pharmacy/:pharmacyId/subscribe` | Pharmacist | Subscribe to plan |
| POST | `/subscriptions/pharmacy/:pharmacyId/upgrade` | Pharmacist | Upgrade plan |
| POST | `/subscriptions/pharmacy/:pharmacyId/cancel` | Pharmacist | Cancel subscription |
| GET | `/subscriptions/pharmacy/:pharmacyId/billing-history` | Pharmacist | Billing history |
| GET | `/subscriptions/payments/verify/:reference` | Pharmacist | Verify a checkout reference and activate if paid |
| GET | `/subscriptions/payments/callback` | Public | Hosted-checkout return URL (Paystack `reference`, Flutterwave `tx_ref`) |
| POST | `/subscriptions/webhook/paystack` | System | Paystack webhook |
| POST | `/subscriptions/webhook/flutterwave` | System | Flutterwave webhook |

### Ads (`/ads`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/ads/feed` | Public/Guest | Customer ad feed |
| GET | `/ads/:id` | Public/Guest | Ad detail page |
| POST | `/ads/impressions` | Public | Record impression |
| POST | `/ads/clicks` | Public | Record click |
| GET | `/ads/pharmacy/:pharmacyId/campaigns` | Pharmacist | List campaigns |
| POST | `/ads/pharmacy/:pharmacyId/campaigns` | Pharmacist | Create campaign |
| PUT | `/ads/pharmacy/:pharmacyId/campaigns/:id` | Pharmacist | Update campaign |
| DELETE | `/ads/pharmacy/:pharmacyId/campaigns/:id` | Pharmacist | Delete campaign |
| GET | `/ads/pharmacy/:pharmacyId/campaigns/:id/analytics` | Pharmacist | Campaign analytics |
| POST | `/ads/pharmacy/:pharmacyId/campaigns/quote` | Pharmacist | Price preview (plan + promo discounts) |
| POST | `/ads/pharmacy/:pharmacyId/campaigns/:id/checkout` | Pharmacist (owner) | Pay for a campaign via hosted checkout |
| POST | `/ads/pharmacy/:pharmacyId/campaigns/:id/creative` | Pharmacist | Upload banner image |
| PATCH | `/ads/pharmacy/:pharmacyId/campaigns/:id/status` | Pharmacist | Pause / resume / cancel |
| POST | `/ads/:id/ratings` | Customer | Rate an ad (1–5 stars) |


### Customer & Saves — additions (Phase 9)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/saves/status` | Customer | Saved flags for given drug/pharmacy ids |
| PATCH | `/saves/lists/:id/drugs/:drugId` | Customer | Change quantity in a list |
| POST | `/saves/lists/:id/reserve` | Customer | Reserve the whole list at one branch |
| DELETE | `/customer/history/searches` | Customer | Clear search history |


### Points — additions (Phase 10)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/points/rules` | Public | Earning rules |
| GET | `/points/leaderboard/pharmacies` | Public | Top pharmacies by lifetime points |
| POST | `/admin/points/adjust` | Admin | Credit / debit a ledger |


### Notifications — additions (Phase 11)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/notifications/unread-count` | Any user | Badge count |
| GET | `/notifications/preferences` | Any user | Channel toggles + muted categories |
| DELETE | `/notifications/:id` | Any user | Remove from history |
| POST | `/admin/notifications/broadcast` | Admin | Announcement to a segment |
| GET | `/admin/notifications/stats` | Admin | Delivery outcomes + recent failures |

WebSocket: see `docs/REALTIME.md` for the full contract (rooms, subscribe acks, all events).


### Support & Content — additions (Phase 12)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/support/categories` | Public | Complaint categories + suggestion areas |
| GET | `/support/complaints/:id` | User | Ticket with conversation |
| POST | `/support/complaints/:id/messages` | User | Follow-up (reopens resolved) |
| GET | `/support/suggestions` | User | My suggestions |
| GET | `/content` | Public | Page index with versions |
| GET | `/content/good-cause` | Public | Stats + projects + testimonials |
| GET | `/content/good-cause/projects/:id` | Public | Project with testimonials |
| GET | `/content/pages/:key` | Public | Any page by key or slug |
| GET/PATCH | `/admin/support/tickets[/:id]` | Admin | Ticket queue, triage |
| POST | `/admin/support/tickets/:id/messages` | Admin | Reply or internal note |
| GET/PATCH | `/admin/support/suggestions[/:id]` | Admin | Suggestion review |
| GET | `/admin/support/summary` | Admin | Queue health counts |
| GET/PUT | `/admin/content/pages[/:key]` | Admin | Edit pages; `POST …/reset` restores default |
| CRUD | `/admin/content/good-cause/projects` | Admin | Projects + `POST …/:id/image` |
| CRUD | `/admin/content/good-cause/testimonials` | Admin | Testimonials + `POST …/:id/avatar` |


### Analytics (Phase 13)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/analytics/pharmacy/:id/access` | Owner/operator | Plan includes analytics? (upgrade prompt) |
| GET | `/analytics/pharmacy/:id/overview` | Owner/operator (Zuko+) | Totals, % change, KPIs, daily series |
| GET | `/analytics/pharmacy/:id/reservations` | Owner/operator (Zuko+) | Outcomes, timing, branches, peak hours |
| GET | `/analytics/pharmacy/:id/inventory` | Owner/operator (Zuko+) | Slots, stock, top drugs, restock, expiry |
| GET | `/analytics/pharmacy/:id/search-appearances` | Owner/operator (Zuko+) | Appearances, queries, unmet demand |
| GET | `/analytics/pharmacy/:id/ads` | Owner/operator (Zuko+) | Impressions, clicks, CTR, spend, campaigns |
| GET | `/admin/analytics/platform` | Admin | Platform growth, reservations, search, revenue |
| GET | `/admin/analytics/search-trends` | Admin | Top and zero-result searches |
| GET | `/admin/analytics/pharmacies/leaderboard` | Admin | Top pharmacies by metric |
| POST | `/admin/analytics/snapshots/rebuild` | Admin | Recompute daily snapshots |

All analytics periods: `?period=7d|30d|90d|365d` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (Lagos days).

### Back office (`/admin`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/admin/dashboard/overview` | Admin | Platform-wide snapshot |
| GET | `/admin/dashboard/audit-logs` | Admin | Admin action trail |
| GET | `/admin/admins` | Admin | Admin accounts; `search` by name, email or FADA ID, paginated |
| POST | `/admin/admins` | Admin | Create an admin account (audited as `admin.created`) |
| GET | `/admin/subscriptions` | Admin | All subscriptions (filters) |
| GET | `/admin/subscriptions/revenue` | Admin | MRR, by-plan counts, 30-day revenue |
| GET | `/admin/subscriptions/:pharmacyId` | Admin | Subscription detail + billing |
| POST | `/admin/subscriptions/:pharmacyId/assign-plan` | Admin | Comp a plan without payment |
| POST | `/admin/subscriptions/:pharmacyId/extend` | Admin | Extend period by N days |
| POST | `/admin/subscriptions/:pharmacyId/cancel` | Admin | Cancel (period end or immediate) |
| GET | `/admin/ads/overview` | Admin | Campaign counts, review queue, engagement, ad revenue |
| GET | `/admin/ads/campaigns` | Admin | All campaigns (pending review first) |
| GET | `/admin/ads/campaigns/:id` | Admin | Campaign + analytics + billing |
| POST | `/admin/ads/campaigns/:id/review` | Admin | Approve / reject |
| POST | `/admin/ads/campaigns/:id/status` | Admin | Force pause / resume / cancel |
| GET | `/admin/promotions` | Admin | List promotions |
| POST | `/admin/promotions` | Admin | Create seasonal discount or promo code |
| GET | `/admin/promotions/:id` | Admin | Promotion + recent redemptions |
| PATCH | `/admin/promotions/:id` | Admin | Update |
| DELETE | `/admin/promotions/:id` | Admin | Deactivate |

### Customer Profile (`/customer`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/customer/profile` | Customer | Get profile |
| PUT | `/customer/profile` | Customer | Update profile |
| GET | `/customer/addresses` | Customer | List addresses |
| POST | `/customer/addresses` | Customer | Add address |
| PUT | `/customer/addresses/:id` | Customer | Update address |
| DELETE | `/customer/addresses/:id` | Customer | Remove address |
| GET | `/customer/history/reservations` | Customer | Reservation history |
| GET | `/customer/history/searches` | Customer | Search history |
| DELETE | `/customer/history/searches/:id` | Customer | Remove search |
| POST | `/customer/history/searches/:id/repeat` | Customer | Repeat search |

### Saves (`/saves`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/saves/drugs` | Customer | Saved drugs |
| POST | `/saves/drugs/:drugId` | Customer | Save drug |
| DELETE | `/saves/drugs/:drugId` | Customer | Unsave drug |
| GET | `/saves/pharmacies` | Customer | Saved pharmacies |
| POST | `/saves/pharmacies/:pharmacyId` | Customer | Save pharmacy |
| DELETE | `/saves/pharmacies/:pharmacyId` | Customer | Unsave pharmacy |
| GET | `/saves/lists` | Customer | Drug lists |
| POST | `/saves/lists` | Customer | Create list |
| GET | `/saves/lists/:id` | Customer | List detail |
| PUT | `/saves/lists/:id` | Customer | Rename list |
| DELETE | `/saves/lists/:id` | Customer | Delete list |
| POST | `/saves/lists/:id/drugs` | Customer | Add drug to list |
| DELETE | `/saves/lists/:id/drugs/:drugId` | Customer | Remove from list |

### Points (`/points`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/points/customer/:customerId` | Customer | Customer points + level |
| GET | `/points/customer/:customerId/history` | Customer | Points history |
| GET | `/points/pharmacy/:pharmacyId` | Pharmacist | Pharmacy points + LVL |
| GET | `/points/pharmacy/:pharmacyId/history` | Pharmacist | Points history |
| GET | `/points/levels` | Public | All levels + requirements |

### Notifications (`/notifications`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/notifications/device-tokens` | JWT | Register FCM token |
| DELETE | `/notifications/device-tokens/:token` | JWT | Deregister token |
| GET | `/notifications/history` | JWT | In-app notification list |
| PUT | `/notifications/:id/read` | JWT | Mark as read |
| PUT | `/notifications/read-all` | JWT | Mark all as read |
| PUT | `/notifications/preferences` | JWT | Update preferences |

### Support (`/support`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/support/contact` | Public | Contact info |
| POST | `/support/complaints` | JWT | File complaint |
| GET | `/support/complaints` | JWT | My complaints |
| POST | `/support/suggestions` | JWT | Suggest feature |

### Content (`/content`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/content/app-info` | Public | App info |
| GET | `/content/disclaimer` | Public | Disclaimer |
| GET | `/content/terms-of-service` | Public | Terms of service |
| GET | `/content/privacy-policy` | Public | Privacy policy |
| GET | `/content/credits` | Public | Credits |
| GET | `/content/future-features` | Public | Future features |
| GET | `/content/good-cause/projects` | Public | Good cause projects |
| GET | `/content/good-cause/testimonials` | Public | Testimonials |

### Analytics (`/analytics`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/analytics/pharmacy/:id/overview` | Pharmacist (paid tier) | Dashboard overview |
| GET | `/analytics/pharmacy/:id/reservations` | Pharmacist (paid tier) | Reservation metrics |
| GET | `/analytics/pharmacy/:id/inventory` | Pharmacist (paid tier) | Inventory analytics |
| GET | `/analytics/pharmacy/:id/search-appearances` | Pharmacist (paid tier) | Search metrics |
| GET | `/analytics/pharmacy/:id/ads` | Pharmacist (paid tier) | Ad performance |

### System
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | Health check |
| GET | `/api/docs` | Public | Swagger UI |

---

## Error Codes

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions or subscription |
| `NOT_FOUND` | 404 | Resource not found |
| `SLOT_LIMIT_REACHED` | 403 | Inventory slot limit hit |
| `BRANCH_LIMIT_REACHED` | 403 | Branch limit for subscription tier |
| `GUEST_SEARCH_LIMIT` | 429 | Guest exceeded 3 searches/day |
| `GUEST_RESERVATION_LIMIT` | 429 | Guest exceeded reservation limit |
| `RESERVATION_EXPIRED` | 400 | Reservation is expired |
| `DRUG_OUT_OF_STOCK` | 400 | Drug unavailable at this pharmacy |
| `INVALID_OTP` | 400 | OTP is wrong or expired |
| `INVALID_RESERVATION_CODE` | 400 | Code not found or already served |
| `SUBSCRIPTION_REQUIRED` | 402 | Feature requires active subscription |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Webhook signature verification failed |
