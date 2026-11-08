-- What the real services need that the schema did not hold yet (Phase 9, tasks 9.2 and 9.5). No new table, so no new
-- policy. The editor's saves and the processor's writes are functions so that each is one transaction: a delete and an
-- insert over two HTTP calls could lose a map.

-- A pickup is bar 0 (Decisions 2026-11-01).
alter table public.bars
  drop constraint bars_bar_number_check,
  add constraint bars_bar_number_check check (bar_number >= 0);
alter table public.locators
  drop constraint locators_bar_number_check,
  add constraint locators_bar_number_check check (bar_number >= 0);

-- A part is 0 pages until the processor has read it: the browser has no PDF reader. Rests belong to a part
-- (Decisions 2026-11-02). box_flags keeps the frontend's camelCase shape, because only the frontend reads it.
alter table public.score_files
  alter column page_count set default 0,
  drop constraint score_files_page_count_check,
  add constraint score_files_page_count_check check (page_count >= 0),
  add column rests integer[] not null default '{}',
  add column box_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(box_flags) = 'array');

-- TimingLayer.barCount and shortBars. short_bars holds [{bar, units}].
alter table public.play_order
  add column bar_count integer not null default 0 check (bar_count >= 0),
  add column short_bars jsonb not null default '[]'::jsonb check (jsonb_typeof(short_bars) = 'array');

-- When "Set the piece structure" was confirmed (Decisions 2026-11-03); null: not yet.
alter table public.pieces
  add column structure_set_at timestamptz;

-- One running job per piece (final review M-12). The processor answers 409 when this refuses.
create unique index jobs_one_active_per_piece on public.jobs (piece_id) where status in ('queued', 'running');

-- A size and type limit on the bucket (final review M-13). 50 MB is the free plan's own maximum for one file.
update storage.buckets
  set file_size_limit = 52428800,
      allowed_mime_types = array['application/pdf', 'audio/*', 'image/webp', 'application/json', 'application/octet-stream']
  where id = 'pieces';

-- The editor's saves. Security invoker, so the owner policies of 0001 apply on top of the check.
create function public.save_timing(
  target_piece uuid,
  new_bar_count integer,
  new_rows jsonb,
  new_meters jsonb,
  new_marks jsonb,
  new_short_bars jsonb,
  new_locators jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  -- A null would delete the old map and insert nothing, so refuse it before anything is deleted.
  if new_bar_count is null
    or new_rows is null or jsonb_typeof(new_rows) <> 'array'
    or new_meters is null or jsonb_typeof(new_meters) <> 'array'
    or new_marks is null or jsonb_typeof(new_marks) <> 'array'
    or new_short_bars is null or jsonb_typeof(new_short_bars) <> 'array'
    or new_locators is null or jsonb_typeof(new_locators) <> 'array' then
    raise exception 'every argument must be given, and the lists must be arrays' using errcode = 'null_value_not_allowed';
  end if;
  insert into public.play_order (piece_id, bar_count, rows, meters, marks, short_bars)
  values (target_piece, new_bar_count, new_rows, new_meters, new_marks, new_short_bars)
  on conflict (piece_id) do update
    set bar_count = excluded.bar_count, rows = excluded.rows, meters = excluded.meters,
        marks = excluded.marks, short_bars = excluded.short_bars;
  delete from public.locators l where l.piece_id = target_piece;
  insert into public.locators (piece_id, pass_index, bar_number, time_sec, confirmed, flags, checked)
  select target_piece, r.pass_index, r.bar_number, r.time_sec, r.confirmed, r.flags, r.checked
  from jsonb_to_recordset(new_locators) as r (
    pass_index integer, bar_number integer, time_sec double precision, confirmed boolean, flags jsonb, checked boolean
  );
end;
$$;

create function public.save_page_layer(target_part uuid, new_rests integer[], new_box_flags jsonb, new_bars jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.score_files f join public.pieces p on p.id = f.piece_id
    where f.id = target_part and p.owner_id = (select auth.uid())
  ) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  if new_rests is null
    or new_box_flags is null or jsonb_typeof(new_box_flags) <> 'array'
    or new_bars is null or jsonb_typeof(new_bars) <> 'array' then
    raise exception 'every argument must be given, and the lists must be arrays' using errcode = 'null_value_not_allowed';
  end if;
  update public.score_files f set rests = new_rests, box_flags = new_box_flags where f.id = target_part;
  delete from public.bars b where b.score_file_id = target_part;
  insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h)
  select target_part, r.bar_number, r.page_index, r.x, r.y, r.w, r.h
  from jsonb_to_recordset(new_bars) as r (
    bar_number integer, page_index integer, x double precision, y double precision, w double precision, h double precision
  );
end;
$$;

-- The processor's side. Only service_role runs these. service_is_creator says what public.is_creator() of 0007 says
-- for the given user: it reads auth.users and a confirmed email, never a claim in the JWT.
create function public.service_is_creator(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = target)
      or exists (
        select 1
        from auth.users u
        join public.creator_emails c on c.email = lower(u.email)
        where u.id = target
          and u.email_confirmed_at is not null
      );
$$;

create function public.service_save_page_layer(target_part uuid, new_pages jsonb, new_bars jsonb, new_rests integer[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new_pages is null or jsonb_typeof(new_pages) <> 'array'
    or new_bars is null or jsonb_typeof(new_bars) <> 'array'
    or new_rests is null then
    raise exception 'every argument must be given, and the lists must be arrays' using errcode = 'null_value_not_allowed';
  end if;
  update public.score_files f
    set rests = new_rests, page_count = jsonb_array_length(new_pages)
    where f.id = target_part;
  delete from public.score_pages s where s.score_file_id = target_part;
  insert into public.score_pages (score_file_id, page_index, image_path, width, height)
  select target_part, r.page_index, r.image_path, r.width, r.height
  from jsonb_to_recordset(new_pages) as r (page_index integer, image_path text, width integer, height integer);
  delete from public.bars b where b.score_file_id = target_part;
  insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h)
  select target_part, r.bar_number, r.page_index, r.x, r.y, r.w, r.h
  from jsonb_to_recordset(new_bars) as r (
    bar_number integer, page_index integer, x double precision, y double precision, w double precision, h double precision
  );
end;
$$;

-- A new locator on a bar and pass that already has a confirmed one fails on the table's unique key: confirmed rows never move.
create function public.service_replace_unconfirmed_locators(target_piece uuid, new_locators jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new_locators is null or jsonb_typeof(new_locators) <> 'array' then
    raise exception 'the list must be given, and must be an array' using errcode = 'null_value_not_allowed';
  end if;
  delete from public.locators l where l.piece_id = target_piece and not l.confirmed;
  insert into public.locators (piece_id, pass_index, bar_number, time_sec, confirmed, flags, checked)
  select target_piece, r.pass_index, r.bar_number, r.time_sec, r.confirmed, r.flags, r.checked
  from jsonb_to_recordset(new_locators) as r (
    pass_index integer, bar_number integer, time_sec double precision, confirmed boolean, flags jsonb, checked boolean
  );
end;
$$;

-- Table grants. Supabase no longer grants a new table to its roles automatically (new projects since 2026-05-30, new
-- tables on existing projects since 2026-10-30), and 0001 to 0008 granted none, so every door is opened here, on purpose,
-- and RLS then guards each one. A grant that already exists is a no-op. Each line gives exactly what the policies of
-- 0001, 0003, 0005 and 0007 allow and the app uses, and not a privilege more:
--   * anon gets nothing: the app is signed in for everything, and join_piece is a function granted to authenticated.
--   * profiles: select only. The update stays the column-level grant of 0007 (settings and the terms columns) and the
--     insert stays revoked: handle_new_user inserts the row. No table-wide grant on profiles is made or needed here.
--   * jobs and piece_shares: select only (the processor writes jobs; create_or_get_share and the other functions write
--     piece_shares). piece_members: select and delete (join_piece is the only way in; the owner removes, a member leaves).
--   * admins and creator_emails: nothing; only the security definer functions read them.
grant select, insert, update, delete on
  public.pieces, public.score_files, public.score_pages, public.bars,
  public.audio_sources, public.play_order, public.locators, public.piece_practice
  to authenticated;
grant select on public.profiles, public.jobs, public.piece_shares to authenticated;
grant select, delete on public.piece_members to authenticated;

-- What the processor's service key reads and writes. The same rule: 0009 grants the eight tables the processor touches
-- itself. The sharing tables stay out: the processor does not use them. Of profiles it gets two columns, id and email,
-- for the import's owner lookup (the owner's email to the owner's id) and nothing else.
grant select, insert, update, delete on
  public.pieces, public.score_files, public.score_pages, public.bars,
  public.audio_sources, public.play_order, public.locators, public.jobs
  to service_role;
grant select (id, email) on public.profiles to service_role;

revoke all on function public.save_timing(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.save_page_layer(uuid, integer[], jsonb, jsonb) from public, anon;
grant execute on function public.save_timing(uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_page_layer(uuid, integer[], jsonb, jsonb) to authenticated;

revoke all on function public.service_is_creator(uuid) from public, anon, authenticated;
revoke all on function public.service_save_page_layer(uuid, jsonb, jsonb, integer[]) from public, anon, authenticated;
revoke all on function public.service_replace_unconfirmed_locators(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.service_is_creator(uuid) to service_role;
grant execute on function public.service_save_page_layer(uuid, jsonb, jsonb, integer[]) to service_role;
grant execute on function public.service_replace_unconfirmed_locators(uuid, jsonb) to service_role;
