// ============================================================
// ABAP Bakery App — Supabase connection
// This is the ONLY file with your keys. Safe to publish:
// the publishable key is designed to be public, and your data
// is protected by Row-Level Security in Supabase.
// ============================================================

const SUPABASE_URL = "https://hdyyffeameoxocwvirdl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_e7jEPd_j-SksoDDs3mGAqA_djkuqxBt";

// Create the shared client (loaded from the CDN script in each HTML page)
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ============================================================
// HTML escaping — read this before writing any innerHTML.
//
// Most values we render come from the database, and several tables
// are writable by any signed-in staff member (inventory_items,
// special_tasks, shift_note, events, and your own profiles row).
// Dropping one of those straight into innerHTML means a staff member
// can run script inside an ADMIN's session. That's the whole ballgame.
//
//   esc()    text, and values inside a quoted attribute
//   attr()   same thing; use it when the intent is an attribute
//   jsArg()  a value being passed to an inline onclick/onchange
//   h``      tagged template that escapes every ${} automatically
//
// New code should use h``. It is safe by default, which matters more
// than brevity — you cannot forget to call something you aren't calling.
// Existing pages are being converted file by file.
// ============================================================

function esc(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Alias. `attr(x)` reads better than `esc(x)` inside value="...".
// Always keep attributes quoted — unquoted attributes are not safe
// with this (or any) escaper.
const attr = esc;

// For a value crossing into JavaScript inside an HTML attribute, e.g.
//   onclick="pick(${jsArg(name)})"
// HTML-escaping alone is not enough there: the browser HTML-decodes the
// attribute and THEN parses it as JS, so a quote in the data would break
// out. JSON-encode first, then HTML-escape the result.
function jsArg(v) {
  return esc(JSON.stringify(v == null ? null : String(v)));
}

// Tagged template that escapes every interpolation.
//   h`<div>${item.name}</div>`
// Nested h`` results and arrays of them pass through unescaped, so
// composition works:
//   h`<ul>${items.map(i => h`<li>${i.name}</li>`)}</ul>`
// To embed HTML you built yourself and know is safe, wrap it: raw(str).
class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}
function raw(html) { return new SafeHtml(String(html == null ? "" : html)); }
function renderValue(v) {
  if (v == null || v === false) return "";
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}
function h(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

// ============================================================
// Event delegation — use this instead of inline onclick/onchange.
//
// Inline handlers are the reason Content-Security-Policy has to allow
// 'unsafe-inline' for scripts, which is what lets an injected payload
// run at all. Every handler moved here is a step toward
// `script-src 'self'`. See docs/spec-csp-hardening.md.
//
// It also removes a whole bug class. Values travel in data- attributes
// escaped once by attr(), instead of being interpolated into a quoted
// JS string inside a quoted HTML attribute — which is exactly what was
// exploitable in team.html and recipes.html.
//
//   // markup
//   `<button data-action="set-extra" data-id="${attr(it.id)}">Order extra</button>`
//   `<select data-change="set-job" data-id="${attr(u.id)}">…</select>`
//
//   // once per page, after the functions exist
//   onAction("set-extra", el => setExtra(Number(el.dataset.id)));
//   onChangeAction("set-job", el => setJob(el.dataset.id, el.value));
//
// One listener per event type for the whole document, so re-rendering a
// list doesn't re-bind anything and large lists get cheaper, not dearer.
// ============================================================

const _actions = {
  click:  Object.create(null),
  change: Object.create(null),
  input:  Object.create(null),
};

function onAction(name, fn)       { _actions.click[name]  = fn; }
function onChangeAction(name, fn) { _actions.change[name] = fn; }
// `change` on a text input only fires on blur or Enter. Use this for
// filter/search boxes that should react as the user types. Note that the
// handler must NOT re-render the element it is reading from, or focus and
// caret position are lost on every keystroke — re-render only the results.
function onInputAction(name, fn)  { _actions.input[name]  = fn; }

function _delegate(kind, attribute) {
  return function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest("[" + attribute + "]");
    if (!el) return;
    const fn = _actions[kind][el.getAttribute(attribute)];
    if (typeof fn !== "function") return;   // unregistered name: ignore, don't throw
    fn(el, event);
  };
}

document.addEventListener("click",  _delegate("click",  "data-action"));
document.addEventListener("change", _delegate("change", "data-change"));
document.addEventListener("input",  _delegate("input",  "data-input"));

// ---- Helpers shared across pages ----

// Redirect to login if not signed in; returns the session.
async function requireLogin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  // Job roles are needed synchronously by roleLabel() and friends all over the
  // app. Fetching them here — before any page starts rendering — is what lets
  // those accessors stay synchronous.
  await Promise.all([loadJobRoles(), loadAppSettings()]);
  return session;
}

// Get the current user's profile row (name + role).
//
// Also enforces deactivation. The authoritative control is the auth-layer ban
// applied by the manage-users function — that cannot be bypassed from the
// console. But banning only stops the token being REFRESHED; an access token
// already issued stays valid until it expires (1 hour by default). This check
// closes that window on the next page load, which for a shop tablet in use is
// effectively immediate.
async function getMyProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) { console.error("getMyProfile error:", error); return null; }
  if (data && data.active === false) {
    try { await sb.auth.signOut(); } catch (e) {}
    window.location.href = "index.html?deactivated=1";
    return null;
  }
  return data;  // null if no profile row exists yet
}

// Period keys — how "done this period" is calculated.
function periodKey(frequency) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  if (frequency === "monthly") return `${y}-${m}`;
  if (frequency === "weekly") {
    // ISO week number
    const date = new Date(Date.UTC(y, now.getMonth(), now.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  // each_shift / daily
  return `${y}-${m}-${d}`;
}

// Sign out from anywhere.
async function signOut() {
  await sb.auth.signOut();
  window.location.href = "index.html";
}

// ============================================================
// Per-shop settings (app_settings table, migration 003)
//
// Loaded by requireLogin() alongside job roles. The defaults below are the
// values that used to be hardcoded here, so a shop with no rows behaves
// exactly as before.
// ============================================================

let _appSettings = null;

async function loadAppSettings() {
  if (_appSettings) return _appSettings;
  const { data, error } = await sb.from("app_settings").select("key,value");
  if (error) console.error("loadAppSettings:", error.message);
  const map = {};
  (data || []).forEach(r => { map[r.key] = r.value; });
  _appSettings = map;
  applyIdleSettings();
  return _appSettings;
}

function appSetting(key, fallback) {
  const v = _appSettings ? _appSettings[key] : undefined;
  return (v === undefined || v === null) ? fallback : v;
}

// Timings the idle watchdogs read. `let`, not `const`, because the page starts
// counting down before settings have been fetched — applyIdleSettings() then
// updates them and restarts the timers in place.
let IDLE_LOGOUT_MS = 30 * 60 * 1000;
let IDLE_WARN_MS   = 60 * 1000;
let EDIT_IDLE_MS   = 2 * 60 * 1000;
let _restartIdleTimers = null;     // assigned by initIdleLogout below

function applyIdleSettings() {
  IDLE_LOGOUT_MS = Math.max(1, Number(appSetting("idle_logout_minutes", 30))) * 60 * 1000;
  IDLE_WARN_MS   = Math.max(5, Number(appSetting("idle_warning_seconds", 60))) * 1000;
  EDIT_IDLE_MS   = Math.max(1, Number(appSetting("edit_mode_timeout_minutes", 2))) * 60 * 1000;
  if (_restartIdleTimers) _restartIdleTimers();
}

// ---- Auto-logout after a period of inactivity ----
// Resets on any real user activity. Warns shortly before logging out.
(function initIdleLogout(){
  let idleTimer, warnTimer, warnEl;

  function doLogout(){
    try { sb.auth.signOut(); } catch(e){}
    window.location.href = "index.html?timeout=1";
  }
  function showWarning(){
    if (warnEl) return;
    warnEl = document.createElement("div");
    warnEl.style.cssText =
      "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#3D2E23;color:#fff;"+
      "padding:12px 18px;border-radius:12px;z-index:9999;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:center;max-width:90%";
    warnEl.innerHTML = "You'll be signed out soon for inactivity.<br><button style='margin-top:8px;background:#E0A43B;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer'>Stay signed in</button>";
    warnEl.querySelector("button").onclick = reset;
    document.body.appendChild(warnEl);
  }
  function clearWarning(){ if (warnEl){ warnEl.remove(); warnEl=null; } }

  function reset(){
    clearTimeout(idleTimer); clearTimeout(warnTimer); clearWarning();
    warnTimer = setTimeout(showWarning, Math.max(0, IDLE_LOGOUT_MS - IDLE_WARN_MS));
    idleTimer = setTimeout(doLogout, IDLE_LOGOUT_MS);
  }
  // Let applyIdleSettings() restart these once the real timings are known.
  _restartIdleTimers = reset;

  let lastReset = 0;
  function onActivity(){
    const now = Date.now();
    if (warnEl) clearWarning();
    // throttle: only actually reset the timers at most once every 5s
    if (now - lastReset < 5000) return;
    lastReset = now;
    reset();
  }
  ["click","keydown","mousemove","scroll","touchstart","pointerdown"].forEach(ev =>
    window.addEventListener(ev, onActivity, { passive:true })
  );
  // start once the page loads
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reset);
  else reset();
})();

// ============================================================
// Job roles — loaded from the job_roles table, not hardcoded.
//
// These used to be three literals ("baker", "barista", "cleaning") plus a
// fallback that matched employee names. That worked for one bakery and makes
// no sense for a coffee shop. Migration 002 moved them into the database and
// backfilled the name matching as a one-time data fix.
//
// The table is fetched ONCE by requireLogin(), before any page renders, so
// every accessor below stays synchronous and the 20-odd existing call sites
// did not have to become async.
// ============================================================

let _jobRoles = null;

async function loadJobRoles() {
  if (_jobRoles) return _jobRoles;
  const { data, error } = await sb.from("job_roles")
    .select("*").eq("active", true).order("sort_order");
  if (error) {
    // Don't leave the app in a half-rendered state if this one query fails —
    // an empty list degrades to raw keys rather than throwing.
    console.error("loadJobRoles:", error.message);
    _jobRoles = [];
  } else {
    _jobRoles = data || [];
  }
  return _jobRoles;
}

// All roles including 'shared'. Use for task/inventory ownership.
function jobRoles() { return _jobRoles || []; }

// Roles a person can actually hold — excludes 'shared'.
function assignableRoles() { return jobRoles().filter(r => r.assignable); }

// Key arrays, replacing the old `ROLES` constant.
function roleKeys()  { return assignableRoles().map(r => r.key); }
function ownerKeys() { return jobRoles().map(r => r.key); }

function roleRow(key) { return jobRoles().find(r => r.key === key) || null; }

// Falls back to title-casing the key so an unknown value still reads sensibly
// rather than rendering blank.
function roleLabel(key) {
  const r = roleRow(key);
  if (r) return r.label;
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "—";
}

// Day of week this role counts inventory, or null for "use the frequency".
function roleDueDow(key) {
  const r = roleRow(key);
  return r && r.due_dow != null ? r.due_dow : null;
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function dayName(dow) { return DAY_NAMES[dow] ?? ""; }

// Which task-set does this profile own?
// The name-matching fallback that used to live here was backfilled into the
// data by migration 002 — see that file if a staff member's list looks empty.
function profileJobRole(prof) {
  return (prof && prof.job_role) || null;
}

// ---- Admin edit mode (off by default; per-session, per-tab) ----
function editMode() { return sessionStorage.getItem("editMode") === "on"; }
function setEditMode(on) {
  sessionStorage.setItem("editMode", on ? "on" : "off");
  if (on) { startEditModeTimeout(); } else { stopEditModeTimeout(); }
}

// Edit mode auto-reverts to view-only after 2 minutes of inactivity, so an
// admin who walks away can't leave the app in an editable state.
let _editIdleTimer = null, _editLastActivity = 0;
function startEditModeTimeout() {
  stopEditModeTimeout();
  _editLastActivity = Date.now();
  const check = () => {
    if (!editMode()) { stopEditModeTimeout(); return; }
    if (Date.now() - _editLastActivity >= EDIT_IDLE_MS) {
      setEditMode(false);
      location.reload();   // drop back to view-only
      return;
    }
    _editIdleTimer = setTimeout(check, 10000);  // re-check every 10s
  };
  const bump = () => { _editLastActivity = Date.now(); };
  ["click","keydown","mousemove","scroll","touchstart","pointerdown"].forEach(ev =>
    window.addEventListener(ev, bump, { passive:true })
  );
  _editIdleTimer = setTimeout(check, 10000);
}
function stopEditModeTimeout() { if (_editIdleTimer) { clearTimeout(_editIdleTimer); _editIdleTimer = null; } }
// If a page loads already in edit mode (sessionStorage), start the watchdog.
if (typeof window !== "undefined" && editMode()) { startEditModeTimeout(); }

// Render a small edit-mode toggle into a container; calls onChange when flipped.
function editToggleHtml() {
  const on = editMode();
  return `<label class="tbtn ${on?"on extra":""}" style="margin:0">
    <input type="checkbox" ${on?"checked":""} onchange="toggleEdit(this.checked)" style="display:none">
    <span class="dot">${on?"✎":"○"}</span> ${on?"Editing ON":"View only"}
  </label>`;
}
function toggleEdit(on) { setEditMode(on); location.reload(); }

// Map of profile id -> full_name, cached per page load (for showing real names).
let _nameCache = null;
async function nameMap() {
  if (_nameCache) return _nameCache;
  const { data } = await sb.from("profiles").select("id,full_name,job_role");
  _nameCache = {};
  (data||[]).forEach(p => { _nameCache[p.id] = p; });
  return _nameCache;
}
// Given a job_role (baker/barista/cleaning), find the person's name assigned to it.
async function nameForRole(role) {
  const m = await nameMap();
  const hit = Object.values(m).find(p => p.job_role === role);
  return hit ? hit.full_name : roleLabel(role);
}

// ---- Task due dates & countdowns ----
// A role's inventory day now comes from job_roles.due_dow (migration 002).
// Roles with no fixed day fall back to the task's frequency: daily = today,
// weekly = end of week, monthly = end of month. Shared shift = today.

function nextDowDate(dow) {
  const now = new Date();
  const today = now.getDay();
  let add = (dow - today + 7) % 7;      // 0 if today is the day
  const d = new Date(now); d.setHours(23,59,0,0); d.setDate(now.getDate() + add);
  return d;
}
function endOfWeek() { return nextDowDate(0); }      // Sunday end
function endOfMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 0, 0);
  return d;
}
function endOfToday() { const d = new Date(); d.setHours(23,59,0,0); return d; }

// Return {due: Date, days: int} for a task given owner + frequency.
// `days` counts whole calendar days from today's date to the due date, minus 1,
// so at the START of the shift it reads correctly (e.g. Sun→Wed shows 3, not 4).
// Because it's based on the date (not the clock time), it stays stable all shift
// and only ticks down at midnight.
function taskDue(owner, frequency) {
  let due;
  if (frequency === "monthly") due = endOfMonth();
  else if (frequency === "weekly") {
    const dow = roleDueDow(owner);
    if (dow != null) due = nextDowDate(dow);
    else due = endOfWeek();
  } else {
    due = endOfToday();
  }
  // whole-day difference: date of due minus date of today. This reads correctly
  // at the start of the shift (Sun→Wed = 3) and, being date-based rather than
  // clock-based, stays stable all shift and only ticks down at midnight.
  const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
  const startOfDue = new Date(due); startOfDue.setHours(0,0,0,0);
  const days = Math.max(0, Math.round((startOfDue - startOfToday) / 86400000));
  return { due, days };
}

// Human countdown label.
function countdownLabel(days) {
  if (days <= 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `${days} days`;
}

// ---- Kitchen-friendly amounts ----
// Scaling produces numbers like 0.375 or 2.6666667. Nobody measures those.
// Snap to the fractions a kitchen actually has spoons and cups for, and fall
// back to a rounded decimal when the value isn't near one — better an honest
// "2.67" than a confidently wrong "2 2/3" on something that needs precision.
const KITCHEN_FRACTIONS = [
  [1,8],[1,6],[1,5],[1,4],[1,3],[3,8],[2,5],[1,2],
  [3,5],[5,8],[2,3],[3,4],[4,5],[5,6],[7,8],
];

function formatAmount(n) {
  if (n == null || n === "" || !isFinite(Number(n))) return "";
  const v = Number(n);
  if (v === 0) return "0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const whole = Math.floor(abs);
  const frac = abs - whole;

  if (frac < 0.02) return sign + String(whole);

  let best = null, bestErr = Infinity;
  for (const [num, den] of KITCHEN_FRACTIONS) {
    const err = Math.abs(frac - num / den);
    if (err < bestErr) { bestErr = err; best = [num, den]; }
  }
  // More than ~2.5% off the nearest usable fraction: show a decimal instead.
  if (bestErr > 0.025) {
    const dec = abs < 10 ? Math.round(abs * 100) / 100 : Math.round(abs * 10) / 10;
    return sign + String(dec);
  }
  const [num, den] = best;
  return sign + (whole ? whole + " " : "") + num + "/" + den;
}

// ---- Measurement-aware quantities ----
// A pound and a teaspoon do not want the same treatment:
//   weight  measured on a scale — decimals are natural and precise.
//           "1.33 lb" is easier to act on than "1 1/3 lb".
//   volume  measured with spoons and cups — fractions are the real form.
//           "3/8 tsp" beats "0.375 tsp".
//   count   whole things. You can't use 4.5 eggs, so say what it rounds to
//           and let the baker decide rather than silently rounding.
//
// units.kind is the source of truth. But recipe_ingredients.unit is free text,
// so real data contains "Tbsp", "tablespoon", "eggs" — none guaranteed to
// match a units.code. Hence the fallback word list.

let _units = null;

async function loadUnits() {
  if (_units) return _units;
  const { data, error } = await sb.from("units")
    .select("code,label,kind,to_base,is_pack").eq("active", true);
  if (error) { console.error("loadUnits:", error.message); _units = []; }
  else _units = data || [];
  return _units;
}

function unitInfo(code) {
  if (!code) return null;
  const c = String(code).trim().toLowerCase();
  const list = _units || [];
  return list.find(u => (u.code || "").toLowerCase() === c)
      || list.find(u => (u.label || "").toLowerCase() === c)
      || null;
}

const UNIT_KIND_HINTS = {
  weight: ["lb","lbs","pound","pounds","oz","ounce","ounces","g","gram","grams","kg","kilo","kilogram","kilograms"],
  volume: ["tsp","teaspoon","teaspoons","tbsp","tablespoon","tablespoons","cup","cups","ml","l","liter","litre","liters","litres","fl oz","floz","fluid ounce","pint","pints","quart","quarts","gal","gallon","gallons"],
  count:  ["each","ea","egg","eggs","dozen","doz","piece","pieces","sheet","sheets","loaf","loaves","pan","pans","unit","units","clove","cloves"],
};

function unitKind(code) {
  const info = unitInfo(code);
  if (info && info.kind) return info.kind;
  const c = String(code || "").trim().toLowerCase();
  if (!c) return "unknown";
  for (const kind of Object.keys(UNIT_KIND_HINTS)) {
    if (UNIT_KIND_HINTS[kind].includes(c)) return kind;
  }
  return "unknown";
}

// Returns { text, note }. `note` is a short hint shown under the amount —
// currently only used to suggest a whole number for count units.
function formatQty(n, unitCode) {
  if (n == null || n === "" || !isFinite(Number(n))) return { text: "", note: "" };
  const v = Number(n);
  const kind = unitKind(unitCode);

  if (kind === "weight") {
    const dec = Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
    return { text: String(dec), note: "" };
  }

  if (kind === "count") {
    const rounded = Math.max(1, Math.round(v));
    const isWhole = Math.abs(v - Math.round(v)) < 1e-9;
    return { text: formatAmount(v), note: isWhole ? "" : `use ${rounded}` };
  }

  // volume, packs, and anything unrecognised → kitchen fractions
  return { text: formatAmount(v), note: "" };
}

// Shared: is an item below its threshold? (single source of truth)
function isBelow(it){
  return it && it.current_on_hand != null && it.threshold != null
    && Number(it.current_on_hand) < Number(it.threshold);
}

// ---- Real-time: re-run a loader when a table changes on any device ----
// Debounced so a burst of changes causes one refresh. Safe if realtime is
// unavailable (it just no-ops). Pull-to-refresh remains as a fallback.
// By default it SKIPS the refresh while the user is typing in a field, so a
// live update can't wipe an in-progress edit.
function subscribeToChanges(tables, onChange, opts) {
  opts = opts || {};
  const debounceMs = opts.debounceMs ?? 400;
  const guardTyping = opts.guardTyping !== false;
  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (guardTyping) {
        const el = document.activeElement;
        if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) return;
      }
      try { onChange(); } catch (e) { console.error(e); }
    }, debounceMs);
  };
  try {
    const chan = sb.channel("rt_" + Math.random().toString(36).slice(2));
    (Array.isArray(tables) ? tables : [tables]).forEach(t => {
      chan.on("postgres_changes", { event: "*", schema: "public", table: t }, trigger);
    });
    chan.subscribe();
    return chan;
  } catch (e) {
    console.warn("realtime unavailable:", e && e.message);
    return null;
  }
}
