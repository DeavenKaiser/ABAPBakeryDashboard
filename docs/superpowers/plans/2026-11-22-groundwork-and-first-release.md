# Groundwork and First Release: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Serve ABAP's site from Cloudflare.
- Put ABAP's schema under tracked migrations, with a fake-data practice database.
- Publish the new app's sign-in and Home on `dashboard.abapbakery.com`. Every other screen stays reachable through its old page.

**Architecture:**
- **The app.** A SvelteKit single-page app (`adapter-static`), built by Cloudflare Pages on every push.
- **Per-deployment files.** Each build writes `config.json`, `manifest.webmanifest`, `_headers` and `old/config.js` from Cloudflare environment variables:
  - Production uses ABAP's values;
  - Preview uses the practice database's.
- **Data access.** Screens reach the database only through `src/lib/data/*`.
- **Tests.**
  - Pure rules (`home/rules.js`, `time/shopTime.js`, `theme/colors.js`, `config/shopConfig.js`) carry the unit tests.
  - Data functions are tested against the practice database.
  - Screens are tested with Playwright.

**Tech Stack:**
- Node 24 LTS.
- SvelteKit 2 with Svelte 5 (runes) and Vite, using `@sveltejs/adapter-static`.
- `@supabase/supabase-js` 2.
- Vitest, Playwright and `@axe-core/playwright` for tests.
- `@fontsource-variable/inter`, `@fontsource/fraunces` and `@lucide/svelte`.
- The `supabase` CLI (npm devDependency) and `postgres` (porsager), for the practice reset script.
- GitHub Actions and Cloudflare Pages.

**Spec:** [`docs/superpowers/specs/2026-11-22-multi-shop-rebuild-design.md`](../specs/2026-11-22-multi-shop-rebuild-design.md). Read it, especially §5 "Rollout", §6 "Living next to the old pages", §7 and §8.

**Scope:** phases 0 and 1 of the spec. Phase 2 (database security fixes) gets the next plan.

## Global Constraints

- **Code:**
  - JavaScript with JSDoc. `svelte-check` passes with `checkJs: true`.
  - No new TypeScript files. The existing Edge Function stays as it is.
- **Database access:** only files in `src/lib/data/` import the Supabase client. Screens never call `.from()`, `.rpc()` or `.channel()`.
- **Money:** staff queries never select money columns (`inventory_items.unit_cost`). Admin queries may.
- **Time:** every "today", "this week" and "this month" uses the shop's time zone from config (`timeZone`), never UTC or the device's zone.
- **Accessibility:**
  - WCAG 2.1 AA contrast;
  - touch targets at least 44 px;
  - every control usable by keyboard;
  - warnings carry a word or icon, never color alone.
- **Layout:**
  - below 900 px wide, bottom tabs;
  - from 900 px, a left rail.
  - Dark/light follows `prefers-color-scheme`. The manual override arrives in phase 3.
- **Type:**
  - Inter for everything;
  - Fraunces italic only for the shift-note quote;
  - both self-hosted (no Google Fonts request).
- **No AI features.** No network requests except to the deployment's own origin and its Supabase project.
- **Wording:**
  - Reuse today's in-app wording wherever a screen had it (quoted in the tasks below).
  - Every new user-visible string is plain, without brackets, and gets a row in `docs/copy-to-review.md`.
- **ABAP's database is never touched by Claude.** Anything that writes to a database refuses ABAP's project ref `hdyyffeameoxocwvirdl`. The only exception is the owner-run workflow in Task 2.
- **Migrations:**
  - Expand-only until phase 5.
  - File names use the CLI format `YYYYMMDDHHMMSS_name.sql`.
- **Secrets are never committed.**
  - `.env.practice` is gitignored.
  - Deployment values live in Cloudflare.
  - CI values live in GitHub secrets.
  - The repo is public.
- **Commits and pushes:**
  - Commit steps run only once the owner has approved executing this plan.
  - Phase 0 lands on `main`, because Cloudflare builds production from it.
  - Phase 1 is built on the branch `new-app`. Pushing that branch only updates the preview address, which uses the practice database.
  - Merging to `main` publishes to ABAP and needs the owner's explicit go-ahead (Task 14).
- **Devices:** iOS/iPadOS 16.4 or later, and current Chrome.

## Review Focus

1. **A script, preview or test pointed at ABAP's database** instead of the practice one must refuse to run, not quietly write to ABAP. Tested in Task 3 (`assertPracticeTarget`) and Task 5 (`parseShopConfig` on a preview).
2. **Moving between the new app and an `/old/` page** must not ask for a second sign-in. Signing out in either must leave both signed out. Tested in Task 9's e2e.
3. **A shared tablet that sleeps past the idle limit** must be signed out when it wakes, not left signed in as the last person (frontend H2). Tested in Task 9's idle unit tests and clock e2e.
4. **Saving on flaky shop wifi:** a failed write shows an error and the screen rolls back. It never says "Saved" (frontend M6, H8). Tested in Task 12 (data layer) and Task 13 (offline e2e).
5. **Near midnight, and at week and year boundaries in the shop's zone,** completion keys must match what the old pages write, or ticks made on old and new screens won't line up. Tested in Task 7, including a parity test against the old `periodKey`.

---

## Owner steps

These need the owner's own accounts. Each task names the step it waits on.

- **O1. Install Node.js 24 LTS** on the PC:
  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```
  Reopen the terminal. `node -v` should print `v24.` followed by the rest of the version.
- **O2. Create the practice Supabase project** in the "Inventory manager" organization:
  - Name it `practice`, in the same region as ABAP's project.
  - In its Auth settings, turn off "Allow new users to sign up".
  - Copy `.env.practice.example` (from Task 3) to `.env.practice` and fill in the project's URL, publishable key, secret key and Session-pooler connection string.
  - Claude never needs to see these values.
- **O3. Create a Cloudflare account** (the free plan is enough) and a Pages project connected to this GitHub repo. Task 1 gives the settings.
- **O4. Add GitHub repository secrets** (Settings → Secrets and variables → Actions):
  - `ABAP_DB_URL` for Task 2;
  - `PRACTICE_SUPABASE_URL`, `PRACTICE_PUBLISHABLE_KEY` and `PRACTICE_TEST_PASSWORD` for CI. Copy them from `.env.practice` after Task 3 has run once.
- **O5. Switch ABAP's DNS and unpublish GitHub Pages** (Task 1, step 6).
- **O6. Recommended:** after O5, make the GitHub repo private (spec §3, §11), and delete the committed POS export `MLEWTP3S0E54G_catalog-2026-07-31-1804.csv`. Claude has not opened that file.

---

## Phase 0: Groundwork (on `main`)

### Task 1: Serve today's site from Cloudflare Pages

**Files:**
- Create: `scripts/build-legacy.sh`
- Modify: `package.json` (add `"build": "bash scripts/build-legacy.sh"` to `scripts`), `.gitignore` (add `build/`, `docs/review/`)

**Interfaces:**
- Produces: `npm run build` writes the deployable site to `build/`. Cloudflare's build settings (command `npm run build`, output `build`) never change after this task. Task 4 redefines what `build` does.

- [ ] **Step 1: Ask the owner about the uncommitted XSS patch.** It covers `admin.html`, `dashboard.html`, `inventory.html`, `planner.html`, `recipes.html`, `reports.html` and `supabase/SECURITY-AUDIT.md`. Should it be committed first, so Cloudflare serves the patched pages? Recommended: yes. `docs/review/` stays out of git, because the repo is public and the reviews list open findings.
- [ ] **Step 2: Write `scripts/build-legacy.sh`.** It runs under `set -eu` and recreates `build/`. Then it copies only this allowlist into it: `*.html config.js nav.js style.css icon-192.png icon-512.png manifest.json _headers`. Nothing else is published: not the CSV, `docs/`, `supabase/`, `ROADMAP.md`, `README.md` or `bump-version.js`.
- [ ] **Step 3: Run it.**
  - Run: `bash scripts/build-legacy.sh && ls build | wc -l && ls build | grep -c csv`
  - Expected: `24`, then `0`.
- [ ] **Step 4: Commit and push to `main`** (owner's go-ahead). ABAP is unaffected, because DNS still points at GitHub Pages.
  ```bash
  git add scripts/build-legacy.sh package.json .gitignore
  git commit -m "build: allowlisted static build for Cloudflare Pages"
  ```
- [ ] **Step 5: Owner, O3.** Create the Pages project:
  - Framework preset: None;
  - Build command: `npm run build`;
  - Build output directory: `build`;
  - Production branch: `main`.
  
  Then verify on the `*.pages.dev` address:
  - Run: `curl -sI https://<project>.pages.dev/ | grep -i x-frame-options`. Expected: `X-Frame-Options: DENY`.
  - Run: `curl -s https://<project>.pages.dev/ROADMAP.md | head -c 15`. Expected: `<!DOCTYPE html>`. That's the sign-in page served as a fallback, not the file.
  - The owner signs in there with their own ABAP account. The dashboard loads.
- [ ] **Step 6: Owner, O5.**
  - In the Pages project, add the custom domain `dashboard.abapbakery.com`.
  - At the DNS provider, point the `dashboard` CNAME at `<project>.pages.dev`.
  - Once Cloudflare shows the domain as Active, unpublish GitHub Pages (repo Settings → Pages).
  - Run: `curl -sI https://dashboard.abapbakery.com/ | grep -i x-frame-options`. Expected: `X-Frame-Options: DENY`, which proves Cloudflare is serving it.

### Task 2: ABAP's schema baseline under tracked migrations

**Files:**
- Create:
  - `.github/workflows/abap-db.yml`
  - `supabase/audit/extra-objects.sql`
  - `supabase/config.toml` (via `npx supabase init`)
  - `supabase/migrations/20261122000000_baseline.sql`
- Move: `supabase/migrations/20260810_001_security_fixes.sql`, `…002_job_roles.sql`, `…003_app_settings.sql` and `…004_recipe_yield.sql` to `supabase/migrations-archive/`. They were applied by hand, and the baseline already contains their effect.

**Interfaces:**
- Consumes: owner step O4 (`ABAP_DB_URL`).
- Produces:
  - `supabase/migrations/` holds only CLI-format files, starting at `20261122000000_baseline.sql`.
  - `abap-db.yml` is the only path by which anything runs against ABAP's database, and only the owner triggers it.

- [ ] **Step 1: Write `supabase/audit/extra-objects.sql`.** It's read-only, and it outputs SQL statements, one per line:
  - `pg_get_triggerdef` for every trigger on `auth.users`;
  - a `create policy` statement for every policy on `storage.objects`;
  - `alter publication supabase_realtime add table public.<t>;` for every row in `pg_publication_tables` where `pubname = 'supabase_realtime'`.
- [ ] **Step 2: Write `.github/workflows/abap-db.yml`.**
  - It has `workflow_dispatch` only, with a choice input `action`: `dump`, `repair-baseline` or `push`.
  - It runs on `ubuntu-latest`.
    - The CLI comes from `supabase/setup-cli@v1`. Pin `version:` to the CLI's current release, written into the workflow.
    - `DB_URL` comes from `secrets.ABAP_DB_URL`.
    - Docker and `psql` are already on the runner.
  - **`dump`:**
    - `supabase db dump --db-url "$DB_URL" --schema public -f public.sql`
    - `psql "$DB_URL" -At -f supabase/audit/extra-objects.sql > extra-objects.sql`
    - upload both as the artifact `abap-schema`.
  - **`repair-baseline`:** `supabase migration repair 20261122000000 --status applied --db-url "$DB_URL"`.
  - **`push`:** `supabase db push --db-url "$DB_URL"`.
- [ ] **Step 3: Owner runs `dump`** (Actions → abap-db → Run workflow → `dump`) and saves the two files from the artifact into the repo as `supabase/baseline-raw/public.sql` and `supabase/baseline-raw/extra-objects.sql`. Both are structure only, with no rows.
- [ ] **Step 4: Build the baseline migration.** Write `20261122000000_baseline.sql` as `public.sql` followed by `extra-objects.sql`.
  - Add `drop trigger if exists` before each `auth.users` trigger.
  - Add `drop policy if exists` before each storage policy.
  - Make any `CREATE SCHEMA "public"` line `CREATE SCHEMA IF NOT EXISTS "public"`, because the practice wipe recreates the schema first.
  - Move the four old migration files to `supabase/migrations-archive/`.
- [ ] **Step 5: Check the baseline against the backend review's count.**
  - Run: `grep -c "^CREATE TABLE" supabase/migrations/20261122000000_baseline.sql` and `grep -c "^CREATE OR REPLACE VIEW\|^CREATE VIEW" supabase/migrations/20261122000000_baseline.sql`
  - Expected: `24` and `13`. If either differs, stop and report the difference to the owner before going on.
- [ ] **Step 6: Check migration 004** (backend H1).
  - Run: `grep -n "yield_qty\|yield_unit" supabase/migrations/20261122000000_baseline.sql`
  - If both columns are on `recipes`, 004 applied, so note that in `supabase/migrations-archive/README.md`.
  - If they're missing, add `20261122000100_recipe_yield.sql`. It ports 004's intent idempotently (`add column if not exists`) and fixes what the backend review's H1 says was wrong with it. The owner runs `push` after Task 3 has rehearsed it on the practice database.
- [ ] **Step 7: Owner runs `repair-baseline`.**
  - Expected log line: `Repaired migration history: [20261122000000] => applied`.
  - ABAP's database is unchanged; only its migration history now knows the baseline.
- [ ] **Step 8: Commit.**
  ```bash
  git add .github/workflows/abap-db.yml supabase/
  git commit -m "db: baseline ABAP's schema as the first tracked migration"
  ```

### Task 3: Practice database with fake data, and CI

**Files:**
- Modify:
  - `package.json`: devDependencies `supabase`, `postgres`, `@supabase/supabase-js`, `vitest`. Scripts `test`, `test:db`, `practice:reset`. Keep `build`.
  - `.gitignore`: add `.env.practice`, `node_modules/`.
- Create:
  - `.env.practice.example`
  - `scripts/practice/guard.mjs`
  - `scripts/practice/reset.mjs`
  - `scripts/practice/seed-users.mjs`
  - `supabase/practice/wipe.sql`
  - `supabase/practice/seed.sql`
  - `vitest.config.js`
  - `tests/scripts/guard.test.js`
  - `tests/fixtures/practiceShop.js`
  - `tests/db/helpers.js`
  - `tests/db/practice.test.js`
  - `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 2's migrations; owner step O2.
- Produces:
  - `assertPracticeTarget(env: Record<string,string|undefined>) => { projectRef: string }`, which throws `Error`.
  - In `tests/db/helpers.js`:
    - `signedIn(email: string) => Promise<SupabaseClient>`, a fresh client signed in with `PRACTICE_TEST_PASSWORD`;
    - `PW` (that password);
    - `TZ = 'America/Chicago'`.
  - `npm run practice:reset` rebuilds the practice database from the repo alone.
  - The fake shop below, mirrored row for row in `tests/fixtures/practiceShop.js`. Tasks 11–13 assert these exact numbers.
  - `.env.practice` keys:
    - `PRACTICE_PROJECT_REF`, `PRACTICE_DB_URL`, `PRACTICE_SECRET_KEY`, `PRACTICE_TEST_PASSWORD`;
    - `SHOP_NAME=Practice Bakery`, `SHOP_COLOR=Espresso`, `SHOP_TIME_ZONE=America/Chicago`;
    - `SHOP_SUPABASE_URL`, `SHOP_SUPABASE_PUBLISHABLE_KEY`;
    - `SHOP_IS_PRACTICE=1`.

**The fake shop** (all times in `America/Chicago`, the seed's zone):

| Table | Rows |
|---|---|
| `job_roles` (key, label, assignable, due_dow, sort_order) | baker/Baker/true/3/1 · barista/Barista/true/null/2 · cleaning/Cleaning/true/null/3 · shared/Shared/false/null/9 |
| users (email → full_name, role, job_role, active, must_change_password) | `avery@practice.test` Avery Admin, admin, null · `sam@practice.test` Sam Baker, staff, baker · `jordan@practice.test` Jordan Barista, staff, barista · `riley@practice.test` Riley Former, staff, cleaning, **active false** · `casey@practice.test` Casey New, staff, null, **must_change_password true** |
| `inventory_items` (owner, name, on hand, threshold, unit_cost, order_extra, counted) | baker: Flour 10/20/0.50/–/yes · Sugar 30/10/0.80/–/no · Butter 5/8/4.00/–/no · Eggs 60/24/0.25/–/yes · Yeast 3/1/2.00/–/yes · barista: Oat milk 2/6/4.50/–/yes · Espresso beans 12/5/15.00/**extra**/yes · Cups 500/200/0.10/–/no |
| `order_log` | Butter, status `open` |
| `tasks` (owner, frequency, text, sort_order) | baker: each_shift "Preheat ovens" 1 · daily "Feed starter" 2 · weekly "Deep clean mixer" 3 · barista: each_shift "Calibrate grinder" 1 · daily "Clean steam wand" 2 · shared: each_shift "Wipe pastry case" 1 · each_shift "Count the till" 2 |
| `task_completions` | "Preheat ovens" and "Wipe pastry case", with today's daily key |
| `special_tasks` | "Restock napkins" due today + 2 days · "Call the flour vendor", no due date. Both not done. |
| `shift_note` (id 1) | "Oven 2 runs hot. Rotate the trays at ten minutes.", updated by Jordan |
| `events` | "Catering pickup", today, `event_time` "2:00 pm" |
| `app_settings` | `idle_logout_minutes` = 30, `idle_warning_seconds` = 60 |

Fill any other NOT NULL column the baseline requires with a neutral value. Compute "today" and period keys in SQL with `now() at time zone 'America/Chicago'`. Use `to_char(…, 'IYYY-"W"IW')` for weekly keys.

- [ ] **Step 1: Write the failing guard tests** (`tests/scripts/guard.test.js`):
  ```js
  const ok = { PRACTICE_PROJECT_REF: 'abcdefghijklmnopqrst',
    SHOP_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    PRACTICE_DB_URL: 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-2.pooler.supabase.com:5432/postgres' };
  test('returns the ref for a consistent practice target', () =>
    expect(assertPracticeTarget(ok)).toEqual({ projectRef: 'abcdefghijklmnopqrst' }));
  test("refuses ABAP's project", () =>
    expect(() => assertPracticeTarget({ ...ok, PRACTICE_PROJECT_REF: 'hdyyffeameoxocwvirdl' })).toThrow(/ABAP/));
  test('refuses a DB URL for a different project', () =>
    expect(() => assertPracticeTarget({ ...ok, PRACTICE_DB_URL: ok.PRACTICE_DB_URL.replace('abcdefghijklmnopqrst', 'hdyyffeameoxocwvirdl') })).toThrow(/does not match/));
  test('refuses when the ref is missing', () =>
    expect(() => assertPracticeTarget({ ...ok, PRACTICE_PROJECT_REF: '' })).toThrow(/PRACTICE_PROJECT_REF/));
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/scripts`
  - Expected: FAIL, `assertPracticeTarget is not defined`.
- [ ] **Step 3: Implement `assertPracticeTarget` in `scripts/practice/guard.mjs`.** It refuses when:
  - the ref is missing;
  - the ref equals `hdyyffeameoxocwvirdl`;
  - either `SHOP_SUPABASE_URL` or `PRACTICE_DB_URL` doesn't contain the ref.
- [ ] **Step 4: Run the guard tests again.**
  - Run: `npx vitest run tests/scripts`
  - Expected: PASS, 4 tests.
- [ ] **Step 5: Write `wipe.sql`, `seed.sql`, `seed-users.mjs` and `reset.mjs`.**
  - **`wipe.sql`** drops and recreates the `public` schema with Supabase's stock grants (usage for `anon`, `authenticated`, `service_role`; default privileges on tables, sequences and functions for the same roles). It truncates `supabase_migrations.schema_migrations` and deletes `auth.users` rows whose email ends `@practice.test`.
  - **`reset.mjs`** runs `node --env-file=.env.practice`, so it reads `.env.practice` before anything else. Its order:
    1. `assertPracticeTarget`;
    2. `wipe.sql` via `postgres`;
    3. `npx supabase db push --db-url $PRACTICE_DB_URL --include-all`;
    4. `seed-users.mjs`;
    5. `seed.sql`.
  - **`seed-users.mjs`** creates the five users with the Admin API (`PRACTICE_SECRET_KEY`, `email_confirm: true`), then upserts their `profiles` rows. If `PRACTICE_TEST_PASSWORD` is empty, it generates a 24-character random password and writes it into `.env.practice`, never to the console.
- [ ] **Step 6: Owner, O2.** Then run the reset.
  - Run: `npm run practice:reset`
  - Expected: it ends with `practice database ready: 5 users, 8 items, 7 tasks` and exits 0.
- [ ] **Step 7: Write `tests/db/practice.test.js`.** It signs in through supabase-js with `SHOP_SUPABASE_URL`, `SHOP_SUPABASE_PUBLISHABLE_KEY` and `PRACTICE_TEST_PASSWORD`:
  ```js
  test('sam sees 8 inventory items and 7 active tasks', async () => {
    const sb = await signedIn('sam@practice.test');
    expect((await sb.from('inventory_items').select('id')).data).toHaveLength(8);
    expect((await sb.from('tasks').select('id').eq('active', true)).data).toHaveLength(7);
  });
  test("riley's profile is inactive", async () => {
    const sb = await signedIn('riley@practice.test');
    const { data: { user } } = await sb.auth.getUser();
    const { data } = await sb.from('profiles').select('active').eq('id', user.id).maybeSingle();
    expect(data.active).toBe(false);
  });
  ```
  In `vitest.config.js`, set up two projects:
  - `unit`: `tests/unit/**`, `tests/scripts/**`;
  - `db`: `tests/db/**`, with `test.env` from `loadEnv('practice', process.cwd(), '')`.
  
  The scripts are `"test": "vitest run --project unit"` and `"test:db": "vitest run --project db"`.
- [ ] **Step 8: Run the database tests.**
  - Run: `npm run test:db`
  - Expected: PASS, 2 tests.
- [ ] **Step 9: Write `.github/workflows/ci.yml`.**
  - It runs on `push` and `pull_request`, with Node 24 and `npm ci`.
  - Job `unit` runs `npm test`.
  - Job `db` runs `npm run test:db` with env `SHOP_SUPABASE_URL: ${{ secrets.PRACTICE_SUPABASE_URL }}`, `SHOP_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PRACTICE_PUBLISHABLE_KEY }}` and `PRACTICE_TEST_PASSWORD: ${{ secrets.PRACTICE_TEST_PASSWORD }}`. If `SHOP_SUPABASE_URL` is empty, its first step exits 0 with `practice secrets not set; skipping`.
  - CI never resets the practice database, and never holds its secret key or DB URL.
- [ ] **Step 10: Owner, O4** (the practice secrets). Push, and check that both CI jobs are green.
- [ ] **Step 11: Commit.**
  ```bash
  git add package.json package-lock.json .gitignore .env.practice.example scripts/practice supabase/practice vitest.config.js tests .github/workflows/ci.yml
  git commit -m "test: practice database with fake data, guard, and CI"
  ```

---

## Phase 1: New app, first release to ABAP (on branch `new-app`)

### Task 4: SvelteKit skeleton, with old pages under `/old/`

**Files:**
- Modify:
  - `package.json`: add `@sveltejs/kit`, `svelte`, `vite`, `@sveltejs/vite-plugin-svelte`, `@sveltejs/adapter-static` and `svelte-check`. Scripts: `dev`, `build`, `preview`, `check`. Pin exact versions in the lockfile.
  - `vitest.config.js`: merge into `vite.config.js`.
  - `.github/workflows/ci.yml`: the `unit` job also runs `npm run check` and `npm run build`.
- Create:
  - `svelte.config.js`
  - `vite.config.js`
  - `jsconfig.json` (`checkJs: true`)
  - `.node-version` (`24`)
  - `src/app.html`
  - `src/routes/+layout.js`
  - `src/routes/+layout.svelte` (a placeholder slot)
  - `src/routes/+page.svelte` (placeholder text "Home")
  - `static/_redirects`
- Move (`git mv`):
  - the 17 `*.html` files, plus `config.js`, `nav.js`, `style.css` and `manifest.json`, go to `static/old/`;
  - `icon-192.png` and `icon-512.png` go to `static/icons/`, and the old pages' references to them are updated to `/icons/…`;
  - `bump-version.js` goes to `scripts/bump-legacy-version.js`, with its directory pointed at `static/old/`.
- Delete:
  - `static/old/index.html`, `static/old/dashboard.html` and `static/old/change-password.html` (redirects replace them);
  - `CNAME`;
  - `scripts/build-legacy.sh`;
  - `_headers` (Task 5 generates it).

**Interfaces:**
- Produces:
  - `npm run build` makes `build/` with `index.html` as the SPA fallback and `build/old/*.html`.
  - Every route is client-only: `ssr = false`, `prerender = false`.

- [ ] **Step 1: Set up the project and adapter.**
  - In `svelte.config.js`: `adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: true })`.
  - In `+layout.js`: `export const ssr = false; export const prerender = false;`.
  - Don't add a top-level `404.html`. Without one, Cloudflare Pages serves `index.html` for unknown paths.
- [ ] **Step 2: Write `static/_redirects`.**
  - `/dashboard.html / 301`
  - `/change-password.html /change-password 301`
  - `/old/index.html / 302`
  - `/old/dashboard.html / 302`
  - `/old/change-password.html /change-password 302`
  - One line per remaining page, `/<page>.html /old/<page>.html 301`, for: admin, company, events, expenses, history, inventory, mytasks, planner, recipes, reports, settings, shopping, team, units.
- [ ] **Step 3: Build.**
  - Run: `npm run build && ls build/old | wc -l && test -f build/index.html && echo ok`
  - Expected: `18`, then `ok`. The 18 are 14 pages, plus `config.js`, `nav.js`, `style.css` and `manifest.json`.
- [ ] **Step 4: Run the checks and tests.**
  - Run: `npm run check && npm test`
  - Expected: `svelte-check found 0 errors`, and the Task 3 unit tests pass.
- [ ] **Step 5: Commit.**
  ```bash
  git add -A
  git commit -m "feat: SvelteKit skeleton; old pages move to /old/"
  ```

### Task 5: Per-deployment config

**Files:**
- Create:
  - `src/lib/config/shopConfig.js`
  - `scripts/write-config.mjs`
  - `scripts/headers.template`
  - `tests/unit/shopConfig.test.js`
- Modify:
  - `static/old/config.js:8-9`: the values become `"__SUPABASE_URL__"` and `"__SUPABASE_PUBLISHABLE_KEY__"`.
  - `vite.config.js`: add a dev-server plugin that serves `/config.json`, `/manifest.webmanifest` and `/old/config.js` from the same functions.
  - `package.json`:
    - `"build": "vite build && node --env-file-if-exists=.env.practice scripts/write-config.mjs build"`;
    - `"dev": "vite dev --mode practice"`.

**Interfaces:**
- Produces, from `src/lib/config/shopConfig.js`:
  - `SHOP_COLORS` (re-exported from Task 6).
  - `/** @typedef {{ name: string, color: { name: string, hex: string }, logoUrl: string|null, timeZone: string, supabaseUrl: string, supabaseKey: string, practice: boolean }} ShopConfig */`
  - `parseShopConfig(env) => ShopConfig`. It reads `SHOP_NAME`, `SHOP_COLOR` (one of the 14 names), `SHOP_LOGO_URL` (optional), `SHOP_TIME_ZONE`, `SHOP_SUPABASE_URL`, `SHOP_SUPABASE_PUBLISHABLE_KEY`, `SHOP_IS_PRACTICE` and `CF_PAGES_BRANCH`.
  - `renderManifest(cfg) => object`
  - `renderHeaders(cfg, template: string) => string`
  - `patchLegacyConfig(source: string, cfg) => string`
- Produces at build: `build/config.json`, `build/manifest.webmanifest`, `build/_headers`, and a patched `build/old/config.js`.

- [ ] **Step 1: Write the failing tests:**
  ```js
  const env = { SHOP_NAME: 'Practice Bakery', SHOP_COLOR: 'Espresso', SHOP_TIME_ZONE: 'America/Chicago',
    SHOP_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SHOP_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', SHOP_IS_PRACTICE: '1' };
  test('parses a valid practice config', () => expect(parseShopConfig(env)).toEqual({ name: 'Practice Bakery',
    color: { name: 'Espresso', hex: '#6B4F3A' }, logoUrl: null, timeZone: 'America/Chicago',
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabaseKey: 'sb_publishable_x', practice: true }));
  test('rejects a color outside the 14', () => expect(() => parseShopConfig({ ...env, SHOP_COLOR: 'Purple' })).toThrow(/SHOP_COLOR must be one of/));
  test('rejects an unknown time zone', () => expect(() => parseShopConfig({ ...env, SHOP_TIME_ZONE: 'Mars/Base' })).toThrow(/SHOP_TIME_ZONE/));
  test('rejects a non-https Supabase URL', () => expect(() => parseShopConfig({ ...env, SHOP_SUPABASE_URL: 'http://x.supabase.co' })).toThrow(/https/));
  test("a preview may not use ABAP's database", () => {
    const abap = { ...env, SHOP_SUPABASE_URL: 'https://hdyyffeameoxocwvirdl.supabase.co', SHOP_IS_PRACTICE: '' };
    expect(() => parseShopConfig({ ...abap, CF_PAGES_BRANCH: 'new-app' })).toThrow(/must not use ABAP/);
    expect(() => parseShopConfig({ ...abap, SHOP_IS_PRACTICE: '1' })).toThrow(/must not use ABAP/);
    expect(parseShopConfig({ ...abap, CF_PAGES_BRANCH: 'main' }).practice).toBe(false);
  });
  test('manifest', () => expect(renderManifest(parseShopConfig(env))).toMatchObject({ name: 'Practice Bakery',
    short_name: 'Practice Bakery', start_url: '/', display: 'standalone', theme_color: '#6B4F3A', background_color: '#FBF7F0' }));
  test('headers allow only this shop\'s Supabase', () => {
    const h = renderHeaders(parseShopConfig(env), readFileSync('scripts/headers.template', 'utf8'));
    expect(h).toContain('connect-src \'self\' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co;');
    expect(h).toContain('X-Frame-Options: DENY'); expect(h).not.toContain('zenquotes'); expect(h).not.toContain('{{');
  });
  test('legacy config gets both values, and a missing placeholder fails loudly', () => {
    const src = 'const SUPABASE_URL = "__SUPABASE_URL__";\nconst SUPABASE_PUBLISHABLE_KEY = "__SUPABASE_PUBLISHABLE_KEY__";';
    const out = patchLegacyConfig(src, parseShopConfig(env));
    expect(out).toContain('"https://abcdefghijklmnopqrst.supabase.co"'); expect(out).not.toContain('__');
    expect(() => patchLegacyConfig('nothing here', parseShopConfig(env))).toThrow(/placeholder/);
  });
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/unit/shopConfig.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement the four functions, the template and `write-config.mjs`.**
  - **The headers template** is today's `_headers` with these changes:
    - `connect-src` uses `{{SUPABASE_ORIGIN}} {{SUPABASE_WS}}`, and zenquotes is gone;
    - `font-src 'self'` and `style-src 'self' 'unsafe-inline'`, with the Google Fonts hosts removed.
    
    It stays `Report-Only`.
  - **The manifest icons** are `/icons/icon-192.png` and `/icons/icon-512.png`. Per-shop icons come in phase 6.
  - **`write-config.mjs <dir>`** reads `process.env`, writes the four files, and exits 1 with the error message on any throw.
- [ ] **Step 4: Run the tests again.**
  - Run: `npx vitest run tests/unit/shopConfig.test.js`
  - Expected: PASS, 8 tests.
- [ ] **Step 5: Build and check the output.**
  - Run: `npm run build && grep -c "__SUPABASE" build/old/config.js; node -e "console.log(require('./build/config.json').name)"`
  - Expected: `0`, then `Practice Bakery`.
- [ ] **Step 6: Owner sets the Cloudflare environment variables** (Pages project → Settings → Variables).
  - **Production:**
    - `SHOP_NAME=ABAP Bakery`
    - `SHOP_COLOR=Espresso`
    - `SHOP_TIME_ZONE` = ABAP's IANA zone
    - `SHOP_SUPABASE_URL=https://hdyyffeameoxocwvirdl.supabase.co`
    - `SHOP_SUPABASE_PUBLISHABLE_KEY` = the key in today's `config.js`
  - **Preview:** the practice values from `.env.practice`, plus `SHOP_IS_PRACTICE=1`.
- [ ] **Step 7: Commit.**
  ```bash
  git add -A
  git commit -m "feat: per-deployment config, manifest, headers and legacy config"
  ```

### Task 6: Theme: shop colors and tokens

**Files:**
- Create:
  - `src/lib/theme/colors.js`
  - `src/lib/theme/tokens.css`
  - `src/lib/theme/applyTheme.js`
  - `tests/unit/colors.test.js`
- Modify: `src/routes/+layout.svelte` (import the tokens and fonts: `@fontsource-variable/inter`, `@fontsource/fraunces/400-italic.css`)

**Interfaces:**
- Produces:
  - `SHOP_COLORS: {name: string, hex: string}[]`, in the spec's §7 order.
  - `contrastRatio(a: string, b: string) => number`, the WCAG 2.1 formula.
  - `hexToHsl(hex: string) => { h: number, s: number, l: number }`, with `h` in degrees and `s`, `l` from 0 to 1. Also `hslToHex`, its inverse.
  - `darkPartner(hex: string) => string`: the same hue, lightness 0.70, saturation clamped to [0.40, 0.75].
  - `applyShopColor(hex: string, root?: HTMLElement) => void`, which sets `--shop` and `--shop-dark` on `root`.
  - CSS variables from `tokens.css`:
    - `--bg`, `--card`, `--raised`, `--ink`, `--muted`, `--rule`, `--nav`, `--red`, `--amber`;
    - `--accent` and `--on-accent`. In light mode these are `var(--shop)` and `#FBF7F0`. In dark mode they're `var(--shop-dark)` and `#17120F`.
    - Values are verbatim from spec §7. Light is the default; dark is under `@media (prefers-color-scheme: dark)`.

- [ ] **Step 1: Write the failing tests:**
  ```js
  test('the 14 colors, exactly', () => expect(SHOP_COLORS).toEqual([
    { name: 'Espresso', hex: '#6B4F3A' }, { name: 'Cinnamon', hex: '#A0522D' }, { name: 'Terracotta', hex: '#B5482E' },
    { name: 'Cherry', hex: '#B3263B' }, { name: 'Rose', hex: '#B8325F' }, { name: 'Berry', hex: '#8E2A5F' },
    { name: 'Plum', hex: '#6B3FA0' }, { name: 'Indigo', hex: '#3949AB' }, { name: 'Ocean', hex: '#1D6AA5' },
    { name: 'Teal', hex: '#0F766E' }, { name: 'Sage', hex: '#4A7A52' }, { name: 'Forest', hex: '#2E6B3F' },
    { name: 'Honey', hex: '#96650F' }, { name: 'Slate', hex: '#475569' }]));
  test('contrast formula', () => expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5));
  test.each(SHOP_COLORS)('$name passes AA in both modes', ({ hex }) => {
    expect(contrastRatio('#FBF7F0', hex)).toBeGreaterThanOrEqual(4.5);              // cream text on the color
    expect(contrastRatio(darkPartner(hex), '#241C17')).toBeGreaterThanOrEqual(4.5); // dark-mode accent on a card
    expect(contrastRatio('#17120F', darkPartner(hex))).toBeGreaterThanOrEqual(4.5); // dark text on a dark-mode fill
  });
  test('Sage is the tightest light pairing, about 4.7:1', () => {
    const r = contrastRatio('#FBF7F0', '#4A7A52'); expect(r).toBeGreaterThan(4.6); expect(r).toBeLessThan(4.8);
  });
  test('dark partner keeps the hue', () => { const p = hexToHsl(darkPartner('#3949AB')), o = hexToHsl('#3949AB');
    expect(Math.abs(p.h - o.h)).toBeLessThan(1); expect(p.l).toBeCloseTo(0.70, 2); expect(p.s).toBeGreaterThanOrEqual(0.40); expect(p.s).toBeLessThanOrEqual(0.75); });
  test('muted text passes in both modes', () => {
    expect(contrastRatio('#75685A', '#FBF7F0')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#A8998A', '#241C17')).toBeGreaterThanOrEqual(4.5);
  });
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/unit/colors.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement the theme files.** `colors.js` exports `SHOP_COLORS`, `hexToHsl`, `hslToHex`, `darkPartner` and `contrastRatio`. Also write `tokens.css` and `applyTheme.js`.
- [ ] **Step 4: Run the tests again.**
  - Run: `npx vitest run tests/unit/colors.test.js`
  - Expected: PASS, 19 tests.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/lib/theme tests/unit/colors.test.js src/routes/+layout.svelte package.json package-lock.json
  git commit -m "feat: shop colors, dark partners and design tokens"
  ```

### Task 7: Shop time

**Files:**
- Create:
  - `src/lib/time/shopTime.js`
  - `tests/unit/shopTime.test.js`

**Interfaces:**
- Produces:
  - `/** @typedef {'each_shift'|'daily'|'weekly'|'monthly'} Frequency */`
  - `periodKey(frequency: Frequency, now: Date, tz: string) => string`, formatted as `YYYY-MM-DD`, `YYYY-Www` (ISO week and ISO year) or `YYYY-MM`.
  - `todayISO(now: Date, tz: string) => string`
  - `daysUntilDow(dow: number, now: Date, tz: string) => number` (0 = today)
  - `greeting(now: Date, tz: string) => 'Good morning'|'Good afternoon'|'Good evening'`. The cutoffs, in local hours, are before 11 and before 16, as in today's `dashboard.html:72-77`.
  - `dayLine(now: Date, tz: string) => string`, for example `Sunday, Nov 22`.
  - `shortDow(dow: number) => string`, for example `Wed`.

- [ ] **Step 1: Write the failing tests:**
  ```js
  const TZ = 'America/Chicago';
  test('daily key at 23:30 local belongs to that local day', () => {
    expect(periodKey('daily', new Date('2026-11-22T05:30:00Z'), TZ)).toBe('2026-11-21');
    expect(periodKey('each_shift', new Date('2026-11-22T05:30:00Z'), TZ)).toBe('2026-11-21');
    expect(periodKey('daily', new Date('2026-11-22T06:30:00Z'), TZ)).toBe('2026-11-22');
  });
  test('ISO weeks, including the 53-week year', () => {
    expect(periodKey('weekly', new Date('2026-11-22T18:00:00Z'), TZ)).toBe('2026-W47');
    expect(periodKey('weekly', new Date('2026-11-23T18:00:00Z'), TZ)).toBe('2026-W48');
    expect(periodKey('weekly', new Date('2027-01-01T18:00:00Z'), TZ)).toBe('2026-W53');
  });
  test('month key late on the last day', () => expect(periodKey('monthly', new Date('2026-12-01T05:00:00Z'), TZ)).toBe('2026-11'));
  test('DST morning', () => expect(periodKey('daily', new Date('2026-03-08T07:30:00Z'), TZ)).toBe('2026-03-08'));
  test('days until a weekday', () => {
    expect(daysUntilDow(3, new Date('2026-11-22T18:00:00Z'), TZ)).toBe(3);
    expect(daysUntilDow(0, new Date('2026-11-22T18:00:00Z'), TZ)).toBe(0);
  });
  test('greeting cutoffs', () => {
    expect(greeting(new Date('2026-11-22T16:59:00Z'), TZ)).toBe('Good morning');   // 10:59
    expect(greeting(new Date('2026-11-22T17:00:00Z'), TZ)).toBe('Good afternoon'); // 11:00
    expect(greeting(new Date('2026-11-22T22:00:00Z'), TZ)).toBe('Good evening');   // 16:00
  });
  test('matches the old pages when the device is in the shop zone', () => {
    process.env.TZ = TZ;
    for (let h = 0; h < 24 * 9; h += 1) { // nine days, every hour, across a week boundary
      const now = new Date(Date.UTC(2026, 10, 20, h));
      for (const f of ['each_shift', 'daily', 'weekly', 'monthly']) expect(periodKey(f, now, TZ)).toBe(legacyPeriodKey(f, now));
    }
  });
  ```
  `legacyPeriodKey` is today's `config.js:173-190`, copied into the test file verbatim, with `new Date()` replaced by the `now` parameter.
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/unit/shopTime.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement `shopTime.js`.** Compute the local date parts with `Intl.DateTimeFormat(…, { timeZone: tz })`, and the ISO week from those parts.
- [ ] **Step 4: Run the tests again.**
  - Run: `npx vitest run tests/unit/shopTime.test.js`
  - Expected: PASS, 7 tests.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/lib/time tests/unit/shopTime.test.js
  git commit -m "feat: shop-time period keys, due days and greeting"
  ```

### Task 8: Supabase client and the session data layer

**Files:**
- Create:
  - `src/lib/config/load.js`
  - `src/lib/data/client.js`
  - `src/lib/data/session.js`
  - `src/lib/data/settings.js`
  - `src/lib/auth/passwordRules.js`
  - `src/lib/types.js`
  - `tests/unit/passwordRules.test.js`
  - `tests/db/session.test.js`
- Modify: `tests/db/helpers.js`. Add:
  - `memoryStorage()`, a `Map` subclass with `getItem`, `setItem` and `removeItem`;
  - `practiceCfg`, a `ShopConfig` built by `parseShopConfig(process.env)`;
  - `as(who: 'avery'|'sam'|'jordan'|'riley'|'casey') => Promise<{ profile: Profile }>`. It runs `initClient(practiceCfg, { storage: memoryStorage() })`, then `signIn`, then `loadMyProfile`.

**Interfaces:**
- Consumes: `ShopConfig` (Task 5).
- Produces:
  - **Config:** `loadShopConfig(fetchFn = fetch) => Promise<ShopConfig>`. It fetches `/config.json` with `cache: 'no-store'` and throws `Error('config')` on failure.
  - **Client:**
    - `initClient(cfg: ShopConfig, opts?: { storage?: Storage }) => SupabaseClient`
    - `client() => SupabaseClient`, which throws before `initClient`.
  - **Profile type:** `/** @typedef {{ id: string, full_name: string, role: 'admin'|'staff', job_role: string|null, active: boolean, must_change_password: boolean }} Profile */`
  - **Session functions:**
    - `signIn(email: string, password: string) => Promise<{ ok: true } | { ok: false, message: string }>`. It trims and lowercases the email. If either field is empty, the message is "Enter your email and password." (today's wording).
    - `signOut() => Promise<void>`. It calls `auth.signOut({ scope: 'local' })`, then always removes the `sb-<ref>-auth-token` key from storage, even if the call threw (frontend H1).
    - `getSession() => Promise<Session|null>`
    - `loadMyProfile() => Promise<{ status: 'ok', profile: Profile } | { status: 'deactivated' } | { status: 'missing' }>`. It selects the Profile columns only. When the profile is inactive, it signs out before returning `deactivated`.
    - `changePassword(password: string) => Promise<{ ok: true } | { ok: false, message: string }>`. It updates the auth password, then `profiles.must_change_password = false`, and reports a failure of either step.
  - **Settings:** `loadAppSettings() => Promise<Record<string, string>>`, which returns `{}` on error.
  - **Password rule:** `passwordProblem(p1: string, p2: string) => string | null`, with today's messages from `change-password.html`.

- [ ] **Step 1: Write the failing unit tests** (`passwordRules.test.js`):
  ```js
  test('mismatch', () => expect(passwordProblem('Bakery123', 'Bakery124')).toBe("The two passwords don't match."));
  test('too weak', () => expect(passwordProblem('short1A', 'short1A')).toBe('Password must be 8+ chars with 3 of 4: lowercase, uppercase, number, symbol.'));
  test('three of four categories is enough', () => expect(passwordProblem('Bakery123', 'Bakery123')).toBeNull());
  ```
- [ ] **Step 2: Write the failing database tests** (`tests/db/session.test.js`). Each test uses `initClient(practiceCfg, { storage: memoryStorage() })`:
  ```js
  test('sam signs in', async () => expect(await signIn(' Sam@Practice.test ', PW)).toEqual({ ok: true }));
  test('wrong password gives a message', async () => { const r = await signIn('sam@practice.test', 'nope'); expect(r.ok).toBe(false); expect(r.message.length).toBeGreaterThan(0); });
  test('empty fields', async () => expect(await signIn('', '')).toEqual({ ok: false, message: 'Enter your email and password.' }));
  test('riley is deactivated and ends signed out', async () => {
    await signIn('riley@practice.test', PW);
    expect(await loadMyProfile()).toEqual({ status: 'deactivated' }); expect(await getSession()).toBeNull();
  });
  test('casey must change password', async () => {
    await signIn('casey@practice.test', PW);
    const r = await loadMyProfile(); expect(r.status).toBe('ok'); expect(r.profile.must_change_password).toBe(true);
  });
  test('sign-out clears the session even when the network fails', async () => {
    const storage = memoryStorage(); initClient(practiceCfg, { storage }); await signIn('sam@practice.test', PW);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await signOut(); vi.restoreAllMocks();
    expect(await getSession()).toBeNull(); expect([...storage.keys()].some(k => k.endsWith('-auth-token'))).toBe(false);
  });
  ```
- [ ] **Step 3: Run both test sets to see them fail.**
  - Run: `npx vitest run tests/unit/passwordRules.test.js && npm run test:db -- tests/db/session.test.js`
  - Expected: FAIL.
- [ ] **Step 4: Implement the files listed above.** `types.js` holds the shared JSDoc typedefs.
- [ ] **Step 5: Run both test sets again.**
  - Run: `npx vitest run tests/unit/passwordRules.test.js && npm run test:db -- tests/db/session.test.js`
  - Expected: PASS, 3 and 6 tests.
- [ ] **Step 6: Commit.**
  ```bash
  git add src/lib tests
  git commit -m "feat: Supabase client, session and password rules"
  ```

### Task 9: App shell, navigation and idle sign-out

**Files:**
- Create:
  - `src/lib/nav.js`
  - `src/lib/auth/idle.js`
  - `src/lib/data/inventory.js`
  - `src/lib/ui/TopBar.svelte`, `LogoBadge.svelte`, `NavTabs.svelte`, `NavRail.svelte`, `Sheet.svelte`, `Toast.svelte`, `toast.js`, `Button.svelte`
  - `docs/copy-to-review.md`
  - `playwright.config.js`
  - `tests/unit/nav.test.js`
  - `tests/unit/idle.test.js`
  - `tests/e2e/helpers.js`
  - `tests/e2e/shell.spec.js`
- Modify:
  - `src/routes/+layout.svelte`
  - `package.json`: add `@playwright/test`, `@axe-core/playwright`, `@lucide/svelte` and `wrangler`. Add `"test:e2e": "playwright test"`.
  - `.github/workflows/ci.yml`: the `db` job also runs `npx playwright install --with-deps chromium && npm run test:e2e -- --grep-invert @fresh-practice`.

**Interfaces:**
- Consumes: Tasks 5–8.
- Produces:
  - **Navigation:**
    - `/** @typedef {{ id: string, label: string, href: string, icon: string }} NavItem */`
    - `navFor(profile: Profile) => { tabs: NavItem[], more: NavItem[] }`.
  - **Idle sign-out:** `createIdleWatch({ minutes: number, warnSeconds: number, now?: () => number, onWarn: () => void, onExpire: () => void }) => { touch(): void, check(): void, stop(): void }`. It works on timestamps, so `check()` after a long sleep expires immediately.
  - **Nav badge:** `countBelow() => Promise<number>`. It counts items with `current_on_hand < threshold`, and returns 0 on error.
  - **Toasts:** `showToast(message: string, opts?: { kind?: 'ok'|'error', actionLabel?: string, onAction?: () => void }) => void`.
  - **Copy log:** `docs/copy-to-review.md` is a table with columns `| Screen | Text | Note |`, one row per new string.
  - **Playwright helper:** `signInAs(page, who: 'avery'|'sam'|'jordan'|'riley'|'casey')` in `tests/e2e/helpers.js`. It uses `PRACTICE_TEST_PASSWORD`, submits the sign-in form, and waits until the URL leaves `/sign-in` or an alert appears.
  - **Playwright server:** `webServer` is `npm run build && npx wrangler pages dev build --port 4173`. Wrangler emulates Cloudflare Pages, so `_redirects`, `_headers` and the SPA fallback behave as in production. `vite preview` would ignore them.

**Navigation (exact):**

- **Tabs for everyone:**

  | id | Label | Link |
  |---|---|---|
  | home | Home | `/` |
  | tasks | Tasks | `/old/mytasks.html` |
  | inventory | Inventory | `/old/inventory.html` |
  | recipes | Recipes | `/old/recipes.html` |
  | agenda | Agenda | `/old/events.html` |

- **Admins** also get `shopping` "Shopping" (`/old/shopping.html`) as the last tab.
- **More, admins:** Planner, Pricing (`/old/admin.html`), Expenses, Units, Company, Reports, History, Team. These are today's `ADMIN_ITEMS` labels, in today's order.
- **More, everyone:** Settings (`/old/settings.html`).
- **On a phone,** the bottom bar shows the first 4 tabs plus "More". The remaining tabs go at the top of More.
- **The rail** (900 px and wider) shows every tab plus More, with the logo badge at the top and the avatar at the bottom.
- **The account sheet** opens from the avatar button (`aria-label="Account"`). It shows the person's name, an `admin` chip for admins, and "Sign out".
- **The top bar** shows the logo badge and the shop's name.
  - With no `logoUrl`, the badge is the shop's initials on the shop color, which is ABAP's case today.
  - Laying out a wide wordmark differently comes with per-shop branding in phase 6.
- **The Inventory tab** shows the `countBelow()` badge for admins, as today.

- [ ] **Step 1: Write the failing unit tests:**
  ```js
  const staff = { role: 'staff' }, admin = { role: 'admin' };
  test('staff tabs and more', () => { const n = navFor(staff);
    expect(n.tabs.map(t => t.id)).toEqual(['home', 'tasks', 'inventory', 'recipes', 'agenda']);
    expect(n.more.map(t => t.id)).toEqual(['settings']); });
  test('admin tabs and more', () => { const n = navFor(admin);
    expect(n.tabs.map(t => t.id)).toEqual(['home', 'tasks', 'inventory', 'recipes', 'agenda', 'shopping']);
    expect(n.more.map(t => t.label)).toEqual(['Planner', 'Pricing', 'Expenses', 'Units', 'Company', 'Reports', 'History', 'Team', 'Settings']); });
  test('every unported screen points at /old/', () => navFor(admin).tabs.concat(navFor(admin).more)
    .filter(t => t.id !== 'home').forEach(t => expect(t.href).toMatch(/^\/old\/[a-z-]+\.html$/)));
  // idle.test.js
  test('expires at the limit, warns before it, survives a sleep', () => {
    let t = 0; const onWarn = vi.fn(), onExpire = vi.fn();
    const w = createIdleWatch({ minutes: 30, warnSeconds: 60, now: () => t, onWarn, onExpire });
    w.touch(); t = 28 * 60e3; w.check(); expect(onWarn).not.toHaveBeenCalled();
    t = 29 * 60e3; w.check(); expect(onWarn).toHaveBeenCalledTimes(1);
    t = 29 * 60e3 + 59e3; w.check(); expect(onExpire).not.toHaveBeenCalled();
    t = 5 * 3600e3; w.check(); expect(onExpire).toHaveBeenCalledTimes(1);   // woke from a long sleep
    w.check(); expect(onExpire).toHaveBeenCalledTimes(1);                    // once only
  });
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/unit/nav.test.js tests/unit/idle.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement `nav.js`, `idle.js` and `inventory.js`.**
- [ ] **Step 4: Run the unit tests again.**
  - Run: `npx vitest run tests/unit/nav.test.js tests/unit/idle.test.js`
  - Expected: PASS, 4 tests.
- [ ] **Step 5: Write the failing e2e tests** (`tests/e2e/shell.spec.js`):
  ```js
  test('signed-out visitors land on sign-in', async ({ page }) => { await page.goto('/'); await expect(page).toHaveURL(/\/sign-in$/); });
  test('old pages share the sign-in, and sign-out reaches both', async ({ page }) => {
    await signInAs(page, 'sam'); await page.goto('/old/inventory.html');
    await expect(page.locator('header.topbar .who')).toContainText('Sam Baker');
    await page.goto('/'); await page.getByRole('button', { name: /account/i }).click(); await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/); await page.goto('/old/inventory.html'); await expect(page).toHaveURL(/\/sign-in/);
  });
  test('a sleeping tablet is signed out when it wakes', async ({ page }) => {
    await page.clock.install(); await signInAs(page, 'sam');
    await page.clock.fastForward('31:00'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page).toHaveURL(/\/sign-in\?timeout=30/);
  });
  test('rail on a tablet, tabs on a phone', async ({ page }) => {
    await signInAs(page, 'avery');
    await page.setViewportSize({ width: 1024, height: 768 }); await expect(page.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-layout', 'rail');
    await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-layout', 'tabs');
  });
  ```
- [ ] **Step 6: Build the shell in `+layout.svelte`.** On mount:
  1. **Load the config.** `loadShopConfig()`. If it fails, show the full-screen message "Couldn't reach the server. Check your connection and reload." (today's wording) and a Reload button (frontend L13).
  2. **Theme and client.** `applyShopColor(cfg.color.hex)`, then `initClient(cfg)`.
  3. **Session check.** The public route is `/sign-in` only. With no session, go to `/sign-in`.
  4. **Profile check.** `loadMyProfile()`:
     - `deactivated`: go to `/sign-in?deactivated=1`;
     - `must_change_password`, and the route isn't `/change-password`: go to `/change-password` (frontend L7).
  5. **Shell.** Render TopBar and nav (`aria-label="Main"`, `data-layout` set to `tabs` or `rail` by the 900 px breakpoint) around the page.
  6. **Idle watch.**
     - It uses `idle_logout_minutes` (default 30) and `idle_warning_seconds` (default 60) from `loadAppSettings()`.
     - Every activity event calls `touch()`. `check()` runs every 15 s and on `visibilitychange`/`focus`.
     - The warning toast reads "You'll be signed out soon for inactivity." with the action "Stay signed in" (today's wording).
     - On expiry: `signOut()`, then go to `/sign-in?timeout=<minutes>`.
  
  Log every new string in `docs/copy-to-review.md`.
- [ ] **Step 7: Run the e2e tests.**
  - Run: `npm run test:e2e -- tests/e2e/shell.spec.js`
  - Expected: PASS, 4 tests. They need Task 10's sign-in page. If Task 10 isn't done yet, run this step at the end of Task 10.
- [ ] **Step 8: Commit.**
  ```bash
  git add -A
  git commit -m "feat: app shell, navigation, idle sign-out"
  ```

### Task 10: Sign-in and change-password screens

**Files:**
- Create:
  - `src/routes/sign-in/+page.svelte`
  - `src/routes/change-password/+page.svelte`
  - `src/lib/auth/notices.js`
  - `tests/unit/notices.test.js`
  - `tests/e2e/sign-in.spec.js`

**Interfaces:**
- Consumes: Task 8 (`signIn`, `loadMyProfile`, `changePassword`, `passwordProblem`), Task 9 (`LogoBadge`, `Button`).
- Produces: `signInNotice(params: URLSearchParams) => string | null`.

**What the screens show:**
- **Sign-in:** the logo badge, the shop's name, Email, Password and a "Sign In" button, all in one `<form>` so Enter submits.
  - While working, the button reads "Signing in…" and is disabled.
  - On success, go to `/change-password` if the flag is set, otherwise `/`.
  - Someone already signed in goes straight to `/`.
- **Change password:** heading "Set a New Password", the line "Please choose a new password to continue.", two fields, the rule text, and "Save & Continue". All of it is today's wording.

- [ ] **Step 1: Write the failing tests:**
  ```js
  test('timeout uses the real minutes', () => expect(signInNotice(new URLSearchParams('timeout=45')))
    .toBe('You were signed out after 45 minutes of inactivity. Please sign in again.'));
  test('deactivated', () => expect(signInNotice(new URLSearchParams('deactivated=1')))
    .toBe('This account has been deactivated. Please speak to a manager.'));
  test('nothing', () => expect(signInNotice(new URLSearchParams(''))).toBeNull());
  // sign-in.spec.js
  test('sam lands on Home', async ({ page }) => { await signInAs(page, 'sam'); await expect(page).toHaveURL(/\/$/); });
  test('wrong password shows an error and re-enables the button', async ({ page }) => {
    await page.goto('/sign-in'); await page.getByLabel('Email').fill('sam@practice.test'); await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('alert')).not.toBeEmpty(); await expect(page.getByRole('button', { name: 'Sign In' })).toBeEnabled();
  });
  test('riley is turned away', async ({ page }) => { await signInAs(page, 'riley');
    await expect(page.getByText('This account has been deactivated. Please speak to a manager.')).toBeVisible(); });
  test('@fresh-practice casey must set a password first', async ({ page }) => {
    await signInAs(page, 'casey'); await expect(page).toHaveURL(/\/change-password$/);
    await page.goto('/'); await expect(page).toHaveURL(/\/change-password$/);       // can't skip it (frontend L7)
    await page.getByLabel('New password').fill('Fresh-Bread-2026'); await page.getByLabel('Confirm new password').fill('Fresh-Bread-2026');
    await page.getByRole('button', { name: 'Save & Continue' }).click(); await expect(page).toHaveURL(/\/$/);
  });
  ```
  The `@fresh-practice` test changes Casey's password. Run it only right after `npm run practice:reset`. CI skips it.
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/unit/notices.test.js && npm run test:e2e -- tests/e2e/sign-in.spec.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement both screens and `notices.js`.** Log any new strings.
- [ ] **Step 4: Reset the practice database, then run the tests again.**
  - Run: `npm run practice:reset && npx vitest run tests/unit/notices.test.js && npm run test:e2e -- tests/e2e/sign-in.spec.js tests/e2e/shell.spec.js`
  - Expected: PASS, 3 unit and 8 e2e tests.
- [ ] **Step 5: Commit.**
  ```bash
  git add -A
  git commit -m "feat: sign-in and change-password screens"
  ```

### Task 11: Home rules

**Files:**
- Create:
  - `src/lib/home/rules.js`
  - `tests/unit/homeRules.test.js`
- Modify: `tests/fixtures/practiceShop.js`. It's the fake shop from Task 3 as JS rows, with ids. Keep it in step with `supabase/practice/seed.sql`.

**Interfaces:**
- Consumes: `Task`, `InventoryItem`, `SpecialTask`, `EventRow` and `JobRole` typedefs, added to `src/lib/types.js` with the columns named in Task 12.
- Produces (all pure):
  - **`isBelow(item) => boolean`:** both values are non-null, and `current_on_hand < threshold`.
  - **`myChecklist(tasks, doneIds: Set<number>, role: string|null) => { done: number, total: number, nextText: string|null }`:**
    - It counts the role's tasks (all frequencies) plus the shared `each_shift` tasks.
    - Tasks are ordered by frequency (`each_shift`, `daily`, `weekly`, `monthly`), then role tasks before shared ones, then `sort_order`.
    - `nextText` is the first task in that order that isn't done.
  - **`teamChecklist(tasks, doneIds) => { done, total }`:** every active task.
  - **`teamCompletion(tasks, doneIds, jobRoles) => { key, label, done, total, pct }[]`:** in `jobRoles` order, skipping roles with no tasks. `pct` is `Math.round`.
  - **`stockCounts(items, role: string|null) => { low: number, notCounted: number }`:** the role's items, or all items when `role` is null.
  - **`inventoryHealth(items) => { inStock, below, extra }`:** `inStock` is the total minus `below`, as today.
  - **`toOrder(items, orders: Map<number, string>) => { total, ordered, toGo }`:**
    - `total` is the set of items that are below or marked order-extra.
    - `ordered` is the number of those whose order status is `'open'`.
    - `toGo` is `total` minus `ordered`.
  - **`stockValue(items) => number`:** the sum of `unit_cost × current_on_hand`, where both are non-null.
  - **`soonToOrder(projection: {id, name, days_to_threshold}[], items) => { id, name, days }[]`:** projected days from 0 to 7, excluding items that are below or order-extra. Sorted ascending, at most 5.
  - **`todayList({ eventsToday, special, role, jobRoles, now, tz }) => TodayRow[]`:**
    - `TodayRow` is `{ kind: 'event'|'count'|'special', id?: number, label: string, detail: string, done?: boolean }`.
    - The rows come in this order:
      1. events, with their `event_time`;
      2. "Inventory count", if the role has a `due_dow`. Its detail is `today` when `daysUntilDow` is 0, otherwise `shortDow(dow)`;
      3. special tasks not done, with the detail `by <Mon D>` when there's a due date.

- [ ] **Step 1: Write the failing tests against the fixture:**
  ```js
  const { tasks, done, items, orders, jobRoles, eventsToday, special, byName } = practiceShop;
  test('sam\'s checklist', () => expect(myChecklist(tasks, done, 'baker')).toEqual({ done: 2, total: 5, nextText: 'Count the till' }));
  test('no job role counts the shared shift only', () => expect(myChecklist(tasks, done, null)).toEqual({ done: 1, total: 2, nextText: 'Count the till' }));
  test('team checklist', () => expect(teamChecklist(tasks, done)).toEqual({ done: 2, total: 7 }));
  test('team completion', () => expect(teamCompletion(tasks, done, jobRoles)).toEqual([
    { key: 'baker', label: 'Baker', done: 1, total: 3, pct: 33 }, { key: 'barista', label: 'Barista', done: 0, total: 2, pct: 0 },
    { key: 'shared', label: 'Shared', done: 1, total: 2, pct: 50 }]));
  test('stock counts', () => { expect(stockCounts(items, 'baker')).toEqual({ low: 2, notCounted: 2 });
    expect(stockCounts(items, 'barista')).toEqual({ low: 1, notCounted: 1 }); expect(stockCounts(items, null)).toEqual({ low: 3, notCounted: 3 }); });
  test('health, to-order, value', () => { expect(inventoryHealth(items)).toEqual({ inStock: 5, below: 3, extra: 1 });
    expect(toOrder(items, orders)).toEqual({ total: 4, ordered: 1, toGo: 3 }); expect(stockValue(items)).toBeCloseTo(309, 6); });
  test('isBelow edges', () => { expect(isBelow({ current_on_hand: null, threshold: 5 })).toBe(false); expect(isBelow({ current_on_hand: 5, threshold: 5 })).toBe(false); });
  test('soon to order skips items already flagged', () => expect(soonToOrder([
    { id: byName.Sugar.id, name: 'Sugar', days_to_threshold: 2 }, { id: byName.Flour.id, name: 'Flour', days_to_threshold: 1 },
    { id: byName.Cups.id, name: 'Cups', days_to_threshold: 9 }, { id: byName.Yeast.id, name: 'Yeast', days_to_threshold: 0 }], items))
    .toEqual([{ id: byName.Yeast.id, name: 'Yeast', days: 0 }, { id: byName.Sugar.id, name: 'Sugar', days: 2 }]));
  test('sam\'s Today on a Sunday', () => { const rows = todayList({ eventsToday, special, role: 'baker', jobRoles,
      now: new Date('2026-11-22T18:00:00Z'), tz: 'America/Chicago' });
    expect(rows.slice(0, 2)).toEqual([{ kind: 'event', id: eventsToday[0].id, label: 'Catering pickup', detail: '2:00 pm' },
      { kind: 'count', label: 'Inventory count', detail: 'Wed' }]);
    expect(rows.filter(r => r.kind === 'special').map(r => r.label)).toEqual(['Restock napkins', 'Call the flour vendor']); });
  test('jordan has no count day', () => expect(todayList({ eventsToday: [], special: [], role: 'barista', jobRoles,
    now: new Date(), tz: 'America/Chicago' })).toEqual([]));
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npx vitest run tests/unit/homeRules.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement `rules.js`.**
- [ ] **Step 4: Run the tests again.**
  - Run: `npx vitest run tests/unit/homeRules.test.js`
  - Expected: PASS, 10 tests.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/lib/home/rules.js src/lib/types.js tests
  git commit -m "feat: Home rules"
  ```

### Task 12: Home data layer

**Files:**
- Create:
  - `src/lib/data/home.js`
  - `src/lib/data/specialTasks.js`
  - `src/lib/data/shiftNote.js`
  - `src/lib/data/live.js`
  - `tests/db/home.test.js`

**Interfaces:**
- Consumes: `client()` (Task 8), `periodKey`/`todayISO` (Task 7), the typedefs (Task 11).
- Produces:
  - **`loadHome({ profile, timeZone, now = new Date() }) => Promise<HomeData>`.** It throws `Error('home')` if any query fails. It first calls the `clear_expired_special_tasks` RPC and ignores that call's error, as today. `HomeData` is:

    | Field | Source |
    |---|---|
    | `tasks` | `id, owner, text, frequency, sort_order, area, shift_part`, where `active` |
    | `doneIds` | `task_completions.task_id` for each frequency's current `periodKey` |
    | `items` | staff: `id, name, owner, category, current_on_hand, threshold, order_extra, counted_this_week`. Admins get `unit_cost` too. |
    | `orders` | `Map` of `item_id` → `status`, for `open` and `needs_reorder` |
    | `special` | `id, text, due_date, done, created_at`, ordered by `due_date` (nulls last), then `created_at` |
    | `note` | `{ body, updatedAt, updatedByName }` or null. The name comes from `profiles.full_name`. |
    | `eventsToday` | `id, title, event_time, location`, where `event_date = todayISO`, `status <> 'archived'` |
    | `jobRoles` | `key, label, assignable, due_dow, sort_order`, where `active`, ordered |
    | `projection` | admins: `v_order_projection` `id, name, days_to_threshold`. Staff: `[]`. |

  - **Special tasks:**
    - `addSpecialTask({ text: string, dueDate: string|null }) => Promise<{ error: string|null }>`
    - `setSpecialTaskDone(id: number, done: boolean) => Promise<{ error: string|null }>`. It sets `done_by` and `done_at` as today does.
    - `deleteSpecialTask(id: number) => Promise<{ error: string|null }>`
  - **Shift note:**
    - `saveShiftNote(body: string) => Promise<{ error: string|null }>`. It updates the `shift_note` row with id 1 (`updated_by`, `updated_at`). When the body isn't blank, it also inserts into `shift_note_history`. A failure of either is an error.
    - `clearShiftNote() => Promise<{ error: string|null }>`
  - **Live updates:** `watchTables(tables: string[], onChange: () => void, { debounceMs = 400 } = {}) => () => void`. It debounces realtime events. It also calls `onChange` when the page becomes visible and when the channel re-subscribes after an error (frontend M10).

- [ ] **Step 1: Write the failing database tests:**
  ```js
  test('staff Home carries no money columns', async () => { const { profile } = await as('sam');
    const h = await loadHome({ profile, timeZone: TZ });
    expect(h.items).toHaveLength(8); expect(h.items.some(i => Object.hasOwn(i, 'unit_cost'))).toBe(false);
    expect(h.tasks).toHaveLength(7); expect(h.projection).toEqual([]); expect(h.eventsToday.map(e => e.title)).toEqual(['Catering pickup']);
    expect(h.note).toMatchObject({ body: 'Oven 2 runs hot. Rotate the trays at ten minutes.', updatedByName: 'Jordan Barista' });
    expect([...h.doneIds].length).toBe(2); });
  test('admin Home has costs and a projection', async () => { const { profile } = await as('avery');
    const h = await loadHome({ profile, timeZone: TZ });
    expect(h.items.every(i => Object.hasOwn(i, 'unit_cost'))).toBe(true); expect(Array.isArray(h.projection)).toBe(true); });
  test('special task round trip', async () => {
    await as('avery'); expect(await addSpecialTask({ text: 'Test: wipe menu board', dueDate: null })).toEqual({ error: null });
    let h = await loadHome({ profile: (await as('sam')).profile, timeZone: TZ }); const t = h.special.find(s => s.text === 'Test: wipe menu board');
    expect(await setSpecialTaskDone(t.id, true)).toEqual({ error: null });
    await as('avery'); expect(await deleteSpecialTask(t.id)).toEqual({ error: null });
  });
  test('shift note save writes history; restored after', async () => { await as('sam');
    expect(await saveShiftNote('Test note')).toEqual({ error: null });
    expect((await loadHome({ profile: (await as('sam')).profile, timeZone: TZ })).note.body).toBe('Test note');
    await saveShiftNote('Oven 2 runs hot. Rotate the trays at ten minutes.'); });
  test('offline writes report an error', async () => { await as('sam');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const r = await setSpecialTaskDone(1, true); vi.restoreAllMocks(); expect(r.error).toEqual(expect.any(String)); });
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npm run test:db -- tests/db/home.test.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement the four data modules.**
- [ ] **Step 4: Run the tests again.**
  - Run: `npm run test:db -- tests/db/home.test.js`
  - Expected: PASS, 5 tests.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/lib/data tests/db/home.test.js
  git commit -m "feat: Home data layer with error reporting and live refresh"
  ```

### Task 13: Home screen

**Files:**
- Create:
  - `src/lib/ui/Card.svelte`, `Ring.svelte`, `Stat.svelte`, `ListRow.svelte`, `ConfirmDialog.svelte`
  - `src/lib/home/RingCard.svelte`, `StatPair.svelte`, `TodayCard.svelte`, `SpecialTaskRow.svelte`, `SpecialTasksCard.svelte`, `ShiftNoteCard.svelte`, `TeamCompletionCard.svelte`, `InventoryHealthCard.svelte`, `StockValueCard.svelte`, `ToOrderCard.svelte`, `SoonToOrderCard.svelte`
  - `tests/e2e/home.spec.js`
- Modify:
  - `src/routes/+page.svelte`
  - `docs/copy-to-review.md`

**Interfaces:**
- Consumes: Task 11's rules and Task 12's data functions. Also `greeting`/`dayLine` (Task 7) and `showToast` (Task 9).
- Produces: the Home route. Nothing later depends on its internals.

**What Home shows:**
- **Order for staff:**
  1. greeting ("Good morning, Sam") and day line;
  2. RingCard from `myChecklist`: "2 / 5", "My checklist · 3 left", "Next: Count the till", and the link "Open tasks" to `/old/mytasks.html`;
  3. StatPair: "low on stock" (red, with a warning icon) linking to `/old/inventory.html?filter=below`, and "not counted" (amber) linking to `/old/inventory.html`;
  4. TodayCard, where special rows have a checkbox;
  5. ShiftNoteCard.
- **Order for admins:**
  1. greeting;
  2. RingCard from `teamChecklist`, labelled "Team checklist";
  3. TeamCompletionCard;
  4. InventoryHealthCard;
  5. StockValueCard;
  6. ToOrderCard;
  7. SoonToOrderCard;
  8. SpecialTasksCard;
  9. ShiftNoteCard.
- **Card details:**
  - **InventoryHealthCard:** three counts with a stacked SVG bar, each linking to today's `inventory.html` filters. There's no chart library.
  - **StockValueCard:** `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`, linking to `/old/reports.html`.
  - **ToOrderCard:** links to `/old/shopping.html`.
  - **SpecialTasksCard:** an add field and optional date, and delete through ConfirmDialog.
  - **ShiftNoteCard:** the quote in Fraunces italic and "Name · <relative time>". "Edit" opens a Sheet with a textarea, "Clear" and "Save note".
- **Today's wording to keep:**
  - "Shift note", "Special tasks", "Add a special task…"
  - "Nothing special today. 🌿", "No special tasks posted.", "No note right now."
  - "Team completion", "Inventory health", "In stock", "Below", "Order extra"
  - "Stock value", "current inventory on hand"
  - "Shopping list", "still to order", "Nothing to order — shelves look good."
  - "Likely to order soon", "Nothing projected to run low this week.", "Gets smarter as counts build up."
  - "Save note", "Clear"
- **Saving:**
  - Toggles and saves update the screen at once.
  - On `{ error }`, they roll back and toast "Couldn't save. Check your connection and try again." (new; log it).
  - The note sheet shows "Saved" only after a successful save (frontend H8).
- **Live:** `watchTables(['task_completions', 'inventory_items', 'order_log', 'special_tasks', 'shift_note', 'tasks', 'events'], reload)`, stopped on destroy. A reload never replaces the text in an open sheet or the add field.
- **Layout:** one column on a phone. From 900 px, a two-column CSS grid (no masonry script, which fixes frontend M4).
- **Hooks the e2e tests use:**
  - test ids `stat-low`, `stat-not-counted`, `to-order-to-go` and `team-<role key>`;
  - each special-task checkbox's accessible name is its text;
  - the note's edit button is labelled "Edit shift note".

- [ ] **Step 1: Write the failing e2e tests:**
  ```js
  test('sam\'s Home', async ({ page }) => { await signInAs(page, 'sam');
    await expect(page.getByText('2 / 5')).toBeVisible(); await expect(page.getByText('Next: Count the till')).toBeVisible();
    await expect(page.getByTestId('stat-low')).toHaveText(/2/); await expect(page.getByTestId('stat-not-counted')).toHaveText(/2/);
    await expect(page.getByText('Catering pickup')).toBeVisible();
    await expect(page.getByText('Oven 2 runs hot. Rotate the trays at ten minutes.')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('$'); });
  test('avery\'s Home', async ({ page }) => { await signInAs(page, 'avery');
    await expect(page.getByText('2 / 7')).toBeVisible(); await expect(page.getByText('$309.00')).toBeVisible();
    await expect(page.getByTestId('to-order-to-go')).toHaveText('3'); await expect(page.getByTestId('team-baker')).toContainText('1/3'); });
  test('an offline tick rolls back and says so', async ({ page, context }) => { await signInAs(page, 'sam');
    const box = page.getByRole('checkbox', { name: 'Restock napkins' }); await context.setOffline(true); await box.check();
    await expect(page.getByText("Couldn't save. Check your connection and try again.")).toBeVisible(); await expect(box).not.toBeChecked();
    await context.setOffline(false); });
  test('shift note edit, then restore', async ({ page }) => { await signInAs(page, 'sam');
    await page.getByRole('button', { name: 'Edit shift note' }).click(); await page.getByRole('textbox').fill('E2E note');
    await page.getByRole('button', { name: 'Save note' }).click(); await expect(page.getByText('E2E note')).toBeVisible();
    await page.getByRole('button', { name: 'Edit shift note' }).click(); await page.getByRole('textbox').fill('Oven 2 runs hot. Rotate the trays at ten minutes.');
    await page.getByRole('button', { name: 'Save note' }).click(); });
  for (const scheme of ['light', 'dark']) test(`Home passes axe in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme }); await signInAs(page, 'avery');
    if (scheme === 'dark') await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 18, 15)');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]); });
  ```
- [ ] **Step 2: Run them to see them fail.**
  - Run: `npm run test:e2e -- tests/e2e/home.spec.js`
  - Expected: FAIL.
- [ ] **Step 3: Implement the components and the Home route.** Log the new strings.
- [ ] **Step 4: Run every check.**
  - Run: `npm run check && npm test && npm run test:db && npm run test:e2e`
  - Expected: all PASS, 0 `svelte-check` errors.
- [ ] **Step 5: Commit.**
  ```bash
  git add -A
  git commit -m "feat: Home screen"
  ```

### Task 14: First release to ABAP

**Files:**
- Modify: `docs/copy-to-review.md` (check it's complete).

**Interfaces:**
- Consumes: Tasks 1–13 and the Cloudflare variables from Task 5, step 6.

- [ ] **Step 1: Run the full suite from a fresh practice database.**
  - Run: `npm run practice:reset && npm run check && npm test && npm run test:db && npm run test:e2e`
  - Expected: all PASS.
- [ ] **Step 2: Push `new-app`** (owner's go-ahead). The owner tries the preview address on a phone and on the shop tablet, signed in as `avery@practice.test` and `sam@practice.test`. On the preview, check:
  - Home in both modes;
  - an old screen opening without a second sign-in;
  - sign-out.
- [ ] **Step 3: Owner's go-ahead to publish.** Merge `new-app` into `main` and push. Cloudflare builds production with ABAP's variables.
- [ ] **Step 4: Verify on the live address.**
  - Run: `curl -s https://dashboard.abapbakery.com/config.json`. Expected: `"name":"ABAP Bakery"` and `"practice":false`.
  - Run: `curl -sI https://dashboard.abapbakery.com/inventory.html | grep -i "^location"`. Expected: `location: /old/inventory.html`.
  - The owner signs in with their own account. They see the new Home with ABAP's data, then open Recipes (an old page) without signing in again.
- [ ] **Step 5: If anything is badly wrong, roll back** in Cloudflare Pages → Deployments: pick the previous production deployment, then "Rollback". Phase 1 changes no database, so this is clean and instant.
- [ ] **Step 6: Next plan.** Write the phase 2 plan (database security fixes and the old-page column patch), then the phase 3 port plans, starting with Tasks and Inventory count.
