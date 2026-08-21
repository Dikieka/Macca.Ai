// assets/js/lib/sidebar.js
//
// PERBAIKAN #3: sebelumnya tiap halaman (chat/projects/documents/memory/project/
// admin/settings) punya markup <aside> sendiri-sendiri yang statis: lebar tetap
// 256px (w-64) dan TIDAK punya daftar "RIWAYAT" chat sama sekali kecuali di
// chat.html. Akibatnya begitu user pindah ke Projects/Documents/Memory, seluruh
// riwayat percakapan "hilang" dari pandangan sampai mereka balik ke halaman Chat.
//
// Modul ini dipakai bareng oleh SEMUA halaman (lewat init() masing-masing):
//   1. initSidebarResize() -> membuat sidebar bisa digeser lebar kiri/kanan lewat
//      #sidebarResizeHandle, lebar tersimpan di localStorage supaya konsisten
//      antar halaman & antar sesi.
//   2. loadSidebarHistory(activeChatId) -> mengisi #chatList dengan riwayat chat
//      (dipakai oleh halaman NON-chat; chat.html sendiri sudah punya versi lebih
//      kaya di chat.js dengan navigasi SPA + delete inline, jadi tidak dipakai di
//      sana supaya tidak dobel).

import { callApi } from "./api.js";
import { escapeHtml, formatRelativeTime } from "./render.js";

const WIDTH_STORAGE_KEY = "macca_sidebar_width";
const MIN_WIDTH = 220;
const MAX_WIDTH = 440;
const DEFAULT_WIDTH = 256;

function clampWidth(w) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

/** Pasang drag-to-resize di #sidebarResizeHandle, terapkan lebar tersimpan segera. */
export function initSidebarResize() {
  const aside = document.getElementById("sidebar");
  const handle = document.getElementById("sidebarResizeHandle");
  if (!aside) return;

  const saved = parseInt(localStorage.getItem(WIDTH_STORAGE_KEY), 10);
  aside.style.width = (Number.isFinite(saved) ? clampWidth(saved) : DEFAULT_WIDTH) + "px";

  if (!handle) return; // halaman tanpa handle (seharusnya tidak terjadi, tapi jaga-jaga)

  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const rect = aside.getBoundingClientRect();
    aside.style.width = clampWidth(e.clientX - rect.left) + "px";
  };
  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    handle.classList.remove("bg-lime-500/50");
    localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(aside.getBoundingClientRect().width)));
  };

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    handle.classList.add("bg-lime-500/50");
  });
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
  // Klik dua kali -> kembalikan ke lebar default, mirip file explorer.
  handle.addEventListener("dblclick", () => {
    aside.style.width = DEFAULT_WIDTH + "px";
    localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH));
  });
}

const MOBILE_BREAKPOINT = 768; // samakan dengan breakpoint "md" Tailwind & media query di style.css

/**
 * PERBAIKAN mobile: pasang toggle buka/tutup sidebar di layar kecil (<768px).
 * Sidebar sendiri sudah di-styling jadi panel off-canvas lewat CSS (lihat
 * style.css, aturan @media max-width:767.98px pada #sidebar) — modul ini
 * cuma mengatur kapan class "sidebar-open" ditambah/dihapus, plus hal-hal
 * pendukung: backdrop gelap di belakang panel, kunci scroll body saat
 * panel terbuka, tutup otomatis saat salah satu link di sidebar diklik atau
 * layar di-resize melewati breakpoint ke ukuran desktop, dan tombol Escape.
 *
 * Dipanggil bareng initSidebarResize() di init() tiap halaman. Tombol
 * pemicunya ditandai atribut `data-sidebar-toggle` di markup HTML masing-
 * masing halaman (bisa lebih dari satu per halaman, semua otomatis kepasang).
 */
export function initSidebarMobile() {
  const aside = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const toggleBtns = document.querySelectorAll("[data-sidebar-toggle]");
  if (!aside || !backdrop) return;

  function openSidebar() {
    aside.classList.add("sidebar-open");
    backdrop.classList.add("backdrop-open");
    document.body.style.overflow = "hidden";
    const firstBtn = toggleBtns[0];
    if (firstBtn) firstBtn.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    aside.classList.remove("sidebar-open");
    backdrop.classList.remove("backdrop-open");
    document.body.style.overflow = "";
    toggleBtns.forEach((btn) => btn.setAttribute("aria-expanded", "false"));
  }

  toggleBtns.forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      aside.classList.contains("sidebar-open") ? closeSidebar() : openSidebar();
    });
  });

  backdrop.addEventListener("click", closeSidebar);

  // Begitu user memilih menu/riwayat chat di sidebar, panel langsung nutup
  // sendiri (mirip pola app mobile pada umumnya) supaya tidak nutupin hasil klik.
  // Pakai event delegation (listener di <aside>, bukan di tiap <a>/<button>)
  // karena #chatList diisi ULANG belakangan secara async oleh loadSidebarHistory()
  // (dan, di chat.html, oleh chat.js) — listener langsung di elemen lama akan
  // hilang begitu innerHTML-nya diganti, delegation ini tetap menjangkau link
  // baru itu tanpa perlu dipasang ulang tiap kali daftar riwayat berubah.
  aside.addEventListener("click", (e) => {
    const target = e.target.closest("a, button");
    if (!target || !aside.contains(target)) return;
    if (target.closest("#sidebarResizeHandle")) return;
    if (window.innerWidth < MOBILE_BREAKPOINT) closeSidebar();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) closeSidebar();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSidebar();
  });
}

/**
 * Isi #chatList dengan riwayat chat. Dipakai halaman NON-chat supaya riwayat
 * tetap kelihatan di sidebar walau sedang membuka Projects/Documents/Memory
 * (lihat #3). Link mengarah ke chat.html?chatId=... (navigasi biasa, reload
 * halaman penuh) — cukup untuk halaman-halaman ini karena mereka memang bukan
 * konteks chat aktif.
 */
export async function loadSidebarHistory(activeChatId = null) {
  const listEl = document.getElementById("chatList");
  if (!listEl) return;
  try {
    const chats = await callApi("getChatHistory", { limit: 30 });
    if (!chats?.length) {
      listEl.innerHTML = `<p class="px-3 text-xs text-ink-500/70">Belum ada percakapan</p>`;
      return;
    }
    listEl.innerHTML = chats.map((c) => `
      <a href="chat.html?chatId=${encodeURIComponent(c.id)}"
         class="flex flex-col gap-0.5 px-3 py-2 rounded-md text-xs truncate ${c.id === activeChatId ? "bg-paper-100 text-ink-900 font-semibold" : "text-ink-700 hover:bg-paper-100 hover:text-ink-900"}">
        <span class="truncate">${escapeHtml(c.title || "Percakapan tanpa judul")}</span>
        <span class="text-[10px] font-mono text-ink-500/70">${escapeHtml(formatRelativeTime(c.updatedAt || c.createdAt))}</span>
      </a>`).join("");
  } catch {
    listEl.innerHTML = `<p class="px-3 text-xs text-clay-500">Gagal memuat riwayat</p>`;
  }
}
