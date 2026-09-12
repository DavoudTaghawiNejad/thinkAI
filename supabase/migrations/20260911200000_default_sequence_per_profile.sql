-- Any sequence can be a profile's default, General ones included.
--
-- Before: the default was a boolean on the sequence row (test_sequences.is_default).
-- That can only express "this row is the default" — fine for a sequence a profile
-- owns, meaningless for a shared General row, which every profile can see. So
-- "Make default" had to be refused for General sequences, and the star was greyed
-- out on exactly the sequences people most wanted to start from.
--
-- After: the default is a pointer on the profile, so each profile can point at
-- whatever it likes — its own, a superseded "(old)" copy, or a General one — with
-- no interference between profiles.
--
-- Defensive: test_sequences.is_default and its unique index are LEFT IN PLACE and
-- simply stop being read or written. The values are copied into the new pointer
-- below, so nothing is lost, and the column can be dropped in a later migration
-- once this has been seen working.

ALTER TABLE public.settings
  ADD COLUMN default_sequence_id UUID REFERENCES public.test_sequences ON DELETE SET NULL;

-- Carry every profile's starred sequence over to the pointer.
UPDATE public.settings s
  SET default_sequence_id = q.id
  FROM public.test_sequences q
  WHERE q.user_id = s.user_id AND q.is_default;

-- A profile that had nothing starred keeps whatever it had active, so the
-- home-page picker opens on the same sequence as before.
UPDATE public.settings
  SET default_sequence_id = active_sequence_id
  WHERE default_sequence_id IS NULL;
