/**
 * Everything that reasons about a test sequence as a *shared* thing: the
 * general set, publishing into it, and which sequence a profile or a run falls
 * back to.
 *
 * ## The two kinds
 *
 * A sequence is either **general** (`user_id IS NULL`) or **personal**
 * (`user_id` = its owner). General sequences are visible to every profile and
 * editable by nobody — not even an admin, and not even the admin who published
 * one. Personal sequences are private and always freely editable; editing one
 * has no effect on anyone else.
 *
 * ## Publishing
 *
 * An admin publishes one of their personal sequences into the general set. The
 * general row records `published_from`, so publishing the same source again
 * finds it and rewrites it **in place** — same id, so every profile pointing at
 * it and every run started against it stays attached to a live sequence. The
 * admin's personal source stays theirs to keep editing; nothing they type
 * reaches anyone until they publish again.
 */

type Client = { from: (table: string) => any };

export type SequenceStepInput = {
  name: string;
  description: string;
  instruction: string;
  pass_threshold: number;
  max_iterations: number;
};

/** The columns that make up a sequence's identity for copying and publishing. */
const STEP_FIELDS = "name, description, instruction, pass_threshold, max_iterations, position";

export type LoadedSequence = {
  id: string;
  name: string;
  critic_instruction: string;
  final_instruction: string;
  user_id: string | null;
  steps: SequenceStepInput[];
};

/** Read one sequence with its steps in order, shaped for copying. */
export async function loadSequenceForCopy(
  client: Client,
  id: string,
): Promise<LoadedSequence | null> {
  const { data, error } = await client
    .from("test_sequences")
    .select(
      `id, name, critic_instruction, final_instruction, user_id, test_sequence_steps (${STEP_FIELDS})`,
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

/** Write a copy of `source` into `userId`'s own library. */
export async function copySequenceForUser(
  client: Client,
  userId: string,
  source: {
    name: string;
    critic_instruction: string;
    final_instruction: string;
    steps: SequenceStepInput[];
  },
  options: { name?: string } = {},
): Promise<string> {
  const { data: row, error } = await client
    .from("test_sequences")
    .insert({
      user_id: userId,
      name: options.name ?? source.name,
      critic_instruction: source.critic_instruction,
      final_instruction: source.final_instruction,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await replaceSequenceSteps(client, row.id, source.steps);
  return row.id as string;
}

/**
 * Where a brand-new profile's default points: the general sequence an admin
 * marked for it, else the oldest general one, else nothing at all (an install
 * with no general sequences yet — the profile picks one itself, and the run
 * falls back the same way).
 */
export async function resolveNewUserSequenceId(client: Client): Promise<string | null> {
  const { data } = await client
    .from("test_sequences")
    .select("id")
    .is("user_id", null)
    .order("is_new_user_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Which sequence a new run uses when the caller didn't pick one: the profile's
 * default, else where a new profile would start.
 */
export async function resolveDefaultSequenceId(
  client: Client,
  userId: string,
): Promise<string | null> {
  const { data: settings } = await client
    .from("settings")
    .select("default_sequence_id")
    .eq("user_id", userId)
    .maybeSingle();
  const id = (settings?.default_sequence_id as string | null) ?? null;
  if (id) return id;
  // The general set is readable under any client, so this needs no escalation.
  return resolveNewUserSequenceId(client);
}

export type PublishResult = { id: string; created: boolean };

/**
 * Publish one of an admin's personal sequences into the general set, so every
 * profile can use it.
 *
 * Re-publishing the same source rewrites the general row it produced, in place:
 * the id survives, so profiles defaulting to it and runs started against it
 * follow the new version instead of being cut loose. A general row that
 * predates publishing (no `published_from`) is adopted by name on the first
 * publish that matches it, rather than colliding with it.
 *
 * Expects a service-role client — general rows are unwritable under RLS by
 * design. The caller is responsible for the admin check and for confirming the
 * source belongs to them.
 */
export async function publishSequenceAsGeneral(
  client: Client,
  sourceId: string,
): Promise<PublishResult> {
  const source = await loadSequenceForCopy(client, sourceId);
  if (!source) throw new Error("Not found.");
  if (source.user_id === null)
    throw new Error("That is already a general sequence. Publish one of your own instead.");
  if (source.steps.length === 0)
    throw new Error("This sequence has no tests yet — add some before publishing it.");

  const existing = await findGeneralRowFor(client, source);

  // The name is how everyone identifies a general sequence, so it may not be
  // taken by a different one.
  const { data: clash } = await client
    .from("test_sequences")
    .select("id")
    .is("user_id", null)
    .eq("name", source.name)
    .limit(1)
    .maybeSingle();
  if (clash && clash.id !== existing?.id)
    throw new Error(
      `A different general sequence is already called “${source.name}”. Rename yours, or re-publish the one that holds the name.`,
    );

  const fields = {
    name: source.name,
    critic_instruction: source.critic_instruction,
    final_instruction: source.final_instruction,
    published_from: source.id,
  };

  if (existing) {
    const { error } = await client.from("test_sequences").update(fields).eq("id", existing.id);
    if (error) throw new Error(error.message);
    await replaceSequenceSteps(client, existing.id, source.steps);
    return { id: existing.id, created: false };
  }

  const { data: row, error } = await client
    .from("test_sequences")
    .insert({ user_id: null, ...fields })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await replaceSequenceSteps(client, row.id, source.steps);
  return { id: row.id as string, created: true };
}

/** The general row this source has already produced, if any. */
async function findGeneralRowFor(
  client: Client,
  source: LoadedSequence,
): Promise<{ id: string } | null> {
  const { data: byOrigin } = await client
    .from("test_sequences")
    .select("id")
    .is("user_id", null)
    .eq("published_from", source.id)
    .limit(1)
    .maybeSingle();
  if (byOrigin) return byOrigin as { id: string };

  // No link yet, but a general sequence already holds the name: this is a
  // re-publish of a row that predates publishing (the seeded "Default", or one
  // published from a source since deleted). Adopt it rather than refusing.
  const { data: byName } = await client
    .from("test_sequences")
    .select("id")
    .is("user_id", null)
    .eq("name", source.name)
    .is("published_from", null)
    .limit(1)
    .maybeSingle();
  return byName ? (byName as { id: string }) : null;
}

/**
 * Take a general sequence back out of the general set. Profiles that had it as
 * their default fall back to where a new profile starts; runs already finished
 * keep their recorded steps. Expects a service-role client after an admin check.
 */
export async function withdrawGeneralSequence(client: Client, id: string): Promise<void> {
  const { data: row, error: readErr } = await client
    .from("test_sequences")
    .select("id, user_id, is_new_user_default")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("Not found.");
  if (row.user_id !== null) throw new Error("That is not a general sequence.");
  if (row.is_new_user_default)
    throw new Error(
      "This is what new profiles start with. Mark another general sequence as that first.",
    );

  const { error } = await client.from("test_sequences").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Mark one general sequence as what brand-new profiles start pointed at. */
export async function setNewUserDefaultSequence(client: Client, id: string): Promise<void> {
  const { data: row, error: readErr } = await client
    .from("test_sequences")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("Not found.");
  if (row.user_id !== null)
    throw new Error("Only a general sequence can be what new profiles start with.");

  // Only one row may carry the flag, so the old holder is cleared first.
  const { error: clearErr } = await client
    .from("test_sequences")
    .update({ is_new_user_default: false })
    .eq("is_new_user_default", true);
  if (clearErr) throw new Error(clearErr.message);
  const { error } = await client
    .from("test_sequences")
    .update({ is_new_user_default: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
