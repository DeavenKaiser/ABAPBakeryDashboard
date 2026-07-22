// Renders the bottom tab bar. Pass the active page name.
function renderNav(active) {
  const tabs = [
    { id: "shift",     href: "shift.html",     ico: "✓", label: "Shift" },
    { id: "mytasks",   href: "mytasks.html",   ico: "☰", label: "My Tasks" },
    { id: "inventory", href: "inventory.html", ico: "▦", label: "Inventory" },
    { id: "dashboard", href: "dashboard.html", ico: "◉", label: "Dashboard" },
  ];
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="${t.id === active ? "active" : ""}">
       <span class="ico">${t.ico}</span>${t.label}
     </a>`).join("");
  document.body.appendChild(nav);
}

// Renders the top bar with title + who's signed in + sign out.
async function renderTopbar(title) {
  const prof = await getMyProfile();
  const bar = document.createElement("header");
  bar.className = "topbar";
  bar.innerHTML = `
    <div>
      <h1>${title}</h1>
      <div class="who">${prof ? prof.full_name : ""}</div>
    </div>
    <button class="secondary" onclick="signOut()" style="padding:8px 12px;font-size:13px">Sign out</button>`;
  document.body.prepend(bar);
}
