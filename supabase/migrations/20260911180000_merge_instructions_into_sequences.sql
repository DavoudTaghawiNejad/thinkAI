-- Instructions and the test sequence become one package.
--
-- Before: a profile picked an instruction_presets row (critic + final-answer
-- wording) and a test_sequences row independently, via two dropdowns, two Save
-- paths and two Share actions. Nothing tied a given set of instructions to the
-- tests it was written for, so the pairing a user was actually running existed
-- only as two ids in their settings row.
--
-- After: a test sequence carries its own instructions. One thing to name, pick,
-- edit, save, share, push and copy. A run therefore also takes its instructions
-- from the sequence it pinned at creation, so the wording cannot drift under a
-- run already in flight.
--
-- Defensive: this migration is additive. public.instruction_presets and
-- settings.active_preset_id are LEFT IN PLACE, unread by the application, so
-- that nothing is destroyed if a profile's presets turn out not to map cleanly.
-- Drop them in a later migration once the merged data has been eyeballed in
-- production.

ALTER TABLE public.test_sequences
  ADD COLUMN critic_instruction TEXT NOT NULL DEFAULT '',
  ADD COLUMN final_instruction TEXT NOT NULL DEFAULT '';

-- 1. Every sequence inherits the instructions its owner was actually running —
--    the preset their settings row points at.
UPDATE public.test_sequences q
  SET critic_instruction = p.critic_instruction,
      final_instruction = p.final_instruction
  FROM public.settings s
  JOIN public.instruction_presets p ON p.id = s.active_preset_id
  WHERE q.user_id = s.user_id;

-- 2. A sequence whose owner had no active preset falls back to that owner's
--    oldest preset, if they have one at all.
UPDATE public.test_sequences q
  SET critic_instruction = p.critic_instruction,
      final_instruction = p.final_instruction
  FROM (
    SELECT DISTINCT ON (user_id) user_id, critic_instruction, final_instruction
    FROM public.instruction_presets
    WHERE user_id IS NOT NULL
    ORDER BY user_id, created_at
  ) p
  WHERE q.user_id = p.user_id AND q.critic_instruction = '';

-- 3. Anything still blank — General sequences, and owners with no preset at
--    all — takes the shared General preset.
UPDATE public.test_sequences q
  SET critic_instruction = g.critic_instruction,
      final_instruction = g.final_instruction
  FROM (
    SELECT critic_instruction, final_instruction
    FROM public.instruction_presets
    WHERE user_id IS NULL
    ORDER BY created_at
    LIMIT 1
  ) g
  WHERE q.critic_instruction = '';

-- The application refuses to save empty instructions; the '' default exists
-- only so the ADD COLUMN could be NOT NULL. Anything still blank here means
-- there were no presets to inherit from at all, and the app falls back to
-- config/defaults.yaml at read time.
