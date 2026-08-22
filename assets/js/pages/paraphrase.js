// assets/js/pages/paraphrase.js
//
// Fitur "Parafrase": tulis-ulang teks pakai model AI yang sama dengan chat (lewat
// action "paraphrase" -> handleParaphrase di apps-script/handlers/paraphrase.gs).
// Sengaja TIDAK memakai tool "AI humanizer" pihak ketiga — lihat catatan desain di
// paraphrase.gs untuk alasannya.

import { requireAuth } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading } from "../lib/state.js";
import { escapeHtml, markActiveSidebarLink, applyRoleBasedNav } from "../lib/render.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAuth();
if (session) init();

let activeTone = "formal";

function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();
  bindToneChips();
  bindCounter();
  bindCopyButton();
  document.getElementById("paraphraseForm").addEventListener("submit", handleSubmit);
}

function bindToneChips() {
  document.querySelectorAll(".tone-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".tone-chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      activeTone = chip.dataset.tone;
    });
  });
}

function bindCounter() {
  const textarea = document.getElementById("sourceText");
  const counter = document.getElementById("sourceCount");
  const update = () => (counter.textContent = `${textarea.value.length.toLocaleString("id-ID")} / 8.000 karakter`);
  textarea.addEventListener("input", update);
  update();
}

function bindCopyButton() {
  const btn = document.getElementById("copyResultBtn");
  btn.addEventListener("click", async () => {
    const text = document.getElementById("resultBox").dataset.raw || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Hasil parafrase disalin.", "success");
    } catch {
      showToast("Gagal menyalin — salin manual saja ya.", "error");
    }
  });
}

async function handleSubmit(e) {
  e.preventDefault();
  const textarea = document.getElementById("sourceText");
  const text = textarea.value.trim();
  if (!text) return showToast("Tulis atau tempel teksnya dulu.", "info");

  const btn = document.getElementById("paraphraseBtn");
  const resultBox = document.getElementById("resultBox");
  const copyBtn = document.getElementById("copyResultBtn");

  setLoading(btn, true, "Menulis ulang…");
  copyBtn.disabled = true;
  resultBox.innerHTML = `<div class="flex items-center gap-2 text-ink-500 text-xs font-mono">
    <svg class="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
    Macca sedang menulis ulang…
  </div>`;

  try {
    const res = await callApi("paraphrase", { text, tone: activeTone });
    resultBox.dataset.raw = res.result;
    resultBox.innerHTML = `<p class="whitespace-pre-wrap">${escapeHtml(res.result)}</p>`;
    copyBtn.disabled = false;
  } catch (err) {
    resultBox.innerHTML = `<p class="text-clay-500">Gagal memparafrase teks ini.</p>`;
    showToast(err instanceof ApiError ? err.message : "Terjadi kesalahan, coba lagi.", "error");
  } finally {
    setLoading(btn, false);
  }
}
