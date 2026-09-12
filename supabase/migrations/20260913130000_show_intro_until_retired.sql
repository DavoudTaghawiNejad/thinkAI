-- The introduction is no longer a one-off: it greets every visit until the
-- profile clicks "Do not show again", which is what intro_seen_at now records.
--
-- 20260912210000 stamped every profile as "already seen" — right when seeing it
-- once was the whole behaviour, wrong now: it would leave existing accounts with
-- no introduction and no button to retire. Clear the stamps so the greeting is
-- offered to everyone, and one click retires it per profile.
UPDATE public.profiles SET intro_seen_at = NULL;
