// ff-tenant.js — FlatFinder Tenant Module
// Views: Dashboard · Search · Flat Details · Booking
// Depends on: ff-core.js
// ─────────────────────────────────────────────────────────────────

const Tenant = {
  viewDashboard() {
    let rows = `<tr><td colspan="5" class="empty-cell">No bookings yet. <a href="#/tenant/search" data-route="/tenant/search">Search flats →</a></td></tr>`;
    
    if (appState.bookings.length) {
      rows = appState.bookings.map(b => {
        const statusClass = b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'danger' : 'warning';
        const actionBtn = b.status === 'pending'
          ? `<button class="btn btn--danger btn--sm" type="button" data-action="cancel-booking" data-booking-id="${escHtml(b.id)}">Cancel</button>`
          : '—';
        
        return populateTemplate('tmpl-tenant-booking-row', {
          FLAT_TITLE: escHtml(b.flat_title),
          CITY: escHtml(b.city),
          CHECK_IN: escHtml(b.check_in),
          CHECK_OUT: escHtml(b.check_out),
          TOTAL_RENT: Number(b.total_rent).toLocaleString('en-IN'),
          STATUS_CLASS: statusClass,
          STATUS: escHtml(b.status),
          ACTION_BUTTON: actionBtn
        });
      }).join('');
    }
    
    return populateTemplate('tmpl-tenant-dashboard', {
      FIRST_NAME: escHtml(appState.currentUser.name.split(' ')[0]),
      BOOKING_ROWS: rows
    });
  },

  viewSearch(flats = appState.flats) {
    if (!Array.isArray(flats)) flats = [];
    const meta = appState.flatsMeta || { total: flats.length, page: 1, limit: 20, totalPages: 1 };
    
    let cards = `<div class="empty-state" role="status" aria-live="polite">
          <p style="font-size:2rem" aria-hidden="true">🏚️</p>
          <p>No flats match your filters.</p>
          <p class="text-muted">Try adjusting your search criteria.</p>
         </div>`;

    if (flats.length) {
      cards = flats.map(f => {
        const imgWrap = f.images && f.images.length
          ? `<div class="flat-card__img-wrap"><img class="flat-card__img" src="${escHtml(f.images[0])}" alt="Photo" loading="lazy" onerror="this.closest('.flat-card__img-wrap').style.display='none'" /></div>`
          : '';
          
        return populateTemplate('tmpl-tenant-flat-card', {
          TYPE: escHtml(f.type),
          FURNISHED_BADGE: f.furnished ? '<span class="badge badge--success">Furnished</span>' : '<span class="badge badge--neutral">Unfurnished</span>',
          IMAGE_WRAP: imgWrap,
          TITLE: escHtml(f.title || f.flat_title || ''),
          CITY: escHtml(f.city),
          RENT: Number(f.rent).toLocaleString('en-IN'),
          OWNER_NAME: escHtml(f.owner_name || 'N/A'),
          FLAT_ID: escHtml(f.id)
        });
      }).join('');
    }

    const pagination = meta.totalPages > 1 ? `
      <div class="pagination" style="display:flex; gap:1rem; justify-content:center; margin-top:2rem;">
        <button class="btn btn--secondary btn--sm" data-page="${meta.page - 1}" ${meta.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span style="display:flex; align-items:center;">Page ${meta.page} of ${meta.totalPages}</span>
        <button class="btn btn--secondary btn--sm" data-page="${meta.page + 1}" ${meta.page >= meta.totalPages ? 'disabled' : ''}>Next</button>
      </div>` : '';
      
    return populateTemplate('tmpl-tenant-search', {
      TOTAL_FLATS: meta.total,
      S_PLURAL: meta.total !== 1 ? 's' : '',
      CARDS: cards,
      PAGINATION: pagination
    });
  },

  viewFlatDetails(flat) {
    if (!flat) return `
      <div class="container page-content">
        <div class="empty-state">
          <p style="font-size:2rem" aria-hidden="true">😕</p>
          <p>Flat not found.</p>
          <a class="btn btn--secondary" href="#/tenant/search" data-route="/tenant/search">Back to Search</a>
        </div>
      </div>`;

    const amenities = Array.isArray(flat.amenities) ? flat.amenities : [];
    const images    = Array.isArray(flat.images)    ? flat.images    : [];

    // Prefer flat-specific contact fields; fall back to owner profile fields
    const contactPhone    = flat.contact_phone    || flat.owner_phone    || '';
    const contactEmail    = flat.contact_email    || flat.owner_email    || '';
    const contactWhatsapp = flat.contact_whatsapp || flat.owner_whatsapp || '';
    const contactTelegram = flat.contact_telegram || flat.owner_telegram || '';

    const ownerContact = `
      <aside class="owner-contact-card" aria-label="Owner contact information">
        <h4 class="owner-contact-card__title">🔑 About the Owner</h4>
        <p class="owner-contact-card__name">${escHtml(flat.owner_name || 'Property Owner')}</p>
        ${contactPhone
          ? `<a class="owner-contact-card__item" href="tel:${escHtml(contactPhone)}">📞 ${escHtml(contactPhone)}</a>`
          : ''}
        ${contactEmail
          ? `<a class="owner-contact-card__item" href="mailto:${escHtml(contactEmail)}">✉️ ${escHtml(contactEmail)}</a>`
          : ''}
        ${contactWhatsapp
          ? `<a class="owner-contact-card__item owner-contact-card__item--whatsapp"
               href="https://wa.me/${escHtml(contactWhatsapp.replace(/\D/g, ''))}"
               target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>`
          : ''}
        ${contactTelegram
          ? `<a class="owner-contact-card__item owner-contact-card__item--telegram"
               href="https://t.me/${escHtml(contactTelegram)}"
               target="_blank" rel="noopener noreferrer">✈️ Telegram</a>`
          : ''}
        ${flat.preferred_contact
          ? `<p class="text-muted" style="font-size:0.8rem;margin-top:4px">Prefers: <strong>${escHtml(flat.preferred_contact)}</strong></p>`
          : ''}
        ${flat.best_time_to_call
          ? `<p class="text-muted" style="font-size:0.8rem">Best time: ${escHtml(flat.best_time_to_call)}</p>`
          : ''}
        ${flat.owner_note
          ? `<p class="owner-contact-card__bio">${escHtml(flat.owner_note)}</p>`
          : flat.owner_bio
            ? `<p class="owner-contact-card__bio">${escHtml(flat.owner_bio)}</p>`
            : ''}
      </aside>`;

    const gallery = images.length
      ? `<div class="flat-gallery" role="group" aria-label="Property photos">
          ${images.map((src, i) =>
            `<img class="flat-gallery__img${i === 0 ? ' flat-gallery__img--main' : ''}"
                  src="${escHtml(src)}"
                  alt="Property photo ${i + 1}"
                  loading="${i === 0 ? 'eager' : 'lazy'}"
                  onerror="this.style.display='none'" />`
          ).join('')}
         </div>`
      : '';

    // Build amenities section from flat data
    const amenitiesSection = amenities.length
      ? `<div>
           <p class="form-label" style="margin-bottom:var(--space-xs)">Amenities</p>
           <div class="amenity-tags">
             ${amenities.map(a => `<span class="badge badge--neutral">✓ ${escHtml(a)}</span>`).join('')}
           </div>
         </div>`
      : '';

    const bookBtn = flat.available
      ? `<a class="btn btn--primary" href="#/tenant/booking/${escHtml(flat.id)}" data-route="/tenant/booking/${escHtml(flat.id)}">📅 Book This Flat →</a>`
      : `<button class="btn btn--secondary" type="button" disabled>Not Available</button>`;
      
    return populateTemplate('tmpl-tenant-flat-details', {
      GALLERY: gallery,
      TITLE: escHtml(flat.title),
      CITY: escHtml(flat.city),
      ADDRESS: flat.address ? escHtml(flat.address) : '',
      RENT: Number(flat.rent).toLocaleString('en-IN'),
      DESCRIPTION: flat.description ? `<p class="flat-detail__desc">${escHtml(flat.description)}</p>` : '',
      TYPE: escHtml(flat.type),
      FURNISHED_TEXT: flat.furnished ? 'Yes' : 'No',
      AVAILABLE_FROM: flat.available ? 'Immediately' : 'Not Available',
      DEPOSIT: flat.deposit ? `₹${Number(flat.deposit).toLocaleString('en-IN')}` : 'None',
      EXTRA_STATS: '',
      AMENITIES_SECTION: amenitiesSection,
      BOOK_BUTTON: bookBtn,
      OWNER_CONTACT: ownerContact
    });
  },

  viewBooking(flat) {
    if (!flat) return `
      <div class="container page-content">
        <div class="empty-state">
          <p>Flat not found.</p>
          <a class="btn btn--secondary" href="#/tenant/search" data-route="/tenant/search">Back to Search</a>
        </div>
      </div>`;

    const today    = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    return populateTemplate('tmpl-tenant-booking', {
      FLAT_ID: escHtml(flat.id),
      FLAT_TITLE: escHtml(flat.title),
      FLAT_RENT: Number(flat.rent).toLocaleString('en-IN'),
      TODAY: today,
      TOMORROW: tomorrow
    });
  },

  bindEvents(root) {
    // ── Search filter form ────────────────────────────────────
    const filterForm = root.querySelector('#flat-search-filter-form');
    if (filterForm) {
      filterForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd     = new FormData(filterForm);
        const params = new URLSearchParams();
        for (const [k, v] of fd.entries()) if (v) params.set(k, v);
        const r = await apiFetch(`/api/flats?${params}`);
        if (r.success) { 
          appState.flats = r.data; 
          appState.flatsMeta = r.meta;
          render(Tenant.viewSearch(r.data)); 
        }
        else showToast(r.message, 'error');
      });

      root.querySelector('#filter-reset-btn')?.addEventListener('click', async () => {
        // (5d fix) intentional: NO e.preventDefault() here so the native form reset clears fields before fetch
        filterForm.reset();
        const r = await apiFetch('/api/flats');
        if (r.success) { 
          appState.flats = r.data; 
          appState.flatsMeta = r.meta;
          render(Tenant.viewSearch(r.data)); 
        }
        else showToast(r.message, 'error');
      });
    }

    // ── Pagination ────────────────────────────────────────────
    root.querySelectorAll('.pagination button').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const page = e.target.dataset.page;
        if (!page) return;
        const fd = filterForm ? new FormData(filterForm) : new FormData();
        const params = new URLSearchParams();
        for (const [k, v] of fd.entries()) if (v) params.set(k, v);
        params.set('page', page);
        
        const r = await apiFetch(`/api/flats?${params}`);
        if (r.success) { 
          appState.flats = r.data; 
          appState.flatsMeta = r.meta;
          render(Tenant.viewSearch(r.data)); 
        } else {
          showToast(r.message, 'error');
        }
      });
    });

    // ── Booking form ─────────────────────────────────────────
    const bookingForm = root.querySelector('#booking-form');
    if (bookingForm) {
      const checkInInput  = bookingForm.querySelector('[name="check_in"]');
      const checkOutInput = bookingForm.querySelector('[name="check_out"]');
      const preview       = root.querySelector('#rent-preview');
      const previewVal    = root.querySelector('#rent-preview-value');

      const calcRent = () => {
        const ci = checkInInput?.value;
        const co = checkOutInput?.value;
        if (ci && co && appState._selectedFlat) {
          const days = Math.ceil((new Date(co) - new Date(ci)) / 86400000);
          if (days > 0) {
            const est = ((parseFloat(appState._selectedFlat.rent) / 30) * days).toFixed(2);
            if (previewVal) previewVal.textContent = `₹${Number(est).toLocaleString('en-IN')} (${days} days)`;
            if (preview)    preview.classList.remove('hidden');
            return;
          }
        }
        if (preview) preview.classList.add('hidden');
      };

      checkInInput?.addEventListener('change', () => {
        if (checkInInput.value) {
          // Checkout must be strictly after check-in — set min to next day.
          const nextDay = new Date(checkInInput.value);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          if (checkOutInput) {
            checkOutInput.min = nextDayStr;
            if (checkOutInput.value && checkOutInput.value <= checkInInput.value) {
              checkOutInput.value = '';
            }
          }
        }
        calcRent();
      });
      checkOutInput?.addEventListener('change', calcRent);

      bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fd  = new FormData(bookingForm);
        const btn = bookingForm.querySelector('[type="submit"]');
        btn.disabled    = true;
        btn.textContent = 'Submitting…';
        const r = await apiFetch('/api/bookings', {
          method: 'POST',
          body: {
            flat_id:   fd.get('flat_id'),
            check_in:  fd.get('check_in'),
            check_out: fd.get('check_out'),
          },
        });
        btn.disabled    = false;
        btn.textContent = btn.dataset.label;
        if (r.success) {
          showToast('Booking submitted successfully!', 'success');
          window.location.hash = '#/tenant/dashboard';
        } else {
          showToast(r.message || 'Booking failed.', 'error');
        }
      });
    }

    // ── Cancel booking (dashboard) ────────────────────────────
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="cancel-booking"]');
      if (!btn) return;
      const bId = btn.dataset.bookingId;
      if (!bId || !confirm('Cancel this booking?')) return;
      btn.disabled = true;
      const r = await apiFetch(`/api/bookings/${bId}`, { method: 'PATCH', body: { status: 'cancelled' } });
      btn.disabled = false;
      if (r.success) {
        showToast('Booking cancelled.', 'info');
        const br = await apiFetch('/api/bookings');
        if (br.success) appState.bookings = br.data;
        render(Tenant.viewDashboard());
      } else {
        showToast(r.message, 'error');
      }
    });
  },
};
