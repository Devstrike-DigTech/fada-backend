# FADA Backend — Security

## Controls in place

| Area | Control |
|---|---|
| Transport / headers | Helmet (HSTS, nosniff, frame-guard, …), `x-powered-by` off, CORS allow-list via `ALLOWED_ORIGINS` |
| Input | Global `ValidationPipe` with whitelist + `forbidNonWhitelisted`; body limit `BODY_LIMIT` (1 MB) |
| SQL | Prisma parameterised queries; raw SQL binds every user value (`$n`), LIKE wildcards escaped |
| AuthN | 15-min access JWT + rotating single-use refresh tokens (Redis); deactivated accounts rejected on every request and socket handshake |
| OTP | 6-digit CSPRNG codes, 10-min TTL, constant-time compare, destroyed after 5 wrong guesses |
| Sessions | password reset / change revokes every refresh token |
| AuthZ | `@Roles` guard + per-resource ownership checks; WebSocket rooms authorised per room |
| Rate limits | Redis-backed (shared across instances): per user when signed in, per IP otherwise (carrier-NAT friendly); strict per-IP limits on login, register, OTP, password reset, bootstrap; webhooks and health exempt |
| Webhooks | Paystack HMAC-SHA512 over the raw body, Flutterwave `verif-hash`; both constant-time; idempotent processing |
| Logging | request id on every request; URLs, headers and bodies scrubbed of passwords, OTPs, tokens, card data before logging; no bodies in access logs |
| Admin | every money-, plan- and content-affecting action written to `admin_audit_logs` |
| Containers | non-root user, production dependencies only, secrets via environment |

## Runbook: rotating JWT secrets

Tokens are signed with the current secret and accepted if they verify with the current **or** previous one.

1. Generate a new secret: `openssl rand -base64 48`.
2. Set `JWT_ACCESS_SECRET_PREVIOUS` = the current `JWT_ACCESS_SECRET`, then `JWT_ACCESS_SECRET` = the new value.
   Do the same for the refresh pair if rotating it.
3. Deploy. Nobody is signed out; new tokens use the new secret.
4. After the longest token lifetime (15 min access, 30 days refresh) remove the `_PREVIOUS` values and deploy.

Emergency (secret leaked): set the new secret **without** a `_PREVIOUS` value. Every session is invalidated and
users sign in again.

## Runbook: other secrets

- **Paystack**: roll the key in the Paystack dashboard, update `PAYSTACK_SECRET_KEY`, deploy. Webhook signatures
  use the same key, so update both at once.
- **ADMIN_BOOTSTRAP_SECRET**: only needed until the first admin exists; then remove it (the endpoint refuses once
  an admin exists anyway).

## Reporting

Report vulnerabilities privately to the project lead (Devstrike Digital). Do not open public issues for them.
