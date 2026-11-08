-- What a piece remembers of Practice (Phase 7, task 7.5). The browser saves it as one jsonb object
-- per piece: the metronome (on, volume, tone), the music volume, the speed, the last loop (with
-- its start pass) and whether it was on (loopOn), and "Count in every repeat". An empty object means nothing is
-- remembered yet; the app fills in the defaults and ignores any value it does not recognise. Two columns and the jobs check below: the
-- pieces policies of 0001 already cover it, so no table, policy or index is added.

alter table public.pieces
  add column practice jsonb not null default '{}'::jsonb check (jsonb_typeof(practice) = 'object');

-- The part the editor or Practice opened last, for every user of the piece: the hub's Practice and Edit map buttons
-- open it. Null before a part was opened, and again if that part is deleted (the app then opens the first part).
alter table public.pieces
  add column last_part_id uuid references public.score_files (id) on delete set null;

-- A job that adds parts to a piece that already exists (the hub's "Add part"): processes only the new parts and leaves
-- the shared timing alone. The check of 0001 was written inline on the column, so Postgres named it jobs_kind_check.
alter table public.jobs
  drop constraint jobs_kind_check,
  add constraint jobs_kind_check check (kind in ('process-piece', 'realign', 'add-parts'));
