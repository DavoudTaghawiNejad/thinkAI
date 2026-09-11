#!/usr/bin/env bash
# Applies pending supabase/migrations/*.sql to THIS directory's stack.
#
# Safe to re-run: every applied migration is recorded in public.schema_migrations
# and skipped thereafter. Each migration runs inside one transaction together
# with its own bookkeeping row, so a failure rolls the whole file back and
# leaves no half-applied schema.
#
#   scripts/migrate.sh                      apply everything pending
#   scripts/migrate.sh --dry-run            list what would be applied
#   scripts/migrate.sh --baseline-through F record migrations up to and
#                                           including F as applied, WITHOUT
#                                           running them (for databases that
#                                           were migrated before this script
#                                           existed)
#
# Against the production stack it dumps the database first; dumps land in
# backups/ and the newest KEEP_DUMPS are kept.
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP_DUMPS=10
DRY_RUN=false
BASELINE_THROUGH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --baseline-through)
      BASELINE_THROUGH="${2:-}"
      [ -n "$BASELINE_THROUGH" ] || { echo "--baseline-through needs a filename" >&2; exit 1; }
      shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

psql_db() { docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# The production stack is the one whose compose project has no port overrides —
# identify it by branch instead, which is unambiguous and already enforced by
# deploy-production.sh.
is_production() { [ "$(git symbolic-ref --short HEAD 2>/dev/null || echo '')" = "production" ]; }

if ! docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  echo "The 'db' service is not running in $(pwd) — start it first." >&2
  exit 1
fi

psql_db -q <<'SQL'
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

applied() { psql_db -tAc "SELECT 1 FROM public.schema_migrations WHERE filename = '$1'" | tr -d '[:space:]'; }

# --- baseline mode: record as applied, run nothing -------------------------
if [ -n "$BASELINE_THROUGH" ]; then
  [ -f "supabase/migrations/$BASELINE_THROUGH" ] || {
    echo "No such migration: supabase/migrations/$BASELINE_THROUGH" >&2; exit 1; }
  echo "==> Baselining through $BASELINE_THROUGH (recording only, not executing)"
  for f in supabase/migrations/*.sql; do
    name="$(basename "$f")"
    if [ "$name" \> "$BASELINE_THROUGH" ]; then continue; fi
    if [ "$(applied "$name")" = "1" ]; then
      echo "  already recorded  $name"
    else
      psql_db -q -c "INSERT INTO public.schema_migrations (filename) VALUES ('$name')"
      echo "  recorded          $name"
    fi
  done
  echo "==> Done. Pending migrations are now whatever sorts after $BASELINE_THROUGH."
  exit 0
fi

# --- work out what is pending ----------------------------------------------
pending=()
for f in supabase/migrations/*.sql; do
  name="$(basename "$f")"
  [ "$(applied "$name")" = "1" ] || pending+=("$f")
done

if [ ${#pending[@]} -eq 0 ]; then
  echo "==> Database is up to date; nothing to apply."
  exit 0
fi

echo "==> ${#pending[@]} migration(s) pending:"
for f in "${pending[@]}"; do echo "  - $(basename "$f")"; done

if [ "$DRY_RUN" = true ]; then
  echo "==> --dry-run, stopping here."
  exit 0
fi

# --- back production up before touching it ---------------------------------
if is_production; then
  mkdir -p backups
  dump="backups/prod-$(date -u +%Y%m%dT%H%M%SZ).sql"
  echo "==> Backing production up to $dump"
  docker compose exec -T db pg_dump -U postgres -d postgres > "$dump"
  echo "    $(du -h "$dump" | cut -f1) written"
  # Keep only the newest KEEP_DUMPS.
  ls -1t backups/prod-*.sql 2>/dev/null | tail -n +$((KEEP_DUMPS + 1)) | while read -r old; do
    echo "    pruning $old"; rm -f "$old"
  done
fi

# --- apply ------------------------------------------------------------------
for f in "${pending[@]}"; do
  name="$(basename "$f")"
  echo "==> Applying $name"
  # One transaction per file: the migration and the row recording it either
  # both land or neither does.
  {
    echo "BEGIN;"
    cat "$f"
    echo ""
    echo "INSERT INTO public.schema_migrations (filename) VALUES ('$name');"
    echo "COMMIT;"
  } | psql_db -q
  echo "    ok"
done

# PostgREST caches the schema, so tell it to re-read after DDL. It usually
# picks DDL up on its own via event triggers; this makes it certain.
psql_db -q -c "NOTIFY pgrst, 'reload schema'" || true

echo "==> Applied ${#pending[@]} migration(s)."
