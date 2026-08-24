CREATE TABLE public.invite_keys (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invite_keys ENABLE ROW LEVEL SECURITY;
-- Intentionally zero policies: only the service-role client (which bypasses RLS)
-- may read/write this table. No anon/authenticated access, so keys can't be enumerated.
GRANT ALL ON public.invite_keys TO service_role;
