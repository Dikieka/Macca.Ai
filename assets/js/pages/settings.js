// assets/js/pages/settings.js
import { requireAuth, logout, setSession, getSession } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast, setLoading } from "../lib/state.js";
import { markActiveSidebarLink, applyRoleBasedNav } from "../lib/render.js";
import { initSidebarResize, initSidebarMobile, loadSidebarHistory } from "../lib/sidebar.js";

const session = requireAuth();
if (session) init();

function init() {
  lucide.createIcons();
  markActiveSidebarLink();
  applyRoleBasedNav(session);
  initSidebarResize();
  initSidebarMobile();
  loadSidebarHistory();
  prefillForm();
  bindForm();
  bindLogout();
}

function prefillForm() {
  const user = session.user || {};
  document.getElementById("fullName").value = user.fullName || "";
  document.getElementById("email").value = user.email || "";
  document.getElementById("preferredLanguage").value = user.preferredLanguage || "id";
  document.getElementById("writingStyle").value = user.writingStyle || "formal";
  document.getElementById("avatarPreview").textContent = (user.fullName || "U").charAt(0).toUpperCase();
}

function bindForm() {
  document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("saveProfileBtn");
    setLoading(btn, true, "Menyimpan…");
    try {
      const { user } = await callApi("updateProfile", {
        fullName: document.getElementById("fullName").value.trim(),
        preferredLanguage: document.getElementById("preferredLanguage").value,
        writingStyle: document.getElementById("writingStyle").value,
      });
      const current = getSession();
      setSession({ token: current.token, user });
      showToast("Profil berhasil diperbarui.", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Gagal menyimpan profil.", "error");
    } finally {
      setLoading(btn, false);
    }
  });
}

function bindLogout() {
  document.getElementById("logoutBtn").addEventListener("click", () => {
    if (confirm("Keluar dari Macca.Ai?")) logout("login.html");
  });
}
