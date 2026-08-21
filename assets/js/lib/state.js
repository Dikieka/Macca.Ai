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
