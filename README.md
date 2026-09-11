# Prompt Forge

An iterative prompt-refinement workbench. A draft prompt is run through a sequence of
user-defined "test steps" — each judged by an AI critic that returns a strict-JSON verdict
(`pass`, `score`, `diagnosis`, and a list of open questions the author must answer, never
rewrite suggestions). Once every step passes, a final AI call answers the fully-refined
prompt directly. A "clarify" call is available as a side-conversation to explain what a
refinement question is asking for.

Critic and final-answer calls go directly to [Anthropic](https://www.anthropic.com/) and
[DeepSeek](https://www.deepseek.com/); which provider is used for which role is chosen per
user in Settings.

Signups are gated by a one-time 8-digit invitation key (deleted from the database the
moment it's used) — see [Invitation keys](#invitation-keys) below.

## Setup

Supabase is self-hosted here — Postgres, GoTrue and PostgREST run as containers from
`docker-compose.yml`, behind an nginx gateway. There is no hosted Supabase project and no
Supabase CLI involved.

1. Install dependencies:
   ```sh
   bun install
   ```
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` to the public URL this
   instance will be reached at, plus your `ANTHROPIC_API_KEY`/`DEEPSEEK_API_KEY`. The
   Postgres password, JWT secret and API keys are generated for you in the next step —
   leave them blank.
3. Run the installer. It generates the secrets, starts Postgres, applies every migration
   and brings up the full stack:
   ```sh
   scripts/install.sh
   ```
   This is **first install only** — it refuses to run against a database that already has
   tables. For an existing environment, see [Database changes](#database-changes).
4. Generate invitation keys and seed them into the database:
   ```sh
   bun run scripts/generate-invite-keys.ts
   docker compose exec -T db psql -U postgres -d postgres < supabase/seed-invite-keys.sql
   ```
   This writes 100 one-time keys to `invite-keys.txt` (gitignored — hand these out to
   invitees) and inserts the same values into the `invite_keys` table.

## Database changes

Schema changes are plain SQL files in `supabase/migrations/`, named
`YYYYMMDDHHMMSS_description.sql` so they apply in order.

```sh
scripts/migrate.sh              # apply everything pending
scripts/migrate.sh --dry-run    # show what would be applied
```

Applied migrations are recorded in `public.schema_migrations`, so the script is safe to
re-run. Each migration runs inside a single transaction along with its bookkeeping row — a
failure rolls the whole file back rather than leaving the schema half-changed. Run against
the production checkout, it dumps the database to `backups/` first.

For a database that was migrated before this script existed, record the already-applied
files without executing them:

```sh
scripts/migrate.sh --baseline-through <migration-filename>
```

Deploys never recreate the `db` container, and each environment's data lives in its own
named volume, so deploying cannot lose data — only `docker compose down -v` destroys a
database.

## Local development

```sh
bun run dev
```

## Deploy

This project runs twice on the same host, one directory per environment:

| | Development | Production |
|---|---|---|
| Directory | `/root/thinkAIdevelopment` | `/root/thinkAI` |
| Branch | `main` | `production` |
| Host ports | app 3001, gateway 8001 | app 3000, gateway 8000 |

Development is the default target for everyday work:

```sh
cd /root/thinkAIdevelopment
docker compose up -d --build thought-refiner
```

Production is promoted explicitly:

```sh
cd /root/thinkAIdevelopment && git push origin main:production
cd /root/thinkAI && scripts/deploy-production.sh
```

`deploy-production.sh` pulls the `production` branch, applies pending migrations (dumping
the database first) and rebuilds the app container. It refuses to run unless that checkout
is on the `production` branch.

`docker-compose.yml` is a single shared file. Per-environment ports and container names
come from `.env` (`APP_PORT`, `GATEWAY_PORT`, `*_CONTAINER_NAME`) and default to the
production values, so environment-specific settings never need to be committed. The image
bakes `VITE_SUPABASE_*` in at build time, since Vite replaces those statically, and the
container binds to localhost only. Put a TLS-terminating reverse proxy in front — see
`deploy/apache-thinkAI.conf` and `deploy/apache-thinkAIdevelopment.conf` for Apache vhost
templates.

`config/defaults.yaml` (critic/final/clarify instructions, default models, the starting
test-step sequence) is bind-mounted read-only into the container — edit it on the host and
the change takes effect on the very next signup or "Reset to defaults" click, no rebuild or
restart needed.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Supabase
