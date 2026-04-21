// ff-admin.js — FlatFinder Admin Module
// Views: Dashboard · Approvals · User Management
// Depends on: ff-core.js
// ─────────────────────────────────────────────────────────────────

const Admin = {
  viewDashboard() {
    const { users, flats, bookings, listings } = appState;
    const pending = listings.filter((l) => l.status === "pending").length;
    
    const pendingBadge = pending > 0 ? `<span class="badge badge--danger" style="margin-left:4px">${pending}</span>` : "";
    return populateTemplate('tmpl-admin-dashboard', {
      TOTAL_USERS: users.length,
      TOTAL_FLATS: flats.length,
      TOTAL_BOOKINGS: bookings.length,
      PENDING_REVIEWS: pending,
      PENDING_BADGE: pendingBadge
    });
  },

  viewApprovals(listings = appState.listings) {
    let rows = `<tr><td colspan="5" class="empty-cell">No listings found.</td></tr>`;
    if (listings.length) {
      rows = listings.map((l) => {
        let actions = "—";
        if (l.status === "pending") {
          actions = `<button class="btn btn--primary btn--sm" data-action="approve" data-id="${l.id}">✅ Approve</button>
                     <button class="btn btn--danger  btn--sm" data-action="reject"  data-id="${l.id}">❌ Reject</button>`;
        } else if (l.reviewer_name) {
          actions = `<small class="text-muted">by ${escHtml(l.reviewer_name)}</small>`;
        }
        
        return populateTemplate('tmpl-admin-approval-row', {
          TITLE: escHtml(l.flat_title),
          CITY: escHtml(l.city),
          TYPE: escHtml(l.type),
          RENT: Number(l.rent).toLocaleString("en-IN"),
          OWNER: escHtml(l.owner_name),
          SUBMITTED: l.submitted_at?.slice(0, 10) || "—",
          STATUS_CLASS: l.status === "approved" ? "success" : l.status === "rejected" ? "danger" : "warning",
          STATUS: l.status,
          ACTIONS: actions
        });
      }).join("");
    }

    return populateTemplate('tmpl-admin-approvals', { APPROVAL_ROWS: rows });
  },

  viewUsers(users = appState.users) {
    let rows = `<tr><td colspan="5" class="empty-cell">No users found.</td></tr>`;
    if (users.length) {
      rows = users.map((u) => {
        let actions = '<span class="text-muted">(you)</span>';
        if (u.id !== appState.currentUser.id) {
          actions = `<button class="btn btn--sm btn--secondary" data-action="${u.status === "active" ? "suspend" : "activate"}" data-user-id="${u.id}">
                       ${u.status === "active" ? "🚫 Suspend" : "✅ Activate"}
                     </button>
                     <button class="btn btn--sm btn--danger" data-action="delete" data-user-id="${u.id}">🗑 Delete</button>`;
        }
        
        return populateTemplate('tmpl-admin-user-row', {
          NAME: escHtml(u.name),
          EMAIL: escHtml(u.email),
          ROLE: u.role,
          STATUS_CLASS: u.status === "active" ? "success" : "danger",
          STATUS: u.status,
          JOINED: u.created_at?.slice(0, 10) || "—",
          ACTIONS: actions
        });
      }).join("");
    }

    return populateTemplate('tmpl-admin-users', { USER_ROWS: rows });
  },

  bindEvents(root) {
    // (7c fix) events bound via delegation on cloned root persist across innerHTML re-renders
    // Approve / reject / suspend / activate / delete
    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const userId = btn.dataset.userId;

      if ((action === "approve" || action === "reject") && id) {
        btn.disabled = true;
        const status = action === "approve" ? "approved" : "rejected";
        const r = await apiFetch(`/api/listings/${id}`, { method: "PATCH", body: { status } });
        btn.disabled = false;
        if (r.success) {
          showToast(r.message, action === "approve" ? "success" : "warning");
          const lr = await apiFetch("/api/listings");
          if (lr.success) appState.listings = lr.data;
          render(Admin.viewApprovals());
        } else showToast(r.message, "error");
      }

      if ((action === "suspend" || action === "activate") && userId) {
        btn.disabled = true;
        const status = action === "suspend" ? "suspended" : "active";
        const r = await apiFetch(`/api/users/${userId}`, { method: "PATCH", body: { status } });
        btn.disabled = false;
        if (r.success) {
          showToast(r.message, action === "suspend" ? "warning" : "success");
          const ur = await apiFetch("/api/users");
          if (ur.success) appState.users = ur.data;
          render(Admin.viewUsers());
        } else showToast(r.message, "error");
      }

      if (action === "delete" && userId) {
        if (!confirm("Permanently delete this user and all their data?")) return;
        btn.disabled = true;
        const r = await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
        btn.disabled = false;
        if (r.success) {
          showToast("User deleted.", "info");
          const ur = await apiFetch("/api/users");
          if (ur.success) appState.users = ur.data;
          render(Admin.viewUsers());
        } else showToast(r.message, "error");
      }
    });

    // User search / filter
    const userSearch = root.querySelector("#user-search-input");
    if (userSearch) {
      const doFilter = () => {
        const q = (root.querySelector("#user-search-input")?.value || "").toLowerCase();
        const role = root.querySelector("#user-role-filter")?.value || "";
        const status = root.querySelector("#user-status-filter")?.value || "";
        let filtered = [...appState.users];
        if (q) filtered = filtered.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
        if (role) filtered = filtered.filter((u) => u.role === role);
        if (status) filtered = filtered.filter((u) => u.status === status);
        const tbody = root.querySelector("#users-tbody");
        const tmp = document.createElement("div");
        tmp.innerHTML = Admin.viewUsers(filtered);
        const newTbody = tmp.querySelector("#users-tbody");
        if (tbody && newTbody) {
          tbody.innerHTML = newTbody.innerHTML;
          root.querySelector('#user-search-input')?.focus(); // (7b fix) refocus
        }
      };
      root.querySelector("#user-search-input")?.addEventListener("input", doFilter);
      root.querySelector("#user-role-filter")?.addEventListener("change", doFilter);
      root.querySelector("#user-status-filter")?.addEventListener("change", doFilter);
    }

    // Approval status filter
    root.querySelector("#approval-status-filter")?.addEventListener("change", (e) => {
      const val = e.target.value;
      const filtered = val ? appState.listings.filter((l) => l.status === val) : appState.listings;
      const tbody = root.querySelector("tbody");
      const tmp = document.createElement("div");
      tmp.innerHTML = Admin.viewApprovals(filtered);
      const newTbody = tmp.querySelector("tbody");
      if (tbody && newTbody) {
        tbody.innerHTML = newTbody.innerHTML;
        root.querySelector("#approval-status-filter").value = val; // (7a fix) restore select value
      }
    });
  },
};
