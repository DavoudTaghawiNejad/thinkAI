import { runModelRequest, ProviderError } from "./ai-providers.server";
import { loadDefaultsConfig } from "./defaults-config.server";
import { seedSequencesForUser } from "./sequences.server";
import {
  buildCriticUserText,
  composeCriticInstruction,
  VERDICT_SCHEMA,
  type Settings,
  type TestStep,
  type Verdict,
  type RunRow,
  type IterationRow,
  type AiCallRow,
} from "./refine.shared";

type Client = {
  from: (table: string) => any;
};

const STEP_COLUMNS = "id, name, description, instruction, pass_threshold, max_iterations, position";

type SettingsRow = {
  critic_model: string;
  final_model: string;
  debug_mode: boolean;
  active_sequence_id: string | null;
  /** The profile's default. A pointer, so it may name a General sequence too. */
  default_sequence_id: string | null;
};

/**
 * Give a fresh profile its starting sequences (instructions and tests together)
 * and a settings row pointing at one. Idempotent-ish: only called when no
 * settings row exists yet (fresh signup, or a legacy user the migration somehow
 * missed).
 */
async function provisionWorkspace(supabase: Client, userId: string): Promise<SettingsRow> {
  const config = await loadDefaultsConfig();

  // Sequences come from whatever an admin has marked "new-account default" and
  // "new-account alternative", falling back to config/defaults.yaml.
  const activeSequenceId = await seedSequencesForUser(supabase, userId);

  const row: SettingsRow = {
    critic_model: config.critic_model,
    final_model: config.final_model,
    debug_mode: config.debug_mode,
    active_sequence_id: activeSequenceId,
    default_sequence_id: activeSequenceId,
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
    .select("critic_model, final_model, debug_mode, active_sequence_id, default_sequence_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as SettingsRow;
  return provisionWorkspace(supabase, userId);
}

export async function loadSettings(supabase: Client, userId: string): Promise<Settings> {
  const row = await loadSettingsRow(supabase, userId);
  return {
    critic_model: row.critic_model,
    final_model: row.final_model,
    debug_mode: row.debug_mode,
    active_sequence_id: row.active_sequence_id,
    default_sequence_id: row.default_sequence_id,
  };
}

/**
 * The instructions a run is answering under. They live on the run's own
 * sequence, so re-wording a sequence mid-run cannot change what an in-flight run
 * was reviewed against — and a deleted sequence falls back the same way its
 * steps do.
 */
async function loadSequenceInstructions(
  supabase: Client,
  sequenceId: string | null,
): Promise<{ critic_instruction: string; final_instruction: string }> {
  const seqId = sequenceId ?? (await fallbackSequenceId(supabase));
  if (seqId) {
    const { data } = await supabase
      .from("test_sequences")
      .select("critic_instruction, final_instruction")
      .eq("id", seqId)
      .maybeSingle();
    if (data?.critic_instruction && data.final_instruction) {
      return data as { critic_instruction: string; final_instruction: string };
    }
  }
  const config = await loadDefaultsConfig();
  return {
    critic_instruction: config.critic_instruction,
    final_instruction: config.final_instructions,
  };
}

/** The oldest General sequence — what a profile falls back to with nothing set. */
async function fallbackSequenceId(supabase: Client): Promise<string | null> {
  const { data } = await supabase
    .from("test_sequences")
    .select("id")
    .is("user_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function loadSequenceSteps(supabase: Client, sequenceId: string | null): Promise<TestStep[]> {
  const seqId = sequenceId ?? (await fallbackSequenceId(supabase));
  if (!seqId) return [];
  const { data, error } = await supabase
    .from("test_sequence_steps")
    .select(STEP_COLUMNS)
    .eq("sequence_id", seqId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TestStep[];
}

type SequenceRow = {
  id: string;
  name: string;
  critic_instruction: string;
  final_instruction: string;
  user_id: string | null;
  origin_id: string | null;
  new_user_role: "default" | "alternative" | null;
  test_sequence_steps: TestStep[] | null;
};

/** Own + General sequences with their steps, for the Settings dialog and the
 * home-page picker. */
export async function loadSequences(
  supabase: Client,
  userId: string,
  defaultSequenceId: string | null,
) {
  const { data, error } = await supabase
    .from("test_sequences")
    .select(
      `id, name, critic_instruction, final_instruction, user_id, origin_id, new_user_role, test_sequence_steps (${STEP_COLUMNS})`,
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SequenceRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    critic_instruction: s.critic_instruction,
    final_instruction: s.final_instruction,
    owned: s.user_id === userId,
    isDefault: s.id === defaultSequenceId,
    // Still carrying its origin: this is an admin's wording as delivered, either
    // pushed out or handed to the account at signup. Read-only — duplicate to
    // make a version of your own.
    fromAdmin: s.origin_id != null,
    newUserRole: s.new_user_role,
    steps: [...(s.test_sequence_steps ?? [])].sort((a, b) => a.position - b.position),
  }));
}

/** Pending "an admin pushed an update, please rename your copy" prompts. */
export async function loadSequenceConflicts(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("sequence_push_conflicts")
    .select("id, name, mine_id, incoming_id, mine:mine_id (name), incoming:incoming_id (name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  type ConflictRow = {
    id: string;
    name: string;
    mine_id: string;
    incoming_id: string;
    mine: { name: string } | null;
    incoming: { name: string } | null;
  };
  return ((data ?? []) as ConflictRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    mineId: c.mine_id,
    mineName: c.mine?.name ?? c.name,
    incomingId: c.incoming_id,
    incomingName: c.incoming?.name ?? c.name,
  }));
}

export async function loadRun(supabase: Client, userId: string, runId: string) {
  const [runRes, iterRes, settings] = await Promise.all([
    supabase.from("runs").select("*").eq("id", runId).eq("user_id", userId).maybeSingle(),
    supabase
      .from("iterations")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
    loadSettings(supabase, userId),
  ]);
  if (runRes.error) throw new Error(runRes.error.message);
  if (!runRes.data) throw new Error("Run not found");
  if (iterRes.error) throw new Error(iterRes.error.message);

  // A run's steps come from the sequence it was started with, not from whatever
  // the user has selected now — otherwise switching sequences mid-run would
  // change the shape of a run already under way. loadSequenceSteps falls back to
  // a General sequence if the run's own was deleted.
  const sequenceId = (runRes.data.sequence_id as string | null) ?? null;
  const [steps, instructions] = await Promise.all([
    loadSequenceSteps(supabase, sequenceId),
    loadSequenceInstructions(supabase, sequenceId),
  ]);

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
    instructions,
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
  const { run, steps, settings, instructions } = await loadRun(supabase, userId, input.runId);
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

  const systemText = composeCriticInstruction({
    criticInstruction: instructions.critic_instruction,
    openQuestions: run.open_questions ?? [],
  });
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

/**
 * Mark one of the critic's questions as intentionally left open, or take the
 * mark off again. The list is a set keyed by the question's exact text, since
 * questions are plain strings inside the iteration's JSONB and have no id to key
 * on; re-asking the same question verbatim therefore finds it still marked.
 *
 * Read-modify-write: the author toggles one question at a time by hand, so there
 * is nothing here to race.
 */
export async function setQuestionOpen(
  supabase: Client,
  userId: string,
  input: { runId: string; question: string; open: boolean },
) {
  const { data, error } = await supabase
    .from("runs")
    .select("open_questions")
    .eq("id", input.runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Run not found");

  const current = (data.open_questions ?? []) as string[];
  const without = current.filter((q) => q !== input.question);
  const next = input.open ? [...without, input.question] : without;

  const { error: updateError } = await supabase
    .from("runs")
    .update({ open_questions: next })
    .eq("id", input.runId)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);

  return { openQuestions: next };
}

export async function runFinal(supabase: Client, userId: string, input: { runId: string }) {
  const { run, settings, instructions } = await loadRun(supabase, userId, input.runId);
  const prompt: string = run.current_prompt;
  const finalInstructions = instructions.final_instruction;

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
