-- Names the user can change (Phase 8, task 8.10). score_files.name_source says where a part's name
-- came from: 'read' (the vision read found it in the part's header), 'user' (typed on New piece or
-- Add part, or renamed on the hub or in the editor) or 'file' (made from the PDF's file name when
-- nothing was typed and nothing could be read). The processor replaces a 'read' or 'file' name
-- with the one it reads and never touches a 'user' name; renaming in the app sets 'user'.
-- audio_sources.name is what the hub shows for the recording: the uploaded file's name without its
-- extension or the video's title, until the user renames it (1 to 120 characters; null = not
-- named yet, the app then shows the file name or the link).
-- Columns only: the score_files and audio_sources policies of 0001 (select, insert, update and
-- delete through the piece's owner) already cover them, including the update a rename makes, so no
-- table, policy or index is added.

alter table public.score_files
  add column name_source text not null default 'file' check (name_source in ('read', 'user', 'file'));

alter table public.audio_sources
  add column name text check (char_length(name) between 1 and 120);
