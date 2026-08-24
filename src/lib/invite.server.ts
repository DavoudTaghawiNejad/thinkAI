import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

  const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (createErr) throw new Error(createErr.message);

  return { ok: true };
}
