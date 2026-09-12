-- A personal sequence may not share a general sequence's name.
--
-- The old push gave every profile its own copy of every shared sequence, so
-- after 20260912170000 turned those copies into ordinary personal sequences,
-- most people are left holding a private "Default" next to the general
-- "Default" — two entries, the same name, one of them a stale snapshot of the
-- other. The name is how a sequence is recognised, so the duplicates go.
--
-- Destructive, deliberately: these rows and their steps are deleted. Before
-- that, everything pointing at one is moved to the general sequence of the same
-- name, so no profile loses its default and no run is cut loose from its tests.
--
-- One exception: a personal sequence that a general sequence was published from
-- is kept. It is not a duplicate — it is the editable original, and the only
-- way to update the general version is to publish it again. Deleting it would
-- strand the general row with nothing behind it.

-- The duplicates, resolved once so every statement below acts on the same set.
CREATE TEMP TABLE dropped_copies ON COMMIT DROP AS
SELECT p.id, g.id AS general_id
FROM public.test_sequences p
JOIN public.test_sequences g ON g.user_id IS NULL AND g.name = p.name
WHERE p.user_id IS NOT NULL
  -- Keep the original a general sequence was published from.
  AND NOT EXISTS (
    SELECT 1 FROM public.test_sequences pub
    WHERE pub.user_id IS NULL AND pub.published_from = p.id
  );

-- A profile defaulting to its copy now defaults to the general sequence itself.
UPDATE public.settings s
  SET default_sequence_id = d.general_id
  FROM dropped_copies d
  WHERE s.default_sequence_id = d.id;

-- A run keeps running against the same tests, now read from the general row.
-- (Without this the FK would null it out and the run would fall back to
-- whatever new profiles start with — a different sequence mid-run.)
UPDATE public.runs r
  SET sequence_id = d.general_id
  FROM dropped_copies d
  WHERE r.sequence_id = d.id;

-- Steps go with them (test_sequence_steps.sequence_id is ON DELETE CASCADE).
DELETE FROM public.test_sequences p USING dropped_copies d WHERE p.id = d.id;
