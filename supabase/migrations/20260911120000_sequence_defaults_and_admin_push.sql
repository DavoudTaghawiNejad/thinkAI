-- Per-profile default sequences, per-run sequence choice, and admin push.
--
-- Before: a profile could own many test sequences, but exactly one was in force
-- at a time (settings.active_sequence_id), reachable only from the Settings
-- dialog, and a run resolved its steps from whatever was active *right now* —
-- so switching sequences changed the shape of a run already in flight. Shared
-- "General" sequences (user_id IS NULL) were read-only references; an admin
-- improving one reached nobody.
--
-- After: each profile marks one sequence as its default, every run records the
-- sequence it actually used, and an admin can push a General sequence into
-- every profile. A profile's untouched copy is superseded (the previous version
-- kept as "<name> (old)" — still fully usable, just labelled); a copy the user
-- edited is never overwritten, and instead raises a rename prompt on their next
-- visit.
--
-- Additive only: no drops, no destructive rewrites. Existing behaviour is
-- preserved by backfilling defaults from settings.active_sequence_id.

-- ---------------------------------------------------------------------------
-- test_sequences: default flag, new-user roles, push provenance.
-- ---------------------------------------------------------------------------
ALTER TABLE public.test_sequences
  -- The profile's default: what the home-page sequence picker pre-selects.
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false,
  -- Only meaningful on global rows (user_id IS NULL): what a brand-new account
  -- is seeded with. 'default' becomes their active sequence, 'alternative' is
  -- copied in alongside it.
  ADD COLUMN new_user_role TEXT,
  -- The global sequence this copy was pushed from, and a fingerprint of the
  -- content as it was pushed. Together they answer "has the user edited their
  -- copy since we gave it to them?" — the question the push turns on.
  ADD COLUMN origin_id UUID REFERENCES public.test_sequences ON DELETE SET NULL,
  ADD COLUMN origin_fingerprint TEXT,
  -- Set on the "<name> (old)" copy kept when a push supersedes an untouched
  -- one. A label and a bookkeeping key, NOT a hide flag: an archived sequence
  -- stays listed, selectable for a run, editable, and can be the default. It
  -- only means "this is the one superseded copy a later push may clear away" —
  -- and saving or renaming it clears the flag, so edited work is never cleared.
  ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE public.test_sequences
  ADD CONSTRAINT test_sequences_new_user_role_check
  CHECK (new_user_role IS NULL OR new_user_role IN ('default', 'alternative'));

-- One default per profile. Archived copies are eligible, so no filter on them.
CREATE UNIQUE INDEX test_sequences_one_default_per_user
  ON public.test_sequences (user_id) WHERE is_default;

-- At most one new-user default and one new-user alternative, globally.
CREATE UNIQUE INDEX test_sequences_one_new_user_role
  ON public.test_sequences (new_user_role)
  WHERE user_id IS NULL AND new_user_role IS NOT NULL;

CREATE INDEX test_sequences_origin ON public.test_sequences (origin_id);

-- ---------------------------------------------------------------------------
-- runs: the sequence this run is using, fixed at creation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.runs
  ADD COLUMN sequence_id UUID REFERENCES public.test_sequences ON DELETE SET NULL;

-- Existing runs keep the steps they have been running against.
UPDATE public.runs r
  SET sequence_id = s.active_sequence_id
  FROM public.settings s
  WHERE s.user_id = r.user_id AND r.sequence_id IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill defaults, so nobody's behaviour changes on deploy: whatever each
-- profile has active today becomes its default. A profile whose active
-- sequence is a General one gets no default and keeps falling back to
-- active_sequence_id (see resolveDefaultSequenceId in src/lib/sequences.server.ts).
-- ---------------------------------------------------------------------------
UPDATE public.test_sequences q
  SET is_default = true
  FROM public.settings s
  WHERE s.active_sequence_id = q.id AND q.user_id = s.user_id;

-- ---------------------------------------------------------------------------
-- The General "Default" sequence seeded by
-- 20260901000000_instruction_presets_and_sequences.sql becomes what new
-- accounts start with. No alternative is designated yet; an admin marks one in
-- the Settings dialog.
-- ---------------------------------------------------------------------------
UPDATE public.test_sequences
  SET new_user_role = 'default'
  WHERE id = '00000000-0000-0000-0000-0000000000d1' AND user_id IS NULL;

-- ---------------------------------------------------------------------------
-- sequence_push_conflicts: one pending "please rename yours" prompt, raised
-- when a push finds a copy the user has edited. Resolved from a dialog on the
-- user's next visit — never by overwriting their work.
-- ---------------------------------------------------------------------------
CREATE TABLE public.sequence_push_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  -- The user's edited sequence, kept as-is.
  mine_id UUID NOT NULL REFERENCES public.test_sequences ON DELETE CASCADE,
  -- The pushed version, parked under "<name> (new)" until the user chooses.
  incoming_id UUID NOT NULL REFERENCES public.test_sequences ON DELETE CASCADE,
  -- The canonical name both are contending for.
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, mine_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sequence_push_conflicts TO authenticated;
GRANT ALL ON public.sequence_push_conflicts TO service_role;
ALTER TABLE public.sequence_push_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own push conflicts" ON public.sequence_push_conflicts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX sequence_push_conflicts_user ON public.sequence_push_conflicts (user_id);
