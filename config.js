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

// ---- Helpers shared across pages ----

// Redirect to login if not signed in; returns the session.
async function requireLogin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

// Get the current user's profile row (name + role).
async function getMyProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) { console.error("getMyProfile error:", error); return null; }
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

// ---- Auto-logout after 30 minutes of inactivity ----
// Resets on any real user activity. Warns shortly before logging out.
(function initIdleLogout(){
  const IDLE_MS = 30 * 60 * 1000;      // 30 minutes
  const WARN_MS = 60 * 1000;           // warn 1 minute before
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
    warnTimer = setTimeout(showWarning, IDLE_MS - WARN_MS);
    idleTimer = setTimeout(doLogout, IDLE_MS);
  }

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

// Job-role vocabulary shared across screens.
const ROLES = ["baker", "barista", "cleaning"];
const JOB_ROLES = ROLES;  // alias
const ROLE_LABEL = { baker: "Baker", barista: "Barista", cleaning: "Cleaning", shared: "Shared" };
function roleLabel(r) { return ROLE_LABEL[r] || (r ? r.charAt(0).toUpperCase() + r.slice(1) : "—"); }

// Which task-set does this profile own? Prefer explicit job_role; fall back to name.
function profileJobRole(prof) {
  if (!prof) return null;
  if (prof.job_role) return prof.job_role;
  const n = (prof.full_name || "").toLowerCase();
  if (n.includes("sierra")) return "baker";
  if (n.includes("mackenzie") || n.includes("kenzie")) return "barista";
  if (n.includes("marilyn")) return "cleaning";
  return null;
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
const EDIT_IDLE_MS = 2 * 60 * 1000;
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
// Per-role inventory/task due days:
//   Baker (Sierra) → Wednesday, Barista (Mackenzie) → Saturday.
//   Cleaning (Marilyn) → by frequency (daily = today, weekly = end of week,
//   monthly = end of month). Shared shift = today.
const ROLE_DUE_DOW = { baker: 3, barista: 6 }; // 0=Sun..6=Sat

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
    if (ROLE_DUE_DOW[owner] != null) due = nextDowDate(ROLE_DUE_DOW[owner]);
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

// Shared: is an item below its threshold? (single source of truth)
function isBelow(it){
  return it && it.current_on_hand != null && it.threshold != null
    && Number(it.current_on_hand) < Number(it.threshold);
}
