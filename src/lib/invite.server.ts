import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDefaultsConfig } from "./defaults-config.server";
import { resolveNewUserSequenceId } from "./sequences.server";

export async function redeemInviteAndCreateUser(input: {
  email: string;
  password: string;
  key: string;
  displayName: string;
}) {
  const { data: deleted, error: delErr } = await supabaseAdmin
    .from("invite_keys")
    .delete()
    .eq("key", input.key)
    .select("key")
    .maybeSingle();
  if (delErr) throw new Error(delErr.message);
  if (!deleted) throw new Error("Invalid or already-used invitation key.");

  // handle_new_user() reads display_name out of this metadata, so the name they
  // typed is on the profile from the moment it exists.
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (createErr) throw new Error(createErr.message);

  // Settings are provisioned here (the DB trigger only creates the profile row
  // — see supabase/migrations/*_centralize_defaults.sql). Models come fresh from
  // config/defaults.yaml. No sequences are created: the general set is readable
  // by every profile, so a new account simply starts pointed at whichever
  // general sequence an admin marked for new profiles.
  const config = await loadDefaultsConfig();
  const userId = created.user.id;

  // They named themselves on the signup form, so there is nothing left to ask.
  await supabaseAdmin
    .from("profiles")
    .update({ display_name: input.displayName, display_name_confirmed: true })
    .eq("id", userId);

  await supabaseAdmin.from("settings").insert({
    user_id: userId,
    critic_model: config.critic_model,
    final_model: config.final_model,
    debug_mode: config.debug_mode,
    default_sequence_id: await resolveNewUserSequenceId(supabaseAdmin),
  });

  return { ok: true };
}
