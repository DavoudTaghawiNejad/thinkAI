-- The seven-slide introduction is shown once, to a profile that has never seen
-- it. The marker lives on the profile rather than in the browser so it holds
-- across devices and sessions.
--
-- Nothing is dropped here. Existing profiles are backfilled as "already seen":
-- the overlay introduces thinkAI to someone arriving for the first time, and
-- accounts that have been working for weeks should not be handed a tour.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS intro_seen_at TIMESTAMPTZ;

UPDATE public.profiles SET intro_seen_at = now() WHERE intro_seen_at IS NULL;

-- No DEFAULT on the column, so profiles created from here on start NULL and get
-- the introduction. public.handle_new_user() needs no change for that.
