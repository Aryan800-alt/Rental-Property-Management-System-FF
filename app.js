// app.js — FlatFinder Entry Point
// Router · Event Delegation · Boot
//
// Load order in HTML:
//   1. ff-core.js    (globals: API, Token, appState, apiFetch, escHtml,
//                    render, renderNavBar, showToast, showModal, closeModal)
//   2. ff-auth.js    (Auth)
//   3. ff-tenant.js  (Tenant)
//   4. ff-owner.js   (Owner)
//   5. ff-admin.js   (Admin)
//   6. app.js        (Router + Boot — this file)
// ─────────────────────────────────────────────────────────────────

// ── ROLE → DEFAULT ROUTE ─────────────────────────────────────────
// (8c fix) Moved defaultRoute() to ff-core.js

// ── ROUTE GUARD ──────────────────────────────────────────────────
const ROLE_ROUTES = {
  "/login": null,
  "/signup": null,
  "/tenant/dashboard": ["tenant"],
  "/tenant/search": ["tenant"],
  "/tenant/flat": ["tenant"],
  "/tenant/booking": ["tenant"],
  "/tenant/bookings": ["tenant"],
  "/owner/dashboard": ["owner"],
  "/owner/listings": ["owner"],
  "/owner/add-flat": ["owner"],
  "/owner/profile": ["owner"],
  "/admin/dashboard": ["admin"],
  "/admin/approvals": ["admin"],
  "/admin/users": ["admin"],
};

function guardRoute(path) {
  const segments = path.split("/").filter(Boolean);
  const base = "/" + segments.slice(0, 2).join("/");
  const roles = ROLE_ROUTES[base];
  if (roles === null) return true;
  if (!appState.currentUser) return false;
  return roles?.includes(appState.currentUser.role) ?? false;
}

// ── DATA LOADER ──────────────────────────────────────────────────
async function loadRouteData(base, param) {
  if (!appState.currentUser) return;

  if (base === "/tenant/dashboard" || base === "/tenant/bookings") {
    const r = await apiFetch("/api/bookings");
    if (r.success) appState.bookings = r.data;
  }
  if (base === "/tenant/search") {
    const r = await apiFetch("/api/flats");
    if (r.success) {
      appState.flats = r.data;
      appState.flatsMeta = r.meta;
    }
  }
  if (base === "/tenant/flat" && param) {
    const r = await apiFetch(`/api/flats/${param}`);
    appState._selectedFlat = r.success ? r.data : null;
  }
  if (base === "/tenant/booking" && param) {
    if (
      !appState._selectedFlat ||
      String(appState._selectedFlat.id) !== String(param)
    ) {
      const r = await apiFetch(`/api/flats/${param}`);
      appState._selectedFlat = r.success ? r.data : null;
    }
  }
  if (base === "/owner/dashboard" || base === "/owner/listings") {
    const [lr, br] = await Promise.all([
      apiFetch("/api/listings"),
      apiFetch("/api/bookings"),
    ]);
    if (lr.success) appState.listings = lr.data;
    if (br.success) appState.bookings = br.data;
  }
  if (base === "/admin/dashboard") {
    const [ur, fr, br, lr] = await Promise.all([
      apiFetch("/api/users"),
      apiFetch("/api/flats"),
      apiFetch("/api/bookings"),
      apiFetch("/api/listings"),
    ]);
    if (ur.success) appState.users = ur.data;
    if (fr.success) appState.flats = fr.data;
    if (br.success) appState.bookings = br.data;
    if (lr.success) appState.listings = lr.data;
  }
  if (base === "/admin/approvals") {
    const r = await apiFetch("/api/listings");
    if (r.success) appState.listings = r.data;
  }
  if (base === "/admin/users") {
    const r = await apiFetch("/api/users");
    if (r.success) appState.users = r.data;
  }
}

// ── VIEW RESOLVER ────────────────────────────────────────────────
function resolveView(base, param) {
  const map = {
    "/login": () => Auth.viewLogin("login"),
    "/signup": () => Auth.viewLogin("signup"),
    "/tenant/dashboard": () =>
      Tenant ? Tenant.viewDashboard() : "<p>Module not loaded</p>",
    "/tenant/search": () =>
      Tenant ? Tenant.viewSearch() : "<p>Module not loaded</p>",
    "/tenant/flat": () =>
      Tenant
        ? Tenant.viewFlatDetails(appState._selectedFlat)
        : "<p>Module not loaded</p>",
    "/tenant/booking": () =>
      Tenant
        ? Tenant.viewBooking(appState._selectedFlat)
        : "<p>Module not loaded</p>",
    "/tenant/bookings": () =>
      Tenant ? Tenant.viewDashboard() : "<p>Module not loaded</p>",
    "/owner/dashboard": () =>
      Owner ? Owner.viewDashboard() : "<p>Module not loaded</p>",
    "/owner/listings": () =>
      Owner ? Owner.viewDashboard() : "<p>Module not loaded</p>",
    "/owner/add-flat": () =>
      Owner ? Owner.viewAddFlat() : "<p>Module not loaded</p>",
    "/owner/profile": () =>
      Owner ? Owner.viewProfile() : "<p>Module not loaded</p>",
    "/admin/dashboard": () =>
      Admin ? Admin.viewDashboard() : "<p>Module not loaded</p>",
    "/admin/approvals": () =>
      Admin ? Admin.viewApprovals() : "<p>Module not loaded</p>",
    "/admin/users": () =>
      Admin ? Admin.viewUsers() : "<p>Module not loaded</p>",
  };
  return (map[base] ?? map["/login"])();
}

// ── NAVIGATE ─────────────────────────────────────────────────────
// Navigation lock prevents race conditions from rapid hash changes.
let _navigating = false;

async function navigate(hash) {
  if (_navigating) return; // (8b fix) intentional: swallows rapid clicks while navigating
  _navigating = true;

  try {
    const raw = (hash || "").replace(/^#/, "") || "/login";
    const path = raw.startsWith("/") ? raw : "/" + raw;
    const segments = path.split("/").filter(Boolean);
    const base = "/" + segments.slice(0, 2).join("/");
    const param = segments[2] || null;

    if (!guardRoute(path)) {
      window.location.hash = appState.currentUser ? defaultRoute() : "#/login";
      return;
    }

    document.getElementById("app-root").innerHTML =
      `<div class="container page-content">
         <div class="skeleton" style="width: 200px; height: 32px; margin-bottom: 2rem; border-radius: 4px;"></div>
         <div class="grid-3">
           <div class="skeleton" style="height: 250px; border-radius: 8px;"></div>
           <div class="skeleton" style="height: 250px; border-radius: 8px;"></div>
           <div class="skeleton" style="height: 250px; border-radius: 8px;"></div>
         </div>
       </div>`;

    await loadRouteData(base, param);
    render(resolveView(base, param));
    renderNavBar();
  } catch (err) {
    console.error("[Router]", err);
    render(`<div class="container page-content">
      <div class="empty-state">
        <p style="font-size:2rem" aria-hidden="true">⚠️</p>
        <p>Something went wrong.</p>
        <p class="text-muted">${IS_PROD ? 'Please try again or contact support.' : escHtml(err.message)}</p>
        <a class="btn btn--secondary" href="#/login" data-route="/login">Go to Login</a>
      </div>
    </div>`);
  } finally {
    _navigating = false;
  }
}

// ── EVENT DELEGATION ─────────────────────────────────────────────
function bindEvents() {
  const oldRoot = document.getElementById("app-root");
  if (!oldRoot) return;

  const root = oldRoot.cloneNode(true);
  oldRoot.replaceWith(root); // (8a fix) Cloned element correctly replaces original in DOM

  root.addEventListener("click", (e) => {
    const link = e.target.closest("[data-route]");
    if (!link) return;
    const route = link.dataset.route;
    if (route) {
      e.preventDefault(); // (5a fix) This blocks double-navigation if href is present
      window.location.hash = "#" + route;
    }
  });

  Auth.bindEvents(root);
  if (Tenant) Tenant.bindEvents(root);
  if (Owner) Owner.bindEvents(root);
  if (Admin) Admin.bindEvents(root);
}

// ── LOGOUT ───────────────────────────────────────────────────────
// (8d fix) Moved handleLogout() to ff-core.js

// ── BOOT ─────────────────────────────────────────────────────────
window.addEventListener("hashchange", () => navigate(window.location.hash));

window.addEventListener("load", async () => {
  let pingOk = false;
  try {
    const pingRes = await fetch(`${API}/api/ping`, {
      signal: AbortSignal.timeout(5000),
    });
    pingOk = pingRes.ok;
  } catch (_) {
    // Network failure or timeout
  }

  if (!pingOk) {
    document.getElementById("app-nav").innerHTML = "";
    document.getElementById("app-root").innerHTML = `
      <div class="auth-wrapper">
        <div class="auth-card" style="text-align:center">
          <div style="font-size:3rem;margin-bottom:.75rem" aria-hidden="true">⚠️</div>
          <h2 style="color:#dc2626;margin-bottom:.5rem">Server Not Running</h2>
          <p style="color:#64748b;margin-bottom:1.25rem">
            FlatFinder needs its backend server to connect to MySQL.
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:.75rem;
                      padding:1.25rem;text-align:left;font-size:.875rem;line-height:2">
            <strong>▶ Local (Windows):</strong><br>
            &nbsp;&nbsp;Double-click
            <code style="background:#e2e8f0;padding:.15rem .4rem;border-radius:.3rem">start.bat</code>
            or run
            <code style="background:#e2e8f0;padding:.15rem .4rem;border-radius:.3rem">node server.js</code><br><br>
            <strong>▶ Railway:</strong><br>
            &nbsp;&nbsp;Check that the MySQL plugin is linked and all Variables are set,
            then redeploy.<br><br>
            <strong>▶ Then refresh this page.</strong>
          </div>
          <button class="btn btn--primary" type="button" style="margin-top:1.5rem;width:100%"
            onclick="location.reload()">
            🔄 Retry Connection
          </button>
        </div>
      </div>`;
    return;
  }

  const r = await apiFetch('/api/me', {
    signal: AbortSignal.timeout(8000),
  }).catch(() => ({ success: false, data: null }));
  if (r.success && r.data) {
    appState.currentUser = r.data;
    renderNavBar();
    const h = window.location.hash;
    const targetHash = h && h !== "#" && h !== "#/" ? h : defaultRoute();
    await navigate(targetHash);
  } else {
    const h = window.location.hash || "#/login";
    await navigate(
      h.startsWith("#/login") || h.startsWith("#/signup") ? h : "#/login",
    );
  }
});

// ── MODULE INTEGRITY CHECK (dev-only) ──────────────────────────
if (typeof IS_PROD === 'undefined' || !IS_PROD) {
  const modules = { Auth, Tenant, Owner, Admin };
  const missing = Object.entries(modules).filter(([, m]) => !m).map(([k]) => k);
  if (missing.length) console.warn('[FlatFinder] Modules NOT loaded:', missing);
}

// ── SERVICE WORKER REGISTRATION ──────────────────────────────────
// Must be inside a load event — registering at parse time can delay
// critical page resources (CSS, JS, fonts) on slow connections.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      })
      .catch(err => console.warn('[SW] Registration failed (non-fatal):', err.message));
  });
}
