// ============================================================
// ABAP Bakery — manage-users Edge Function
//
// Runs on Supabase's servers so it can hold the service-role key.
// Verifies the caller is a signed-in ADMIN, then handles:
//   list · create · delete · set_role · set_password · set_job · set_active
//
// Design notes worth knowing before editing:
//
// * Deactivation bans the auth user, it does not just flip a column.
//   A client-side "is this profile active?" check is bypassable from the
//   console. Banning stops the token being issued at all.
//
// * Deleting someone who has history is refused, not forced through.
//   Nine columns reference profiles(id) with no ON DELETE clause, so the
//   delete fails on a foreign key anyway — this turns an unreadable
//   Postgres error into an explanation and a working alternative.
//
// * Every write checks its error. The previous version returned
//   { ok: true } regardless, so a rejected CHECK constraint looked like
//   success and the UI silently showed stale values.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Origins permitted to call this function. Override per deployment with the
// ALLOWED_ORIGINS env var (comma-separated) — the per-shop rollout in
// ROADMAP List 5 will need that. Defaults cover the current deployments so
// locking this down cannot break the live site.
const DEFAULT_ORIGINS = [
  "https://dashboard.abapbakery.com",
  "https://deavenkaiser.github.io",
];

function allowedOrigins(): string[] {
  const fromEnv = Deno.env.get("ALLOWED_ORIGINS");
  if (!fromEnv) return DEFAULT_ORIGINS;
  return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowedOrigins();
  // Echo the origin only when it is on the list. An unknown origin gets no
  // CORS header at all, so the browser blocks the response.
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const VALID_ROLES = ["admin", "staff"];
// TODO: once Features #4 lands, validate against the job_roles table instead
// of this list. Kept in sync with profiles_job_role_check for now.
const VALID_JOB_ROLES = ["baker", "barista", "cleaning"];

const BAN_FOREVER = "876000h";   // ~100 years
const UNBAN = "none";

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !serviceKey) {
      return json({ error: "Function is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." }, 500);
    }

    const admin = createClient(url, serviceKey);

    // ---- 1. Identify the caller ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "No auth token." }, 401);

    const { data: { user: caller }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !caller) return json({ error: "Not signed in or token invalid." }, 401);

    // ---- 2. Confirm the caller is an admin ----
    const { data: prof, error: profErr } = await admin
      .from("profiles").select("role, active").eq("id", caller.id).maybeSingle();
    if (profErr) return json({ error: "Profile lookup failed: " + profErr.message }, 500);
    if (!prof || prof.role !== "admin") return json({ error: "Admins only." }, 403);
    if (prof.active === false) return json({ error: "This account is deactivated." }, 403);

    // ---- 3. Dispatch ----
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // How many admins are there, not counting `excludeId`? Used to make sure
    // the last admin can never be demoted, deactivated, or deleted — which
    // would leave nobody able to administer the shop, recoverable only from
    // the Supabase SQL editor.
    async function otherActiveAdmins(excludeId: string): Promise<number> {
      const { count, error } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin").eq("active", true).neq("id", excludeId);
      if (error) throw new Error("Couldn't count admins: " + error.message);
      return count ?? 0;
    }

    if (action === "list") {
      const { data: profiles, error } = await admin.from("profiles").select("*").order("full_name");
      if (error) return json({ error: error.message }, 500);
      const { data: authList } = await admin.auth.admin.listUsers();
      const authById = Object.fromEntries((authList?.users ?? []).map((u) => [u.id, u]));
      const rows = (profiles ?? []).map((p) => {
        const au = authById[p.id];
        return {
          ...p,
          email: au?.email ?? "",
          // Surface the real auth state so the UI can't disagree with it.
          banned: !!(au?.banned_until && new Date(au.banned_until) > new Date()),
          last_sign_in_at: au?.last_sign_in_at ?? null,
        };
      });
      return json({ users: rows });
    }

    if (action === "create") {
      const { email, password, full_name, role, job_role } = body;
      if (!email || !password || !full_name) {
        return json({ error: "Need email, password, and name." }, 400);
      }
      if (role && !VALID_ROLES.includes(role)) {
        return json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}.` }, 400);
      }
      if (job_role && !VALID_JOB_ROLES.includes(job_role)) {
        return json({ error: `Job must be one of: ${VALID_JOB_ROLES.join(", ")}.` }, 400);
      }
      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (error) return json({ error: error.message }, 400);

      // The handle_new_user trigger has already inserted a default profile row.
      // must_change_password is set here because the UI calls this a temporary
      // password — previously it never was, so the temporary one was permanent.
      const { error: upErr } = await admin.from("profiles")
        .update({
          full_name,
          role: role || "staff",
          job_role: job_role || null,
          active: true,
          must_change_password: true,
        })
        .eq("id", created.user.id);
      if (upErr) {
        return json({
          error: "The login was created but their profile could not be saved: " +
            upErr.message + " — set their name and role from this screen.",
        }, 500);
      }
      return json({ ok: true });
    }

    if (action === "set_role") {
      const { id, role } = body;
      if (!id || !role) return json({ error: "Need id and role." }, 400);
      if (!VALID_ROLES.includes(role)) {
        return json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}.` }, 400);
      }
      // Guard the lockout. `delete` already refused self-deletion; demoting
      // yourself was one click away and had no such check, and recovering
      // needs the SQL editor because this function requires an admin caller.
      if (id === caller.id && role !== "admin") {
        return json({ error: "You can't remove your own admin access. Ask another admin to do it." }, 400);
      }
      if (role !== "admin" && (await otherActiveAdmins(id)) === 0) {
        return json({ error: "This is the only active admin. Promote someone else first." }, 400);
      }
      const { error } = await admin.from("profiles").update({ role }).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "set_job") {
      const { id, job_role } = body;
      if (!id) return json({ error: "Need id." }, 400);
      if (job_role && !VALID_JOB_ROLES.includes(job_role)) {
        return json({ error: `Job must be one of: ${VALID_JOB_ROLES.join(", ")}.` }, 400);
      }
      const { error } = await admin.from("profiles")
        .update({ job_role: job_role || null }).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "set_password") {
      const { id, password } = body;
      if (!id || !password) return json({ error: "Need user id and password." }, 400);
      const cats = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
      if (password.length < 8 || cats < 3) {
        return json({ error: "Password must be 8+ characters and include at least 3 of: lowercase, uppercase, number, symbol." }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      const { error: flagErr } = await admin.from("profiles")
        .update({ must_change_password: true }).eq("id", id);
      if (flagErr) {
        return json({ error: "Password changed, but they won't be prompted to reset it: " + flagErr.message }, 500);
      }
      return json({ ok: true });
    }

    // ---- Deactivate / reactivate: the normal way to remove someone ----
    if (action === "set_active") {
      const { id, active } = body;
      if (!id || typeof active !== "boolean") return json({ error: "Need id and active (true/false)." }, 400);

      if (!active) {
        if (id === caller.id) {
          return json({ error: "You can't deactivate your own account." }, 400);
        }
        const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
        if (target?.role === "admin" && (await otherActiveAdmins(id)) === 0) {
          return json({ error: "This is the only active admin. Promote someone else first." }, 400);
        }
      }

      // Ban at the auth layer. profiles.active alone is only a UI hint — a
      // deactivated user with a valid token could otherwise keep working, and
      // every RLS policy is written against `authenticated`, not against
      // whether the profile is active.
      const { error: banErr } = await admin.auth.admin.updateUserById(id, {
        ban_duration: active ? UNBAN : BAN_FOREVER,
      });
      if (banErr) return json({ error: banErr.message }, 400);

      const { error } = await admin.from("profiles").update({ active }).eq("id", id);
      if (error) {
        // Roll the ban back so the two never disagree.
        await admin.auth.admin.updateUserById(id, { ban_duration: active ? BAN_FOREVER : UNBAN });
        return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      const { id } = body;
      if (!id) return json({ error: "Need a user id." }, 400);
      if (id === caller.id) return json({ error: "You can't delete yourself." }, 400);

      const { data: target } = await admin.from("profiles").select("role").eq("id", id).maybeSingle();
      if (target?.role === "admin" && (await otherActiveAdmins(id)) === 0) {
        return json({ error: "This is the only active admin. Promote someone else first." }, 400);
      }

      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        // profiles cascades from auth.users, but nine columns reference
        // profiles(id) with no ON DELETE clause — so anyone who has ever
        // completed a task or counted inventory cannot be deleted. That is
        // arguably correct: it protects the history. Say so usefully.
        if (/foreign key|violates|constraint/i.test(error.message)) {
          return json({
            error: "This person has activity on record — completed tasks, inventory counts, or orders. " +
              "Deleting them would destroy that history, so it's blocked. " +
              "Deactivate them instead: they lose access immediately and their record stays intact.",
          }, 409);
        }
        return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
