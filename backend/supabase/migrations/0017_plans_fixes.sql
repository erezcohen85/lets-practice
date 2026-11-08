-- Plans and usage limits, the fixes of the final review (Erez, 2026-11-08). Applied migrations never change, and 0015 and
-- 0016 (the sample piece) are already applied on the Dev project, so the fixes that were first written into 0015 live here.
-- Spec: docs/plans/2026-11-08-plans-and-limits-design.md; the review is .superpowers/sdd/2026-11-08-plans-and-limits/final-review.md.
-- This file takes a database at 0015 (the applied text) and 0016 to the fixed design; a database that gets 0015, 0016 and
-- 0017 in one go ends up the same.
--
-- Not applied by the builder: the controller applies it with Erez.
--
--   * C1, the piece and part limits are before-insert triggers, not policies. The policies asked a stable function, which
--     sees the counts from the start of the statement, so one multi-row INSERT got past every limit (and two inserts at once
--     did the same). enforce_piece_limits (before insert on pieces) and enforce_part_limits (before insert or update of
--     piece_id on score_files) are volatile: each row sees the rows the same statement wrote before it. They first take an
--     advisory lock ('plan-user:<owner>', and 'plan-day:<plan>' for the plan-wide daily cap; parts lock the piece row), so
--     transactions at once wait their turn. enforce_piece_limits counts, writes the piece_created event in that same
--     trigger, and refuses with plan_limit:<key> (check_violation); enforce_part_limits does the same for parts and for the
--     Advanced Reading tick. Only a signed-in user is checked; the service role and the SQL editor (no auth.uid()) are not,
--     which is how the sample copy of 0016 (service_copy_sample_piece) goes in whatever the plan says. Its piece_created
--     event is written by the trigger and then marked is_sample by that function, as before: the sample counts as a piece
--     created and stored, and the daily cap never counts it (the trigger and service_claim_piece both skip is_sample).
--     can_create_piece, can_add_part, log_piece_created and the after-insert trigger pieces_log_created are dropped, and the
--     two insert policies become plain ownership checks. Every plan refusal now names its limit in the error.
--   * I1, a signed-in user may not change a part's piece_id (a part moved into another piece skipped the parts limit).
--   * I2 (option b), service_claim_piece: process-piece asks it first. A refusal at job time voids the piece's created event
--     and keeps the piece; the claim clears the event again when pieces made ever and, for an event of today and not of a
--     sample, the plan-wide daily cap still have room, else it answers the key and changes nothing.
--   * I3, service_use_advanced_reading checks the plan for Advanced Reading and records the parts in one step under the user's
--     lock, so jobs that start together cannot both take the last parts of the month.
--   * M3, set_share_enabled takes the owner's lock before it counts the links that are on.
--   * M5, admin_overview (0016's version, with its is_sample handling) also returns assigned_plan_id for each person: the plan
--     on the plan_emails row, null when there is none.
--   * Erez's decision on the review's M8(c): the email hash in trial_ledger is keyed. public.private_settings is a closed
--     table (RLS on, no policy, nothing granted to anon or authenticated) that holds the 'trial_ledger_pepper', 64 random hex
--     characters made at apply time without an extension. email_hash(address) is now sha256(pepper || ':' || lower(trim(address))).
--     The Dev trial_ledger has no rows, so nothing needs hashing again; rows written by the plain hash of 0015 would no longer
--     match, so this must run before any ledger row is written for real. Keep the pepper: if it is lost or replaced, every
--     ledger row stops matching. The comment in service_copy_sample_piece (0016) that says log_piece_created writes the event
--     is out of date: enforce_piece_limits writes it now; that function is not replaced.

-- The ledger must be empty: a row hashed without the pepper (0015's plain hash) would silently stop matching.
do $$
begin
  if exists (select 1 from public.trial_ledger) then
    raise exception '0017: trial_ledger has rows hashed without the pepper';
  end if;
end $$;

-- The keyed hash -----------------------------------------------------------------------------------
create table public.private_settings (
  key text primary key,
  value text not null
);
alter table public.private_settings enable row level security; -- no policies on purpose
revoke all on public.private_settings from public, anon, authenticated, service_role; -- Supabase's default privileges give service_role every new table

insert into public.private_settings (key, value)
values (
  'trial_ledger_pepper',
  encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex')
)
on conflict (key) do nothing;

-- Stable, not immutable: it reads the pepper. Security definer so the callers that run as a signed-in role never read the table.
-- A missing pepper refuses instead of returning null (a null hash would quietly match nothing and break delete_account).
create or replace function public.email_hash(address text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pepper text;
begin
  select s.value into pepper from public.private_settings s where s.key = 'trial_ledger_pepper';
  if pepper is null then
    raise exception 'trial_ledger_pepper missing';
  end if;
  return encode(sha256(convert_to(pepper || ':' || lower(trim(address)), 'UTF8')), 'hex');
end;
$$;

-- The piece and part limits as triggers (C1, I1) ---------------------------------------------------
-- The plain ownership checks first: the policies must stop calling the helpers before those are dropped.
drop policy pieces_insert_own on public.pieces;
create policy pieces_insert_own on public.pieces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy score_files_insert_own on public.score_files;
create policy score_files_insert_own on public.score_files
  for insert to authenticated
  with check (
    exists (
      select 1 from public.pieces p
      where p.id = score_files.piece_id and p.owner_id = (select auth.uid())
    )
  );

drop trigger pieces_log_created on public.pieces;
drop function public.log_piece_created();
drop function public.can_create_piece();
drop function public.can_add_part(uuid, boolean);

-- Before every insert of a piece: the owner's locks, the limits that apply, and the piece_created event. The admin is never
-- limited. A piece whose id already exists is left alone (an insert that will conflict makes nothing, so it must not count). An
-- owner who is not the caller is left to the insert policy to refuse. If the statement fails anywhere after this, the event
-- goes with it. The plan-wide daily cap does not count sample copies (is_sample, 0016).
create function public.enforce_piece_limits()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.plans;
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  if me is not null and new.owner_id is distinct from me then
    return new;
  end if;
  if exists (select 1 from public.pieces x where x.id = new.id) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plan-user:' || new.owner_id::text, 0));
  pl := public.plan_row_of(new.owner_id);
  if me is not null and not exists (select 1 from public.admins a where a.user_id = me) then
    if pl.new_pieces_paused then
      raise exception 'plan_limit:new_pieces_paused' using errcode = 'check_violation';
    end if;
    if pl.new_pieces_per_day is not null then
      perform pg_advisory_xact_lock(hashtextextended('plan-day:' || pl.id, 0));
      if (
        select count(*) from public.usage_events e
        where e.kind = 'piece_created' and e.plan_id = pl.id and e.voided_at is null and not e.is_sample and e.at >= day_start
      ) >= pl.new_pieces_per_day then
        raise exception 'plan_limit:new_pieces_per_day' using errcode = 'check_violation';
      end if;
    end if;
    if pl.pieces_created_max is not null and (
        (select count(*) from public.usage_events e where e.user_id = new.owner_id and e.kind = 'piece_created' and e.voided_at is null)
        + coalesce((
          select l.pieces_created from public.trial_ledger l
          where l.email_hash = public.email_hash((select x.email from auth.users x where x.id = new.owner_id))
        ), 0)
      ) >= pl.pieces_created_max then
      raise exception 'plan_limit:pieces_created_max' using errcode = 'check_violation';
    end if;
    if pl.pieces_stored_max is not null and (select count(*) from public.pieces x where x.owner_id = new.owner_id) >= pl.pieces_stored_max then
      raise exception 'plan_limit:pieces_stored_max' using errcode = 'check_violation';
    end if;
  end if;
  insert into public.usage_events (user_id, kind, plan_id, piece_id)
  values (new.owner_id, 'piece_created', pl.id, new.id);
  return new;
end;
$$;

create trigger pieces_enforce_limits
  before insert on public.pieces
  for each row execute function public.enforce_piece_limits();

-- Before every insert of a part, and before a change of its piece_id. Insert: lock the piece row (no key update: the foreign
-- key check is not held up), then the parts-per-piece limit and the Advanced Reading tick. A piece that is not the caller's is
-- left to the insert policy. Update of piece_id: a signed-in user may not move a part to another piece, which would skip the
-- parts limit (the app never does).
create function public.enforce_part_limits()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pl public.plans;
begin
  if me is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.piece_id is distinct from old.piece_id then
      raise exception 'a part cannot be moved to another piece' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  perform 1 from public.pieces x where x.id = new.piece_id and x.owner_id = me for no key update;
  if not found or exists (select 1 from public.admins a where a.user_id = me) then
    return new;
  end if;
  pl := public.plan_row_of(me);
  if pl.parts_per_piece_max is not null and (select count(*) from public.score_files f where f.piece_id = new.piece_id) >= pl.parts_per_piece_max then
    raise exception 'plan_limit:parts_per_piece_max' using errcode = 'check_violation';
  end if;
  if coalesce(new.box_check, false) and not pl.advanced_reading then
    raise exception 'plan_limit:advanced_reading' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger score_files_enforce_limits
  before insert or update of piece_id on public.score_files
  for each row execute function public.enforce_part_limits();

-- One link-turning at a time (M3) ------------------------------------------------------------------
-- As 0015, plus one advisory lock on the owner before the links that are on are counted.
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
    -- One link-turning at a time per owner: two calls at once must not both pass the count (final review M3).
    perform pg_advisory_xact_lock(hashtextextended('plan-user:' || me::text, 0));
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

-- The admin hub: the plan on a person's plan_emails row (M5) ----------------------------------------
-- As 0016 (the per-plan new_pieces_today skips the sample), plus assigned_plan_id on each person: the plan on the plan_emails
-- row, null when there is none, so the hub can tell an unconfirmed creator (plan_id trial, assigned_plan_id creator) from a
-- Trial user.
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
           e.plan_id as assigned_plan_id,
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
    select e.email, null, false, null, e.plan_id, true, e.plan_id, false, e.added_at, 0, 0, 0
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

-- The processor's side (I2 option b, I3) ------------------------------------------------------------
-- Advanced Reading for a job, checked and recorded in one step under the user's lock: two jobs that start together cannot both
-- take the last parts of the month, and a plan without Advanced Reading is refused at the time the model would run, not only at
-- the route. Returns null when the parts were recorded (one event each, in the order given), else the key of the limit that
-- refused, with nothing recorded. The admin is never limited.
create function public.service_use_advanced_reading(target uuid, target_piece uuid, target_parts uuid[])
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pl public.plans;
  wanted integer := coalesce(cardinality(target_parts), 0);
  month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
  if wanted = 0 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plan-user:' || target::text, 0));
  pl := public.plan_row_of(target);
  if exists (select 1 from public.admins a where a.user_id = target) then
    null; -- the admin is never limited
  elsif not pl.advanced_reading then
    return 'advanced_reading';
  elsif pl.advanced_reading_parts_per_month is not null and (
    select count(*) from public.usage_events e
    where e.user_id = target and e.kind = 'advanced_reading_part' and e.voided_at is null and e.at >= month_start
  ) + wanted > pl.advanced_reading_parts_per_month then
    return 'advanced_reading_parts_per_month';
  end if;
  insert into public.usage_events (user_id, kind, plan_id, piece_id, part_id)
  select target, 'advanced_reading_part', pl.id, target_piece, p.part
  from unnest(target_parts) with ordinality as p(part, n)
  order by p.n;
  return null;
end;
$$;

-- Claims a piece's slot again before process-piece. A job-time plan refusal voided the piece's created event; this clears it
-- when the owner's plan still has room, under the owner's locks, and otherwise returns the key of the limit (pieces_created_max
-- or new_pieces_per_day) and changes nothing. No voided event, no piece, or the admin: nothing to refuse. Pieces stored is not
-- asked (the piece already exists), nor is the pause. The daily cap is asked only for an event of today that is not a sample's.
create function public.service_claim_piece(target_piece uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  owner uuid;
  pl public.plans;
  ev public.usage_events;
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  select x.owner_id into owner from public.pieces x where x.id = target_piece;
  if owner is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plan-user:' || owner::text, 0));
  if exists (select 1 from public.usage_events e where e.piece_id = target_piece and e.kind = 'piece_created' and e.voided_at is null) then
    return null;
  end if;
  select e.* into ev from public.usage_events e
  where e.piece_id = target_piece and e.kind = 'piece_created' and e.voided_at is not null
  order by e.id desc limit 1;
  if not found then
    return null;
  end if;
  pl := public.plan_row_of(owner);
  if not exists (select 1 from public.admins a where a.user_id = owner) then
    if pl.new_pieces_per_day is not null and ev.at >= day_start and not ev.is_sample then
      perform pg_advisory_xact_lock(hashtextextended('plan-day:' || pl.id, 0));
      if (
        select count(*) from public.usage_events e
        where e.kind = 'piece_created' and e.plan_id = pl.id and e.voided_at is null and not e.is_sample and e.at >= day_start
      ) >= pl.new_pieces_per_day then
        return 'new_pieces_per_day';
      end if;
    end if;
    if pl.pieces_created_max is not null and (
        (select count(*) from public.usage_events e where e.user_id = owner and e.kind = 'piece_created' and e.voided_at is null)
        + coalesce((
          select l.pieces_created from public.trial_ledger l
          where l.email_hash = public.email_hash((select x.email from auth.users x where x.id = owner))
        ), 0)
      ) >= pl.pieces_created_max then
      return 'pieces_created_max';
    end if;
  end if;
  update public.usage_events e set voided_at = null where e.id = ev.id;
  return null;
end;
$$;

-- Grants -----------------------------------------------------------------------------------------
-- The replaced functions keep their grants; these lines say them again for the reader.
revoke all on function public.email_hash(text) from public, anon, authenticated;
revoke all on function public.enforce_piece_limits() from public, anon, authenticated;
revoke all on function public.enforce_part_limits() from public, anon, authenticated;

revoke all on function public.set_share_enabled(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_share_enabled(uuid, boolean, boolean) to authenticated;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

revoke all on function public.service_use_advanced_reading(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.service_claim_piece(uuid) from public, anon, authenticated;
grant execute on function public.service_use_advanced_reading(uuid, uuid, uuid[]) to service_role;
grant execute on function public.service_claim_piece(uuid) to service_role;
