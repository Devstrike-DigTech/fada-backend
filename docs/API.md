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
| POST | `/auth/verify/email` | Public | Verify email OTP |
| POST | `/auth/login` | Public | Login with email/FADA ID + password |
| GET | `/auth/login/google` | Public | Google OAuth redirect |
| POST | `/auth/login/apple` | Public | Apple Sign-In |
| POST | `/auth/refresh` | Refresh Token | Rotate access + refresh tokens |
| POST | `/auth/logout` | JWT | Revoke refresh token |
| GET | `/auth/guest/token` | Public | Get anonymous guest JWT |
| POST | `/auth/password/forgot` | Public | Request password reset OTP |
| POST | `/auth/password/verify-otp` | Public | Verify reset OTP |
| POST | `/auth/password/reset` | Public | Set new password |

### Pharmacy (`/pharmacies`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/pharmacies/:id` | Public | Public pharmacy profile |
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
| GET | `/inventory/categories` | Public | List drug categories |
| GET | `/inventory/nafdac/:number` | Pharmacist | NAFDAC number lookup |
| GET | `/inventory/batch-upload/template` | Pharmacist | Download CSV template |
| GET | `/inventory/:branchId/summary` | Pharmacist | Slots used + last drug |
| GET | `/inventory/:branchId/drugs` | Pharmacist | Paginated drug list |
| POST | `/inventory/:branchId/drugs` | Pharmacist | Add single drug |
| GET | `/inventory/:branchId/drugs/:drugId` | Pharmacist | Drug detail |
| PUT | `/inventory/:branchId/drugs/:drugId` | Pharmacist | Update drug |
| DELETE | `/inventory/:branchId/drugs/:drugId` | Pharmacist | Delete drug |
| POST | `/inventory/:branchId/drugs/:drugId/images` | Pharmacist | Upload drug images |
| POST | `/inventory/:branchId/drugs/batch-upload` | Pharmacist | Batch upload |
| GET | `/inventory/:branchId/drugs/batch-upload/:jobId` | Pharmacist | Upload job status |
| POST | `/inventory/:branchId/drugs/:drugId/alternatives` | Pharmacist | Link alternative |

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
