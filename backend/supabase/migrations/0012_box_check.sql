-- Advanced Reading online (UX polish, Task 10). The tick on a part row in New piece and Add part says "have a vision model
-- check this part's bar boxes". The browser saves the tick with the part, and the processor's job reads it: it checks the
-- parts that have it and writes what it finds to box_flags (0009), which the Review Queue shows.
--
-- One column on an existing table, so no new table and no new policy. The table-level grants of 0009 already give
-- authenticated select, insert, update and delete on score_files (guarded by the owner policies of 0001) and give
-- service_role the same, so the column needs no grant of its own. The new column starts false: every existing part and any
-- part added by an older browser is read as before.

alter table public.score_files
  add column box_check boolean not null default false;
