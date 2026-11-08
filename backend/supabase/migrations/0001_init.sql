-- Let's Practice: initial schema (spec section 7, plus parts and the piece-level structure).
-- Row-level security and the storage bucket policy come in task 3.2, at the end of this file.
-- Deleting a piece cascades to every child row; the app deletes the storage files itself.

-- profiles: one row per signed-in user, created by a trigger on auth.users (task 3.2).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  accepted_terms_at timestamptz, -- null until the user accepts the terms
  settings jsonb not null default '{}'::jsonb
);

-- pieces: one practice piece (parts and one recording).
create table public.pieces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  count_in_bars smallint not null default 1 check (count_in_bars between 0 and 4), -- count-in length for Practice, 0 = off (per piece)
  created_at timestamptz not null default now()
);
create index pieces_owner_id_idx on public.pieces (owner_id);

-- score_files: one PDF per part (an instrument) of a piece.
create table public.score_files (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces (id) on delete cascade,
  storage_path text not null,
  sha256 text not null,
  page_count integer not null check (page_count >= 1),
  name text not null, -- the part name, for example "Clarinet in Bb 1"
  position integer not null default 0 check (position >= 0) -- order in the hub
);
create index score_files_piece_id_idx on public.score_files (piece_id);

-- score_pages: one rendered image per PDF page.
create table public.score_pages (
  id uuid primary key default gen_random_uuid(),
  score_file_id uuid not null references public.score_files (id) on delete cascade,
  page_index integer not null check (page_index >= 0),
  image_path text not null,
  width integer not null check (width > 0), -- image size in pixels
  height integer not null check (height > 0),
  unique (score_file_id, page_index)
);
create index score_pages_score_file_id_idx on public.score_pages (score_file_id);

-- bars: the page layer, one box per bar of a part (pixels on the page image).
create table public.bars (
  id uuid primary key default gen_random_uuid(),
  score_file_id uuid not null references public.score_files (id) on delete cascade,
  bar_number integer not null check (bar_number >= 1),
  page_index integer not null check (page_index >= 0),
  x double precision not null,
  y double precision not null,
  w double precision not null check (w > 0),
  h double precision not null check (h > 0),
  time_sig text check (time_sig ~ '^[1-9][0-9]*/[1-9][0-9]*$'), -- the part's own detected meter, "3/4"
  unique (score_file_id, bar_number)
);
create index bars_score_file_id_idx on public.bars (score_file_id);

-- audio_sources: the recording of a piece, a YouTube link or an uploaded file.
create table public.audio_sources (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces (id) on delete cascade,
  kind text not null check (kind in ('youtube', 'file')),
  url_or_path text not null,
  duration double precision check (duration > 0) -- seconds; null until the audio is read
);
create index audio_sources_piece_id_idx on public.audio_sources (piece_id);

-- play_order: the piece-level structure, one row per piece.
--   rows   [{from, to}]                         the confirmed play order
--   meters [{from_bar, numerator, denominator}] shared timing (all parts follow it)
--   marks  [{bar, kind}]                        kind is fermata or rest
create table public.play_order (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces (id) on delete cascade,
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  meters jsonb not null default '[]'::jsonb check (jsonb_typeof(meters) = 'array'),
  marks jsonb not null default '[]'::jsonb check (jsonb_typeof(marks) = 'array')
);
-- Unique per piece; this index is also the foreign-key index for piece_id.
create unique index play_order_piece_id_key on public.play_order (piece_id);

-- locators: the timing layer, one row per bar per pass (a repeated bar has several).
create table public.locators (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces (id) on delete cascade,
  pass_index integer not null check (pass_index >= 0),
  bar_number integer not null check (bar_number >= 1),
  time_sec double precision not null check (time_sec >= 0),
  confirmed boolean not null default false, -- confirmed locators are fixed anchors for realign
  unique (piece_id, bar_number, pass_index)
);
create index locators_piece_id_idx on public.locators (piece_id);

-- jobs: processor runs; the processor writes them, the browser polls them.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null references public.pieces (id) on delete cascade,
  kind text not null check (kind in ('process-piece', 'realign')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  progress real not null default 0 check (progress between 0 and 1),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now() -- the processor sets it on every update
);
create index jobs_piece_id_idx on public.jobs (piece_id);

-- Row-level security (task 3.2)

-- Every table is locked down: with row-level security on and no policy, nobody gets any row.
-- The policies below open exactly one door per command, to signed-in users, for their own data.
-- Policy expressions write (select auth.uid()) so Postgres evaluates it once per statement.
-- The processor uses the server-side key, which bypasses these policies; it checks ownership itself.

alter table public.profiles enable row level security;
alter table public.pieces enable row level security;
alter table public.score_files enable row level security;
alter table public.score_pages enable row level security;
alter table public.bars enable row level security;
alter table public.audio_sources enable row level security;
alter table public.play_order enable row level security;
alter table public.locators enable row level security;
alter table public.jobs enable row level security;

-- profiles: a user sees and edits only their own row (the trigger below creates it).
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- pieces: owned directly.
create policy pieces_select_own on public.pieces
  for select to authenticated
  using (owner_id = (select auth.uid()));
create policy pieces_insert_own on public.pieces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy pieces_update_own on public.pieces
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy pieces_delete_own on public.pieces
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Direct children of pieces (score_files, audio_sources, play_order, locators): owned through the piece.
create policy score_files_select_own on public.score_files
  for select to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
  ));
create policy score_files_insert_own on public.score_files
  for insert to authenticated
  with check (exists (
    select 1 from public.pieces p
    where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
  ));
create policy score_files_update_own on public.score_files
  for update to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.pieces p
    where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
  ));
create policy score_files_delete_own on public.score_files
  for delete to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
  ));

create policy audio_sources_select_own on public.audio_sources
  for select to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = audio_sources.piece_id and p.owner_id = (select auth.uid())
  ));
create policy audio_sources_insert_own on public.audio_sources
  for insert to authenticated
  with check (exists (
    select 1 from public.pieces p
    where p.id = audio_sources.piece_id and p.owner_id = (select auth.uid())
  ));
create policy audio_sources_update_own on public.audio_sources
  for update to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = audio_sources.piece_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.pieces p
    where p.id = audio_sources.piece_id and p.owner_id = (select auth.uid())
  ));
create policy audio_sources_delete_own on public.audio_sources
  for delete to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = audio_sources.piece_id and p.owner_id = (select auth.uid())
  ));

create policy play_order_select_own on public.play_order
  for select to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = play_order.piece_id and p.owner_id = (select auth.uid())
  ));
create policy play_order_insert_own on public.play_order
  for insert to authenticated
  with check (exists (
    select 1 from public.pieces p
    where p.id = play_order.piece_id and p.owner_id = (select auth.uid())
  ));
create policy play_order_update_own on public.play_order
  for update to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = play_order.piece_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.pieces p
    where p.id = play_order.piece_id and p.owner_id = (select auth.uid())
  ));
create policy play_order_delete_own on public.play_order
  for delete to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = play_order.piece_id and p.owner_id = (select auth.uid())
  ));

create policy locators_select_own on public.locators
  for select to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = locators.piece_id and p.owner_id = (select auth.uid())
  ));
create policy locators_insert_own on public.locators
  for insert to authenticated
  with check (exists (
    select 1 from public.pieces p
    where p.id = locators.piece_id and p.owner_id = (select auth.uid())
  ));
create policy locators_update_own on public.locators
  for update to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = locators.piece_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.pieces p
    where p.id = locators.piece_id and p.owner_id = (select auth.uid())
  ));
create policy locators_delete_own on public.locators
  for delete to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = locators.piece_id and p.owner_id = (select auth.uid())
  ));

-- jobs: the owner can read and poll them; only the processor (server key) writes them.
create policy jobs_select_own on public.jobs
  for select to authenticated
  using (exists (
    select 1 from public.pieces p
    where p.id = jobs.piece_id and p.owner_id = (select auth.uid())
  ));

-- Grandchildren (score_pages, bars): owned through score_files, then the piece.
create policy score_pages_select_own on public.score_pages
  for select to authenticated
  using (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = score_pages.score_file_id and p.owner_id = (select auth.uid())
  ));
create policy score_pages_insert_own on public.score_pages
  for insert to authenticated
  with check (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = score_pages.score_file_id and p.owner_id = (select auth.uid())
  ));
create policy score_pages_update_own on public.score_pages
  for update to authenticated
  using (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = score_pages.score_file_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = score_pages.score_file_id and p.owner_id = (select auth.uid())
  ));
create policy score_pages_delete_own on public.score_pages
  for delete to authenticated
  using (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = score_pages.score_file_id and p.owner_id = (select auth.uid())
  ));

create policy bars_select_own on public.bars
  for select to authenticated
  using (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = bars.score_file_id and p.owner_id = (select auth.uid())
  ));
create policy bars_insert_own on public.bars
  for insert to authenticated
  with check (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = bars.score_file_id and p.owner_id = (select auth.uid())
  ));
create policy bars_update_own on public.bars
  for update to authenticated
  using (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = bars.score_file_id and p.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = bars.score_file_id and p.owner_id = (select auth.uid())
  ));
create policy bars_delete_own on public.bars
  for delete to authenticated
  using (exists (
    select 1 from public.score_files f
    join public.pieces p on p.id = f.piece_id
    where f.id = bars.score_file_id and p.owner_id = (select auth.uid())
  ));

-- Storage: one private bucket, "pieces". Object paths are {user_id}/{piece_id}/..., so the first
-- folder of a path is the owner. RLS is already enabled on storage.objects by Supabase.
insert into storage.buckets (id, name, public)
values ('pieces', 'pieces', false)
on conflict (id) do nothing;

create policy pieces_objects_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pieces_objects_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pieces_objects_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'pieces' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pieces_objects_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'pieces' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Profile creation: every new auth user gets a profiles row. security definer lets the trigger
-- write the row whoever signs up; the empty search_path forces fully qualified names.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
