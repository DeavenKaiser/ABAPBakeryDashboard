# Spec — the production board

A **separate list from the daily checklists.** Its job is the day's exceptions:
what needs baking or making to stock the case, and one-off work that isn't part
of anyone's routine. Admin assigns it; anyone on shift can complete it.

Decisions taken: no claiming (just mark done), role-default checklists with a
one-tap coverage switch, and actual quantity captured at completion.

---

## What this list is, and what it isn't

| | Daily checklists (`mytasks.html`) | Production board (new) |
|---|---|---|
| Contains | Standing routine — opening, closing, weekly cleans | Today's exceptions — what to bake, one-off jobs |
| Comes from | `tasks`, recurring by frequency | `plan_entries` + `special_tasks`, assigned per day |
| Scoped to | Your role, with a coverage switch | Nobody. Everyone sees all of it |
| Changes | Rarely — it's the standard | Every day |
| Answers | "What do I always do?" | "What's different today?" |

**These do not merge.** Production items never appear in `mytasks.html` and
recurring tasks never appear on the board. Two screens, two nav entries. The
value of the routine list is that it's identical every shift; the value of the
board is that everything on it is there for a reason today.

The role-coverage switch in Part 3 applies **only** to the daily checklists.
The board has no role filter at all — roles are a grouping heading on it,
nothing more.

---

## What already exists

**`plan_entries` is already a bake assignment.** `plan_date`, `recipe_id`,
`quantity`, `note`, `created_by`. It feeds `v_planned_demand` and your
ingredient projections. It lives in `planner.html`, which is absent from
navigation (Features #8). What it lacks is any execution record — no done flag,
no who, no actual yield.

**`special_tasks` is already an ad-hoc assignment.** `text`, `due_date`,
`created_by`, `done`, `done_by`, `done_at`, admin-only insert. That's the
cleaning-job mechanism; it just has no role hint.

**The role silo was never enforced by the database.** `mytasks.html` filters
`.eq("owner", VIEW_ROLE)`, but the `task_completions` INSERT policy is blanket
`authenticated`. Any signed-in user has always been able to complete any task.
Coverage is a UI change, not a permissions change.

So this is mostly connecting things you have, not building new machinery.

---

## Part 1 — Schema

Additive. Nothing existing changes shape.

```sql
-- Bake assignments gain an execution record
alter table plan_entries
  add column suggested_role   text,          -- hint only, never a filter
  add column status           text not null default 'planned',
                                             -- 'planned' | 'done' | 'skipped'
  add column done_by          uuid references profiles(id),
  add column done_at          timestamptz,
  add column actual_quantity  numeric,       -- what actually came out
  add column actual_note      text,          -- "short 4, oven ran hot"
  add column source           text not null default 'manual';
                              -- 'stock' | 'event' | 'order' | 'manual'

-- Ad-hoc jobs gain a role hint and an optional link to a standing task
alter table special_tasks
  add column suggested_role   text,
  add column task_id          bigint references tasks(id) on delete set null;
```

`suggested_role` deliberately has no CHECK constraint — it becomes a foreign
key to the `job_roles` table from Features #4. Don't hardcode the three roles
again.

`source` records **why** something is on the board, which is the difference
between a flat to-do list and one that explains itself. Baking 3 dozen
croissants to fill the case is a different decision from baking them for
Saturday's catering order, and when the board gets long that's the first thing
anyone needs to know. It also lets the board group as *"For the case"* /
*"For Saturday's event"* / *"One-offs"*, and it's the hook for automation
later — see below.

`special_tasks.task_id` lets an admin assign extra instances of a standing task
("deep clean the walk-in this week") without duplicating its text.

---

## Part 2 — Two policy changes

### Staff cannot currently complete a bake assignment

`plan_entries` UPDATE is `is_admin()`. If staff are to mark bakes done, they
need write access to the completion columns only — same technique as the
`profiles` fix in migration 001:

```sql
grant update (status, done_by, done_at, actual_quantity, actual_note)
  on public.plan_entries to authenticated;

create policy "plan_entries: staff complete"
  on public.plan_entries for update
  to authenticated
  using (true) with check (true);
```

Column grants stop this becoming a way to rewrite quantities or dates —
Postgres refuses the write at the privilege layer before RLS is consulted.

### `v_planned_demand` must exclude completed bakes

Today it projects ingredient demand for every future `plan_entry`. Once
entries can be marked done, a completed bake would keep claiming its
ingredients and **double-count your needs**:

```sql
where pe.plan_date >= current_date
  and pe.status <> 'done'          -- add this
  and ri.amount is not null
```

Easy to miss, and it quietly inflates the shopping list.

---

## Part 3 — Behaviour

### Assigned work board

One screen, no role filter, everyone sees everything. Built on a view that
unions the two sources rather than merging the tables — much lower risk, and
each source keeps its own downstream consumers:

```sql
create view v_work_queue as
  -- plan_entries  → kind 'bake',  title = recipe name, detail = quantity
  -- special_tasks → kind 'job',   title = text,        detail = area/notes
  -- common shape: kind, ref_id, title, detail, suggested_role,
  --               due_date, done, done_by, done_at
```

Group by `suggested_role` as a visual heading, not a gate. Anyone taps
anything. With realtime now live (migration 001), a completion appears on
other devices immediately, which is most of what claiming would have bought.

### Completing a bake

Prompt for actual quantity, defaulted to the assigned number so the common
case is one tap. Assigned 3, made 3, accept. Made 2, change it and add a note.

This is the production log from List 3 #7. Combined with recipe yield
(List 3 #1), assigned-vs-actual is what turns your cost-per-unit numbers from
theoretical into measured.

### Recurring checklists — coverage

`mytasks.html` keeps opening on your own role, so a normal shift is unchanged.
Add a **Cover another role** control that includes another role's tasks in the
list, grouped under its own heading.

Implementation: drop `.eq("owner", VIEW_ROLE)` from the query, fetch all active
tasks, filter client-side against a selected-roles set. Task counts are small;
one fetch is cheaper than the current per-role round trips.

### Coverage is visible for free

`task_completions.completed_by` already exists. When the completer's
`job_role` differs from `tasks.owner`, render it as coverage — *"Marilyn's
closing clean — done by Sierra."* No schema needed, and it gives you a real
picture of who is absorbing whose work over time. That's a useful management
signal you currently have no way to see.

---

## Part 4 — Admin assignment UI

Lives in `planner.html`, which needs adding to navigation first (Features #8):

- **Assign a bake** — recipe, quantity, date, optional suggested role
- **Assign a job** — free text or an existing task, due date, optional role
- Both default `suggested_role` from the recipe's or task's usual owner

---

---

## The gap this exposes: nothing knows what should be in the case

"Things that need baking for inventory" implies the app knows two numbers:
how much finished product you want on hand, and how much you have. **It knows
neither.**

`inventory_items` tracks *ingredients* — flour, butter, oat milk. `recipes` and
`recipe_options` are the things you sell. There is no finished-goods concept
anywhere: no par level for croissants, no count of how many are in the case,
no link between "we sold out of scones by 9am" and "bake more scones."

So for now the board is **admin-assigned**: you decide each day what needs
making and put it on the list. That's honest and it works — most small
bakeries run exactly this way, off a clipboard.

The upgrade path, when you want it:

1. **Finished-goods par levels** — a target quantity per sellable item.
   Smallest version is one number on `recipe_options`.
2. **A morning case count** — what's actually there, same one-tap pattern as
   `docs/spec-completion-evidence.md`.
3. **`source = 'stock'` entries generated automatically** from par minus
   on-hand, so the board proposes the day's bake list and you adjust it rather
   than typing it.
4. With Square (List 6 #1, v2), actual sales replace the manual count entirely
   and the proposal becomes genuinely predictive.

Each step is independently useful and none of them block the board. Worth
knowing the shape now so the schema doesn't have to be unpicked later — which
is the whole reason `source` exists in step 1 above rather than being added
in a year.

---

## Known trade-off

No claiming means two people can start the same job simultaneously. On a
three-person team that's rare, and realtime completions make it self-correcting
in most cases. If it turns out to bite on busy Saturdays, an optional "I've got
this" flag is a small additive change later — `claimed_by` / `claimed_at` on
the same rows.

---

## Build order

1. Schema migration (additive)
2. `v_planned_demand` fix — do this in the same migration, it's a live
   double-count risk the moment status exists
3. `plan_entries` column grants and policy
4. Coverage toggle in `mytasks.html` — smallest piece, immediate value
5. `v_work_queue` and the assigned work board
6. Actual-quantity capture at completion
7. Coverage attribution display

Depends on: Features #8 (planner in nav), Features #4 (job_roles table) for
`suggested_role` to be a proper key. Pairs naturally with
`docs/spec-completion-evidence.md` — both change how completion works, and
they touch the same UI.
