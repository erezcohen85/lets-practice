-- The parts a job could not read (Phase 8, task 8.15). A job that reads several parts no longer
-- fails when one of them cannot be read: it leaves that part out, saves the others, and lists the
-- part here as {id, name, error} (the score_files id, the part's name, and the reason in one
-- sentence), so the app can say which part was skipped and why. Empty for a job that read every
-- part; a job that could read none ends as `error` and still lists them.
-- A column only: the jobs policies of 0001 already cover it, so no table, policy or index is added.

alter table public.jobs
  add column failed_parts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(failed_parts) = 'array');
