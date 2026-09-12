-- A push no longer keeps a "<name> (old)" copy behind.
--
-- Before: when a push found a profile's copy untouched, it renamed that copy to
-- "<name> (old)", stamped archived_at on it and inserted the new version
-- alongside — one keepsake per name, kept so an in-flight run could go on
-- following the wording it started against.
--
-- After: the untouched copy is overwritten in place and the version it held is
-- simply dropped. Updating the row rather than replacing it keeps its id stable,
-- so a profile's active/default pointers and any run that started against it stay
-- attached to a live sequence instead of being nulled out. The trade-off is that
-- a run already under way now follows the new wording.
--
-- Defensive: test_sequences.archived_at is LEFT IN PLACE and simply stops being
-- read or written. Any row still carrying it is an ordinary sequence now, so the
-- stale marks are cleared to avoid a half-state, but the "(old)" rows themselves
-- are kept — they are real sequences someone may still be using.

UPDATE public.test_sequences SET archived_at = NULL WHERE archived_at IS NOT NULL;
