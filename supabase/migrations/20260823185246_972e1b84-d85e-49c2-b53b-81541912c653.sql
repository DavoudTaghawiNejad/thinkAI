CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  critic_instruction TEXT NOT NULL DEFAULT 'You are a rigorous prompt reviewer. You evaluate a single draft prompt against one named test.

CRITICAL OUTPUT RULE: every refinement you return MUST be phrased as an open question that the author has to answer. Never propose replacement wording, never rewrite the prompt, never give imperative advice. Ask, do not suggest. Each item must end with a question mark.

Be concise and concrete. Judge only the named test, nothing else.',
  critic_model TEXT NOT NULL DEFAULT 'openai/gpt-5.6-luna',
  final_model TEXT NOT NULL DEFAULT 'openai/gpt-5.5-pro',
  debug_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.test_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instruction TEXT NOT NULL,
  pass_threshold INTEGER NOT NULL DEFAULT 80,
  max_iterations INTEGER NOT NULL DEFAULT 4,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_steps TO authenticated;
GRANT ALL ON public.test_steps TO service_role;
ALTER TABLE public.test_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own steps" ON public.test_steps FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX test_steps_user_pos ON public.test_steps (user_id, position);

CREATE TABLE public.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled prompt',
  original_prompt TEXT NOT NULL,
  current_prompt TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'refining',
  final_answer TEXT,
  final_model TEXT,
  final_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs" ON public.runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.runs ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  iteration_number INTEGER NOT NULL,
  prompt_snapshot TEXT NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT false,
  score INTEGER,
  diagnosis TEXT,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  skipped BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.iterations TO authenticated;
GRANT ALL ON public.iterations TO service_role;
ALTER TABLE public.iterations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own iterations" ON public.iterations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX iterations_run ON public.iterations (run_id, created_at);

CREATE TABLE public.ai_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.runs ON DELETE CASCADE,
  iteration_id UUID REFERENCES public.iterations ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  system_text TEXT NOT NULL DEFAULT '',
  user_text TEXT NOT NULL DEFAULT '',
  request_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_response TEXT,
  error_text TEXT,
  latency_ms INTEGER,
  run_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_calls TO authenticated;
GRANT ALL ON public.ai_calls TO service_role;
ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai calls" ON public.ai_calls FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ai_calls_run ON public.ai_calls (run_id, created_at);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.settings (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.test_steps (user_id, name, description, instruction, pass_threshold, max_iterations, position)
  VALUES
    (NEW.id, 'Clarity', 'Is the problem stated plainly and unambiguously?',
     'Test the draft prompt for CLARITY. Can a competent stranger understand exactly what is being asked, in one reading, without guessing? Identify every place where meaning is fuzzy, over-compressed, or hidden behind jargon.', 80, 4, 0),
    (NEW.id, 'Scope & Boundaries', 'Is it clear what is in scope and what is not?',
     'Test the draft prompt for SCOPE AND BOUNDARIES. Is it clear what the answer should cover and, just as importantly, what it should leave out? Identify missing limits of time, domain, depth, audience, or format.', 80, 4, 1),
    (NEW.id, 'Ambiguity & Assumptions', 'Which unstated assumptions are being smuggled in?',
     'Test the draft prompt for AMBIGUITY AND HIDDEN ASSUMPTIONS. Which terms could be read in more than one way? Which premises are asserted without being examined? Surface each one.', 80, 4, 2),
    (NEW.id, 'Context Sufficiency', 'Does the AI have enough background to answer well?',
     'Test the draft prompt for CONTEXT SUFFICIENCY. Does it supply the background, constraints, data, and prior attempts a strong answer would need? Identify each missing piece of context.', 80, 4, 3),
    (NEW.id, 'Evaluability', 'How will a good answer be recognised?',
     'Test the draft prompt for EVALUABILITY. Does it state how the author will judge whether the answer is good? Identify missing success criteria, required form of evidence, or acceptance conditions.', 80, 4, 4);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER runs_touch BEFORE UPDATE ON public.runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER settings_touch BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();