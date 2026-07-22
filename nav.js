// Renders the bottom tab bar (mobile) / side rail (wide screens).
// Order: Dashboard, My Tasks, Shift, Inventory  (+ admin: Reports, Team)
function renderNav(active, isAdmin) {
  const tabs = [
    { id: "dashboard", href: "dashboard.html", ico: "◉", label: "Dashboard" },
    { id: "mytasks",   href: "mytasks.html",   ico: "☰", label: "My Tasks" },
    { id: "shift",     href: "shift.html",     ico: "✓", label: "Shift" },
    { id: "inventory", href: "inventory.html", ico: "▦", label: "Inventory" },
  ];
  if (isAdmin) {
    tabs.push({ id: "reports", href: "reports.html", ico: "$", label: "Reports" });
    tabs.push({ id: "team",    href: "team.html",    ico: "☺", label: "Team" });
  }
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="${t.id === active ? "active" : ""}">
       <span class="ico">${t.ico}</span>${t.label}
     </a>`).join("");
  document.body.appendChild(nav);
}

async function renderTopbar(title, prof) {
  prof = prof || await getMyProfile();
  const bar = document.createElement("header");
  bar.className = "topbar";
  const roleTag = prof && prof.role === "admin"
    ? `<span class="rolechip">admin</span>` : "";
  bar.innerHTML = `
    <div>
      <h1>${title}</h1>
      <div class="who">${prof ? prof.full_name : ""} ${roleTag}</div>
    </div>
    <button class="secondary" onclick="signOut()" style="padding:8px 12px;font-size:13px">Sign out</button>`;
  document.body.prepend(bar);
}
