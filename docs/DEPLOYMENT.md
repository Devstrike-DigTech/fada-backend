# FADA Backend — Deployment

## Topology

One stateless Node process (HTTP + Socket.IO + Bull workers) behind a proxy, plus PostgreSQL and Redis.
Run two or more replicas for availability: Socket.IO rooms, rate limits and queues are shared through Redis.

| Piece | Railway | Single host |
|---|---|---|
| API | service built from `Dockerfile` (`railway.json`) | `api` in `docker-compose.prod.yml` |
| Migrations + seed | `preDeployCommand` (runs before each deploy) | one-shot `migrate` service |
| PostgreSQL | Railway Postgres plugin | `postgres` (PostGIS image) |
| Redis | Railway Redis plugin | `redis` (password + AOF) |

## Image

`Dockerfile` is multi-stage on `node:20-bookworm-slim`: production-only `node_modules`, compiled `dist/` and
`dist-seed/`, runs as the unprivileged `node` user under `tini`, with a container `HEALTHCHECK` on
`/api/v1/health/live`. Optional `RUN_MIGRATIONS=true` / `RUN_SEED=true` run before start for single-container setups.

```bash
docker build -t fada-backend .
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## Health probes

| Path | Use | Checks |
|---|---|---|
| `/api/v1/health/live` | liveness / container HEALTHCHECK | process only (never restarts the app for a DB blip) |
| `/api/v1/health/ready` | readiness / Railway healthcheck / load balancer | PostgreSQL + Redis |
| `/api/v1/health` | humans / dashboards | DB, Redis, memory, disk |

## Database migrations

- Only `prisma migrate deploy` runs in staging and production (never `migrate dev` or `db push`).
- Railway runs it in `preDeployCommand`; a failed migration stops the deploy before traffic moves.
- The seed (`node dist-seed/prisma/seed.js`) is idempotent: plans are upserted, content pages are created only
  when missing (back-office edits are kept).
- CI applies every migration to an empty Postgres and fails on any drift from `schema.prisma`.
- Write migrations to be backward compatible with the previous release (add columns nullable or with defaults,
  backfill, then tighten in a later release), so a rollback of the app does not need a DB rollback.

## Environment

Required in every environment (see `.env.example` for all keys):

| Key | Notes |
|---|---|
| `NODE_ENV` | `production` (disables Swagger, quieter logs, trusts 1 proxy hop) |
| `DATABASE_URL`, `REDIS_URL` | Railway plugins inject these |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥ 32 random chars each, different per environment |
| `ADMIN_BOOTSTRAP_SECRET` | one-time first-admin creation; rotate or remove after use |
| `ALLOWED_ORIGINS` | the admin web app origin(s); mobile apps are unaffected by CORS |
| `PAYSTACK_SECRET_KEY` | live key in production; webhook URL `…/api/v1/subscriptions/webhook/paystack` |
| `RESEND_API_KEY`, `TERMII_API_KEY`, `FIREBASE_*` | without them the channel is skipped (logged), not fatal |

Store secrets as Railway service variables (or GitHub environment secrets for CI); never in the repo.

## CI/CD (GitHub Actions, `.github/workflows`)

- `ci.yml` — on PRs and pushes to `dev` / `main`: lint (incl. formatting), typecheck, unit tests,
  migration drift check, e2e tests against Postgres + Redis services, business-logic coverage gate (70 %),
  Docker build.
- `deploy.yml` — after CI succeeds on a push: `dev` → Railway **staging**, `main` → **production**
  (protect the `production` GitHub environment to require approval), then a readiness smoke test.
  Needs per-environment secret `RAILWAY_TOKEN` and variables `RAILWAY_SERVICE`, `API_BASE_URL`.

## Rollback

Redeploy the previous successful Railway deployment from the dashboard (or `railway redeploy`). Because
migrations are additive, the previous image runs against the newer schema.
