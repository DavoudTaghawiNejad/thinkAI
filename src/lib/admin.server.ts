import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadDefaultsConfig } from "./defaults-config.server";

/**
 * Resolve whether a user may manage the general test sequences — publishing
 * one, withdrawing one, or marking which one new profiles start with. A user is
 * an admin if profiles.is_admin is set, or
 * if their email is listed in admin_emails in config/defaults.yaml — in which
 * case we also flip the flag so it sticks. Returns the user's email too, since
 * callers often already need it.
 */
export async function resolveAdmin(
  userId: string,
  claims: Record<string, unknown> | undefined,
): Promise<{ isAdmin: boolean; email: string | null }> {
  let email = typeof claims?.["email"] === "string" ? (claims["email"] as string) : null;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.is_admin) return { isAdmin: true, email };

  if (!email) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    email = data.user?.email ?? null;
  }

  const config = await loadDefaultsConfig();
  const listed =
    email != null && config.admin_emails.some((e) => e.toLowerCase() === email!.toLowerCase());

  if (listed) {
    await supabaseAdmin.from("profiles").update({ is_admin: true }).eq("id", userId);
    return { isAdmin: true, email };
  }

  return { isAdmin: false, email };
}

export async function requireAdmin(
  userId: string,
  claims: Record<string, unknown> | undefined,
): Promise<void> {
  const { isAdmin } = await resolveAdmin(userId, claims);
  if (!isAdmin) throw new Error("Only an admin can manage the general test sequences.");
}
