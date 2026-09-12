-- Let an admin designate any sequence they can edit — their own included — as
-- what new accounts start with.
--
-- 20260911120000 scoped the new-account roles to General rows (user_id IS NULL).
-- That turned out to be unreachable in practice: every sequence created through
-- the app is owned by its creator, so there is no way to make a General one, and
-- the only General row in existence is the seeded "Default". An admin therefore
-- had nothing they could mark. Widening the uniqueness constraint to cover all
-- rows lets an admin point new accounts at one of their own sequences; new
-- profiles get a copy either way, and RLS still hides the admin's original.

DROP INDEX public.test_sequences_one_new_user_role;

-- Still at most one new-account default and one alternative, but now across
-- every sequence rather than only the ownerless ones.
CREATE UNIQUE INDEX test_sequences_one_new_user_role
  ON public.test_sequences (new_user_role)
  WHERE new_user_role IS NOT NULL;
