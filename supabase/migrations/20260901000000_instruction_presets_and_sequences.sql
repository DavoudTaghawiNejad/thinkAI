-- Named model-instruction presets and test sequences.
--
-- Before: one critic instruction per user (settings.critic_instruction), one
-- test sequence per user (test_steps rows), and a final-answer instruction that
-- only lived in config/defaults.yaml. After: users keep libraries of both,
-- pick one of each as active, and can also pick admin-provided "global" ones
-- (rows with user_id IS NULL).

-- ---------------------------------------------------------------------------
-- instruction_presets: critic + final-answer instruction, named.
-- ---------------------------------------------------------------------------
CREATE TABLE public.instruction_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,   -- NULL = global/admin preset
  name TEXT NOT NULL,
  critic_instruction TEXT NOT NULL,
  final_instruction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instruction_presets TO authenticated;
GRANT ALL ON public.instruction_presets TO service_role;
ALTER TABLE public.instruction_presets ENABLE ROW LEVEL SECURITY;
-- Everyone may read their own presets and the global ones.
CREATE POLICY "read own or global presets" ON public.instruction_presets
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR user_id IS NULL);
-- Only the owner may write, and only rows they own — global rows (user_id IS
-- NULL) are unwritable by authenticated and are managed by the service-role
-- client after an admin check in application code.
CREATE POLICY "insert own presets" ON public.instruction_presets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own presets" ON public.instruction_presets
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete own presets" ON public.instruction_presets
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX instruction_presets_user ON public.instruction_presets (user_id);
CREATE TRIGGER instruction_presets_touch BEFORE UPDATE ON public.instruction_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- test_sequences + test_sequence_steps: replaces the per-user test_steps table.
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,   -- NULL = global/admin sequence
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_sequences TO authenticated;
GRANT ALL ON public.test_sequences TO service_role;
ALTER TABLE public.test_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own or global sequences" ON public.test_sequences
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY "insert own sequences" ON public.test_sequences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own sequences" ON public.test_sequences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete own sequences" ON public.test_sequences
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX test_sequences_user ON public.test_sequences (user_id);
CREATE TRIGGER test_sequences_touch BEFORE UPDATE ON public.test_sequences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.test_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES public.test_sequences ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instruction TEXT NOT NULL,
  pass_threshold INTEGER NOT NULL DEFAULT 80,
  max_iterations INTEGER NOT NULL DEFAULT 4,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_sequence_steps TO authenticated;
GRANT ALL ON public.test_sequence_steps TO service_role;
ALTER TABLE public.test_sequence_steps ENABLE ROW LEVEL SECURITY;
-- Readable when the parent sequence is readable (own or global).
CREATE POLICY "read steps of readable sequence" ON public.test_sequence_steps
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.test_sequences s
      WHERE s.id = sequence_id AND (s.user_id = auth.uid() OR s.user_id IS NULL)
    )
  );
-- Writable only when the parent sequence is owned by the caller.
CREATE POLICY "write steps of own sequence" ON public.test_sequence_steps
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.test_sequences s WHERE s.id = sequence_id AND s.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.test_sequences s WHERE s.id = sequence_id AND s.user_id = auth.uid())
  );
CREATE INDEX test_sequence_steps_seq_pos ON public.test_sequence_steps (sequence_id, position);

-- ---------------------------------------------------------------------------
-- settings: point at the active preset/sequence; critic_instruction moves out.
-- ---------------------------------------------------------------------------
ALTER TABLE public.settings
  ADD COLUMN active_preset_id UUID REFERENCES public.instruction_presets ON DELETE SET NULL,
  ADD COLUMN active_sequence_id UUID REFERENCES public.test_sequences ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- profiles: admin flag (global presets/sequences are managed by admins).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Seed the global "Default" preset + sequence (snapshot of config/defaults.yaml
-- at the time of this migration; admins can edit these rows afterwards).
-- ---------------------------------------------------------------------------
INSERT INTO public.instruction_presets (id, user_id, name, critic_instruction, final_instruction)
VALUES (
  '00000000-0000-0000-0000-0000000000c1', NULL, 'Default',
  'You are a rigorous prompt reviewer. You evaluate a single draft prompt against one named test.
CRITICAL OUTPUT RULE: every refinement you return MUST be phrased as an open question that the author has to answer. Never propose replacement wording, never rewrite the prompt. Ask, do not suggest. Each item must end with a question mark.

SEARCHABLE FACTS: Never ask for facts that are publicly searchable or inferable from something the author already named. If an event, work, product, person, place, company or law is identified, the answering model can look up its date, location, author or other public attributes — do not require the author to supply them. Ask only in case of meaningful ambiguity or for information that lives with the author: intent, constraints, audience, context, preferences, scope, success criteria.

Be concise and concrete. Judge only the named test, nothing else.',
  'You are answering a prompt that has been deliberately refined through a sequence of quality tests. Answer it directly, thoroughly and honestly. Where the prompt states success criteria, meet them explicitly.'
);

INSERT INTO public.test_sequences (id, user_id, name)
VALUES ('00000000-0000-0000-0000-0000000000d1', NULL, 'Default');

INSERT INTO public.test_sequence_steps (sequence_id, name, description, instruction, pass_threshold, max_iterations, position)
VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Clarity & Ambiguity',
   'Is the problem stated plainly and unambiguously?',
   'Test the draft prompt for CLARITY. Can a competent stranger understand exactly what is being asked, in one reading, without guessing? Identify every place where meaning is fuzzy, over-compressed, or hidden behind jargon. Which terms could be read in more than one way?',
   80, 4, 0),
  ('00000000-0000-0000-0000-0000000000d1', 'Scope & Boundaries',
   'Is it clear what is in scope and what is not?',
   'Test the draft prompt for SCOPE AND BOUNDARIES. Is it clear what the answer should cover and, just as importantly, what it should leave out?',
   60, 2, 1),
  ('00000000-0000-0000-0000-0000000000d1', 'Assumptions',
   'Which unstated assumptions are being smuggled in?',
   'Test the draft prompt for HIDDEN ASSUMPTIONS. Which premises are asserted without being examined? Surface each one.',
   80, 4, 2),
  ('00000000-0000-0000-0000-0000000000d1', 'Context Sufficiency',
   'Does the AI have enough background to answer well?',
   'Test the draft prompt for CONTEXT SUFFICIENCY. Does it supply the background, constraints, data, and prior attempts a strong answer would need? Identify each missing piece of context.',
   80, 4, 3),
  ('00000000-0000-0000-0000-0000000000d1', 'Structure',
   'Is the prompt itself well organised and readable?',
   'Test the draft prompt for STRUCTURE. Is the text well structured and readable? Is the structure a useful prompt and a good basis for a one-shot answer.',
   80, 4, 4);

-- ---------------------------------------------------------------------------
-- Migrate every existing user: personal preset + sequence from their current
-- settings.critic_instruction / test_steps, then point settings at them.
-- ---------------------------------------------------------------------------
INSERT INTO public.instruction_presets (user_id, name, critic_instruction, final_instruction)
SELECT
  s.user_id, 'My instructions', s.critic_instruction,
  'You are answering a prompt that has been deliberately refined through a sequence of quality tests. Answer it directly, thoroughly and honestly. Where the prompt states success criteria, meet them explicitly.'
FROM public.settings s;

INSERT INTO public.test_sequences (user_id, name)
SELECT DISTINCT user_id, 'My sequence' FROM public.settings;

INSERT INTO public.test_sequence_steps (sequence_id, name, description, instruction, pass_threshold, max_iterations, position)
SELECT seq.id, t.name, t.description, t.instruction, t.pass_threshold, t.max_iterations, t.position
FROM public.test_steps t
JOIN public.test_sequences seq ON seq.user_id = t.user_id AND seq.name = 'My sequence';

UPDATE public.settings s SET
  active_preset_id = (
    SELECT p.id FROM public.instruction_presets p
    WHERE p.user_id = s.user_id AND p.name = 'My instructions' LIMIT 1
  ),
  active_sequence_id = (
    SELECT q.id FROM public.test_sequences q
    WHERE q.user_id = s.user_id AND q.name = 'My sequence' LIMIT 1
  );

-- A user with no test_steps at all still gets a (step-less) sequence above;
-- the app tops it up from config/defaults.yaml on next load if empty.

-- ---------------------------------------------------------------------------
-- Drop the superseded structures.
-- ---------------------------------------------------------------------------
DROP TABLE public.test_steps;
ALTER TABLE public.settings DROP COLUMN critic_instruction;

-- ---------------------------------------------------------------------------
-- Bootstrap admin(s). Keep in sync with admin_emails in config/defaults.yaml;
-- the app also promotes any admin_emails member on next load.
-- ---------------------------------------------------------------------------
UPDATE public.profiles p SET is_admin = true
FROM auth.users u
WHERE u.id = p.id AND u.email = 'davoud@taghawi-nejad.de';
