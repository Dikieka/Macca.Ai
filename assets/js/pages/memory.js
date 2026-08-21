// assets/js/pages/memory.js
import { requireAuth } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading } from "../lib/state.js";
import { escapeHtml, formatRelativeTime, markActiveSidebarLink, applyRoleBasedNav } from "../lib/render.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAuth();
if (session) init();

const CATEGORY_LABEL = {
  preference: "Preferensi",
  writing_preference: "Gaya Penulisan",
  project_fact: "Fakta Proyek",
  workflow_preference: "Preferensi Kerja",
  long_term_goal: "Tujuan Jangka Panjang",
  active_project: "Proyek Aktif",
};

function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();
  bindModal();
  bindWritingStyleChips();
  loadMemories();
}

let memoriesCache = [];

/**
 * Konsolidasi "Gaya penulisan" (perbaikan #5): dulu field terpisah di Settings
 * (`user.writingStyle`) yang TIDAK PERNAH dibaca saat membangun prompt AI (lihat
 * router.gs buildPromptMessages_ versi lama) — jadi gantinya cuma tersimpan di
 * database tanpa efek apa pun, alias fitur gimmick. Sekarang jadi satu memory
 * biasa berkategori "writing_preference" yang MEMANG dipakai (chat.gs mengambil
 * seluruh baris "memories" milik user dan menyisipkannya ke system prompt).
 * Upsert: kalau sudah ada satu writing_preference tanpa projectId, update baris
 * itu (lewat body.id) supaya tidak numpuk banyak "gaya penulisan" yang saling
 * bertentangan di memory yang sama.
 */
function bindWritingStyleChips() {
  document.querySelectorAll("#writingStyleChips .style-chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const style = chip.dataset.style;
      const existing = memoriesCache.find((m) => m.category === "writing_preference" && !m.projectId);
      chip.disabled = true;
      try {
        await callApi("saveMemory", {
          id: existing ? existing.id : undefined,
          category: "writing_preference",
          content: `Gaya penulisan yang disukai user: ${style}.`,
        });
        showToast(`Gaya penulisan diatur ke "${style}".`, "success");
        loadMemories();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal menyimpan gaya penulisan.", "error");
      } finally {
        chip.disabled = false;
      }
    });
  });
}

function paintWritingStyleChips() {
  const active = memoriesCache.find((m) => m.category === "writing_preference" && !m.projectId);
  const activeText = active ? active.content : "";
  document.querySelectorAll("#writingStyleChips .style-chip").forEach((chip) => {
    chip.classList.toggle("is-active", !!active && activeText.includes(chip.dataset.style));
  });
}

async function loadMemories() {
  const list = document.getElementById("memoryList");
  try {
    const memories = await callApi("getMemory", {});
    memoriesCache = memories || [];
    paintWritingStyleChips();
    if (!memories?.length) {
      list.innerHTML = `
        <div class="doc-card p-8 text-center">
          <i data-lucide="brain" class="w-8 h-8 mx-auto text-ink-500"></i>
          <p class="text-sm text-ink-700 mt-3">Belum ada memory tersimpan. Macca akan lebih personal seiring kamu menggunakannya, atau tambahkan manual di atas.</p>
        </div>`;
      lucide.createIcons();
      return;
    }
    list.innerHTML = memories.map((m) => `
      <div class="doc-card p-4 flex items-start gap-4">
        <div class="min-w-0 flex-1">
          <span class="layer-badge text-sage-500">${escapeHtml(CATEGORY_LABEL[m.category] || m.category || "Preferensi")}</span>
          <p class="text-sm mt-2">${escapeHtml(m.content)}</p>
          <p class="text-xs text-ink-500 mt-1.5">${formatRelativeTime(m.createdAt)}</p>
        </div>
        <button data-id="${escapeHtml(m.id)}" class="delete-memory text-ink-500 hover:text-clay-500 shrink-0" title="Hapus memory">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>`).join("");
    lucide.createIcons();
    bindDeleteButtons();
  } catch {
    list.innerHTML = `<p class="text-sm text-clay-500">Gagal memuat memory.</p>`;
  }
}

function bindDeleteButtons() {
  document.querySelectorAll(".delete-memory").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Hapus memory ini?")) return;
      try {
        await callApi("deleteMemory", { id: btn.dataset.id });
        showToast("Memory dihapus.", "success");
        loadMemories();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal menghapus memory.", "error");
      }
    });
  });
}

function bindModal() {
  const modal = document.getElementById("memoryModal");
  document.getElementById("addMemoryBtn").addEventListener("click", () => modal.classList.remove("hidden"));
  document.getElementById("cancelMemoryModal").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  document.getElementById("memoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = document.getElementById("memoryContent").value.trim();
    const category = document.getElementById("memoryCategory").value;
    if (!content) return;
    const btn = document.getElementById("saveMemoryBtn");
    setLoading(btn, true, "Menyimpan…");
    try {
      await callApi("saveMemory", { content, category });
      showToast("Memory disimpan.", "success");
      modal.classList.add("hidden");
      document.getElementById("memoryForm").reset();
      loadMemories();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal menyimpan memory.", "error");
    } finally {
      setLoading(btn, false);
    }
  });
}
