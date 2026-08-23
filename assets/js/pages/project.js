// assets/js/pages/project.js
import { requireAuth } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading, confirmDialog } from "../lib/state.js";
import { escapeHtml, formatRelativeTime, applyRoleBasedNav } from "../lib/render.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAuth();
const projectId = new URLSearchParams(window.location.search).get("projectId");

if (session) init();

async function init() {
  lucide.createIcons();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();

  if (!projectId) {
    document.getElementById("projectHeader").outerHTML = `<div class="doc-card p-6"><p class="text-sm text-clay-500">Proyek tidak ditemukan (projectId hilang dari URL).</p></div>`;
    return;
  }

  try {
    const { project, chats, documents } = await callApi("getProjectDetail", { projectId });
    renderHeader(project);
    renderPrivacy(project);
    renderChats(chats);
    renderDocuments(documents);
    document.getElementById("newProjectChatBtn").href = `chat.html?projectId=${encodeURIComponent(project.id)}`;
    bindDeleteProject(project);
  } catch (err) {
    document.getElementById("projectHeader").outerHTML = `<div class="doc-card p-6"><p class="text-sm text-clay-500">${escapeHtml(err instanceof ApiError ? err.message : "Gagal memuat proyek.")}</p></div>`;
  }
}

function renderHeader(project) {
  document.title = `${project.name} — Macca.Ai`;
  document.getElementById("projectHeader").outerHTML = `
    <div id="projectHeader" class="doc-card p-6">
      <div class="flex items-center justify-between">
        <span class="layer-badge text-sage-500">${escapeHtml((project.type || "umum").toUpperCase())}</span>
        <span class="text-xs text-ink-500">Diperbarui ${formatRelativeTime(project.updatedAt)}</span>
      </div>
      <div class="flex items-start justify-between gap-4 mt-3">
        <div class="min-w-0">
          <h1 class="font-display text-2xl font-semibold text-ink-900">${escapeHtml(project.name)}</h1>
          <p class="text-sm text-ink-700 mt-1.5">${escapeHtml(project.description || "Belum ada deskripsi.")}</p>
        </div>
        <button id="deleteProjectBtn" type="button" title="Hapus proyek ini"
          class="shrink-0 flex items-center gap-1.5 text-xs font-medium text-clay-500 hover:text-clay-500 px-2.5 py-1.5 rounded-md border border-clay-500/30 hover:bg-clay-500/10">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Hapus Proyek
        </button>
      </div>
    </div>`;
  lucide.createIcons();
}

/**
 * Hapus proyek: menghapus proyek beserta SELURUH chat, dokumen, dan memory di
 * dalamnya (lihat handleDeleteProject di apps-script/handlers/projects.gs) —
 * jadi wajib ada peringatan tegas dulu sebelum benar-benar terkirim, karena
 * tindakan ini permanen dan tidak bisa dibatalkan.
 */
function bindDeleteProject(project) {
  const btn = document.getElementById("deleteProjectBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const confirmed = await confirmDialog(
      `Semua chat, dokumen, dan memory di dalam proyek "${project.name}" akan ikut terhapus permanen. Tindakan ini tidak bisa dibatalkan.`,
      { title: `Hapus proyek "${project.name}"?`, confirmText: "Hapus proyek", danger: true }
    );
    if (!confirmed) return;

    setLoading(btn, true, "Menghapus…");
    try {
      await callApi("deleteProject", { projectId: project.id });
      showToast("Proyek berhasil dihapus.", "success");
      window.location.href = "projects.html";
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal menghapus proyek.", "error");
      setLoading(btn, false);
    }
  });
}

function renderPrivacy(project) {
  const card = document.getElementById("privacyCard");
  const toggle = document.getElementById("privacyToggle");
  const knob = document.getElementById("privacyKnob");
  card.classList.remove("hidden");

  let isPrivate = project.isPrivate === true || project.isPrivate === "TRUE" || project.isPrivate === "true";
  const paint = () => {
    toggle.classList.toggle("bg-lime-500", isPrivate);
    toggle.classList.toggle("bg-paper-200", !isPrivate);
    knob.classList.toggle("translate-x-5", isPrivate);
    knob.classList.toggle("bg-ink-900", isPrivate);
    knob.classList.toggle("bg-ink-500", !isPrivate);
  };
  paint();

  toggle.addEventListener("click", async () => {
    const next = !isPrivate;
    try {
      await callApi("updateProject", { projectId: project.id, isPrivate: next });
      isPrivate = next;
      paint();
      showToast(next ? "Mode privasi diaktifkan." : "Mode privasi dimatikan.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal mengubah pengaturan.", "error");
    }
  });
}

function renderChats(chats) {
  const el = document.getElementById("projectChats");
  if (!chats?.length) {
    el.innerHTML = `<p class="text-sm text-ink-500 px-1">Belum ada chat di proyek ini.</p>`;
    return;
  }
  el.innerHTML = chats.map((c) => `
    <a href="chat.html?chatId=${encodeURIComponent(c.id)}" class="doc-card p-4 flex items-center justify-between hover:-translate-y-0.5 transition-transform">
      <span class="text-sm font-medium truncate">${escapeHtml(c.title || "Percakapan tanpa judul")}</span>
      <span class="text-xs text-ink-500 shrink-0 ml-3">${formatRelativeTime(c.updatedAt)}</span>
    </a>`).join("");
}

function renderDocuments(docs) {
  const el = document.getElementById("projectDocuments");
  if (!docs?.length) {
    el.innerHTML = `<p class="text-sm text-ink-500 px-1">Belum ada dokumen yang diunggah ke proyek ini.</p>`;
    return;
  }
  el.innerHTML = docs.map((d) => `
    <div class="doc-card p-4 flex items-center justify-between">
      <span class="text-sm font-medium truncate">${escapeHtml(d.name)}</span>
      <span class="text-xs ${d.status === "processed" ? "text-sage-500" : "text-amber-600"} shrink-0 ml-3 font-mono">${escapeHtml(d.status || "uploaded")}</span>
    </div>`).join("");
}
