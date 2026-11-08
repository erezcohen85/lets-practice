-- The music rule (Decision 2026-11-06): to turn a share link on, the owner confirms the piece is their own music, in
-- the public domain, or used with permission. The time of that confirmation is kept on the piece's share row, and the
-- database refuses to switch a link on without it. A piece that stays private is not asked.
--
-- Not applied by the builder: the controller applies it with Erez.
--
--   * piece_shares.rights_confirmed_at: null until the owner confirms. Once set it stays (the owner is not asked again
--     for that piece), also when the link is turned off and on or its token is reset.
--   * Links that are on now keep working. The refusal fires only when a row is inserted already on, or changes from off
--     to on, so an existing link stays on until its owner next turns it off, and then asks for the confirmation to turn
--     it on again. A null here is how those old rows look; it does not break reading, resetting or turning them off.
--   * set_share_enabled gains a third argument, rights_confirmed (default false): true records the time, once, in the
--     same statement that turns the link on. The old two-argument form is dropped; a call with two arguments still works
--     and simply cannot turn on a link that has no confirmation.
--   * create_or_get_share now makes a new link off. It used to make one on, which would have shared a piece the moment
--     its owner opened the Share dialog, before any confirmation.
--   * Grants: piece_shares is select-only for authenticated (0009, 0010), a table-level grant that already covers the new
--     column, so the app reads rights_confirmed_at through it and writes it only through set_share_enabled.
--   * No other table, policy or grant changes.

alter table public.piece_shares add column rights_confirmed_at timestamptz;

-- New rows made by hand start off too; the functions below make the same choice explicitly.
alter table public.piece_shares alter column enabled set default false;

-- The backstop for every write path, whoever writes: an insert that is on, or an update from off to on, needs the time.
create function public.require_share_rights()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled
     and new.rights_confirmed_at is null
     and (tg_op = 'INSERT' or not old.enabled) then
    raise exception 'confirm the rights before sharing this piece' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger piece_shares_require_rights
  before insert or update on public.piece_shares
  for each row execute function public.require_share_rights();

revoke all on function public.require_share_rights() from public, anon, authenticated;

-- The result gains a column, which create or replace cannot do.
drop function public.create_or_get_share(uuid);

create function public.create_or_get_share(target_piece uuid)
returns table (token text, enabled boolean, rights_confirmed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
  end if;
  insert into public.piece_shares as s (piece_id, token, enabled)
  values (target_piece, public.new_share_token(), false)
  on conflict (piece_id) do nothing;
  return query select s.token, s.enabled, s.rights_confirmed_at from public.piece_shares s where s.piece_id = target_piece;
end;
$$;

drop function public.set_share_enabled(uuid, boolean);

create function public.set_share_enabled(target_piece uuid, is_on boolean, rights_confirmed boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pieces p where p.id = target_piece and p.owner_id = (select auth.uid())) then
    raise exception 'not your piece' using errcode = 'insufficient_privilege';
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

revoke all on function public.create_or_get_share(uuid) from public, anon;
revoke all on function public.set_share_enabled(uuid, boolean, boolean) from public, anon;
grant execute on function public.create_or_get_share(uuid) to authenticated;
grant execute on function public.set_share_enabled(uuid, boolean, boolean) to authenticated;
