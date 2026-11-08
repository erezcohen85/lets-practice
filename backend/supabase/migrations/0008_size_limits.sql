-- Size limits on the three columns a signed-in stranger can write (final review I-3). Any Google account
-- may update its own profile, and a member writes practice memory, so without a limit a few throw-away
-- accounts could fill the database, which is the cost the creators gate exists to stop.
-- The limits are many times what the app writes: settings are about 250 bytes (UserSettings), a practice
-- memory about 300 bytes with one loop (PracticeMemory), the terms version is a date such as 2026-11-02.

alter table public.profiles
  add constraint profiles_settings_size check (octet_length(settings::text) <= 16384),
  add constraint profiles_accepted_terms_version_size check (octet_length(accepted_terms_version) <= 32);

alter table public.piece_practice
  add constraint piece_practice_practice_size check (octet_length(practice::text) <= 65536);
