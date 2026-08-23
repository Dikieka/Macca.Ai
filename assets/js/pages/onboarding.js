// assets/js/pages/onboarding.js
// Layar intro "Kenalan dengan Macca" — dipicu SEKALI, tepat setelah register atau
// login Google/email pertama kali (lihat login.html & register.html: goToChat()
// mengecek session.user.needsOnboarding sebelum redirect ke chat.html vs sini).
// Guard di bawah (bukan requireAuth biasa) supaya:
//  1) User tanpa sesi tetap dilempar ke login.html (sama seperti halaman protected lain).
//  2) User yang SUDAH pernah onboarding tapi buka /onboarding.html manual (mis. lewat
//     back button) langsung dipentalkan ke chat.html, bukan disuruh ulang dari awal.
import { getSession, setSession, requireAuth } from "../lib/auth.js";
import { callApi, ApiError } from "../lib/api.js";
import { showToast } from "../lib/state.js";

// PENTING: state harus dideklarasikan SEBELUM blok di bawah yang memanggil init()
// langsung di top-level module. init() -> renderStep() membaca currentStep segera;
// kalau urutan dibalik (state di bawah pemanggilan init()), currentStep masih ada
// di temporal dead zone saat dipakai -> ReferenceError "Cannot access before
// initialization", walau kodenya sekilas terlihat benar karena "let" ada di file
// yang sama.
const TOTAL_STEPS = 4;
let currentStep = 1;
const answers = { writingStyle: "", focus: [], goal: "" };

const session = requireAuth();
if (session) {
  if (session.user?.needsOnboarding === false) {
    window.location.href = "chat.html";
  } else {
    init();
  }
}

function init() {
  // PENTING (sama seperti bug #1 "logout tidak bisa diklik" di chat.js): jangan
  // panggil lucide.createIcons() tanpa guard di sini. Kalau CDN lucide gagal
  // dimuat (mis. tidak ada internet saat dev di localhost, ad-blocker, CDN
  // lambat), pemanggilan langsung akan lempar ReferenceError dan menghentikan
  // SISA init() ini seketika -> semua addEventListener tombol di bawah (termasuk
  // nextBtn "Lanjut") tidak pernah sempat terpasang, padahal halaman tetap
  // tampil normal. Bungkus dengan guard supaya kegagalan ikon tidak pernah
  // ikut merusak fungsi tombol.
  if (window.lucide) lucide.createIcons();

  const heading = document.getElementById("welcomeHeading");
  const firstName = (session.user?.fullName || "").trim().split(" ")[0];
  heading.textContent = firstName ? `Halo, ${firstName}!` : "Halo!";

  bindChips("obWritingStyleChips", (value, chip, group) => {
    group.querySelectorAll(".style-chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    answers.writingStyle = value;
  });

  bindChips("obFocusChips", (value, chip) => {
    chip.classList.toggle("is-active");
    if (answers.focus.includes(value)) {
      answers.focus = answers.focus.filter((v) => v !== value);
    } else {
      answers.focus.push(value);
    }
  });

  document.getElementById("obGoal").addEventListener("input", (e) => {
    answers.goal = e.target.value;
  });

  document.getElementById("nextBtn").addEventListener("click", onNext);
  document.getElementById("backBtn").addEventListener("click", onBack);
  document.getElementById("skipBtn").addEventListener("click", () => finish({ skipped: true }));

  renderStep();
}

function bindChips(containerId, onToggle) {
  const group = document.getElementById(containerId);
  group.querySelectorAll(".style-chip").forEach((chip) => {
    chip.addEventListener("click", () => onToggle(chip.dataset.value, chip, group));
  });
}

function renderStep() {
  document.querySelectorAll(".ob-step").forEach((el) => {
    el.classList.toggle("hidden", Number(el.dataset.step) !== currentStep);
  });
  document.querySelectorAll("#progressDots .progress-dot").forEach((dot, i) => {
    dot.classList.toggle("is-done", i < currentStep);
  });
  document.getElementById("stepLabel").textContent = String(currentStep);
  document.getElementById("backBtn").classList.toggle("invisible", currentStep === 1);

  const nextBtn = document.getElementById("nextBtn");
  nextBtn.textContent = currentStep === TOTAL_STEPS ? "Mulai ngobrol" : "Lanjut";
}

function onNext() {
  if (currentStep < TOTAL_STEPS) {
    currentStep += 1;
    renderStep();
  } else {
    finish({ skipped: false });
  }
}

function onBack() {
  if (currentStep > 1) {
    currentStep -= 1;
    renderStep();
  }
}

async function finish({ skipped }) {
  const nextBtn = document.getElementById("nextBtn");
  const skipBtn = document.getElementById("skipBtn");
  nextBtn.disabled = true;
  skipBtn.disabled = true;
  const originalLabel = nextBtn.textContent;
  nextBtn.textContent = "Menyimpan…";

  try {
    const data = await callApi("completeOnboarding", skipped ? {} : {
      writingStyle: answers.writingStyle,
      focus: answers.focus.join(", "),
      goal: answers.goal.trim(),
    });
    // Perbarui sesi lokal supaya needsOnboarding jadi false — kalau tidak, guard di
    // atas akan mengarahkan balik ke sini setiap kali user membuka halaman ini lagi.
    setSession({ token: session.token, user: data.user });
    window.location.href = "chat.html";
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : "Gagal menyimpan, coba lagi.", "error");
    nextBtn.disabled = false;
    skipBtn.disabled = false;
    nextBtn.textContent = originalLabel;
  }
}