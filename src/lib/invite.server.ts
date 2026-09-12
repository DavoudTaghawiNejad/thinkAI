import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDefaultsConfig } from "./defaults-config.server";
import { seedSequencesForUser } from "./sequences.server";

export async function redeemInviteAndCreateUser(input: {
  email: string;
  password: string;
  key: string;
}) {
  const { data: deleted, error: delErr } = await supabaseAdmin
    .from("invite_keys")
    .delete()
    .eq("key", input.key)
    .select("key")
    .maybeSingle();
  if (delErr) throw new Error(delErr.message);
  if (!deleted) throw new Error("Invalid or already-used invitation key.");

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (createErr) throw new Error(createErr.message);

  // Settings + starting sequences are provisioned here (the DB trigger only
  // creates the profile row — see supabase/migrations/*_centralize_defaults.sql).
  // Models come fresh from config/defaults.yaml; the sequences — instructions and
  // tests together — come from whatever an admin has marked "new-account
  // default"/"new-account alternative", falling back to that same file.
  const config = await loadDefaultsConfig();
  const userId = created.user.id;

  const activeSequenceId = await seedSequencesForUser(supabaseAdmin, userId);

  await supabaseAdmin.from("settings").insert({
    user_id: userId,
    critic_model: config.critic_model,
    final_model: config.final_model,
    debug_mode: config.debug_mode,
    active_sequence_id: activeSequenceId,
  });

  return { ok: true };
}
