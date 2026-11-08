-- The member limit (Erez, 2026-11-07): a piece admits the larger of members_per_piece, or members_per_part times its number
-- of parts (rows in score_files). The admin sets both per creator on the creator's creator_emails row; an owner with no row
-- (the admin, or a creator since removed) gets the defaults, 30 and 10. So 1 to 3 parts admit 30, 4 parts 40, 14 parts 140.
--
-- Not applied by the builder: the controller applies it with Erez.
--
--   * A full piece: join_piece refuses a new person with the status 'full' (after 'link_off': a link that is off is the
--     reason first). An owner and a member get 'owner' and 'already_member' as before.
--   * A lowered limit (the admin lowers it, or the owner deletes a part): the newest joiners over the limit are on hold.
--     They stay in piece_members and lose all read access until there is room again, which comes back by itself when
--     someone leaves or is removed, or the limit rises. Nothing about the hold is stored: it is worked out from the join
--     order, oldest first (joined_at, then user_id to break a tie), so a race that overfills a piece only puts the extra
--     person on hold.
--   * can_read_piece is the one check every member read goes through (the rows of 0007 4.4 and storage.objects), so it
--     alone learns the hold, and no policy changes. It keeps its signature, its grants and security definer.
--   * piece_member_limit and member_has_room are internal: only the security definer functions call them.
--   * list_members gains on_hold, list_creators the two numbers (both dropped and re-created, granted as before).
--   * New: share_member_limit (owner only, for the Share dialog), set_creator_limits (admin only) and my_held_pieces (a
--     member's own held pieces, which they can no longer read through pieces).
--   * creator_emails stays closed to every role (0010): its new columns are read and written only through the functions.

alter table public.creator_emails
  add column members_per_piece integer not null default 30 check (members_per_piece between 1 and 500),
  add column members_per_part integer not null default 10 check (members_per_part between 0 and 100);

-- The join order of a piece, read by every hold check.
create index piece_members_piece_joined_idx on public.piece_members (piece_id, joined_at, user_id);

-- The defaults here are the columns' defaults above, for an owner with no creator row. Null for an unknown piece.
create function public.piece_member_limit(p uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce(c.members_per_piece, 30),
    coalesce(c.members_per_part, 10) * (select count(*)::integer from public.score_files f where f.piece_id = x.id)
  )
  from public.pieces x
  left join auth.users u on u.id = x.owner_id
  left join public.creator_emails c on c.email = lower(u.email)
  where x.id = p;
$$;

-- True when u is a member of p and fewer than the limit joined before them; false for anyone who is not a member.
create function public.member_has_room(p uuid, u uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select count(*) filter (where (m.joined_at, m.user_id) < (me.joined_at, me.user_id)) < public.piece_member_limit(p)
    from public.piece_members me
    join public.piece_members m on m.piece_id = me.piece_id
    where me.piece_id = p and me.user_id = u
    group by me.joined_at, me.user_id
  ), false);
$$;

create or replace function public.can_read_piece(p uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pieces x where x.id = p and x.owner_id = (select auth.uid()))
      or public.member_has_room(p, (select auth.uid()));
$$;

-- Every branch and its order as in 0007; 'full' comes after 'link_off'.
create or replace function public.join_piece(share_token text)
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
  elsif (select count(*) from public.piece_members m where m.piece_id = target) >= public.piece_member_limit(target) then
    return query select null::uuid, 'full'::text;
  else
    insert into public.piece_members (piece_id, user_id) values (target, me) on conflict do nothing;
    return query select target, 'joined'::text;
  end if;
end;
$$;

-- The result gains a column, which create or replace cannot do.
drop function public.list_members(uuid);

create function public.list_members(target_piece uuid)
returns table (user_id uuid, display_name text, email text, joined_at timestamptz, on_hold boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.display_name, u.email::text, m.joined_at, not public.member_has_room(m.piece_id, m.user_id)
  from public.piece_members m
  join public.pieces x on x.id = m.piece_id and x.owner_id = (select auth.uid())
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.piece_id = target_piece
  order by m.joined_at desc, m.user_id desc;
$$;

-- The Share dialog's count line: the piece's limit and how many joined, the held ones included.
create function public.share_member_limit(target_piece uuid)
returns table (member_limit integer, member_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  return query
    select public.piece_member_limit(target_piece),
           (select count(*)::integer from public.piece_members m where m.piece_id = target_piece);
end;
$$;

-- A member's own held pieces: they can no longer read these through pieces, and the Library still shows them, on hold.
create function public.my_held_pieces()
returns table (piece_id uuid, title text, owner_name text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.title, p.display_name, m.joined_at
  from public.piece_members m
  join public.pieces x on x.id = m.piece_id
  left join public.profiles p on p.id = x.owner_id
  where m.user_id = (select auth.uid())
    and not public.member_has_room(m.piece_id, m.user_id)
  order by m.joined_at desc;
$$;

-- The result gains two columns, which create or replace cannot do.
drop function public.list_creators();

create function public.list_creators()
returns table (
  email text,
  display_name text,
  signed_up boolean,
  added_at timestamptz,
  members_per_piece integer,
  members_per_part integer
)
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
    select c.email, p.display_name, u.id is not null, c.added_at, c.members_per_piece, c.members_per_part
    from public.creator_emails c
    left join auth.users u on lower(u.email) = c.email
    left join public.profiles p on p.id = u.id
    order by c.added_at desc, c.email;
end;
$$;

-- The bounds are the columns' check constraints; a number outside them fails there and changes nothing.
create function public.set_creator_limits(creator_email text, per_piece integer, per_part integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.creator_emails c
  set members_per_piece = per_piece, members_per_part = per_part
  where c.email = lower(trim(creator_email));
  if not found then
    raise exception 'not a creator' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Grants -----------------------------------------------------------------------------------------
revoke all on function public.piece_member_limit(uuid) from public, anon, authenticated;
revoke all on function public.member_has_room(uuid, uuid) from public, anon, authenticated;

revoke all on function public.list_members(uuid) from public, anon;
revoke all on function public.share_member_limit(uuid) from public, anon;
revoke all on function public.my_held_pieces() from public, anon;
revoke all on function public.list_creators() from public, anon;
revoke all on function public.set_creator_limits(text, integer, integer) from public, anon;

grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.share_member_limit(uuid) to authenticated;
grant execute on function public.my_held_pieces() to authenticated;
grant execute on function public.list_creators() to authenticated;
grant execute on function public.set_creator_limits(text, integer, integer) to authenticated;
