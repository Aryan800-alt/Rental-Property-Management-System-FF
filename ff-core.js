// ff-core.js — FlatFinder Core Module
// Config · Token · State · API · Security · Render · Nav · UI Utilities
// Loaded first. All other modules depend on globals exposed here.
// ─────────────────────────────────────────────────────────────────

// Detect production environment (set by server, Railway sets NODE_ENV=production)
const IS_PROD = (typeof window !== 'undefined') && !['localhost', '127.0.0.1'].includes(window.location.hostname);

// ── CONFIG ───────────────────────────────────────────────────────
// On Railway the static frontend is served by the SAME Express server
// that hosts the API, so the origin is always identical — use "" (empty).
// If you ever split frontend/backend to separate Railway services,
// set window.FF_API_BASE before loading this file, or pass the backend
// URL via a <meta name="api-base"> tag injected by the server.
const API = (() => {
  // 1. Explicit override (useful for split-service deployments)
  if (window.FF_API_BASE) return window.FF_API_BASE.replace(/\/$/, '');

  // 2. <meta name="api-base" content="https://..."> injected by server
  const metaBase = document.querySelector('meta[name="api-base"]')?.content;
  if (metaBase && metaBase !== '{{API_BASE}}') return metaBase.replace(/\/$/, '');

  // 3. Same-origin (localhost dev + Railway single-service deployment)
  return '';
})();

// ── TOKEN ────────────────────────────────────────────────────────
const Token = {
  get:   ()  => localStorage.getItem('ff_jwt'),
  save:  (t) => t && localStorage.setItem('ff_jwt', t),
  clear: ()  => localStorage.removeItem('ff_jwt'),
};

// ── GLOBAL STATE ─────────────────────────────────────────────────
const appState = {
  currentUser:   null,
  flats:         [],
  bookings:      [],
  users:         [],
  listings:      [],
  _selectedFlat: null,
};

// ── API CLIENT ───────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  try {
    const token      = Token.get();
    const isFormData = options.body instanceof FormData;
    const init = {
      method:      options.method || 'GET',
      credentials: 'include',
      headers: {
        ...(token       ? { Authorization: `Bearer ${token}` } : {}),
        ...(isFormData  ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
    };
    if (options.body) {
      init.body = isFormData
        ? options.body
        : typeof options.body === 'object'
          ? JSON.stringify(options.body)
          : options.body;
    }

    const res = await fetch(`${API}${path}`, init);
    const ct  = res.headers.get('content-type') || '';

    if (res.status === 401 && !path.includes('/login') && !path.includes('/logout')) {
      showToast('Session expired. Please log in again.', 'warning');
      if (typeof handleLogout === 'function') handleLogout();
      return { success: false, data: null, message: 'Session expired.' };
    }

    if (!ct.includes('application/json')) {
      return {
        success: false,
        data:    null,
        message: `Server error ${res.status}. Is the backend running?`,
      };
    }

    const json = await res.json();
    if (json?.data?.token) Token.save(json.data.token);
    return json;
  } catch (err) {
    console.error('[apiFetch]', path, err);
    return {
      success: false,
      data:    null,
      message: `Cannot reach server. Check your connection or backend status.`,
    };
  }
}

// ── SECURITY ─────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ── RENDER ───────────────────────────────────────────────────────
function render(html) {
  const root = document.getElementById('app-root');
  if (!root) return;
  root.innerHTML = html;
  if (typeof bindEvents === 'function') bindEvents(); // (3a fix) safe since render() only fires after app.js loads
}

/**
 * Clones an HTML <template> by ID and performs bulk {{TOKEN}} replacement.
 * All values are coerced to strings; null/undefined become empty string.
 * @param {string}  templateId - id attribute of the <template> element
 * @param {Object}  dataMap    - map of TOKEN_NAME -> replacement value
 * @returns {string} fully-interpolated HTML string
 */
function populateTemplate(templateId, dataMap) {
  const tmpl = document.getElementById(templateId);
  if (!tmpl) {
    console.warn(`[populateTemplate] Template "#${templateId}" not found in DOM.`);
    return `<p class="text-muted">Error: Template ${escHtml(templateId)} missing.</p>`;
  }
  return Object.keys(dataMap).reduce((html, key) => {
    const val = dataMap[key] == null ? '' : String(dataMap[key]);
    return html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
  }, tmpl.innerHTML);
}

function renderNavBar() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;
  const u = appState.currentUser;
  if (!u) { nav.innerHTML = ''; return; }

  const roleLinks = {
    tenant: [
      { label: '🏠 Dashboard',   route: '/tenant/dashboard' },
      { label: '🔍 Search Flats', route: '/tenant/search'    },
      { label: '📋 My Bookings', route: '/tenant/bookings'  },
    ],
    owner: [
      { label: '🏠 Dashboard', route: '/owner/dashboard' },
      { label: '📋 Listings',  route: '/owner/listings'  },
      { label: '➕ Add Flat',  route: '/owner/add-flat'  },
      { label: '👤 My Profile', route: '/owner/profile'  },
    ],
    admin: [
      { label: '🏠 Dashboard', route: '/admin/dashboard' },
      { label: '✅ Approvals', route: '/admin/approvals' },
      { label: '👥 Users',     route: '/admin/users'     },
    ],
  };

  const badgeClass = {
    admin:  'badge--danger',
    owner:  'badge--warning',
    tenant: 'badge--success',
  };

  const links = (roleLinks[u.role] || [])
    .map((l) => `<a class="nav__link" href="#" data-route="${l.route}">${l.label}</a>`) // (3b fix) removed href to prevent double-navigation
    .join('');

  nav.innerHTML = `
    <div class="nav__inner container">
      <a class="nav__brand" href="#" data-route="/">🏠 FlatFinder</a>
      <div class="nav__links">${links}</div>
      <div class="nav__user">
        <span class="nav__name">${escHtml(u.name)}</span>
        <span class="badge ${badgeClass[u.role] || 'badge--neutral'}">${u.role}</span>
        <button class="btn btn--secondary btn--sm" id="logout-btn">Logout</button>
      </div>
    </div>`;

  // Bind logout after nav is rendered (fresh element — no listener accumulation)
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (typeof handleLogout === 'function') handleLogout();
  });
}

// ── UI UTILITIES ──────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  // Stack limit
  if (toast.children.length >= 5) toast.firstElementChild.remove();

  const cls = {
    success: 'toast--success',
    error:   'toast--error',
    warning: 'toast--warning',
    info:    'toast--info',
  };
  const div = document.createElement('div');
  div.className = `toast ${cls[type] || 'toast--info'}`;
  div.innerHTML = `
    <span class="toast__message">${escHtml(message)}</span>
    <button class="toast__close" onclick="this.parentElement.remove()" aria-label="Dismiss">×</button>`;
  toast.appendChild(div);

  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(10px)';
    div.style.transition = 'all 0.3s ease';
    setTimeout(() => div.remove(), 300);
  }, 4000);
}

function showModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <button class="modal__close" onclick="closeModal()" aria-label="Close modal">×</button>
      ${html}
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const appModal = document.getElementById('app-modal');
  if (appModal) {
    appModal.appendChild(overlay);
    appModal.setAttribute('aria-hidden', 'false'); // (3c fix) toggle accessibility state
  }
}

function closeModal() {
  const appModal = document.getElementById('app-modal');
  if (appModal) {
    appModal.querySelector('.modal-overlay')?.remove();
    appModal.setAttribute('aria-hidden', 'true'); // (3c fix) toggle accessibility state
  }
}

// ── UTILITIES ─────────────────────────────────────────────────────
/**
 * Debounce a function call, delaying execution until after `wait` ms of inactivity.
 * @param {Function} func  - function to debounce
 * @param {number}   wait  - milliseconds to wait
 * @returns {Function}
 */
function debounce(func, wait = 300) {
  let timeout;
  return function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// ── ROUTING UTILS (Moved from app.js - 8c fix) ────────────────────
function defaultRoute() {
  const role = appState.currentUser?.role;
  if (role === "admin") return "#/admin/dashboard";
  if (role === "owner") return "#/owner/dashboard";
  return "#/tenant/dashboard";
}

// ── LOGOUT (Moved from app.js - 8d fix) ───────────────────────────
async function handleLogout() {
  await apiFetch("/api/logout", { method: "POST" });
  Token.clear();
  Object.assign(appState, {
    currentUser: null,
    flats: [],
    bookings: [],
    users: [],
    listings: [],
    _selectedFlat: null,
  });
  renderNavBar();
  window.location.hash = "#/login";
  showToast("Logged out successfully.", "info");
}
