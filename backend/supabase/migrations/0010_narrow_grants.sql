-- 0009 assumed that Supabase gives a new table to no role. Dev's default privileges do give every table to anon and
-- authenticated (read from pg_default_acl on 2026-11-05), so those roles held far more than 0009 lists. RLS still refused
-- the rows. This takes the table permissions down to what 0009 meant, so a mistaken policy later cannot expose anything.
-- No table, column, policy or row changes. It does nothing on a project without those defaults.

-- anon: nothing. The app reads nothing before sign-in.
revoke all on all tables in schema public from anon;

-- authenticated: only what the policies allow and the app uses (the list in 0009).
revoke all on public.admins, public.creator_emails from authenticated;
revoke insert, update, delete on public.jobs, public.piece_shares from authenticated;
revoke insert, update on public.piece_members from authenticated;
-- Not a table-wide revoke of update on profiles: that would also remove the three column grants of 0007.
revoke delete on public.profiles from authenticated;
-- RLS does not apply to truncate, and nothing in the app uses these.
revoke truncate, references, trigger, maintain on all tables in schema public from authenticated;

-- New tables start closed: a migration must grant what it means to.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
