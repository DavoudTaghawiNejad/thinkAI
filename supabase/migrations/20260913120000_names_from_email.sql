-- Every profile has a name: the part of the email before the @, unless signup
-- supplied a better one. That was already how public.handle_new_user() filled
-- display_name, so this only settles the column for rows that predate it and
-- makes the guarantee explicit — after which no code needs to ask whether a
-- profile has a name, or to prompt for one.
UPDATE public.profiles p
SET display_name = split_part(u.email, '@', 1)
FROM auth.users u
WHERE u.id = p.id
  AND NULLIF(TRIM(COALESCE(p.display_name, '')), '') IS NULL;

-- A profile with no email at all (none exist: profiles.id references
-- auth.users) would still be NULL above, so fall back to something printable
-- before the constraint goes on.
UPDATE public.profiles
SET display_name = 'you'
WHERE NULLIF(TRIM(COALESCE(display_name, '')), '') IS NULL;

ALTER TABLE public.profiles ALTER COLUMN display_name SET NOT NULL;

-- With a name always present, there is nothing to confirm. The flag added in
-- 20260913090000 only ever recorded whether the ask had happened; the ask is
-- gone, and no name is lost by dropping it.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS display_name_confirmed;
