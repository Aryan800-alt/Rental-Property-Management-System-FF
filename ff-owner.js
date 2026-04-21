// ff-owner.js — FlatFinder Owner Module
// Views: Dashboard · Add Flat (Cloudinary image upload) · Profile
// Depends on: ff-core.js
// ─────────────────────────────────────────────────────────────────

const Owner = {
  // ── Internal image state ──────────────────────────────────────
  // Each entry: { url: <cloudinary URL>, publicId: <string> }
  _uploadedImages: [],
  _uploading: false,

  // ── Cloudinary config (fetched from /api/config) ──
  _cloudNameStr: null,
  _uploadPresetStr: null,

  async _ensureCloudinaryConfig() {
    if (this._cloudNameStr && this._uploadPresetStr) return;
    const res = await apiFetch('/api/config');
    if (res.success && res.data) {
      this._cloudNameStr = res.data.cloudName;
      this._uploadPresetStr = res.data.uploadPreset;
    }
  },

  _cloudName() { return this._cloudNameStr || ""; },
  _uploadPreset() { return this._uploadPresetStr || ""; },

  // ── DASHBOARD ─────────────────────────────────────────────────
  viewDashboard() {
    const u = appState.currentUser;
    const listings = appState.listings || [];
    const bookings = appState.bookings || [];

    const approved = listings.filter((l) => l.status === "approved").length;
    const pending = listings.filter((l) => l.status === "pending").length;
    const rejected = listings.filter((l) => l.status === "rejected").length;

    const hasContact = u.phone || u.whatsapp || u.telegram;
    const contactNudge = !hasContact
      ? `
      <div class="nudge-banner" role="status">
        <span>💡 Add contact details so tenants can reach you directly.</span>
        <a class="btn btn--sm btn--secondary" href="#/owner/profile" data-route="/owner/profile">Update Profile →</a>
      </div>`
      : "";

    let listingRows = `<tr><td colspan="6" class="empty-cell">No listings yet. <a href="#/owner/add-flat" data-route="/owner/add-flat">Add your first flat →</a></td></tr>`;
    if (listings.length) {
      listingRows = listings.map((l) => {
        const cover = Array.isArray(l.images) && l.images.length
            ? `<img class="listing-thumb" src="${escHtml(l.images[0])}" alt="${escHtml(l.flat_title)}" loading="lazy" onerror="this.style.display='none'" />`
            : "";
        return populateTemplate('tmpl-owner-listing-row', {
          COVER_IMG: cover,
          TITLE: escHtml(l.flat_title),
          CITY: escHtml(l.city),
          TYPE: escHtml(l.type),
          RENT: Number(l.rent).toLocaleString("en-IN"),
          STATUS_CLASS: l.status === "approved" ? "success" : l.status === "rejected" ? "danger" : "warning",
          STATUS: l.status,
          REJECTION_REASON: l.status === "rejected" && l.rejection_reason ? `<p class="text-muted" style="font-size:0.75rem;margin-top:2px">${escHtml(l.rejection_reason)}</p>` : "",
          SUBMITTED_AT: l.submitted_at?.slice(0, 10) || "—",
          REVIEWER_NAME: l.reviewer_name ? escHtml(l.reviewer_name) : "—",
          FLAT_ID: escHtml(l.flat_id)
        });
      }).join("");
    }

    let bookingRows = `<tr><td colspan="5" class="empty-cell">No bookings yet.</td></tr>`;
    if (bookings.length) {
      bookingRows = bookings.map((b) => {
        const actions = b.status === "pending"
            ? `<button class="btn btn--sm btn--primary"  data-action="confirm-booking" data-booking-id="${b.id}">✅ Confirm</button>
               <button class="btn btn--sm btn--danger"   data-action="cancel-booking"  data-booking-id="${b.id}">❌ Cancel</button>`
            : "—";
        return populateTemplate('tmpl-owner-booking-row', {
          FLAT_TITLE: escHtml(b.flat_title),
          TENANT_NAME: escHtml(b.tenant_name),
          TENANT_EMAIL: escHtml(b.tenant_email),
          CHECK_IN: b.check_in,
          CHECK_OUT: b.check_out,
          TOTAL_RENT: Number(b.total_rent).toLocaleString("en-IN"),
          STATUS_CLASS: b.status === "confirmed" ? "success" : b.status === "cancelled" ? "danger" : "warning",
          STATUS: b.status,
          ACTIONS: actions
        });
      }).join("");
    }

    return populateTemplate('tmpl-owner-dashboard', {
      CONTACT_NUDGE: contactNudge,
      TOTAL_LISTINGS: listings.length,
      APPROVED_LISTINGS: approved,
      PENDING_LISTINGS: pending,
      REJECTED_LISTINGS: rejected,
      LISTING_ROWS: listingRows,
      BOOKING_ROWS: bookingRows
    });
  },

  // ── ADD FLAT ──────────────────────────────────────────────────
  viewAddFlat() {
    Owner._uploadedImages = []; // Reset on each render
    const u = appState.currentUser;
    const today = new Date().toISOString().split("T")[0];

    return populateTemplate('tmpl-owner-add-flat', {
      TODAY: today,
      PHONE: escHtml(u.phone || ""),
      WHATSAPP: escHtml(u.whatsapp || ""),
      EMAIL: escHtml(u.email || ""),
      TELEGRAM: escHtml(u.telegram || "")
    });
  },

  // ── OWNER PROFILE ─────────────────────────────────────────────
  viewProfile() {
    const u = appState.currentUser;
    return populateTemplate('tmpl-owner-profile', {
      NAME: escHtml(u.name || ""),
      EMAIL: escHtml(u.email || ""),
      PHONE: escHtml(u.phone || ""),
      WHATSAPP: escHtml(u.whatsapp || ""),
      TELEGRAM: escHtml(u.telegram || ""),
      LOCATION: escHtml(u.location || ""),
      LANGUAGES: escHtml(u.languages || ""),
      BIO: escHtml(u.bio || "")
    });
  },

  // ── EVENT BINDERS ────────────────────────────────────────────
  bindEvents(root) {
    this._bindDashboardActions(root);
    this._bindAddFlatForm(root);
    this._bindImageUpload(root);
    this._bindProfileForm(root);
  },

  // ── Dashboard: delete flat + booking confirm/cancel ──────────
  _bindDashboardActions(root) {
    root.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === "delete-flat") {
        const flatId = btn.dataset.flatId;
        if (
          !flatId ||
          !confirm("Permanently delete this listing and all its data?")
        )
          return;
        btn.disabled = true;
        const r = await apiFetch(`/api/flats/${flatId}`, { method: "DELETE" });
        btn.disabled = false;
        if (r.success) {
          showToast("Flat deleted.", "info");
          const [lr, br] = await Promise.all([
            apiFetch("/api/listings"),
            apiFetch("/api/bookings"),
          ]);
          if (lr.success) appState.listings = lr.data;
          if (br.success) appState.bookings = br.data;
          render(Owner.viewDashboard());
        } else {
          showToast(r.message || "Delete failed.", "error");
        }
      }

      if (action === "confirm-booking") {
        const bId = btn.dataset.bookingId;
        if (!bId) return;
        btn.disabled = true;
        const r = await apiFetch(`/api/bookings/${bId}`, {
          method: "PATCH",
          body: { status: "confirmed" },
        });
        btn.disabled = false;
        if (r.success) {
          showToast("Booking confirmed!", "success");
          const br = await apiFetch("/api/bookings");
          if (br.success) appState.bookings = br.data;
          render(Owner.viewDashboard());
        } else showToast(r.message, "error");
      }

      if (action === "cancel-booking") {
        const bId = btn.dataset.bookingId;
        if (!bId || !confirm("Cancel this booking?")) return;
        btn.disabled = true;
        const r = await apiFetch(`/api/bookings/${bId}`, {
          method: "PATCH",
          body: { status: "cancelled" },
        });
        btn.disabled = false;
        if (r.success) {
          showToast("Booking cancelled.", "warning");
          const br = await apiFetch("/api/bookings");
          if (br.success) appState.bookings = br.data;
          render(Owner.viewDashboard());
        } else showToast(r.message, "error");
      }
    });
  },

  // ── Add Flat form submit ─────────────────────────────────────
  _bindAddFlatForm(root) {
    const form = root.querySelector("#add-flat-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const errEl = root.querySelector("#add-flat-error");
      const btn   = root.querySelector("#add-flat-submit");
      if (!btn) return; // Guard: form rendered without submit button

      if (Owner._uploading) {
        showToast("Please wait — images are still uploading.", "warning");
        return;
      }

      if (errEl) {
        errEl.textContent = "";
        errEl.classList.add("hidden");
      }

      const fd = new FormData(form);

      const amenities = (fd.get("amenities") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        title: fd.get("title")?.trim(),
        city: fd.get("city")?.trim(),
        address: fd.get("address")?.trim() || "",
        rent: fd.get("rent"),
        type: fd.get("type"),
        furnished: fd.get("furnished"),
        description: fd.get("description")?.trim() || "",
        amenities,
        available_from: fd.get("available_from") || "",
        deposit: fd.get("deposit") || "",
        floor: fd.get("floor") || "",
        total_floors: fd.get("total_floors") || "",
        area_sqft: fd.get("area_sqft") || "",
        bathrooms: fd.get("bathrooms") || "",
        parking: fd.get("parking") || "none",
        facing: fd.get("facing") || "",
        preferred_tenants: fd.get("preferred_tenants") || "any",
        food_preference: fd.get("food_preference") || "any",
        pets_allowed: form.querySelector('[name="pets_allowed"]')?.checked
          ? 1
          : 0,
        smoking_allowed: form.querySelector('[name="smoking_allowed"]')?.checked
          ? 1
          : 0,
        visitors_allowed: form.querySelector('[name="visitors_allowed"]')
          ?.checked
          ? 1
          : 0,
        landmarks: fd.get("landmarks")?.trim() || "",
        contact_phone: fd.get("contact_phone")?.trim() || "",
        contact_whatsapp: fd.get("contact_whatsapp")?.trim() || "",
        contact_email: fd.get("contact_email")?.trim() || "",
        contact_telegram: (fd.get("contact_telegram")?.trim() || "").replace(
          /^@/,
          "",
        ),
        preferred_contact: fd.get("preferred_contact") || "",
        best_time_to_call: fd.get("best_time_to_call") || "",
        owner_note: fd.get("owner_note")?.trim() || "",
        images: Owner._uploadedImages.map((i) => i.url),
        image_public_ids: Owner._uploadedImages.map((i) => i.publicId),
      };

      btn.disabled = true;
      btn.textContent = "Submitting…";

      const r = await apiFetch("/api/flats", { method: "POST", body: payload });

      btn.disabled = false;
      btn.textContent = btn.dataset.label;

      if (r.success) {
        Owner._uploadedImages = [];
        showToast("Flat submitted for review!", "success");
        window.location.hash = "#/owner/dashboard";
      } else {
        const msg = r.message || "Submission failed.";
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove("hidden");
        }
        showToast(msg, "error");
      }
    });
  },

  // ── Image upload (Cloudinary unsigned) ───────────────────────
  _bindImageUpload(root) {
    const zone = root.querySelector("#image-upload-zone");
    if (!zone) return;

    const input = root.querySelector("#flat-images-input");
    const dropArea = root.querySelector("#img-drop-area");
    const grid = root.querySelector("#img-preview-grid");
    const progress = root.querySelector("#img-upload-progress");

    root
      .querySelector("#img-browse-btn")
      ?.addEventListener("click", () => input?.click());

    dropArea?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input?.click();
      }
    });

    input?.addEventListener("change", () => {
      Owner._processFiles(Array.from(input.files), grid, progress);
      input.value = "";
    });

    dropArea?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("drag-over");
    });
    dropArea?.addEventListener("dragleave", () =>
      dropArea.classList.remove("drag-over"),
    );
    dropArea?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("drag-over");
      Owner._processFiles(Array.from(e.dataTransfer.files), grid, progress);
    });

    grid?.addEventListener("click", (e) => {
      const btn = e.target.closest(".img-preview-item__remove");
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (isNaN(idx)) return;
      Owner._uploadedImages.splice(idx, 1);
      Owner._rerenderGrid(grid);
    });
  },

  async _processFiles(files, grid, progress) {
    const MAX_FILES = 8;
    const MAX_SIZE = 5 * 1024 * 1024;
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

    await Owner._ensureCloudinaryConfig();
    const cloudName = Owner._cloudName();
    const uploadPreset = Owner._uploadPreset();

    // Guard against un-injected or missing Cloudinary config
    if (
      !cloudName ||
      cloudName.includes("{{") ||
      !uploadPreset ||
      uploadPreset.includes("{{")
    ) {
      showToast(
        "Image uploads are not configured. Set Cloudinary env vars and redeploy.",
        "warning",
      );
      return;
    }

    const toUpload = [];
    for (const file of files) {
      if (Owner._uploadedImages.length + toUpload.length >= MAX_FILES) {
        showToast(`Max ${MAX_FILES} images allowed.`, "warning");
        break;
      }
      if (!ALLOWED.includes(file.type)) {
        showToast(
          `${file.name}: unsupported format. Use JPG, PNG, or WEBP.`,
          "error",
        );
        continue;
      }
      if (file.size > MAX_SIZE) {
        showToast(`${file.name} exceeds 5 MB.`, "error");
        continue;
      }
      toUpload.push(file);
    }

    if (!toUpload.length) return;

    Owner._uploading = true;
    if (progress) {
      progress.textContent = `Uploading ${toUpload.length} image${toUpload.length > 1 ? "s" : ""}…`;
      progress.classList.remove("hidden");
    }

    const uploads = toUpload.map((file) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", uploadPreset);

      return fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        {
          method: "POST",
          body: fd,
        },
      )
        .then((res) => res.json())
        .then((data) => {
          if (data.secure_url && data.public_id) {
            return { url: data.secure_url, publicId: data.public_id };
          }
          throw new Error(data.error?.message || "Upload failed");
        })
        .catch((err) => { // (6b fix) handles network failures gracefully
          showToast(`${file.name}: ${err.message}`, "error");
          return null;
        });
    });

    const results = await Promise.all(uploads);
    results.forEach((r) => {
      if (r) Owner._uploadedImages.push(r);
    });

    Owner._uploading = false;
    if (progress) progress.classList.add("hidden");

    Owner._rerenderGrid(grid);
  },

  _rerenderGrid(grid) {
    if (!grid) return;
    grid.innerHTML = "";
    Owner._uploadedImages.forEach(({ url }, i) => {
      const item = document.createElement("div");
      item.className = "img-preview-item";
      item.innerHTML = `
        <img src="${escHtml(url)}" alt="Property photo ${i + 1}" loading="lazy"
          onerror="this.src='';this.alt='Load error'" />
        ${i === 0 ? '<span class="img-preview-item__main-badge">Cover</span>' : ""}
        <button type="button" class="img-preview-item__remove"
          data-idx="${i}" aria-label="Remove photo ${i + 1}">×</button>`;
      grid.appendChild(item);
    });
  },

  // ── Profile form submit ──────────────────────────────────────
  _bindProfileForm(root) {
    const form = root.querySelector("#profile-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const errEl = root.querySelector("#profile-error");
      const btn = root.querySelector("#profile-submit");

      if (!btn) return; // Guard: button missing from DOM

      const fd = new FormData(form);
      const newPass = fd.get("new_password") || "";
      const confirmPw = fd.get("confirm_password") || ""; // (6e fix) consistent with form field name

      if (newPass && newPass !== confirmPw) {
        const msg = "Passwords do not match.";
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove("hidden");
        }
        showToast(msg, "error");
        return;
      }
      if (errEl) errEl.classList.add("hidden");

      const payload = {
        name: fd.get("name")?.trim(),
        email: fd.get("email")?.trim(),
        phone: fd.get("phone")?.trim() || "",
        whatsapp: fd.get("whatsapp")?.trim() || "",
        telegram: (fd.get("telegram")?.trim() || "").replace(/^@/, ""),
        location: fd.get("location")?.trim() || "",
        languages: fd.get("languages")?.trim() || "",
        bio: fd.get("bio")?.trim() || "",
        ...(newPass ? { password: newPass } : {}),
      };

      btn.disabled = true;
      btn.textContent = "Saving…";

      const r = await apiFetch("/api/me", { method: "PATCH", body: payload });

      btn.disabled = false;
      btn.textContent = btn.dataset.label;

      if (r.success) {
        Object.assign(appState.currentUser, r.data ?? payload);
        renderNavBar();
        showToast("Profile updated successfully!", "success");
      } else {
        const msg = r.message || "Update failed.";
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove("hidden");
        }
        showToast(msg, "error");
      }
    });
  },
};
