-- Login and sharing (Login and Sharing Spec, section 4). RLS is in this file with its tables.
-- Every security definer function sets an empty search_path, checks its caller itself, and is
-- revoked from public and anon. Nothing inserts into piece_members except join_piece, and nothing
-- reads admins or creator_emails except the functions.

create extension if not exists pgcrypto with schema extensions;

-- 4.1 Profiles and terms -------------------------------------------------------------------------
alter table public.profiles
  add column display_name text,
  add column email text,
  add column accepted_terms_version text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email);
  return new;
end;
$$;

-- Only the trigger creates a profile row, and nobody calls the function directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke insert on public.profiles from authenticated, anon;

update public.profiles p
  set display_name = u.raw_user_meta_data->>'full_name', email = u.email
  from auth.users u
  where u.id = p.id;

-- A user may change their settings and their terms answer, not the name and email others see.
revoke update on public.profiles from authenticated, anon;
grant update (settings, accepted_terms_at, accepted_terms_version) on public.profiles to authenticated;

-- 4.2 Admin and creators -------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security; -- no policies on purpose

create table public.creator_emails (
  email text primary key check (email = lower(email)),
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);
alter table public.creator_emails enable row level security; -- no policies on purpose
create index creator_emails_added_by_idx on public.creator_emails (added_by);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create function public.is_creator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from auth.users u
    join public.creator_emails c on c.email = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;

drop policy pieces_insert_own on public.pieces;
create policy pieces_insert_own on public.pieces
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_creator());

-- Only creators may put files in the bucket: the gate exists to stop strangers spending storage.
drop policy pieces_objects_insert_own on storage.objects;
create policy pieces_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pieces'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_creator()
  );

create function public.list_creators()
returns table (email text, display_name text, signed_up boolean, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.email, p.display_name, u.id is not null, c.added_at
    from public.creator_emails c
    left join auth.users u on lower(u.email) = c.email
    left join public.profiles p on p.id = u.id
    order by c.added_at desc, c.email;
end;
$$;

create function public.add_creator(creator_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := lower(trim(creator_email));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if clean !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not an email' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.creator_emails (email, added_by)
  values (clean, (select auth.uid()))
  on conflict (email) do nothing;
end;
$$;

create function public.remove_creator(creator_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  delete from public.creator_emails c where c.email = lower(trim(creator_email));
end;
$$;

-- 4.3 Shares and members -------------------------------------------------------------------------
create table public.piece_shares (
  piece_id uuid primary key references public.pieces (id) on delete cascade,
  token text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.piece_shares enable row level security;

-- Select only: every write goes through create_or_get_share, set_share_enabled and reset_share_token, so an owner
-- cannot type a weak token.
create policy piece_shares_select_owner on public.piece_shares
  for select to authenticated
  using (exists (select 1 from public.pieces p where p.id = piece_id and p.owner_id = (select auth.uid())));

create table public.piece_members (
  piece_id uuid not null references public.pieces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (piece_id, user_id)
);
alter table public.piece_members enable row level security;
create index piece_members_user_id_idx on public.piece_members (user_id);

-- No insert policy: rows are added only by join_piece.
create policy piece_members_select on public.piece_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.pieces p where p.id = piece_id and p.owner_id = (select auth.uid()))
  );
create policy piece_members_delete on public.piece_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.pieces p where p.id = piece_id and p.owner_id = (select auth.uid()))
  );

-- 4.4 Read access for members --------------------------------------------------------------------
create function public.can_read_piece(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pieces x where x.id = p and x.owner_id = (select auth.uid()))
      or exists (select 1 from public.piece_members m where m.piece_id = p and m.user_id = (select auth.uid()));
$$;

create policy pieces_select_member on public.pieces
  for select to authenticated using (public.can_read_piece(id));
create policy score_files_select_member on public.score_files
  for select to authenticated using (public.can_read_piece(piece_id));
create policy audio_sources_select_member on public.audio_sources
  for select to authenticated using (public.can_read_piece(piece_id));
create policy play_order_select_member on public.play_order
  for select to authenticated using (public.can_read_piece(piece_id));
create policy locators_select_member on public.locators
  for select to authenticated using (public.can_read_piece(piece_id));
create policy jobs_select_member on public.jobs
  for select to authenticated using (public.can_read_piece(piece_id));
create policy score_pages_select_member on public.score_pages
  for select to authenticated
  using (exists (select 1 from public.score_files f where f.id = score_file_id and public.can_read_piece(f.piece_id)));
create policy bars_select_member on public.bars
  for select to authenticated
  using (exists (select 1 from public.score_files f where f.id = score_file_id and public.can_read_piece(f.piece_id)));

-- case, not "and": SQL does not promise the order of "and", and a malformed path must be a plain false, not a failed cast.
create policy pieces_objects_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pieces'
    and case
      when (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.can_read_piece(((storage.foldername(name))[2])::uuid)
          -- The first folder must be the piece's owner today: a client can choose a piece id, so files left behind by a
          -- deleted piece must not open for whoever re-creates the id.
          and exists (
            select 1 from public.pieces x
            where x.id = ((storage.foldername(name))[2])::uuid
              and x.owner_id::text = (storage.foldername(name))[1]
          )
      else false
    end
  );

-- 4.5 Sharing functions --------------------------------------------------------------------------
-- 18 random bytes give exactly 24 URL-safe characters with no padding: 144 bits.
create function public.new_share_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_');
$$;

create function public.create_or_get_share(target_piece uuid)
returns table (token text, enabled boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  insert into public.piece_shares as s (piece_id, token)
  values (target_piece, public.new_share_token())
  on conflict (piece_id) do nothing;
  return query select s.token, s.enabled from public.piece_shares s where s.piece_id = target_piece;
end;
$$;

create function public.set_share_enabled(target_piece uuid, is_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  update public.piece_shares s set enabled = is_on where s.piece_id = target_piece;
end;
$$;

create function public.reset_share_token(target_piece uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh text := public.new_share_token();
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  insert into public.piece_shares as s (piece_id, token)
  values (target_piece, fresh)
  on conflict (piece_id) do update set token = excluded.token;
  return fresh;
end;
$$;

-- Owner and member come before the on/off check: turning the link off stops new joins only (spec 2).
create function public.join_piece(share_token text)
returns table (piece_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := (select auth.uid());
  target uuid;
  owner uuid;
  is_enabled boolean;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  select s.piece_id, p.owner_id, s.enabled into target, owner, is_enabled
  from public.piece_shares s
  join public.pieces p on p.id = s.piece_id
  where s.token = share_token;
  if target is null then
    return query select null::uuid, 'not_found'::text;
  elsif owner = me then
    return query select target, 'owner'::text;
  elsif exists (select 1 from public.piece_members m where m.piece_id = target and m.user_id = me) then
    return query select target, 'already_member'::text;
  elsif not is_enabled then
    return query select null::uuid, 'link_off'::text;
  else
    insert into public.piece_members (piece_id, user_id) values (target, me) on conflict do nothing;
    return query select target, 'joined'::text;
  end if;
end;
$$;

create function public.list_members(target_piece uuid)
returns table (user_id uuid, display_name text, email text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.display_name, u.email::text, m.joined_at
  from public.piece_members m
  join public.pieces x on x.id = m.piece_id and x.owner_id = (select auth.uid())
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.piece_id = target_piece
  order by m.joined_at desc;
$$;

create function public.piece_owner_names(target_pieces uuid[])
returns table (piece_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, p.display_name
  from public.pieces x
  left join public.profiles p on p.id = x.owner_id
  where x.id = any (target_pieces) and public.can_read_piece(x.id);
$$;

-- 4.6 Practice memory per user -------------------------------------------------------------------
create table public.piece_practice (
  user_id uuid not null references auth.users (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  practice jsonb not null default '{}'::jsonb check (jsonb_typeof(practice) = 'object'),
  count_in_bars int check (count_in_bars between 0 and 4),
  last_part_id uuid references public.score_files (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, piece_id)
);
alter table public.piece_practice enable row level security;
create index piece_practice_piece_id_idx on public.piece_practice (piece_id);
create index piece_practice_last_part_id_idx on public.piece_practice (last_part_id);

create policy piece_practice_select_own on public.piece_practice
  for select to authenticated using (user_id = (select auth.uid()));
create policy piece_practice_insert_own on public.piece_practice
  for insert to authenticated with check (user_id = (select auth.uid()) and public.can_read_piece(piece_id));
create policy piece_practice_update_own on public.piece_practice
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_read_piece(piece_id));
create policy piece_practice_delete_own on public.piece_practice
  for delete to authenticated using (user_id = (select auth.uid()));

insert into public.piece_practice (user_id, piece_id, practice, count_in_bars, last_part_id)
select owner_id, id, practice, count_in_bars, last_part_id from public.pieces;

-- After piece_practice, because a language sql or plpgsql body names it.
create function public.leave_piece(target_piece uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.piece_members m where m.piece_id = target_piece and m.user_id = (select auth.uid());
  -- Only a real membership: an owner calling this must not lose their own memory.
  if found then
    delete from public.piece_practice r where r.piece_id = target_piece and r.user_id = (select auth.uid());
  end if;
end;
$$;

-- Grants -----------------------------------------------------------------------------------------
revoke all on function public.new_share_token() from public, anon, authenticated;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_creator() from public, anon;
revoke all on function public.can_read_piece(uuid) from public, anon;
revoke all on function public.list_creators() from public, anon;
revoke all on function public.add_creator(text) from public, anon;
revoke all on function public.remove_creator(text) from public, anon;
revoke all on function public.create_or_get_share(uuid) from public, anon;
revoke all on function public.set_share_enabled(uuid, boolean) from public, anon;
revoke all on function public.reset_share_token(uuid) from public, anon;
revoke all on function public.join_piece(text) from public, anon;
revoke all on function public.leave_piece(uuid) from public, anon;
revoke all on function public.list_members(uuid) from public, anon;
revoke all on function public.piece_owner_names(uuid[]) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_creator() to authenticated;
grant execute on function public.can_read_piece(uuid) to authenticated;
grant execute on function public.list_creators() to authenticated;
grant execute on function public.add_creator(text) to authenticated;
grant execute on function public.remove_creator(text) to authenticated;
grant execute on function public.create_or_get_share(uuid) to authenticated;
grant execute on function public.set_share_enabled(uuid, boolean) to authenticated;
grant execute on function public.reset_share_token(uuid) to authenticated;
grant execute on function public.join_piece(text) to authenticated;
grant execute on function public.leave_piece(uuid) to authenticated;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.piece_owner_names(uuid[]) to authenticated;
