-- ============================================================
-- ABAP Bakery — app settings
--
-- Moves the last of the hardcoded operational constants out of config.js:
-- the 30-minute idle logout and the 2-minute edit-mode revert. Both are
-- per-shop decisions, not universal truths.
--
-- Deliberately key/value rather than a single wide row with CHECK (id = 1).
-- company_info and shift_note both carry that constraint and ROADMAP List 5
-- flags them as schema welded shut against ever supporting more than one
-- shop per database. Not repeating that here.
-- ============================================================

begin;

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_.]*$')
);

comment on table public.app_settings is
  'Per-shop operational settings. Read by every page via loadAppSettings().';

-- Seeded with exactly the values that were hardcoded in config.js, so applying
-- this migration changes no behaviour on its own.
insert into public.app_settings (key, value) values
  ('idle_logout_minutes',      '30'::jsonb),
  ('edit_mode_timeout_minutes', '2'::jsonb),
  ('idle_warning_seconds',     '60'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

revoke all on public.app_settings from anon;
grant select on public.app_settings to authenticated;
grant insert, update, delete on public.app_settings to authenticated;  -- gated by RLS

create policy "app_settings: read"         on public.app_settings for select
  to authenticated using (true);
create policy "app_settings: admin insert" on public.app_settings for insert
  to authenticated with check (public.is_admin());
create policy "app_settings: admin update" on public.app_settings for update
  to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "app_settings: admin delete" on public.app_settings for delete
  to authenticated using (public.is_admin());

commit;


-- ============================================================
-- Verify
-- ============================================================
-- select key, value from app_settings order by key;
