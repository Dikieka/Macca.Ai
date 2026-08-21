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
export async function callApi(action, payload = {}, opts = { auth: true }) {
  const body = { action, ...payload };

  if (opts.auth !== false) {
    const session = getSession();
    if (!session?.token) {
      throw new ApiError("NO_SESSION", "Sesi tidak ditemukan, silakan login kembali.");
    }
    body.token = session.token;
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
      signal: opts.signal,
    });
  } catch (err) {
    // #5: fetch yang dibatalkan lewat AbortController.abort() masuk sini dengan
    // err.name === "AbortError" — ini BUKAN kegagalan jaringan, jadi jangan
    // ditampilkan sebagai NETWORK_ERROR (pesannya menyesatkan & memicu toast merah
    // padahal user sengaja menekan tombol Stop).
    if (err?.name === "AbortError") throw new ApiError("ABORTED", "Dihentikan oleh pengguna.");
    throw new ApiError("NETWORK_ERROR", "Tidak bisa menghubungi server. Cek koneksi internet kamu.");
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
