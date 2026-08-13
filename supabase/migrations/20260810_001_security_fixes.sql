-- ============================================================
-- ABAP Bakery — security fixes, part 1
--
-- Apply in the Supabase SQL editor. Run it as one block; it is
-- wrapped in a transaction, so either all of it lands or none does.
--
-- Nothing here deletes bakery data. It changes permissions,
-- policies, and function definitions only.
--
-- After applying, re-run supabase/audit/dump-schema.sql and diff.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. CRITICAL — stop staff from promoting themselves to admin.
--
-- The old policy was:
--     using ((id = auth.uid()) OR is_admin())   with_check: null
--
-- An UPDATE policy with no WITH CHECK reuses its USING expression,
-- so the only requirement was "the row is still yours". Nothing
-- stopped a staff account from setting role='admin' on itself.
--
-- Fix has two independent layers:
--   (a) column-level grants — Postgres refuses the write outright
--   (b) an explicit policy with a real WITH CHECK
--
-- The frontend never writes role/job_role/active directly; team.html
-- routes all of those through the manage-users Edge Function, which
-- uses the service_role key and bypasses both layers. So this does
-- not break admin user management.
-- ------------------------------------------------------------

revoke update on public.profiles from anon, authenticated;

-- The only columns a signed-in user may ever write on a profile row.
-- Note: role, job_role, and active are deliberately absent.
grant update (full_name, must_change_password)
  on public.profiles to authenticated;

drop policy if exists "profiles update self" on public.profiles;

create policy "profiles: update own row"
  on public.profiles for update
  to authenticated
  using      (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admin update any"
  on public.profiles for update
  to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- Restate the read/delete policies against the `authenticated` role
-- rather than `public`, so they can never apply to anonymous callers.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles: read all"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles admin del" on public.profiles;
create policy "profiles: admin delete"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());


-- ------------------------------------------------------------
-- 2. CRITICAL — views were readable by anyone with the public key.
--
-- A view without security_invoker runs as its OWNER (postgres, which
-- has BYPASSRLS). RLS on the underlying tables is skipped entirely.
-- Combined with the SELECT grant to `anon`, that made your cost
-- structure, recipe pricing, and staff names public to anyone who
-- read config.js off the GitHub Pages site.
--
-- security_invoker = on makes each view honour the CALLER's RLS.
-- Every underlying table already has a
--   "select ... using (auth.role() = 'authenticated')"
-- policy, so signed-in users see exactly what they saw before.
-- Requires PostgreSQL 15+. Supabase projects are 15 or newer.
-- ------------------------------------------------------------

-- Applied in a loop so that if this database predates PG 15, the
-- statement is skipped with a notice instead of aborting the whole
-- transaction and losing the fixes above. The anon revoke in step 3
-- closes the public exposure either way; security_invoker is what
-- keeps the views honest for signed-in users too.
do $$
declare v record;
begin
  for v in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    begin
      execute format('alter view public.%I set (security_invoker = on)', v.relname);
    exception when others then
      raise notice 'could not set security_invoker on %: %', v.relname, sqlerrm;
    end;
  end loop;
end $$;


-- ------------------------------------------------------------
-- 3. Strip every privilege from `anon`.
--
-- anon currently holds SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER on all 22 tables and all 13 views. RLS blocks
-- most of it today, but TRUNCATE is NOT subject to RLS — the grant
-- is the only thing standing between anon and an empty table. It
-- isn't reachable through PostgREST today, which doesn't emit
-- TRUNCATE, but it should never have been granted.
--
-- Signing in uses the Auth API, not PostgREST, so anon needs no
-- table access at all. Login is unaffected.
-- ------------------------------------------------------------

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- authenticated has no business with these three either.
revoke truncate, references, trigger
  on all tables in schema public from authenticated;

-- Keep future objects locked down by default.
alter default privileges in schema public
  revoke all on tables from anon;
alter default privileges in schema public
  revoke all on functions from anon;


-- ------------------------------------------------------------
-- 4. Pin search_path on SECURITY DEFINER functions.
--
-- A SECURITY DEFINER function with a mutable search_path can be
-- tricked into calling an attacker-supplied object shadowing a real
-- one. Standard hardening; also what the Supabase linter wants.
--
-- is_admin_or_baker is additionally promoted to SECURITY DEFINER so
-- it behaves consistently with is_admin() rather than depending on
-- the caller's ability to read the profiles table.
-- ------------------------------------------------------------

alter function public.is_admin()        set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;

create or replace function public.is_admin_or_baker()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role = 'admin' or job_role = 'baker')
  );
$$;

alter function public.archive_past_events()          set search_path = public, pg_temp;
alter function public.clear_expired_special_tasks()  set search_path = public, pg_temp;
alter function public.prune_note_history()           set search_path = public, pg_temp;


-- ------------------------------------------------------------
-- 5. Close the event approval bypass.
--
-- events.status defaults to 'pending' and the CHECK permits
-- 'approved'. The INSERT policy had no column condition, so a staff
-- account could insert an event that was already approved and skip
-- the review step. Approved events feed v_event_demand and therefore
-- your ingredient projections.
-- ------------------------------------------------------------

drop policy if exists "events insert" on public.events;
create policy "events: staff insert as pending"
  on public.events for insert
  to authenticated
  with check (status = 'pending' or public.is_admin());


-- ------------------------------------------------------------
-- 6. Turn on realtime.
--
-- config.js subscribeToChanges() listens for postgres_changes on
-- these tables, but the supabase_realtime publication is empty, so
-- no events have ever been delivered. The subscribe call fails
-- silently inside a try/catch. This is why cross-device updates
-- never appeared.
-- ------------------------------------------------------------

-- Skips tables already published, and skips the whole step if the
-- publication is defined FOR ALL TABLES (where adding is an error).
do $$
declare
  t text;
  all_tables boolean;
begin
  select puballtables into all_tables
    from pg_publication where pubname = 'supabase_realtime';

  if all_tables is null then
    raise notice 'supabase_realtime publication not found; skipping';
    return;
  elsif all_tables then
    raise notice 'supabase_realtime is FOR ALL TABLES; nothing to add';
    return;
  end if;

  foreach t in array array[
    'tasks','task_completions','special_tasks',
    'shift_note','inventory_items','order_log'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;


-- ============================================================
-- Verify. Run these separately after the transaction commits.
-- ============================================================

-- Should list exactly: full_name, must_change_password
-- select column_name, privilege_type
--   from information_schema.column_privileges
--  where table_name = 'profiles' and grantee = 'authenticated';

-- Should return zero rows.
-- select * from information_schema.role_table_grants
--  where table_schema = 'public' and grantee = 'anon';

-- Should list the six tables added above.
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and schemaname = 'public';

-- Every view should show security_invoker=on in its reloptions.
-- select c.relname, c.reloptions from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname='public' and c.relkind='v';
