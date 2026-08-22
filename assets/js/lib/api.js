// assets/js/lib/api.js
// Semua komunikasi ke backend WAJIB lewat file ini.
// Backend adalah satu Apps Script Web App: setiap request membawa
// parameter "action" yang di-routing manual oleh doGet/doPost di Code.gs.

import { CONFIG } from "./config.js";
import { getSession } from "./auth.js";

/**
 * Memanggil Apps Script Web App.
 * @param {string} action - nama action, contoh: "sendChatMessage"
 * @param {object} payload - data yang dikirim
 * @param {{auth?: boolean, signal?: AbortSignal}} opts - auth: true -> sertakan session token.
 *   signal: #5 (stop generate) -> AbortController.signal dari pemanggil (lihat chat.js
 *   beginGeneration()), supaya user bisa membatalkan request yang masih menunggu balasan AI.
 */
// PERBAIKAN (riwayat chat "loading" selamanya): fetch() browser TIDAK punya batas
// waktu bawaan. Kalau Apps Script Web App macet/lambat merespons (cold start,
// kena antrian LockService, kuota, dsb — lihat callApiWithProgress yang sudah
// lebih dulu diberi xhr.timeout karena masalah persis ini di jalur upload),
// promise callApi() bisa menggantung TANPA PERNAH resolve/reject. Akibatnya
// kode pemanggil (mis. loadChatList() di chat.js/sidebar.js) tidak pernah
// keluar dari blok try, skeleton animate-pulse di #chatList tidak pernah
// diganti, dan yang terlihat oleh user cuma "loading" tanpa henti — tidak ada
// pesan error sama sekali karena memang tidak ada apa pun yang gagal secara
// eksplisit. Timeout di bawah ini memaksa request menyerah setelah 20 detik
// supaya selalu ada hasil (sukses ATAU pesan error) yang bisa ditampilkan.
const DEFAULT_TIMEOUT_MS = 20000;

// PERBAIKAN (AI generate "sering gagal" / bubble macet lalu dianggap gagal): 20 detik
// tadinya dipakai untuk SEMUA action, termasuk yang benar-benar menghasilkan balasan AI.
// Untuk chat biasa itu longgar, tapi untuk pertanyaan yang lewat jalur ensemble akademik
// (3 model paralel + 1 sintesis, lihat router.gs generateAcademicEnsembleReply_) atau yang
// perlu fallback ke model kedua karena model pertama gagal/lambat (model gratis OpenRouter
// kadang butuh 15-30 detik sendiri), total waktunya gampang lewat 20 detik walau server
// sebenarnya masih memproses dengan normal dan AKAN tetap menjawab kalau ditunggu lebih
// lama. Selama ini frontend keburu abort duluan lalu menganggapnya gagal — jadi bukan
// server yang gagal, tapi client yang menyerah terlalu cepat. Action generate AI di bawah
// ini dapat jatah waktu jauh lebih panjang; action ringan (getChatHistory, dsb) tetap pakai
// DEFAULT_TIMEOUT_MS supaya UI lain tidak ikut terasa "menggantung" kalau server memang
// benar-benar tidak merespons.
const LONG_TIMEOUT_MS = 75000;
const LONG_TIMEOUT_ACTIONS_ = new Set(["sendChatMessage", "editMessage", "regenerateReply", "continueReply", "paraphrase"]);

export async function callApi(action, payload = {}, opts = { auth: true }) {
  const body = { action, ...payload };

  if (opts.auth !== false) {
    const session = getSession();
    if (!session?.token) {
      throw new ApiError("NO_SESSION", "Sesi tidak ditemukan, silakan login kembali.");
    }
    body.token = session.token;
  }

  const timeoutMs = opts.timeoutMs || (LONG_TIMEOUT_ACTIONS_.has(action) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  // Gabungkan timeout internal dengan signal eksternal (mis. tombol Stop saat
  // generate balasan AI) — siapa pun yang trigger duluan yang menang.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) timeoutController.abort(opts.signal.reason);
    else opts.signal.addEventListener("abort", () => timeoutController.abort(opts.signal.reason), { once: true });
  }

  let res;
  try {
    // Apps Script Web App tidak mendukung header custom + preflight dengan baik,
    // jadi kita kirim sebagai text/plain agar tidak memicu CORS preflight,
    // lalu Apps Script mem-parse body-nya sebagai JSON secara manual.
    res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });
  } catch (err) {
    // #5: fetch yang dibatalkan lewat AbortController.abort() masuk sini dengan
    // err.name === "AbortError" — ini BUKAN kegagalan jaringan, jadi jangan
    // ditampilkan sebagai NETWORK_ERROR (pesannya menyesatkan & memicu toast merah
    // padahal user sengaja menekan tombol Stop).
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      // Bedakan: timeout internal kita (server tidak merespons) vs benar-benar
      // dibatalkan user lewat opts.signal (mis. tombol Stop).
      if (opts.signal?.aborted) throw new ApiError("ABORTED", "Dihentikan oleh pengguna.");
      throw new ApiError("TIMEOUT", "Server tidak merespons dalam waktu wajar. Coba lagi sebentar lagi.");
    }
    throw new ApiError("NETWORK_ERROR", "Tidak bisa menghubungi server. Cek koneksi internet kamu.");
  } finally {
    clearTimeout(timeoutId);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new ApiError("BAD_RESPONSE", "Respons server tidak valid.");
  }

  if (!json.ok) {
    throw new ApiError(json.errorCode || "UNKNOWN_ERROR", json.message || "Terjadi kesalahan.");
  }

  return json.data;
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Sama seperti callApi, tapi pakai XMLHttpRequest supaya bisa dapat event
 * `upload.onprogress` (progress BYTE ASLI, bukan simulasi) — dipakai composer
 * chat untuk menampilkan progress bar saat unggah foto/dokumen (mirip ChatGPT),
 * karena `fetch()` di browser belum mendukung upload progress secara luas.
 * @param {(percent: number) => void} onProgress - 0-100
 */
export function callApiWithProgress(action, payload = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const body = { action, ...payload };
    if (payload.__skipAuth !== true) {
      const session = getSession();
      if (!session?.token) {
        reject(new ApiError("NO_SESSION", "Sesi tidak ditemukan, silakan login kembali."));
        return;
      }
      body.token = session.token;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", CONFIG.APPS_SCRIPT_URL, true);
    xhr.setRequestHeader("Content-Type", "text/plain;charset=utf-8");
    // PERBAIKAN #2: upload foto/dokumen besar via Apps Script Web App kadang macet
    // tanpa pernah memicu onerror ATAU onload (browser + server sama-sama diam).
    // Tanpa timeout, user cuma lihat progress bar macet selamanya. 45 detik cukup
    // longgar untuk file <= MAX_UPLOAD_BYTES (8MB) bahkan di koneksi lambat.
    xhr.timeout = 45000;

    let payloadStarted = false;
    xhr.upload.addEventListener("loadstart", () => { payloadStarted = true; });
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress(Math.round((e.loaded / e.total) * 100));
    };

    // Pesan lebih spesifik: request yang gagal SETELAH mulai mengirim data (byte upload
    // sudah berjalan) hampir selalu bukan soal "koneksi internet putus", melainkan server
    // menolak/memutus payload yang terlalu besar — beda akar masalah, beda saran ke user.
    xhr.onerror = () => {
      reject(new ApiError(
        "NETWORK_ERROR",
        payloadStarted
          ? "Gagal mengirim file ke server. Kemungkinan ukuran file masih terlalu besar untuk koneksi ini — coba file yang lebih kecil."
          : "Tidak bisa menghubungi server. Cek koneksi internet kamu."
      ));
    };
    xhr.ontimeout = () => reject(new ApiError(
      "TIMEOUT",
      "Server tidak merespons dalam waktu wajar. Coba lagi, atau gunakan file/foto yang lebih kecil kalau ini terjadi berulang."
    ));

    xhr.onload = () => {
      let json;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiError("BAD_RESPONSE", "Respons server tidak valid."));
        return;
      }
      if (!json.ok) {
        reject(new ApiError(json.errorCode || "UNKNOWN_ERROR", json.message || "Terjadi kesalahan."));
        return;
      }
      onProgress?.(100);
      resolve(json.data);
    };

    xhr.send(JSON.stringify(body));
  });
}
