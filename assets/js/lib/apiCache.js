// assets/js/lib/apiCache.js
//
// Cache generik (stale-while-revalidate), pola sama seperti historyCache.js,
// tapi untuk data lain yang juga sering di-fetch ulang di halaman berbeda
// padahal jarang berubah: daftar model AI (listModels) dan daftar proyek
// (getProjects). Tampilkan cache dulu (instan), lalu tetap fetch ke server
// di background untuk menjaga akurasi — jumlah validasi ke Apps Script TIDAK
// berkurang, cuma jeda "loading" di layar yang hilang saat pindah halaman.
//
// Di-scope per user + per nama cache ("models", "projects_recent",
// "projects_all", dst) supaya varian getProjects yang berbeda (limit 4 buat
// widget "proyek terbaru" vs daftar lengkap di halaman Projects) tidak
// saling timpa walau sama-sama menyimpan daftar proyek.

import { getSession } from "./auth.js";

const PREFIX = "macca_apicache_";

function storageKey(name) {
  const session = getSession();
  const uid = session?.user?.id || "anon";
  return `${PREFIX}${name}_${uid}`;
}

/** Ambil data dari cache untuk nama tertentu. Return null kalau tidak ada/rusak. */
export function getCached(name) {
  try {
    const raw = sessionStorage.getItem(storageKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && "data" in parsed ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Simpan/replace data di cache untuk nama tertentu. Gagal diam-diam kalau storage penuh/disabled. */
export function setCached(name, data) {
  try {
    sessionStorage.setItem(storageKey(name), JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // no-op — fitur cache cuma "nice to have", aplikasi tetap jalan lewat fetch biasa
  }
}

/** Hapus SEMUA cache (models, projects_*, dst) milik user yang sedang login. Dipanggil saat logout. */
export function clearAllApiCaches() {
  try {
    const uid = getSession()?.user?.id || "anon";
    const suffix = `_${uid}`;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX) && k.endsWith(suffix)) sessionStorage.removeItem(k);
    }
  } catch {
    // no-op
  }
}
