// assets/js/lib/render.js
// Kumpulan util rendering DOM kecil dipakai lintas halaman.
// Prinsip: hindari innerHTML dari data user mentah (lihat security.known_risk).

export function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatRelativeTime(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(isoString).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Highlight sidebar item aktif berdasarkan nama file halaman saat ini. */
export function markActiveSidebarLink(containerSelector = "[data-sidebar-link]") {
  const current = window.location.pathname.split("/").pop();
  document.querySelectorAll(containerSelector).forEach((el) => {
    if (el.getAttribute("href") === current) {
      el.classList.add("bg-[var(--paper-100)]", "text-[var(--ink-900)]", "font-semibold");
      el.classList.remove("text-[var(--ink-500)]");
    }
  });
}

/**
 * Sisipkan link "Admin" di sidebar kalau user yang login role-nya admin (lihat
 * item #7). Dipakai di semua halaman lewat init() masing-masing, supaya tidak
 * perlu mengulang markup <a href="admin.html"> secara manual di tiap .html —
 * cukup satu tempat, dan otomatis hilang untuk user biasa.
 */
export function applyRoleBasedNav(session) {
  if (!session?.user || session.user.role !== "admin") return;
  const nav = document.querySelector("nav");
  if (!nav || nav.querySelector("[data-admin-link]")) return;
  const link = document.createElement("a");
  link.href = "admin.html";
  link.dataset.adminLink = "true";
  link.className = "flex items-center gap-2.5 px-3 py-2 rounded-md text-ink-500 hover:bg-paper-100 hover:text-ink-900";
  const current = window.location.pathname.split("/").pop();
  if (current === "admin.html") {
    link.className = "flex items-center gap-2.5 px-3 py-2 rounded-md text-ink-900 bg-paper-100 font-semibold";
  }
  link.innerHTML = `<i data-lucide="shield" class="w-4 h-4"></i> Admin`;
  nav.appendChild(link);
  if (window.lucide) lucide.createIcons();
}
/** Nama ikon lucide berdasarkan ekstensi file, dipakai untuk quickview lampiran chat. */
export function fileIconFor(nameOrType = "") {
  const s = String(nameOrType).toLowerCase();
  if (s.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(s)) return "image";
  if (s.includes("pdf") || s.endsWith(".pdf")) return "file-text";
  if (s.includes("word") || s.endsWith(".docx") || s.endsWith(".doc")) return "file-type-2";
  if (s.includes("sheet") || s.endsWith(".xlsx") || s.endsWith(".xls")) return "file-spreadsheet";
  if (s.endsWith(".csv")) return "file-spreadsheet";
  if (s.endsWith(".md") || s.endsWith(".txt")) return "file-text";
  return "file";
}

/**
 * Terapkan formatting inline ala markdown ke sebuah baris yang SUDAH di-escape
 * HTML: `code`, **bold**, *italic* / _italic_, dan tautan [label](url).
 * Aman dipanggil terhadap teks hasil escapeHtml() karena karakter markdown
 * (` * _ [ ] ( )) bukan karakter yang di-escape, jadi polanya tetap utuh untuk
 * dicocokkan di sini.
 *
 * Inline code diekstrak DULUAN ke placeholder \u0000n\u0000 sebelum bold/italic
 * diproses, supaya isi `code` (mis. `**not_bold**`) tidak ikut diformat lagi —
 * baru dikembalikan di langkah terakhir.
 */
function applyInlineFormatting_(escapedLine) {
  const codeSpans = [];
  let text = escapedLine.replace(/`([^`\n]+?)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  text = text.replace(/\*\*([^\n*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *kata* atau _kata_, tidak nyender ke huruf/angka di sebelahnya supaya
  // tidak salah kena kata_dengan_underscore atau sisa ** yang sudah diproses di atas.
  text = text.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_\w])_([^_\n]+?)_(?![\w_])/g, "$1<em>$2</em>");
  // [label](https://...) -> <a>. Skema dibatasi http(s) saja (tidak ada javascript:),
  // dan seluruh baris sudah lewat escapeHtml() sebelumnya jadi url/label aman disisipkan
  // ke atribut href tanpa risiko keluar dari tanda kutip (lihat security.known_risk).
  text = text.replace(
    /\[([^\]\n]+?)\]\((https?:\/\/[^\s")]+?)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-link">${label}</a>`
  );

  text = text.replace(/\u0000(\d+)\u0000/g, (_, idx) => `<code class="msg-inline-code">${codeSpans[Number(idx)]}</code>`);
  return text;
}

const BULLET_RE = /^\s*[-*•]\s+(.+)$/;
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.+)$/;
const LETTERED_RE = /^\s*([A-Za-z])[.)]\s+(.+)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
const BLOCKQUOTE_RE = /^\s*&gt;\s?(.*)$/; // '>' sudah jadi '&gt;' setelah escapeHtml()
const CODE_FENCE_RE = /^\s*```\s*([\w+-]*)\s*$/;

/** Pecah satu baris tabel "| a | b |" jadi array sel yang sudah di-trim. */
function splitTableRow_(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Cek apakah baris adalah baris pemisah header tabel, mis. "|---|:--:|---:|". */
function isTableSeparatorRow_(line) {
  if (!line || !line.includes("-")) return false;
  const cells = splitTableRow_(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function tableCellAlign_(sepCell) {
  const left = sepCell.startsWith(":");
  const right = sepCell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

/**
 * Render teks pesan (input user maupun balasan AI) jadi HTML ringan namun cukup
 * lengkap untuk balasan AI yang terstruktur:
 * - `# `..`###### ` -> <h1>..<h6>
 * - "---" / "***" / "___" (baris sendiri) -> <hr>
 * - ```lang ... ``` -> code block <pre><code> (tanpa parsing inline di dalamnya)
 * - "> kutipan" -> <blockquote>
 * - tabel "| a | b |" + baris pemisah "|---|---|" -> <table> (dukung alignment :--/--:)
 * - baris berurutan "- "/"* "/"• " -> <ul>, "1. " -> <ol>, "a. " -> <ol> huruf
 * - inline: **bold**, *italic* / _italic_, `code`, [label](url)
 * - baris biasa lainnya digabung jadi paragraf, baris baru -> <br>
 * Input SELALU di-escape dulu (lihat escapeHtml) sebelum dianalisis, supaya tag
 * HTML dari pesan pengguna/AI tidak pernah dieksekusi sebagai markup (lihat
 * security.known_risk) — semua tag di bawah ini murni dibuat oleh fungsi ini
 * sendiri dari teks yang sudah aman, bukan disalin mentah dari input.
 */
export function renderFormattedText(raw = "") {
  const lines = escapeHtml(raw).split(/\r?\n/);
  const blocks = [];
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      blocks.push(`<p class="mb-2 last:mb-0">${paraBuf.join("<br>")}</p>`);
      paraBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fence: konsumsi sampai ``` penutup (atau EOF), tanpa inline formatting
    // di dalamnya supaya isi kode (mis. tanda bintang di komentar) tidak dirusak.
    if (CODE_FENCE_RE.test(line)) {
      flushPara();
      const lang = line.match(CODE_FENCE_RE)[1];
      i++;
      const codeLines = [];
      while (i < lines.length && !CODE_FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // lewati fence penutup
      const langLabel = lang ? `<div class="msg-code-lang">${lang}</div>` : "";
      blocks.push(`<div class="msg-code-block">${langLabel}<pre><code>${codeLines.join("\n")}</code></pre></div>`);
      continue;
    }

    // Tabel: baris ber-"|" diikuti baris pemisah "|---|---|" menandakan header tabel.
    if (line.includes("|") && isTableSeparatorRow_(lines[i + 1])) {
      flushPara();
      const headerCells = splitTableRow_(line);
      const aligns = splitTableRow_(lines[i + 1]).map(tableCellAlign_);
      const alignAttr = (idx) => (aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "");
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        bodyRows.push(splitTableRow_(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headerCells
        .map((c, idx) => `<th${alignAttr(idx)}>${applyInlineFormatting_(c)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map((row) => `<tr>${row.map((c, idx) => `<td${alignAttr(idx)}>${applyInlineFormatting_(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      blocks.push(`<div class="msg-table-wrap"><table class="msg-table">${thead}${tbody}</table></div>`);
      continue;
    }

    if (HEADING_RE.test(line)) {
      flushPara();
      const m = line.match(HEADING_RE);
      const level = m[1].length;
      blocks.push(`<h${level} class="msg-h${level}">${applyInlineFormatting_(m[2])}</h${level}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      blocks.push(`<hr class="msg-hr">`);
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        items.push(applyInlineFormatting_(lines[i].match(BLOCKQUOTE_RE)[1]));
        i++;
      }
      blocks.push(`<blockquote class="msg-quote">${items.join("<br>")}</blockquote>`);
      continue;
    }

    if (BULLET_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting_(lines[i].match(BULLET_RE)[1])}</li>`);
        i++;
      }
      blocks.push(`<ul class="list-disc pl-5 my-2 space-y-1 marker:text-ink-500">${items.join("")}</ul>`);
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting_(lines[i].match(NUMBERED_RE)[2])}</li>`);
        i++;
      }
      blocks.push(`<ol class="list-decimal pl-5 my-2 space-y-1 marker:text-ink-500">${items.join("")}</ol>`);
      continue;
    }

    if (LETTERED_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && LETTERED_RE.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting_(lines[i].match(LETTERED_RE)[2])}</li>`);
        i++;
      }
      blocks.push(`<ol class="pl-5 my-2 space-y-1 marker:text-ink-500" style="list-style-type:lower-alpha">${items.join("")}</ol>`);
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    paraBuf.push(applyInlineFormatting_(line));
    i++;
  }
  flushPara();
  return blocks.join("") || "";
}

export function initScrollReveal(selector = ".reveal") {
  const els = document.querySelectorAll(selector);
  if (!("IntersectionObserver" in window) || els.length === 0) {
    els.forEach((el) => el.classList.add("in-view"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  els.forEach((el) => io.observe(el));
}
