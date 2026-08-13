# Security audit — ABAP Bakery Dashboard

Audited 10 Aug 2026, against a live dump of the Supabase schema, RLS policies,
grants, functions, and triggers (`supabase/audit/dump-schema.sql`).

Fixes for everything marked **Critical** are in
`supabase/migrations/20260810_001_security_fixes.sql`.

---

## Critical

### 1. Any staff account could make itself an admin

```
profiles UPDATE policy "profiles update self"
  USING:      ((id = auth.uid()) OR is_admin())
  WITH CHECK: null
```

An UPDATE policy with no `WITH CHECK` reuses its `USING` expression. The only
condition was that the row still belonged to the caller — nothing restricted
which *columns* changed, and `profiles_role_check` permits `'admin'`.

```js
// from the browser console, as any signed-in staff member
await sb.from('profiles')
        .update({ role: 'admin' })
        .eq('id', (await sb.auth.getUser()).data.user.id)
```

`is_admin()` is `SECURITY DEFINER` and reads that same column, so a single
successful write opens every admin-gated policy in the database: `tasks`
insert/update/delete, `expenses`, `company_info`, `pricing_settings`, `units`,
`plan_entries`, `special_tasks`, `recipe_options`, and `profiles` deletion.

Every `IS_ADMIN` check in the frontend is a UI hint. This was the only thing
actually enforcing the boundary, and it wasn't.

**Fixed** by revoking blanket UPDATE from `authenticated` and re-granting it on
`full_name` and `must_change_password` only, plus rewriting the policy with a
real `WITH CHECK`. Admin user management is unaffected — `team.html` routes
role and job changes through the `manage-users` Edge Function, which uses the
service_role key.

### 2. Views leaked business data to unauthenticated callers

All 13 views are owned by `postgres` and none set `security_invoker`. A view
without it runs with its owner's privileges, so RLS on the underlying tables is
bypassed completely. `anon` held SELECT on all of them, and the publishable key
is in `config.js` on a public GitHub Pages site.

Reachable with no account:

| View | Exposed |
|---|---|
| `v_item_costs` | unit costs, on-hand quantities, stock value |
| `v_recipe_pricing` | ingredient cost and suggested pricing per recipe |
| `v_option_pricing` | every retail and wholesale price |
| `v_monthly_overhead` | total monthly overhead |
| `v_item_unit_cost` | cost per base unit across the catalog |
| `v_inventory_meta` | inventory joined to staff names |
| `v_task_stats` | all task text and completion rates |
| `v_turnover`, `v_usage_rate` | purchasing cadence and consumption |

RLS on the tables was correct. The views went around it.

**Fixed** by setting `security_invoker = on` on all 13 views and revoking all
`anon` privileges. Signed-in users see exactly what they saw before.

### 3. `anon` held every privilege on every table

Including `TRUNCATE`, which is **not** subject to RLS — the grant is the only
control. Not reachable through PostgREST today (it never emits `TRUNCATE`), but
it would become reachable the moment anyone adds an RPC that touches those
tables, and there is no reason for the grant to exist. Login uses the Auth API,
not PostgREST, so `anon` needs no table access at all.

**Fixed** by revoking all privileges from `anon` on tables, sequences, and
functions, and setting default privileges so new objects stay locked.

---

## Should fix

### 4. `SECURITY DEFINER` functions with a mutable `search_path`

`is_admin()` and `handle_new_user()` both run as their definer without a pinned
`search_path`, the standard setup for search-path injection. `rls_auto_enable()`
already pins it correctly.

**Fixed** in migration 001. `is_admin_or_baker()` was also promoted to
`SECURITY DEFINER` for consistency — it previously depended on the caller being
able to read `profiles` through RLS.

### 5. Staff could self-approve events

`events.status` defaults to `'pending'` but the CHECK permits `'approved'`, and
the INSERT policy had no column condition. A staff account could insert an
already-approved event and skip review. Approved events feed `v_event_demand`
and your ingredient projections.

**Fixed** in migration 001.

### 6. Blanket-authenticated write policies

Not exploitable for privilege escalation, but wider than the data model implies.
Decide per table whether this is intended:

- `inventory_items` UPDATE — any staff member can change any item's cost,
  threshold, or name, regardless of the `owner` column.
- `task_completions` DELETE — any staff member can delete anyone's completion
  record, including historical ones that feed `v_task_stats`.
- `special_tasks` UPDATE — staff can rewrite the text of an admin's task, not
  just tick it done.
- `order_log` UPDATE — any staff member can mark any order received.
- `shift_note` UPDATE — shared by design, no change needed.

### 7. Edit mode is not a security control

`editMode()` reads `sessionStorage`, so anyone can enable it from the console:

```js
sessionStorage.setItem("editMode", "on")
```

After migration 001 this only reveals UI — the writes behind it are blocked by
RLS for non-admins — so it is not a vulnerability. Recording it so nobody
later mistakes it for a permission boundary. The 2-minute auto-revert is a
convenience for an admin who walks away, not a defence.

### 8. No audit trail

Nothing records who changed a role, deleted a task, or edited a cost.
`inventory_history` is the only table with any history at all.

---

## Not security, found during the audit

### 8. Realtime has never worked

The `supabase_realtime` publication is empty. `subscribeToChanges()` in
`config.js` subscribes to `tasks`, `task_completions`, `special_tasks`,
`shift_note`, `inventory_items`, and `order_log`, and the failure is swallowed
by a `try/catch`. Every cross-device live update in the app has been silently
inert. **Fixed** in migration 001 by adding those six tables to the publication.

### 9. Maintenance functions are never called

`archive_past_events()`, `prune_note_history()`, and (for staff)
`clear_expired_special_tasks()` exist but nothing invokes them on a schedule.
`shift_note_history` grows forever despite the 30-day intent, and past events
never archive. `clear_expired_special_tasks()` is called from `dashboard.html`
via `sb.rpc()`, but it isn't `SECURITY DEFINER` and `special_tasks` DELETE
requires `is_admin()`, so it silently does nothing for staff. It also deletes
overdue tasks whether or not they were completed. Needs `pg_cron`, or a
rethink.

### 10. Hardcoded role vocabulary in the database

`profiles_job_role_check`, `tasks_owner_check`, and
`inventory_items_owner_check` all hardcode `baker`/`barista`/`cleaning`.
Making job roles data-driven means dropping these CHECKs in favour of foreign
keys to a `job_roles` table.

### 11. `profiles.active` is modelled but unused

The column exists and defaults to `true`. No page reads it, no policy enforces
it, and `requireLogin()` ignores it — a deactivated user could still sign in and
use the app. Half the deactivate-vs-delete work is already done in the schema.

### 12. `_deleted_recipes_backup`

RLS enabled with zero policies, so it is inaccessible to everyone (safe, but
dead). Drop it or document why it's kept.

---

## Frontend — stored XSS

Database values are interpolated into `innerHTML` and into `onclick`
attributes unescaped. The tables that matter are the ones **any signed-in
staff member can write**: `inventory_items` (blanket authenticated UPDATE),
`special_tasks`, `shift_note`, `events`, and their own `profiles` row. Write a
payload into an item name, an admin opens the page, script runs in the admin's
session. That is the escalation path.

### Helpers — in `config.js`

| Helper | Use for |
|---|---|
| `esc(v)` | text, and values inside a quoted attribute |
| `attr(v)` | alias of `esc`, clearer intent inside `value="…"` |
| `jsArg(v)` | a value crossing into an inline `onclick`/`onchange` |
| ``h`…` `` | tagged template escaping every `${}` automatically |

`jsArg()` exists because HTML-escaping alone is wrong in a handler attribute:
the browser HTML-decodes the attribute and *then* parses it as JS, so a quote
in the data breaks out. It JSON-encodes first, then HTML-escapes.

New code should use ``h`…` ``. It is safe by default — you cannot forget to
call something you aren't calling. Existing pages get surgical `esc()`/`attr()`
fixes instead of a rewrite, because converting working code wholesale without
tests is its own risk.

### Conversion status

| File | Status |
|---|---|
| `config.js` | ✅ helpers added |
| `nav.js` | ✅ `renderTopbar` converted — `profiles.full_name` renders on **every** page, so this was the widest single surface |
| `inventory.html` | ✅ swept — name, category, unit, pack_unit, base_unit, min_on_hand, `updated_by_name`, and the weak `.replace(/'/g,"\\'")` in the category filter |
| `dashboard.html` | ✅ swept — `v_order_projection.name` in the predict widget was **live and exploitable**; also shift note, `special_tasks.text`, and the widget-key guard |
| `shopping.html` | ✅ swept — item names, role headings |
| `events.html` | ✅ swept — title, time, location, description, `event_items.item_name`/`unit`, load error |
| `team.html` | ✅ swept — **exploitable**: `.replace(/'/g,"")` in three handler args stripped single quotes but not double. Names removed from attributes entirely |
| `recipes.html` | ✅ swept — **same exploitable pattern** in `planRecipe`/`deleteRecipe`; plus recipe/ingredient/option names, directions, editor form |
| `admin.html` | ✅ option name attribute |
| `company.html` | ✅ all company fields and the notes textarea |
| `mytasks.html` | ✅ task text, area, role labels, handler args |
| `planner.html` | ✅ categories, recipe names, ingredients, plan entries |
| `reports.html` | ✅ item names and owners across all three tables |
| `expenses.html` | ✅ expense names, periods, month keys |
| `units.html` | ✅ item names, unit codes and labels, the mixed-HTML `summary` |

**Sweep complete — all 14 files.** No ad-hoc `.replace()` sanitisers remain
anywhere in the repo, and every inline script parses cleanly (`node --check`).

### Verification method

A grep for escaped-vs-unescaped interpolation was run across the whole repo
after each file, not just the file being edited. That mattered twice:

1. After fixing the handler-argument bug in `team.html`, the repo-wide grep
   found the identical bug in `recipes.html` — which was *not* on the priority
   list, because that list was built by reasoning about which tables staff can
   write, and `is_admin_or_baker()` makes `recipes` staff-writable in a way the
   reasoning missed. Grepping for the bug shape beat reasoning about the model.
2. A final pass found nine unescaped sites still in `admin.html` and five in
   `recipes.html` after both files had been marked done. Recipe and option
   names render in many more places than the first read suggested.

Known false positives the grep still reports, all confirmed safe: a code
comment in `config.js`; `it.unit_cost` in `inventory.html` (numeric, matched on
the `.unit` prefix); a `confirm()` string with no HTML parsing; `t.ico`/`t.label`
in `nav.js` (hardcoded constants); and `prof.full_name` in `nav.js`, which sits
inside an ``h`…` `` template and is escaped automatically.

Numeric and boolean columns (`id`, `threshold`, `current_on_hand`,
`unit_cost`, the various flags) are left alone deliberately — they cannot
carry a payload, and escaping them adds noise without adding safety. Where a
numeric value sits next to escaped text it is wrapped in `Number()` so the
intent is explicit rather than assumed.

### Two findings from the sweep worth recording

**`.replace(/</g,"&lt;")` was used in four places** as a partial escape
(`dashboard.html` shift note and special tasks, `events.html` description and
load error). In a plain text position that does block tag injection, so none
of the four were exploitable — but it leaves `&` unescaped, so any `&` in the
data renders wrong, and the pattern breaks the moment someone moves the value
into an attribute. All four replaced with `esc()`.

**`.replace(/'/g,"")` in handler arguments was exploitable, in two files.**
`team.html` (`pwPrompt`, `delUser`) and `recipes.html` (`planRecipe`,
`deleteRecipe`) built onclick handlers like:

```js
onclick="pwPrompt('${u.id}','${(u.full_name||"").replace(/'/g,"")}')"
```

Stripping single quotes does nothing about double quotes, and the surrounding
attribute is double-quoted. A name of `x" onmouseover="…` closes the attribute
and adds a new handler. `full_name` is self-writable by every staff member and
`team.html` is an admin-only page — a direct staff→admin escalation.

Fixed by **removing the name from the DOM entirely**: handlers now take only
the id and resolve the record in JS via `userById()` / a `RECIPES.find()`.
Escaping the value would also have worked, but not putting user-controlled text
in an attribute removes the whole class of bug rather than this instance of it.

**The dashboard widget-key guard was `if(!WIDGETS[w]) return;`.** The layout
comes from `user_prefs.layout`, a user-writable jsonb column, so `w` is
untrusted. A truthiness check on a plain object passes for inherited keys —
`WIDGETS["constructor"]` is truthy. Not an XSS route (prototype keys are
alphanumeric, and the guard does reject anything containing a quote), but it
is the wrong check. Now `Object.prototype.hasOwnProperty.call(WIDGETS, w)`.

### Still to pair with this

A `Content-Security-Policy` meta tag (Roadmap Fixes #10). Escaping is the fix;
CSP is the seatbelt for whatever gets missed.
