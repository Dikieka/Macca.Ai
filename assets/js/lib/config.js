// assets/js/lib/config.js
// Ganti APPS_SCRIPT_URL dengan URL deployment "Web App" Apps Script kamu.
// Dev/staging/production bisa pakai deployment berbeda.

export const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbz7KPf3DHdpJ4kZBED5chLxknulQ7Yfvf13wKgYAkswPT3olsHqRwBfddwxzG_jTcS0/exec",
  // PENTING: Sign in with Google TIDAK akan pernah berfungsi selama nilai di bawah
  // ini masih placeholder. Ini bukan bug kode — Client ID wajib dibuat sendiri per
  // proyek/domain lewat Google Cloud Console (lihat README bagian 3), karena Google
  // memvalidasi origin pemanggil terhadap Client ID tsb. login.html & register.html
  // otomatis mendeteksi placeholder ini dan menampilkan notice, bukan tombol rusak.
  GOOGLE_CLIENT_ID: "293152929752-sbqkmm26l3ie25vpkdfu9flijihcbgm9.apps.googleusercontent.com",
  APP_NAME: "Macca.Ai",
  SESSION_STORAGE_KEY: "macca_session",
  TOKEN_TTL_HOURS: 12,
};

/** true kalau GOOGLE_CLIENT_ID sudah diisi Client ID asli (bukan placeholder/kosong). */
export function isGoogleClientConfigured() {
  const id = CONFIG.GOOGLE_CLIENT_ID || "";
  return id.endsWith(".apps.googleusercontent.com") && !id.startsWith("GANTI_DENGAN");
}
