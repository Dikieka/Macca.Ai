# Macca.Ai — Static Frontend Edition

## Optimasi Token (ringkas)

Beberapa lapisan hemat-token yang sudah aktif di `router.gs`, tanpa mengorbankan
kecepatan/kualitas jawaban:

1. **Cache respons AI** (`CacheService`, TTL 3 jam) — permintaan yang isi prompt-nya
   identik persis (model + system prompt + histori + pesan) langsung dikembalikan dari
   cache tanpa memanggil provider AI lagi. Berguna untuk klik ganda, tombol
   "Regenerate" tanpa ganti apa pun, atau pertanyaan generik yang berulang. Cache-nya
   otomatis "batal" begitu ada perubahan sekecil apa pun di konteks (dokumen baru,
   memory baru, pesan beda) karena kunci cache-nya dihitung dari SELURUH isi prompt.
2. **Pemangkasan potongan dokumen/RAG** — tiap potongan (chunk) dokumen atau memory yang
   disisipkan ke prompt dibatasi ±1400 karakter (`truncateChunk_`), supaya dokumen yang
   sangat panjang tidak membuat prompt membengkak tak terkendali; bagian yang paling
   relevan (skor similarity/urutan chunk) tetap yang diprioritaskan masuk.
3. **Riwayat percakapan dibatasi** — hanya 12 pesan terakhir per chat yang disertakan
   sebagai konteks (`findRows("messages", ..., 12)` di `chat.gs`), bukan seluruh riwayat.
4. **RAG hanya ambil yang relevan** — `searchDocumentChunks` sudah membuang hasil dengan
   skor kemiripan < 0.15, jadi dokumen yang tidak nyambung tidak ikut membebani prompt.

Ide lanjutan yang belum diimplementasikan (opsional untuk iterasi berikutnya):
ringkasan otomatis (rolling summary) untuk chat yang sangat panjang, dan semantic cache
berbasis embedding (bukan cuma exact-match) supaya pertanyaan yang MIRIP — bukan cuma
identik — juga bisa kena cache.


AI Document Workspace: HTML/CSS/JS murni (tanpa framework) di GitHub Pages,
dengan Google Apps Script sebagai backend dan Google Sheets sebagai database.

## Struktur Folder

```
macca-ai/
├── index.html                  # Landing page
├── pages/
│   ├── login.html
│   ├── register.html
│   ├── forgot-password.html
│   ├── chat.html
│   ├── projects.html
│   ├── project.html            # detail 1 proyek: chat/dokumen/toggle privasi
│   ├── documents.html
│   ├── memory.html
│   ├── settings.html
│   └── admin.html              # panel admin: user & model AI (khusus role admin)
├── assets/
│   ├── css/style.css           # Design tokens & style bersama
│   ├── js/lib/
│   │   ├── config.js           # URL Apps Script, Google Client ID
│   │   ├── api.js              # fetch() tunggal ke Apps Script
│   │   ├── auth.js             # session token, guard halaman (requireAuth/requireAdmin)
│   │   ├── state.js            # store + toast + loading state
│   │   ├── render.js           # helper DOM (escape, waktu relatif, nav admin, dst)
│   │   └── upload.js           # ekstraksi teks (pdf.js/mammoth/SheetJS) + kompres foto ke WebP
│   └── js/pages/
│       ├── chat.js             # riwayat, upload, RAG, pemilihan model
│       ├── projects.js
│       ├── project.js          # halaman detail proyek
│       ├── documents.js
│       ├── memory.js
│       ├── settings.js
│       └── admin.js            # panel admin
└── apps-script/
    ├── Code.gs                 # doGet/doPost + routing action
    ├── appsscript.json         # manifest & scopes
    └── handlers/
        ├── sheetsDb.gs         # CRUD generik ke Google Sheets
        ├── auth.gs             # register/login/googleLogin/session/requireAdmin_
        ├── chat.gs             # kirim pesan + RAG + memory context, riwayat chat
        ├── router.gs           # AI model router + retry/fallback + panggil OpenRouter
        ├── documents.gs        # upload dokumen ke Cloudinary + kuota + chunking
        ├── rag.gs              # embedding + cosine similarity manual
        ├── memory.gs           # personal & project memory
        ├── projects.gs         # workspace project + detail + privasi
        ├── admin.gs            # kelola user (role/suspend) & model_registry
        └── setup.gs            # bikin skema Sheets otomatis + migrateSchema()
```

## Daftar Action Apps Script

| Action | Fungsi |
|---|---|
| `register`, `login`, `googleLogin`, `logout` | Autentikasi |
| `requestPasswordReset`, `resetPassword` | Lupa kata sandi |
| `updateProfile` | Ubah nama, bahasa, gaya penulisan |
| `sendChatMessage`, `getChatHistory`, `renameChat`, `deleteChat` | Chat (otomatis pakai konteks dokumen + memory relevan) |
| `uploadDocument`, `processDocument`, `getDocuments`, `deleteDocument`, `searchDocuments`, `getStorageUsage` | Dokumen, RAG & kuota penyimpanan (Cloudinary) |
| `getMemory`, `saveMemory`, `deleteMemory` | Personal/project memory |
| `getProjects`, `createProject`, `getProjectDetail`, `updateProject` | Workspace project + privasi per-proyek |
| `getUsage`, `routeModel`, `listModels` | Token tracking & AI router |
| `paraphrase` | Tulis ulang teks (fitur "Parafrase" di sidebar) |
| `adminListUsers`, `adminUpdateUserRole`, `adminUpdateUserStatus`, `adminListModels`, `adminUpsertModel`, `adminToggleModel`, `adminDeleteModel`, `adminStats` | Panel admin (khusus role `admin`) |

## 1. Setup Google Sheets + Apps Script (backend)

1. Buat **Google Spreadsheet** baru, salin **Spreadsheet ID** dari URL-nya
   (bagian antara `/d/` dan `/edit`).
2. Buka [script.google.com](https://script.google.com) → **New project**.
3. Salin semua isi `apps-script/*.gs` ke project itu (satu file .gs per handler),
   dan isi `appsscript.json` lewat **Project Settings → Show "appsscript.json"**.
4. **Project Settings → Script Properties**, tambahkan (lihat detail tiap provider
   di bagian 2 & 3 di bawah untuk cara mendapatkan nilainya):
   | Key | Value |
   |---|---|
   | `SPREADSHEET_ID` | ID spreadsheet dari langkah 1 |
   | `PASSWORD_SALT` | string acak bebas, contoh: `ubah-string-ini` |
   | `OPENROUTER_API_KEY` | API key dari [openrouter.ai](https://openrouter.ai) (boleh diisi belakangan — tanpa ini, chat tetap jalan dalam mode demo) |
   | `APP_URL` | (opsional) URL frontend kamu, dikirim sebagai header `HTTP-Referer` ke OpenRouter |
   | `CLOUDINARY_CLOUD_NAME` | Cloud name dari dashboard Cloudinary |
   | `CLOUDINARY_API_KEY` | API key Cloudinary |
   | `CLOUDINARY_API_SECRET` | API secret Cloudinary — **jangan pernah** taruh ini di kode frontend |
5. Di editor, pilih fungsi **`setupSpreadsheet`** lalu klik **Run**. Ini otomatis
   membuat semua tab (`users`, `sessions`, `chats`, `messages`, `documents`,
   `document_chunks`, `memories`, `projects`, `activities`, `notes`, `usage`,
   `ai_requests`, `model_registry`) lengkap dengan header kolom, plus mengisi
   `model_registry` dengan model default gratis.
   - **Kalau spreadsheet kamu sudah pernah dipakai SEBELUM update ini** (sudah
     ada isi datanya), kolom baru (`role`, `status` di `users`; `is_private` di
     `projects`; `is_compressed`/`original_size` di `documents`) akan otomatis
     ditambahkan sebagai header kosong oleh `setupSpreadsheet`, tapi baris-baris
     LAMA di kolom itu akan kosong. Jalankan **`migrateSchema`** sekali (Run
     dari editor) untuk mengisi nilai default yang aman ke baris-baris lama.
6. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Salin **Web app URL** yang dihasilkan.
7. **Jadikan dirimu admin**: register akun pertama lewat UI seperti biasa
   (akun *pertama* yang register di spreadsheet kosong otomatis jadi admin).
   Kalau kamu sudah punya user sebelumnya dan ingin menjadikannya admin,
   jalankan fungsi **`promoteToAdmin_("emailkamu@contoh.com")`** sekali dari
   editor Apps Script (isi argumennya dulu di baris pemanggilan, atau jalankan
   lewat "Run function" dengan parameter). Setelah jadi admin, kamu akan
   melihat link **Admin** muncul otomatis di sidebar (`admin.html`) untuk
   kelola user lain & model AI yang tersedia.

## 2. Setup OpenRouter (model AI chat)

OpenRouter adalah gateway yang menyediakan akses ke banyak model (GPT, Claude,
Llama, Gemini, dll) lewat satu API key. `router.gs` memanggilnya dari server
(Apps Script), **bukan** dari browser, supaya API key tidak pernah terekspos.

1. Daftar/masuk ke [openrouter.ai](https://openrouter.ai).
2. Buka **Settings → Keys → Create Key**, beri nama misalnya `macca-ai-prod`,
   salin key-nya (formatnya `sk-or-v1-...`).
3. (Opsional tapi disarankan) Isi saldo/credit di **Settings → Credits** kalau
   mau memakai model berbayar. Untuk mulai gratis, pakai model dengan akhiran
   `:free` seperti yang sudah diisi otomatis di tab `model_registry`
   (`gpt-oss-120b:free`).
4. Tempel key itu ke Script Properties sebagai `OPENROUTER_API_KEY` (langkah 1.4).
5. Cek daftar model yang tersedia di [openrouter.ai/models](https://openrouter.ai/models),
   lalu edit tab `model_registry` di spreadsheet kamu untuk menambah/mengganti
   `model_slug` sesuai kebutuhan (kolom `capabilities` menentukan kapan model
   itu dipakai: `fast`, `smart`, atau `deep` — lihat `routeModel()` di `router.gs`).
6. **Tes cepat**: kirim pesan apa saja di halaman Chat. Kalau balasan berupa
   `[Demo] OPENROUTER_API_KEY belum diset...`, berarti Script Property belum
   tersimpan dengan benar atau deployment web app belum di-redeploy setelah
   diisi (Apps Script kadang perlu **Deploy → Manage deployments → Edit → Deploy
   ulang** agar Script Properties baru terbaca oleh deployment yang aktif).

## 3. Setup Google OAuth (Sign in with Google)

Login Google di `login.html`/`register.html` sudah memakai library resmi
**Google Identity Services** (`accounts.google.com/gsi/client`) yang mengirim
`idToken`, lalu diverifikasi di server (`handleGoogleLogin` di `auth.gs`) lewat
endpoint publik Google `oauth2.googleapis.com/tokeninfo` — tidak butuh client
secret sama sekali di sisi manapun.

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat
   **project baru** (atau pakai yang sudah ada).
2. **APIs & Services → OAuth consent screen**:
   - User Type: **External** (kecuali kamu pakai Google Workspace internal).
   - Isi nama app (`Macca.Ai`), email support, dan logo (opsional).
   - Scopes: biarkan default (`email`, `profile`, `openid`) — tidak perlu tambah scope lain.
   - Test users: tambahkan email kamu sendiri dulu selama app masih status **Testing**
     (kalau tidak, hanya email yang didaftarkan di sini yang bisa login sampai
     app di-**Publish**).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: tambahkan SEMUA origin tempat frontend
     kamu diakses, misalnya:
     - `https://<username>.github.io` (kalau deploy ke GitHub Pages)
     - `http://localhost:5500` (kalau dites lokal pakai Live Server — sesuaikan port)
   - **Authorized redirect URIs**: boleh dikosongkan (Google Identity Services
     versi popup/One Tap yang dipakai di sini tidak butuh redirect URI).
   - Klik **Create**, salin **Client ID** (formatnya `xxxxx.apps.googleusercontent.com`).
     **Client Secret tidak dipakai** dan tidak perlu disimpan di mana pun.
4. Tempel Client ID itu ke `assets/js/lib/config.js` (`CONFIG.GOOGLE_CLIENT_ID`) —
   lihat bagian 4 di bawah.
5. **Penting**: setiap kali kamu menambah domain baru tempat frontend di-hosting
   (misalnya custom domain), balik lagi ke **Authorized JavaScript origins** dan
   tambahkan domain itu, atau tombol Google Sign-In akan gagal dengan error
   `origin_mismatch` di console browser.
6. Kalau app masih **Testing** dan ingin dipakai user umum (bukan cuma test
   users yang didaftarkan), buka **OAuth consent screen → Publish App**. Google
   mungkin meminta verifikasi tambahan kalau scope yang dipakai sensitif — untuk
   scope `email`/`profile`/`openid` biasanya tidak perlu verifikasi manual.

## 4. Setup Cloudinary (penyimpanan dokumen & foto)

Dokumen dan foto yang diunggah user disimpan di [Cloudinary](https://cloudinary.com)
(bukan lagi Google Drive), diupload dari server (`documents.gs`) lewat **signed
upload** — jadi API secret Cloudinary tidak pernah terekspos ke browser. Setiap
user dibatasi kuota **100MB** (dihitung dari total `file_size` dokumen miliknya);
saat mendekati 90% terpakai, UI menampilkan peringatan agar user menghapus
dokumen yang tidak dipakai, dan upload baru akan ditolak kalau kuota terlampaui.

1. Daftar akun gratis di [cloudinary.com](https://cloudinary.com/users/register/free)
   (paket gratis sudah cukup untuk 25GB storage & bandwidth bulanan).
2. Di **Dashboard**, salin tiga nilai ini:
   - **Cloud name**
   - **API Key**
   - **API Secret** (klik ikon mata untuk menampilkan)
3. Tempel ketiganya ke Script Properties sebagai `CLOUDINARY_CLOUD_NAME`,
   `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (langkah 1.4).
4. Tidak ada setting tambahan di sisi Cloudinary yang wajib (upload preset dsb
   tidak dipakai karena kita pakai signed upload langsung dari Apps Script).
   Opsional: di **Settings → Upload**, kamu bisa mengaktifkan **Auto-backup**
   atau **Eager transformations** kalau mau optimasi tambahan.
5. Semua file akan masuk ke folder `macca-ai/documents/` di Media Library
   Cloudinary kamu, jadi mudah dipantau/di-audit manual kalau perlu.
6. Kalau ingin mengganti batas kuota dari 100MB, ubah konstanta
   `STORAGE_QUOTA_BYTES` di `apps-script/handlers/documents.gs`.

## 5. Hubungkan frontend ke backend

Edit `assets/js/lib/config.js`:

```js
export const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXX/exec", // dari langkah 1.6
  GOOGLE_CLIENT_ID: "xxxxx.apps.googleusercontent.com",              // dari langkah 3.3
  ...
};
```

Cloudinary dan OpenRouter **tidak** butuh konfigurasi apa pun di file ini —
keduanya hanya dipanggil dari server (Apps Script) lewat Script Properties.

## 6. Jalankan lokal

Tidak perlu build step. Buka `index.html` langsung di browser, atau pakai
ekstensi **Live Server** (VSCode) agar path relatif & ES module bekerja normal.
Ingat tambahkan origin lokal kamu (mis. `http://localhost:5500`) ke Authorized
JavaScript origins di langkah 3.3 supaya Google Sign-In berfungsi saat dites lokal.

## 7. Deploy ke GitHub Pages

1. Push folder ini ke repository GitHub.
2. **Settings → Pages → Deploy from branch**, pilih `main` (folder root atau `/docs`).
3. Selesai — landing page akan tampil di `https://<username>.github.io/<repo>/`.
4. Jangan lupa tambahkan URL GitHub Pages itu ke Authorized JavaScript origins
   (langkah 3.3) — tanpa ini tombol Google Sign-In akan gagal di production.

## Model AI 100% Gratis (perbaikan: hindari `openrouter/auto`)

Sebelumnya default `m-fast` di `model_registry` memakai slug `openrouter/auto`. Ini
**bukan model gratis beneran** — itu meta-router milik OpenRouter yang boleh mengarahkan
requestmu ke model BERBAYAR kapan saja demi kualitas, dan kamu tetap kena tagihan sesuai
harga model yang dipilihnya (lihat dokumentasi resmi OpenRouter soal Auto Router). Kolom
`cost_input`/`cost_output` di tab `ai_requests` juga tidak pernah mencatat biaya ini, jadi
biaya bisa lolos tanpa disadari kalau akun OpenRouter kamu punya saldo.

Sudah diperbaiki:

- **`m-fast` sekarang pakai model `:free` eksplisit** (`meta-llama/llama-3.2-3b-instruct:free`),
  bukan `openrouter/auto` — biayanya dijamin Rp0 selama slug itu masih aktif di OpenRouter.
- **`routeModel()` (`router.gs`) diperkuat**: kalau tidak ada model enabled yang
  capabilities-nya cocok dengan route (`fast`/`smart`/`deep`) — misalnya karena kamu
  men-disable sebuah model lewat Admin panel — sekarang dicatat ke `console.error` (kelihatan
  di log Apps Script) dan otomatis mencoba model gratis paling mumpuni yang masih tersedia,
  bukan asal ambil baris pertama di sheet. Fallback darurat terakhir (kalau registry benar-benar
  kosong) juga diganti ke model `:free` eksplisit, bukan `openrouter/auto` lagi.
- Kalau spreadsheet kamu sudah pernah dipakai SEBELUM perbaikan ini, jalankan fungsi
  **`migrateAwayFromAutoRouter`** sekali dari editor Apps Script — otomatis mengganti baris
  `model_slug = "openrouter/auto"` yang lama ke model `:free` eksplisit tanpa menyentuh
  baris lain.
- **Cek tab `ai_requests` / halaman Admin secara berkala**: kalau kolom `model` untuk
  banyak baris konsisten sama padahal kolom `route`-nya campur (`fast`/`smart`/`deep`),
  itu tanda `routeModel()` gagal mencocokkan capability — biasanya karena model yang
  seharusnya menangani route tertentu (`m-smart`/`m-deep-fallback`) ter-disable. Aktifkan
  lagi lewat **Admin > Model AI**.

## Sumber Akademik Terverifikasi & Ensemble Model Gratis (anti-halusinasi sitasi)

Supaya Macca tidak "mengarang" judul jurnal/nama penulis/DOI saat membantu tugas
akademik (skripsi, landasan teori, metodologi), ditambahkan lapisan baru:

- **`apps-script/handlers/academicSearch.gs`** — mencari sumber akademik NYATA lewat
  **OpenAlex** (utama) dan **Semantic Scholar** (fallback), keduanya gratis & tanpa API
  key. Google Scholar sengaja TIDAK dipakai karena tidak punya API resmi dan scraping-nya
  melanggar ToS Google.
- Pencarian ini otomatis jalan kalau pesan chat terdeteksi sebagai pertanyaan akademik
  (`classifyTask_` di `chat.gs` — kata kunci "skripsi", "jurnal", "metodologi", "landasan
  teori"). Hasilnya disisipkan ke system prompt (`router.gs`) dengan instruksi TEGAS: AI
  hanya boleh mengutip sumber yang benar-benar ada di daftar itu, dan wajib jujur bilang
  "tidak ditemukan" kalau memang tidak ada sumber relevan — dilarang keras mengarang.
- **Ensemble/combine model gratis** (`generateAcademicEnsembleReply_` di `router.gs`):
  khusus pertanyaan akademik, beberapa model GRATIS (ditandai `academic` di kolom
  `capabilities` tab `model_registry`) dipanggil SEKALIGUS (paralel lewat
  `UrlFetchApp.fetchAll`), lalu satu model gratis lagi menggabungkan draf-drafnya jadi
  satu jawaban akhir yang saling menambal kekurangan tiap model kecil — sambil tetap
  membuang sitasi apapun yang tidak ada di daftar sumber terverifikasi. Kalau ensemble
  gagal total, otomatis fallback ke alur single-model biasa (tidak ada yang rusak untuk
  pertanyaan non-akademik).
- Kalau spreadsheet kamu sudah pernah dipakai SEBELUM fitur ini ditambahkan, jalankan
  fungsi **`migrateAcademicEnsemble`** sekali dari editor Apps Script untuk menandai
  model existing dengan capability `academic` dan menambah satu model gratis ketiga.
- Daftar model gratis di OpenRouter **berotasi cukup sering** (model bisa ditarik/ganti
  slug kapan saja) — kalau salah satu model ensemble sering gagal (cek tab `ai_requests`
  atau halaman Admin), ganti `model_slug`-nya lewat **Admin > Model AI**, tanpa perlu
  ubah kode. Cek daftar terkini di [openrouter.ai/models](https://openrouter.ai/models).
- (Opsional) isi `ACADEMIC_CONTACT_EMAIL` di Script Properties dengan email kamu supaya
  request ke OpenAlex masuk "polite pool" (rate limit lebih tinggi & stabil).
- Balasan chat sekarang juga mengembalikan `usedAcademicSources` (daftar sumber yang
  benar-benar dipakai), ditampilkan di UI chat sebagai kotak "Referensi" dengan link
  DOI yang bisa diklik, supaya user bisa memverifikasi sendiri — bukan cuma percaya
  teks AI begitu saja.

## Backup / Ekspor data ke Excel

Jalankan fungsi `exportAllTablesToNewSpreadsheet()` di editor Apps Script
untuk menyalin seluruh tabel ke Google Spreadsheet baru. File itu bisa
langsung **File → Download → Microsoft Excel (.xlsx)** dari Google Sheets.

## Catatan Keamanan

- API key OpenRouter dan API secret Cloudinary **hanya** ada di Script Properties,
  tidak pernah dikirim ke browser. Upload ke Cloudinary memakai signed request
  (signature dihitung di server) sehingga tidak butuh "unsigned upload preset"
  yang bisa disalahgunakan pihak luar.
- Google OAuth tidak butuh client secret sama sekali — verifikasi `idToken`
  dilakukan lewat endpoint publik `oauth2.googleapis.com/tokeninfo`.
- Setiap handler yang butuh data user memvalidasi `token` sesi lebih dulu
  lewat `validateSession()`, lalu memfilter baris berdasarkan `user_id`
  (pengganti manual untuk Row Level Security yang tidak tersedia di Sheets).
  Ini juga berlaku untuk kuota penyimpanan: kuota selalu dihitung ulang dari
  baris `documents` milik user yang sedang login, bukan dari nilai yang
  dikirim client.

## Kuota Penyimpanan (Cloudinary)

- Default **100MB per user**, dihitung dari total `file_size` semua dokumen
  yang masih ada di tab `documents` (dokumen yang dihapus otomatis mengurangi
  pemakaian karena barisnya ikut terhapus).
- Saat pemakaian ≥ 90%, endpoint `getDocuments`/`uploadDocument`/`deleteDocument`
  mengembalikan `storage.isWarning: true` dan UI Documents menampilkan progress
  bar berwarna + pesan peringatan untuk menghapus dokumen yang tidak dipakai.
- Saat pemakaian akan melebihi 100%, `uploadDocument` ditolak dengan error
  `STORAGE_FULL` sebelum file sempat diupload ke Cloudinary.
- User menghapus dokumen lewat tombol tong sampah di halaman **Documents**;
  ini akan memanggil `deleteDocument` yang menghapus file di Cloudinary DAN
  baris terkait di `documents` + `document_chunks`.

## Ekstraksi Teks, RAG, dan Kompresi Upload

- **Kenapa dokumen sebelumnya "tidak dikenali AI" walau sudah di Cloudinary**:
  frontend lama tidak pernah mengirim `extractedText` saat upload, jadi
  `chunkAndStoreDocument_()` tidak pernah jalan (tidak ada embedding), DAN
  `sendChatMessage` tidak pernah memanggil pencarian dokumen sama sekali.
  Sekarang: `assets/js/lib/upload.js` mengekstrak teks PDF (pdf.js), DOCX
  (mammoth.js), XLSX (SheetJS), TXT/CSV/MD (native) di browser sebelum upload,
  dan `chat.gs` memanggil `searchDocumentChunks()` + menyisipkan potongan
  relevan ke system prompt setiap kali user chat. Gambar (foto) tidak
  diekstrak sebagai teks (bukan bug — memang belum ada OCR/vision di sini).
- **Kompresi upload**: foto otomatis di-resize + dikonversi ke **WebP**
  (kualitas ~0.82, maks sisi terpanjang 1920px) di browser sebelum diunggah.
  Untuk dokumen (PDF/DOCX/XLSX) **file aslinya sengaja tidak dikompres ulang**:
  format itu sudah berupa container terkompresi (DOCX/XLSX = ZIP) dan
  merekompresi PDF tanpa merusak isi butuh library rasterisasi yang berat &
  berisiko. Fokusnya dialihkan ke ekstraksi teks (bikin AI bisa "membaca"
  isinya), bukan mengecilkan ukuran file yang tersimpan.
- **Privasi per-proyek** (`pages/project.html`): tiap chat yang dibuka dari
  konteks proyek (`chat.html?projectId=...`) otomatis membatasi pencarian
  dokumen & memory HANYA ke proyek itu — tidak pernah "bocor" ke proyek lain
  atau chat umum. Toggle "Mode Privasi Proyek" di halaman detail proyek
  menyimpan preferensi ini (`is_private` di tab `projects`).
- **Reliabilitas model AI**: `generateAiReply_()` di `router.gs` sekarang
  mencoba satu model cadangan otomatis kalau model utama gagal/timeout, dan
  `max_tokens` dinaikkan ke 2048 supaya jawaban panjang (mis. kerangka BAB
  skripsi) tidak gagal di tengah jalan. User juga bisa memilih model manual
  lewat dropdown di composer chat (disimpan di `localStorage`, tidak wajib).
  Semua percobaan (berhasil/gagal) dicatat ke tab `ai_requests` supaya admin
  bisa mendiagnosis lewat halaman Admin kalau ada model yang sering error.
