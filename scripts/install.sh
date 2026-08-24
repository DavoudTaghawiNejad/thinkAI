#!/usr/bin/env bash
# First-install setup: generates secrets, brings up Postgres, applies the schema
# (supabase/migrations/*.sql, in order) and the invite-key seed if present, then
# starts the full stack. Not idempotent against an already-migrated database —
# this applies raw CREATE TABLE migrations, so re-running against an existing
# schema will fail. To start over, `docker compose down -v` first.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

get_env_var() { grep "^${1}=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
set_env_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    grep -v "^${key}=" .env > .env.tmp && mv .env.tmp .env
  fi
  printf '%s=%s\n' "$key" "$value" >> .env
}

echo "==> Checking secrets"

POSTGRES_PASSWORD="$(get_env_var POSTGRES_PASSWORD)"
if [ -z "$POSTGRES_PASSWORD" ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  set_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  echo "  generated POSTGRES_PASSWORD"
fi

JWT_SECRET="$(get_env_var JWT_SECRET)"
if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  set_env_var JWT_SECRET "$JWT_SECRET"
  echo "  generated JWT_SECRET"
fi

ANON_KEY="$(get_env_var ANON_KEY)"
if [ -z "$ANON_KEY" ]; then
  ANON_KEY="$(node "$(dirname "$0")/generate-jwt.mjs" anon "$JWT_SECRET")"
  set_env_var ANON_KEY "$ANON_KEY"
  set_env_var SUPABASE_PUBLISHABLE_KEY "$ANON_KEY"
  set_env_var VITE_SUPABASE_PUBLISHABLE_KEY "$ANON_KEY"
  echo "  generated ANON_KEY"
fi

SERVICE_ROLE_KEY="$(get_env_var SERVICE_ROLE_KEY)"
if [ -z "$SERVICE_ROLE_KEY" ]; then
  SERVICE_ROLE_KEY="$(node "$(dirname "$0")/generate-jwt.mjs" service_role "$JWT_SECRET")"
  set_env_var SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
  set_env_var SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
  echo "  generated SERVICE_ROLE_KEY"
fi

VITE_SUPABASE_URL="$(get_env_var VITE_SUPABASE_URL)"
if [ -z "$VITE_SUPABASE_URL" ]; then
  echo "WARNING: VITE_SUPABASE_URL is not set in .env (e.g. https://thinkAI.taghawi-nejad.de)."
  echo "         The browser needs this to reach auth/rest through Apache. Set it and re-run."
fi

echo "==> Starting Postgres"
docker compose up -d db

echo "==> Waiting for Postgres to be healthy"
until [ "$(docker compose ps -q db | xargs docker inspect -f '{{.State.Health.Status}}' 2>/dev/null)" = "healthy" ]; do
  sleep 2
done

echo "==> Applying schema"
for f in supabase/migrations/*.sql; do
  echo "  - $f"
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done

if [ -f supabase/seed-invite-keys.sql ]; then
  echo "==> Seeding invite keys"
  docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/seed-invite-keys.sql
fi

echo "==> Starting the full stack"
docker compose up -d --build

echo "==> Done. App listening on 127.0.0.1:3000, gateway (auth+rest) on 127.0.0.1:8000."
echo "    Point Apache at both — see deploy/apache-thinkAI.conf."
