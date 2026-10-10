# FADA Backend — Testing

| Command | What |
|---|---|
| `npm test` / `npm run test:cov` | unit tests (`src/**/*.spec.ts`), no database |
| `npm run test:e2e:docker` | full e2e suite against throwaway Postgres + Redis containers (Docker picks free ports, containers removed afterwards). Add `-- --coverage` or `-- -t "billing"` |
| `npm run test:e2e` | e2e against your own services: set `TEST_DATABASE_URL` (database name must contain `test`) and `TEST_REDIS_URL` |
| `npm run coverage:merge` | merges unit + e2e coverage; prints business-logic coverage (`BUSINESS_COVERAGE_MIN=70` fails below) |
| `npm run lint:check`, `npm run typecheck` | what CI runs |

## How e2e works

- `test/setup/global-setup.ts` refuses non-test databases, applies migrations, truncates, seeds, flushes Redis.
- `test/setup/env.ts` blanks all provider credentials and **blocks outbound network**: anything that is not
  localhost fails with 599 unless a test fakes it with `fakeNetwork()` (`test/helpers/network.ts`) — e.g.
  Paystack, the PCN registry, CSV file URLs. No email, SMS, push or payment leaves the machine.
- `createTestApp()` boots the real `AppModule` with the same `configureApp()` production uses; `listen: true`
  starts HTTP + Socket.IO for realtime tests.

## Suites

| Suite | Covers |
|---|---|
| `platform` | health probes, security headers, request ids, body limits, validation, public content |
| `auth` | customer / pharmacist registration, OTP, login, refresh rotation, logout, OTP brute-force limit, password reset revoking sessions, admin bootstrap |
| `marketplace` | pharmacist onboarding → CAC + PCN verification → stocking → geo + text search → reservation lifecycle → points, notifications, plan limits, analytics gating |
| `billing` | Paystack checkout, signed webhooks, idempotent replays, plan limits, promo codes, seasonal discounts, cancel, admin comp, callback verification |
| `integrations` | support threads + email pipeline, profile points, age rule, notification mutes, full ad lifecycle, search analytics |
| `realtime-security` | socket handshake auth, room authorisation, live reservation events (single delivery), rate limiting |
| `customer` | profile, addresses, saves, lists + list reservation, search history, reservation history, points views |
| `pharmacy-ops` | profile completion, hours, staff invites, inventory CRUD, stock events + auto-cancel, CSV upload (incl. plan limit), admin (un)verify |
| `backoffice` | content CMS, Good Cause, dashboard, categories, subscriptions, points adjust, broadcast, audit, analytics + snapshots, billing sweep, ads lifecycle |
