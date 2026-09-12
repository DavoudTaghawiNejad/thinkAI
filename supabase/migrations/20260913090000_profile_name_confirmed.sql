-- A profile's display_name has always been derived at signup — from signup
-- metadata if there was any, otherwise from the local part of the email. That
-- guess is fine to greet someone with, but it is not a name they chose.
--
-- This flag records whether the name on the profile came from the person it
-- belongs to. A profile that has not confirmed one is asked, once, after
-- signing in; the derived name is offered as the suggestion, so answering is
-- a keystroke and nothing is lost by having guessed.
--
-- Existing profiles start unconfirmed and keep the name they have: no
-- display_name is read, written or cleared here.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name_confirmed BOOLEAN NOT NULL DEFAULT false;
