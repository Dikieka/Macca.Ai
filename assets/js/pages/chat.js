// assets/js/pages/chat.js
// Halaman ini juga berperan sebagai "beranda" (dulu dashboard.html terpisah):
// tanpa ?chatId, tampil sapaan + quick actions + proyek terbaru (lihat #emptyState di chat.html).
import { requireAuth, logout } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading } from "../lib/state.js";
import { escapeHtml, formatRelativeTime, markActiveSidebarLink, applyRoleBasedNav, fileIconFor, renderFormattedText } from "../lib/render.js";
import { prepareFileForUpload, formatBytes } from "../lib/upload.js";
import { initSidebarResize, initSidebarMobile } from "../lib/sidebar.js";

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

if (session) init();

async function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  bindComposer();
  bindHeaderActions();
  bindNewChat();
  bindLogout();
  bindQuickActions();
  bindModelPicker();
  bindMessageActions();
  bindStopButton();
  renderGreeting();
  if (activeProjectId && !currentChatId) showProjectBadge(activeProjectId);
  await loadChatList();
  if (currentChatId) {
    await loadChat(currentChatId);
  } else {
    loadRecentProjects();
  }
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
  callApi("listModels", {})
    .then((models) => {
      select.innerHTML = `<option value="">Otomatis (disarankan)</option>` +
        models.map((m) => `<option value="${escapeHtml(m.modelSlug)}">${escapeHtml(m.modelSlug)}${m.free ? " · gratis" : ""}</option>`).join("");
      select.value = selectedModel;
    })
    .catch(() => { select.innerHTML = `<option value="">Otomatis (disarankan)</option>`; });

  select.addEventListener("change", () => {
    selectedModel = select.value;
    localStorage.setItem("macca_preferred_model", selectedModel);
  });
}

function bindQuickActions() {
  document.querySelectorAll(".quick-action").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("composerInput").value = btn.dataset.prompt;
      document.getElementById("composerInput").focus();
    });
  });
}

async function loadRecentProjects() {
  const el = document.getElementById("recentProjects");
  if (!el) return;
  try {
    const projects = await callApi("getProjects", { limit: 4 });
    if (!projects?.length) {
      el.innerHTML = `<p class="text-sm text-ink-500 col-span-2">Belum ada proyek. <a href="projects.html" class="underline">Buat proyek pertamamu</a>.</p>`;
      return;
    }
    el.innerHTML = projects.map((p) => `
      <a href="project.html?projectId=${encodeURIComponent(p.id)}" class="doc-card p-5 block hover:-translate-y-0.5 transition-transform">
        <p class="font-display font-semibold text-ink-900">${escapeHtml(p.name)}</p>
        <p class="text-xs text-ink-500 mt-1">${escapeHtml(p.type || "Proyek")} · ${formatRelativeTime(p.updatedAt)}</p>
      </a>`).join("");
  } catch {
    el.innerHTML = `<p class="text-sm text-clay-500 col-span-2">Gagal memuat proyek.</p>`;
  }
}

// ---------- Sidebar chat list ----------
let chatListCache = [];

async function loadChatList() {
  const listEl = document.getElementById("chatList");
  try {
    const chats = await callApi("getChatHistory", { limit: 30 });
    chatListCache = chats || [];
    renderChatList();
  } catch {
    listEl.innerHTML = `<p class="px-3 text-xs text-clay-500">Gagal memuat riwayat</p>`;
  }
}

function renderChatList() {
  const listEl = document.getElementById("chatList");
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

  document.getElementById("removeAttachment").addEventListener("click", () => {
    clearPendingFile();
    ["fileInput", "photoInput", "cameraInput"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("attachmentPreview").classList.add("hidden");
  });

  form.addEventListener("submit", handleSend);
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

  const sendBtn = document.getElementById("sendBtn");
  setLoading(sendBtn, true, "");

  const typingEl = appendTypingIndicator();
  const gen = beginGeneration();

  try {
    const result = await callApi("sendChatMessage", {
      chatId: currentChatId,
      message: text,
      projectId: activeProjectId || undefined,
      preferredModel: selectedModel || undefined,
      attachmentId: attachmentId || undefined,
    }, { signal: gen.controller.signal });
    currentChatId = result.chatId;
    history.replaceState({}, "", `chat.html?chatId=${encodeURIComponent(currentChatId)}`);
    document.getElementById("chatTitle").textContent = result.chatTitle;
    // #1: simpan id pesan asli supaya tombol "Edit" bisa dipakai nanti (lihat appendMessage/startEditMessage).
    if (result.userMessage?.id) wrapper.dataset.messageId = result.userMessage.id;

    typingEl.remove();
    await typeOutReply(result.reply.content, result.reply.model, result.reply.id, gen);
    if (result.reply.usedImage) {
      showToast("Jawaban ini dianalisis langsung dari foto yang kamu kirim.", "info");
    } else if (result.reply.usedDocuments) {
      showToast("Jawaban ini menggunakan isi dokumen yang kamu unggah.", "info");
    }
    loadChatList();
  } catch (err) {
    typingEl.remove();
    if (err instanceof ApiError && err.code === "ABORTED") {
      // Stop ditekan SEBELUM balasan AI sampai (bukan cuma memotong animasi ketik —
      // itu ditangani terpisah lewat stopTypingRequested di typeOutReply). Di titik
      // ini pesan belum benar-benar "selesai terkirim" dari sudut pandang user, jadi
      // undo: hapus bubble optimistic yang tadi sudah ditampilkan, lalu kembalikan
      // teks & lampirannya ke form composer supaya user bisa edit/kirim ulang tanpa
      // mengetik dari nol atau memilih ulang filenya.
      wrapper.remove();
      if (!document.getElementById("messages").children.length && !currentChatId) {
        document.getElementById("emptyState").classList.remove("hidden");
      }
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true })); // trigger auto-resize
      input.focus();
      // #8: kalau lampiran ini SUDAH selesai diunggah sebelum Stop ditekan (attachmentId
      // sudah ada), pulihkan tanpa upload ulang — jangan panggil setPendingFile(file) di
      // sini karena itu akan memicu startPendingUpload() dan mengunggah file yang sama
      // dua kali secara sia-sia.
      if (file) {
        if (attachmentId) restorePendingFileAlreadyUploaded_(file, attachmentId, storageWarning);
        else setPendingFile(file);
      }
      showToast("Dihentikan. Pesan dikembalikan ke kotak ketik.", "info");
    } else {
      showToast(err instanceof ApiError ? err.message : "Gagal mengirim pesan.", "error");
    }
  } finally {
    setLoading(sendBtn, false);
    lucide.createIcons();
    endGeneration();
  }
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
       </button>`;
  const actionsRow = `<div class="msg-actions h-6 mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex ${isUser ? "justify-end" : "justify-start"}">${actionsHtml}</div>`;

  // Lebar bubble: dulu fixed (max-w-md/max-w-lg = 28rem/32rem) sehingga pesan
  // dengan baris panjang tanpa spasi (kode, URL, JSON) bisa memaksa bubble
  // melebar melewati batas kontainer (lihat komentar #6 di chat.html) —
  // karena wrapper ini adalah flex item dengan items-end/items-start (bukan
  // stretch), lebarnya "shrink-to-fit" konten dan TIDAK otomatis dibatasi
  // oleh max-width induk. Perbaikan: (1) min-w-0 supaya flex item boleh
  // menyusut penuh dan bukan mempertahankan lebar intrinsik kontennya,
  // (2) max-w pakai min(REM, %) — persentase relatif terhadap #messages,
  // yang lebarnya sendiri mengikuti sisa ruang setelah sidebar (lihat
  // #messages/composer di bawah) — jadi bubble ikut menyempit otomatis
  // saat sidebar dilebarkan, bukan cuma dibatasi angka tetap.
  wrapper.innerHTML = isUser
    ? `<div class="max-w-[min(42rem,88%)] min-w-0 flex flex-col items-end">
         <div class="doc-card px-4 py-3 bg-ink-900 text-paper-50 msg-bubble min-w-0 max-w-full">
           ${attachmentHtml}
           ${content ? `<div class="text-sm leading-relaxed break-words [overflow-wrap:anywhere] msg-text${attachment ? " mt-2" : ""}" data-raw="${escapeHtml(content)}">${renderFormattedText(content)}</div>` : ""}
         </div>
         ${actionsRow}
       </div>`
    : `<div class="max-w-[min(46rem,90%)] min-w-0 flex flex-col items-start">
         <div class="doc-card px-4 py-3 msg-bubble min-w-0 max-w-full">
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
    if (content) textEl.innerHTML = renderFormattedText(content);
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
    }
  });
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
    <textarea class="w-full min-w-[16rem] max-w-full rounded-md bg-paper-50/10 border border-paper-50/30 text-paper-50 text-sm p-2 resize-none focus:outline-none focus:border-lime-500" rows="2"></textarea>
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

    await typeOutReply(result.reply.content, result.reply.model, result.reply.id, gen);
    if (result.reply.usedImage) {
      showToast("Jawaban ini dianalisis langsung dari foto yang kamu kirim.", "info");
    } else if (result.reply.usedDocuments) {
      showToast("Jawaban ini menggunakan isi dokumen yang kamu unggah.", "info");
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
    await typeOutReply(result.reply.content, result.reply.model, result.reply.id, gen);
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

function appendTypingIndicator() {
  const container = document.getElementById("messages");
  const el = document.createElement("div");
  el.className = "flex justify-start";
  el.innerHTML = `<div class="doc-card px-4 py-3 flex gap-1.5 items-center">
      <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
    </div>`;
  container.appendChild(el);
  scrollToBottom();
  return el;
}

/**
 * Simulasi streaming: Apps Script mengembalikan jawaban utuh (tidak ada
 * SSE asli), jadi kita render bertahap per beberapa karakter agar terasa
 * seperti mengetik (lihat known_limitations.no_true_streaming).
 */
async function typeOutReply(fullText, model, messageId, gen) {
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
  if (model) {
    const indicator = document.getElementById("modelIndicator");
    indicator.textContent = model;
    indicator.classList.remove("hidden");
  }
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
