#!/usr/bin/env bash
# Runs the e2e suite against throwaway Postgres + Redis containers, then removes them.
# Docker picks free host ports, so nothing already running on this machine is touched.
# Usage: npm run test:e2e:docker [-- jest args]   (e.g. -- --coverage, -- -t "subscription")
set -euo pipefail

PG="fada-e2e-pg-$$"
RD="fada-e2e-redis-$$"
cleanup() { docker rm -f "$PG" "$RD" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$PG" -e POSTGRES_USER=fada_test -e POSTGRES_PASSWORD=fada_test \
  -e POSTGRES_DB=fada_test -p "127.0.0.1::5432" postgres:16-alpine >/dev/null
docker run -d --rm --name "$RD" -p "127.0.0.1::6379" redis:7-alpine >/dev/null

PG_PORT="$(docker port "$PG" 5432/tcp | head -1 | awk -F: '{print $NF}')"
REDIS_PORT="$(docker port "$RD" 6379/tcp | head -1 | awk -F: '{print $NF}')"

for _ in $(seq 1 30); do
  docker exec "$PG" pg_isready -U fada_test -d fada_test >/dev/null 2>&1 && break
  sleep 1
done

export TEST_DATABASE_URL="postgresql://fada_test:fada_test@127.0.0.1:${PG_PORT}/fada_test?schema=public"
export TEST_REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
echo "e2e: postgres :${PG_PORT}, redis :${REDIS_PORT}"

npx jest -c test/jest-e2e.config.js --runInBand "$@"
