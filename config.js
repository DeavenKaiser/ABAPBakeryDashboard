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
function setEditMode(on) { sessionStorage.setItem("editMode", on ? "on" : "off"); }

// Render a small edit-mode toggle into a container; calls onChange when flipped.
function editToggleHtml() {
  const on = editMode();
  return `<label class="tbtn ${on?"on extra":""}" style="margin:0">
    <input type="checkbox" ${on?"checked":""} onchange="toggleEdit(this.checked)" style="display:none">
    <span class="dot">${on?"✏️":"🔒"}</span> ${on?"Editing ON":"View only"}
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
