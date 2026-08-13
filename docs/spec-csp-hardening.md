# Spec — CSP and event delegation, target state

**They are one job in two halves.** Event delegation removes inline handlers so
that CSP can drop `'unsafe-inline'` from `script-src`. Delegation on its own is
just cleaner code. CSP on its own can only contain damage, because the injected
payload still executes. The security comes from the pair.

Primary defence is the escaping already in place (`supabase/SECURITY-AUDIT.md`).
This is the backstop for the code written *next month* that forgets `esc()` —
which is the realistic failure mode, not today's code.

---

## Target policy

Delivered as **HTTP headers**, not a `<meta>` tag. `frame-ancestors` and
`report-uri` are ignored in meta, and those are two of the more useful
directives. Netlify and Cloudflare Pages both read a `_headers` file, and
List 5 §5 already moves off GitHub Pages for subdomain routing.

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co;
  img-src 'self' data:;
  object-src 'none';
  base-uri 'none';
  form-action 'self';
  frame-ancestors 'none';
```

### Why `script-src 'self'` is achievable

There are 16 references to `cdn.jsdelivr.net` — `supabase-js` on every page and
`chart.js` loaded dynamically by the dashboard. **Vendor both into the repo.**
That gets `script-src` down to `'self'` with no CDN allowlist, and it is also a
resilience win: the app stops depending on jsdelivr being reachable from shop
wifi. Two files, pinned to a known version, updated deliberately.

### Why `style-src` keeps `'unsafe-inline'` — permanently

There are **345 inline `style="…"` attributes** across the pages. Removing them
means converting every one to a class, which is a far larger and purely
cosmetic refactor than the handler work, with no comparable payoff: CSS
injection is a real vector but a much weaker one than script execution.

Strict `script-src` with permissive `style-src` is a normal, defensible place
to land. Don't treat "no `'unsafe-inline'` anywhere" as the goal — it isn't
worth what it costs here.

### Two things that will silently break if missed

**`wss://` in `connect-src`.** Realtime went live in migration 001. Omitting
the websocket scheme kills live updates across devices, and it fails quietly —
`subscribeToChanges()` swallows the error in a `try/catch`, exactly as it did
during the year realtime wasn't enabled at all.

**`https://zenquotes.io`.** The dashboard fetches a daily quote from it. Either
allowlist it in `connect-src` or drop the feature — it already has a local
fallback (`fallbackLine()`), so dropping it costs nothing but the variety.

---

## Event delegation — the shape

153 inline handlers: 102 `onclick`, 45 `onchange`, plus a handful of others.
Heaviest in `inventory.html` (26), `admin.html` (24), `dashboard.html` (19).

Replace with a single document-level listener reading `data-action`:

```html
<!-- before -->
<button onclick="setExtra(12, true)">Order extra</button>

<!-- after -->
<button data-action="set-extra" data-id="12" data-on="true">Order extra</button>
```

```js
// once, in config.js
const ACTIONS = {};
function onAction(name, fn) { ACTIONS[name] = fn; }
document.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});
```

Two side benefits beyond CSP:

- `jsArg()` stops being needed for handler arguments. Values travel in `data-`
  attributes, escaped once by `attr()`, and are read back as strings — the
  attribute-breakout bug found in `team.html` and `recipes.html` becomes
  structurally impossible rather than something to remember.
- Rendering large lists gets faster: one listener instead of a handler per row.

---

## Sequence

Bundled with the build-step work in List 5 §5, because dropping `'unsafe-inline'`
also requires extracting the 14 inline `<script>` blocks into external `.js`
files — which the per-shop build pipeline needs anyway. Doing that extraction
once, for both reasons, is materially less risk than doing it twice.

1. **Report-only CSP now.** Ship the target policy as
   `Content-Security-Policy-Report-Only`. Nothing is blocked, nothing can
   break, and the console tells you exactly what would fail. Zero-risk way to
   find surprises before they matter.
2. **Delegation helper into `config.js`.** New code uses it immediately.
3. **Convert file by file** during the build-step work, verifying against the
   report-only violations as each one lands.
4. **Vendor `supabase-js` and `chart.js`.**
5. **Extract inline `<script>` blocks** to external files (build step).
6. **Switch report-only to enforcing.**

Steps 1 and 2 are cheap and carry no regression risk. Steps 3–5 are the real
work and belong with the build pipeline. Step 6 is a one-line change once the
report-only console has been quiet for a week.
