-- Plans and usage limits (Erez, 2026-11-08): uploads stop being limited to creators. Every signed-in user is on a named
-- plan, Trial by default, and the plan's numbers decide what the database accepts. The admin edits the numbers (never the
-- names or the count of plans) and who is on which plan. Spec: docs/plans/2026-11-08-plans-and-limits-design.md.
--
-- Not applied by the builder: the controller applies it with Erez.
--
--   * Four new tables, all closed: RLS on, no policy, nothing granted to anon or authenticated (0010: new tables start
--     closed). Only the security definer functions below read or write them.
--       plans         three fixed rows (trial, creator, unlimited); a null number means no limit
--       plan_emails   who is on a plan other than Trial, by email (a person need not have signed up yet)
--       usage_events  one row per counted action (a piece made, an Advanced Reading part, a part read again, a realign)
--       trial_ledger  how many pieces an email had made when its account was deleted, kept as a hash of the email
--   * A user's plan: the admin is always Unlimited; else the plan_emails row of their email, counted only once the email
--     is confirmed (as is_creator did); else Trial. The admin is never limited, whatever a plan_emails row says.
--   * Pieces made counts every piece ever made (usage_events, plus the ledger of an earlier account on the same email),
--     so deleting a piece does not give one back. A refused first processing gives the slot back by voiding its event
--     (service_void_piece_created). Pieces stored counts the pieces the user owns now.
--   * "Today" for the daily cap is the UTC date (ruling 8), and the month for Advanced Reading starts on the 1st, UTC.
--   * Policies: pieces insert and score_files insert ask can_create_piece() and can_add_part(); the storage insert policy
--     asks that the second folder is "staging" or a piece the user owns, and caps the objects the user uploaded at 500
--     (storage.objects.owner; the processor's own writes have no owner and do not count). The admin is exempt from the
--     cap. These three helpers are the only functions here that authenticated may execute without being a client
--     call: a policy expression runs as the signed-in role, so it needs the grant. Each decides for auth.uid() alone.
--   * Turning a box check on (score_files.box_check false to true) is refused by a before-update trigger when the plan
--     has no Advanced Reading. A trigger and not an update policy, because a policy cannot see the old row: a part that
--     is already ticked (the owner has since moved to a smaller plan) must stay editable. The service role and the SQL
--     editor (no auth.uid()) are not checked.
--   * A smaller plan keeps what exists. Nothing is deleted or switched off when a plan shrinks; the limits only refuse
--     the next piece, part or link.
--   * Refusals the browser needs to name raise "plan_limit:<key>" with errcode check_violation (set_share_enabled, the
--     box-check trigger). Policy refusals are the usual row-level security error; the browser asks my_plan() which limit.
--   * creator_emails moves into plan_emails with plan creator and is dropped, with list_creators, add_creator,
--     remove_creator and set_creator_limits. The per-creator member numbers (0014) do not move: the member limit is now
--     the owner's plan's members_per_piece and members_per_part (30 and 10 on all three plans, as the old defaults).
--   * is_creator() and service_is_creator(uuid) stay as shims, true for the admin or a plan other than Trial, so the
--     running frontend does not break between applying this and deploying. A later migration drops them.
--   * Every piece that exists gets one piece_created event, dated by the piece, so existing users start with their count.

-- Tables -----------------------------------------------------------------------------------------
create table public.plans (
  id text primary key check (id in ('trial', 'creator', 'unlimited')),
  name text not null check (char_length(name) between 1 and 40),
  position integer not null,
  -- Pieces
  pieces_created_max integer check (pieces_created_max >= 0),
  pieces_stored_max integer check (pieces_stored_max >= 0),
  -- Size
  parts_per_piece_max integer check (parts_per_piece_max >= 1),
  pages_per_part_max integer check (pages_per_part_max between 1 and 100),
  recording_minutes_max integer check (recording_minutes_max between 1 and 20),
  -- AI features
  advanced_reading boolean not null,
  advanced_reading_parts_per_month integer check (advanced_reading_parts_per_month >= 0),
  split_pdf boolean not null,
  suggest_name boolean not null,
  -- Sharing
  shared_pieces_max integer check (shared_pieces_max >= 0),
  members_per_piece integer not null check (members_per_piece between 1 and 500),
  members_per_part integer not null check (members_per_part between 0 and 100),
  -- Reprocess
  read_again_per_part_max integer check (read_again_per_part_max >= 0),
  realign_per_piece_max integer check (realign_per_piece_max >= 0),
  -- Plan-wide
  new_pieces_per_day integer check (new_pieces_per_day >= 0),
  new_pieces_paused boolean not null default false
);
alter table public.plans enable row level security; -- no policies on purpose

insert into public.plans (
  id, name, position, pieces_created_max, pieces_stored_max, parts_per_piece_max, pages_per_part_max,
  recording_minutes_max, advanced_reading, advanced_reading_parts_per_month, split_pdf, suggest_name, shared_pieces_max,
  members_per_piece, members_per_part, read_again_per_part_max, realign_per_piece_max, new_pieces_per_day, new_pieces_paused
) values
  ('trial',     'Trial',     0, 3,    3,    1,    20,  10, false, 0,    false, true, 1,    30, 10, 2,    5,    20,   false),
  ('creator',   'Creator',   1, null, 50,   null, 100, 20, true,  30,   true,  true, null, 30, 10, 10,   null, null, false),
  ('unlimited', 'Unlimited', 2, null, null, null, 100, 20, true,  null, true,  true, null, 30, 10, null, null, null, false);

create table public.plan_emails (
  email text primary key check (email = lower(email)),
  plan_id text not null references public.plans (id),
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);
alter table public.plan_emails enable row level security; -- no policies on purpose
create index plan_emails_added_by_idx on public.plan_emails (added_by);
create index plan_emails_plan_id_idx on public.plan_emails (plan_id);

create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('piece_created', 'advanced_reading_part', 'read_again', 'realign')),
  plan_id text not null,
  piece_id uuid,          -- no foreign key: the event outlives the piece
  part_id uuid,
  at timestamptz not null default now(),
  voided_at timestamptz
);
alter table public.usage_events enable row level security; -- no policies on purpose
create index usage_events_user_kind_at_idx on public.usage_events (user_id, kind, at);
create index usage_events_kind_plan_at_idx on public.usage_events (kind, plan_id, at);
create index usage_events_piece_kind_idx on public.usage_events (piece_id, kind) where piece_id is not null;

create table public.trial_ledger (
  email_hash text primary key,   -- encode(sha256(convert_to(lower(email), 'UTF8')), 'hex')
  pieces_created integer not null check (pieces_created >= 0),
  updated_at timestamptz not null default now()
);
alter table public.trial_ledger enable row level security; -- no policies on purpose

-- Nobody but the functions below touches them. (The default privileges of 0010 already give anon and authenticated no
-- table; this says it again in the file that makes the tables.)
revoke all on public.plans, public.plan_emails, public.usage_events, public.trial_ledger from public, anon, authenticated;
revoke all on sequence public.usage_events_id_seq from public, anon, authenticated;

-- Internal helpers ---------------------------------------------------------------------------------
create function public.email_hash(address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(lower(address), 'UTF8')), 'hex');
$$;

-- The plan a user is on. The admin is Unlimited; a confirmed email with a plan_emails row has that plan; anyone else Trial.
create function public.plan_row_of(u uuid)
returns public.plans
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.plans p
  where p.id = case
    when exists (select 1 from public.admins a where a.user_id = u) then 'unlimited'
    else coalesce((
      select e.plan_id
      from auth.users x
      join public.plan_emails e on e.email = lower(x.email)
      where x.id = u and x.email_confirmed_at is not null
    ), 'trial')
  end;
$$;

-- The plan state of the contract: who, which plan, what is used, and (when p is a piece of u's) that piece's counts.
create function public.plan_state_of(u uuid, p uuid)
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
        where e.kind = 'piece_created' and e.plan_id = pl.id and e.voided_at is null and e.at >= day_start
      )
    ),
    'piece', piece
  );
end;
$$;

-- Used by the insert policy of pieces: admin, or every limit that applies has room (null = no limit).
create function public.can_create_piece()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  st jsonb;
  pl jsonb;
  us jsonb;
begin
  if me is null then
    return false;
  end if;
  if exists (select 1 from public.admins a where a.user_id = me) then
    return true;
  end if;
  st := public.plan_state_of(me, null);
  pl := st -> 'plan';
  us := st -> 'usage';
  return not (pl ->> 'new_pieces_paused')::boolean
    and ((pl ->> 'new_pieces_per_day') is null or (us ->> 'new_pieces_today_on_plan')::integer < (pl ->> 'new_pieces_per_day')::integer)
    and ((pl ->> 'pieces_created_max') is null or (us ->> 'pieces_created')::integer < (pl ->> 'pieces_created_max')::integer)
    and ((pl ->> 'pieces_stored_max') is null or (us ->> 'pieces_stored')::integer < (pl ->> 'pieces_stored_max')::integer);
end;
$$;

-- Used by the insert policy of score_files: may the caller add one more part to piece p, with the Advanced Reading tick as given?
-- False for a piece that is not the caller's (the policy asks that too), so this cannot be used to count another user's parts.
create function public.can_add_part(p uuid, ticked boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.plans;
begin
  if me is null or not exists (select 1 from public.pieces x where x.id = p and x.owner_id = me) then
    return false;
  end if;
  if exists (select 1 from public.admins a where a.user_id = me) then
    return true;
  end if;
  pl := public.plan_row_of(me);
  return (pl.parts_per_piece_max is null or (select count(*) from public.score_files f where f.piece_id = p) < pl.parts_per_piece_max)
    and (not coalesce(ticked, false) or pl.advanced_reading);
end;
$$;

-- Used by the insert policy of storage.objects: an own folder, then "staging" or a piece the caller owns, then the 500 cap.
-- The cap counts the objects the caller uploaded (owner). case, not "and": a path whose second folder is not a uuid is a
-- plain false, never a failed cast.
create function public.can_upload_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] is distinct from (select auth.uid())::text then false
    when not (
      case
        when (storage.foldername(object_name))[2] = 'staging' then true
        when (storage.foldername(object_name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then exists (
            select 1 from public.pieces x
            where x.id = ((storage.foldername(object_name))[2])::uuid and x.owner_id = (select auth.uid())
          )
        else false
      end
    ) then false
    else exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
      or (select count(*) from storage.objects o where o.bucket_id = 'pieces' and o.owner = (select auth.uid())) < 500
  end;
$$;

-- Backfill and the piece_created trigger -------------------------------------------------------------
-- Creators move to the new table first: plan_row_of reads it for the backfill below.
insert into public.plan_emails (email, plan_id, added_by, added_at)
select c.email, 'creator', c.added_by, c.added_at from public.creator_emails c;

insert into public.usage_events (user_id, kind, plan_id, piece_id, at)
select x.owner_id, 'piece_created', (public.plan_row_of(x.owner_id)).id, x.id, x.created_at
from public.pieces x;

create function public.log_piece_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage_events (user_id, kind, plan_id, piece_id)
  values (new.owner_id, 'piece_created', (public.plan_row_of(new.owner_id)).id, new.id);
  return null;
end;
$$;

create trigger pieces_log_created
  after insert on public.pieces
  for each row execute function public.log_piece_created();

-- Turning the tick on needs a plan with Advanced Reading. Only a signed-in user is checked: the service role and the SQL
-- editor have no auth.uid().
create function public.require_advanced_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is not null and new.box_check and not old.box_check and not (public.plan_row_of(me)).advanced_reading then
    raise exception 'plan_limit:advanced_reading' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger score_files_require_advanced_reading
  before update of box_check on public.score_files
  for each row execute function public.require_advanced_reading();

-- Policies -------------------------------------------------------------------------------------
drop policy pieces_insert_own on public.pieces;
create policy pieces_insert_own on public.pieces
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.can_create_piece());

drop policy score_files_insert_own on public.score_files;
create policy score_files_insert_own on public.score_files
  for insert to authenticated
  with check (
    exists (
      select 1 from public.pieces p
      where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
    )
    and public.can_add_part(score_files.piece_id, score_files.box_check)
  );

drop policy pieces_objects_insert_own on storage.objects;
create policy pieces_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pieces'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.can_upload_object(name)
  );

-- The functions the app calls ------------------------------------------------------------------------
create function public.my_plan(target_piece uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'invalid_authorization_specification';
  end if;
  return public.plan_state_of(me, target_piece);
end;
$$;

-- As 0013, plus: turning on a link that is off, when the owner already has shared_pieces_max links on, raises
-- plan_limit:shared_pieces_max. A link already on is not counted twice, and the admin (Unlimited) has no maximum.
create or replace function public.set_share_enabled(target_piece uuid, is_on boolean, rights_confirmed boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  was_on boolean;
  max_links integer;
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = me) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  if is_on then
    select s.enabled into was_on from public.piece_shares s where s.piece_id = target_piece;
    if was_on is not null and not was_on then
      max_links := (public.plan_row_of(me)).shared_pieces_max;
      if max_links is not null and (
        select count(*) from public.pieces x
        join public.piece_shares s on s.piece_id = x.id and s.enabled
        where x.owner_id = me
      ) >= max_links then
        raise exception 'plan_limit:shared_pieces_max' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  update public.piece_shares s
  set enabled = is_on,
      rights_confirmed_at = case
        when is_on and rights_confirmed then coalesce(s.rights_confirmed_at, now())
        else s.rights_confirmed_at
      end
  where s.piece_id = target_piece;
end;
$$;

-- The same formula as 0014, with the owner's plan in place of the owner's creator row.
create or replace function public.piece_member_limit(p uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    pl.members_per_piece,
    pl.members_per_part * (select count(*)::integer from public.score_files f where f.piece_id = x.id)
  )
  from public.pieces x
  cross join lateral public.plan_row_of(x.owner_id) pl
  where x.id = p;
$$;

-- As 0011, plus: the number of pieces the account made (not voided, plus any earlier ledger count for the same email) is
-- written to the trial ledger first, so deleting the account and signing up again with the same email does not reset it.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  mail text;
  hash text;
  made integer;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'invalid_authorization_specification';
  end if;
  if exists (select 1 from public.admins a where a.user_id = me) then
    raise exception 'the admin cannot delete their account' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.pieces p where p.owner_id = me) then
    raise exception 'delete your pieces first' using errcode = 'restrict_violation';
  end if;
  select u.email into mail from auth.users u where u.id = me;
  if mail is not null then
    hash := public.email_hash(mail);
    made := (
        select count(*)::integer from public.usage_events e
        where e.user_id = me and e.kind = 'piece_created' and e.voided_at is null
      ) + coalesce((select l.pieces_created from public.trial_ledger l where l.email_hash = hash), 0);
    if made > 0 then
      insert into public.trial_ledger (email_hash, pieces_created) values (hash, made)
      on conflict (email_hash) do update set pieces_created = excluded.pieces_created, updated_at = now();
    end if;
  end if;
  delete from auth.users u where u.id = me;
end;
$$;

-- The admin hub ----------------------------------------------------------------------------------
-- { plans: [plan row + people + new_pieces_today], people: [person] }. A person is every signed-up user plus every
-- plan_emails email nobody has signed up with. plan_id is the plan that counts for them (a plan_emails row of an
-- unconfirmed email does not count yet); assigned says whether a plan_emails row exists.
create function public.admin_overview()
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
            where v.kind = 'piece_created' and v.plan_id = p.id and v.voided_at is null and v.at >= day_start
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

-- The whole draft of the admin hub in one call, all or nothing: any raise rolls the lot back, the people included.
-- plans[]: { id, <column>: value, ... }. Only the editable columns (everything but id, name, position), each of its type
-- (null only where the column allows it); the column checks then bound the number. people[]: { email, plan_id } assigns
-- (an upsert), { email, remove: true } removes the assignment. The admin's own email can be neither.
create function public.save_admin_changes(changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  pair record;
  col record;
  target public.plans;
  merged public.plans;
  clean text;
  has_plan boolean;
  email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'changes must be an object' using errcode = 'invalid_parameter_value';
  end if;
  for pair in select k.key from jsonb_object_keys(changes) as k(key) loop
    if pair.key not in ('plans', 'people') then
      raise exception 'unknown key: %', pair.key using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if changes ? 'plans' and jsonb_typeof(changes -> 'plans') <> 'array' then
    raise exception 'plans must be a list' using errcode = 'invalid_parameter_value';
  end if;
  if changes ? 'people' and jsonb_typeof(changes -> 'people') <> 'array' then
    raise exception 'people must be a list' using errcode = 'invalid_parameter_value';
  end if;

  for entry in select e.value from jsonb_array_elements(coalesce(changes -> 'plans', '[]'::jsonb)) as e(value) loop
    if jsonb_typeof(entry) <> 'object' or jsonb_typeof(entry -> 'id') is distinct from 'string' then
      raise exception 'each plan change needs an id' using errcode = 'invalid_parameter_value';
    end if;
    select p.* into target from public.plans p where p.id = entry ->> 'id';
    if not found then
      raise exception 'unknown plan: %', entry ->> 'id' using errcode = 'invalid_parameter_value';
    end if;
    for pair in select e.key, e.value from jsonb_each(entry - 'id') as e(key, value) loop
      select c.data_type, c.is_nullable = 'YES' as nullable into col
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'plans' and c.column_name = pair.key
        and c.column_name not in ('id', 'name', 'position');
      if not found then
        raise exception 'unknown key: %', pair.key using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_typeof(pair.value) = 'null' then
        if not col.nullable then
          raise exception '% cannot be empty', pair.key using errcode = 'check_violation';
        end if;
      elsif col.data_type = 'boolean' then
        if jsonb_typeof(pair.value) <> 'boolean' then
          raise exception '% must be true or false', pair.key using errcode = 'invalid_parameter_value';
        end if;
      elsif jsonb_typeof(pair.value) <> 'number' or (pair.value #>> '{}') !~ '^-?[0-9]{1,9}$' then
        raise exception '% must be a whole number', pair.key using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    merged := jsonb_populate_record(target, entry - 'id');
    update public.plans p set
      pieces_created_max = merged.pieces_created_max,
      pieces_stored_max = merged.pieces_stored_max,
      parts_per_piece_max = merged.parts_per_piece_max,
      pages_per_part_max = merged.pages_per_part_max,
      recording_minutes_max = merged.recording_minutes_max,
      advanced_reading = merged.advanced_reading,
      advanced_reading_parts_per_month = merged.advanced_reading_parts_per_month,
      split_pdf = merged.split_pdf,
      suggest_name = merged.suggest_name,
      shared_pieces_max = merged.shared_pieces_max,
      members_per_piece = merged.members_per_piece,
      members_per_part = merged.members_per_part,
      read_again_per_part_max = merged.read_again_per_part_max,
      realign_per_piece_max = merged.realign_per_piece_max,
      new_pieces_per_day = merged.new_pieces_per_day,
      new_pieces_paused = merged.new_pieces_paused
    where p.id = target.id;
  end loop;

  for entry in select e.value from jsonb_array_elements(coalesce(changes -> 'people', '[]'::jsonb)) as e(value) loop
    if jsonb_typeof(entry) <> 'object' or jsonb_typeof(entry -> 'email') is distinct from 'string' then
      raise exception 'each person change needs an email' using errcode = 'invalid_parameter_value';
    end if;
    for pair in select k.key from jsonb_object_keys(entry) as k(key) loop
      if pair.key not in ('email', 'plan_id', 'remove') then
        raise exception 'unknown key: %', pair.key using errcode = 'invalid_parameter_value';
      end if;
    end loop;
    clean := lower(trim(entry ->> 'email'));
    if clean !~ email_re then
      raise exception 'not an email: %', clean using errcode = 'invalid_parameter_value';
    end if;
    if exists (
      select 1 from auth.users u join public.admins a on a.user_id = u.id where lower(u.email) = clean
    ) then
      raise exception 'the admin cannot be changed' using errcode = 'invalid_parameter_value';
    end if;
    has_plan := entry ? 'plan_id';
    if has_plan = (entry ? 'remove') then
      raise exception 'give a plan_id or remove, not both and not neither' using errcode = 'invalid_parameter_value';
    end if;
    if has_plan then
      if jsonb_typeof(entry -> 'plan_id') is distinct from 'string' or not exists (select 1 from public.plans p where p.id = entry ->> 'plan_id') then
        raise exception 'unknown plan: %', entry ->> 'plan_id' using errcode = 'invalid_parameter_value';
      end if;
      insert into public.plan_emails (email, plan_id, added_by)
      values (clean, entry ->> 'plan_id', (select auth.uid()))
      on conflict (email) do update set plan_id = excluded.plan_id;
    else
      if entry -> 'remove' <> 'true'::jsonb then
        raise exception 'remove must be true' using errcode = 'invalid_parameter_value';
      end if;
      delete from public.plan_emails e where e.email = clean;
    end if;
  end loop;
end;
$$;

-- The processor's side. Only service_role runs these --------------------------------------------------
create function public.service_plan_state(target uuid, target_piece uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.plan_state_of(target, target_piece);
$$;

create function public.service_record_usage(target uuid, usage_kind text, target_piece uuid, target_part uuid, n integer default 1)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.usage_events (user_id, kind, plan_id, piece_id, part_id)
  select target, usage_kind, (public.plan_row_of(target)).id, target_piece, target_part
  from generate_series(1, n);
$$;

create function public.service_void_piece_created(target_piece uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.usage_events e set voided_at = now()
  where e.kind = 'piece_created' and e.piece_id = target_piece and e.voided_at is null;
$$;

-- The shims (ruling 7) ---------------------------------------------------------------------------
create or replace function public.is_creator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (public.plan_row_of((select auth.uid()))).id <> 'trial';
$$;

create or replace function public.service_is_creator(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = target)
      or (public.plan_row_of(target)).id <> 'trial';
$$;

-- The creator list is gone -------------------------------------------------------------------------
drop function public.list_creators();
drop function public.add_creator(text);
drop function public.remove_creator(text);
drop function public.set_creator_limits(text, integer, integer);
drop table public.creator_emails;

-- Grants -----------------------------------------------------------------------------------------
-- Internal: only the security definer functions and triggers call these.
revoke all on function public.email_hash(text) from public, anon, authenticated;
revoke all on function public.plan_row_of(uuid) from public, anon, authenticated;
revoke all on function public.plan_state_of(uuid, uuid) from public, anon, authenticated;
revoke all on function public.log_piece_created() from public, anon, authenticated;
revoke all on function public.require_advanced_reading() from public, anon, authenticated;
revoke all on function public.piece_member_limit(uuid) from public, anon, authenticated;

-- Run by the policies as the signed-in role, so authenticated needs the grant. Each decides for auth.uid() alone.
revoke all on function public.can_create_piece() from public, anon;
revoke all on function public.can_add_part(uuid, boolean) from public, anon;
revoke all on function public.can_upload_object(text) from public, anon;
grant execute on function public.can_create_piece() to authenticated;
grant execute on function public.can_add_part(uuid, boolean) to authenticated;
grant execute on function public.can_upload_object(text) to authenticated;

revoke all on function public.my_plan(uuid) from public, anon;
revoke all on function public.set_share_enabled(uuid, boolean, boolean) from public, anon;
revoke all on function public.delete_account() from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.save_admin_changes(jsonb) from public, anon;
revoke all on function public.is_creator() from public, anon;
grant execute on function public.my_plan(uuid) to authenticated;
grant execute on function public.set_share_enabled(uuid, boolean, boolean) to authenticated;
grant execute on function public.delete_account() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.save_admin_changes(jsonb) to authenticated;
grant execute on function public.is_creator() to authenticated;

revoke all on function public.service_plan_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_record_usage(uuid, text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.service_void_piece_created(uuid) from public, anon, authenticated;
revoke all on function public.service_is_creator(uuid) from public, anon, authenticated;
grant execute on function public.service_plan_state(uuid, uuid) to service_role;
grant execute on function public.service_record_usage(uuid, text, uuid, uuid, integer) to service_role;
grant execute on function public.service_void_piece_created(uuid) to service_role;
grant execute on function public.service_is_creator(uuid) to service_role;
