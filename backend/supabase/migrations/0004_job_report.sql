-- What a finished job tells the user, and where the playback copy of the recording is (Phase 8,
-- task 8.7). The processor writes the warnings of a job (a part with another bar count, a score
-- read without the vision model) as a jsonb array of sentences, and what the vision read cost in
-- US dollars; both stay at their defaults (empty, null) until the job is done. audio_sources keeps
-- the path in the pieces bucket of the AAC .m4a the app plays ({user_id}/{piece_id}/audio.m4a),
-- null until the audio is read; `duration` of 0001 is filled in at the same time.
-- Columns only: the jobs and audio_sources policies of 0001 already cover them, so no table, policy
-- or index is added.
--
-- play_order.marks needs no change: it is a jsonb array with no check on the kinds, and the
-- processor now also writes {bar, kind: "rit"} (one per bar of a rit., rall. or accel. span)
-- beside "fermata" and "rest"; the comment on it in 0001 lists only the first two.

alter table public.jobs
  add column warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  add column cost_usd numeric;

alter table public.audio_sources
  add column stored_path text;
