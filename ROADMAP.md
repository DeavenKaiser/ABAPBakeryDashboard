# ABAP Bakery Dashboard — work queue

Two lists. **Fixes** are things that are broken or unsafe today. **Features**
are things to build or finish. Ordered within each list; do fixes P0 first.

Detail on every security item is in `supabase/SECURITY-AUDIT.md`.

---

# List 1 — Fixes

## P0 · Do before anything else

### 1. Apply `supabase/migrations/20260810_001_security_fixes.sql`
One paste into the SQL editor. Closes, in one shot:

- **Any staff account can make itself an admin.** The `profiles` UPDATE policy
  had no `WITH CHECK`, so nothing stopped `update profiles set role='admin'`
  on your own row. Every admin gate in the database opens once that lands.
- **Your costs and pricing are readable with no login.** All 13 views bypass
  RLS and `anon` had SELECT on them. Unit costs, retail and wholesale prices,
  overhead, staff names — all reachable with the key that's published in
  `config.js`.
- `anon` held TRUNCATE on every table.
- `SECURITY DEFINER` functions with a mutable `search_path`.
- Staff could insert events already marked `approved`, skipping review.

Also switches realtime on, which has never worked.

Verified safe against the Edge Function, which uses `service_role`.

### 2. Stored XSS sweep
Add `esc()` / `attr()` to `config.js`, apply at every interpolation site across
all 17 pages. Task text, profile names, item names, and shift notes all reach
`innerHTML` and `onclick` unescaped. This is the remaining route to running
script in an admin's session. Add the CSP tag (P2 #10) at the same time.

### 3. `manage-users` defects
- `set_role` has no self-demotion or last-admin guard. `team.html` shows
  "Make staff" next to your own name. Click it as the only admin and nobody
  can grant admin again — recovery is the SQL editor.
- Four `.update()` calls discard their error and return `ok`. Invalid `role`
  or `job_role` fails the CHECK constraint and reports success.
- `create` never sets `must_change_password`, so a "temporary" password is
  permanent. `set_password` does set it.
- CORS is `*`. Lock it to the site origin.

## P1 · Broken behaviour and data risk

### 4. Removing a staff member fails
Not a design gap — an error. `profiles_id_fkey` cascades from `auth.users` to
`profiles`, but nine columns reference `profiles(id)` with no `ON DELETE`
clause, so deleting anyone who has ever ticked a task or counted inventory
dies on a foreign-key violation. Make `profiles.active` the removal path — the
column exists and nothing reads it — and enforce it at login. Same file as #3.

### 5. Shared-device sessions
Supabase keeps the session and refresh token in `localStorage`. The 30-minute
idle logout only runs while a page is open, so closing the tab leaves a live
session on the shop tablet for the next person. The likeliest real incident
here.

### 6. Auth model decision — **blocks any OAuth work**
`handle_new_user()` creates a `staff` profile for any new auth user, and every
read policy is `auth.role() = 'authenticated'`. Enable Google sign-in today and
any stranger who finds the login page gets read access to your recipes and
costs. Allowlist first, provider second. Social OAuth is free on your plan.

### 7. Password reset
No forgot-password link exists; only an admin can reset. Needs custom SMTP
(free tier, but the built-in sender is rate-limited and not for production).

### 8. Scheduled jobs and silent deletion
`clear_expired_special_tasks()` deletes overdue special tasks whether or not
anyone completed them — archive instead. `prune_note_history()` and
`archive_past_events()` are never called at all, so note history grows forever.

### 9. Backups and platform limits
Free tier has **no automated backups**. Recipes, cost history, and inventory
records are business data with no recovery path today. Either schedule a
`pg_dump` somewhere you control, or budget for Pro.

Other free-tier constraints worth knowing before they surprise you:

- **Projects pause after 7 days of inactivity.** Daily use never trips it, but
  a holiday closure or a slow stretch can — and the app is simply down until
  someone un-pauses it from the dashboard. Worth a calendar reminder if you
  ever close for a week.
- 500 MB database, 5 GB egress, 50,000 monthly active users. You are nowhere
  near any of these; the ceiling is not a concern, the pause is.
- No SSO/SAML (irrelevant here) and no SLA.

Sources: [Supabase pricing](https://uibakery.io/blog/supabase-pricing) ·
[free tier limits](https://aiagencyplus.com/supabase-free-tier-limits/)

## P2 · Hardening and hygiene

### 10. Free settings you should just switch on
Leaked-password protection, MFA on the admin account, and a
`Content-Security-Policy` meta tag on every page.

### 11. Narrow the blanket-authenticated write policies
Any staff member can currently change any inventory item's cost or threshold,
delete anyone's task completions (which feed `v_task_stats`), rewrite an
admin's special task, and mark any order received. Decide per table.

### 12. Admin audit log
Nothing records who changed a role, deleted a task, or edited a cost.
`inventory_history` is the only history that exists — see Features #6.

### 13. Version-control the schema
Run `supabase db pull` for a real migration baseline. Better than me
reconstructing DDL by hand and introducing drift.

### 14. Repo hygiene
Hand-maintained `?v=1785531464` across 17 files. A 37 KB Square catalog CSV
committed at the root. Uncommitted edits to nearly every file — commit those
before more changes land, so diffs stay reviewable.

---

# List 2 — Features

## Tier 1 · What you asked for

### 1. Task enable/disable with an archive view
The `active` column exists and every read filters on it, but the two removal
paths disagree — `mytasks.html` hard-`delete()`s, `team.html` soft-sets
`active:false` — and nothing anywhere lists inactive tasks. Deactivating one
makes it unrecoverable. Needs: one consistent path, an archive view with
restore, and real reordering instead of `sort_order: 999`.

### 1b. Completion requires evidence — **spec written**
See `docs/spec-completion-evidence.md`. A task can require a value (temp,
count, reading) and won't complete while it's empty; out-of-range readings are
either flagged or held open as an exception, configurable per task. Inventory
gets a one-tap "same as last count" that records a real verification without
retyping. Also fixes `isBelow()`, which currently makes never-counted items
invisible to every low-stock warning. Absorbs List 3 #8.

### 1c. Production board — **spec written**
See `docs/spec-work-assignment.md`. A screen **separate from the daily
checklists**, holding the day's exceptions: what needs baking or making to
stock the case, plus one-off jobs that aren't in anyone's routine. Admin
assigns; anyone on shift completes. No role filter — roles are a grouping
heading, so a baker can absorb cleaning when someone's out. Captures actual
quantity at completion, which delivers the production log from List 3 #7.

Mostly connects things that already exist: `plan_entries` is already a bake
assignment, `special_tasks` is already an ad-hoc one, and the role silo was
only ever a UI filter, never a database rule.

Related gap it exposes — **nothing tracks finished goods.** Inventory covers
ingredients; nothing knows how many croissants should be in the case or how
many are. The board is admin-assigned for now, which is how most small
bakeries run. Upgrade path to a self-proposing bake list is in the spec.

### 2. Admin settings page
Doesn't exist. Move the hardcoded config out of `config.js` and into the
database: job roles, per-role due days (`ROLE_DUE_DOW`), the 30-minute idle
timeout, the 2-minute edit-mode timeout.

### 3. User settings page
Also doesn't exist. Own profile, display name, self-service password change,
notification preferences. `user_prefs` exists but only stores dashboard layout.

### 4. Data-driven job roles
Today the three roles are hardcoded in five places, including a fallback in
`config.js` that matches employee names:

```js
if (n.includes("sierra")) return "baker";
if (n.includes("mackenzie") || n.includes("kenzie")) return "barista";
if (n.includes("marilyn")) return "cleaning";
```

Needs a `job_roles` table and replacement of three CHECK constraints
(`profiles_job_role_check`, `tasks_owner_check`,
`inventory_items_owner_check`) with foreign keys.

### 5. Full user management
Invite flow, deactivate (see Fixes #4), self-service profile editing, and an
audit trail of admin actions.

## Tier 2 · Already built, just invisible — cheapest wins here

### 6. Surface `inventory_history`
The `on_inventory_update` trigger has logged every count change since day one:
value, who recorded it, whether it was below threshold. No page reads any of
it. `recorded_by` and `was_below` are written and read by nothing. This is
most of the audit log from Fixes #12, already collected.

### 7. Surface `shift_note_history`
`mytasks.html` appends every handoff note save. Nothing ever reads them back.
Thirty days of shift history nobody can see.

### 8. Put Prep Planner and Units in the navigation
`planner.html` and `units.html` are in no menu. Planner is reachable only from
a button on the events and shopping pages; units only from inventory. The
whole demand-projection chain behind Planner — `v_planned_demand`,
`v_event_demand`, `v_inventory_projection` and its ingredient matching — works
and is effectively hidden.

### 9. Give staff a real dashboard widget catalog
The available widget list for staff is identical to their default list, so
"customize" only reorders and resizes. Nothing to add or remove.

### 10. Delete `shift.html`
Dead redirect stub.

## Tier 3 · Gaps worth considering

### 11. Per-person task assignment
Tasks belong to a job role, never to a person. Two bakers can't split a list.

### 12. `reorder_note` and `min_on_hand`
`reorder_note` is a column with no UI at all. `min_on_hand` is a text column
sitting beside numeric `threshold` and looks vestigial — confirm and drop.

### 13. Replace `alert()` / `confirm()`
Every confirmation is a browser dialog. Rough on a tablet.

### 14. Notifications
Low stock, overdue tasks, pending event approvals. Needs SMTP (Fixes #7).

### 15. Offline support
You ship `manifest.json` and icons, so the app installs to a home screen — but
there's no service worker, so it doesn't work offline. A bakery with patchy
wifi would notice. Realtime landing (Fixes #1) makes this more worthwhile.

---

# List 3 — Not yet explored

Things the app has no concept of. Ordered by value for a working bakery, not
by effort. Nothing here is required; it's the menu.

## A · Close the costing loop

You've built more cost infrastructure than most small bakeries ever have —
`v_item_costs`, `v_item_unit_cost`, `v_recipe_pricing`, `v_monthly_overhead`,
turnover, usage rate. Four missing pieces stop it from being trustworthy.

### 1. Recipe yield — this one is a correctness bug, not a gap
`recipes` has no yield, batch size, or portion count. So `recipeCost()` and
`v_recipe_pricing.ingredient_cost` are **cost per batch**, while
`recipe_options.price` is clearly **price per item**. `suggested_retail` is
`ingredient_cost / retail_food_cost_pct`, which means for a recipe that makes
24 scones, `planner.html` is showing a suggested retail price for all 24 at
once — sitting in a column right next to per-item prices.

As it stands the app cannot compute cost per unit for anything you bake. Add
`yield_qty` and `yield_unit` to `recipes` and the whole pricing chain becomes
real. Cheapest high-impact change on this page.

### 2. Ingredient price history
`inventory_items.unit_cost` is one mutable number. Overwrite it and the old
price is gone. You can't see that flour rose 30% over eight months, can't
date-stamp a costing, and can't explain why margin moved. `order_log` already
records every purchase event — attach the price paid to it and you get history
for free.

### 3. Labor in pricing
`pricing_settings` is food-cost percentage only. That's the standard shortcut,
and it systematically underprices labor-intensive work — a laminated croissant
and a drop cookie can have similar ingredient cost and wildly different labor.
Add minutes-per-batch to recipes plus an hourly rate, and fold in
`v_monthly_overhead`, which currently isn't used by any pricing math at all.

### 4. Waste log
`v_usage_rate` infers consumption from any *decrease* in a count. Spoilage, a
dropped tray, and a sale are indistinguishable. So waste inflates your usage
rate, which inflates `days_to_threshold`, which drives reorder projections.
A waste table with reason codes fixes the projections and tells you what
you're throwing away — usually the fastest margin win in a bakery.

## B · POS integration — **moved**

### 5. POS sales integration → see List 6
Split in two once the rollout plan landed. The **catalog import** is an
onboarding prerequisite and lives in List 5 §3. The **sales API** work is the
last thing built — full detail in List 6 at the end of this document.

<details>
<summary>Original notes, retained</summary>
`MLEWTP3S0E54G_catalog-2026-07-31-1804.csv` is in your repo root — 186 rows of
Item Name, Variation Name, Price, Category, SKU. Your `recipe_options` table
(recipe + option_name + price) is almost exactly Square's Item + Variation +
Price. You are hand-maintaining a second copy of your Square catalog.

Square has an API. Pulling it would mean:

- Stop duplicating the catalog by hand
- **Item-level sales data**, which replaces count-delta guessing with real
  demand — your best forecasting input by a wide margin
- Actual margin per item versus the theoretical price in `v_recipe_pricing`,
  which is the number that tells you what's quietly losing money
- `monthly_sales` stops being one hand-typed figure per month

</details>

## C · Operational gaps

### 6. Vendors and lead times
`order_log` knows an item was ordered and received, but there's no vendor —
no contact, no minimum order, no lead time, no per-vendor pricing. Lead time
is also the missing input for a real reorder point
(`usage_rate × lead_time + safety_stock`); you already have the usage rate.

### 7. Production log
`plan_entries` records what you *intended* to bake. Nothing records what you
actually made, or what a batch actually yielded. Plan vs actual, and yield
variance against #1, are how the costing stops being theoretical.

### 8. Tasks that record a value, not just a checkbox
`task_completions` can only ever say "done." A bakery needs numbers: fridge
and freezer temps, cooling times, sanitizer concentration, batch counts,
waste weights. Adding a `result_type` and `result_value` to tasks turns your
existing task engine into a food-safety log — and those are exactly the
records a health inspector asks for. Your `cleaning` role suggests you already
think this way.

### 9. Who's actually working
Three job roles, shift tasks, opening and closing checklists — but no concept
of a schedule or who is on today. `taskDue()` derives due dates from hardcoded
weekdays because there's nothing better to derive them from. A schedule would
also let the dashboard show the right person's list without an admin switching
roles by hand.

## D · Customer-facing and compliance

### 10. Allergens
Recipes have ingredients but no allergen tagging. Gluten, nuts, dairy, egg,
soy. Public-facing bakery, asked constantly, real liability.

### 11. Special orders
`events` covers events with item demand, but a custom cake order — customer,
pickup date and time, deposit, written details, status — is a different shape
and often a meaningful revenue line. `events` is close enough to extend.

## E · Smaller, still worth listing

### 12. Photos
No images anywhere. Recipe reference shots and "this is what the shelf should
look like" photos are genuinely useful for training. Supabase Storage gives
you 1 GB free.

### 13. Export for your accountant
Reports render to HTML only. No CSV or PDF out. `company_info` says it "prints
on your price sheets," so the intent is already there.

### 14. Recipe scaling at the bench
Scaling exists implicitly in planning (`ri.amount * pe.quantity`) but there's
no "make 1.5×" view for someone standing at the mixer. Depends on #1.

---

# List 4 — Screens and widgets

What a working bakery or coffee shop expects to see that this app has no
surface for. Two structural observations first, because they shape the rest.

**You have an events system with zero dashboard presence.** `events.html`,
`event_items`, and `v_event_demand` all work and feed ingredient projections —
but no dashboard widget shows them, and the staff widget set is
`special_tasks, my_progress, countdown, shift_progress, handoff,
my_inventory`. A baker cannot see that there's a large catering order Saturday
without navigating to Agenda and knowing to look.

**Nothing tracks whether you actually have product to sell.** `inventory_items`
tracks ingredients. `recipes` and `recipe_options` are the sellable things, but
nothing anywhere records whether croissants exist right now. "Low on flour" and
"out of croissants" are different sentences and the app can only say the first.

## Screens

### At the bench

**1. Today / production board.** The single most-used screen in a real bakery,
and it doesn't exist as a first-class thing. `planner.html` is close but it's
hidden from navigation (Fixes #15) and framed around planning *ahead* rather
than executing *today*. Wanted: today's bake list with quantities, pulled from
plan entries plus event demand plus special orders, tickable as produced.
Feeds the production log (List 3 #7).

**2. Bake mode.** `recipes.html` is a management view — dense, money columns,
edit controls. Someone at the mixer with flour on their hands wants big type,
a scaled ingredient list they can tick off, and the directions. Depends on
recipe yield (List 3 #1) for scaling to mean anything.

**3. Tomorrow's prep list.** Distinct from tasks: what to pull, thaw, proof, or
portion tonight. Currently expressible only as a recurring task with no link to
what's actually being baked.

### Front of house

**4. Availability / 86 board.** The gap named above. A shared, one-tap list of
what's sold out or unavailable today, visible to everyone on shift. Every food
service operation runs one, usually on paper. Cheap to build, used constantly.

**5. Pickup board.** Special orders by pickup time (List 3 #11). "What's due
today, and is it made yet."

### Records and compliance

**6. Food safety log.** Unlocked directly by
`docs/spec-completion-evidence.md` — once tasks capture values, you need a view
that answers "show me walk-in temps for March." That's what gets asked for in
an inspection, and it's a screen, not a widget.

**7. Waste log.** Entry and history, paired with List 3 #4.

**8. Shift report.** One end-of-day screen the closer fills out: what got done,
what didn't, waste, notes, anything for tomorrow. Consolidates the handoff note
into something reviewable rather than a single overwritten textarea.

### Business

**9. Wholesale price sheet.** `company.html` already says its fields "print on
your price sheets," so the intent exists with nothing behind it. Generate a
dated sheet from `v_option_pricing` for wholesale accounts.

**10. Training library.** SOPs and how-tos. Your task system nearly does this
already; new hires need the *why* alongside the checklist.

## Widgets

### Required by work already committed

These three come out of `docs/spec-completion-evidence.md` and aren't optional
once that lands:

**11. Open exceptions** — out-of-range readings awaiting resolution.
**12. Never counted** — the `unknown` stock state, currently invisible.
**13. Verification spot-check** — the rubber-stamp prompt.

### Obvious gaps

**14. Upcoming events** — you have the whole system and no widget for it.
**15. Today's bake list** — pairs with screen #1.
**16. 86'd today** — pairs with screen #4.
**17. Today's pickups** — pairs with screen #5.
**18. Waste this week** — needs List 3 #4.
**19. Expiring soon** — needs new data, see below.
**20. Who's on shift** — needs scheduling (List 3 #9).
**21. Sales today** — needs Square, so v2.
**22. Weather.** Sounds like a toy, isn't. A hot afternoon shifts drinks cold,
rain thins the walk-in trade, and both change what you should bake. Free API,
no dependencies.

Building these also fixes Features #9 — staff currently have an "available
widget" list identical to their defaults, so customisation offers them nothing
to add.

## One data gap these surfaced

**No expiry or lot tracking.** `inventory_items` has no expiry date and
`order_log.received_at` is per order, not per lot. For a shop holding dairy,
eggs, and cream, FIFO and use-by dates are routine, and there's currently no
way to ask what's about to turn. Prerequisite for widget #19.

---

# List 5 — Rolling this out to other shops

**Decisions taken:** a separate Supabase project and deployment per shop; 2–5
shops in year one; tasks seeded from ABAP's real list; inventory and recipes
imported from each shop's POS.

Separate projects is the right call at this size. RLS stays exactly as it is,
a policy mistake can never cross shops, and "your recipes and margins are in
your own database" is a straight answer to the first question any owner will
ask. Cost is ~$25/shop/month past the two free projects, which is fine at five
and painful at twenty.

## 1. Stop welding the schema shut

Don't build multi-tenancy — you don't need it at this size. Do stop making it
expensive to add later:

- `company_info` has `CHECK (id = 1)`. `shift_note` has `CHECK (id = 1)`.
  Drop both constraints. They cost nothing to remove now and are a schema
  migration across every customer later.
- `pricing_settings` (PK `category`), `monthly_sales` (PK `month_key`) and
  `units` (PK `code`) are all globally keyed. Leave them, but know they're the
  three that need compound keys if you ever pool.

That's the whole hedge. Everything else stays simple.

## 2. De-hardcode what's welded to this bakery

**Database**
- `tasks_owner_check`, `inventory_items_owner_check`, `profiles_job_role_check`
  hardcode `baker`/`barista`/`cleaning`. **A coffee shop has no baker.** This
  makes Features #4 a prerequisite, not a tidy-up.
- `is_admin_or_baker()` encodes *bakers may edit recipes* — this shop's policy,
  not a universal one. Becomes a per-shop setting.

**Code**
- `config.js` routes staff by matching names — `sierra`, `mackenzie`,
  `marilyn`. Delete outright.
- `ROLE_DUE_DOW` hardcodes this shop's inventory days. Per-shop config.
- Branding in 8 files, `manifest.json`, `CNAME`, and `logo.svg`.
- Theme colours inlined across 17 files *despite `style.css` already defining
  variables for them*. Consolidating makes per-shop theming a five-line change
  instead of a seventeen-file one.

## 3. POS import — and a correction to the v2 plan

I looked properly at your Square export. It carries far more than a menu:

| Square column | Maps to |
|---|---|
| Item Name + Variation Name | `recipes` + `recipe_options` |
| Modifier Sets (Milk Options, Syrups, Drink Size, Icing…) | `recipe_options` |
| Price | `recipe_options.price` |
| Default Unit Cost | `inventory_items.unit_cost` |
| Default Vendor Name / Code | the vendor concept from List 3 #6 |
| Current Quantity | `inventory_items.current_on_hand` |
| Stock Alert Count | `inventory_items.threshold` |
| Categories | `recipes.category` / `inventory_items.category` |

**So Square splits into two jobs, not one.** The catalog import is a *rollout
prerequisite* — it's how a new shop gets usable data on day one, and it's plain
CSV parsing with no API, no OAuth, no vendor integration. Only the **sales API**
work belongs in v2. My earlier framing lumped these together; that was wrong.

**Build a column-mapping importer, not a Square integration.** Upload a CSV,
map columns to fields, preview, import. Square, Toast, Clover, and Lightspeed
all export CSV, and your next four shops will not all be on Square. Same effort,
four times the coverage, nothing to maintain when a vendor changes their API.

**The one thing no POS can give you: `recipe_ingredients`.** Square knows a
ciabatta costs $6.00; nothing in it knows the ciabatta contains flour, water,
salt and yeast. Recipe ingredient lists are hand-entered at every shop, always.
Worth saying plainly up front — it's the real onboarding cost and it's the
thing that makes every costing feature work.

Aside: your own export is a bakery *and* coffee shop already — Cold Brews,
Milk Options, Extra Shots, Drink Size alongside Sourdough Artisan Loaf and
Icing Options. That's good validation that one app serves both.

## 4. Seed data

The starter pack is ABAP's real task list — tasks beaten into shape over months
beat anything invented for a demo. Export the current `tasks` rows as a seed
file, stripped of shop-specific wording, plus the `units` table and default
`pricing_settings`.

New shop onboarding becomes: create project → run migrations → load seed →
import POS catalog → enter recipe ingredients → add staff.

## 5. Deployment — subdomain routing, two environments

**Decisions taken:** hostname determines the shop (the Canvas model), and ABAP
gets changes before customers do.

Those two pull against each other. One shared deploy means everyone gets code
the moment you push. The fix is **two deployments, not N** — which holds at
five shops and at fifty.

### The shape

```
abap.yourapp.com        →  BETA channel    (your test kitchen)
millers.yourapp.com     →  STABLE channel
riverside.yourapp.com   →  STABLE channel
```

One repo, two long-lived branches — `beta` and `stable`. Push to beta, run ABAP
on it for a week, then merge beta → stable and every customer moves together.
Two things to deploy no matter how many shops you take on, and a bad push costs
you your own bakery rather than a customer's Saturday.

Same shape Instructure uses: institutions sit on stable and get beta ahead of
the production release.

**You don't need a third channel for risky work.** Netlify and Cloudflare Pages
both generate a throwaway URL per branch or pull request automatically. Test
anything genuinely unproven on one of those, and keep beta as something ABAP can
actually run a shift on — otherwise your own shop becomes the crash-test dummy
and you'll stop wanting to deploy.

**Promote on a schedule, not on a feeling.** Pick a day — Tuesday, say — so
nothing lands on a shop mid-Saturday, and so "how long has this been on beta"
has an answer. A week on beta is enough to catch anything a real shift exposes.

### Don't ship a tenant map

The obvious implementation puts every shop's Supabase URL and key in a
`tenants.js` in the bundle. That publishes your customer list to anyone who
views source — the exact thing subdomains were meant to avoid.

Instead, generate one config file per shop at build time and fetch only your
own:

```js
const cfg = await fetch(`/config/${location.hostname}.json`).then(r => r.json());
const sb = supabase.createClient(cfg.url, cfg.key);
```

The files exist but aren't enumerable. Same discretion as a private link, no
list to scrape.

### A free win from subdomains

`abap.yourapp.com` and `millers.yourapp.com` are separate origins, so
`localStorage` is isolated by the browser. A stale session from one shop can't
collide with a login at another on a shared device. The query-parameter
approach would have needed keyed storage to avoid exactly that; this gets it
for nothing.

### Migrations must be backward-compatible

This is the sharp edge of shared frontend + per-shop databases. Shops will sit
on different schema versions between promotions, so **a frontend that requires
a column some shop hasn't got will break that shop.**

Use expand/contract: add columns and views in one release, switch the frontend
in the next, drop the old shape in a third. Never rename or drop in the same
release that starts using the new thing.

Promotion runbook: migrate every stable shop's database → verify → promote the
frontend branch.

### Consequences for items already on this list

- **Off GitHub Pages → Cloudflare Pages.** One CNAME per repo won't serve many
  subdomains. Cloudflare Pages is the pick: `_headers` is its native format (see
  `docs/spec-csp-hardening.md`), branch deploys map directly onto the beta/stable
  channels, multiple custom domains per project covers per-shop subdomains, and
  there is no bandwidth limit at any tier. Free tier is 500 builds/month and
  20,000 files — both far beyond this workload.

  *Verify the custom-domains-per-project limit before planning around it.*
  Cloudflare's docs say 100; some third-party summaries say 5. That number is
  what your shop count runs against on the stable project.

  **AWS (S3 + CloudFront) is not recommended for this.** Same product, more
  work: headers become a CloudFront response headers policy instead of a file,
  deploys need CI you write, and you pay per request and per GB instead of
  nothing. Revisit only if a customer brings a compliance or data-residency
  requirement, or if the stack outgrows static hosting.

- **Hosting is the least locked-in decision here — Supabase is the real one.**
  Fifteen static files can move hosts in an afternoon. But every page calls
  `sb.from(...)` directly, so data access and business logic are welded together
  across 14 files; leaving Supabase would mean touching all of them. Not worth
  abstracting today — for 2–5 shops it would be speculative work — but that is
  where the switching cost actually sits. Cheap hedge: put *new* data access
  behind small functions in `config.js` rather than inline `sb.from()` calls, so
  the coupling shrinks as a side effect of work you're doing anyway.
- **Fixes #13 moves up.** Numbered migrations aren't hygiene any more; they're
  how five databases stay in step.
- **Fixes #14 moves up.** The hand-maintained `?v=1785531464` across 17 files
  becomes a build step that stamps it.
- **Fixes #9 gets worse.** Five projects, five things that pause after 7 idle
  days. A shop closing for a week comes back to a dead app — needs a monitor.

## 6. Before anyone else's data is in it

- **The security work becomes non-negotiable.** A self-escalation bug in your
  own shop is embarrassing. In someone else's it's a breach of a customer.
- Employee names and emails from other businesses are personal data you now
  process on their behalf. Worth a basic privacy policy and terms.
- Every shop must be able to export their data and leave.
- Decide what support looks like before you have customers, not after.

---

# List 6 — API integrations (v2, last)

Everything here comes after the rollout in List 5. These are the only items
that depend on someone else's API staying put, which is exactly why they go
last: they carry maintenance cost forever and they aren't needed for a single
shop to run its day.

## 1. POS sales data

The catalog import (List 5 §3) is plain CSV and ships with the rollout. This is
the other half — a live feed of what actually sold.

- Replaces count-delta guessing with real demand, by far your best forecasting
  input
- Actual margin per item against the theoretical price in `v_recipe_pricing` —
  the number that shows what's quietly losing money
- Feeds the finished-goods par proposal in `docs/spec-work-assignment.md`, so
  the production board starts proposing the day's bake list
- `monthly_sales` stops being one hand-typed figure per month

Build one vendor first — Square, since ABAP is on it — behind an interface
thin enough that Toast or Clover slot in later. Do not build an abstraction
for four POS systems before you have customers on two of them.

## 2. Accounting export

Push expenses and sales to whatever the shop's bookkeeper uses. Lower value
than it sounds until several shops ask for the same one — wait for the second
request before building.

## 3. Notifications delivery

Email or SMS for low stock, overdue tasks, open exceptions (Features #14 needs
a transport). Custom SMTP is free on your plan; SMS means Twilio and a real
per-shop cost.

## 4. Supplier ordering

Sending a purchase order straight to a vendor. Deep water — every distributor
does it differently, most have no API at all, and several will want a phone
call regardless. Listed for completeness, not recommended.

---

## Suggested order

Numbering is per list — "Features #8" and "Fixes #8" are different items.

**Stage 1 — security, this week.** Fixes 1 → 2 → 3 → 4. The whole critical
block plus the broken delete; 3 and 4 are the same file. Fix 1 is a single
paste and closes the only actively exploitable hole, so it goes first
regardless of everything else.

**Stage 2 — visible wins, cheap.** Features 6, 7, 8, 10 and Fixes 12. Surfacing
`inventory_history` and `shift_note_history`, putting Planner and Units in the
navigation, deleting the dead stub. Almost no new logic — this is data and
pages you already have that nobody can reach. Features 8 also unblocks the
production board.

**Stage 3 — foundations.** Features 4 (data-driven job roles) then 2 and 3
(admin and user settings). Job roles first: `suggested_role` in the production
board and the result config in the evidence spec both want a real `job_roles`
table rather than a fourth hardcoded list.

**Stage 4 — the two specs.** `docs/spec-completion-evidence.md` then
`docs/spec-work-assignment.md`. Evidence first — it fixes the invisible-stockout
hole in `isBelow()`, and the board's completion flow reuses its value-capture
pattern. Features 1 (task enable/disable) lands alongside these; it touches the
same UI.

**Stage 5 — costing.** List 3 items 1–4: recipe yield, price history, labor,
waste. Yield first and on its own — it's a live correctness bug, and every
other number depends on it being right.

**Stage 6 — screens and widgets.** List 4, prioritising the three widgets the
evidence spec requires (11–13) and the two structural gaps: an events widget
and the availability/86 board.

**Stage 7 — rollout prep.** List 5. Note that shipping to another shop pulls
several items forward out of their stages above, because they stop being
optional the moment someone else's data is involved:

- Features #4 (data-driven job roles) — a coffee shop has no baker
- Fixes #13 (migrations) and #14 (build step) — five projects, five schemas
- Fixes #2, #3, #10 and the whole security block — a bug in your own shop is
  embarrassing; in a customer's it's a breach
- POS **catalog** import — this is onboarding, not a nicety

**Stage 8 — API integrations, last.** List 6. Only things that depend on
someone else's API. They carry maintenance cost forever and no shop needs them
to run its day.

**Ongoing, fold in as you touch each surface:** Fixes 5–11.
