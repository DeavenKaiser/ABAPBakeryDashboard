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

  // Admin tools. On a large screen there's room to show them directly;
  // on smaller screens they collapse under a single "Admin" menu button.
  const ADMIN_ITEMS = [
    { id: "admin",    href: "admin.html",    ico: "◆", label: "Pricing" },
    { id: "expenses", href: "expenses.html", ico: "$", label: "Expenses" },
    { id: "company",  href: "company.html",  ico: "⌂", label: "Company" },
    { id: "reports",  href: "reports.html",  ico: "▤", label: "Reports" },
    { id: "team",     href: "team.html",     ico: "☺", label: "Team" },
  ];
  if (isAdmin) {
    const roomy = window.matchMedia("(min-width: 1000px) and (min-height: 640px)").matches;
    if (roomy) {
      ADMIN_ITEMS.forEach(t => {
        const a = document.createElement("a");
        a.href = t.href;
        a.className = (t.id === active ? "active" : "");
        a.innerHTML = `<span class="ico">${t.ico}</span>${t.label}`;
        nav.appendChild(a);
      });
    } else {
      const moreActive = ADMIN_ITEMS.some(t => t.id === active) ? "active" : "";
      const more = document.createElement("a");
      more.href = "#";
      more.className = moreActive;
      more.innerHTML = `<span class="ico">◆</span>Admin`;
      more.onclick = (e) => { e.preventDefault(); toggleMoreMenu(more); };
      nav.appendChild(more);
    }
  }
  document.body.appendChild(nav);
  if (isAdmin) addBelowBadge();

  // Re-render the nav if the window crosses the grouping breakpoint.
  if (isAdmin && !window.__navResizeHooked) {
    window.__navResizeHooked = true;
    let t=null;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const menu = document.getElementById("moreMenu");
        if (menu) menu.remove();
        const existing = document.querySelector("nav.tabs");
        if (existing) existing.remove();
        renderNav(active, isAdmin);
      }, 200);
    });
  }
}

function toggleMoreMenu(anchorEl) {
  let menu = document.getElementById("moreMenu");
  if (menu) { menu.remove(); return; }
  menu = document.createElement("div");
  menu.id = "moreMenu";
  menu.style.cssText =
    "position:fixed;background:#fff;border:1px solid var(--line);"+
    "border-radius:14px;box-shadow:0 8px 30px rgba(61,46,35,.18);z-index:9999;overflow:hidden;min-width:170px";
  menu.innerHTML = `
    <a href="admin.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso);border-bottom:1px solid var(--line)"><span>◆</span> Pricing Manager</a>
    <a href="expenses.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso);border-bottom:1px solid var(--line)"><span>$</span> Expenses</a>
    <a href="company.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso);border-bottom:1px solid var(--line)"><span>⌂</span> Company</a>
    <a href="reports.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso);border-bottom:1px solid var(--line)"><span>▤</span> Reports</a>
    <a href="team.html" style="display:flex;align-items:center;gap:10px;padding:14px 18px;text-decoration:none;color:var(--espresso)"><span>☺</span> Manage Team</a>`;
  document.body.appendChild(menu);

  // Position the menu next to the More button, whichever layout we're in.
  const isRail = window.matchMedia("(min-width: 1000px)").matches;
  const mh = menu.offsetHeight, mw = menu.offsetWidth;
  if (isRail && anchorEl) {
    // desktop: left rail — pop up to the right of the button, aligned to its top
    const r = anchorEl.getBoundingClientRect();
    menu.style.left = (r.right + 8) + "px";
    menu.style.top = Math.max(8, Math.min(r.top, window.innerHeight - mh - 8)) + "px";
  } else {
    // mobile: bottom bar — pop up above the button on the right
    menu.style.right = "12px";
    menu.style.bottom = "70px";
  }

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
    <div style="display:flex;align-items:center;gap:10px">
      <img src="logo.svg" alt="" style="width:34px;height:34px;flex:none" onerror="this.style.display='none'">
      <div>
        <h1>${title}</h1>
        <div class="who">${prof ? prof.full_name : ""} ${roleTag}</div>
      </div>
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

// ---- Shared filter/sort dropdown helper ----
// Toggles a dropdown menu; closes others and closes on outside click.
function fsToggle(btn){
  const drop = btn.closest(".fs-drop");
  const menu = drop.querySelector(".fs-menu");
  const isOpen = menu.style.display === "block";
  // close all open menus first
  document.querySelectorAll(".fs-menu").forEach(m=>m.style.display="none");
  if (isOpen) return;
  menu.style.display = "block";
  setTimeout(()=>{
    document.addEventListener("click", function close(e){
      if (!drop.contains(e.target)) { menu.style.display="none"; document.removeEventListener("click", close); }
    });
  }, 0);
}
