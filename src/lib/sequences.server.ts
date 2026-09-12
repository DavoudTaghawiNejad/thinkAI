import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDefaultsConfig } from "./defaults-config.server";

/**
 * Everything that reasons about a test sequence as a *copy of something* —
 * fingerprinting, copying, seeding a new account, and resolving which sequence
 * a run should use. Shared by the two provisioning paths (signup in
 * invite.server.ts, lazy top-up in refine.server.ts) and by the admin push in
 * refine.functions.ts.
 *
 * ## How a pushed copy is tracked
 *
 * A copy carries `origin_id` (the General sequence it came from) and
 * `origin_fingerprint` (a hash of its contents *as delivered*). Re-hashing the
 * copy and comparing answers the only question the push cares about: has the
 * user edited this since we gave it to them?
 *
 * A push overwrites an untouched copy in place: the previous version is simply
 * dropped, with no keepsake left behind. A copy the user has edited is never
 * touched — it raises a rename prompt instead.
 */

type Client = { from: (table: string) => any };

export type SequenceStepInput = {
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
};

/** The columns that make up a sequence's identity for fingerprinting/copying. */
const STEP_FIELDS = "name, description, instruction, pass_threshold, max_iterations, position";

/** Suffix the incoming copy is parked under while a rename conflict is pending. */
export const NEW_SUFFIX = " (new)";

/**
 * Stable content hash of the whole package: name, both instructions, and every
 * step's user-visible fields in order. Position is implied by the array, so
 * reordering steps changes the hash — which is what we want, a reorder is an
 * edit. Instructions are in here because they are part of the package: rewording
 * the critic counts as editing the sequence.
 */
export function fingerprintSequence(seq: {
  name: string;
  critic_instruction: string;
  final_instruction: string;
  steps: SequenceStepInput[];
}): string {
  const canonical = JSON.stringify([
    seq.name,
    seq.critic_instruction,
    seq.final_instruction,
    seq.steps.map((s) => [
      s.name,
      s.description,
      s.instruction,
      s.pass_threshold,
      s.max_iterations,
    ]),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type LoadedSequence = {
  id: string;
  name: string;
  critic_instruction: string;
  final_instruction: string;
  user_id: string | null;
  origin_id: string | null;
  origin_fingerprint: string | null;
  steps: SequenceStepInput[];
};

/** Read one sequence with its steps in order, shaped for hashing and copying. */
export async function loadSequenceForCopy(
  client: Client,
  id: string,
): Promise<LoadedSequence | null> {
  const { data, error } = await client
    .from("test_sequences")
    .select(
      `id, name, critic_instruction, final_instruction, user_id, origin_id, origin_fingerprint, test_sequence_steps (${STEP_FIELDS})`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { ...data, steps: sortSteps(data.test_sequence_steps) } as LoadedSequence;
}

type StepRow = SequenceStepInput & { position: number };

/** Steps come back from PostgREST unordered; position is the source of truth. */
export function sortSteps(rows: StepRow[] | null | undefined): SequenceStepInput[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(({ name, description, instruction, pass_threshold, max_iterations }) => ({
      name,
      description,
      instruction,
      pass_threshold,
      max_iterations,
    }));
}

/** Replace a sequence's steps wholesale, renumbering positions from zero. */
export async function replaceSequenceSteps(
  client: Client,
  sequenceId: string,
  steps: SequenceStepInput[],
): Promise<void> {
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

/**
 * Write a copy of `source` into `userId`'s library, stamped with where it came
 * from and what it looked like at that moment.
 */
export async function copySequenceForUser(
  client: Client,
  userId: string,
  source: {
    id: string;
    name: string;
    critic_instruction: string;
    final_instruction: string;
    steps: SequenceStepInput[];
  },
  options: { name?: string; trackOrigin?: boolean } = {},
): Promise<string> {
  const name = options.name ?? source.name;
  const track = options.trackOrigin ?? true;
  const { data: row, error } = await client
    .from("test_sequences")
    .insert({
      user_id: userId,
      name,
      critic_instruction: source.critic_instruction,
      final_instruction: source.final_instruction,
      // The fingerprint records the *source* content, so a copy saved under a
      // different name still reads as untouched until the package changes.
      ...(track
        ? {
            origin_id: source.id,
            origin_fingerprint: fingerprintSequence({
              name: source.name,
              critic_instruction: source.critic_instruction,
              final_instruction: source.final_instruction,
              steps: source.steps,
            }),
          }
        : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await replaceSequenceSteps(client, row.id, source.steps);
  return row.id as string;
}

/** Has the user edited this copy since it was pushed to them? */
export function isModifiedCopy(seq: LoadedSequence): boolean {
  if (!seq.origin_fingerprint) return true;
  return (
    fingerprintSequence({
      name: seq.name,
      critic_instruction: seq.critic_instruction,
      final_instruction: seq.final_instruction,
      steps: seq.steps,
    }) !== seq.origin_fingerprint
  );
}

/**
 * The sequences an admin has designated for brand-new accounts. These may be
 * General rows or an admin's own — new profiles get a copy either way, and RLS
 * keeps an admin's original invisible to them. Expects a service-role client.
 */
export async function loadNewUserSequences(client: Client): Promise<{
  default: LoadedSequence | null;
  alternative: LoadedSequence | null;
}> {
  const { data, error } = await client
    .from("test_sequences")
    .select(
      `id, name, critic_instruction, final_instruction, user_id, new_user_role, test_sequence_steps (${STEP_FIELDS})`,
    )
    .not("new_user_role", "is", null);
  if (error) throw new Error(error.message);
  const byRole = (role: string) => {
    const row = (data ?? []).find((r: { new_user_role: string }) => r.new_user_role === role);
    return row ? ({ ...row, steps: sortSteps(row.test_sequence_steps) } as LoadedSequence) : null;
  };
  return { default: byRole("default"), alternative: byRole("alternative") };
}

/**
 * Give a brand-new account its starting sequences and return the one that
 * should be active. Prefers whatever an admin has marked "new-user default" and
 * "new-user alternative"; if no General sequence is designated, falls back to
 * building "My sequence" straight from config/defaults.yaml, which is what this
 * app did before admins could curate the starting set.
 */
export async function seedSequencesForUser(client: Client, userId: string): Promise<string> {
  // Read the designated sequences with the service-role client: a designated
  // sequence may be an admin's own, which the signing-up user's RLS client
  // cannot see. The copies themselves are written through `client`, which owns
  // them.
  const { default: designatedDefault, alternative } = await loadNewUserSequences(
    supabaseAdmin as never,
  );

  const alternativeId = alternative ? await copySequenceForUser(client, userId, alternative) : null;

  if (designatedDefault) {
    return copySequenceForUser(client, userId, designatedDefault);
  }
  if (alternativeId) {
    // Only an alternative was designated — point at it rather than leaving the
    // account with nothing selected.
    return alternativeId;
  }

  // Nothing designated at all: fall back to config/defaults.yaml, which is what
  // this app did before admins could curate the starting set.
  const config = await loadDefaultsConfig();
  const { data: row, error } = await client
    .from("test_sequences")
    .insert({
      user_id: userId,
      name: "My sequence",
      critic_instruction: config.critic_instruction,
      final_instruction: config.final_instructions,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await replaceSequenceSteps(
    client,
    row.id,
    config.test_steps.map((s) => ({
      name: s.name,
      description: s.description,
      instruction: s.instruction,
      pass_threshold: s.pass_threshold,
      max_iterations: s.max_iterations,
    })),
  );
  return row.id as string;
}

/**
 * Which sequence a new run should use when the caller didn't pick one: the
 * profile's marked default, else whatever is active (covers profiles whose
 * active sequence is a General one, which is never marked default).
 */
export async function resolveDefaultSequenceId(
  client: Client,
  userId: string,
): Promise<string | null> {
  const { data: settings } = await client
    .from("settings")
    .select("default_sequence_id, active_sequence_id")
    .eq("user_id", userId)
    .maybeSingle();
  return (
    (settings?.default_sequence_id as string | null) ??
    (settings?.active_sequence_id as string | null) ??
    null
  );
}

export type PushResult = { added: number; replaced: number; conflicted: number };

/**
 * Publish a sequence into every profile. The source may be a General row or one
 * the pushing admin owns; either way each profile receives its own copy.
 *
 * Per profile, one of three things happens, and none of them can lose work:
 *  - no copy yet          → it is copied in;
 *  - copy left untouched  → it is overwritten in place; the version it held is
 *                           dropped;
 *  - copy has been edited → theirs is left strictly alone and the new version
 *                           waits under "<name> (new)" behind a rename prompt
 *                           they see on their next visit.
 *
 * A run that started against an overwritten copy follows it to the new content:
 * nothing is kept behind for it to stay pinned to.
 *
 * Expects a service-role client; the caller is responsible for the admin check.
 */
export async function pushSequenceToEveryProfile(
  client: Client,
  sourceId: string,
): Promise<PushResult> {
  const source = await loadSequenceForCopy(client, sourceId);
  if (!source) throw new Error("Not found.");
  if (source.steps.length === 0)
    throw new Error("This sequence has no tests yet — add some before pushing it.");

  const { data: profiles, error: profilesErr } = await client.from("profiles").select("id");
  if (profilesErr) throw new Error(profilesErr.message);

  const result: PushResult = { added: 0, replaced: 0, conflicted: 0 };

  for (const profile of profiles ?? []) {
    const userId = profile.id as string;
    // When an admin pushes one of their own sequences, skip their profile: the
    // source *is* their copy, and matching it against itself would raise a
    // rename conflict with itself.
    if (source.user_id !== null && userId === source.user_id) continue;

    const mineId = await findProfileCopy(client, userId, source);

    if (!mineId) {
      await copySequenceForUser(client, userId, source);
      result.added++;
      continue;
    }

    const mine = await loadSequenceForCopy(client, mineId);
    if (!mine) continue;

    if (isModifiedCopy(mine)) {
      const incomingId = await copySequenceForUser(client, userId, source, {
        name: `${source.name}${NEW_SUFFIX}`,
      });
      const { error } = await client
        .from("sequence_push_conflicts")
        .upsert(
          { user_id: userId, mine_id: mine.id, incoming_id: incomingId, name: source.name },
          { onConflict: "user_id,mine_id" },
        );
      if (error) throw new Error(error.message);
      result.conflicted++;
      continue;
    }

    // Untouched, so it is simply overwritten in place. Updating the existing row
    // rather than swapping in a new one keeps its id stable, so the profile's
    // active/default pointers and any run that started against it stay attached
    // to a live sequence instead of being nulled out.
    const { error: overwriteErr } = await client
      .from("test_sequences")
      .update({
        name: source.name,
        critic_instruction: source.critic_instruction,
        final_instruction: source.final_instruction,
        origin_id: source.id,
        origin_fingerprint: fingerprintSequence({
          name: source.name,
          critic_instruction: source.critic_instruction,
          final_instruction: source.final_instruction,
          steps: source.steps,
        }),
      })
      .eq("id", mine.id);
    if (overwriteErr) throw new Error(overwriteErr.message);
    await replaceSequenceSteps(client, mine.id, source.steps);

    result.replaced++;
  }

  return result;
}

/**
 * The profile's copy of a General sequence: the one we pushed before, or failing
 * that an untracked sequence of theirs already holding the name — which a push
 * then treats as edited, so it raises a rename prompt rather than clobbering it.
 */
async function findProfileCopy(
  client: Client,
  userId: string,
  source: LoadedSequence,
): Promise<string | null> {
  const { data: byOrigin } = await client
    .from("test_sequences")
    .select("id")
    .eq("user_id", userId)
    .eq("origin_id", source.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (byOrigin) return byOrigin.id as string;

  const { data: byName } = await client
    .from("test_sequences")
    .select("id")
    .eq("user_id", userId)
    .eq("name", source.name)
    .is("origin_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return byName ? (byName.id as string) : null;
}

/**
 * Settle one pending rename prompt. Either the user keeps their edited version
 * under a new name, or discards it; either way the pushed version then takes the
 * canonical name and the prompt goes away.
 */
export async function resolveConflict(
  client: Client,
  userId: string,
  input: { conflictId: string; action: "rename" | "discard"; newName?: string | undefined },
): Promise<{ ok: true }> {
  const { data: conflict, error: readErr } = await client
    .from("sequence_push_conflicts")
    .select("id, name, mine_id, incoming_id")
    .eq("id", input.conflictId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!conflict) throw new Error("That update has already been dealt with.");

  if (input.action === "rename") {
    const newName = input.newName?.trim();
    if (!newName) throw new Error("Give your version a name.");
    if (newName === conflict.name)
      throw new Error(
        `"${conflict.name}" is the name the updated version will take — pick a different one for yours.`,
      );
    const { data: clash } = await client
      .from("test_sequences")
      .select("id")
      .eq("user_id", userId)
      .eq("name", newName)
      .neq("id", conflict.mine_id)
      .limit(1)
      .maybeSingle();
    if (clash) throw new Error(`You already have a sequence called "${newName}".`);

    const { error } = await client
      .from("test_sequences")
      .update({ name: newName })
      .eq("id", conflict.mine_id);
    if (error) throw new Error(error.message);
    // Keeping their edit makes it theirs outright — no future push claims it.
    const { error: detachErr } = await client
      .from("test_sequences")
      .update({ origin_id: null, origin_fingerprint: null })
      .eq("id", conflict.mine_id);
    if (detachErr) throw new Error(detachErr.message);
  } else {
    // Discarding theirs hands its roles to the incoming version.
    const { error: activeErr } = await client
      .from("settings")
      .update({ active_sequence_id: conflict.incoming_id })
      .eq("user_id", userId)
      .eq("active_sequence_id", conflict.mine_id);
    if (activeErr) throw new Error(activeErr.message);
    const { error: defaultErr } = await client
      .from("settings")
      .update({ default_sequence_id: conflict.incoming_id })
      .eq("user_id", userId)
      .eq("default_sequence_id", conflict.mine_id);
    if (defaultErr) throw new Error(defaultErr.message);
    const { error: delErr } = await client
      .from("test_sequences")
      .delete()
      .eq("id", conflict.mine_id);
    if (delErr) throw new Error(delErr.message);
  }

  const { error: renameErr } = await client
    .from("test_sequences")
    .update({ name: conflict.name })
    .eq("id", conflict.incoming_id);
  if (renameErr) throw new Error(renameErr.message);

  // Deleting their row cascades the conflict away; this covers the rename path.
  await client.from("sequence_push_conflicts").delete().eq("id", conflict.id);
  return { ok: true };
}
