import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadSettings, loadSequences } = await import("./refine.server");
    const { resolveAdmin } = await import("./admin.server");
    const { loadDefaultsConfig } = await import("./defaults-config.server");
    // A brand-new profile's settings row is written inside loadSettings, so that
    // has to finish before the lists are read — the sequence list is keyed on
    // the default it establishes.
    const settings = await loadSettings(context.supabase as never, context.userId);
    const [sequences, admin, config, profile] = await Promise.all([
      loadSequences(context.supabase as never, context.userId, settings.default_sequence_id),
      resolveAdmin(context.userId, context.claims as never),
      loadDefaultsConfig(),
      context.supabase
        .from("profiles")
        .select("display_name, display_name_confirmed, intro_seen_at")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);
    return {
      settings,
      sequences,
      isAdmin: admin.isAdmin,
      // The introduction is for a profile that has never seen it. A missing
      // profile row counts as seen: better to show nothing than to greet
      // someone repeatedly because the row could not be read.
      introSeen: profile.data ? profile.data.intro_seen_at !== null : true,
      // What to greet them with, and whether they have ever been asked. An
      // unconfirmed name is a guess made at signup — worth showing, and worth
      // asking about once.
      displayName: profile.data?.display_name ?? null,
      nameConfirmed: profile.data ? profile.data.display_name_confirmed : true,
      // Sharing aims at the admin by default, so adding or changing one moves
      // the target with it. share_default_recipient is the fallback for a config
      // that lists no admin_emails.
      shareRecipient: config.admin_emails[0] ?? config.share_default_recipient,
    };
  });

/**
 * Note that this profile has seen the introduction, so it is not shown again.
 * Recorded once, on the profile: dismissing it on one device dismisses it
 * everywhere. Idempotent — a second call keeps the first timestamp.
 */
export const markIntroSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ intro_seen_at: new Date().toISOString() })
      .eq("id", context.userId)
      .is("intro_seen_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Record the name the profile chose for itself. Confirming it is the point of
 * the write: from here on the name is theirs, not a guess from their email, and
 * they are not asked again.
 */
export const saveDisplayName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ displayName: z.string().trim().min(1).max(80) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ display_name: data.displayName, display_name_confirmed: true })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
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

/**
 * Mark one of the critic's questions as intentionally left open (or unmark it).
 * The mark holds for the whole run: from here on the question is listed in the
 * critic instruction of every submission, in this test and the ones after it.
 */
export const setQuestionOpen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        question: z.string().min(1),
        open: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { setQuestionOpen: handler } = await import("./refine.server");
    return handler(context.supabase as never, context.userId, data);
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
 * A sequence is writable only by the profile that owns it. General sequences
 * (user_id null) are editable by nobody — an admin changes one by re-publishing
 * the personal sequence it came from, so there is no in-place edit path and no
 * service-role write here.
 */
async function requireOwnSequence(
  context: { supabase: any; userId: string },
  id: string,
): Promise<void> {
  const { data, error } = await context.supabase
    .from("test_sequences")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not found.");
  if (data.user_id === null)
    throw new Error(
      "General sequences cannot be edited. Duplicate this one to make a version of your own.",
    );
  if (data.user_id !== context.userId) throw new Error("You can only change your own sequences.");
}

/**
 * The names a sequence of the caller's may not take: their other sequences', and
 * every general sequence's. A name is how a sequence is recognised, and a
 * private one wearing a general one's name is the ambiguity this rules out.
 *
 * `exceptId` is the sequence being named, exempt from clashing with itself —
 * and from clashing with the general sequence published *from* it, which shares
 * its name by design.
 */
async function takenSequenceNames(
  context: { supabase: any; userId: string },
  exceptId?: string,
): Promise<Set<string>> {
  // RLS returns the caller's own rows plus the general ones, which is exactly
  // the set that matters here.
  const { data, error } = await context.supabase
    .from("test_sequences")
    .select("id, name, user_id, published_from");
  if (error) throw new Error(error.message);
  type Row = { id: string; name: string; user_id: string | null; published_from: string | null };
  const taken = new Set<string>();
  for (const row of (data ?? []) as Row[]) {
    if (exceptId && (row.id === exceptId || row.published_from === exceptId)) continue;
    if (row.user_id === null || row.user_id === context.userId) taken.add(row.name);
  }
  return taken;
}

/** Reject a name already in use, naming what it collides with. */
async function requireFreeSequenceName(
  context: { supabase: any; userId: string },
  name: string,
  exceptId?: string,
): Promise<void> {
  if ((await takenSequenceNames(context, exceptId)).has(name))
    throw new Error(`“${name}” is already the name of a test sequence you can see. Pick another.`);
}

async function replaceSteps(client: any, sequenceId: string, steps: z.infer<typeof stepSchema>[]) {
  const { replaceSequenceSteps } = await import("./sequences.server");
  await replaceSequenceSteps(client, sequenceId, steps);
}

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        critic_model: z.string().min(1),
        final_model: z.string().min(1),
        debug_mode: z.boolean(),
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
      await requireFreeSequenceName(context, data.name);
      const { data: row, error } = await context.supabase
        .from("test_sequences")
        .insert({ user_id: context.userId, ...fields })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await replaceSteps(context.supabase, row.id, data.steps);
      return { id: row.id as string };
    }
    await requireOwnSequence(context, data.id);
    await requireFreeSequenceName(context, data.name, data.id);
    const { error } = await context.supabase
      .from("test_sequences")
      .update(fields)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await replaceSteps(context.supabase, data.id, data.steps);
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

    // Don't collide with a sequence they already have, or with a general one;
    // suffix until the name is free.
    const taken = await takenSequenceNames(context);
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

/**
 * Copy a sequence into the caller's own library under a name they choose.
 *
 * The name is asked for rather than derived: duplicating a general sequence is
 * how anyone gets a version they can edit, and the copy may not keep the
 * original's name — one name, one sequence.
 */
export const duplicateSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: uuid, name: z.string().trim().min(1).max(120) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { loadSequenceForCopy, copySequenceForUser } = await import("./sequences.server");
    const src = await loadSequenceForCopy(context.supabase as never, data.id);
    if (!src) throw new Error("Not found.");
    await requireFreeSequenceName(context, data.name);
    // The duplicate is the caller's own, plain and editable.
    const id = await copySequenceForUser(context.supabase as never, context.userId, src, {
      name: data.name,
    });
    return { id, name: data.name };
  });

export const renameSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, name: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireOwnSequence(context, data.id);
    await requireFreeSequenceName(context, data.name, data.id);
    const { error } = await context.supabase
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
    await requireOwnSequence(context, data.id);
    // settings.default_sequence_id and runs.sequence_id are ON DELETE SET NULL,
    // so both fall back to where a new profile starts rather than dangling.
    const { error } = await context.supabase.from("test_sequences").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Point the caller's profile at its default sequence — what the home page and
 * a new run start from. Any sequence they can see qualifies: one of their own,
 * or a general one. The choice lives on the profile, so one profile defaulting
 * to a general sequence says nothing about anyone else's.
 */
export const setDefaultSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    // RLS only lets them read their own rows and the general ones, so a
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
 * Admin only. Publish one of the caller's own sequences into the general set,
 * where every profile can use it — and nobody, the admin included, can edit it.
 *
 * Publishing the same sequence again rewrites the general version in place, so
 * profiles defaulting to it follow the update. Until then the admin's personal
 * copy is theirs to edit freely: editing has no consequences, publishing does.
 */
export const publishSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.userId, context.claims as never);

    // Only a sequence of their own: an admin publishes their own work, never
    // another profile's (which RLS hides from them in any case).
    const { data: source, error: readErr } = await context.supabase
      .from("test_sequences")
      .select("id, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!source) throw new Error("Not found.");
    if (source.user_id !== context.userId)
      throw new Error("You can only publish one of your own sequences.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { publishSequenceAsGeneral } = await import("./sequences.server");
    return publishSequenceAsGeneral(supabaseAdmin as never, data.id);
  });

/**
 * Admin only. Take a general sequence back out of the general set. Profiles
 * that had it as their default fall back to what new profiles start with; runs
 * already finished keep the tests they ran against.
 */
export const withdrawSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.userId, context.claims as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { withdrawGeneralSequence } = await import("./sequences.server");
    await withdrawGeneralSequence(supabaseAdmin as never, data.id);
    return { ok: true };
  });

/**
 * Admin only. Mark which general sequence a brand-new profile starts pointed
 * at. Exactly one holds the mark at a time; every profile is free to point
 * somewhere else afterwards.
 */
export const setNewUserDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin(context.userId, context.claims as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { setNewUserDefaultSequence } = await import("./sequences.server");
    await setNewUserDefaultSequence(supabaseAdmin as never, data.id);
    return { ok: true };
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
        // "Reset to defaults" leaves the picker pointing somewhere sane.
        default_sequence_id: sequence.id,
      },
      { onConflict: "user_id" },
    );
    if (settingsError) throw new Error(settingsError.message);

    return { ok: true };
  });
