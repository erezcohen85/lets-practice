-- One sample piece per account (Erez, 2026-11-08; docs/plans/2026-11-08-sample-piece-design.md). The admin's master piece is
-- copied, rows and path names, into each account once, by the processor with the service role. The copy is an ordinary
-- piece of the user: it counts as created and as stored, and is left out of the plan's daily cap because it runs no
-- processing. The processor copies the files inside Storage itself, from the list of paths this migration hands back.
--
-- Not applied by the builder: the controller applies it with Erez.
--
--   * sample_piece: at most one row (id is always true), closed to anon and authenticated like the tables of 0015. It names
--     the master (null when the master is deleted: the copies stay, and no new copy is made) and holds its credits.
--   * pieces.sample_of: the master a copy came from, null for an ordinary piece. pieces.sample_credits: the credits of the
--     recording and score (a CC BY licence needs them wherever the files go), copied from sample_piece.credits when the
--     copy is made, so they stay with the copy whatever happens to the master or to the sample_piece row later (the master
--     deleted, cleared, or swapped for another). Both are readable with the row. Nobody signed in can write either, on
--     insert or on update: a before trigger refuses it (as 0015 does for the box-check tick). Not a column
--     grant: 0009 granted insert and update on pieces for the whole table, a column cannot be taken out of a table-wide
--     grant, and splitting the grant by column would make every column added to pieces later need a grant of its own. The
--     one change allowed is the one the foreign key makes itself, when the master is deleted (it runs inside the cascade,
--     at trigger depth 2). The service role and the SQL editor have no auth.uid() and are not checked.
--   * profiles.sample_given_at / sample_given: when the account was given the sample, or skipped, and which of the two. Both
--     are readable through the select policy; the update grant on profiles stays the column list of 0007, so the user
--     cannot write them.
--   * usage_events.is_sample: the piece_created event of a copy. The piece counts as created (nothing special), but the
--     per-plan count behind the daily cap skips it, in plan_state_of and in admin_overview.
--   * The service_* functions are the processor's side. Only service_role runs them. service_copy_sample_piece does all
--     the rows in one transaction and locks the profile row first, so two tabs cannot make two copies.
--   * sample_credits() is the one function the browser calls: the piece's own credits, for a user who can read it.

-- Tables and columns -----------------------------------------------------------------------------
create table public.sample_piece (
  id boolean primary key default true check (id),
  master_piece_id uuid references public.pieces (id) on delete set null,
  credits jsonb not null default '[]'::jsonb check (jsonb_typeof(credits) = 'array'),
  set_at timestamptz not null default now()
);
alter table public.sample_piece enable row level security; -- no policies on purpose
revoke all on public.sample_piece from public, anon, authenticated;
create index sample_piece_master_piece_id_idx on public.sample_piece (master_piece_id);

alter table public.pieces
  add column sample_of uuid references public.pieces (id) on delete set null,
  add column sample_credits jsonb check (sample_credits is null or jsonb_typeof(sample_credits) = 'array');
create index pieces_sample_of_idx on public.pieces (sample_of) where sample_of is not null;

alter table public.profiles
  add column sample_given_at timestamptz,
  add column sample_given boolean;

alter table public.usage_events add column is_sample boolean not null default false;

-- Nobody signed in writes pieces.sample_of or pieces.sample_credits ---------------------------------
create function public.protect_sample_of()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
    and pg_trigger_depth() = 1
    and (
      new.sample_of is distinct from (case when tg_op = 'UPDATE' then old.sample_of else null end)
      or new.sample_credits is distinct from (case when tg_op = 'UPDATE' then old.sample_credits else null end)
    ) then
    raise exception 'permission denied for column sample_of or sample_credits' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger pieces_protect_sample_of
  before insert or update of sample_of, sample_credits on public.pieces
  for each row execute function public.protect_sample_of();

-- The daily cap leaves the sample out --------------------------------------------------------------
-- As 0015, with one change: new_pieces_today_on_plan adds "and not e.is_sample".
create or replace function public.plan_state_of(u uuid, p uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pl public.plans := public.plan_row_of(u);
  is_adm boolean := exists (select 1 from public.admins a where a.user_id = u);
  mail text := (select lower(x.email) from auth.users x where x.id = u);
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  made integer;
  piece jsonb := null;
begin
  made := (
      select count(*)::integer from public.usage_events e
      where e.user_id = u and e.kind = 'piece_created' and e.voided_at is null
    ) + coalesce((select l.pieces_created from public.trial_ledger l where l.email_hash = public.email_hash(mail)), 0);

  if p is not null and exists (select 1 from public.pieces x where x.id = p and x.owner_id = u) then
    piece := jsonb_build_object(
      'id', p,
      'parts', (select count(*)::integer from public.score_files f where f.piece_id = p),
      'realigns', (
        select count(*)::integer from public.usage_events e
        where e.piece_id = p and e.kind = 'realign' and e.voided_at is null
      ),
      'read_again_by_part', coalesce((
        select jsonb_object_agg(r.part_id, r.times)
        from (
          select e.part_id, count(*)::integer as times
          from public.usage_events e
          where e.piece_id = p and e.kind = 'read_again' and e.part_id is not null and e.voided_at is null
          group by e.part_id
        ) r
      ), '{}'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'is_admin', is_adm,
    'plan', to_jsonb(pl),
    'usage', jsonb_build_object(
      'pieces_created', made,
      'pieces_stored', (select count(*)::integer from public.pieces x where x.owner_id = u),
      'shared_pieces', (
        select count(*)::integer from public.pieces x
        join public.piece_shares s on s.piece_id = x.id and s.enabled
        where x.owner_id = u
      ),
      'advanced_reading_parts_this_month', (
        select count(*)::integer from public.usage_events e
        where e.user_id = u and e.kind = 'advanced_reading_part' and e.voided_at is null and e.at >= month_start
      ),
      'new_pieces_today_on_plan', (
        select count(*)::integer from public.usage_events e
        where e.kind = 'piece_created' and e.plan_id = pl.id and e.voided_at is null and not e.is_sample and e.at >= day_start
      )
    ),
    'piece', piece
  );
end;
$$;

-- As 0015, with one change: the per-plan new_pieces_today skips the sample, as plan_state_of does.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  with ppl as (
    select lower(x.email) as email,
           pr.display_name,
           true as signed_up,
           x.last_sign_in_at,
           (public.plan_row_of(x.id)).id as plan_id,
           e.email is not null as assigned,
           exists (select 1 from public.admins a where a.user_id = x.id) as is_admin,
           e.added_at,
           (select count(*)::integer from public.usage_events v where v.user_id = x.id and v.kind = 'piece_created' and v.voided_at is null)
             + coalesce((select l.pieces_created from public.trial_ledger l where l.email_hash = public.email_hash(x.email)), 0) as pieces_created,
           (select count(*)::integer from public.pieces o where o.owner_id = x.id) as pieces_stored,
           (select count(*)::integer from public.pieces o join public.piece_shares s on s.piece_id = o.id and s.enabled where o.owner_id = x.id) as shared_pieces
    from auth.users x
    left join public.profiles pr on pr.id = x.id
    left join public.plan_emails e on e.email = lower(x.email)
    where x.email is not null
    union all
    select e.email, null, false, null, e.plan_id, true, false, e.added_at, 0, 0, 0
    from public.plan_emails e
    where not exists (select 1 from auth.users x where lower(x.email) = e.email)
  )
  select jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'people', (select count(*)::integer from ppl where ppl.plan_id = p.id),
          'new_pieces_today', (
            select count(*)::integer from public.usage_events v
            where v.kind = 'piece_created' and v.plan_id = p.id and v.voided_at is null and not v.is_sample and v.at >= day_start
          )
        )
        order by p.position
      )
      from public.plans p
    ), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(to_jsonb(ppl) order by ppl.email) from ppl), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Internal helper ------------------------------------------------------------------------------------
-- A master path with the master's folder swapped for the new owner's and piece's. A path outside the master's folder is
-- refused, so a copy can never point at (or later delete) a file that belongs to someone else.
create function public.sample_path(old_path text, old_prefix text, new_prefix text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if old_path is null then
    return null;
  end if;
  if left(old_path, length(old_prefix)) is distinct from old_prefix then
    raise exception 'sample:path_outside' using errcode = 'invalid_parameter_value';
  end if;
  return new_prefix || substr(old_path, length(old_prefix) + 1);
end;
$$;

-- The browser's side ---------------------------------------------------------------------------------
-- The credits kept on a piece the caller can read: those of a sample copy, null for any other piece.
create function public.sample_credits(target_piece uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select x.sample_credits
  from public.pieces x
  where x.id = target_piece
    and public.can_read_piece(target_piece);
$$;

-- The processor's side. Only service_role runs these --------------------------------------------------
-- { given_at, has_master, is_master_owner, room }. room: the admin, or both the created and the stored count are under the
-- plan's maximum (a null maximum is no limit). Pause and the daily cap are not part of it: the sample runs no processing.
create function public.service_sample_state(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st jsonb := public.plan_state_of(target, null);
  pl jsonb := st -> 'plan';
  us jsonb := st -> 'usage';
  master uuid := (
    select x.id from public.sample_piece s join public.pieces x on x.id = s.master_piece_id
  );
begin
  return jsonb_build_object(
    'given_at', (select p.sample_given_at from public.profiles p where p.id = target),
    'has_master', master is not null,
    'is_master_owner', exists (select 1 from public.pieces x where x.id = master and x.owner_id = target),
    'room', (st ->> 'is_admin')::boolean
      or (
        ((pl ->> 'pieces_created_max') is null or (us ->> 'pieces_created')::integer < (pl ->> 'pieces_created_max')::integer)
        and ((pl ->> 'pieces_stored_max') is null or (us ->> 'pieces_stored')::integer < (pl ->> 'pieces_stored_max')::integer)
      )
  );
end;
$$;

-- Copies the master into the account of target as the piece new_piece, once. Returns { piece_id, files: [{from, to}] }:
-- every storage path of the master, each once, with the path of its copy. The files themselves are copied by the caller.
-- Raises sample:already (the account was given or skipped before), sample:no_master, sample:path_outside.
-- Left out of the copy: jobs, members, shares and practice memory, and pieces.practice and pieces.last_part_id (the
-- admin's own place in the piece). The piece_created event of the copy is marked is_sample. The credits of sample_piece
-- are copied onto the piece (pieces.sample_credits) and stay with it.
create function public.service_copy_sample_piece(target uuid, new_piece uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  given timestamptz;
  master public.pieces;
  master_credits jsonb;
  old_prefix text;
  new_prefix text;
  part record;
  new_part uuid;
  pairs jsonb;
begin
  select p.sample_given_at into given from public.profiles p where p.id = target for update;
  if not found then
    raise exception 'sample:no_user' using errcode = 'foreign_key_violation';
  end if;
  if given is not null then
    raise exception 'sample:already' using errcode = 'unique_violation';
  end if;
  select x.* into master
  from public.sample_piece s join public.pieces x on x.id = s.master_piece_id;
  if not found then
    raise exception 'sample:no_master' using errcode = 'no_data_found';
  end if;
  select s.credits into master_credits from public.sample_piece s;
  old_prefix := master.owner_id || '/' || master.id || '/';
  new_prefix := target || '/' || new_piece || '/';

  -- The insert fires log_piece_created (0015); the event is then marked as the sample's.
  insert into public.pieces (id, owner_id, title, count_in_bars, structure_set_at, sample_of, sample_credits)
  values (new_piece, target, master.title, master.count_in_bars, master.structure_set_at, master.id, master_credits);
  update public.usage_events e set is_sample = true
  where e.piece_id = new_piece and e.kind = 'piece_created';

  for part in select f.* from public.score_files f where f.piece_id = master.id order by f.position, f.id loop
    new_part := gen_random_uuid();
    insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name, position, name_source, rests, box_flags, box_check)
    values (
      new_part, new_piece, public.sample_path(part.storage_path, old_prefix, new_prefix), part.sha256, part.page_count,
      part.name, part.position, part.name_source, part.rests, part.box_flags, part.box_check
    );
    insert into public.score_pages (score_file_id, page_index, image_path, width, height)
    select new_part, s.page_index, public.sample_path(s.image_path, old_prefix, new_prefix), s.width, s.height
    from public.score_pages s where s.score_file_id = part.id;
    insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h, time_sig)
    select new_part, b.bar_number, b.page_index, b.x, b.y, b.w, b.h, b.time_sig
    from public.bars b where b.score_file_id = part.id;
  end loop;

  -- A YouTube link is a URL, not a file of the piece: it is copied as it is.
  insert into public.audio_sources (piece_id, kind, url_or_path, duration, stored_path, name)
  select new_piece, a.kind,
         case when a.kind = 'file' then public.sample_path(a.url_or_path, old_prefix, new_prefix) else a.url_or_path end,
         a.duration, public.sample_path(a.stored_path, old_prefix, new_prefix), a.name
  from public.audio_sources a where a.piece_id = master.id;

  insert into public.play_order (piece_id, rows, meters, marks, bar_count, short_bars)
  select new_piece, o.rows, o.meters, o.marks, o.bar_count, o.short_bars
  from public.play_order o where o.piece_id = master.id;

  insert into public.locators (piece_id, pass_index, bar_number, time_sec, confirmed, flags, checked)
  select new_piece, l.pass_index, l.bar_number, l.time_sec, l.confirmed, l.flags, l.checked
  from public.locators l where l.piece_id = master.id;

  select coalesce(jsonb_agg(jsonb_build_object('from', w.src, 'to', public.sample_path(w.src, old_prefix, new_prefix)) order by w.src), '[]'::jsonb)
  into pairs
  from (
    select f.storage_path as src from public.score_files f where f.piece_id = master.id
    union
    select s.image_path from public.score_pages s join public.score_files f on f.id = s.score_file_id where f.piece_id = master.id
    union
    select a.url_or_path from public.audio_sources a where a.piece_id = master.id and a.kind = 'file'
    union
    select a.stored_path from public.audio_sources a where a.piece_id = master.id and a.stored_path is not null
  ) w;

  update public.profiles p set sample_given_at = now(), sample_given = true where p.id = target;
  return jsonb_build_object('piece_id', new_piece, 'files', pairs);
end;
$$;

-- The account was given nothing (no room, no master) and is not asked again; or, with true, was given the sample.
create function public.service_mark_sample(target uuid, was_given boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles p set sample_given_at = now(), sample_given = was_given where p.id = target;
$$;

-- After a file copy failed and the new piece was removed: the account is asked again the next time.
create function public.service_unmark_sample(target uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles p set sample_given_at = null, sample_given = null where p.id = target;
$$;

-- The script that picks the master. Setting it again replaces the first; the credits are the array a /demo bundle holds.
create function public.service_set_sample_piece(master uuid, credits jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.sample_piece (id, master_piece_id, credits, set_at)
  values (true, master, credits, now())
  on conflict (id) do update
    set master_piece_id = excluded.master_piece_id, credits = excluded.credits, set_at = excluded.set_at;
$$;

-- Stops new copies. Copies already given stay.
create function public.service_clear_sample_piece()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.sample_piece;
$$;

-- Grants -----------------------------------------------------------------------------------------
-- The replaced functions keep their grants; these lines say them again for the reader.
revoke all on function public.plan_state_of(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

revoke all on function public.sample_path(text, text, text) from public, anon, authenticated;
revoke all on function public.protect_sample_of() from public, anon, authenticated;

revoke all on function public.sample_credits(uuid) from public, anon;
grant execute on function public.sample_credits(uuid) to authenticated;

revoke all on function public.service_sample_state(uuid) from public, anon, authenticated;
revoke all on function public.service_copy_sample_piece(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_mark_sample(uuid, boolean) from public, anon, authenticated;
revoke all on function public.service_unmark_sample(uuid) from public, anon, authenticated;
revoke all on function public.service_set_sample_piece(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.service_clear_sample_piece() from public, anon, authenticated;
grant execute on function public.service_sample_state(uuid) to service_role;
grant execute on function public.service_copy_sample_piece(uuid, uuid) to service_role;
grant execute on function public.service_mark_sample(uuid, boolean) to service_role;
grant execute on function public.service_unmark_sample(uuid) to service_role;
grant execute on function public.service_set_sample_piece(uuid, jsonb) to service_role;
grant execute on function public.service_clear_sample_piece() to service_role;
