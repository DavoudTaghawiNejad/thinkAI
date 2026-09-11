import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadSettings, loadSteps, loadPresets, loadSequences } = await import("./forge.server");
    const { resolveAdmin } = await import("./admin.server");
    const { loadDefaultsConfig } = await import("./defaults-config.server");
    const [settings, steps, presets, sequences, admin, config] = await Promise.all([
      loadSettings(context.supabase as never, context.userId),
      loadSteps(context.supabase as never, context.userId),
      loadPresets(context.supabase as never, context.userId),
      loadSequences(context.supabase as never, context.userId),
      resolveAdmin(context.userId, context.claims as never),
      loadDefaultsConfig(),
    ]);
    return {
      settings,
      steps,
      presets,
      sequences,
      isAdmin: admin.isAdmin,
      shareRecipient: config.share_default_recipient,
    };
  });

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("runs")
      .select("id, title, status, step_index, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { loadRun } = await import("./forge.server");
    return loadRun(context.supabase as never, context.userId, data.runId);
  });

export const createRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ prompt: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const title = data.prompt.trim().split("\n")[0]!.slice(0, 80) || "Untitled prompt";
    const { data: run, error } = await context.supabase
      .from("runs")
      .insert({
        user_id: context.userId,
        title,
        original_prompt: data.prompt,
        current_prompt: data.prompt,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return run;
  });

export const deleteRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("runs")
      .delete()
      .eq("id", data.runId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reviewPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ runId: z.string().uuid(), prompt: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { runReview } = await import("./forge.server");
    return runReview(context.supabase as never, context.userId, data);
  });

export const skipCurrentStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ runId: z.string().uuid(), prompt: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { skipStep } = await import("./forge.server");
    return skipStep(context.supabase as never, context.userId, data);
  });

export const generateFinalAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { runFinal } = await import("./forge.server");
    return runFinal(context.supabase as never, context.userId, data);
  });

const uuid = z.string().uuid();

const stepSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  instruction: z.string().min(1),
  pass_threshold: z.number().int().min(0).max(100),
  max_iterations: z.number().int().min(1).max(20),
});

/**
 * Decide which Supabase client may write to a preset/sequence row and reject if
 * the caller has no business touching it. Owned rows use the caller's RLS
 * client; global rows (user_id null) require admin and the service-role client.
 */
async function writableClient(
  context: { supabase: unknown; userId: string; claims: unknown },
  table: "instruction_presets" | "test_sequences",
  id: string,
): Promise<{ client: any; scope: "own" | "global" }> {
  const anyCtx = context as { supabase: any };
  const { data, error } = await anyCtx.supabase
    .from(table)
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not found.");
  if (data.user_id === context.userId) return { client: anyCtx.supabase, scope: "own" };
  if (data.user_id === null) {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.userId, context.claims as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { client: supabaseAdmin, scope: "global" };
  }
  throw new Error("You can only change your own presets and sequences.");
}

async function replaceSteps(client: any, sequenceId: string, steps: z.infer<typeof stepSchema>[]) {
  const { error: delErr } = await client
    .from("test_sequence_steps")
    .delete()
    .eq("sequence_id", sequenceId);
  if (delErr) throw new Error(delErr.message);
  if (steps.length === 0) return;
  const { error: insErr } = await client
    .from("test_sequence_steps")
    .insert(steps.map((s, position) => ({ sequence_id: sequenceId, position, ...s })));
  if (insErr) throw new Error(insErr.message);
}

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        critic_model: z.string().min(1),
        final_model: z.string().min(1),
        debug_mode: z.boolean(),
        active_preset_id: uuid.nullable(),
        active_sequence_id: uuid.nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const savePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(120),
        critic_instruction: z.string().min(1),
        final_instruction: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const fields = {
      name: data.name,
      critic_instruction: data.critic_instruction,
      final_instruction: data.final_instruction,
    };
    if (!data.id) {
      const { data: row, error } = await context.supabase
        .from("instruction_presets")
        .insert({ user_id: context.userId, ...fields })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id as string };
    }
    const { client } = await writableClient(context, "instruction_presets", data.id);
    const { error } = await client.from("instruction_presets").update(fields).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { id: data.id };
  });

export const duplicatePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: src, error: readErr } = await context.supabase
      .from("instruction_presets")
      .select("name, critic_instruction, final_instruction")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!src) throw new Error("Not found.");
    const { data: row, error } = await context.supabase
      .from("instruction_presets")
      .insert({
        user_id: context.userId,
        name: `${src.name} (copy)`,
        critic_instruction: src.critic_instruction,
        final_instruction: src.final_instruction,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const renamePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, name: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    const { client } = await writableClient(context, "instruction_presets", data.id);
    const { error } = await client
      .from("instruction_presets")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { client } = await writableClient(context, "instruction_presets", data.id);
    await context.supabase
      .from("settings")
      .update({ active_preset_id: null })
      .eq("user_id", context.userId)
      .eq("active_preset_id", data.id);
    const { error } = await client.from("instruction_presets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(120),
        steps: z.array(stepSchema).min(1),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    if (!data.id) {
      const { data: row, error } = await context.supabase
        .from("test_sequences")
        .insert({ user_id: context.userId, name: data.name })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await replaceSteps(context.supabase, row.id, data.steps);
      return { id: row.id as string };
    }
    const { client } = await writableClient(context, "test_sequences", data.id);
    const { error } = await client
      .from("test_sequences")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await replaceSteps(client, data.id, data.steps);
    return { id: data.id };
  });

export const duplicateSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: src, error: readErr } = await context.supabase
      .from("test_sequences")
      .select("name, test_sequence_steps (name, description, instruction, pass_threshold, max_iterations, position)")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!src) throw new Error("Not found.");
    const { data: row, error } = await context.supabase
      .from("test_sequences")
      .insert({ user_id: context.userId, name: `${src.name} (copy)` })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const steps = [...(src.test_sequence_steps ?? [])]
      .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
      .map(({ name, description, instruction, pass_threshold, max_iterations }: z.infer<typeof stepSchema>) => ({
        name,
        description,
        instruction,
        pass_threshold,
        max_iterations,
      }));
    await replaceSteps(context.supabase, row.id, steps);
    return { id: row.id as string };
  });

export const renameSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, name: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    const { client } = await writableClient(context, "test_sequences", data.id);
    const { error } = await client
      .from("test_sequences")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { client } = await writableClient(context, "test_sequences", data.id);
    await context.supabase
      .from("settings")
      .update({ active_sequence_id: null })
      .eq("user_id", context.userId)
      .eq("active_sequence_id", data.id);
    const { error } = await client.from("test_sequences").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetToDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadDefaultsConfig } = await import("./defaults-config.server");
    const config = await loadDefaultsConfig();

    // Rebuild the caller's personal preset + sequence from config/defaults.yaml,
    // replacing any previous "My instructions" / "My sequence" it made before.
    await context.supabase
      .from("instruction_presets")
      .delete()
      .eq("user_id", context.userId)
      .eq("name", "My instructions");
    await context.supabase
      .from("test_sequences")
      .delete()
      .eq("user_id", context.userId)
      .eq("name", "My sequence");

    const { data: preset, error: presetErr } = await context.supabase
      .from("instruction_presets")
      .insert({
        user_id: context.userId,
        name: "My instructions",
        critic_instruction: config.critic_instruction,
        final_instruction: config.final_instructions,
      })
      .select("id")
      .single();
    if (presetErr) throw new Error(presetErr.message);

    const { data: sequence, error: seqErr } = await context.supabase
      .from("test_sequences")
      .insert({ user_id: context.userId, name: "My sequence" })
      .select("id")
      .single();
    if (seqErr) throw new Error(seqErr.message);

    await replaceSteps(
      context.supabase,
      sequence.id,
      config.test_steps.map((s) => ({
        name: s.name,
        description: s.description,
        instruction: s.instruction,
        pass_threshold: s.pass_threshold,
        max_iterations: s.max_iterations,
      })),
    );

    const { error: settingsError } = await context.supabase.from("settings").upsert(
      {
        user_id: context.userId,
        critic_model: config.critic_model,
        final_model: config.final_model,
        debug_mode: config.debug_mode,
        active_preset_id: preset.id,
        active_sequence_id: sequence.id,
      },
      { onConflict: "user_id" },
    );
    if (settingsError) throw new Error(settingsError.message);

    return { ok: true };
  });
