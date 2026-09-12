-- Test sequences become two plain kinds, and publishing replaces pushing.
--
-- Before: every profile held its own *copy* of every sequence an admin shared.
-- A push walked all profiles, overwrote untouched copies, parked a "(new)" one
-- behind a rename prompt where the copy had been edited, and stamped the copies
-- with origin_id/origin_fingerprint so the next push could tell edited from
-- untouched. A copy still as delivered was locked read-only. Two pointers
-- (settings.active_sequence_id and settings.default_sequence_id) both claimed
-- to say which sequence a profile was using.
--
-- After, two kinds and nothing else:
--   * General (user_id IS NULL) — one row, visible to every profile, editable by
--     nobody, admins included. An admin changes one by re-publishing the
--     personal sequence it came from.
--   * Personal (user_id = owner) — private, and always freely editable. Editing
--     has no consequences for anyone else; only publishing does.
-- An admin publishes one of their personal sequences into the general set; the
-- general row records where it came from in published_from, so re-publishing
-- updates that same row in place rather than piling up near-duplicates. Keeping
-- the id stable keeps every profile's default pointer and every run started
-- against it attached to a live sequence.
--
-- One general sequence carries is_new_user_default: what a brand-new profile
-- starts pointed at. Any profile may then point settings.default_sequence_id at
-- any sequence it can see — its own or a general one.
--
-- Nothing anyone wrote is deleted here. Copies that were pushed into profiles
-- stay exactly as they are; they simply become ordinary personal sequences,
-- which means their owners can now edit them.

-- ---------------------------------------------------------------------------
-- The two new columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.test_sequences
  -- On a general row: the admin's personal sequence it was published from, so a
  -- re-publish finds it again. NULL on a general row that predates publishing
  -- (adopted by name on the first publish) and on every personal row.
  ADD COLUMN published_from UUID REFERENCES public.test_sequences ON DELETE SET NULL,
  -- On a general row: what a brand-new profile's default points at. Exactly one
  -- row may carry it, and only a general one.
  ADD COLUMN is_new_user_default BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.test_sequences
  ADD CONSTRAINT test_sequences_new_user_default_is_general
  CHECK (NOT is_new_user_default OR user_id IS NULL);

CREATE UNIQUE INDEX test_sequences_one_new_user_default
  ON public.test_sequences (is_new_user_default) WHERE is_new_user_default;

CREATE INDEX test_sequences_published_from ON public.test_sequences (published_from);

-- A general name identifies the sequence for everyone, so it has to be unique
-- among general rows — a re-publish matches on it when published_from is unset.
-- Defensive: disambiguate any pre-existing clash rather than failing the deploy.
UPDATE public.test_sequences q
  SET name = q.name || ' (' || left(q.id::text, 8) || ')'
  WHERE q.user_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.test_sequences o
      WHERE o.user_id IS NULL AND o.name = q.name AND o.created_at < q.created_at
    );

CREATE UNIQUE INDEX test_sequences_general_name
  ON public.test_sequences (name) WHERE user_id IS NULL;

-- ---------------------------------------------------------------------------
-- Carry the new-account designation over: whatever was marked new_user_role
-- 'default', if it is a general row, else the oldest general row. The
-- 'alternative' role has no successor — a new profile starts pointed at one
-- sequence and can see every other general one anyway.
-- ---------------------------------------------------------------------------
UPDATE public.test_sequences
  SET is_new_user_default = true
  WHERE id = (
    SELECT id FROM public.test_sequences
    WHERE user_id IS NULL
    ORDER BY (new_user_role = 'default') DESC NULLS LAST, created_at
    LIMIT 1
  );

-- ---------------------------------------------------------------------------
-- One pointer per profile. default_sequence_id is it; active_sequence_id was
-- the same answer written twice.
-- ---------------------------------------------------------------------------
UPDATE public.settings
  SET default_sequence_id = active_sequence_id
  WHERE default_sequence_id IS NULL AND active_sequence_id IS NOT NULL;

-- A profile with neither starts where a new profile does.
UPDATE public.settings
  SET default_sequence_id = (
    SELECT id FROM public.test_sequences WHERE is_new_user_default LIMIT 1
  )
  WHERE default_sequence_id IS NULL;

ALTER TABLE public.settings DROP COLUMN active_sequence_id;

-- ---------------------------------------------------------------------------
-- The push machinery goes. Pending prompts go with it: both sides of every
-- conflict are real sequences in the user's own library and are left in place,
-- theirs under its own name and the published one under "… (new)". They are
-- ordinary personal sequences now — rename or delete at will.
-- ---------------------------------------------------------------------------
DROP TABLE public.sequence_push_conflicts;

ALTER TABLE public.test_sequences
  DROP COLUMN origin_id,             -- which general row a copy came from
  DROP COLUMN origin_fingerprint,    -- and what it looked like as delivered
  DROP COLUMN new_user_role,         -- superseded by is_new_user_default
  DROP COLUMN is_default,            -- superseded by settings.default_sequence_id
  DROP COLUMN archived_at;           -- the "(old)" keepsake mark, unread since 20260912090000
