-- Delete account (Login and Sharing Spec, section 10 "Your data"). A signed-in user deletes their own account from
-- Settings. Every table that points at auth.users already cascades (creator_emails.added_by is set null), so deleting the
-- login removes the profile, the memberships and the practice memory with it.
--
-- Order matters and is the browser's job: Storage files can only be removed through the Storage API, so the browser first
-- deletes each piece the user owns (rows and files), and only then calls this. The function refuses while the caller still
-- owns a piece, so no file can be orphaned. It takes no user id: the caller is auth.uid() and nobody else can be deleted.
-- The admin cannot delete their account: the app has no way to add another admin, so it would be left with none.
-- No table, policy or table grant changes.

create function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
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
  delete from auth.users u where u.id = me;
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
