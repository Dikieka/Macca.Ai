// assets/js/pages/chat.js
// Halaman ini juga berperan sebagai "beranda" (dulu dashboard.html terpisah):
// tanpa ?chatId, tampil sapaan + quick actions + proyek terbaru (lihat #emptyState di chat.html).
import { requireAuth, logout } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading } from "../lib/state.js";
import { escapeHtml, formatRelativeTime, markActiveSidebarLink, applyRoleBasedNav, fileIconFor, renderFormattedText, renderMarkdownToWordHtml } from "../lib/render.js";
import { prepareFileForUpload, formatBytes } from "../lib/upload.js";
import { initSidebarResize, initSidebarMobile } from "../lib/sidebar.js";
import { getCachedChatHistory, setCachedChatHistory } from "../lib/historyCache.js";
import { getCached, setCached } from "../lib/apiCache.js";

const session = requireAuth();
let currentChatId = new URLSearchParams(window.location.search).get("chatId");
// Kalau dibuka dari halaman proyek (project.html -> "Mulai chat di proyek ini"),
// chat baru langsung terikat ke proyek itu (lihat #4: dokumen/memory proyek
// tetap terpisah dari chat umum karena RAG di-scope by projectId di chat.gs).
let activeProjectId = new URLSearchParams(window.location.search).get("projectId") || null;
let pendingFile = null;
let pendingPreviewUrl = null; // object URL lokal, hanya untuk foto, dibuat saat file dipilih
/**
 * PERBAIKAN #8 (upload lampiran dipindah ke saat file dipilih, bukan saat Kirim):
 * Sebelumnya file baru mulai diunggah SETELAH user menekan tombol Kirim (di dalam
 * handleSend), jadi ada jeda "menunggu upload" tepat di tengah proses kirim pesan.
 * Sekarang upload langsung dimulai begitu file dipilih/di-drop (lihat setPendingFile
 * -> startPendingUpload), dan tombol Kirim DIKUNCI (disabled) selama status upload
 * masih "uploading" — lihat updateSendAvailability(). Begitu upload selesai (attachmentId
 * didapat), baru tombol Kirim aktif lagi dan handleSend tinggal memakai attachmentId
 * yang sudah ada, tanpa perlu upload ulang.
 * Shape: { file, status: "uploading"|"done"|"error", attachmentId, storageWarning, controller, error } | null
 */
let pendingUploadState = null;
let selectedModel = localStorage.getItem("macca_preferred_model") || "";
// #5 (stop generate ala ChatGPT): hanya satu proses generate yang boleh berjalan
// dalam satu waktu (composer, edit, ATAU regenerate) — lihat beginGeneration().
let activeGeneration = null; // { controller: AbortController, stopTypingRequested: boolean } | null

// PERBAIKAN (riwayat chat "loading" tanpa henti, ReferenceError di console):
// chatListCache sebelumnya dideklarasikan dengan `let` di dekat kode sidebar
// (jauh di bawah file ini), TAPI init() dipanggil segera di baris berikutnya
// dan langsung memanggil loadChatList() -> membaca chatListCache. Karena
// `let` masuk temporal dead zone sampai baris deklarasinya benar-benar
// dieksekusi, dan saat init() jalan duluan (module masih di awal file),
// engine belum "sampai" ke deklarasi aslinya -> ReferenceError: Cannot access
// 'chatListCache' before initialization. Error ini terjadi di dalam promise
// (loadChatList itu async) sehingga TIDAK muncul sebagai dialog/alert, cuma
// menghentikan loadChatList() di tengah jalan secara diam-diam -> skeleton
// animate-pulse di #chatList tidak pernah diganti isinya. Fix: pindahkan
// deklarasinya ke sini, SEBELUM init() dipanggil. (Deklarasi ganda di bawah,
// dekat kode sidebar chat list, sudah dihapus supaya tidak dobel.)
let chatListCache = getCachedChatHistory() || [];

if (session) init();

async function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  bindComposer();
  bindComposerAutoCollapse();
  bindHeaderActions();
  bindNewChat();
  bindLogout();
  bindQuickActions();
  bindModelPicker();
  bindMessageActions();
  bindTableScrollHint();
  bindStopButton();
  renderGreeting();
  if (activeProjectId && !currentChatId) showProjectBadge(activeProjectId);
  // PERBAIKAN: loadChatList() (isi sidebar) dan loadChat()/loadRecentProjects()
  // (isi area utama) tidak saling bergantung, tapi sebelumnya dijalankan
  // berurutan (await satu-satu) sehingga isi chat baru mulai dimuat SETELAH
  // sidebar selesai fetch. Sekarang keduanya jalan BERSAMAAN — hasil akhirnya
  // identik, cuma lebih cepat kelihatan. loadChatList() juga sudah render
  // instan dari cache (lihat fungsi di bawah) jadi sidebar tidak lagi nge-blank
  // dulu sebelum diisi.
  const chatListPromise = loadChatList();
  if (currentChatId) {
    await loadChat(currentChatId);
  } else {
    loadRecentProjects();
  }
  await chatListPromise;
}

function showProjectBadge(projectId) {
  const indicator = document.getElementById("projectIndicator");
  if (!indicator) return;
  indicator.classList.remove("hidden");
  indicator.classList.add("flex");
  indicator.querySelector("span").textContent = "Proyek aktif";
}

// ---------- Beranda / empty state (eks dashboard.js) ----------
function renderGreeting() {
  const hour = new Date().getHours();
  const part = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 19 ? "Selamat sore" : "Selamat malam";
  const name = session.user?.fullName?.split(" ")[0] || "";
  const greetingEl = document.getElementById("greeting");
  if (greetingEl) greetingEl.textContent = `${part}${name ? ", " + name : ""}.`;
  document.getElementById("userName").textContent = session.user?.fullName || session.user?.email || "Pengguna";
  document.getElementById("avatarInitial").textContent = (session.user?.fullName || "U").charAt(0).toUpperCase();
}

/**
 * PENTING (perbaikan bug #1 "logout tidak bisa diklik"): sebelumnya listener
 * dipasang langsung ke elemen <i data-lucide="log-out">. Masalahnya, tiap kali
 * lucide.createIcons() dipanggil ulang (dan itu terjadi berkali-kali: tiap
 * render daftar chat, tiap pesan terkirim/diterima), lucide MENGGANTI elemen
 * itu dengan elemen <svg> BARU (lihat replaceElement di lucide) — jadi node
 * yang listener-nya terpasang jadi "yatim" dan hilang dari DOM, tombolnya
 * kelihatan tapi klik tidak terdaftar lagi. Solusinya: event delegation di
 * elemen yang TIDAK PERNAH diganti (di sini: document), lalu dicek target-nya
 * saat event terjadi. Ini otomatis tahan terhadap render ulang icon kapan pun.
 */
/**
 * Tabel hasil balasan AI di layar sempit (mobile) di-scroll horizontal, bukan
 * diperas kolomnya (lihat .msg-table-wrap di style.css). Supaya user sadar ada
 * konten tersembunyi di sisi kanan, wrap-nya punya gradient fade tipis di tepi
 * kanan lewat CSS ::after — fungsi ini yang menghilangkan gradient itu begitu
 * user sudah scroll sampai ujung (class .is-scrolled-end).
 *
 * Event "scroll" TIDAK bubble secara normal, jadi delegation di sini pakai fase
 * capture (addEventListener(..., true)) di #messages — itu satu-satunya cara
 * event delegation bekerja untuk scroll, dan otomatis mencakup tabel yang baru
 * muncul belakangan lewat animasi ketik (typeOutReply), tanpa perlu daftar
 * ulang listener tiap kali ada balasan baru.
 */
function bindTableScrollHint() {
  const container = document.getElementById("messages");
  if (!container) return;
  const checkEnd = (wrap) => {
    const atEnd = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
    wrap.classList.toggle("is-scrolled-end", atEnd || wrap.scrollWidth <= wrap.clientWidth);
  };
  container.addEventListener("scroll", (e) => {
    const wrap = e.target.closest?.(".msg-table-wrap");
    if (wrap) checkEnd(wrap);
  }, true);
  // Cek status awal tiap kali ada tabel baru ditambahkan (tabel pendek yang
  // sudah muat penuh tidak perlu gradient sama sekali).
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        node.querySelectorAll?.(".msg-table-wrap").forEach(checkEnd);
        if (node.matches?.(".msg-table-wrap")) checkEnd(node);
      });
    }
  }).observe(container, { childList: true, subtree: true });
}

function bindLogout() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#logoutIcon")) {
      e.stopPropagation();
      e.preventDefault();
      logout("login.html");
    }
  });
}

function bindModelPicker() {
  const select = document.getElementById("modelPicker");
  if (!select) return;

  // PERBAIKAN cache: daftar model jarang berubah (cuma kalau admin ubah lewat
  // panel admin), tapi sebelumnya di-fetch ulang dari Apps Script SETIAP kali
  // chat.html dibuka. Sekarang tampilkan cache dulu (instan, dropdown langsung
  // terisi), lalu tetap fetch listModels seperti biasa di background supaya
  // kalau admin baru saja ubah model, halaman tetap dapat data terbaru.
  const cachedModels = getCached("models");
  if (cachedModels) renderModelOptions_(select, cachedModels);

  callApi("listModels", {})
    .then((models) => {
      setCached("models", models);
      renderModelOptions_(select, models);
    })
    .catch(() => {
      if (!cachedModels) select.innerHTML = `<option value="">Otomatis (disarankan)</option>`;
    });

  select.addEventListener("change", () => {
    selectedModel = select.value;
    localStorage.setItem("macca_preferred_model", selectedModel);
  });
}

function renderModelOptions_(select, models) {
  select.innerHTML = `<option value="">Otomatis (disarankan)</option>` +
    models.map((m) => `<option value="${escapeHtml(m.modelSlug)}">${escapeHtml(m.modelSlug)}${m.free ? " · gratis" : ""}</option>`).join("");
  select.value = selectedModel;
}

function bindQuickActions() {
  document.querySelectorAll(".quick-action").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("composerInput").value = btn.dataset.prompt;
      document.getElementById("composerInput").focus();
    });
  });
}

function renderRecentProjects_(el, projects) {
  if (!projects?.length) {
    el.innerHTML = `<p class="text-sm text-ink-500 col-span-2">Belum ada proyek. <a href="projects.html" class="underline">Buat proyek pertamamu</a>.</p>`;
    return;
  }
  el.innerHTML = projects.map((p) => `
    <a href="project.html?projectId=${encodeURIComponent(p.id)}" class="doc-card p-5 block hover:-translate-y-0.5 transition-transform">
      <p class="font-display font-semibold text-ink-900">${escapeHtml(p.name)}</p>
      <p class="text-xs text-ink-500 mt-1">${escapeHtml(p.type || "Proyek")} · ${formatRelativeTime(p.updatedAt)}</p>
    </a>`).join("");
}

async function loadRecentProjects() {
  const el = document.getElementById("recentProjects");
  if (!el) return;

  // PERBAIKAN cache: sama seperti daftar model, proyek jarang berubah dalam
  // rentang beberapa menit, jadi tampilkan cache dulu (instan) lalu tetap
  // fetch getProjects di background untuk validasi. Key "projects_recent"
  // dipisah dari daftar lengkap di halaman Projects (lihat projects.js)
  // karena ini limit 4, bukan semua proyek.
  const cached = getCached("projects_recent");
  if (cached) renderRecentProjects_(el, cached);

  try {
    const projects = await callApi("getProjects", { limit: 4 });
    setCached("projects_recent", projects);
    renderRecentProjects_(el, projects);
  } catch {
    if (!cached) el.innerHTML = `<p class="text-sm text-clay-500 col-span-2">Gagal memuat proyek.</p>`;
  }
}

// ---------- Sidebar chat list ----------
// PERBAIKAN cache (stale-while-revalidate, lihat lib/historyCache.js): begitu
// chat.html dibuka (termasuk lewat navigasi dari halaman lain), tampilkan dulu
// riwayat dari cache sessionStorage (instan, tidak ada skeleton), lalu tetap
// fetch getChatHistory seperti biasa untuk memastikan akurat. Cache-nya
// otomatis ikut ter-update tiap kali renderChatList() dipanggil (lihat di
// bawah), jadi setiap aksi yang sudah ada (kirim pesan, hapus, ganti judul,
// dst) tetap bekerja sama persis seperti sebelumnya — cuma sekalian nulis ke
// cache supaya halaman BERIKUTNYA yang dibuka juga dapat data terbaru instan.
// (chatListCache dideklarasikan di dekat init() di atas file — lihat catatan
// di sana soal kenapa harus di situ, bukan di sini.)

async function loadChatList() {
  const listEl = document.getElementById("chatList");
  if (chatListCache.length) renderChatList(); // paint instan dari cache dulu, kalau ada
  try {
    const chats = await callApi("getChatHistory", { limit: 30 });
    chatListCache = chats || [];
    renderChatList();
  } catch {
    // Sama seperti sidebar.js: kalau sudah sempat render dari cache, biarkan
    // tetap tampil (gagal revalidate tidak menghapus apa yang sudah kelihatan).
    if (!chatListCache.length) {
      listEl.innerHTML = `<p class="px-3 text-xs text-clay-500">Gagal memuat riwayat</p>`;
    }
  }
}

function renderChatList() {
  const listEl = document.getElementById("chatList");
  setCachedChatHistory(chatListCache);
  if (!chatListCache.length) {
    listEl.innerHTML = `<p class="px-3 text-xs text-ink-500/70">Belum ada percakapan</p>`;
    return;
  }
  listEl.innerHTML = chatListCache.map((c) => `
    <div class="group relative flex items-center rounded-md ${c.id === currentChatId ? "bg-paper-100" : "hover:bg-paper-100"}">
      <a href="chat.html?chatId=${encodeURIComponent(c.id)}" data-chat-link="${escapeHtml(c.id)}"
         class="flex-1 min-w-0 px-3 py-2 text-xs truncate ${c.id === currentChatId ? "text-ink-900 font-semibold" : "text-ink-700"}">
        ${escapeHtml(c.title || "Percakapan tanpa judul")}
      </a>
      <button type="button" data-delete-chat="${escapeHtml(c.id)}" title="Hapus percakapan"
        class="hidden group-hover:flex shrink-0 w-6 h-6 mr-1.5 items-center justify-center rounded text-ink-500 hover:text-clay-500 hover:bg-paper-200">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>`).join("");
  lucide.createIcons();

  // Navigasi tanpa reload halaman penuh -> jauh lebih cepat & bisa dikasih loading state instan.
  listEl.querySelectorAll("[data-chat-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const chatId = link.dataset.chatLink;
      if (chatId === currentChatId) return;
      currentChatId = chatId;
      history.pushState({}, "", `chat.html?chatId=${encodeURIComponent(chatId)}`);
      renderChatList();
      loadChat(chatId);
    });
  });

  listEl.querySelectorAll("[data-delete-chat]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const chatId = btn.dataset.deleteChat;
      if (!confirm("Hapus percakapan ini? Tindakan ini tidak bisa dibatalkan.")) return;
      try {
        await callApi("deleteChat", { chatId });
        chatListCache = chatListCache.filter((c) => c.id !== chatId);
        if (chatId === currentChatId) {
          resetToNewChat();
        }
        renderChatList();
        showToast("Percakapan dihapus.", "success");
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal menghapus chat.", "error");
      }
    });
  });
}

function resetToNewChat() {
  currentChatId = null;
  activeProjectId = null;
  document.getElementById("messages").innerHTML = "";
  document.getElementById("chatLoading").classList.add("hidden");
  document.getElementById("emptyState").classList.remove("hidden");
  document.getElementById("chatTitle").textContent = "Percakapan Baru";
  document.getElementById("projectIndicator").classList.add("hidden");
  document.getElementById("modelIndicator").classList.add("hidden");
  history.pushState({}, "", "chat.html");
  renderGreeting();
  loadRecentProjects();
}

function bindNewChat() {
  document.getElementById("newChatBtn").addEventListener("click", resetToNewChat);
}

// ---------- Load existing chat ----------
async function loadChat(chatId) {
  const emptyState = document.getElementById("emptyState");
  const container = document.getElementById("messages");
  const loadingEl = document.getElementById("chatLoading");

  // Tampilkan loading SEGERA (sebelum request selesai) supaya user tahu masih memuat,
  // bukan diam tanpa umpan balik seperti sebelumnya.
  emptyState.classList.add("hidden");
  container.innerHTML = "";
  loadingEl.classList.remove("hidden");
  document.getElementById("chatTitle").textContent = "Memuat…";

  try {
    const { chat, messages } = await callApi("getChatHistory", { chatId });
    if (chat.id !== currentChatId) return; // user sudah pindah ke chat lain sebelum respons ini datang

    document.getElementById("chatTitle").textContent = chat.title || "Percakapan tanpa judul";
    const indicator = document.getElementById("projectIndicator");
    if (chat.projectId) {
      indicator.classList.remove("hidden");
      indicator.classList.add("flex");
      indicator.querySelector("span").textContent = chat.projectId;
    } else {
      indicator.classList.add("hidden");
    }
    document.getElementById("modelIndicator").classList.add("hidden");

    container.innerHTML = "";
    messages.forEach((m) => {
      // Riwayat lampiran (perbaikan: quickview juga tampil saat chat lama dibuka lagi,
      // bukan cuma saat baru dikirim) — lihat attachment_* di messages.gs schema.
      const attachment = m.attachmentId
        ? {
            name: m.attachmentName || "Lampiran",
            type: m.attachmentType || "",
            isImage: String(m.attachmentType || "").startsWith("image/"),
            previewUrl: m.attachmentUrl,
            uploading: false,
          }
        : null;
      appendMessage(m.role, m.content, false, attachment, m.id);
    });
    scrollToBottom();
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : "Gagal memuat chat.", "error");
    document.getElementById("chatTitle").textContent = "Percakapan Baru";
  } finally {
    loadingEl.classList.add("hidden");
  }
}

// Dukung tombol back/forward browser walau navigasi kini tanpa reload penuh.
window.addEventListener("popstate", () => {
  const chatId = new URLSearchParams(window.location.search).get("chatId");
  currentChatId = chatId;
  renderChatList();
  if (chatId) loadChat(chatId);
  else resetToNewChat();
});

// ---------- Composer ----------
function bindComposer() {
  const form = document.getElementById("composerForm");
  const input = document.getElementById("composerInput");

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
      return;
    }
    // Shift+Enter = baris baru di dalam textarea ini (lihat handler di atas).
    // Auto-lanjutkan format list (mirip Google Docs/Notion): kalau baris yang
    // sedang dikerjakan diawali "- "/"* " (bullet), "1. " (angka), atau
    // "a. " (huruf), baris baru otomatis diberi penanda berikutnya, supaya
    // user tidak perlu mengetik ulang penanda tiap baris.
    if (e.key === "Enter" && e.shiftKey) {
      if (handleSmartListContinue_(input)) e.preventDefault();
    }
  });

  // Auto-resize: tinggi kotak mengikuti panjang teks, biar tidak kaku 2 baris terus.
  const autoResize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  };
  input.addEventListener("input", autoResize);
  autoResize();

  bindAttachMenu();
  bindDragAndDrop();
  bindPasteImage(input);

  document.getElementById("removeAttachment").addEventListener("click", () => {
    clearPendingFile();
    ["fileInput", "photoInput", "cameraInput"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("attachmentPreview").classList.add("hidden");
  });

  form.addEventListener("submit", handleSend);
}

/**
 * Perbaikan responsif mobile: composer (kotak ketik + tombol-tombolnya) otomatis
 * mengecil saat user menggeser (scroll) area pesan ke bawah, supaya layar HP yang
 * sempit punya lebih banyak ruang untuk membaca chat. Begitu user scroll ke atas
 * lagi, mendekati dasar chat, atau fokus ke composer untuk mengetik, ukurannya
 * dikembalikan normal. Hanya aktif di breakpoint mobile (lihat media query
 * .composer-compact di style.css) — di desktop class ini sengaja tidak berefek apa pun,
 * ruang layar sudah cukup lega jadi tidak perlu mengecil.
 */
function bindComposerAutoCollapse() {
  const scrollEl = document.getElementById("messageList");
  const composerBar = document.getElementById("composerBar");
  const input = document.getElementById("composerInput");
  if (!scrollEl || !composerBar) return;

  const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
  let lastScrollTop = scrollEl.scrollTop;
  let ticking = false;

  function evaluate() {
    ticking = false;
    if (!isMobile()) { composerBar.classList.remove("composer-compact"); return; }

    const current = scrollEl.scrollTop;
    const delta = current - lastScrollTop;
    const distanceFromBottom = scrollEl.scrollHeight - current - scrollEl.clientHeight;

    if (distanceFromBottom < 40) {
      // Sudah (hampir) di dasar chat -> selalu tampilkan composer penuh, ini titik
      // di mana user paling mungkin ingin langsung mengetik balasan berikutnya.
      composerBar.classList.remove("composer-compact");
    } else if (delta > 6) {
      // Scroll ke bawah (menjauhi pesan terbaru, membaca riwayat) -> kecilkan.
      composerBar.classList.add("composer-compact");
    } else if (delta < -6) {
      // Scroll ke atas -> kembalikan ukuran normal.
      composerBar.classList.remove("composer-compact");
    }
    lastScrollTop = current;
  }

  scrollEl.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(evaluate);
  }, { passive: true });

  // User mau mengetik -> jangan biarkan composer dalam keadaan mengecil.
  input.addEventListener("focus", () => composerBar.classList.remove("composer-compact"));

  window.addEventListener("resize", () => { if (!isMobile()) composerBar.classList.remove("composer-compact"); });
}

const SMART_BULLET_RE = /^(\s*)([-*•])(\s+)(.*)$/;
const SMART_NUMBERED_RE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;
const SMART_LETTERED_RE = /^(\s*)([A-Za-z])([.)])(\s+)(.*)$/;

/**
 * Dipanggil saat Shift+Enter ditekan di composer. Kalau baris tempat kursor
 * berada saat ini adalah item list (bullet/angka/huruf), sisipkan baris baru
 * dengan penanda berikutnya secara otomatis. Return true kalau ditangani
 * (supaya pemanggil tahu harus preventDefault dan tidak biarkan browser
 * menyisipkan newline polos juga).
 */
function handleSmartListContinue_(textarea) {
  const { value, selectionStart } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selectionStart);
  const currentLine = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);

  let insert;
  let bulletMatch = currentLine.match(SMART_BULLET_RE);
  let numberedMatch = currentLine.match(SMART_NUMBERED_RE);
  let letteredMatch = currentLine.match(SMART_LETTERED_RE);

  if (bulletMatch) {
    const [, indent, marker, gap, text] = bulletMatch;
    if (text.trim() === "") return removeListMarker_(textarea, lineStart, selectionStart);
    insert = `\n${indent}${marker}${gap}`;
  } else if (numberedMatch) {
    const [, indent, num, punct, gap, text] = numberedMatch;
    if (text.trim() === "") return removeListMarker_(textarea, lineStart, selectionStart);
    insert = `\n${indent}${parseInt(num, 10) + 1}${punct}${gap}`;
  } else if (letteredMatch) {
    const [, indent, letter, punct, gap, text] = letteredMatch;
    if (text.trim() === "") return removeListMarker_(textarea, lineStart, selectionStart);
    const isUpper = letter === letter.toUpperCase();
    const nextCode = letter.toLowerCase().charCodeAt(0) + 1;
    if (nextCode > "z".charCodeAt(0)) return false; // sudah "z", jangan lanjut ke simbol aneh
    const nextLetter = String.fromCharCode(nextCode);
    insert = `\n${indent}${isUpper ? nextLetter.toUpperCase() : nextLetter}${punct}${gap}`;
  } else {
    return false; // bukan baris list, biarkan Shift+Enter berperilaku normal
  }

  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionStart);
  textarea.value = before + insert + after;
  const caret = selectionStart + insert.length;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true })); // trigger auto-resize
  return true;
}

/** Enter kedua di item list kosong -> hapus penanda, keluar dari mode list (bukan tambah item kosong). */
function removeListMarker_(textarea, lineStart, selectionStart) {
  const { value } = textarea;
  textarea.value = value.slice(0, lineStart) + value.slice(selectionStart);
  textarea.setSelectionRange(lineStart, lineStart);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// ---------- Menu unggah: dokumen / foto / kamera (mirip composer ChatGPT/Claude) ----------
/**
 * PENTING (perbaikan bug "Unggah dokumen tidak muncul"): #attachMenu awalnya dirender
 * sebagai child #composerForm (posisinya `position: absolute`) supaya nongol di atas
 * tombol "+". Masalahnya #composerForm punya class `doc-card` yang pakai CSS `clip-path`
 * (efek sudut potong ala sticky note) — clip-path memotong SEMUA konten di dalam elemen
 * itu, termasuk descendant absolute yang sengaja "keluar kotak", beda dengan
 * `overflow: hidden` yang bisa dioverride. Akibatnya bagian atas menu (item "Unggah
 * dokumen", paling atas & paling jauh melewati batas kotak) ikut terpotong walau
 * HTML/JS-nya sendiri sudah benar.
 * Fix: pindahkan #attachMenu ke document.body saat dibuka (portal pattern) dan posisikan
 * dengan `position: fixed` berdasarkan koordinat layar tombol "+", supaya lolos dari
 * clip-path ancestor manapun.
 */
function bindAttachMenu() {
  const menuBtn = document.getElementById("attachMenuBtn");
  const menu = document.getElementById("attachMenu");

  // Pindahkan sekali ke <body> dan ganti ke position:fixed; toggle hidden tetap sama.
  document.body.appendChild(menu);
  menu.classList.remove("absolute", "bottom-11", "left-0");
  menu.style.position = "fixed";

  const positionMenu = () => {
    const rect = menuBtn.getBoundingClientRect();
    const menuHeight = menu.offsetHeight || 132; // estimasi sebelum menu sempat diukur browser
    menu.style.left = rect.left + "px";
    menu.style.top = (rect.top - menuHeight - 8) + "px"; // 8px gap di atas tombol
  };

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.classList.contains("hidden");
    if (willOpen) positionMenu();
    menu.classList.toggle("hidden");
    if (willOpen) positionMenu(); // hitung ulang setelah menu terlihat & offsetHeight akurat
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== menuBtn) menu.classList.add("hidden");
  });
  window.addEventListener("resize", () => { if (!menu.classList.contains("hidden")) positionMenu(); });
  document.getElementById("messageList").addEventListener("scroll", () => menu.classList.add("hidden"));

  const onPick = (fileInput) => {
    const file = fileInput.files[0];
    if (!file) return;
    setPendingFile(file);
    menu.classList.add("hidden");
  };

  ["fileInput", "photoInput", "cameraInput"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("change", () => onPick(el));
  });
}

/**
 * Drag & drop file ke area chat (mirip ChatGPT/Claude): user bisa menyeret file
 * dari luar browser (Explorer/Finder) langsung ke area <main>, tidak wajib klik
 * tombol "+" dulu. Pakai counter dragenter/dragleave (bukan cuma toggle di kedua
 * event itu) karena dragleave ikut menyala setiap kali pointer masuk/keluar
 * elemen ANAK di dalam <main> juga — tanpa counter, overlay akan "berkedip"
 * hilang-muncul saat file diseret melintasi header/pesan/composer di dalamnya.
 */
function bindDragAndDrop() {
  const dropZone = document.querySelector("main");
  const overlay = document.getElementById("dropOverlay");
  if (!dropZone || !overlay) return;
  let dragCounter = 0;

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  const showOverlay = () => { overlay.classList.remove("hidden"); overlay.classList.add("flex"); };
  const hideOverlay = () => { overlay.classList.add("hidden"); overlay.classList.remove("flex"); };

  dropZone.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter++;
    showOverlay();
  });
  dropZone.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // wajib, kalau tidak browser akan menolak event "drop"
  });
  dropZone.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) hideOverlay();
  });
  dropZone.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    hideOverlay();
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) showToast("Hanya file pertama yang dilampirkan — kirim satu per satu untuk file lainnya.", "info");
    setPendingFile(files[0]);
    document.getElementById("composerInput")?.focus();
  });

  // Jaring pengaman: kalau file "lolos" ter-drop di luar <main> (mis. sidebar) atau
  // meleset dari overlay, cegah browser membuka file itu sebagai halaman baru/navigasi
  // (perilaku default browser untuk drag file ke jendela manapun).
  ["dragover", "drop"].forEach((evt) => {
    window.addEventListener(evt, (e) => { if (hasFiles(e)) e.preventDefault(); });
  });
}

/**
 * Ctrl+V / Cmd+V gambar langsung ke composer (mirip ChatGPT/Claude desktop): user
 * screenshot lalu paste tanpa harus save-as file dulu. Dipasang di textarea composer
 * (bukan document) supaya tidak "mencuri" event paste dari input lain di halaman
 * (mis. modal rename/edit pesan yang juga punya textarea sendiri).
 *
 * clipboardData.items dari gambar yang di-paste biasanya berupa Blob tanpa nama file
 * (type doang, mis. "image/png"), jadi dibungkus ulang jadi File dengan nama+ekstensi
 * yang jelas supaya konsisten dengan alur upload file biasa (fileIconFor, formatBytes, dst).
 * Hanya ambil gambar PERTAMA yang ditemukan di clipboard, selaras dengan batasan "satu
 * lampiran per pesan" yang sama seperti pada drag & drop (lihat bindDragAndDrop()).
 */
function bindPasteImage(input) {
  input.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items || !items.length) return;

    const imageItem = Array.from(items).find((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!imageItem) return; // bukan gambar (mis. teks biasa) -> biarkan paste default jalan

    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;

    if (pendingFile) {
      showToast("Sudah ada lampiran di pesan ini — hapus dulu sebelum menempel gambar baru.", "info");
      return;
    }

    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const pastedFile = new File([blob], `tempelan-${Date.now()}.${ext}`, { type: blob.type });
    setPendingFile(pastedFile);
    showToast("Gambar dari clipboard dilampirkan.", "success");
  });
}

/** Quickview di composer (perbaikan: preview thumbnail foto / ikon dokumen sebelum dikirim). */
function setPendingFile(file) {
  clearPendingFile();
  pendingFile = file;
  renderPendingFilePreview_(file);
  // #8: upload dimulai SEKARANG juga, bukan menunggu tombol Kirim ditekan.
  startPendingUpload(file);
}

/** Render bagian visual quickview saja (dipakai setPendingFile & restore setelah Stop ditekan). */
function renderPendingFilePreview_(file) {
  const isImage = file.type.startsWith("image/");
  if (isImage) pendingPreviewUrl = URL.createObjectURL(file);

  const img = document.getElementById("attachmentThumbImg");
  const icon = document.getElementById("attachmentThumbIcon");
  if (isImage) {
    img.src = pendingPreviewUrl;
    img.classList.remove("hidden");
    icon.classList.add("hidden");
  } else {
    img.classList.add("hidden");
    icon.classList.remove("hidden");
    icon.setAttribute("data-lucide", fileIconFor(file.name));
  }
  document.getElementById("attachmentName").textContent = file.name;
  document.getElementById("attachmentStatus").textContent = formatBytes(file.size);
  document.getElementById("attachmentPreview").classList.remove("hidden");
  document.getElementById("attachmentPreview").classList.add("flex");
  lucide.createIcons();
}

/**
 * #8: dipakai saat Stop ditekan setelah lampiran SUDAH SELESAI terunggah (attachmentId
 * sudah ada) — kembalikan file ke composer TANPA mengunggah ulang, supaya user bisa
 * langsung kirim lagi tanpa menunggu upload kedua kali untuk file yang sama.
 */
function restorePendingFileAlreadyUploaded_(file, attachmentId, storageWarning) {
  pendingFile = file;
  renderPendingFilePreview_(file);
  document.getElementById("attachmentProgressOverlay")?.classList.add("hidden");
  document.getElementById("attachmentStatus").textContent = formatBytes(file.size) + " · Siap dikirim";
  pendingUploadState = { file, status: "done", attachmentId, storageWarning, controller: null, error: null };
  updateSendAvailability();
}

/**
 * #8: jalankan kompresi/ekstraksi + upload ke server segera setelah file dipilih,
 * dengan progress ditampilkan langsung di quickview composer (bukan di bubble chat
 * lagi, karena bubble belum ada di titik ini — pesan belum dikirim). Mengunci tombol
 * Kirim (lewat updateSendAvailability) selama status masih "uploading".
 */
async function startPendingUpload(file) {
  const controller = new AbortController();
  const state = { file, status: "uploading", attachmentId: null, storageWarning: null, controller, error: null };
  pendingUploadState = state;

  const overlay = document.getElementById("attachmentProgressOverlay");
  const ring = document.getElementById("attachmentProgressRing");
  const statusEl = document.getElementById("attachmentStatus");
  const nameEl = document.getElementById("attachmentName");

  const setProgress = (percent) => {
    if (!ring) return;
    const c = 2 * Math.PI * 15.5;
    ring.style.strokeDasharray = String(c);
    ring.style.strokeDashoffset = String(c * (1 - percent / 100));
  };
  const setStatus = (label) => { if (statusEl) statusEl.textContent = label; };

  overlay?.classList.remove("hidden");
  nameEl?.classList.remove("text-clay-500");
  statusEl?.classList.remove("text-clay-500");
  setProgress(0);
  setStatus("Menyiapkan file…");
  updateSendAvailability();

  // Progress simulasi: fetch() browser belum dukung upload progress byte asli
  // secara luas (lihat catatan panjang di uploadDocument sebelumnya) — naik
  // bertahap mendekati 90%, baru lompat ke 100% saat respons server diterima.
  let simulated = 0;
  const timer = setInterval(() => {
    simulated = Math.min(90, simulated + (90 - simulated) * 0.2 + 1);
    setProgress(Math.round(simulated));
  }, 200);

  try {
    const prepped = await prepareFileForUpload(file, { onStatus: setStatus });
    if (pendingUploadState !== state) return; // file sudah diganti/dihapus sebelum ekstraksi selesai

    setStatus("Mengunggah…");
    const result = await callApi(
      "uploadDocument",
      {
        fileName: prepped.file.name,
        mimeType: prepped.file.type,
        base64Data: prepped.base64Data,
        extractedText: prepped.extractedText,
        originalSize: prepped.originalSize,
        isCompressed: prepped.isCompressed,
        projectId: activeProjectId || "",
      },
      { signal: controller.signal }
    );
    if (pendingUploadState !== state) return; // dibatalkan tepat sebelum respons datang

    clearInterval(timer);
    setProgress(100);
    state.status = "done";
    state.attachmentId = result.document.id;
    state.storageWarning = result.storage?.isWarning ? result.storage : null;
    overlay?.classList.add("hidden");
    setStatus(formatBytes(prepped.file.size) + (prepped.isCompressed ? " · dikompres" : "") + " · Siap dikirim");

    if (!prepped.extractedText && !file.type.startsWith("image/")) {
      showToast("Teks dokumen tidak bisa diekstrak otomatis (format tidak didukung). File tetap tersimpan.", "info");
    }
  } catch (err) {
    clearInterval(timer);
    if (pendingUploadState !== state) return;
    if (err instanceof ApiError && err.code === "ABORTED") return; // dibatalkan sengaja (ganti/hapus file), bukan error

    state.status = "error";
    state.error = err instanceof ApiError || err instanceof Error ? err.message : "Gagal mengunggah file.";
    overlay?.classList.add("hidden");
    nameEl?.classList.add("text-clay-500");
    statusEl?.classList.add("text-clay-500");
    setStatus(state.error);
    showToast(state.error, "error");
  } finally {
    clearInterval(timer);
    updateSendAvailability();
  }
}

/** #8: tombol Kirim dikunci selama masih ada lampiran yang statusnya "uploading". */
function updateSendAvailability() {
  const sendBtn = document.getElementById("sendBtn");
  if (!sendBtn) return;
  const uploading = pendingUploadState?.status === "uploading";
  sendBtn.disabled = uploading;
  sendBtn.classList.toggle("opacity-50", uploading);
  sendBtn.classList.toggle("cursor-not-allowed", uploading);
}

function clearPendingFile() {
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingFile = null;
  pendingPreviewUrl = null;
  // #8: kalau ada upload yang masih berjalan (mis. user ganti/hapus file di tengah
  // upload sebelumnya), batalkan request-nya supaya tidak "menempel" jadi lampiran
  // pesan berikutnya secara keliru.
  if (pendingUploadState?.status === "uploading") pendingUploadState.controller.abort();
  pendingUploadState = null;
  updateSendAvailability();
}

async function handleSend(e) {
  e.preventDefault();
  if (activeGeneration) return showToast("Tunggu balasan sebelumnya selesai, atau tekan Stop dulu.", "info");

  // #8: lampiran WAJIB sudah 100% terunggah sebelum prompt boleh dikirim. Ini jaring
  // pengaman kedua (yang pertama: tombol Kirim sudah di-disable oleh updateSendAvailability
  // selama status masih "uploading") — penting karena Enter juga memicu submit form,
  // dan atribut disabled pada tombol tidak mencegah form.requestSubmit() dari kode lain.
  if (pendingUploadState?.status === "uploading") {
    return showToast("Tunggu lampiran selesai diunggah (100%) dulu sebelum mengirim pesan.", "info");
  }
  if (pendingUploadState?.status === "error") {
    return showToast("Lampiran gagal diunggah. Hapus lampiran (×) atau pilih ulang filenya sebelum mengirim.", "error");
  }

  const input = document.getElementById("composerInput");
  const text = input.value.trim();
  if (!text && !pendingFile) return;

  document.getElementById("emptyState").classList.add("hidden");

  const file = pendingFile;
  const isImage = file ? file.type.startsWith("image/") : false;
  // Simpan preview URL SEBELUM clearPendingFile() menghapusnya, supaya bubble
  // pesan yang baru saja dikirim tetap bisa menampilkan thumbnail foto.
  const localPreviewUrl = isImage ? pendingPreviewUrl : null;
  // #8: attachmentId sudah didapat SEBELUM titik ini (upload selesai duluan saat file
  // dipilih), jadi tinggal dipakai langsung — tidak ada lagi upload di dalam handleSend.
  const attachmentId = pendingUploadState?.status === "done" ? pendingUploadState.attachmentId : null;
  const storageWarning = pendingUploadState?.storageWarning || null;

  input.value = "";
  input.style.height = "auto";
  pendingUploadState = null; // lepas state upload yang sudah dipakai, jangan sampai ke-abort oleh clearPendingFile di bawah
  clearPendingFile();
  ["fileInput", "photoInput", "cameraInput"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("attachmentPreview").classList.add("hidden");

  // Tampilkan bubble pesan user dengan lampiran yang sudah 100% terunggah (uploading:
  // false) — beda dari sebelumnya, sekarang tidak ada lagi progress ring di titik ini
  // karena upload-nya sudah kelar duluan sebelum tombol Kirim bisa ditekan.
  const wrapper = appendMessage("user", text, false, file
    ? { name: file.name, type: file.type, isImage, previewUrl: localPreviewUrl, uploading: false }
    : null);
  scrollToBottom();

  if (storageWarning) {
    showToast(
      `Penyimpanan kamu sudah ${storageWarning.usedPercent}% terpakai. Hapus dokumen yang tidak dipakai lagi di halaman Documents.`,
      "info"
    );
  }

  const payload = {
    chatId: currentChatId,
    message: text,
    projectId: activeProjectId || undefined,
    preferredModel: selectedModel || undefined,
    attachmentId: attachmentId || undefined,
  };
  await submitChatMessage_(wrapper, payload, { text, file, attachmentId, storageWarning, input });
}

/**
 * Inti pengiriman pesan, diekstrak dari handleSend supaya bisa dipanggil ULANG oleh
 * tombol "Coba lagi" (lihat appendSendErrorBar_) tanpa user perlu mengetik ulang dari
 * nol. `wrapper` = bubble pesan user yang sudah tampil (dibuat SEKALI di handleSend,
 * dipakai lagi apa adanya kalau retry). `restoreCtx` = data yang dibutuhkan untuk
 * mengembalikan pesan ke kotak ketik (dipakai baik saat Stop/ABORTED maupun saat user
 * memilih "Kembalikan ke kotak teks" setelah gagal).
 */
async function submitChatMessage_(wrapper, payload, restoreCtx) {
  removeSendErrorBar_(wrapper);

  const sendBtn = document.getElementById("sendBtn");
  setLoading(sendBtn, true, "");

  const typingEl = appendTypingIndicator();
  const gen = beginGeneration();

  try {
    const result = await callApi("sendChatMessage", payload, { signal: gen.controller.signal });
    currentChatId = result.chatId;
    history.replaceState({}, "", `chat.html?chatId=${encodeURIComponent(currentChatId)}`);
    document.getElementById("chatTitle").textContent = result.chatTitle;
    // #1: simpan id pesan asli supaya tombol "Edit" bisa dipakai nanti (lihat appendMessage/startEditMessage).
    if (result.userMessage?.id) wrapper.dataset.messageId = result.userMessage.id;

    removeTypingIndicator(typingEl);
    await typeOutReply(result.reply.content, result.reply.model, result.reply.id, gen, result.reply.usedAcademicSources, result.reply.truncated);
    if (result.reply.usedImage) {
      showToast("Jawaban ini dianalisis langsung dari foto yang kamu kirim.", "info");
    } else if (result.reply.usedDocuments) {
      showToast("Jawaban ini menggunakan isi dokumen yang kamu unggah.", "info");
    } else if (result.reply.usedAcademicSources?.length) {
      showToast(`Jawaban ini pakai ${result.reply.usedAcademicSources.length} sumber akademik terverifikasi.`, "info");
    }
    loadChatList();
  } catch (err) {
    removeTypingIndicator(typingEl);
    if (err instanceof ApiError && err.code === "ABORTED") {
      // Stop ditekan SEBELUM balasan AI sampai (bukan cuma memotong animasi ketik —
      // itu ditangani terpisah lewat stopTypingRequested di typeOutReply). Di titik
      // ini pesan belum benar-benar "selesai terkirim" dari sudut pandang user, jadi
      // undo: hapus bubble optimistic yang tadi sudah ditampilkan, lalu kembalikan
      // teks & lampirannya ke form composer supaya user bisa edit/kirim ulang tanpa
      // mengetik dari nol atau memilih ulang filenya.
      restoreSendToComposer_(wrapper, restoreCtx);
      showToast("Dihentikan. Pesan dikembalikan ke kotak ketik.", "info");
    } else {
      // PERBAIKAN (AI generate gagal -> bubble "menggantung" tanpa balasan): sebelumnya
      // di sini cuma toast, lalu user harus mengetik ulang semuanya dari nol kalau mau
      // coba lagi. Sekarang bubble yang sudah terkirim tetap ada, dengan bar kecil di
      // bawahnya berisi "Coba lagi" (kirim ulang payload yang sama, tanpa upload ulang
      // lampiran) atau "Kembalikan ke kotak teks" (batalkan, edit dulu sebelum kirim ulang).
      const msg = err instanceof ApiError ? err.message : "Gagal mengirim pesan.";
      showToast(msg, "error");
      appendSendErrorBar_(wrapper, msg, {
        onRetry: () => submitChatMessage_(wrapper, payload, restoreCtx),
        onRestore: () => restoreSendToComposer_(wrapper, restoreCtx),
      });
    }
  } finally {
    setLoading(sendBtn, false);
    lucide.createIcons();
    endGeneration();
  }
}

/** Kembalikan bubble pesan yang gagal/dibatalkan ke kotak ketik composer (lihat submitChatMessage_). */
function restoreSendToComposer_(wrapper, { text, file, attachmentId, storageWarning, input }) {
  wrapper.remove();
  if (!document.getElementById("messages").children.length && !currentChatId) {
    document.getElementById("emptyState").classList.remove("hidden");
  }
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true })); // trigger auto-resize
  input.focus();
  // #8: kalau lampiran ini SUDAH selesai diunggah sebelumnya (attachmentId sudah ada),
  // pulihkan tanpa upload ulang — jangan panggil setPendingFile(file) di sini karena itu
  // akan memicu startPendingUpload() dan mengunggah file yang sama dua kali secara sia-sia.
  if (file) {
    if (attachmentId) restorePendingFileAlreadyUploaded_(file, attachmentId, storageWarning);
    else setPendingFile(file);
  }
}

/** Bar kecil "Coba lagi" / "Kembalikan ke kotak teks" di bawah bubble pesan yang gagal terkirim. */
function appendSendErrorBar_(wrapper, message, { onRetry, onRestore }) {
  removeSendErrorBar_(wrapper);
  const bar = document.createElement("div");
  bar.className = "send-error-bar mt-1.5 flex flex-col items-end gap-1 max-w-[min(42rem,88%)] ml-auto";
  bar.innerHTML = `
    <p class="text-[11px] text-red-600 font-mono text-right">${escapeHtml(message)}</p>
    <div class="flex items-center gap-1">
      <button type="button" data-retry-send title="Coba kirim lagi"
        class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 px-1.5 py-1 rounded hover:bg-paper-100">
        <i data-lucide="refresh-cw" class="w-3 h-3"></i> Coba lagi
      </button>
      <button type="button" data-restore-composer title="Kembalikan ke kotak teks"
        class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 px-1.5 py-1 rounded hover:bg-paper-100">
        <i data-lucide="corner-up-left" class="w-3 h-3"></i> Kembalikan ke kotak teks
      </button>
    </div>`;
  wrapper.appendChild(bar);
  // Closure per-bubble: tiap pesan yang gagal punya payload & konteks restore-nya
  // sendiri-sendiri, jadi disimpan langsung di elemen wrapper-nya (dibaca lewat event
  // delegation di bindMessageActions), bukan di satu variabel global yang bisa tertimpa
  // kalau ada lebih dari satu pesan gagal berturut-turut.
  wrapper._onRetrySend = onRetry;
  wrapper._onRestoreSend = onRestore;
  lucide.createIcons();
}

function removeSendErrorBar_(wrapper) {
  wrapper.querySelector(".send-error-bar")?.remove();
  wrapper._onRetrySend = null;
  wrapper._onRestoreSend = null;
}

// ---------- Message rendering ----------
/**
 * @param {object|null} attachment - { name, type, isImage, previewUrl, uploading }
 *   `previewUrl`: object URL lokal (baru dikirim) atau URL Cloudinary (riwayat chat).
 *   `uploading`: selalu false untuk pesan baru sejak #8 (upload selesai duluan sebelum
 *   tombol Kirim bisa ditekan) — field ini dipertahankan supaya render riwayat chat lama
 *   tetap kompatibel.
 * @param {string|null} messageId - id pesan dari database, dipakai tombol Edit/Buat ulang (#1).
 *   Bisa null untuk bubble yang baru dibuat SEBELUM id-nya diketahui (lihat handleSend/typeOutReply
 *   yang mengisinya belakangan lewat wrapper.dataset.messageId setelah respons API datang).
 */
function appendMessage(role, content, animate, attachment, messageId) {
  const container = document.getElementById("messages");
  const isUser = role === "user";
  const wrapper = document.createElement("div");
  wrapper.className = `group flex ${isUser ? "justify-end" : "justify-start"}`;
  if (messageId) wrapper.dataset.messageId = messageId;

  const attachmentHtml = attachment ? renderAttachmentQuickview_(attachment) : "";

  // #1 (edit & regenerate ala ChatGPT): tombol aksi disembunyikan sampai bubble di-hover
  // (pola "group-hover" yang sama dipakai tombol hapus di renderChatList). Edit hanya untuk
  // pesan user, "Buat ulang" hanya untuk balasan Macca — lihat bindMessageActions() untuk
  // event delegation-nya (alasan pakai delegation: lihat komentar panjang di bindLogout()).
  const actionsHtml = isUser
    ? `<button type="button" data-edit-msg title="Edit pesan"
         class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 px-1.5 py-1 rounded hover:bg-paper-100">
         <i data-lucide="pencil" class="w-3 h-3"></i> Edit
       </button>`
    : `<button type="button" data-regen-msg title="Buat ulang jawaban ini"
         class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 px-1.5 py-1 rounded hover:bg-paper-100">
         <i data-lucide="refresh-cw" class="w-3 h-3"></i> Buat ulang
       </button>
       <button type="button" data-copy-msg title="Salin jawaban"
         class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 px-1.5 py-1 rounded hover:bg-paper-100">
         <i data-lucide="copy" class="w-3 h-3"></i> Salin
       </button>
       <div class="relative">
         <button type="button" data-export-toggle title="Unduh sebagai PDF/Word/Excel"
           class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 px-1.5 py-1 rounded hover:bg-paper-100">
           <i data-lucide="download" class="w-3 h-3"></i> Unduh
         </button>
         <div data-export-menu class="hidden absolute left-0 bottom-full mb-1 z-20 w-36 doc-card bg-paper-50 py-1 text-xs">
           <button type="button" data-export-format="pdf" class="w-full text-left px-3 py-1.5 hover:bg-paper-100 flex items-center gap-2"><i data-lucide="file-text" class="w-3.5 h-3.5"></i> PDF</button>
           <button type="button" data-export-format="word" class="w-full text-left px-3 py-1.5 hover:bg-paper-100 flex items-center gap-2"><i data-lucide="file-type" class="w-3.5 h-3.5"></i> Word (.doc)</button>
           <button type="button" data-export-format="excel" class="w-full text-left px-3 py-1.5 hover:bg-paper-100 flex items-center gap-2"><i data-lucide="table" class="w-3.5 h-3.5"></i> Excel (.xls)</button>
         </div>
       </div>`;
  // #3/#4 (perbaikan tampilan): tombol aksi dulu disembunyikan sampai hover (opacity-0
  // group-hover:opacity-100) — pola ala desktop yang butuh cursor. Di HP tidak ada cursor
  // untuk hover, jadi tombolnya jadi tidak kelihatan/susah dipicu. Sekarang selalu tampil.
  const actionsRow = `<div class="msg-actions h-6 mt-1 flex items-center gap-1 ${isUser ? "justify-end" : "justify-start"}">${actionsHtml}</div>`;

  // Bubble user: TETAP dipertahankan (doc-card, rata kanan, lebar dibatasi) — supaya
  // pesan singkat dari user tetap kelihatan seperti "chat bubble" biasa.
  //
  // Balasan Macca: SENGAJA TIDAK dibungkus card/bubble lagi (ikut pola Claude.ai) —
  // sebelumnya balasan AI dipaksa masuk card selebar ~46rem/90% yang bikin konten lebar
  // (tabel, blok kode, daftar panjang) jadi sempit dan berdesakan. Sekarang kontainernya
  // w-full (mengikuti lebar kolom #messages yang sudah dibatasi mx-auto), jadi teks/tabel
  // AI punya ruang penuh baik di desktop maupun mobile, tanpa border/background card.
  wrapper.innerHTML = isUser
    ? `<div class="max-w-[min(42rem,88%)] min-w-0 flex flex-col items-end">
         <div class="doc-card px-4 py-3 bg-ink-900 text-paper-50 msg-bubble min-w-0 max-w-full">
           ${attachmentHtml}
           ${content ? `<div class="text-sm leading-relaxed break-words [overflow-wrap:anywhere] msg-text${attachment ? " mt-2" : ""}" data-raw="${escapeHtml(content)}">${renderFormattedText(content)}</div>` : ""}
         </div>
         ${actionsRow}
       </div>`
    : `<div class="w-full min-w-0 flex flex-col items-start">
         <div class="reply-shell min-w-0 max-w-full w-full">
           <p class="text-xs font-mono text-amber-600 mb-1.5 flex items-center gap-1"><i data-lucide="bot" class="w-3.5 h-3.5"></i> Macca</p>
           <div class="text-sm leading-relaxed break-words [overflow-wrap:anywhere] reply-text msg-text"></div>
         </div>
         ${actionsRow}
       </div>`;
  container.appendChild(wrapper);
  lucide.createIcons();

  if (!isUser) {
    const textEl = wrapper.querySelector(".reply-text");
    // Kalau ada konten langsung (mis. memuat riwayat chat), render terformat
    // sekarang. Kalau kosong (bubble baru dibuat untuk animasi ketik lewat
    // typeOutReply()), biarkan kosong dulu — typeOutReply yang mengisi teks
    // mentah selama animasi lalu mengganti ke versi terformat di akhir.
    // `data-raw` (perbaikan #3/#4): teks mentah dipakai tombol Salin & Unduh
    // supaya yang disalin/diekspor adalah teks aslinya, bukan HTML hasil format.
    if (content) {
      textEl.innerHTML = renderFormattedText(content);
      textEl.dataset.raw = content;
    }
  }
  return wrapper;
}

/** Quickview lampiran di dalam bubble pesan: thumbnail foto (clickable, buka ukuran penuh)
 *  atau chip nama file untuk dokumen, dengan overlay progress bar kalau masih diunggah. */
function renderAttachmentQuickview_(attachment) {
  const { name, type, isImage, previewUrl, uploading } = attachment;
  const overlay = `
    <div class="attach-progress-overlay ${uploading ? "" : "hidden"} absolute inset-0 bg-ink-900/70 grid place-items-center rounded-md">
      <svg class="w-7 h-7 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"></circle>
        <circle class="attach-progress-ring" cx="18" cy="18" r="15.5" fill="none" stroke="#C6FF3D" stroke-width="3"
          stroke-dasharray="97.4" stroke-dashoffset="97.4" stroke-linecap="round"></circle>
      </svg>
      <span class="attach-progress-pct absolute text-[10px] font-mono text-paper-50">0%</span>
    </div>`;

  if (isImage) {
    return `
      <div class="relative w-48 h-32 rounded-md overflow-hidden bg-paper-200">
        <img class="attach-thumb-img w-full h-full object-cover" src="${escapeHtml(previewUrl || "")}" alt="${escapeHtml(name)}" />
        ${overlay}
      </div>
      <p class="attach-status text-[10px] font-mono text-paper-50/60 mt-1">${uploading ? "Mengunggah…" : ""}</p>`;
  }

  return `
    <div class="relative flex items-center gap-2 bg-paper-50/10 rounded-md px-2.5 py-2 w-56">
      <div class="relative shrink-0 w-8 h-8 rounded bg-paper-50/10 grid place-items-center">
        <i data-lucide="${fileIconFor(type || name)}" class="w-4 h-4"></i>
        ${overlay}
      </div>
      <div class="min-w-0">
        <p class="text-xs font-medium truncate max-w-[10rem]">${escapeHtml(name)}</p>
        <p class="attach-status text-[10px] font-mono text-paper-50/60">${uploading ? "Mengunggah…" : ""}</p>
      </div>
    </div>`;
}

// ---------- Stop generate (#5, ala ChatGPT) ----------
/**
 * Dipanggil di AWAL setiap alur generate (kirim pesan baru, edit pesan, atau
 * "Buat ulang"). Mengembalikan AbortController yang dipakai callApi(..., {signal})
 * supaya request yang masih menunggu balasan AI bisa dibatalkan, DAN sebuah flag
 * `stopTypingRequested` yang dibaca typeOutReply() untuk memotong animasi ketik
 * dan langsung menampilkan teks penuh begitu Stop ditekan (kalau balasan sudah
 * selesai dihasilkan server, cuma animasinya yang perlu dihentikan).
 */
function beginGeneration() {
  const controller = new AbortController();
  activeGeneration = { controller, stopTypingRequested: false };
  document.getElementById("sendBtn")?.classList.add("hidden");
  const stopBtn = document.getElementById("stopBtn");
  stopBtn?.classList.remove("hidden");
  stopBtn?.classList.add("flex");
  return activeGeneration;
}

function endGeneration() {
  activeGeneration = null;
  document.getElementById("stopBtn")?.classList.add("hidden");
  document.getElementById("sendBtn")?.classList.remove("hidden");
}

function bindStopButton() {
  document.getElementById("stopBtn")?.addEventListener("click", () => {
    if (!activeGeneration) return;
    activeGeneration.stopTypingRequested = true; // kalau lagi animasi ketik -> tampilkan penuh sekarang
    activeGeneration.controller.abort(); // kalau masih menunggu server -> batalkan request-nya
  });
}

// ---------- Edit & Buat Ulang pesan (perbaikan #1, ala ChatGPT) ----------
/**
 * Event delegation (lihat komentar panjang di bindLogout() untuk alasannya: setiap
 * lucide.createIcons() mengganti elemen <i> jadi <svg> baru, jadi listener yang
 * dipasang langsung ke tombol akan "yatim" begitu pesan baru masuk & ikonnya dirender
 * ulang). Dipasang sekali di document, dicek lewat closest() saat klik terjadi.
 */
function bindMessageActions() {
  document.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit-msg]");
    if (editBtn) {
      e.preventDefault();
      const wrapper = editBtn.closest("[data-message-id]");
      if (wrapper) startEditMessage(wrapper);
      return;
    }
    const regenBtn = e.target.closest("[data-regen-msg]");
    if (regenBtn && !regenBtn.disabled) {
      e.preventDefault();
      const wrapper = regenBtn.closest("[data-message-id]");
      if (wrapper) regenerateMessage(wrapper);
      return;
    }

    // ---- Lanjutkan jawaban yang terpotong (lihat appendContinueBar_/continueTruncatedReply) ----
    const continueBtn = e.target.closest("[data-continue-reply]");
    if (continueBtn && !continueBtn.disabled) {
      e.preventDefault();
      const wrapper = continueBtn.closest("[data-message-id]");
      if (wrapper) continueTruncatedReply(wrapper, continueBtn);
      return;
    }

    // ---- Kirim gagal (bukan Stop): "Coba lagi" / "Kembalikan ke kotak teks" (lihat
    // appendSendErrorBar_/submitChatMessage_) — pakai closure yang ditempel di wrapper
    // karena tiap bubble punya payload & konteks restore-nya sendiri-sendiri. ----
    const retrySendBtn = e.target.closest("[data-retry-send]");
    if (retrySendBtn && !retrySendBtn.disabled) {
      e.preventDefault();
      const wrapper = retrySendBtn.closest(".group");
      wrapper?._onRetrySend?.();
      return;
    }
    const restoreComposerBtn = e.target.closest("[data-restore-composer]");
    if (restoreComposerBtn && !restoreComposerBtn.disabled) {
      e.preventDefault();
      const wrapper = restoreComposerBtn.closest(".group");
      wrapper?._onRestoreSend?.();
      return;
    }

    // ---- Salin jawaban (#3, ala ChatGPT/Claude) ----
    const copyBtn = e.target.closest("[data-copy-msg]");
    if (copyBtn) {
      e.preventDefault();
      const wrapper = copyBtn.closest("[data-message-id], .group");
      const textEl = wrapper?.querySelector(".reply-text");
      const raw = textEl?.dataset.raw ?? textEl?.textContent ?? "";
      copyToClipboard_(raw, copyBtn);
      return;
    }

    // ---- Buka/tutup menu Unduh (PDF/Word/Excel, #4) ----
    const exportToggle = e.target.closest("[data-export-toggle]");
    if (exportToggle) {
      e.preventDefault();
      const menu = exportToggle.nextElementSibling;
      const row = exportToggle.closest(".msg-actions");
      const willOpen = menu.classList.contains("hidden");
      closeAllExportMenus_(); // cuma satu menu terbuka pada satu waktu
      if (willOpen) {
        menu.classList.remove("hidden");
        row?.classList.add("menu-open");
      }
      return;
    }

    // ---- Pilih format unduhan ----
    const formatBtn = e.target.closest("[data-export-format]");
    if (formatBtn) {
      e.preventDefault();
      const wrapper = formatBtn.closest("[data-message-id], .group");
      const textEl = wrapper?.querySelector(".reply-text");
      const raw = (textEl?.dataset.raw ?? textEl?.textContent ?? "").trim();
      if (!raw) { showToast("Belum ada isi jawaban untuk diunduh.", "info"); }
      else exportAssistantMessage_(raw, formatBtn.dataset.exportFormat);
      closeAllExportMenus_();
      return;
    }

    // Klik di luar tombol/menu manapun -> tutup semua menu Unduh yang terbuka.
    if (!e.target.closest("[data-export-menu]")) closeAllExportMenus_();
  });
}

function closeAllExportMenus_() {
  document.querySelectorAll("[data-export-menu]").forEach((m) => m.classList.add("hidden"));
  document.querySelectorAll(".msg-actions.menu-open").forEach((r) => r.classList.remove("menu-open"));
}

/** Salin ke clipboard + umpan balik visual instan di tombolnya sendiri (bukan cuma toast). */
async function copyToClipboard_(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback kalau Clipboard API diblokir (mis. bukan konteks https) — textarea sementara.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { showToast("Gagal menyalin.", "error"); return; }
    ta.remove();
  }
  if (btn) {
    const original = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="check" class="w-3 h-3"></i> Tersalin';
    lucide.createIcons();
    setTimeout(() => { btn.innerHTML = original; lucide.createIcons(); }, 1600);
  }
}

// ---------- Unduh jawaban AI ke PDF / Word / Excel (perbaikan #4) ----------
/**
 * PDF: pakai jsPDF (dimuat lewat CDN di chat.html) supaya file .pdf asli, bukan cetak
 * browser. Word & Excel: trik Blob berbasis HTML dengan mime type Office klasik
 * (application/msword, application/vnd.ms-excel) — Word/Excel/Google Docs/Sheets semua
 * bisa membuka file ini langsung tanpa perlu library tambahan yang berat.
 */
function exportAssistantMessage_(rawText, format) {
  const title = (document.getElementById("chatTitle")?.textContent || "Jawaban Macca").trim();
  const filenameBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "jawaban-macca";

  if (format === "pdf") return exportToPdf_(rawText, title, filenameBase);
  if (format === "word") return exportToWord_(rawText, title, filenameBase);
  if (format === "excel") return exportToExcel_(rawText, title, filenameBase);
}

function exportToPdf_(rawText, title, filenameBase) {
  const JsPDFCtor = window.jspdf?.jsPDF;
  if (!JsPDFCtor) return showToast("Gagal memuat modul PDF, cek koneksi internet lalu coba lagi.", "error");
  const doc = new JsPDFCtor({ unit: "pt", format: "a4" });
  const marginX = 48, marginTop = 56, maxWidth = 500;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, marginX, marginTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(rawText, maxWidth);
  let y = marginTop + 26;
  const pageHeight = doc.internal.pageSize.getHeight();
  lines.forEach((line) => {
    if (y > pageHeight - 48) { doc.addPage(); y = marginTop; }
    doc.text(line, marginX, y);
    y += 15;
  });
  doc.save(`${filenameBase}.pdf`);
  showToast("PDF diunduh.", "success");
}

/**
 * PERBAIKAN (format Word rapi & terstruktur): sebelumnya jawaban AI cuma dipecah per
 * paragraf polos (split "\n\n") — heading (`##`), **bold**, daftar bernomor/bullet, dan
 * tabel yang sering muncul di jawaban akademik (mis. kerangka BAB, tabel perbandingan)
 * SEMUA hilang jadi teks rata tanpa struktur begitu dibuka di Word. Sekarang pakai
 * renderMarkdownToWordHtml (lib/render.js) — parser markdown yang SAMA dengan yang
 * dipakai untuk menampilkan bubble chat — supaya heading/list/tabel/bold ikut terbawa
 * ke dokumen Word dalam bentuk tag semantik asli (<h1>, <ul>, <table>, dst), plus
 * <style> berbasis tag selector (bukan class Tailwind, yang tidak dipahami Word) supaya
 * hierarki heading, spasi antar-elemen, dan garis tabel benar-benar tampil rapi saat
 * dibuka di Microsoft Word/LibreOffice/Google Docs.
 *
 * Header halaman (mso-*) & namespace `w`/`o` di bawah adalah trik standar "MHTML/Word
 * HTML" yang bikin Word membuka file ini sebagai dokumen native lengkap dengan ukuran
 * kertas A4 & margin 2.54cm (default skripsi/tugas akademik Indonesia), BUKAN cuma
 * "halaman web" tanpa page setup.
 */
function exportToWord_(rawText, title, filenameBase) {
  const bodyHtml = renderMarkdownToWordHtml(rawText);
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page WordSection1 {
    size: 21cm 29.7cm; /* A4 */
    margin: 2.54cm 2.54cm 2.54cm 2.54cm;
    mso-header-margin: 1.27cm;
    mso-footer-margin: 1.27cm;
  }
  div.WordSection1 { page: WordSection1; }
  body { font-family: "Times New Roman", Calibri, serif; font-size: 12pt; line-height: 1.5; color: #111; }
  h1 { font-size: 18pt; font-weight: bold; margin: 18pt 0 10pt; }
  h2 { font-size: 15pt; font-weight: bold; margin: 16pt 0 8pt; }
  h3 { font-size: 13pt; font-weight: bold; margin: 14pt 0 6pt; }
  h4, h5, h6 { font-size: 12pt; font-weight: bold; margin: 12pt 0 6pt; }
  p { margin: 0 0 10pt; text-align: justify; }
  ul, ol { margin: 0 0 10pt; padding-left: 24pt; }
  li { margin-bottom: 4pt; }
  table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
  th, td { border: 1pt solid #444; padding: 6pt 8pt; font-size: 11pt; vertical-align: top; }
  th { background: #eee; font-weight: bold; }
  blockquote { margin: 0 0 10pt 0; padding-left: 12pt; border-left: 3pt solid #999; color: #333; font-style: italic; }
  pre { background: #f3f3f3; padding: 8pt; font-family: "Consolas", monospace; font-size: 10pt; white-space: pre-wrap; }
  code { font-family: "Consolas", monospace; font-size: 10.5pt; }
  hr { border: none; border-top: 1pt solid #999; margin: 14pt 0; }
</style>
</head>
<body>
<div class="WordSection1">
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</div>
</body>
</html>`;
  downloadBlob_(html, "application/msword", `${filenameBase}.doc`);
  showToast("Dokumen Word (.doc) diunduh dengan format rapi.", "success");
}

function exportToExcel_(rawText, title, filenameBase) {
  // Satu baris = satu paragraf/baris teks per sel, supaya tetap berguna kalau jawaban
  // AI berbentuk tabel/daftar (mis. RAB atau data terstruktur), bukan cuma satu blok teks.
  const rows = rawText.split(/\n/).filter((l) => l.trim().length);
  const rowsHtml = rows.map((r) => `<tr><td>${escapeHtml(r)}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>${escapeHtml(title).slice(0, 30)}</x:Name><x:WorksheetOptions></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
    <body><table>${rowsHtml}</table></body></html>`;
  downloadBlob_(html, "application/vnd.ms-excel", `${filenameBase}.xls`);
  showToast("File Excel (.xls) diunduh.", "success");
}

function downloadBlob_(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Hapus semua bubble pesan SETELAH wrapper ini dari tampilan (mencerminkan truncate
 *  yang sudah dilakukan backend di handleEditMessage/handleRegenerateReply). */
function removeMessagesAfter(wrapper) {
  let node = wrapper.nextElementSibling;
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
}

function startEditMessage(wrapper) {
  if (wrapper.querySelector(".msg-edit-box")) return; // sudah dalam mode edit
  const messageId = wrapper.dataset.messageId;
  if (!messageId) return showToast("Pesan ini masih diproses, tunggu sebentar lalu coba lagi.", "info");

  const bubble = wrapper.querySelector(".msg-bubble");
  const textEl = wrapper.querySelector(".msg-text");
  // Pakai data-raw (teks asli sebelum di-render jadi <ul>/<strong> dst — lihat
  // renderFormattedText di render.js), BUKAN textContent, supaya sintaks markdown
  // yang diketik user (mis. "- item" atau "**tebal**") tidak hilang saat diedit.
  const original = textEl?.dataset.raw ?? textEl?.textContent ?? "";

  const editBox = document.createElement("div");
  editBox.className = "msg-edit-box mt-2 flex flex-col gap-2";
  editBox.innerHTML = `
    <textarea data-edit-textarea class="w-full min-w-[16rem] max-w-full rounded-md bg-paper-50/10 border border-paper-50/30 text-paper-50 text-sm p-2 resize-none focus:outline-none" rows="2"></textarea>
    <div class="flex justify-end gap-2">
      <button type="button" data-cancel-edit class="text-xs px-3 py-1.5 rounded-md text-paper-50/80 hover:bg-paper-50/10">Batal</button>
      <button type="button" data-save-edit class="text-xs px-3 py-1.5 rounded-md btn-amber font-semibold">Kirim & buat ulang</button>
    </div>`;
  textEl?.classList.add("hidden");
  bubble.appendChild(editBox);

  const textarea = editBox.querySelector("textarea");
  textarea.value = original;
  const autoResize = () => { textarea.style.height = "auto"; textarea.style.height = Math.min(textarea.scrollHeight, 220) + "px"; };
  textarea.addEventListener("input", autoResize);
  autoResize();
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const closeEdit = () => { editBox.remove(); textEl?.classList.remove("hidden"); };
  editBox.querySelector("[data-cancel-edit]").addEventListener("click", closeEdit);
  editBox.querySelector("[data-save-edit]").addEventListener("click", () => submitEdit(wrapper, messageId, textarea.value.trim(), editBox, textEl));
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeEdit(); }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitEdit(wrapper, messageId, textarea.value.trim(), editBox, textEl);
    }
  });
}

async function submitEdit(wrapper, messageId, newContent, editBox, textEl) {
  if (!newContent) return showToast("Pesan tidak boleh kosong.", "info");
  if (activeGeneration) return showToast("Tunggu balasan sebelumnya selesai, atau tekan Stop dulu.", "info");
  const saveBtn = editBox.querySelector("[data-save-edit]");
  setLoading(saveBtn, true, "");
  const gen = beginGeneration();

  try {
    const result = await callApi("editMessage", {
      chatId: currentChatId,
      messageId,
      content: newContent,
      preferredModel: selectedModel || undefined,
    }, { signal: gen.controller.signal });

    // Backend sudah menghapus balasan lama + pesan setelahnya dari database
    // (truncate & regenerate) -> cerminkan itu di tampilan juga.
    removeMessagesAfter(wrapper);
    if (textEl) {
      textEl.innerHTML = renderFormattedText(newContent);
      textEl.dataset.raw = newContent;
      textEl.classList.remove("hidden");
    }
    editBox.remove();

    await typeOutReply(result.reply.content, result.reply.model, result.reply.id, gen, result.reply.usedAcademicSources, result.reply.truncated);
    if (result.reply.usedImage) {
      showToast("Jawaban ini dianalisis langsung dari foto yang kamu kirim.", "info");
    } else if (result.reply.usedDocuments) {
      showToast("Jawaban ini menggunakan isi dokumen yang kamu unggah.", "info");
    } else if (result.reply.usedAcademicSources?.length) {
      showToast(`Jawaban ini pakai ${result.reply.usedAcademicSources.length} sumber akademik terverifikasi.`, "info");
    }
    loadChatList();
  } catch (err) {
    if (err instanceof ApiError && err.code === "ABORTED") {
      showToast("Dihentikan.", "info");
      editBox.remove();
      textEl?.classList.remove("hidden");
    } else {
      showToast(err instanceof ApiError ? err.message : "Gagal mengedit pesan.", "error");
      setLoading(saveBtn, false);
    }
  } finally {
    endGeneration();
  }
}

async function regenerateMessage(wrapper) {
  const messageId = wrapper.dataset.messageId;
  if (!messageId) return showToast("Pesan ini masih diproses, tunggu sebentar lalu coba lagi.", "info");
  if (activeGeneration) return showToast("Tunggu balasan sebelumnya selesai, atau tekan Stop dulu.", "info");
  const regenBtn = wrapper.querySelector("[data-regen-msg]");
  const icon = regenBtn?.querySelector("i");
  regenBtn?.setAttribute("disabled", "true");
  icon?.classList.add("animate-spin");
  const gen = beginGeneration();

  try {
    const result = await callApi("regenerateReply", {
      chatId: currentChatId,
      messageId,
      preferredModel: selectedModel || undefined,
    }, { signal: gen.controller.signal });
    removeMessagesAfter(wrapper); // pesan setelah balasan ini (biasanya tidak ada, karena selalu yang terakhir)
    wrapper.remove(); // ganti bubble lama dengan yang baru
    await typeOutReply(result.reply.content, result.reply.model, result.reply.id, gen, result.reply.usedAcademicSources, result.reply.truncated);
    loadChatList();
  } catch (err) {
    if (err instanceof ApiError && err.code === "ABORTED") {
      showToast("Dihentikan.", "info");
    } else {
      showToast(err instanceof ApiError ? err.message : "Gagal membuat ulang jawaban.", "error");
    }
    regenBtn?.removeAttribute("disabled");
    icon?.classList.remove("animate-spin");
  } finally {
    endGeneration();
  }
}

/**
 * Indikator "Macca sedang memproses" (perbaikan #2) — sebelumnya cuma tiga titik
 * animasi tanpa keterangan, jadi pada request yang lama (dokumen panjang / model
 * penuh) user tidak tahu apakah aplikasi masih bekerja atau macet. Sekarang ada
 * label teks yang berubah bertahap kalau prosesnya makin lama, supaya user tetap
 * yakin ini masih berjalan, bukan diam mendadak. Timer-nya di-clear oleh pemanggil
 * (removeTypingIndicator) begitu balasan datang atau dibatalkan.
 */
function appendTypingIndicator() {
  const container = document.getElementById("messages");
  const el = document.createElement("div");
  el.className = "flex justify-start";
  el.innerHTML = `<div class="doc-card px-4 py-3 flex items-center gap-2.5">
      <span class="flex gap-1.5 items-center">
        <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
      </span>
      <span class="typing-status text-xs font-mono">Macca sedang berpikir…</span>
    </div>`;
  container.appendChild(el);
  scrollToBottom();

  const statusEl = el.querySelector(".typing-status");
  const stages = [
    { after: 0, text: "Macca sedang berpikir…" },
    { after: 4000, text: "Masih memproses, mohon tunggu sebentar…" },
    { after: 10000, text: "Menyusun jawaban yang cukup panjang, hampir selesai…" },
    { after: 20000, text: "Masih berjalan — dokumen/permintaan ini butuh waktu lebih lama dari biasanya…" },
  ];
  const timers = stages.slice(1).map((s) => setTimeout(() => {
    if (statusEl.isConnected) statusEl.textContent = s.text;
  }, s.after));
  el._typingTimers = timers; // dibersihkan di removeTypingIndicator() supaya tidak nyala setelah bubble dihapus

  return el;
}

function removeTypingIndicator(el) {
  if (!el) return;
  (el._typingTimers || []).forEach(clearTimeout);
  el.remove();
}

/**
 * Simulasi streaming: Apps Script mengembalikan jawaban utuh (tidak ada
 * SSE asli), jadi kita render bertahap per beberapa karakter agar terasa
 * seperti mengetik (lihat known_limitations.no_true_streaming).
 */
async function typeOutReply(fullText, model, messageId, gen, academicSources, truncated) {
  const wrapper = appendMessage("assistant", "", false, null, messageId);
  const textEl = wrapper.querySelector(".reply-text");
  const chunkSize = 3;
  for (let i = 0; i < fullText.length; i += chunkSize) {
    if (gen?.stopTypingRequested) break; // #5: Stop ditekan -> potong animasi, tampilkan sisanya langsung
    textEl.textContent += fullText.slice(i, i + chunkSize);
    scrollToBottom();
    await sleep(12);
  }
  // Selama animasi teks di atas ditulis polos (textContent) supaya efek "mengetik"
  // per-karakter tetap mulus. Begitu selesai (normal atau di-stop), ganti ke versi
  // terformat (bold/list) — lihat renderFormattedText di render.js.
  textEl.innerHTML = renderFormattedText(fullText);
  textEl.dataset.raw = fullText; // dipakai tombol Salin & Unduh (#3/#4)
  if (model) {
    const indicator = document.getElementById("modelIndicator");
    indicator.textContent = model;
    indicator.classList.remove("hidden");
  }
  // Kotak "Referensi" terpisah (lihat academicSearch.gs + chat.gs -> usedAcademicSources):
  // ditaruh SETELAH teks jawaban, bukan dicampur ke dalamnya, supaya user bisa langsung
  // lihat & klik link DOI-nya untuk verifikasi manual, tanpa perlu percaya buta ke AI.
  if (academicSources && academicSources.length) {
    renderAcademicSources_(wrapper, academicSources);
  }
  // PERBAIKAN (jawaban tiba-tiba berhenti di tengah): kalau chat.gs menandai balasan ini
  // terpotong (kena batas max_tokens, lihat route.truncated di router.gs), tampilkan
  // tombol "Lanjutkan" alih-alih membiarkan user mengira jawabannya memang sudah selesai.
  if (truncated) appendContinueBar_(wrapper, textEl);
  return wrapper;
}

/** Tombol "Lanjutkan" di bawah balasan yang terpotong (lihat typeOutReply/continueTruncatedReply). */
function appendContinueBar_(wrapper, textEl) {
  wrapper.querySelectorAll(".continue-reply-bar").forEach((b) => b.remove());
  const bar = document.createElement("div");
  bar.className = "continue-reply-bar mt-2";
  bar.innerHTML = `<button type="button" data-continue-reply title="Jawaban ini terpotong, lanjutkan dari titik terakhir"
      class="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 px-2.5 py-1.5 rounded-md border border-amber-300/70 bg-amber-50 hover:bg-amber-100">
      <i data-lucide="corner-down-right" class="w-3.5 h-3.5"></i> Jawaban terpotong — Lanjutkan
    </button>`;
  (textEl || wrapper).insertAdjacentElement("afterend", bar);
  lucide.createIcons();
}

/**
 * Dipanggil saat tombol "Lanjutkan" di atas ditekan. Minta backend menyambung dari
 * titik terakhir (bukan mengulang dari awal, lihat handleContinueReply/
 * generateContinuationReply_ di apps-script), lalu ganti isi bubble dengan hasil
 * gabungannya. Status loading pakai gaya SHIMMER TEXT (.typing-status) yang sama dengan
 * indikator "Macca sedang berpikir…" di appendTypingIndicator — bukan animasi titik —
 * supaya semua status "sedang memproses" di aplikasi ini konsisten satu gaya.
 */
async function continueTruncatedReply(wrapper, btn) {
  if (activeGeneration) return showToast("Tunggu proses sebelumnya selesai, atau tekan Stop dulu.", "info");
  const messageId = wrapper.dataset.messageId;
  const textEl = wrapper.querySelector(".reply-text");
  if (!messageId || !textEl) return;

  const bar = btn.closest(".continue-reply-bar");
  bar.innerHTML = `<span class="typing-status text-xs font-mono">Melanjutkan jawaban…</span>`;

  const gen = beginGeneration();
  try {
    const result = await callApi("continueReply", { chatId: currentChatId, messageId }, { signal: gen.controller.signal });
    textEl.innerHTML = renderFormattedText(result.reply.content);
    textEl.dataset.raw = result.reply.content;
    bar.remove();
    if (result.reply.truncated) appendContinueBar_(wrapper, textEl);
    scrollToBottom();
  } catch (err) {
    if (err instanceof ApiError && err.code === "ABORTED") showToast("Dihentikan.", "info");
    else showToast(err instanceof ApiError ? err.message : "Gagal melanjutkan jawaban.", "error");
    appendContinueBar_(wrapper, textEl); // kembalikan tombolnya supaya bisa dicoba lagi
  } finally {
    endGeneration();
  }
}

/** Render daftar sumber akademik terverifikasi di bawah satu bubble balasan Macca. */
function renderAcademicSources_(wrapper, sources) {
  const bubble = wrapper.querySelector(".reply-text")?.closest(".reply-shell") || wrapper;
  const box = document.createElement("div");
  box.className = "mt-2 pt-2 border-t border-paper-200 text-[11px] text-ink-600 space-y-1";
  box.innerHTML = `<div class="font-medium text-ink-700 flex items-center gap-1">
      <i data-lucide="library" class="w-3 h-3"></i> Referensi (${sources.length})
    </div>` +
    sources.map((s, i) => {
      const label = `${escapeHtml(s.title)}${s.authors ? " — " + escapeHtml(s.authors) : ""}${s.year ? " (" + escapeHtml(String(s.year)) + ")" : ""}`;
      return s.doiOrUrl
        ? `<div>[${i + 1}] <a href="${escapeHtml(s.doiOrUrl)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">${label}</a></div>`
        : `<div>[${i + 1}] ${label}</div>`;
    }).join("");
  bubble.appendChild(box);
  lucide.createIcons();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function scrollToBottom() {
  const list = document.getElementById("messageList");
  list.scrollTop = list.scrollHeight;
}

// ---------- Header actions ----------
function bindHeaderActions() {
  document.getElementById("renameBtn").addEventListener("click", async () => {
    if (!currentChatId) return showToast("Belum ada chat untuk diganti judulnya.", "info");
    const title = prompt("Judul baru untuk chat ini:");
    if (!title) return;
    try {
      await callApi("renameChat", { chatId: currentChatId, title });
      document.getElementById("chatTitle").textContent = title;
      loadChatList();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal mengganti judul.", "error");
    }
  });

  document.getElementById("deleteBtn").addEventListener("click", async () => {
    if (!currentChatId) return showToast("Belum ada chat untuk dihapus.", "info");
    if (!confirm("Hapus percakapan ini? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      await callApi("deleteChat", { chatId: currentChatId });
      chatListCache = chatListCache.filter((c) => c.id !== currentChatId);
      resetToNewChat();
      renderChatList();
      showToast("Percakapan dihapus.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal menghapus chat.", "error");
    }
  });
}
