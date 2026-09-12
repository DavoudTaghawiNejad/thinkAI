import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadSettings, loadSequences, loadSequenceConflicts } = await import("./refine.server");
    const { resolveAdmin } = await import("./admin.server");
    const { loadDefaultsConfig } = await import("./defaults-config.server");
    // A brand-new profile is provisioned inside loadSettings, so that has to
    // finish before the lists are read. Running it inside the Promise.all below
    // races the reads, and a fresh account's first load comes back with an empty
    // sequence picker.
    const settings = await loadSettings(context.supabase as never, context.userId);
    const [sequences, sequenceConflicts, admin, config] = await Promise.all([
      loadSequences(context.supabase as never, context.userId, settings.default_sequence_id),
      loadSequenceConflicts(context.supabase as never, context.userId),
      resolveAdmin(context.userId, context.claims as never),
      loadDefaultsConfig(),
    ]);
    return {
      settings,
      sequences,
      sequenceConflicts,
      isAdmin: admin.isAdmin,
      // Sharing aims at the admin by default, so adding or changing one moves
      // the target with it. share_default_recipient is the fallback for a config
      // that lists no admin_emails.
      shareRecipient: config.admin_emails[0] ?? config.share_default_recipient,
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
    const { loadRun } = await import("./refine.server");
    return loadRun(context.supabase as never, context.userId, data.runId);
  });

export const createRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ prompt: z.string().min(1), sequenceId: z.string().uuid().nullish() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const title = data.prompt.trim().split("\n")[0]!.slice(0, 80) || "Untitled prompt";
    // The run pins the sequence it was started with, so changing the default
    // later cannot reshape a run already under way.
    const { resolveDefaultSequenceId } = await import("./sequences.server");
    const sequenceId =
      data.sequenceId ??
      (await resolveDefaultSequenceId(context.supabase as never, context.userId));
    const { data: run, error } = await context.supabase
      .from("runs")
      .insert({
        user_id: context.userId,
        title,
        original_prompt: data.prompt,
        current_prompt: data.prompt,
        sequence_id: sequenceId,
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
    const { runReview } = await import("./refine.server");
    return runReview(context.supabase as never, context.userId, data);
  });

export const skipCurrentStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ runId: z.string().uuid(), prompt: z.string().min(1) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { skipStep } = await import("./refine.server");
    return skipStep(context.supabase as never, context.userId, data);
  });

export const generateFinalAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ runId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { runFinal } = await import("./refine.server");
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
 * Decide which Supabase client may write to a sequence and reject if the caller
 * has no business touching it. Owned rows use the caller's RLS client; General
 * rows (user_id null) require admin and the service-role client.
 */
async function writableClient(
  context: { supabase: unknown; userId: string; claims: unknown },
  id: string,
): Promise<{ client: any; scope: "own" | "global" }> {
  const anyCtx = context as { supabase: any };
  const { data, error } = await anyCtx.supabase
    .from("test_sequences")
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
  throw new Error("You can only change your own sequences.");
}

async function replaceSteps(client: any, sequenceId: string, steps: z.infer<typeof stepSchema>[]) {
  const { replaceSequenceSteps } = await import("./sequences.server");
  await replaceSequenceSteps(client, sequenceId, steps);
}

/**
 * Refuse to overwrite a sequence an admin handed the caller — a pushed copy, or
 * the one seeded into their account at signup — while it is still as delivered.
 * They duplicate it to get a version of their own. An admin editing a General
 * sequence is untouched by this, and so is an "(old)" superseded copy, which
 * archiving already detached from its origin.
 */
async function refuseIfFromAdmin(context: { supabase: any }, id: string, scope: "own" | "global") {
  if (scope !== "own") return;
  const { data } = await context.supabase
    .from("test_sequences")
    .select("origin_id, name")
    .eq("id", id)
    .maybeSingle();
  if (data?.origin_id) {
    throw new Error(
      `“${data.name}” was provided by an admin and cannot be overwritten. Duplicate it to make a version of your own.`,
    );
  }
}

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        critic_model: z.string().min(1),
        final_model: z.string().min(1),
        debug_mode: z.boolean(),
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

export const saveSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: uuid.optional(),
        name: z.string().min(1).max(120),
        critic_instruction: z.string().min(1),
        final_instruction: z.string().min(1),
        steps: z.array(stepSchema).min(1),
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
        .from("test_sequences")
        .insert({ user_id: context.userId, ...fields })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await replaceSteps(context.supabase, row.id, data.steps);
      return { id: row.id as string };
    }
    const { client, scope } = await writableClient(context, data.id);
    await refuseIfFromAdmin(context, data.id, scope);
    const { error } = await client.from("test_sequences").update(fields).eq("id", data.id);
    if (error) throw new Error(error.message);
    await replaceSteps(client, data.id, data.steps);
    return { id: data.id };
  });

/**
 * Create a new sequence from a YAML document — the same shape Share produces, so
 * a sequence mailed between accounts can be brought back in. Tolerant about what
 * it accepts: `kind` is optional, and step fields fall back to the same defaults
 * the editor uses.
 *
 * The result is always a plain sequence of the caller's own: it tracks no origin,
 * so an admin push never claims it and it is theirs to edit.
 */
export const importSequenceYaml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ yaml: z.string().min(1).max(500_000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { load: parseYaml } = await import("js-yaml");

    let parsed: unknown;
    try {
      parsed = parseYaml(data.yaml);
    } catch (error) {
      throw new Error(`That is not valid YAML: ${(error as Error).message}`);
    }

    const schema = z.object({
      kind: z.literal("test_sequence").optional(),
      name: z.string().min(1).max(120),
      critic_instruction: z.string().min(1),
      final_instruction: z.string().min(1),
      steps: z
        .array(
          z.object({
            name: z.string().min(1),
            description: z.string().default(""),
            instruction: z.string().min(1),
            pass_threshold: z.number().int().min(0).max(100).default(80),
            max_iterations: z.number().int().min(1).max(20).default(4),
          }),
        )
        .min(1),
    });
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(
        `That YAML is not a test sequence. It needs a name, critic_instruction, final_instruction and at least one step. (${detail})`,
      );
    }
    const doc = result.data;

    // Don't collide with a sequence they already have; suffix until it is free.
    const { data: existing } = await context.supabase
      .from("test_sequences")
      .select("name")
      .eq("user_id", context.userId);
    const taken = new Set((existing ?? []).map((r: { name: string }) => r.name));
    let name = doc.name;
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${doc.name} (${n})`)) n++;
      name = `${doc.name} (${n})`;
    }

    const { data: row, error } = await context.supabase
      .from("test_sequences")
      .insert({
        user_id: context.userId,
        name,
        critic_instruction: doc.critic_instruction,
        final_instruction: doc.final_instruction,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await replaceSteps(context.supabase, row.id, doc.steps);
    return { id: row.id as string, name };
  });

export const duplicateSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { loadSequenceForCopy, copySequenceForUser } = await import("./sequences.server");
    const src = await loadSequenceForCopy(context.supabase as never, data.id);
    if (!src) throw new Error("Not found.");
    // A hand-made duplicate is the user's own from the start — it deliberately
    // does not track an origin, so an admin push never claims it.
    const id = await copySequenceForUser(context.supabase as never, context.userId, src, {
      name: `${src.name} (copy)`,
      trackOrigin: false,
    });
    return { id };
  });

export const renameSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, name: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    const { client, scope } = await writableClient(context, data.id);
    await refuseIfFromAdmin(context, data.id, scope);
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
    const { client } = await writableClient(context, data.id);
    await context.supabase
      .from("settings")
      .update({ active_sequence_id: null })
      .eq("user_id", context.userId)
      .eq("active_sequence_id", data.id);
    const { error } = await client.from("test_sequences").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Point the caller's profile at its default sequence — what the home-page picker
 * pre-selects. Any sequence they can see qualifies: their own, a superseded
 * "(old)" copy, or a shared General one. The choice lives on the profile, so one
 * profile picking a General sequence says nothing about anyone else's.
 */
export const setDefaultSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    // RLS only lets them read their own rows and the General ones, so a
    // successful read is the whole permission check.
    const { data: row, error: readErr } = await context.supabase
      .from("test_sequences")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Not found.");

    const { error } = await context.supabase
      .from("settings")
      .update({ default_sequence_id: data.id })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin only. Designate which sequences brand-new accounts start with: the
 * "default" one becomes their active sequence, the "alternative" is copied in
 * alongside it. At most one of each across the whole install.
 *
 * The target may be a General sequence or one the admin owns — new profiles get
 * a copy either way. Clearing whoever previously held the role means writing to
 * a row the caller may not own, so the write goes through the service-role
 * client after the admin check.
 */
export const setSequenceNewUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: uuid, role: z.enum(["default", "alternative"]).nullable() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.userId, context.claims as never);

    // The admin may only designate a sequence they can actually see: their own,
    // or a shared General one — never another user's private sequence.
    const { data: target, error: readErr } = await context.supabase
      .from("test_sequences")
      .select("id, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!target) throw new Error("Not found.");
    if (target.user_id !== null && target.user_id !== context.userId)
      throw new Error("You can only designate your own or a General sequence.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.role) {
      const { error: clearErr } = await supabaseAdmin
        .from("test_sequences")
        .update({ new_user_role: null })
        .eq("new_user_role", data.role);
      if (clearErr) throw new Error(clearErr.message);
    }
    const { error } = await supabaseAdmin
      .from("test_sequences")
      .update({ new_user_role: data.role })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin only. Publish a sequence into every profile — a General one, or one of
 * the admin's own.
 *
 * Per profile, one of three things happens, and none of them can lose work:
 *  - no copy yet          → it is copied in;
 *  - copy left untouched  → the previous version is kept as "<name> (old)"
 *                           (exactly one per name) and the new one takes over;
 *  - copy has been edited → theirs is left strictly alone and the new version
 *                           waits under "<name> (new)" behind a rename prompt
 *                           they see on their next visit.
 */
export const pushSequenceToAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.userId, context.claims as never);

    // Push from a General sequence or one of the admin's own, never from another
    // user's private sequence. Read through the caller's RLS client, which can
    // only see those two kinds in the first place.
    const { data: source, error: readErr } = await context.supabase
      .from("test_sequences")
      .select("id, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!source) throw new Error("Not found.");
    if (source.user_id !== null && source.user_id !== context.userId)
      throw new Error("You can only push your own or a General sequence.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pushSequenceToEveryProfile } = await import("./sequences.server");
    return pushSequenceToEveryProfile(supabaseAdmin as never, data.id);
  });

export const resolveSequenceConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conflictId: uuid,
        action: z.enum(["rename", "discard"]),
        newName: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { resolveConflict } = await import("./sequences.server");
    return resolveConflict(context.supabase as never, context.userId, data);
  });

export const resetToDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadDefaultsConfig } = await import("./defaults-config.server");
    const config = await loadDefaultsConfig();

    // Rebuild the caller's personal "My sequence" — instructions and tests
    // together — from config/defaults.yaml, replacing any previous one.
    await context.supabase
      .from("test_sequences")
      .delete()
      .eq("user_id", context.userId)
      .eq("name", "My sequence");

    const { data: sequence, error: seqErr } = await context.supabase
      .from("test_sequences")
      .insert({
        user_id: context.userId,
        name: "My sequence",
        critic_instruction: config.critic_instruction,
        final_instruction: config.final_instructions,
      })
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
        active_sequence_id: sequence.id,
        // "Reset to defaults" leaves the picker pointing somewhere sane.
        default_sequence_id: sequence.id,
      },
      { onConflict: "user_id" },
    );
    if (settingsError) throw new Error(settingsError.message);

    return { ok: true };
  });
