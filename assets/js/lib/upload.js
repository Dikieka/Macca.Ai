// assets/js/lib/upload.js
//
// Sebelumnya: file diunggah mentah ke Cloudinary lewat action "uploadDocument"
// TANPA pernah mengirim `extractedText`. Akibatnya `chunkAndStoreDocument_()` di
// documents.gs tidak pernah jalan, dokumen tidak pernah punya embedding, dan
// `sendChatMessage` tidak pernah mencari isinya -> file "ada" di Cloudinary tapi
// AI tidak pernah "membacanya". Modul ini memperbaiki itu dengan:
//   1. Mengekstrak teks dari PDF/DOCX/XLSX/CSV/TXT/MD di browser (lib di-load
//      lazy dari CDN, hanya saat dibutuhkan) supaya bisa dikirim sebagai
//      `extractedText` ke backend.
//   2. Mengompres foto ke WebP sebelum upload (resize + re-encode) supaya
//      ukurannya jauh lebih kecil tanpa perlu server terpisah.
//
// Dokumen biner (PDF/DOCX/XLSX) SENGAJA TIDAK "dikompres ulang" filenya sendiri:
// format-format itu sudah berupa container terkompresi (DOCX/XLSX adalah ZIP),
// dan mengompres ulang PDF yang valid tanpa merusak isinya butuh library berat
// (mis. rasterisasi ulang tiap halaman) yang berisiko menurunkan kualitas/merusak
// file. Jadi untuk dokumen, fokusnya di ekstraksi teks (biar AI bisa "membaca"),
// bukan pengecilan ukuran file aslinya.

const CDN = {
  pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfjsWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js",
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
};

/**
 * PERBAIKAN #2 ("gagal unggah foto — tidak bisa menghubungi server, cek koneksi"):
 * Akar masalahnya BUKAN benar-benar koneksi internet user, tapi payload yang
 * terlalu besar. Apps Script Web App (backend kita) tidak toleran terhadap body
 * POST yang sangat besar — di banyak kasus nyata request semacam itu gagal di
 * level jaringan/CORS SEBELUM sempat sampai ke handler doPost() kita, dan yang
 * terlihat di browser cuma error generik `xhr.onerror` / `fetch` gagal — persis
 * pesan "Tidak bisa menghubungi server" di api.js.
 *
 * Foto yang diambil LANGSUNG dari kamera HP (menu "Ambil foto") sering kali
 * berukuran 5-20MB+ (resolusi sensor modern), jauh lebih besar dari foto yang
 * dipilih dari galeri yang mungkin sudah dikompres aplikasi lain. Base64 encoding
 * menambah ~33% ukuran lagi di atas itu. Kalau compressImageIfNeeded() gagal
 * memproses foto (mis. format HEIC yang tidak didukung createImageBitmap di
 * sebagian browser Android/desktop), kode LAMA diam-diam mengirim file asli
 * yang masih raksasa itu -> permintaan network gagal -> user cuma lihat pesan
 * generik yang menyesatkan (seolah wifi/data mereka bermasalah).
 *
 * Fix: (1) coba dua jalur dekode gambar (createImageBitmap lalu fallback ke
 * elemen <img>) supaya lebih banyak format berhasil dikompres, dan (2) kalau
 * hasil akhirnya TETAP di atas batas aman, GAGALKAN lebih awal di sisi klien
 * dengan pesan yang jelas & bisa ditindaklanjuti, bukan biarkan browser mencoba
 * mengirim payload raksasa lalu gagal secara membingungkan.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB, aman untuk Apps Script Web App + base64 overhead

const loadedScripts = new Map();
function loadScript(src) {
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("Gagal memuat pustaka: " + src));
    document.head.appendChild(el);
  });
  loadedScripts.set(src, p);
  return p;
}

function extFromName(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

/**
 * Ekstrak teks dari file supaya bisa dikirim sebagai `extractedText` ke
 * uploadDocument, sehingga langsung di-chunk + di-embed di server (lihat
 * chunkAndStoreDocument_ di documents.gs) dan bisa ditemukan oleh RAG saat chat.
 * Return null kalau tipe file tidak didukung (mis. gambar) — itu wajar, bukan error.
 */
export async function extractTextFromFile(file) {
  const ext = extFromName(file.name);
  const type = file.type || "";

  try {
    if (type.startsWith("image/")) return null; // gambar: tidak diekstrak sebagai teks

    if (type === "text/plain" || type === "text/markdown" || type === "text/csv" || ["txt", "md", "csv"].includes(ext)) {
      return await file.text();
    }

    if (type === "application/pdf" || ext === "pdf") {
      return await extractPdf_(file);
    }

    if (ext === "docx" || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return await extractDocx_(file);
    }

    if (["xlsx", "xls"].includes(ext) || type.includes("spreadsheetml") || type === "application/vnd.ms-excel") {
      return await extractXlsx_(file);
    }
  } catch (err) {
    console.error("Ekstraksi teks gagal untuk " + file.name + ":", err);
    return null; // upload tetap lanjut, hanya saja dokumen tidak bisa dicari isinya
  }

  return null;
}

async function extractPdf_(file) {
  await loadScript(CDN.pdfjs);
  const pdfjsLib = window["pdfjs-dist/build/pdf"] || window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const parts = [];
  const maxPages = Math.min(pdf.numPages, 80); // batas wajar untuk skripsi/laporan, hindari timeout browser
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");
    parts.push(text);
  }
  return parts.join("\n\n");
}

async function extractDocx_(file) {
  await loadScript(CDN.mammoth);
  const buffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractXlsx_(file) {
  await loadScript(CDN.xlsx);
  const buffer = await file.arrayBuffer();
  const wb = window.XLSX.read(buffer, { type: "array" });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const csv = window.XLSX.utils.sheet_to_csv(sheet);
    return `# Sheet: ${name}\n${csv}`;
  }).join("\n\n");
}

/**
 * Kompres foto sebelum upload: resize ke maksimal `maxDimension` px di sisi
 * terpanjang, lalu re-encode ke WebP dengan `quality`. Kalau browser tidak
 * dukung WebP (jarang sekali di 2026) atau file bukan gambar, file asli
 * dikembalikan apa adanya.
 */
export async function compressImageIfNeeded(file, { maxDimension = 1920, quality = 0.82 } = {}) {
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/gif") {
    // GIF dilewati supaya animasi tidak hilang jadi 1 frame WebP.
    return { file, originalSize: file.size, isCompressed: false };
  }

  let bitmap = await createImageBitmap(file).catch(() => null);
  // Fallback: sebagian browser (terutama Android WebView lama) gagal decode lewat
  // createImageBitmap untuk beberapa varian JPEG kamera, tapi berhasil lewat <img>.
  if (!bitmap) bitmap = await decodeViaImageElement_(file).catch(() => null);

  if (!bitmap) {
    // Foto benar-benar tidak bisa dikompres di browser ini (mis. format HEIC/HEIF
    // dari kamera iPhone yang belum didukung). Kalau ukurannya masih wajar, tetap
    // kirim apa adanya (server/Cloudinary yang urus konversi). Kalau sudah kelewat
    // besar, GAGALKAN sekarang dengan pesan jelas alih-alih membiarkan upload
    // gagal misterius di tengah jalan (lihat catatan MAX_UPLOAD_BYTES di atas).
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Foto ini berukuran ${formatBytes(file.size)} dan formatnya tidak bisa dikompres otomatis di browser ini ` +
        `(kemungkinan HEIC/HEIF). Coba ubah pengaturan kamera HP ke JPEG, atau kompres/ubah foto ke JPG dulu sebelum diunggah.`
      );
    }
    return { file, originalSize: file.size, isCompressed: false };
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const targetW = Math.max(1, Math.round(bitmap.width * scale));
  const targetH = Math.max(1, Math.round(bitmap.height * scale));

  const renderToBlob = (w, h, q) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", q));
  };

  let blob = await renderToBlob(targetW, targetH, quality);
  // Kalau masih di atas batas aman (foto beresolusi sangat tinggi), render ULANG
  // dari sumber asli dengan dimensi & kualitas lebih kecil, bukan dari hasil
  // compress pertama (supaya kualitasnya tidak berlipat-lipat turun sia-sia).
  if (blob && blob.size > MAX_UPLOAD_BYTES) {
    const scale2 = Math.max(0.3, Math.sqrt(MAX_UPLOAD_BYTES / blob.size) * 0.9);
    const w2 = Math.max(1, Math.round(targetW * scale2));
    const h2 = Math.max(1, Math.round(targetH * scale2));
    blob = await renderToBlob(w2, h2, Math.min(quality, 0.7));
  }
  bitmap.close?.(); // lepas memori ImageBitmap sesegera mungkin (foto kamera bisa besar)

  if (!blob || blob.size >= file.size) {
    // Kalau hasil kompres justru lebih besar (jarang, biasanya file kecil), pakai file asli.
    return { file, originalSize: file.size, isCompressed: false };
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Foto ini masih ${formatBytes(blob.size)} setelah dikompres (resolusi aslinya sangat tinggi). ` +
      `Coba ambil ulang dengan resolusi kamera lebih rendah, atau unggah foto lain.`
    );
  }

  const newName = file.name.replace(/\.[a-zA-Z0-9]+$/, "") + ".webp";
  const compressedFile = new File([blob], newName, { type: "image/webp" });
  return { file: compressedFile, originalSize: file.size, isCompressed: true };
}

/** Fallback decode gambar lewat elemen <img> (dipetakan ke bentuk yang sama seperti ImageBitmap: width/height + bisa digambar ke canvas). */
function decodeViaImageElement_(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gagal decode gambar.")); };
    img.src = url;
  });
}

/**
 * Fungsi utama dipakai chat.js & documents.js: kompres kalau foto, ekstrak teks
 * kalau dokumen, lalu kembalikan semua siap dikirim ke action "uploadDocument".
 */
export async function prepareFileForUpload(file, { onStatus } = {}) {
  onStatus?.("Menyiapkan file…");

  // Dokumen (bukan foto) tidak dikompres ulang (lihat catatan di atas file ini) — jadi
  // batas ukuran perlu dicek langsung di sini juga, bukan cuma di dalam
  // compressImageIfNeeded, supaya PDF/DOCX/XLSX besar juga gagal cepat & jelas
  // ketimbang bikin request network yang gagal misterius (lihat perbaikan #2).
  const isImage = !!file.type && file.type.startsWith("image/");
  if (!isImage && file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File ini berukuran ${formatBytes(file.size)}, melebihi batas ${formatBytes(MAX_UPLOAD_BYTES)}. Unggah file yang lebih kecil.`);
  }

  const { file: finalFile, originalSize, isCompressed } = await compressImageIfNeeded(file);

  if (isCompressed) onStatus?.(`Foto dikompres ke WebP (${formatBytes(originalSize)} → ${formatBytes(finalFile.size)})…`);

  let extractedText = null;
  if (!finalFile.type.startsWith("image/")) {
    onStatus?.("Mengekstrak teks dokumen…");
    extractedText = await extractTextFromFile(finalFile);
  }

  const base64Data = await fileToBase64_(finalFile);
  return {
    file: finalFile,
    base64Data,
    extractedText: extractedText || undefined,
    originalSize: isCompressed ? originalSize : undefined,
    isCompressed,
  };
}

function fileToBase64_(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
