// Bottom tab bar (mobile) / left rail (desktop).
// Same order for everyone: Dashboard, Tasks, Inventory.
// Admin extras appended at the END: Reports, Team.
function renderNav(active, isAdmin) {
  const tabs = [
    { id: "dashboard", href: "dashboard.html", ico: "◉", label: "Dashboard" },
    { id: "mytasks",   href: "mytasks.html",   ico: "☰", label: "Tasks" },
    { id: "inventory", href: "inventory.html", ico: "▦", label: "Inventory" },
    { id: "recipes",   href: "recipes.html",   ico: "❦", label: "Recipes" },
    { id: "events",    href: "events.html",    ico: "◈", label: "Agenda" },
  ];
  if (isAdmin) {
    tabs.push({ id: "shopping", href: "shopping.html", ico: "▤", label: "Shopping" });
  }
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="${t.id === active ? "active" : ""}">
       <span class="ico">${t.ico}</span>${t.label}
     </a>`).join("");

  // Admin: group the occasional tools (Reports, Team) under a "More" menu
  if (isAdmin) {
    const moreActive = (active === "reports" || active === "team") ? "active" : "";
    const more = document.createElement("a");
    more.href = "#";
    more.className = moreActive;
    more.innerHTML = `<span class="ico">⋯</span>More`;
    more.onclick = (e) => { e.preventDefault(); toggleMoreMenu(); };
    nav.appendChild(more);
  }
  document.body.appendChild(nav);
  if (isAdmin) addBelowBadge();
}

function toggleMoreMenu() {
  let menu = document.getElementById("moreMenu");
  if (menu) { menu.remove(); return; }
  menu = document.createElement("div");
  menu.id = "moreMenu";
  menu.style.cssText =
    "position:fixed;right:12px;bottom:70px;background:#fff;border:1px solid var(--line);"+
    "border-radius:14px;box-shadow:0 8px 30px rgba(61,46,35,.18);z-index:50;overflow:hidden;min-width:160px";
  menu.innerHTML = `
    <a href="reports.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso);border-bottom:1px solid var(--line)"><span>$</span> Reports</a>
    <a href="team.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso)"><span>☺</span> Manage Team</a>`;
  document.body.appendChild(menu);
  // close when tapping elsewhere
  setTimeout(() => {
    document.addEventListener("click", function closeMenu(e){
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("click", closeMenu); }
    });
  }, 0);
}

async function addBelowBadge() {
  try {
    const { data } = await sb.from("inventory_items").select("current_on_hand,threshold");
    const below = (data||[]).filter(i =>
      i.current_on_hand != null && i.threshold != null && Number(i.current_on_hand) < Number(i.threshold)).length;
    if (!below) return;
    const link = document.querySelector('nav.tabs a[href="inventory.html"]');
    if (link) {
      const b = document.createElement("span");
      b.className = "nav-badge";
      b.textContent = below;
      link.appendChild(b);
    }
  } catch (e) {}
}

async function renderTopbar(title, prof) {
  prof = prof || await getMyProfile();
  const bar = document.createElement("header");
  bar.className = "topbar";
  const roleTag = prof && prof.role === "admin" ? `<span class="rolechip">admin</span>` : "";
  bar.innerHTML = `
    <div>
      <h1>${title}</h1>
      <div class="who">${prof ? prof.full_name : ""} ${roleTag}</div>
    </div>
    <button class="secondary" onclick="signOut()" style="padding:8px 12px;font-size:13px">Sign out</button>`;
  document.body.prepend(bar);
}

// ---- Pull-to-refresh (touch): swipe down at top of page to reload ----
(function initPullToRefresh(){
  let startY = 0, pulling = false, indicator = null;
  const THRESHOLD = 70;

  function ensureIndicator(){
    if (indicator) return indicator;
    indicator = document.createElement("div");
    indicator.style.cssText =
      "position:fixed;top:0;left:0;right:0;display:flex;align-items:center;justify-content:center;"+
      "height:0;overflow:hidden;background:transparent;color:#6B4F3A;font-size:13px;font-weight:700;"+
      "z-index:9999;transition:height .15s;pointer-events:none;font-family:sans-serif";
    indicator.textContent = "↓ Pull to refresh";
    document.body.appendChild(indicator);
    return indicator;
  }

  window.addEventListener("touchstart", (e) => {
    // don't interfere with an active card drag
    if (window.__dragging) { pulling = false; return; }
    // only start a pull if already scrolled to the very top
    if (window.scrollY <= 0 && e.touches.length === 1) {
      startY = e.touches[0].clientY;
      pulling = true;
    } else {
      pulling = false;
    }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      const ind = ensureIndicator();
      const h = Math.min(dy, THRESHOLD + 20);
      ind.style.height = h + "px";
      ind.textContent = dy > THRESHOLD ? "↻ Release to refresh" : "↓ Pull to refresh";
    }
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!pulling) return;
    const dy = (e.changedTouches[0].clientY) - startY;
    const ind = ensureIndicator();
    if (dy > THRESHOLD) {
      ind.style.height = "44px";
      ind.textContent = "↻ Refreshing…";
      location.reload();
    } else {
      ind.style.height = "0px";
    }
    pulling = false;
  }, { passive: true });
})();
