-- ============================================================
-- ABAP Bakery — schema + security audit dump
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It returns ONE row with ONE column of JSON. Click the cell, copy it all,
-- and paste it back into the chat.
--
-- This is read-only. It changes nothing.
-- It does NOT return any of your bakery data — only structure and policies.
-- ============================================================

select jsonb_pretty(jsonb_build_object(

  -- Tables, and whether Row-Level Security is actually turned on.
  -- rls_enabled = false on any table means that table is wide open.
  'tables', (
    select coalesce(jsonb_agg(t order by t->>'table'), '[]'::jsonb) from (
      select jsonb_build_object(
        'table',        c.relname,
        'rls_enabled',  c.relrowsecurity,
        'rls_forced',   c.relforcerowsecurity,
        'policy_count', (select count(*) from pg_policy p where p.polrelid = c.oid)
      ) as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ) s
  ),

  -- Every column, with type, nullability and default.
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',    table_name,
      'column',   column_name,
      'type',     data_type,
      'nullable', is_nullable,
      'default',  column_default
    ) order by table_name, ordinal_position), '[]'::jsonb)
    from information_schema.columns
    where table_schema = 'public'
  ),

  -- THE IMPORTANT ONE. Every RLS policy, verbatim.
  -- Look hard at any policy on "profiles" that permits UPDATE.
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',       tablename,
      'policy',      policyname,
      'permissive',  permissive,
      'roles',       roles,
      'command',     cmd,
      'using',       qual,
      'with_check',  with_check
    ) order by tablename, policyname), '[]'::jsonb)
    from pg_policies
    where schemaname = 'public'
  ),

  -- Table-level grants. A grant to "anon" means unauthenticated access.
  'grants', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',     table_name,
      'grantee',   grantee,
      'privilege', privilege_type
    ) order by table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','public')
  ),

  -- Functions, including SECURITY DEFINER ones (these bypass RLS — check them).
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',             p.proname,
      'security_definer', p.prosecdef,
      'args',             pg_get_function_identity_arguments(p.oid),
      'returns',          pg_get_function_result(p.oid),
      'body',             pg_get_functiondef(p.oid)
    ) order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),

  -- View definitions (v_task_stats, v_item_costs, v_turnover, etc.).
  -- Views run as their owner, so a view can leak data past RLS.
  'views', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',       viewname,
      'definition', definition
    ) order by viewname), '[]'::jsonb)
    from pg_views
    where schemaname = 'public'
  ),

  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',      c.relname,
      'trigger',    t.tgname,
      'definition', pg_get_triggerdef(t.oid)
    ) order by c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
  ),

  -- Primary keys, foreign keys, unique and check constraints.
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',      c.relname,
      'constraint', con.conname,
      'type',       con.contype,
      'definition', pg_get_constraintdef(con.oid)
    ) order by c.relname, con.conname), '[]'::jsonb)
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),

  -- Realtime publication membership (which tables broadcast changes).
  'realtime_tables', (
    select coalesce(jsonb_agg(tablename order by tablename), '[]'::jsonb)
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
  )

)) as audit_dump;
