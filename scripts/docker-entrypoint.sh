#!/bin/sh
# Optional one-shot tasks before the server starts. Prefer running migrations as
# a separate release step (Railway preDeployCommand / compose "migrate" service);
# RUN_MIGRATIONS=true is for single-container setups.
set -e

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy"
  npx prisma migrate deploy
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding reference data (idempotent)"
  node dist-seed/prisma/seed.js
fi

exec "$@"
