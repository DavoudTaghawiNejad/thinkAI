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

1. Install dependencies:
   ```sh
   bun install
   ```
2. Create a Supabase project (dashboard or `supabase projects create`), then apply the
   migrations in `supabase/migrations/`:
   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. Copy `.env.example` to `.env` and fill in your Supabase URL/keys (Project Settings →
   API) and your `ANTHROPIC_API_KEY`/`DEEPSEEK_API_KEY`.
4. Generate invitation keys and seed them into the database:
   ```sh
   bun run scripts/generate-invite-keys.ts
   supabase db execute -f supabase/seed-invite-keys.sql
   ```
   This writes 100 one-time keys to `invite-keys.txt` (gitignored — hand these out to
   invitees) and inserts the same values into the `invite_keys` table.

## Local development

```sh
bun run dev
```

## Deploy

Build and run as a plain Node server (no platform lock-in):

```sh
bun run build
node .output/server/index.mjs
```

Or via Docker:

```sh
docker compose up -d --build
```

`docker-compose.yml` builds the image (baking `VITE_SUPABASE_*` in at build time, since
Vite replaces those statically) and binds the container to `127.0.0.1:3000` only. Put a
TLS-terminating reverse proxy in front of it — see `deploy/apache-thinkAI.conf` for an
Apache vhost template.

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
