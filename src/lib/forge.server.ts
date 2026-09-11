import { runModelRequest, ProviderError } from "./ai-providers.server";
import { loadDefaultsConfig } from "./defaults-config.server";
import {
  buildCriticUserText,
  VERDICT_SCHEMA,
  type Settings,
  type TestStep,
  type Verdict,
  type RunRow,
  type IterationRow,
  type AiCallRow,
} from "./forge.shared";

type Client = {
  from: (table: string) => any;
};

const STEP_COLUMNS = "id, name, description, instruction, pass_threshold, max_iterations, position";

type SettingsRow = {
  critic_model: string;
  final_model: string;
  debug_mode: boolean;
  active_preset_id: string | null;
  active_sequence_id: string | null;
};

/**
 * Create a user's personal "My instructions" preset + "My sequence" sequence
 * from config/defaults.yaml and a settings row pointing at them. Idempotent-ish:
 * only called when no settings row exists yet (fresh signup, or a legacy user
 * the migration somehow missed).
 */
async function provisionWorkspace(supabase: Client, userId: string): Promise<SettingsRow> {
  const config = await loadDefaultsConfig();

  const { data: preset, error: presetErr } = await supabase
    .from("instruction_presets")
    .insert({
      user_id: userId,
      name: "My instructions",
      critic_instruction: config.critic_instruction,
      final_instruction: config.final_instructions,
    })
    .select("id")
    .single();
  if (presetErr) throw new Error(presetErr.message);

  const { data: sequence, error: seqErr } = await supabase
    .from("test_sequences")
    .insert({ user_id: userId, name: "My sequence" })
    .select("id")
    .single();
  if (seqErr) throw new Error(seqErr.message);

  const { error: stepsErr } = await supabase.from("test_sequence_steps").insert(
    config.test_steps.map((step, position) => ({ sequence_id: sequence.id, position, ...step })),
  );
  if (stepsErr) throw new Error(stepsErr.message);

  const row: SettingsRow = {
    critic_model: config.critic_model,
    final_model: config.final_model,
    debug_mode: config.debug_mode,
    active_preset_id: preset.id,
    active_sequence_id: sequence.id,
  };
  const { error: settingsErr } = await supabase
    .from("settings")
    .insert({ user_id: userId, ...row });
  if (settingsErr) throw new Error(settingsErr.message);
  return row;
}

async function loadSettingsRow(supabase: Client, userId: string): Promise<SettingsRow> {
  const { data, error } = await supabase
    .from("settings")
    .select("critic_model, final_model, debug_mode, active_preset_id, active_sequence_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as SettingsRow;
  return provisionWorkspace(supabase, userId);
}

/** Resolve the active preset's instruction text, falling back to global "Default". */
async function loadActivePreset(
  supabase: Client,
  activePresetId: string | null,
): Promise<{ critic_instruction: string; final_instruction: string }> {
  if (activePresetId) {
    const { data } = await supabase
      .from("instruction_presets")
      .select("critic_instruction, final_instruction")
      .eq("id", activePresetId)
      .maybeSingle();
    if (data) return data as { critic_instruction: string; final_instruction: string };
  }
  const { data: fallback } = await supabase
    .from("instruction_presets")
    .select("critic_instruction, final_instruction")
    .is("user_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fallback) return fallback as { critic_instruction: string; final_instruction: string };
  const config = await loadDefaultsConfig();
  return {
    critic_instruction: config.critic_instruction,
    final_instruction: config.final_instructions,
  };
}

export async function loadSettings(supabase: Client, userId: string): Promise<Settings> {
  const row = await loadSettingsRow(supabase, userId);
  const preset = await loadActivePreset(supabase, row.active_preset_id);
  return {
    critic_instruction: preset.critic_instruction,
    final_instruction: preset.final_instruction,
    critic_model: row.critic_model,
    final_model: row.final_model,
    debug_mode: row.debug_mode,
    active_preset_id: row.active_preset_id,
    active_sequence_id: row.active_sequence_id,
  };
}

/** The steps of the user's active sequence, in order. */
export async function loadSteps(supabase: Client, userId: string): Promise<TestStep[]> {
  const row = await loadSettingsRow(supabase, userId);
  return loadSequenceSteps(supabase, row.active_sequence_id);
}

async function loadSequenceSteps(
  supabase: Client,
  sequenceId: string | null,
): Promise<TestStep[]> {
  let seqId = sequenceId;
  if (!seqId) {
    const { data: fallback } = await supabase
      .from("test_sequences")
      .select("id")
      .is("user_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    seqId = fallback?.id ?? null;
  }
  if (!seqId) return [];
  const { data, error } = await supabase
    .from("test_sequence_steps")
    .select(STEP_COLUMNS)
    .eq("sequence_id", seqId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TestStep[];
}

type PresetRow = {
  id: string;
  name: string;
  critic_instruction: string;
  final_instruction: string;
  user_id: string | null;
};

type SequenceRow = {
  id: string;
  name: string;
  user_id: string | null;
  test_sequence_steps: TestStep[] | null;
};

/** Own + global presets, newest own first, for the Settings dialog. */
export async function loadPresets(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("instruction_presets")
    .select("id, name, critic_instruction, final_instruction, user_id")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PresetRow[]).map((p) => ({
    id: p.id,
    name: p.name,
    critic_instruction: p.critic_instruction,
    final_instruction: p.final_instruction,
    owned: p.user_id === userId,
  }));
}

/** Own + global sequences with their steps, for the Settings dialog. */
export async function loadSequences(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("test_sequences")
    .select(`id, name, user_id, test_sequence_steps (${STEP_COLUMNS})`)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SequenceRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    owned: s.user_id === userId,
    steps: [...(s.test_sequence_steps ?? [])].sort((a, b) => a.position - b.position),
  }));
}

export async function loadRun(supabase: Client, userId: string, runId: string) {
  const [runRes, iterRes, steps, settings] = await Promise.all([
    supabase.from("runs").select("*").eq("id", runId).eq("user_id", userId).maybeSingle(),
    supabase
      .from("iterations")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
    loadSteps(supabase, userId),
    loadSettings(supabase, userId),
  ]);
  if (runRes.error) throw new Error(runRes.error.message);
  if (!runRes.data) throw new Error("Run not found");
  if (iterRes.error) throw new Error(iterRes.error.message);

  let aiCalls: AiCallRow[] = [];
  if (settings.debug_mode) {
    const { data } = await supabase
      .from("ai_calls")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    aiCalls = (data ?? []) as AiCallRow[];
  }

  return {
    run: runRes.data as RunRow,
    iterations: (iterRes.data ?? []) as IterationRow[],
    steps,
    settings,
    aiCalls,
  };
}

/** Thrown when the critic's reply can't be read as the verdict JSON. */
class VerdictParseError extends Error {}

/**
 * Pull the first balanced { … } object out of a string, ignoring braces inside
 * string literals. DeepSeek's json_object mode guarantees valid JSON syntax but
 * not that it's unwrapped, so this recovers the verdict if the model prefixes a
 * stray token. Returns the slice from the first "{" on if unbalanced so
 * JSON.parse throws a useful error.
 */
function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString && ch === "{") {
      depth++;
    } else if (!inString && ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

function parseVerdict(text: string): Verdict {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  let parsed: Verdict;
  try {
    parsed = JSON.parse(cleaned) as Verdict;
  } catch {
    try {
      parsed = JSON.parse(extractJsonObject(cleaned)) as Verdict;
    } catch {
      throw new VerdictParseError(
        cleaned
          ? "The reviewer's reply was not valid JSON."
          : "The reviewer returned an empty reply.",
      );
    }
  }
  return {
    pass: Boolean(parsed.pass),
    score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
    diagnosis: String(parsed.diagnosis ?? ""),
    questions: Array.isArray(parsed.questions) ? parsed.questions.map(String) : [],
  };
}

export async function runReview(
  supabase: Client,
  userId: string,
  input: { runId: string; prompt: string },
) {
  const { run, steps, settings } = await loadRun(supabase, userId, input.runId);
  const stepIndex: number = run.step_index;
  const step = steps[stepIndex];
  if (!step) throw new Error("No test step at the current position.");

  const { count } = await supabase
    .from("iterations")
    .select("id", { count: "exact", head: true })
    .eq("run_id", input.runId)
    .eq("step_index", stepIndex)
    .eq("skipped", false);
  const iterationNumber = (count ?? 0) + 1;

  const systemText = settings.critic_instruction;
  const userText = buildCriticUserText({
    stepName: step.name,
    stepDescription: step.description,
    stepInstruction: step.instruction,
    stepIndex,
    stepCount: steps.length,
    iteration: iterationNumber,
    maxIterations: step.max_iterations,
    passThreshold: step.pass_threshold,
    prompt: input.prompt,
  });

  // The critic returns a strict-JSON verdict against a fixed rubric — it does not
  // need a chain-of-thought, and on DeepSeek v4 (a reasoning model) CoT tokens
  // count against max_tokens, so leaving it on made the answer intermittently run
  // out of budget and truncate. "none" keeps the whole budget for the JSON.
  const criticReasoning = "none" as const;
  const requestParams = {
    stream: true,
    reasoningEffort: criticReasoning,
    responseFormat: "json_schema",
  };

  let verdict: Verdict;
  let raw = "";
  let latency = 0;
  let runRef: string | undefined;
  try {
    const result = await runModelRequest({
      model: settings.critic_model,
      instructions: systemText,
      input: userText,
      reasoningEffort: criticReasoning,
      jsonSchema: {
        name: "verdict",
        schema: VERDICT_SCHEMA as unknown as Record<string, unknown>,
      },
    });
    raw = result.text;
    latency = result.latencyMs;
    runRef = result.runId;
    verdict = parseVerdict(result.text);
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : (error as Error).message;
    await supabase.from("ai_calls").insert({
      run_id: input.runId,
      user_id: userId,
      kind: "critic",
      model: settings.critic_model,
      system_text: systemText,
      user_text: userText,
      request_params: requestParams,
      raw_response: raw || null,
      error_text: message,
    });
    throw new Error(message);
  }

  const maxed = iterationNumber >= step.max_iterations;
  const advance = verdict.pass || maxed;

  const { data: iteration, error: iterError } = await supabase
    .from("iterations")
    .insert({
      run_id: input.runId,
      user_id: userId,
      step_index: stepIndex,
      step_name: step.name,
      iteration_number: iterationNumber,
      prompt_snapshot: input.prompt,
      passed: verdict.pass,
      score: verdict.score,
      diagnosis: verdict.diagnosis,
      questions: verdict.questions,
      skipped: false,
    })
    .select("*")
    .single();
  if (iterError) throw new Error(iterError.message);

  await supabase.from("ai_calls").insert({
    run_id: input.runId,
    iteration_id: iteration.id,
    user_id: userId,
    kind: "critic",
    model: settings.critic_model,
    system_text: systemText,
    user_text: userText,
    request_params: requestParams,
    raw_response: raw,
    latency_ms: latency,
    run_ref: runRef ?? null,
  });

  const nextIndex = advance ? stepIndex + 1 : stepIndex;
  const done = nextIndex >= steps.length;
  await supabase
    .from("runs")
    .update({
      current_prompt: input.prompt,
      step_index: Math.min(nextIndex, steps.length),
      status: done ? "ready" : "refining",
    })
    .eq("id", input.runId)
    .eq("user_id", userId);

  return {
    verdict,
    iterationNumber,
    advanced: advance,
    reachedEnd: done,
    reason: verdict.pass ? "pass" : maxed ? "max_iterations" : null,
  };
}

export async function skipStep(
  supabase: Client,
  userId: string,
  input: { runId: string; prompt: string },
) {
  const { run, steps } = await loadRun(supabase, userId, input.runId);
  const stepIndex: number = run.step_index;
  const step = steps[stepIndex];
  if (!step) throw new Error("No test step at the current position.");

  const { count } = await supabase
    .from("iterations")
    .select("id", { count: "exact", head: true })
    .eq("run_id", input.runId)
    .eq("step_index", stepIndex);

  await supabase.from("iterations").insert({
    run_id: input.runId,
    user_id: userId,
    step_index: stepIndex,
    step_name: step.name,
    iteration_number: (count ?? 0) + 1,
    prompt_snapshot: input.prompt,
    passed: false,
    skipped: true,
    questions: [],
    diagnosis: "Skipped by the author.",
  });

  const nextIndex = stepIndex + 1;
  const done = nextIndex >= steps.length;
  await supabase
    .from("runs")
    .update({
      current_prompt: input.prompt,
      step_index: nextIndex,
      status: done ? "ready" : "refining",
    })
    .eq("id", input.runId)
    .eq("user_id", userId);

  return { reachedEnd: done };
}

export async function runFinal(supabase: Client, userId: string, input: { runId: string }) {
  const { run, settings } = await loadRun(supabase, userId, input.runId);
  const prompt: string = run.current_prompt;
  const finalInstructions = settings.final_instruction;

  const requestParams = {
    stream: true,
    reasoningEffort: "medium",
  };

  try {
    const result = await runModelRequest({
      model: settings.final_model,
      instructions: finalInstructions,
      input: prompt,
      reasoningEffort: "medium",
    });

    await supabase.from("ai_calls").insert({
      run_id: input.runId,
      user_id: userId,
      kind: "final",
      model: settings.final_model,
      system_text: finalInstructions,
      user_text: prompt,
      request_params: requestParams,
      raw_response: result.text,
      latency_ms: result.latencyMs,
      run_ref: result.runId ?? null,
    });

    const answer = result.text.trim() || result.reasoning.trim() || "The model returned no text.";
    await supabase
      .from("runs")
      .update({
        final_answer: answer,
        final_model: settings.final_model,
        final_prompt: prompt,
        status: "answered",
      })
      .eq("id", input.runId)
      .eq("user_id", userId);

    return { answer, model: settings.final_model };
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : (error as Error).message;
    await supabase.from("ai_calls").insert({
      run_id: input.runId,
      user_id: userId,
      kind: "final",
      model: settings.final_model,
      system_text: finalInstructions,
      user_text: prompt,
      request_params: requestParams,
      error_text: message,
    });
    throw new Error(message);
  }
}
