import { runModelRequest, ProviderError } from "./ai-providers.server";
import { loadDefaultsConfig } from "./defaults-config.server";
import {
  buildCriticUserText,
  buildClarifyUserText,
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

export async function loadSettings(supabase: Client, userId: string): Promise<Settings> {
  const { data, error } = await supabase
    .from("settings")
    .select("critic_instruction, critic_model, final_model, debug_mode")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as Settings;
  const config = await loadDefaultsConfig();
  const { data: created, error: insertError } = await supabase
    .from("settings")
    .insert({
      user_id: userId,
      critic_instruction: config.critic_instruction,
      critic_model: config.critic_model,
      final_model: config.final_model,
      debug_mode: config.debug_mode,
    })
    .select("critic_instruction, critic_model, final_model, debug_mode")
    .single();
  if (insertError) throw new Error(insertError.message);
  return created as Settings;
}

export async function loadSteps(supabase: Client, userId: string): Promise<TestStep[]> {
  const { data, error } = await supabase
    .from("test_steps")
    .select("id, name, description, instruction, pass_threshold, max_iterations, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TestStep[];
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

function parseVerdict(text: string): Verdict {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned) as Verdict;
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

  const requestParams = {
    reasoning: { effort: "low", summary: "auto" },
    stream: true,
    store: false,
    text: { format: { type: "json_schema", name: "verdict", strict: true } },
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
      reasoningEffort: "low",
      jsonSchema: { name: "verdict", schema: VERDICT_SCHEMA as unknown as Record<string, unknown> },
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
  const config = await loadDefaultsConfig();
  const finalInstructions = config.final_instructions;

  const requestParams = {
    reasoning: { effort: "medium", summary: "auto" },
    stream: true,
    store: false,
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

export async function askClarify(
  supabase: Client,
  userId: string,
  input: { runId: string; question: string; message: string },
) {
  const { run, steps, settings } = await loadRun(supabase, userId, input.runId);
  const stepIndex: number = run.step_index;
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const config = await loadDefaultsConfig();
  const systemText = config.clarify_instruction;
  const userText = buildClarifyUserText({
    stepName: step?.name ?? "—",
    stepInstruction: step?.instruction ?? "—",
    question: input.question,
    message: input.message,
    prompt: run.current_prompt,
  });
  const requestParams = {
    reasoning: { effort: "low", summary: "auto" },
    stream: true,
    store: false,
  };

  try {
    const result = await runModelRequest({
      model: settings.critic_model,
      instructions: systemText,
      input: userText,
      reasoningEffort: "low",
    });
    await supabase.from("ai_calls").insert({
      run_id: input.runId,
      user_id: userId,
      kind: "clarify",
      model: settings.critic_model,
      system_text: systemText,
      user_text: userText,
      request_params: requestParams,
      raw_response: result.text,
      latency_ms: result.latencyMs,
      run_ref: result.runId ?? null,
    });
    return { answer: result.text.trim() || "The model returned no text." };
  } catch (error) {
    const message = error instanceof ProviderError ? error.message : (error as Error).message;
    await supabase.from("ai_calls").insert({
      run_id: input.runId,
      user_id: userId,
      kind: "clarify",
      model: settings.critic_model,
      system_text: systemText,
      user_text: userText,
      request_params: requestParams,
      error_text: message,
    });
    throw new Error(message);
  }
}
