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

/**
 * Markup teks shimmer ("Macca sedang berpikir…" dkk, lihat .typing-status di
 * style.css). Dulu efeknya ditulis lewat SATU elemen yang teksnya sendiri
 * dibikin color:transparent lalu "dimunculkan lagi" via background-clip:text —
 * begitu clip itu gagal di-render (race re-inject stylesheet Tailwind Play
 * CDN, atau webview yang dukungannya kurang stabil), teksnya hilang total,
 * bukan cuma animasinya diam.
 *
 * Sekarang dipecah 2 lapis (lihat komentar panjang di .typing-status /
 * .typing-status::after pada style.css):
 * - Elemen utama = teks dasar warna solid, SELALU kebaca apa pun yang terjadi.
 * - `data-text` di elemen yang sama dibaca oleh `::after { content:
 *   attr(data-text) }` di CSS untuk lapisan overlay sapuan terang. Kalau
 *   overlay ini gagal render, teks dasarnya tidak pernah ikut hilang.
 *
 * Helper ini yang menjamin `data-text` selalu sinkron persis dengan teks yang
 * ditampilkan (termasuk saat teks status berubah tahap, lihat updateShimmerText).
 */
export function shimmerTextHtml(text, extraClass = "") {
  const safe = escapeHtml(text);
  return `<span class="typing-status${extraClass ? ` ${extraClass}` : ""}" data-text="${safe}">${safe}</span>`;
}

/** Ganti teks + data-text sekaligus pada elemen .typing-status, supaya overlay shimmer (::after) tetap sinkron dengan teks dasarnya. */
export function updateShimmerText(el, text) {
  if (!el) return;
  el.textContent = text;
  el.dataset.text = text;
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

  // Frasa "berteriak" (huruf besar 3+ kata beruntun) dinormalkan SEBELUM bold/italic/link
  // diproses, supaya regex-nya cuma menyentuh teks asli (bukan ikut mencocoki tag <a>/
  // <strong> hasil substitusi berikutnya) — dan sudah lewat placeholder `code` di atas
  // supaya identifier/konstanta ALL_CAPS di dalam `code` tidak ikut dinormalkan.
  text = normalizeShouting_(text);

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

/**
 * Ubah "KATA per KATA" jadi "Kata Per Kata". Dipakai untuk menormalkan baris/frasa
 * huruf besar semua (lihat isAllCapsHeadingLine_ & normalizeShouting_ di bawah) supaya
 * hasil akhirnya terlihat rapi/profesional, bukan seperti "berteriak". Hanya menyentuh
 * huruf yang berada tepat di awal string atau setelah spasi/-// (word boundary), jadi
 * aman dipakai terhadap teks yang SUDAH di-escapeHtml() — entity seperti "&amp;"/"&lt;"
 * tidak pernah diawali oleh salah satu boundary char di atas persis di posisi huruf
 * entity-nya (huruf entity selalu langsung setelah "&", bukan setelah spasi/awal
 * string), jadi tidak ikut ter-titlecase / rusak.
 */
function toTitleCase_(s) {
  return s.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Deteksi baris "judul implisit" yang ditulis AI pakai HURUF BESAR SEMUA tanpa
 * sintaks markdown (mis. "KESIMPULAN", "LANGKAH-LANGKAH PENGERJAAN") supaya bisa
 * diformat jadi heading yang rapi alih-alih tampil kapital mentah apa adanya.
 * Sengaja dibuat cukup ketat (baris pendek, tanpa tanda baca akhir kalimat) supaya
 * TIDAK salah menangkap kalimat huruf besar yang memang panjang/biasa (itu ditangani
 * terpisah lewat normalizeShouting_ sebagai penekanan di tengah paragraf, bukan
 * heading baru).
 */
function isAllCapsHeadingLine_(line) {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (/[a-z]/.test(t)) return false; // ada huruf kecil -> bukan "semua kapital"
  if (!/[A-Z]/.test(t)) return false; // tidak ada huruf sama sekali (cuma angka/simbol)
  if (/[.?!]$/.test(t)) return false; // diakhiri tanda baca kalimat -> anggap kalimat biasa, bukan judul
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  // Minimal ada satu "kata" beneran (>=3 huruf) supaya singkatan pendek berdiri
  // sendiri (mis. "OK", "ID", "PS") tidak ikut dianggap judul bagian.
  return words.some((w) => w.replace(/[^A-Za-z]/g, "").length >= 3);
}

/**
 * Normalisasi frasa "berteriak" (3+ kata beruntun huruf besar semua) DI TENGAH
 * kalimat/paragraf biasa jadi Title Case + tebal, supaya tidak tampil sebagai
 * blok kapital yang terkesan kasar/tidak profesional. Sengaja butuh 3+ kata
 * beruntun (bukan 1-2) supaya singkatan wajar seperti "API", "PDF", "ID", "AI"
 * yang muncul di tengah kalimat normal TIDAK ikut diubah — istilah teknis
 * begitu jarang muncul 3 beruntun tanpa kata kecil di antaranya.
 */
function normalizeShouting_(text) {
  return text.replace(/\b([A-Z]{2,}(?:[ -][A-Z]{2,}){2,})\b/g, (m) => {
    if (/[a-z]/.test(m)) return m; // jaga-jaga: ada huruf kecil berarti bukan all-caps murni
    // Pakai <strong> biasa (bukan span+class custom) supaya otomatis kebagian styling
    // bold yang SUDAH ada di kedua jalur render — ".msg-text strong" di style.css untuk
    // tampilan web, dan tag selector "strong{...}" bawaan Word untuk hasil export .doc —
    // tanpa perlu nambah aturan CSS terpisah lagi di exportToWord_.
    return `<strong>${toTitleCase_(m)}</strong>`;
  });
}

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

    // Baris "judul implisit" huruf besar semua tanpa "#" (lihat isAllCapsHeadingLine_)
    // -> di-Title Case-kan lalu ditampilkan sebagai heading beraksen lime, bukan
    // dibiarkan tampil kapital mentah.
    if (isAllCapsHeadingLine_(line)) {
      flushPara();
      blocks.push(`<h4 class="msg-h4 msg-auto-heading">${applyInlineFormatting_(toTitleCase_(line.trim()))}</h4>`);
      i++;
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

/**
 * Sama seperti renderFormattedText di atas (parsing markdown: heading, bold/italic,
 * list, tabel, blockquote, code) TAPI outputnya HTML "polos" — tag semantik murni
 * tanpa class Tailwind. Dipakai khusus untuk export Word/PDF (lihat pages/chat.js ->
 * exportToWord_), karena Tailwind tidak ikut ter-load saat file .doc dibuka di Microsoft
 * Word/LibreOffice (bukan browser, tidak ada CDN Tailwind) — kalau tetap pakai class
 * Tailwind seperti renderFormattedText, semua heading/list/tabel akan tampil TANPA
 * styling apa pun di Word (rata tanpa hierarki, persis masalah "tidak rapi" yang mau
 * diperbaiki). Styling di sini disuntik lewat <style> berbasis tag selector di
 * exportToWord_, yang DIPAHAMI Word saat mengonversi HTML -> dokumen (trik mso yang sama
 * dengan yang sudah dipakai di exportToExcel_).
 */
export function renderMarkdownToWordHtml(raw = "") {
  const lines = escapeHtml(raw).split(/\r?\n/);
  const blocks = [];
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      blocks.push(`<p>${paraBuf.join("<br>")}</p>`);
      paraBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (CODE_FENCE_RE.test(line)) {
      flushPara();
      i++;
      const codeLines = [];
      while (i < lines.length && !CODE_FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

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
      blocks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    if (HEADING_RE.test(line)) {
      flushPara();
      const m = line.match(HEADING_RE);
      const level = m[1].length;
      blocks.push(`<h${level}>${applyInlineFormatting_(m[2])}</h${level}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      blocks.push(`<hr>`);
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
      blocks.push(`<blockquote>${items.join("<br>")}</blockquote>`);
      continue;
    }

    if (BULLET_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting_(lines[i].match(BULLET_RE)[1])}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting_(lines[i].match(NUMBERED_RE)[2])}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (LETTERED_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && LETTERED_RE.test(lines[i])) {
        items.push(`<li>${applyInlineFormatting_(lines[i].match(LETTERED_RE)[2])}</li>`);
        i++;
      }
      blocks.push(`<ol style="list-style-type:lower-alpha">${items.join("")}</ol>`);
      continue;
    }

    // Sama seperti di renderFormattedText: judul implisit huruf besar semua -> heading.
    if (isAllCapsHeadingLine_(line)) {
      flushPara();
      blocks.push(`<h4>${applyInlineFormatting_(toTitleCase_(line.trim()))}</h4>`);
      i++;
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
