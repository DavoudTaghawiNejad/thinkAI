-- When the introduction was first put in front of this profile. intro_seen_at
-- cannot answer that — it records the "Do not show again" click, which may never
-- come — and the two answers differ: on the first showing the way out is offered
-- only at the end, after the case has been made, and on every showing after it
-- from any slide.
--
-- NULL means "not shown yet", so existing profiles get a first showing. Nothing
-- else is read or written here.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS intro_shown_at TIMESTAMPTZ;
