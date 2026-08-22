// assets/js/lib/historyCache.js
//
// Cache ringan (stale-while-revalidate) untuk daftar riwayat chat di sidebar.
//
// KENAPA INI ADA: aplikasi ini adalah multi-page app (tiap halaman = HTML
// terpisah, pindah menu = full page load, bukan SPA). Sebelum modul ini ada,
// SETIAP kali pindah halaman (chat -> projects -> documents -> memory -> dst),
// sidebar menampilkan skeleton "animate-pulse" lalu menunggu round-trip penuh
// ke Apps Script (callApi("getChatHistory")) sebelum riwayat kelihatan lagi —
// padahal isinya hampir selalu SAMA dengan yang baru saja ditampilkan di
// halaman sebelumnya.
//
// SOLUSI: simpan hasil getChatHistory di sessionStorage. Saat halaman baru
// dibuka, tampilkan dulu isi cache (instan, tanpa skeleton), LALU tetap
// panggil getChatHistory seperti biasa di background untuk memastikan
// datanya akurat (chat baru/judul berubah/dihapus tetap ke-refresh). Jadi
// ini BUKAN pengganti fetch, cuma menghilangkan jeda visualnya.
//
// Di-scope per user (pakai user id dari session) supaya tidak ketuker kalau
// ada akun lain login di tab yang sama, dan pakai sessionStorage (bukan
// localStorage) supaya otomatis bersih begitu tab ditutup — tidak ada resiko
// data riwayat "nyangkut" lama-lama di penyimpanan browser.

import { getSession } from "./auth.js";

const CACHE_PREFIX = "macca_chat_history_cache_";

function cacheKey() {
  const session = getSession();
  const uid = session?.user?.id || "anon";
  return CACHE_PREFIX + uid;
}

/** Ambil daftar chat dari cache. Return null kalau tidak ada/rusak (caller fallback ke fetch biasa). */
export function getCachedChatHistory() {
  try {
    const raw = sessionStorage.getItem(cacheKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.chats) ? parsed.chats : null;
  } catch {
    return null;
  }
}

/** Simpan/replace daftar chat di cache. Gagal diam-diam kalau storage penuh/disabled. */
export function setCachedChatHistory(chats) {
  try {
    sessionStorage.setItem(cacheKey(), JSON.stringify({ chats: chats || [], ts: Date.now() }));
  } catch {
    // sessionStorage penuh atau di-disable browser -> abaikan, fitur cache
    // cuma "nice to have", aplikasi tetap jalan normal lewat fetch biasa.
  }
}

/** Hapus cache untuk user yang sedang login. Dipanggil saat logout supaya tidak bocor ke sesi berikutnya di tab yang sama. */
export function clearCachedChatHistory() {
  try {
    sessionStorage.removeItem(cacheKey());
  } catch {
    // no-op
  }
}
