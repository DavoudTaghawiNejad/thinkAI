# thinkAI

Self-hosted TanStack Start app with a self-hosted Supabase stack (Postgres +
GoTrue + PostgREST behind an nginx gateway), all run by Docker Compose. Apache
on the host terminates TLS and reverse-proxies to it.

## Two environments, two directories

This project runs twice on the same host. Which directory you are in decides
which environment you are touching.

| | Development | Production |
|---|---|---|
| Directory | `/root/thinkAIdevelopment` | `/root/thinkAI` |
| Branch | `main` | `production` |
| URL | thinkaidevelopment.taghawi-nejad.de | thinkai.taghawi-nejad.de |
| Host ports | app 3001, gateway 8001 | app 3000, gateway 8000 |
| Containers | `thinkai-dev-*` | `prompt-forge-*` |

**Do all development in `/root/thinkAIdevelopment`.** The production checkout is
for deploying and for applying migrations — nothing else. It carries its own
`CLAUDE.local.md` saying so.

`docker-compose.yml` is one shared file on both branches. Per-environment ports
and container names come from `.env` (gitignored), via `APP_PORT`,
`GATEWAY_PORT` and the `*_CONTAINER_NAME` variables, which **default to the
production values**. Never hardcode environment-specific values into
`docker-compose.yml` — promoting `main` to `production` would carry them over
and break production.

## Deploying

Development — the default target for everyday work:

```bash
cd /root/thinkAIdevelopment
scripts/migrate.sh          # if there are new migrations
docker compose up -d --build thought-refiner
```

Production — only when explicitly asked for:

```bash
cd /root/thinkAIdevelopment && git push origin main:production
cd /root/thinkAI && scripts/deploy-production.sh
```

`deploy-production.sh` pulls `production`, applies pending migrations (dumping
the database first), then rebuilds the app container.

## Database changes

Schema changes are plain SQL files in `supabase/migrations/`, named
`YYYYMMDDHHMMSS_description.sql` so they sort in apply order.

- `scripts/migrate.sh` applies whatever is pending and records it in
  `public.schema_migrations`. Safe to re-run; each file runs in its own
  transaction, so a failure leaves nothing half-applied.
- `scripts/migrate.sh --dry-run` shows what would be applied.
- `scripts/install.sh` is **first install only** and refuses to run against a
  database that already has tables.

Deploys never recreate the `db` container, and Postgres data lives in a named
volume per environment (`thinkai_db-data`, `thinkaidevelopment_db-data`), so
deploying cannot lose data. Only `docker compose down -v` destroys a database.

Write migrations defensively — production has real user data, and a migration
that drops a table or column destroys it for good once applied.

## Config

`config/defaults.yaml` is bind-mounted read-only into the app container, so
editing it takes effect on the next request without a rebuild.
