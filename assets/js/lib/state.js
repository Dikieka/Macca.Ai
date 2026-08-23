// assets/js/lib/state.js
// State management murni tanpa framework: objek reaktif sederhana
// berbasis Proxy + subscriber, dipakai per-halaman.

export function createStore(initial) {
  const listeners = new Set();
  const state = new Proxy({ ...initial }, {
    set(target, key, value) {
      target[key] = value;
      listeners.forEach((fn) => fn(target, key));
      return true;
    },
  });

  return {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---- Helper UI kecil yang dipakai lintas halaman ----

export function showToast(message, type = "info") {
  const colors = {
    info: "bg-[var(--ink-900)] text-[var(--paper-50)]",
    success: "bg-[var(--sage-500)] text-white",
    error: "bg-[var(--clay-500)] text-white",
  };
  const el = document.createElement("div");
  el.className = `fixed bottom-5 right-5 z-[100] px-4 py-3 rounded-md shadow-lg text-sm font-medium ${colors[type] || colors.info} animate-[fadeIn_.2s_ease]`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function setLoading(buttonEl, isLoading, loadingText = "Memproses…") {
  if (!buttonEl) return;
  if (isLoading) {
    buttonEl.dataset.originalText = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = `<span class="inline-flex items-center gap-2">
      <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
      ${loadingText}</span>`;
  } else {
    buttonEl.disabled = false;
    buttonEl.innerHTML = buttonEl.dataset.originalText || buttonEl.innerHTML;
  }
}

/**
 * PERBAIKAN (dialog konfirmasi pakai confirm()/alert() bawaan browser): window.confirm()
 * tampilannya dikontrol sepenuhnya oleh browser/OS (prefix "localhost:8000 says", warna,
 * tombol OK/Cancel) — tidak bisa di-style sama sekali dan gampang terlihat "asing"
 * dibanding UI Macca sendiri, beda-beda pula tampilannya di tiap browser. Diganti dengan
 * modal custom (doc-card, portal ke <body>, animasi fade+scale masuk) yang dipakai
 * SELURUH halaman lewat satu fungsi ini — konsisten dengan look & feel Macca, mirip pola
 * dialog konfirmasi di Claude.ai. API-nya sengaja mirip window.confirm() (Promise<boolean>)
 * supaya tinggal `if (!(await confirmDialog(...))) return;` menggantikan `if (!confirm(...))
 * return;` di semua pemanggilnya, tanpa mengubah alur logic apa pun setelahnya.
 *
 * @param {string} message - Isi pertanyaan konfirmasi.
 * @param {object} [opts]
 * @param {string} [opts.title] - Judul modal (default: "Konfirmasi").
 * @param {string} [opts.confirmText] - Label tombol konfirmasi (default: "Ya, lanjutkan").
 * @param {string} [opts.cancelText] - Label tombol batal (default: "Batal").
 * @param {boolean} [opts.danger] - true untuk aksi destruktif (tombol konfirmasi merah/clay).
 * @returns {Promise<boolean>} true kalau user menekan tombol konfirmasi, false kalau batal/backdrop/Esc.
 */
export function confirmDialog(message, opts = {}) {
  const { title = "Konfirmasi", confirmText = "Ya, lanjutkan", cancelText = "Batal", danger = false } = opts;

  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "fixed inset-0 z-[200] bg-black/60 grid place-items-center p-4 confirm-backdrop";

    const confirmBtnClass = danger
      ? "px-4 py-2 rounded-md text-sm font-semibold bg-[var(--clay-500)] text-white hover:opacity-90 transition-opacity"
      : "btn-amber rounded-md px-4 py-2 text-sm font-semibold";

    backdrop.innerHTML = `
      <div class="doc-card w-full max-w-sm p-5 confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirmDialogTitle">
        <p id="confirmDialogTitle" class="font-display font-semibold text-ink-900">${escapeHtml_(title)}</p>
        <p class="text-sm text-ink-500 mt-2 leading-relaxed">${escapeHtml_(message)}</p>
        <div class="flex items-center justify-end gap-2 mt-5">
          <button type="button" data-action="cancel"
            class="px-4 py-2 rounded-md text-sm font-medium text-ink-700 border border-[var(--line)] hover:border-lime-500/60 transition-colors">${escapeHtml_(cancelText)}</button>
          <button type="button" data-action="confirm" class="${confirmBtnClass}">${escapeHtml_(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    if (window.lucide) lucide.createIcons();

    const cleanup = (result) => {
      document.removeEventListener("keydown", onKeydown);
      backdrop.classList.add("confirm-leaving");
      setTimeout(() => backdrop.remove(), 120);
      resolve(result);
    };
    const onKeydown = (e) => { if (e.key === "Escape") cleanup(false); };

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) cleanup(false); });
    backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => cleanup(false));
    backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => cleanup(true));
    document.addEventListener("keydown", onKeydown);
    backdrop.querySelector('[data-action="confirm"]').focus();
  });
}

function escapeHtml_(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}
