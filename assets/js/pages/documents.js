// assets/js/pages/documents.js
import { requireAuth } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, confirmDialog } from "../lib/state.js";
import { escapeHtml, formatRelativeTime, markActiveSidebarLink, applyRoleBasedNav } from "../lib/render.js";
import { prepareFileForUpload } from "../lib/upload.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAuth();
if (session) init();

const FILE_ICONS = {
  pdf: "file-text", docx: "file-type", xlsx: "table",
  txt: "file", csv: "table", md: "file-text",
  png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
};

function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();
  bindUploadMenu();
  loadDocuments();
}

function extFromName(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

async function loadDocuments() {
  const list = document.getElementById("documentList");
  try {
    const { documents: docs, storage } = await callApi("getDocuments", {});
    renderStorage(storage);

    if (!docs?.length) {
      list.innerHTML = `
        <div class="doc-card p-8 text-center">
          <i data-lucide="file-plus" class="w-8 h-8 mx-auto text-ink-500"></i>
          <p class="text-sm text-ink-700 mt-3">Belum ada dokumen. Unggah PDF, DOCX, XLSX, atau foto untuk dianalisis Macca.</p>
        </div>`;
      lucide.createIcons();
      return;
    }
    list.innerHTML = docs.map((d) => {
      const ext = extFromName(d.name);
      const icon = FILE_ICONS[ext] || "file";
      const statusColor = d.status === "processed" ? "text-sage-500" : "text-amber-600";
      return `
      <div class="doc-card p-4 flex items-center gap-4" data-doc-row="${escapeHtml(d.id)}">
        <div class="w-10 h-10 rounded-md bg-paper-100 grid place-items-center shrink-0">
          <i data-lucide="${icon}" class="w-5 h-5 text-ink-900"></i>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold truncate">${escapeHtml(d.name)}</p>
          <p class="text-xs text-ink-500 mt-0.5">${formatRelativeTime(d.createdAt)} · ${formatBytes(d.fileSize)}${
            d.isCompressed && d.originalSize ? ` <span class="text-sage-500">(dikompres dari ${formatBytes(d.originalSize)})</span>` : ""
          }</p>
        </div>
        <span class="text-xs font-mono ${statusColor} shrink-0">${escapeHtml(d.status || "uploaded")}</span>
        ${d.fileUrl ? `<a href="${escapeHtml(d.fileUrl)}" target="_blank" rel="noopener" title="Buka file" class="text-ink-500 hover:text-ink-900 shrink-0"><i data-lucide="external-link" class="w-4 h-4"></i></a>` : ""}
        <button type="button" data-delete-doc="${escapeHtml(d.id)}" title="Hapus dokumen" class="text-ink-500 hover:text-clay-500 shrink-0">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>`;
    }).join("");
    lucide.createIcons();
    bindDeleteButtons();
  } catch {
    list.innerHTML = `<p class="text-sm text-clay-500">Gagal memuat dokumen.</p>`;
  }
}

function bindDeleteButtons() {
  document.querySelectorAll("[data-delete-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const documentId = btn.dataset.deleteDoc;
      if (!(await confirmDialog("File akan dihapus permanen dari penyimpanan.", { title: "Hapus dokumen ini?", confirmText: "Hapus", danger: true }))) return;
      const row = document.querySelector(`[data-doc-row="${CSS.escape(documentId)}"]`);
      if (row) row.classList.add("opacity-50", "pointer-events-none");
      try {
        const { storage } = await callApi("deleteDocument", { documentId });
        showToast("Dokumen dihapus.", "success");
        renderStorage(storage);
        row?.remove();
        if (!document.querySelector("[data-doc-row]")) loadDocuments();
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : "Gagal menghapus dokumen.", "error");
        row?.classList.remove("opacity-50", "pointer-events-none");
      }
    });
  });
}

function renderStorage(storage) {
  if (!storage) return;
  document.getElementById("storageLabel").textContent =
    `${formatBytes(storage.usedBytes)} dari ${formatBytes(storage.quotaBytes)} terpakai`;
  document.getElementById("storagePercent").textContent = `${storage.usedPercent}%`;
  const bar = document.getElementById("storageBar");
  bar.style.width = `${storage.usedPercent}%`;
  bar.classList.toggle("bg-lime-500", !storage.isWarning);
  bar.classList.toggle("bg-clay-500", storage.isWarning);
  document.getElementById("storageWarning").classList.toggle("hidden", !storage.isWarning);
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- Menu unggah: dokumen / foto ----------
function bindUploadMenu() {
  const menuBtn = document.getElementById("uploadMenuBtn");
  const menu = document.getElementById("uploadMenu");

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== menuBtn) menu.classList.add("hidden");
  });

  ["fileInput", "photoInput"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (e) => {
      menu.classList.add("hidden");
      handleUpload(e.target);
    });
  });
}

async function handleUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 45 * 1024 * 1024) {
    showToast("Ukuran file maksimal ~45MB (batas kuota Apps Script).", "error");
    input.value = "";
    return;
  }
  try {
    const prepped = await prepareFileForUpload(file, {
      onStatus: (msg) => showToast(msg, "info"),
    });
    const { storage } = await callApi("uploadDocument", {
      fileName: prepped.file.name,
      mimeType: prepped.file.type,
      base64Data: prepped.base64Data,
      extractedText: prepped.extractedText,
      originalSize: prepped.originalSize,
      isCompressed: prepped.isCompressed,
      projectId: "",
    });
    showToast(`${prepped.file.name} berhasil diunggah${prepped.extractedText ? " & diproses" : ""}.`, "success");
    if (storage?.isWarning) {
      showToast(`Penyimpanan kamu sudah ${storage.usedPercent}% terpakai. Pertimbangkan hapus dokumen lama.`, "info");
    }
    loadDocuments();
  } catch (err) {
    // #2: pesan asli dari prepareFileForUpload (mis. validasi ukuran file) lebih jelas
    // daripada generik "Gagal mengunggah file." — lihat catatan di upload.js.
    showToast(err instanceof ApiError || err instanceof Error ? err.message : "Gagal mengunggah file.", "error");
  } finally {
    input.value = "";
  }
}
