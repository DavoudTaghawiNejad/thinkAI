-- Default settings/test-step provisioning for new users now happens in application
-- code (src/lib/invite.server.ts), sourced from src/lib/forge.shared.ts — the single
-- place those defaults are edited. This trigger no longer duplicates that content;
-- it only creates the profile row, which genuinely belongs in the database (it reads
-- NEW.raw_user_meta_data/NEW.email, values only the trigger has direct access to).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
