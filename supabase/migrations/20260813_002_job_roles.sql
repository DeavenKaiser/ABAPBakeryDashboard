-- ============================================================
-- ABAP Bakery — data-driven job roles
--
-- Replaces three hardcoded CHECK constraints and a name-matching hack in
-- config.js with a real table. Prerequisite for the settings pages, the
-- production board's suggested_role, and — most importantly — for rolling
-- this out to a coffee shop, which has no "baker".
--
-- Apply in the Supabase SQL editor. Wrapped in a transaction.
-- Safe to run against live data: seeds exactly the four keys the CHECK
-- constraints already permitted, so nothing can fail the new foreign keys.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. The table
--
-- `assignable` distinguishes a real job (someone can BE a baker) from the
-- 'shared' bucket, which owns tasks and inventory but is nobody's job.
-- That distinction was previously implicit in `[...ROLES,"shared"]` scattered
-- through the frontend.
-- ------------------------------------------------------------

create table if not exists public.job_roles (
  key         text primary key,
  label       text not null,
  -- Day of week this role counts inventory. 0=Sun .. 6=Sat. NULL means "no
  -- fixed day — fall back to the task's frequency". Was ROLE_DUE_DOW in JS.
  due_dow     smallint,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  assignable  boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint job_roles_due_dow_check check (due_dow is null or due_dow between 0 and 6),
  constraint job_roles_key_format     check (key ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.job_roles is
  'Job roles per shop. Replaces hardcoded baker/barista/cleaning lists.';

-- ------------------------------------------------------------
-- 2. Seed with exactly what the CHECK constraints allowed, and the due days
--    that were hardcoded in config.js as ROLE_DUE_DOW = {baker:3, barista:6}.
-- ------------------------------------------------------------

insert into public.job_roles (key, label, due_dow, sort_order, assignable) values
  ('baker',    'Baker',    3,    1, true),   -- Wednesday
  ('barista',  'Barista',  6,    2, true),   -- Saturday
  ('cleaning', 'Cleaning', null, 3, true),   -- by frequency
  ('shared',   'Shared',   null, 99, false)  -- everyone's, nobody's job
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. Backfill profiles.job_role
--
-- config.js contained this, and it is why the app worked at all for staff
-- whose job_role was never set:
--
--     if (n.includes("sierra"))    return "baker";
--     if (n.includes("mackenzie")) return "barista";
--     if (n.includes("marilyn"))   return "cleaning";
--
-- Running it once here as a data fix means the fallback can be deleted from
-- the code instead of shipping employee names to every other shop.
-- Only touches rows where job_role IS NULL, so anything set explicitly wins.
-- ------------------------------------------------------------

update public.profiles set job_role = 'baker'
 where job_role is null and lower(full_name) like '%sierra%';

update public.profiles set job_role = 'barista'
 where job_role is null and (lower(full_name) like '%mackenzie%'
                          or lower(full_name) like '%kenzie%');

update public.profiles set job_role = 'cleaning'
 where job_role is null and lower(full_name) like '%marilyn%';

-- ------------------------------------------------------------
-- 4. Swap the CHECK constraints for foreign keys
--
-- ON DELETE RESTRICT: a role that owns tasks or inventory cannot be deleted
-- out from under them. Retire a role by setting active = false instead.
-- ------------------------------------------------------------

alter table public.profiles         drop constraint if exists profiles_job_role_check;
alter table public.tasks            drop constraint if exists tasks_owner_check;
alter table public.inventory_items  drop constraint if exists inventory_items_owner_check;

alter table public.profiles
  add constraint profiles_job_role_fkey
  foreign key (job_role) references public.job_roles(key) on delete restrict;

alter table public.tasks
  add constraint tasks_owner_fkey
  foreign key (owner) references public.job_roles(key) on delete restrict;

alter table public.inventory_items
  add constraint inventory_items_owner_fkey
  foreign key (owner) references public.job_roles(key) on delete restrict;

-- ------------------------------------------------------------
-- 5. Nobody's job is 'shared'
--
-- A foreign key alone would happily let an admin set someone's job_role to
-- 'shared'. Enforced in the database rather than the client, because the
-- Edge Function, the UI, and any future importer all need the same rule.
-- ------------------------------------------------------------

create or replace function public.check_job_role_assignable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.job_role is not null then
    if not exists (
      select 1 from job_roles
       where key = new.job_role and assignable and active
    ) then
      raise exception 'Job role "%" cannot be assigned to a person.', new.job_role;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_job_role_assignable on public.profiles;
create trigger trg_check_job_role_assignable
  before insert or update of job_role on public.profiles
  for each row execute function public.check_job_role_assignable();

-- ------------------------------------------------------------
-- 6. Access — mirrors the pattern set in migration 001
-- ------------------------------------------------------------

alter table public.job_roles enable row level security;

revoke all on public.job_roles from anon;
grant select on public.job_roles to authenticated;
grant insert, update, delete on public.job_roles to authenticated;  -- gated by RLS below

create policy "job_roles: read"         on public.job_roles for select
  to authenticated using (true);
create policy "job_roles: admin insert" on public.job_roles for insert
  to authenticated with check (public.is_admin());
create policy "job_roles: admin update" on public.job_roles for update
  to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "job_roles: admin delete" on public.job_roles for delete
  to authenticated using (public.is_admin());

-- ------------------------------------------------------------
-- 7. Recipe editing becomes a per-role permission
--
-- is_admin_or_baker() encoded one shop's policy — "bakers may edit recipes" —
-- in the database, and recipes.html mirrored it with `jobRole === "baker"`.
-- A coffee shop has no baker, so nobody but an admin could edit anything.
--
-- The function KEEPS ITS NAME deliberately: six RLS policies reference it
-- (recipes and recipe_ingredients, three commands each). Renaming would mean
-- rewriting all six for no behavioural gain. Only the body changes.
-- ------------------------------------------------------------

alter table public.job_roles
  add column if not exists can_edit_recipes boolean not null default false;

update public.job_roles set can_edit_recipes = true where key = 'baker';

create or replace function public.is_admin_or_baker()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from profiles p
      left join job_roles jr on jr.key = p.job_role
     where p.id = auth.uid()
       and (p.role = 'admin' or (jr.can_edit_recipes and jr.active))
  );
$$;

comment on function public.is_admin_or_baker() is
  'Legacy name. Now means: admin, or a job role with can_edit_recipes. '
  'Referenced by RLS on recipes and recipe_ingredients.';

commit;


-- ============================================================
-- Verify
-- ============================================================

-- Four rows; baker=3, barista=6, shared not assignable.
-- select key, label, due_dow, assignable, active from job_roles order by sort_order;

-- Every profile with a job should now have one explicitly.
-- select full_name, job_role from profiles order by full_name;

-- Should be three FKs and zero of the old CHECKs.
-- select conname, contype from pg_constraint
--  where conrelid in ('profiles'::regclass,'tasks'::regclass,'inventory_items'::regclass)
--    and conname like '%job_role%' or conname like '%owner%';

-- Should raise: 'Job role "shared" cannot be assigned to a person.'
-- update profiles set job_role='shared' where id = (select id from profiles limit 1);
