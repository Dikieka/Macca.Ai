// assets/js/lib/auth.js
// Mengelola session token di localStorage (bukan cookie httpOnly, lihat
// known_limitations soal CORS lintas domain GitHub Pages <-> Apps Script).

import { CONFIG } from "./config.js";
import { clearCachedChatHistory } from "./historyCache.js";
import { clearAllApiCaches } from "./apiCache.js";

export function getSession() {
  try {
    const raw = localStorage.getItem(CONFIG.SESSION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.expiresAt && Date.now() > session.expiresAt) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession({ token, user }) {
  const session = {
    token,
    user,
    expiresAt: Date.now() + CONFIG.TOKEN_TTL_HOURS * 60 * 60 * 1000,
  };
  localStorage.setItem(CONFIG.SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearSession() {
  // PENTING: bersihkan cache SEBELUM session dihapus, karena fungsi cache di
  // bawah butuh user id dari session yang masih aktif untuk tahu key mana
  // yang harus dihapus. Kalau urutannya dibalik, yang ke-hapus malah key
  // "anon" (salah), bukan key milik user yang logout.
  clearCachedChatHistory();
  clearAllApiCaches();
  localStorage.removeItem(CONFIG.SESSION_STORAGE_KEY);
}

export function logout(redirectTo = "login.html") {
  clearSession();
  window.location.href = redirectTo;
}

/**
 * Panggil di paling atas setiap halaman protected (dashboard, chat, dll).
 * Redirect ke login.html jika tidak ada sesi valid.
 */
export function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session;
}

/** Panggil di paling atas halaman admin.html. Redirect user non-admin ke chat.html. */
export function requireAdmin() {
  const session = requireAuth();
  if (session && session.user?.role !== "admin") {
    window.location.href = "chat.html";
    return null;
  }
  return session;
}

/**
 * Panggil di halaman login/register agar user yang sudah login
 * langsung diarahkan ke dashboard.
 */
export function redirectIfAuthed(redirectTo = "chat.html") {
  if (getSession()) {
    window.location.href = redirectTo;
  }
}
