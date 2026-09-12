-- Questions the author has deliberately left open.
--
-- The critic returns refinement items as open questions, and until now the only
-- way to deal with one was to answer it in the draft. Some are deliberately not
-- worth answering — the author *wants* that part left open — but the critic had
-- no way to know, so it kept deducting for them and kept re-asking them.
--
-- Marking one is a property of the whole run, not of the iteration that produced
-- it: a mark has to outlive that iteration and be carried into every later
-- submission, across all tests in the sequence. runs is the only row with
-- exactly that lifetime, so the list lives here.
--
-- Questions have no stable identity — they are plain strings in an untyped JSONB
-- array on iterations — so a mark is keyed by the question text. That is also
-- the wanted behaviour: when the critic re-asks the same question verbatim, it
-- stays marked.
--
-- Additive: existing rows get an empty list, and the "own runs" RLS policy
-- already scopes this column to its owner.

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS open_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
