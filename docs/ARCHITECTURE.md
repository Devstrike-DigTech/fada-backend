# FADA Backend — Architecture

---

## Architecture Pattern: Modular Monolith

FADA uses a **Modular Monolith** architecture — the deliberate middle ground between a traditional monolith and a full microservices system.

### Why Not Microservices?
Microservices introduce distributed systems complexity (network partitions, distributed transactions, service discovery, observability overhead) that a focused startup team cannot absorb operationally at this stage.

### Why Not a Traditional Monolith?
A monolith with no internal boundaries accumulates technical debt that makes future extraction of services painful or impossible.

### The Modular Monolith Approach
- Each feature domain is a **NestJS module** with strict internal encapsulation
- Modules **do not import each other's services** directly — all cross-module communication goes through the **internal event bus**
- Each module owns its own **database tables** (enforced by convention)
- The entire app deploys as one process, but module boundaries are clean enough to **extract any module into a standalone service** when the need arises

---

## Module Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                        FADA Backend Process                      │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐   │
│  │   Auth   │  │ Pharmacy │  │ Inventory │  │    Search    │   │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └──────┬───────┘   │
│       │             │              │                │           │
│  ┌────▼─────────────▼──────────────▼────────────────▼───────┐  │
│  │                     Internal Event Bus                     │  │
│  │                   (EventEmitter2)                          │  │
│  └────┬──────────┬──────────┬──────────┬──────────┬──────────┘  │
│       │          │          │          │          │              │
│  ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────────┐    │
│  │Reserve │ │  Subs  │ │  Ads   │ │ Points │ │Notification│    │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────────┘    │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────┐   │
│  │ Analytics│  │  Saves   │  │  Support  │  │   Content    │   │
│  └──────────┘  └──────────┘  └───────────┘  └──────────────┘   │
│                                                                  │
│  ─────────────────── Infrastructure Layer ──────────────────    │
│  Prisma │ Redis │ BullMQ │ Storage │ Payments │ Socket.IO        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Layer Breakdown

### 1. API Layer (Controllers)
- NestJS controllers receive HTTP requests
- Input validated via class-validator DTOs
- Auth enforced via guards before reaching controller
- Controllers call **only their own module's service** — never another module's

### 2. Service Layer (Business Logic)
- All business rules live in services
- Services emit events via `EventBusService` when significant things happen
- Services may call infrastructure services (Prisma, Redis, Storage, etc.)

### 3. Event Bus Layer (Cross-Module Communication)
- `EventBusService` wraps NestJS `EventEmitter2`
- Events are strongly typed via `events.types.ts`
- Listeners are co-located with the module that cares about the event (in `listeners/` subfolder)
- An event can have **zero or many listeners** — emitters never know or care who listens

### 4. Infrastructure Layer
- `PrismaService` — database access
- `RedisService` — cache, rate limiting, session store
- `QueueModule` — BullMQ job queues
- `StorageService` — Cloudflare R2 / Cloudinary
- `PaymentInterface` — Paystack / Flutterwave abstraction
- `SocketGateway` — Socket.IO real-time connections
- `EventBusService` — internal event emitter

### 5. Database Layer
- Single PostgreSQL instance with PostGIS extension
- All modules share one database but respect ownership boundaries
- Prisma manages schema, types, and migrations

---

## Request Lifecycle

```
HTTP Request
    │
    ▼
Global Pipes (ValidationPipe)
    │
    ▼
Guards (JwtAuthGuard → RolesGuard → GuestGuard)
    │
    ▼
Interceptors (LoggingInterceptor → ResponseTransformInterceptor)
    │
    ▼
Controller (validates DTO, calls service)
    │
    ▼
Service (business logic, database ops)
    │
    ├──► EventBus.emit('event.name', payload)
    │         │
    │         ▼
    │    Other Module Listeners (async, non-blocking)
    │
    ▼
Response (wrapped in standard envelope)
    │
    ▼
HTTP Response
```

---

## Real-Time Architecture

```
Client App
    │  WebSocket connect (JWT in handshake)
    ▼
Socket.IO Gateway (NestJS)
    │  Validate JWT, attach user to socket
    │  Join authorized rooms
    ▼
Redis Pub/Sub Adapter
    │  Shares room state across multiple server instances
    ▼
Event Bus Listener
    │  On reservation status change, emit to room
    ▼
Client App receives live update
```

---

## Queue Architecture

```
Service Layer
    │  bullMQ.add('notification.send', payload)
    ▼
BullMQ Queue (Redis-backed)
    │
    ▼
Worker Process (same Node.js process, separate processor class)
    │  Retry on failure (exponential backoff)
    │  Dead-letter queue for permanent failures
    ▼
Side Effect Complete (email sent, notification pushed, file processed)
```

### Queues
| Queue Name | Purpose |
|---|---|
| `notifications` | FCM push, SMS, email dispatch |
| `inventory.batch-upload` | CSV/Excel drug upload processing |
| `reservations.expiry-check` | Scheduled job, runs every 15 min |
| `nafdac.cache-refresh` | Weekly NAFDAC data sync |
| `analytics.snapshot` | Daily aggregation jobs |
| `verification.pcn` | PCN license verification (async) |
| `verification.cac` | CAC number verification (async) |

---

## Security Model

### Authentication
- **Access Token** — short-lived JWT (15 min), stateless
- **Refresh Token** — long-lived (30 days), stored in Redis (revocable)
- **Guest Token** — anonymous JWT with `role: guest` + `deviceId` claim

### Authorization
- `@Roles('customer' | 'pharmacist' | 'admin')` decorator + `RolesGuard`
- `@Public()` decorator bypasses all auth guards
- Subscription tier checked in service layer (not at guard level)

### Rate Limiting
| Scope | Limit | Storage |
|---|---|---|
| Guest searches | 3/day | Redis TTL key |
| Guest reservations | 1/day | Redis TTL key |
| OTP requests | 3/hour | Redis TTL key |
| Password reset | 3/hour | Redis TTL key |
| Global API | 100 req/min per IP | NestJS Throttler |

### Webhook Security
- Paystack: HMAC-SHA512 signature verified before processing
- Flutterwave: hash verification before processing
- Raw body preserved for signature verification (before JSON parse)

---

## Geo-Search Architecture

### Radius Expansion Algorithm
```
Search query arrives (q, lat, lng)
    │
    ▼ Try radius = 2km
    │  If results >= 1 → return results + metadata {radius_used: 2}
    │
    ▼ Expand to 5km
    │  If results >= 1 → return
    │
    ▼ Expand to 10km → 20km → 50km
    │
    ▼ If still 0 results → return empty with suggestion to broaden search
```

### PostGIS Query Pattern
```sql
SELECT d.*, b.name AS branch_name,
  ST_Distance(b.location, ST_MakePoint($lng, $lat)::geography) AS distance_m
FROM drugs d
JOIN branches b ON d.branch_id = b.id
WHERE d.search_vector @@ plainto_tsquery('english', $query)
  AND d.stock_status != 'out_of_stock'
  AND ST_DWithin(b.location, ST_MakePoint($lng, $lat)::geography, $radius_m)
ORDER BY distance_m ASC
LIMIT 20 OFFSET $offset;
```

---

## Extensibility Design

### Feature Flags
A `FeatureFlag` system (Redis-backed) gates future features:
```
purchase.enabled          → unlock buy/checkout flow
ai_suggestions.enabled    → activate AI drug recommendations
edu_content.enabled       → show pharmaceutical education cards
smart_list.enabled        → AI-powered drug shopping lists
delivery.enabled          → add delivery fulfillment channel
```

### Fulfillment Channel Interface
The `ReservationModule` is built against an `IFulfillmentChannel` interface:
```typescript
interface IFulfillmentChannel {
  create(items: OrderItem[]): Promise<Fulfillment>
  verify(code: string): Promise<VerificationResult>
  complete(fulfillmentId: string): Promise<void>
  cancel(fulfillmentId: string): Promise<void>
}
```
- **ReservationFulfillment** — current implementation
- **PurchaseFulfillment** — future (adds payment + delivery)
- **SubscriptionFulfillment** — future (recurring orders)

### Search Provider Interface
```typescript
interface ISearchProvider {
  indexDrug(drug: Drug): Promise<void>
  removeDrug(drugId: string): Promise<void>
  search(query: SearchQuery): Promise<SearchResult[]>
}
```
- **PostgresFTSProvider** — v1 (current)
- **TypesenseProvider** — v2 (swap in when volume demands)
- **AISemanticProvider** — future (natural language: "what helps with malaria?")

---

## Deployment Architecture

### Development
```
localhost
├── NestJS app (port 3000)
├── PostgreSQL + PostGIS (Docker, port 5432)
└── Redis (Docker, port 6379)
```

### Production (Railway — v1)
```
Railway
├── NestJS service (auto-scaled containers)
├── PostgreSQL service (managed)
└── Redis service (Upstash)

Cloudflare R2 (file storage)
Cloudinary (image processing)
Firebase FCM (push notifications)
Paystack (payments)
Termii (SMS)
Resend (email)
```

### Production (AWS — v2)
```
AWS
├── ECS Fargate (NestJS containers — auto-scaling)
├── RDS PostgreSQL + PostGIS (Multi-AZ)
├── ElastiCache Redis (cluster mode)
├── ALB (Application Load Balancer)
└── ECR (container registry)

Cloudflare R2 / S3 (file storage)
```
