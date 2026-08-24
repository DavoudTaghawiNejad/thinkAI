import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_CRITIC_INSTRUCTION,
  DEFAULT_CRITIC_MODEL,
  DEFAULT_FINAL_MODEL,
  DEFAULT_DEBUG_MODE,
  DEFAULT_TEST_STEPS,
} from "./forge.shared";

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

  // The default settings/test-step provisioning lives here, sourced from forge.shared.ts,
  // so it stays in sync with the one place those defaults are edited (the DB trigger only
  // creates the profile row — see supabase/migrations/*_centralize_defaults.sql).
  const userId = created.user.id;
  await supabaseAdmin.from("settings").insert({
    user_id: userId,
    critic_instruction: DEFAULT_CRITIC_INSTRUCTION,
    critic_model: DEFAULT_CRITIC_MODEL,
    final_model: DEFAULT_FINAL_MODEL,
    debug_mode: DEFAULT_DEBUG_MODE,
  });
  await supabaseAdmin
    .from("test_steps")
    .insert(DEFAULT_TEST_STEPS.map((step, position) => ({ user_id: userId, position, ...step })));

  return { ok: true };
}
