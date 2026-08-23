// assets/js/pages/admin.js
import { requireAdmin } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading, confirmDialog } from "../lib/state.js";
import { escapeHtml, applyRoleBasedNav } from "../lib/render.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAdmin();
if (session) init();

function init() {
  lucide.createIcons();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();
  bindTabs();
  bindModelModal();
  loadStats();
  loadUsers();
  loadModels();
}

function bindTabs() {
  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((b) => {
        b.classList.toggle("border-lime-500", b === btn);
        b.classList.toggle("text-ink-900", b === btn);
        b.classList.toggle("border-transparent", b !== btn);
        b.classList.toggle("text-ink-500", b !== btn);
      });
      document.getElementById("tabUsers").classList.toggle("hidden", btn.dataset.tab !== "users");
      document.getElementById("tabModels").classList.toggle("hidden", btn.dataset.tab !== "models");
    });
  });
}

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadStats() {
  const grid = document.getElementById("statsGrid");
  try {
    const s = await callApi("adminStats", {});
    const items = [
      { label: "Total user", value: s.totalUsers, sub: `${s.totalAdmins} admin` },
      { label: "Total chat", value: s.totalChats, sub: `${s.totalMessages} pesan` },
      { label: "Dokumen", value: s.totalDocuments, sub: formatBytes(s.totalStorageBytes) },
      { label: "Request AI", value: s.totalAiRequests, sub: `${s.failedAiRequests} gagal` },
    ];
    grid.innerHTML = items.map((it) => `
      <div class="doc-card p-4">
        <p class="text-xs text-ink-500">${escapeHtml(it.label)}</p>
        <p class="font-display text-2xl font-semibold text-ink-900 mt-1">${it.value}</p>
        <p class="text-xs text-ink-500 mt-0.5">${escapeHtml(String(it.sub))}</p>
      </div>`).join("");
  } catch (err) {
    grid.innerHTML = `<p class="text-sm text-clay-500 col-span-4">${escapeHtml(err instanceof ApiError ? err.message : "Gagal memuat statistik.")}</p>`;
  }
}

async function loadUsers() {
  const el = document.getElementById("tabUsers");
  try {
    const users = await callApi("adminListUsers", {});
    el.innerHTML = users.map((u) => `
      <div class="doc-card p-4 flex items-center justify-between gap-3 flex-wrap" data-user-row="${escapeHtml(u.id)}">
        <div class="min-w-0">
          <p class="text-sm font-medium truncate">${escapeHtml(u.fullName)} ${u.id === session.user.id ? '<span class="text-xs text-ink-500">(kamu)</span>' : ""}</p>
          <p class="text-xs text-ink-500 truncate">${escapeHtml(u.email)} · ${formatBytes(u.storageUsedBytes)} storage</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="layer-badge ${u.status === "suspended" ? "text-clay-500" : "text-sage-500"}">${escapeHtml(u.status)}</span>
          <select data-role-select data-id="${escapeHtml(u.id)}" class="text-xs bg-paper-100 border border-[var(--line)] rounded-md px-2 py-1.5 outline-none focus:border-lime-500">
            <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
          <button data-status-toggle data-id="${escapeHtml(u.id)}" data-status="${escapeHtml(u.status)}"
            class="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-[var(--line)] hover:bg-paper-100" ${u.id === session.user.id ? "disabled" : ""}>
            ${u.status === "suspended" ? "Aktifkan" : "Suspend"}
          </button>
        </div>
      </div>`).join("");
    bindUserActions();
  } catch (err) {
    el.innerHTML = `<p class="text-sm text-clay-500">${escapeHtml(err instanceof ApiError ? err.message : "Gagal memuat user.")}</p>`;
  }
}

function bindUserActions() {
  document.querySelectorAll("[data-role-select]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await callApi("adminUpdateUserRole", { userId: sel.dataset.id, role: sel.value });
        showToast("Role diperbarui.", "success");
        loadUsers();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal mengubah role.", "error");
        loadUsers();
      }
    });
  });

  document.querySelectorAll("[data-status-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.status === "suspended" ? "active" : "suspended";
      if (next === "suspended" && !(await confirmDialog("Semua sesi login aktifnya akan dihentikan.", { title: "Suspend user ini?", confirmText: "Suspend", danger: true }))) return;
      try {
        await callApi("adminUpdateUserStatus", { userId: btn.dataset.id, status: next });
        showToast(next === "suspended" ? "User disuspend." : "User diaktifkan kembali.", "success");
        loadUsers();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal mengubah status.", "error");
      }
    });
  });
}

async function loadModels() {
  const el = document.getElementById("modelList");
  try {
    const models = await callApi("adminListModels", {});
    el.innerHTML = models.map((m) => `
      <div class="doc-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <p class="text-sm font-mono font-medium truncate">${escapeHtml(m.modelSlug)}</p>
          <p class="text-xs text-ink-500 mt-0.5">${escapeHtml(m.capabilities || "")} ${m.free === true || m.free === "TRUE" ? "· gratis" : ""}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <label class="flex items-center gap-1.5 text-xs text-ink-700">
            <input type="checkbox" data-toggle-model data-id="${escapeHtml(m.id)}" ${m.enabled === true || m.enabled === "TRUE" ? "checked" : ""} /> Aktif
          </label>
          <button data-edit-model='${escapeHtml(JSON.stringify(m))}' class="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-[var(--line)] hover:bg-paper-100">Edit</button>
          <button data-delete-model data-id="${escapeHtml(m.id)}" class="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-[var(--line)] text-clay-500 hover:bg-paper-100">Hapus</button>
        </div>
      </div>`).join("") || `<p class="text-sm text-ink-500">Belum ada model terdaftar.</p>`;
    bindModelActions();
  } catch (err) {
    el.innerHTML = `<p class="text-sm text-clay-500">${escapeHtml(err instanceof ApiError ? err.message : "Gagal memuat model.")}</p>`;
  }
}

function bindModelActions() {
  document.querySelectorAll("[data-toggle-model]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      try {
        await callApi("adminToggleModel", { id: cb.dataset.id, enabled: cb.checked });
        showToast("Status model diperbarui.", "success");
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal mengubah status model.", "error");
        cb.checked = !cb.checked;
      }
    });
  });

  document.querySelectorAll("[data-edit-model]").forEach((btn) => {
    btn.addEventListener("click", () => openModelModal(JSON.parse(btn.dataset.editModel)));
  });

  document.querySelectorAll("[data-delete-model]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!(await confirmDialog("User tidak akan bisa memilihnya lagi.", { title: "Hapus model ini dari daftar?", confirmText: "Hapus", danger: true }))) return;
      try {
        await callApi("adminDeleteModel", { id: btn.dataset.id });
        showToast("Model dihapus.", "success");
        loadModels();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal menghapus model.", "error");
      }
    });
  });
}

function bindModelModal() {
  const modal = document.getElementById("modelModal");
  document.getElementById("addModelBtn").addEventListener("click", () => openModelModal());
  document.getElementById("cancelModelModal").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  document.getElementById("modelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    setLoading(btn, true, "Menyimpan…");
    try {
      await callApi("adminUpsertModel", {
        id: document.getElementById("modelId").value || undefined,
        modelSlug: document.getElementById("modelSlug").value.trim(),
        capabilities: document.getElementById("modelCapabilities").value.trim(),
        free: document.getElementById("modelFree").checked,
        enabled: document.getElementById("modelEnabled").checked,
        provider: "openrouter",
      });
      showToast("Model tersimpan.", "success");
      modal.classList.add("hidden");
      loadModels();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal menyimpan model.", "error");
    } finally {
      setLoading(btn, false);
    }
  });
}

function openModelModal(model) {
  document.getElementById("modelId").value = model?.id || "";
  document.getElementById("modelSlug").value = model?.modelSlug || "";
  document.getElementById("modelCapabilities").value = model?.capabilities || "";
  document.getElementById("modelFree").checked = model ? (model.free === true || model.free === "TRUE") : true;
  document.getElementById("modelEnabled").checked = model ? (model.enabled === true || model.enabled === "TRUE") : true;
  document.getElementById("modelModal").classList.remove("hidden");
}
