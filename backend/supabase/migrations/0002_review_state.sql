-- Review state on the locators (Phase 6, task 6.1). The processor writes the review flags it finds
-- for each locator as a jsonb array of ReviewFlag objects (snake_case: kind, severity, expected,
-- found, factor, explained_by, uncertain_line); `checked` is true when the score explains all of
-- them, or when the user has resolved the item. Columns only: the locators policies of 0001
-- already cover them, so no table, policy or index is added.

alter table public.locators
  add column flags jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  add column checked boolean not null default false;
