-- extra-objects.sql
-- Read-only audit. Changes nothing: SELECT statements only.
-- Run as: psql "$DB_URL" -At -f supabase/audit/extra-objects.sql > extra-objects.sql
-- With -A -t, psql prints only the result rows, so the output is itself runnable SQL,
-- one statement per line. It captures what `supabase db dump --schema public` misses:
--   1. triggers on auth.users
--   2. policies on storage.objects
--   3. tables in the supabase_realtime publication

-- 1. Triggers on auth.users
select pg_get_triggerdef(t.oid) || ';'
from pg_trigger t
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal
order by t.tgname;

-- 2. Policies on storage.objects
select format(
  'create policy %I on storage.objects as %s for %s to %s%s%s;',
  p.policyname,
  lower(p.permissive),
  lower(p.cmd),
  (select string_agg(format('%I', r), ', ') from unnest(p.roles) as r),
  case when p.qual is not null
       then ' using (' || replace(replace(p.qual, E'\r', ' '), E'\n', ' ') || ')'
       else '' end,
  case when p.with_check is not null
       then ' with check (' || replace(replace(p.with_check, E'\r', ' '), E'\n', ' ') || ')'
       else '' end
)
from pg_policies p
where p.schemaname = 'storage'
  and p.tablename = 'objects'
order by p.policyname;

-- 3. Realtime publication membership
select format('alter publication supabase_realtime add table %I.%I;', schemaname, tablename)
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;
