// assets/js/pages/projects.js
import { requireAuth } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading } from "../lib/state.js";
import { escapeHtml, formatRelativeTime, markActiveSidebarLink, applyRoleBasedNav } from "../lib/render.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAuth();
if (session) init();

function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();
  bindModal();
  loadProjects();
}

async function loadProjects() {
  const grid = document.getElementById("projectGrid");
  try {
    const projects = await callApi("getProjects", {});
    if (!projects?.length) {
      grid.innerHTML = `
        <div class="doc-card p-8 text-center sm:col-span-2">
          <i data-lucide="folder-plus" class="w-8 h-8 mx-auto text-ink-500"></i>
          <p class="text-sm text-ink-700 mt-3">Belum ada proyek. Buat proyek pertamamu untuk mengelompokkan chat dan dokumen.</p>
        </div>`;
      lucide.createIcons();
      return;
    }
    grid.innerHTML = projects.map((p) => `
      <a href="project.html?projectId=${encodeURIComponent(p.id)}" class="doc-card p-5 block hover:-translate-y-0.5 transition-transform">
        <div class="flex items-center justify-between">
          <span class="layer-badge text-sage-500">${escapeHtml(p.type || "umum").toUpperCase()}</span>
          <span class="text-xs text-ink-500">${formatRelativeTime(p.updatedAt)}</span>
        </div>
        <p class="font-display font-semibold text-ink-900 mt-3">${escapeHtml(p.name)}</p>
        <p class="text-xs text-ink-500 mt-1 line-clamp-2">${escapeHtml(p.description || "Tidak ada deskripsi.")}</p>
      </a>`).join("");
  } catch (err) {
    grid.innerHTML = `<p class="text-sm text-clay-500 sm:col-span-2">Gagal memuat proyek.</p>`;
  }
}

function bindModal() {
  const modal = document.getElementById("newProjectModal");
  document.getElementById("newProjectBtn").addEventListener("click", () => modal.classList.remove("hidden"));
  document.getElementById("cancelModal").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  document.getElementById("newProjectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("projectName").value.trim();
    const type = document.getElementById("projectType").value;
    if (!name) return;
    const btn = document.getElementById("createProjectBtn");
    setLoading(btn, true, "Membuat…");
    try {
      await callApi("createProject", { name, type });
      showToast("Proyek berhasil dibuat.", "success");
      modal.classList.add("hidden");
      document.getElementById("newProjectForm").reset();
      loadProjects();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal membuat proyek.", "error");
    } finally {
      setLoading(btn, false);
    }
  });
}
