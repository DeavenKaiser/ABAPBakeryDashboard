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
