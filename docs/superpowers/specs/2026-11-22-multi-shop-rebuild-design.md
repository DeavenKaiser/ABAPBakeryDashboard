# Design: multi-shop rebuild

**Date:** 22 Nov 2026
**Status:** approved by the owner, 22 Nov 2026 ("move forward with all of these design choices"). The rollout in §5 and §8 was then rewritten to make ABAP the test site, as the owner asked.
**Mockups:** [`2026-11-22-mockups/`](2026-11-22-mockups/). Open the HTML files in a browser. They are design references, not product code.

The terms used here:

- **The owner** is the person who sells and runs this product. They set up every shop personally.
- **A shop** is a customer business.
- **ABAP** is the owner's own bakery, the first shop, which is live on today's app. ABAP is also the test site. Its staff help develop the app and accept bugs.

## 1. Intent

The app started as ABAP's in-house dashboard and was built quickly. The owner now wants to offer it to other bakeries and coffee shops. That needs four things:

1. **A structural rebuild,** so the code can be maintained and is safe to run with other people's data. The 18 Nov reviews ([frontend](../../review/2026-11-18-frontend-review.md), [backend](../../review/2026-11-18-backend-review.md)) found stored XSS, UI-only security and silent data-loss bugs. Most come from how the pages are built: HTML glued together from strings, no shared layout, and Supabase calls inlined everywhere.
2. **A modern look built for phones and tablets.** Staff use both: a shared shop tablet, and their own phones.
3. **Many shops from one codebase.** Each shop gets its own subdomain (the Canvas model: every school gets its own login address) and its own database. Every shop's data is fully separate.
4. **Room for pricing tiers.** Each shop gets per-shop feature switches now, even though everything is "all or nothing" at launch.

The owner wants to be able to understand the code. The working rule for this project is that Claude writes the code and explains it, so readability is a requirement, not a nicety.

## 2. Goals, non-goals, anti-goals

### Goals

- One codebase serves every shop. Each shop is reached at its own subdomain, and each has its own Supabase project (database).
- The look in the mockups:
  - warm dark mode and E-paper light mode;
  - 14 shop colors;
  - phone and tablet layouts.
- Two ways to sign in:
  - a PIN on a shared shop tablet;
  - email and password on personal phones.
- Some staff are tablet-only, with no email.
- Cost, price and sales figures are admin-only, and the database enforces it.
- Per-shop feature switches that only the owner can change, enforced by the database. All switches are on at launch.
- A seeded ingredient catalog. A shop enters only its own details (cost, quantity, par); measuring data comes pre-filled.
- Feature parity with today's app, with the review findings fixed in each screen as it's rebuilt.
- **The new app goes live on ABAP's address early** and replaces today's screens one at a time. Until a screen's new version lands, its old page stays reachable, so ABAP never loses a screen it uses.

### Non-goals (for this rebuild)

- **A shared multi-tenant database** (one database with a shop ID column). We chose separate projects; see §4.
- **Self-serve sign-up, in-app billing or plan management.** The owner signs shops up and bills them outside the app.
- **Field-level encryption.** Supabase's at-rest and in-transit encryption, plus separate databases, is the separation. Encrypting numeric columns would break sums, filters and the pricing views (backend review, "Encryption").
- **Native app-store apps.** The app is installable to the home screen as a web app (PWA).
- **Offline mode, POS sales sync, notifications delivery, accounting export.** These stay on the ROADMAP (List 2 #15, List 6).
- **New features beyond parity and the items decided here.** Everything else on `ROADMAP.md` waits and is built later on the new code. That includes the two written specs, `docs/spec-completion-evidence.md` and `docs/spec-work-assignment.md`.
- **Shops outside the US.** Every shop is in the US, and near the owner, for a long while. So:
  - money is in dollars;
  - US cups and pounds are the measuring units;
  - the allergen fields follow the FDA's 9 major allergens;
  - the tax ID is an EIN.
  
  There is no per-shop currency, unit system or allergen list.

### Anti-goals: failures even if everything "works"

- **The customer list leaks.** No file in the public bundle may list shops, their subdomains or their Supabase projects (ROADMAP List 5 §5, "Don't ship a tenant map").
- **A frontend release breaks a shop** whose database is one migration behind.
- **ABAP loses data, or nobody can sign in.** Bugs on ABAP are expected and fine. Lost counts, wiped recipes, or a sign-in nobody can get past are not.
- **Secret data is protected only by hiding it in the UI.** Anything staff must not see is refused by the database.
- **AI inside the product, or AI-written customer-facing text.** Customer-facing wording is the owner's (see §9).
- **Claude handles a shop's real business data.** Development and tests use seed and fake data only.

## 3. Constraints

- **Scale:** 2–5 shops in year one (ROADMAP List 5), all in the US and near the owner.
- **Cost:**
  - Supabase Pro is about $25/month for the organization, plus about $10/month compute for each additional project. Pro also prevents idle-pausing and adds daily backups.
  - The owner's Supabase organization ("Inventory manager") holds one project per shop.
  - Verify current pricing before the first customer.
- **Hosting:** Cloudflare Pages (ROADMAP List 5 §5).
  - Today's site is on GitHub Pages, which can't send headers, so the CSP in `_headers` does nothing there.
  - ABAP moves to Cloudflare in phase 0 with today's site unchanged. The hosting move and the new app never land on the same day.
  - Use Pages rather than Workers. A subdomain can point at a Pages project with a CNAME record at any DNS provider, so `abapbakery.com`'s DNS doesn't have to move to Cloudflare.
  - Before phase 6, check the custom-domains-per-project limit (Cloudflare's docs say 100, some summaries say 5). That number caps how many shops one stable deployment can serve.
- **No Node, Supabase CLI or Postgres tools on the owner's PC today.**
  - Cloudflare builds the site on every push.
  - CI runs the tests.
  - Previewing locally means installing Node, a one-time step.
- **The repo has no full schema.** ABAP's original tables were made by hand before migration 001. So the phase 0 baseline must come from ABAP's live database (structure only, no rows).
- **A practice database.** A separate Supabase project in the owner's organization holds fake data only.
  - It is built from the tracked migrations and a fake-data seed.
  - Claude runs migrations and tests there.
  - Every database change is rehearsed there before the owner applies it to ABAP.
- **Migrations must be backward-compatible (expand/contract).** Shops sit on different schema versions between releases, and ABAP's old pages keep running against ABAP's database until each is replaced. So every migration until phase 5 must be additive: no renames or drops that an old page depends on.
- **The GitHub repo is public.** GitHub Pages needed that on the free plan; Cloudflare doesn't. While it stays public:
  - nothing that helps an attacker goes in it, so the security reviews in `docs/review/` stay out of git until their findings are fixed;
  - no shop's business data goes in it. A POS catalog export (`MLEWTP3S0E54G_catalog-2026-07-31-1804.csv`) is already committed at the root and served by today's site.
  
  Making the repo private after phase 0 is recommended (§11).
- **Devices:** iPhone and iPad on iOS/iPadOS 16.4 or later, and current Chrome on Android. That's roughly anything updated in the last 3 years. Modern CSS such as `color-mix()` is fine.
- **Accessibility:**
  - WCAG 2.1 AA contrast;
  - touch targets of at least 44 px;
  - full keyboard use on the tablet and desktop.
- **Time zones:** every "today", "this week" and "this month" is computed in the shop's time zone, not UTC and not the device's zone (frontend review M1/M2, backend M9).

## 4. Approaches considered

The backend shape was settled before this conversation (ROADMAP List 5): **one Supabase project per shop**, rather than one shared database with a shop ID on every row.
- RLS (row-level security) stays as it is.
- A policy mistake can't cross shops.
- "Your data is in your own database" is a straight answer for customers.
- The cost scales per shop, which is acceptable at 2–5 shops.

For the frontend, three approaches were weighed:

| Approach | What it is | Trade-off |
|---|---|---|
| 1. Clean up in place | Keep the 17 static pages; add shared ES modules, one design-system stylesheet, auto-escaping HTML helpers. No build step. | Smallest change and no new tools. But every screen is still built from HTML strings, the exact source of the review's XSS findings. |
| **2. Svelte (chosen)** | Each screen is a `.svelte` file that reads like HTML with `{ }` placeholders. Built to static files. | Output is escaped by default, which removes that bug class. One shared layout, and the design system as reusable components. Costs a screen-by-screen rewrite and a Node toolchain. |
| 3. React | Component rewrite in JSX. | Most popular, but wordier and further from HTML, so harder to read line by line. Worth it only if React hires are planned. |

**The owner chose Svelte.** It keeps the code readable, removes the biggest bug class, and fits a component-based design system.

## 5. What the owner decided

### Look (mockups: `look-phone.html`, `tablet.html`)

- **Layout is "F" (ring and stats).**
  - Home shows:
    - a progress ring card for the current checklist;
    - two big numbers (low on stock, not counted);
    - a "Today" list;
    - the shift note.
  - The shop color is used as accents (ring, labels, active tab), not as big filled blocks.
- **Dark mode is F's dark kitchen in E's warm colors.**
  - Espresso-dark background, not black.
  - Cream text, not white.
  - Warm brown-greys for secondary text.
- **Light mode is E's editorial paper.**
  - Cream paper background and dark-brown ink.
  - Cards are paper with thin rule lines, not white boxes.
  - The shop color is used for headings, accents and the shift-note rule.
- **The shop's logo** goes in the top bar (or at the top of the tablet rail) and on the app icon.
- **Each shop picks one of a fixed set of colors.** Nothing more custom than that.

### Sign-in (mockup: `sign-in.html`)

- **Staff use both a shared shop tablet and their own phones.**
- **On the shop tablet:**
  - It opens to "Who's working?". You tap your name and enter a 4-digit PIN.
  - Your avatar at the bottom of the rail hands the tablet to the next person.
- **On a personal phone:** the shop's own subdomain, with its logo and color, and email and password.
- **Some staff have email and some are tablet-only.** When a person is added, the admin picks either "shop tablet only" (name and PIN) or "email + shop tablet".

### Data and access

- **Cost, price and sales figures are admin-only, enforced by the database.** This covers recipe costs, option prices, pricing settings, expenses, monthly sales, stock value, reports and the company tax ID. Today these are hidden only in the UI (frontend M9, backend M5).
- **Plans are all or nothing for now,** but the per-shop feature switches are built anyway. They are on for every shop at launch, and only the owner can change them.
- **Seed a common ingredient catalog** (milk, eggs, flour…) with measuring and quantity data, so a shop enters only its own details: grocer cost, quantity, par.
- **Allergens are not pre-filled.** They are fields each shop fills in for its own items and recipes.
- **The owner sets up every shop and signs it up personally.** There is no public sign-up.

### Rollout (decided after the design review)

- **ABAP is the test site.** The new app is published to `dashboard.abapbakery.com` early, and ABAP's staff use it while it's being built. They accept bugs.
  - The owner first accepted "switch ABAP over all at once, when the new app does everything".
  - The owner then asked for ABAP to be the test site.
  - So the switch is now screen by screen, with old pages still reachable until they're replaced (§6, "Living next to the old pages").
- **A practice database with fake data** (§3) is where every change is built and tested first. Only the owner runs anything against ABAP's database or sets up real shops.
- **US only,** and local to the owner (§2).
- **Devices from the last 3 years or so** (§3).
- **The wording rule** (§9 item 2):
  - today's in-app wording counts as the owner's and carries over;
  - new wording Claude adds is written plainly, without brackets, so ABAP can use it, and is logged in `docs/copy-to-review.md`. The owner approves or rewrites it before the first outside shop;
  - brackets stay only on what must come from the owner: the product name, the domain, the legal pages and the product page.

## 6. Claude's calls (made during design; the owner can override any of them)

### Frontend

- **Framework:** SvelteKit in single-page mode (`adapter-static` with an `index.html` fallback, no server rendering).
  - SvelteKit gives routing and shared layouts for free.
  - Server rendering isn't needed, because Supabase is the backend.
- **Language:** JavaScript, with JSDoc types and `svelte-check` where they catch real mistakes. TypeScript was skipped because it's one more thing to explain, and the gain at this size is small.
- **All database access lives in one data layer** (e.g. `src/lib/data/*.js`). Screens never call `supabase.from()` directly. This was the ROADMAP's hedge (List 5 §5), and it also makes the money rules and feature switches easy to audit.
- **The design system is a set of components:**
  - top bar or rail with the logo badge;
  - bottom tabs / left rail;
  - ring card;
  - stat;
  - list row;
  - stepper;
  - chips;
  - segmented control;
  - sheet/modal;
  - toast;
  - confirm dialog (replacing `alert()`/`confirm()`).
  - Tokens are CSS custom properties (§7).
- **Breakpoints:**
  - phone layout with bottom tabs;
  - from about 900 px wide, the tablet/desktop layout with a left rail and multi-column screens;
  - a tablet held upright uses the phone layout spread into two columns.
- **Dark/light follows the device's system setting by default,** with an override in Settings. The override is per device, so a counter tablet can stay in one mode.
- **Headings are plain (Inter).** The serif (Fraunces italic) is used only for the shift-note quote.
- **The logo sits on a small cream badge,** so a dark logo stays visible in dark mode. The app never recolors a logo. The top-bar layout follows the logo's shape:
  - square or round logo: logo plus shop name;
  - wide wordmark: logo alone;
  - no logo: the shop's initials on its color.
- **The app icon is the logo on white,** or the initials on the shop color when there's no logo.
- **Warnings always carry a word or icon, never color alone.** This matters for shops whose color is a red (Cherry, Rose).
- **Inventory counts save on each tap** (no Save button). The list never re-renders the row being edited (frontend H3).
- **Home keeps today's customization; the F layout is the default.** Today's dashboard has per-person layouts saved in `user_prefs`, drag and resize, and add/remove widgets. The ROADMAP plans more widgets (List 2 #9, List 4), so parity keeps all of that, restyled. The F cards become the default widgets:
  - **Staff default:** ring card (my checklist), low-stock and not-counted stats, Today (including special tasks), shift note.
  - **Admin default:** a ring card for the whole team's checklist progress (so an admin with no job role still sees something meaningful), team completion, inventory health, stock value, to-order, "likely to order soon", special tasks, shift note.
  
  The daily quote widget stays as an optional widget. Its zenquotes.io request then needs a CSP `connect-src` entry, or the widget is dropped; that's the builder's call.
- **Admin edit mode becomes an "Edit" button** on the screens that have admin-only editing controls (Tasks, Inventory, Home's "Customize"). It times out the way it does today (`edit_mode_timeout_minutes`).

### Living next to the old pages (phases 1–5)

- **The new app serves `/`.** Today's pages move to `/old/` (for example `/old/inventory.html`) and are copied into the build otherwise unchanged.
  - They can't stay at their current addresses. Cloudflare serves `inventory.html` at `/inventory`, which is the new screen's address.
  - A `_redirects` file sends today's addresses to their `/old/` copies, so bookmarks and installed home-screen icons keep working.
- **Old pages follow the deployment's database.** The build writes the deployment's Supabase URL and key into `/old/config.js`. So on a preview, the old pages use the practice database too.
- **Screens not ported yet** are linked from the new app's navigation and open the old page.
- **Old and new share one Supabase project and one browser sign-in.** They're on the same address and both use supabase-js's default storage key, so moving between them doesn't ask anyone to sign in again. Check this in phase 1.
- **When a screen is ported,** its old page becomes a redirect to the new screen, so bookmarks and the old navigation keep working.
- **Today's `index.html` (sign-in) is replaced** by the new app's sign-in. Old pages that send a signed-out person to `index.html` land there.
- **Two places where old and new would clash:**
  - **Cost columns.** Before phase 2 locks money figures to admins, the old pages that read `inventory_items` or `recipe_ingredients` with `select("*")` are patched to list their columns: `dashboard.html:43`, `inventory.html:43`, `shopping.html:33` and `recipes.html:39`. Their admin-only cost displays then read through whatever admin-only path phase 2 adds. Without the patch, those pages break the day the database starts refusing cost columns.
  - **Recipe lines.** Lines are linked to inventory items by ID only when the new Recipes screen replaces the old one (phase 3). The old editor deletes and re-inserts every line on save (`recipes.html:429–437`), which would drop the links.

### Shops, config and branding

- **The per-shop registry is private.** Each shop's settings live in Cloudflare (for example a KV store keyed by hostname) and are served by a small Pages Function as `/config.json` and `/manifest.webmanifest`:
  - Supabase URL and publishable key;
  - display name;
  - color;
  - logo and icon URLs;
  - time zone;
  - release channel.
  
  Nothing in the bundle or the public repo lists shops. The exact mechanism is the builder's call, within the anti-goal in §2.
- **Until phase 6 there is one shop,** so `/config.json` is a plain file in ABAP's deployment holding only ABAP's settings.
  - ABAP's Supabase URL and publishable key are already public in today's `config.js`.
  - The app reads its settings only through `/config.json`, so the move to the private registry in phase 6 changes the hosting, not the app.
  - Preview deployments (any branch other than `main`) get the practice database's settings instead, so a preview never touches ABAP's data.
- **Color is changeable later.** The owner sets it at setup; the shop admin may change it in Settings, choosing only from the 14. Logo and icon are set by the owner.

  *Builder note:* if color lives in the shop's database for admin editing, the sign-in page needs an anon-readable view exposing only name, color and logo URL. Pick whichever keeps the registry private and the sign-in page branded.

### Feature switches

- **Storage:** a `shop_features` table in each shop's database. It is readable by signed-in users and writable only by the `service_role` key, which only the owner's setup tooling holds.
- **Enforcement:** an RLS helper (e.g. `feature_on('money')`) is added to the policies of every table in that group. The UI hides switched-off screens too, but the database is the enforcement.
- **Groups:**

  | Group | Screens | Switchable |
  |---|---|---|
  | Core | Home, Tasks, Inventory, Team, Settings, Company | no, always on |
  | Recipes & costing | Recipes, Pricing, Units, Planner | yes |
  | Agenda | Agenda (events) | yes |
  | Ordering | Shopping | yes |
  | Money | Expenses, Reports | yes |
  | History | History | yes |

### Sign-in and accounts

- **Tablet enrollment:**
  - An admin signs in on the tablet with email and password and taps "Make this the shop tablet".
  - The tablet receives a long random device token. The database stores only its hash, along with the device's name and who enrolled it.
  - Admins can see and revoke enrolled tablets in Settings.
- **PIN sign-in runs through an Edge Function** (e.g. `tablet-signin`). It checks the device token, the person and the PIN, then gives the browser a normal Supabase session for that person.
  - PINs are stored hashed in a table only `service_role` can read.
  - Wrong PINs are rate-limited, and a person is locked out after repeated failures until an admin resets them.
  - A PIN never works on a device that isn't enrolled.
  - How the function mints the session is the builder's call. One way is an admin magic link exchanged server-side for a session; verify that it's sound.
- **Tablet-only people** are real Supabase Auth users with a placeholder, non-routable email, so every foreign key and RLS rule works unchanged. Adding a real email later keeps their history.
- **On the tablet:**
  - It returns to "Who's working?" when someone taps their avatar, and after an idle timeout (default 5 minutes, an app setting). This must hold even after the tablet sleeps (frontend H2).
  - Signing out really clears the session (frontend H1).
  - Changing a password, or opening an admin-only screen, asks for that person's PIN again. This closes the account-takeover problem (backend H2).
- **Personal phones stay signed in** from phase 4. The idle logout exists because of shared devices, and the tablet flow handles those.
  - Until the tablet flow exists, the new app keeps today's idle sign-out (`idle_logout_minutes`) on every device, because ABAP's tablet is shared.
  - The idle sign-out is measured by the clock, so a tablet that slept past the limit is signed out when it wakes (frontend H2).
- **A deactivated user is cut off** in the database immediately, not when their token expires (backend M2).
- **Adding staff:**
  - The admin picks "shop tablet only" or "email + shop tablet", sets a starting PIN, and the person changes it.
  - Email people get an invite to set their own password once a mail sender is configured (ROADMAP List 1 #7). Until then the admin sets a temporary password, as today.
  - Sign-ups are switched off in every project (backend C1). Accounts are only ever created by `manage-users` or the setup tooling.

### Ingredient catalog

- **A `catalog_items` table,** seeded identically in every shop, read-only for shops. Its fields:
  - name;
  - category;
  - counting unit;
  - common package sizes;
  - recipe measuring units;
  - grams per cup;
  - grams per each, where it applies;
  - a source citation.
- **Each `inventory_items` row may point to a catalog item** and inherit its measuring data. The shop enters cost, quantity, par, vendor and allergens.
- **Recipe ingredient lines link to inventory items by ID, not by name.** This fixes the fuzzy matching in frontend L6, and the planner and costing views that match on text.
  - Existing ABAP recipe lines are migrated by matching names once.
  - Lines that don't match exactly are listed for the owner to confirm.
- **Allergen fields** on inventory items and recipes start empty. Each shop fills them in.
- **Who writes the catalog data:** Claude drafts it from published sources (for example USDA FoodData Central), with the source recorded per row. The owner reviews it and approves the item names before it ships. Size: about 100–150 common bakery and café items.

### Database groundwork (phase 0)

- **A baseline of ABAP's current schema,** structure only, no rows (§3: the repo has no full schema).
  - Take it with `pg_dump --schema-only` from a manually run CI job, using a connection string the owner saves as a repository secret.
  - Or the owner installs the Supabase CLI, whose `db pull`/`db dump` need Docker.
  - From then on, every change is a CLI-tracked migration with a unique version (backend M6).
- **Fix or replace migration 004** (backend H1). The baseline shows whether it applied, that is, whether `recipes.yield_qty` exists.
- **The practice database** is built from the baseline plus a fake-data seed: a made-up bakery with staff, items, recipes and a few weeks of history, enough to exercise every screen.

### Database security fixes (phase 2)

- **Security fixes from the reviews that don't depend on the new frontend:**
  - public sign-ups off (C1);
  - `PUBLIC` execute revokes (M1);
  - deactivation enforced in `is_admin()` and in RLS (M2);
  - money tables and columns admin-only (M5);
  - `security_invoker` kept on recreated views (M7);
  - recipe save as one transactional RPC (M8);
  - default-privilege revokes (L7);
  - no `profiles` self-insert (L11).
- **A shop time zone setting.** Server-side date logic uses it (M9).
- **`counted_this_week` gets a real weekly reset** (frontend M11).

These are all additive or tightening changes. Each is rehearsed on the practice database and checked against the old pages still in use before the owner applies it to ABAP.

## 7. Design tokens (from the mockups)

### Dark mode

| Token | Value |
|---|---|
| background | `#17120F` |
| card | `#241C17` |
| raised | `#2F261F` |
| ink (text) | `#F4ECE0` |
| muted text | `#A8998A` |
| rules | `#3A2F27` |
| nav background | `#1D1713` |
| red | `#FF8A7A` |
| amber | `#F2B84B` |

The accent is the shop color's **dark partner**: the same hue, lightness set to 70%, saturation clamped to 40–75%. Selected chips use the accent as a fill with dark text.

### Light mode

| Token | Value |
|---|---|
| background and cards | `#FBF7F0` (cards have a `#E6DCCB` rule border) |
| raised | `#F3ECE0` |
| ink (text) | `#2A2420` |
| muted text | `#75685A` |
| red | `#B4382B` |
| amber | `#8A5D00` |

The accent is the shop color itself. E's original muted text color, `#8A7C6C`, measured 3.8:1, so it was darkened.

### The 14 shop colors

| Name | Hex |
|---|---|
| Espresso | `#6B4F3A` |
| Cinnamon | `#A0522D` |
| Terracotta | `#B5482E` |
| Cherry | `#B3263B` |
| Rose | `#B8325F` |
| Berry | `#8E2A5F` |
| Plum | `#6B3FA0` |
| Indigo | `#3949AB` |
| Ocean | `#1D6AA5` |
| Teal | `#0F766E` |
| Sage | `#4A7A52` |
| Forest | `#2E6B3F` |
| Honey | `#96650F` |
| Slate | `#475569` |

The mockup computes WCAG contrast live. Every text pairing passes 4.5:1 in both modes for all 14 colors; the closest is cream text on Sage at 4.7:1. The dark partners are generated by formula. The builder may hand-tune them, but must keep the contrast checks passing.

### Type

- **Inter** for everything.
- **Fraunces italic** only for the shift-note quote.
- Self-host both fonts. Today's Google Fonts link never loaded (frontend L2), and self-hosting keeps the CSP simple.

## 8. Phases

Each phase ends in something usable. Each gets its own step-by-step plan.

| # | Phase | Done when |
|---|---|---|
| 0 | **Groundwork:**<br>• today's site moved to Cloudflare unchanged;<br>• ABAP's schema baseline under tracked migrations (§6, "Database groundwork");<br>• the practice database with fake data;<br>• CI that runs the tests. | ABAP's site works from Cloudflare exactly as before, and the practice database can be rebuilt from the repo alone. |
| 1 | **New app, first release to ABAP:**<br>• SvelteKit project;<br>• design system;<br>• `/config.json`;<br>• email sign-in;<br>• role gating;<br>• the new Home;<br>• old pages still linked. | ABAP's staff open `dashboard.abapbakery.com` and land on the new Home, on phone and tablet, in both modes. Every other screen still works through its old page. |
| 2 | **Database security fixes** (§6), plus the old-page column patch. Can run alongside phase 1. Must finish before phase 3 ports any money screen. | The backend review's security items are closed on ABAP, and the old pages still work. |
| 3 | **Port the remaining screens,** each replacing its old page when it lands. Suggested order: Tasks, Inventory count, Recipes (with the recipe-line ID linking), Agenda, Shopping, Planner, Pricing, Units, Expenses, Reports, History, Team, Settings, Company. Fix the review findings for each screen as it's ported. Home's per-person customization (add, remove, reorder and resize cards) lands here too, as does the dark/light override in Settings. Phase 1's Home shows each role's default cards. | Every current screen exists in the new app with its review findings closed, and no old page is linked any more. |
| 4 | **Shop tablet:**<br>• enrollment;<br>• "Who's working?";<br>• PIN;<br>• tablet-only staff;<br>• idle lock;<br>• re-PIN for sensitive actions.<br>It can move ahead of the later screens in phase 3 if ABAP wants it sooner. | ABAP runs a real shift on the tablet with PINs. |
| 5 | **Clean-up on ABAP:** delete the old pages. Contract migrations remove shapes only the old pages used. | ABAP has used only the new app for at least a week, then the contract migrations are applied. |
| 6 | **Multi-shop:**<br>• hosting gains the private registry and the stable channel;<br>• setup script: creates the project, applies migrations, loads seeds (catalog, starter tasks from ABAP's list, units, pricing defaults), applies Auth settings, deploys Edge Functions, registers the shop's config;<br>• feature-switch enforcement;<br>• per-shop branding;<br>• a script that migrates every stable shop and reports each one's schema version. | A test shop is created end to end by the script, on its own subdomain, with no ABAP data visible. |
| 7 | **Onboarding extras:**<br>• POS catalog CSV importer (ROADMAP List 5 §3);<br>• a product page skeleton at the root domain, with a "find your shop" box that only navigates to the typed subdomain and never looks shops up. | The first outside shop can be onboarded. |

**Releases:**
- **Until the second shop,** every push to `main` deploys to ABAP, which makes ABAP the beta channel. Other branches get preview addresses that use the practice database.
- **From phase 6,** ROADMAP List 5 §5 applies:
  - `beta` and `stable` branches;
  - ABAP on beta;
  - promotion on a fixed weekday;
  - the stable shops' databases migrated and verified before the frontend is promoted.

## 9. The AI line

1. **Claude writes and explains the code.**
2. **Anything a customer reads is the owner's to write.** This covers the product page, pricing, emails, in-app wording, privacy policy and terms.
   - Today's in-app wording is already the owner's and carries over.
   - New in-app wording Claude adds is plain and usable, and logged in `docs/copy-to-review.md` for the owner to approve or rewrite before the first outside shop.
   - The product name, domain, legal pages and product page stay as `[bracketed]` stand-ins until the owner writes them.
3. **The product has no AI features.**
4. **Claude never sees or handles a shop's business data.**
   - Development uses seed and fake data.
   - Claude may run migrations and tests against the practice database, which holds fake data only.
   - Anything against ABAP's or another shop's database is run by the owner, or by scripts the owner runs.
   - Schema dumps are structure only, with no rows.
5. **Catalog data** is the one dataset Claude drafts. It comes from published sources, with a source column, and the owner approves it (§6).
6. **The starter task list for new shops comes from ABAP's real tasks** (ROADMAP List 5 §4). The owner produces it, because it's both ABAP's data and customer-readable text. Claude may write the export script; the owner runs it and trims the wording.

## 10. Left to the builder

- File and folder layout.
- Component APIs.
- State management. Svelte stores are likely enough.
- Test tooling: e.g. Vitest for unit conversions, due dates and money math, and Playwright for the sign-in and count flows. Tests run in CI.
- How `/config.json` and the manifest are served, within the "no tenant map" rule.
- How the CSP's `connect-src` covers per-shop Supabase hosts (see `docs/spec-csp-hardening.md`): per-host headers from the Pages Function, or a narrower alternative.
- How the PIN Edge Function mints sessions, within the rules in §6.
- Realtime: subscribe per screen and refetch after a reconnect or when the device wakes (frontend M10/M12).
- How data-layer errors reach the user: every write reports failure, and optimistic updates roll back (frontend M6).

## 11. Open items that don't block planning

The owner decides these before the phase that needs them:

- **Product name and root domain** (needed by phase 6). Until then it's `[yourproduct].com`.
- **ABAP's address once there are other shops:** keep `dashboard.abapbakery.com` as a custom domain, or move to `abap.[yourproduct].com` (phase 6). Until then it stays `dashboard.abapbakery.com`.
- **Privacy policy, terms and a support plan** before the first outside shop (ROADMAP List 5 §6). This is the owner's writing.
- **Make the GitHub repo private** once ABAP is served from Cloudflare (recommended, phase 0). Until then the rules in §3 apply.
- **How a shop leaves.** By default the owner exports that shop's database on request. An in-app export can come later.
