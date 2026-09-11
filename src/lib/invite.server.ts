import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDefaultsConfig } from "./defaults-config.server";

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

  // The default preset/sequence/settings provisioning lives here, read fresh
  // from config/defaults.yaml (the DB trigger only creates the profile row — see
  // supabase/migrations/*_centralize_defaults.sql).
  const config = await loadDefaultsConfig();
  const userId = created.user.id;

  const { data: preset } = await supabaseAdmin
    .from("instruction_presets")
    .insert({
      user_id: userId,
      name: "My instructions",
      critic_instruction: config.critic_instruction,
      final_instruction: config.final_instructions,
    })
    .select("id")
    .single();

  const { data: sequence } = await supabaseAdmin
    .from("test_sequences")
    .insert({ user_id: userId, name: "My sequence" })
    .select("id")
    .single();

  await supabaseAdmin
    .from("test_sequence_steps")
    .insert(
      config.test_steps.map((step, position) => ({
        sequence_id: sequence!.id,
        position,
        ...step,
      })),
    );

  await supabaseAdmin.from("settings").insert({
    user_id: userId,
    critic_model: config.critic_model,
    final_model: config.final_model,
    debug_mode: config.debug_mode,
    active_preset_id: preset!.id,
    active_sequence_id: sequence!.id,
  });

  return { ok: true };
}
