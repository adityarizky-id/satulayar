# Satulayar

**Satu layar untuk semua kanal iklan.** Satulayar adalah dashboard performa marketing yang menyatukan Google Ads, Meta Ads, dan data toko online dalam satu tampilan per brand. Tujuannya satu: pemilik brand dan tim marketing bisa menjawab "uang iklan kita bekerja atau tidak?" tanpa membuka lima tab dan menyalin angka ke spreadsheet.

> [!important] Status saat ini: data demo
> Semua angka di aplikasi ini **sintetis**. Kelima brand (Kopi Senja Nusantara, Batik Lestari, Rumah Rajut, Jamu Alami, Kriya Bali) adalah **brand fiktif**. Konektor live (Google Ads, Meta Ads, GA4) sudah ada di kode, tetapi **mode live dikunci (fail-closed)** sampai kredensial dan uji parity disetujui. Setiap panel menandai data demo sebagai *Preview data*.

## Masalah yang dipecahkan

- **Data iklan tersebar.** Google Ads, Meta Ads, dan toko online masing-masing punya dashboard, definisi metrik, dan zona waktunya sendiri.
- **Angka platform tidak sama dengan uang masuk.** Platform iklan cenderung mengklaim konversi yang sama dua kali. Satulayar membandingkan klaim platform dengan penjualan riil toko (Blended MER).
- **Anggaran bocor diam-diam.** Search term tidak relevan, iklan yang sudah jenuh (creative fatigue), dan wilayah yang mahal baru ketahuan di akhir bulan.
- **Laporan manual makan waktu.** Satulayar menyimpan snapshot harian, menghitung KPI secara deterministik, dan menyiapkan ringkasan eksekutif yang bisa diaudit.

## Fitur utama

| Area | Isi |
|---|---|
| **Paid ads** | Snapshot akun, budget pacing, performa per platform, tren delivery, metrik customer journey, Blended MER vs toko, audiens, creative fatigue, jenis campaign, search terms, intent tiers, wasted spend, impression share, geografi (peta provinsi Indonesia, Malaysia, dan Singapura), perangkat |
| **Store analytics** | Performa tahunan, analisis RFM, cohort, scorecard toko, penjualan, traffic & konversi, katalog, audiens, dan referrer |
| **Worklog** | Catatan kronologis tindakan optimasi (perubahan budget, negative keyword) beserta alasannya |
| **Data sources** | Status konektor, kesehatan data, dan pengaturan kredensial per brand |
| **Form koneksi mandiri** | Google Ads, Meta Ads dan GA4 dapat diisi dari Data sources; server memverifikasi akses sebelum menyimpan, dan sync membaca konfigurasi tersimpan per brand |
| **Akses** | Login Supabase, tiga peran (`admin`, `internal_editor`, `viewer`), dan isolasi data per brand lewat Row Level Security |

Roadmap (sudah tampil sebagai *coming soon*): SEO, social media, CRM, TikTok Ads, Microsoft Ads, Shopify, dan WooCommerce.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Supabase** (Postgres, Auth, RLS) untuk persistence dan login
- **Vercel** untuk hosting dan cron sinkronisasi harian
- Konektor read-only: Google Ads API, Meta Marketing API, dan GA4 Data API
- Test: `node:test` via `tsx` (700+ unit test)

## Menjalankan secara lokal

Butuh Node.js 22+ dan pnpm 11.

```bash
pnpm install
cp .env.example .env.local   # biarkan default: mode mock + fixture
pnpm dev                     # http://localhost:3000
```

Tanpa Supabase, aplikasi memakai **preview identity** lokal (non-production), sehingga semua halaman bisa dibuka dengan data demo. Ganti peran preview lewat `DASHBOARD_PREVIEW_ROLE=viewer|internal_editor|admin`.

Verifikasi lengkap sebelum push:

```bash
pnpm verify   # lint + typecheck + test + build
```

## Mode data

| Variabel | Nilai | Arti |
|---|---|---|
| `DASHBOARD_DATA_MODE` | `mock` (default) / `live` | `live` sengaja menolak jalan sampai konektor disetujui |
| `DASHBOARD_DATA_STORE` | `fixture` (default) / `supabase` | Fixture di memori, atau snapshot tersimpan di Supabase |
| `DASHBOARD_AUTH_MODE` | `preview` (lokal) / `supabase` | Production selalu memakai Supabase dan fail-closed tanpa konfigurasi |

Detail kontrak data dan batas konektor ada di [docs/data-and-connectors.md](docs/data-and-connectors.md).

## Akses tim (view-only)

Akun dibuat oleh admin, bukan lewat pendaftaran mandiri. Login tidak pernah membuat atau memperbaiki user secara otomatis. Setelah project Supabase aktif dan migrasi dijalankan:

```bash
pnpm tsx scripts/admin/create-viewer.ts --email nama@contoh.com
```

Skrip membuat user dengan password acak, memberi peran `viewer` di kelima brand demo, lalu mencetak password **satu kali** ke terminal. Kirim password lewat kanal privat, jangan lewat commit, issue, atau grup chat terbuka.

## Struktur

```
src/app/            halaman dan API route (Next.js App Router)
src/components/     komponen UI (charts, dashboard, geo, store, ...)
src/lib/            logika inti: KPI, data quality, konektor, auth, store analytics
supabase/           migrasi skema, RLS, dan seed brand demo
scripts/            backfill ingestion, generator peta, dan skrip admin
tests/              unit test
docs/               design system dan kontrak data
```

## Aturan kontribusi

- Baca [AGENTS.md](AGENTS.md) sebelum mengubah UI, chart, atau copy. Untuk pekerjaan visual, baca juga [docs/design-system.md](docs/design-system.md).
- Jangan commit kredensial, token, ID akun iklan asli, atau data pelanggan. Fixture harus tetap sintetis.
- Data demo tidak boleh ditampilkan sebagai data asli.
- Jalankan `pnpm verify` sebelum membuka pull request.

## Review kenyamanan UI — 15 Oktober 2026

Audit mencakup Paid ads, Store analytics, Worklog, Data sources, Account dan
Sign-in. Masalah utama: kontrol utility saling bersaing, ukuran teks kontrol
terlalu kecil, efek hover pada banyak kartu data, dan tindakan pemulihan connector
yang tidak sesuai dengan penyebab kegagalannya.

| Area | Perbaikan |
|---|---|
| Shared utility dan periode | Reflow menurut lebar workspace; tinggi sticky diukur; teks kontrol diperbesar; judul dan periode mobile membungkus tanpa klip. |
| Paid ads | Tombol Reload Demo dihapus; pengaturan target menjadi disclosure; threshold tetap terbaca di snapshot. |
| Store analytics | Struktur utility disamakan; refresh demo yang tidak berguna dihilangkan; judul sparkline diperbaiki agar menjadi satu string React. RFM, cohort, catalogue dan perhitungan tidak diubah. |
| Worklog | Judul operasional ringkas; aksi Review in form tidak lagi menjadi tombol primer pada setiap baris. |
| Data sources | Checklist konfigurasi per connector dengan akses baca untuk viewer; status sukses memerlukan credential aktif yang dikonfirmasi server. |
| Account | Shortcut section diberi jarak, batas, dan target interaksi yang jelas. |
| Sign-in | Headline statis, tanpa siklus mengetik/menghapus saat pengguna membaca form. |

Konektor tetap memerlukan konfigurasi dan pengujian akses nyata sebelum data live
tersedia. Perubahan UI tidak mengaktifkan atau mengonfigurasi API secara otomatis.

Verifikasi lokal: `pnpm verify` lulus (lint, TypeScript, 719 tes, build produksi).
Keenam route diperiksa pada viewport CSS 1440, 1024, 760 dan 390px dalam kedua
tema; tidak ditemukan overflow utility atau scroll horizontal halaman. Dialog
Meta diuji pada ponsel, Escape mengembalikan fokus ke pemicu, dan URL sukses
tanpa credential aktif menghasilkan peringatan. Filter Google/Meta dan disclosure
target juga diperiksa. Uji API dengan credential nyata belum dilakukan.
Tidak ada script UI detector tersendiri dalam repo; pemeriksaan visual dilakukan
di browser. Grammarly pada browser lokal menghasilkan hydration warning dari
atribut ekstensi, sehingga sesi browser ini bukan bukti console bersih tanpa ekstensi.

## Form koneksi mandiri — 15 Oktober 2026

Editor dapat membuka **Data sources → Configure connection** untuk Google Ads,
Meta Ads, dan GA4. Tiap form menyediakan panduan sumber data, validasi per field,
serta verifikasi API sebelum penyimpanan per brand. Kegagalan provider atau
penyimpanan tidak ditampilkan sebagai koneksi berhasil. Token dan secret tidak
ditampilkan kembali; sync memakai konfigurasi yang tersimpan.

Instalasi penyimpanan server tetap dilakukan sekali oleh administrator workspace.
Jika belum siap, form menyebutkan penghambatnya secara jelas. Mengisi kredensial
platform tidak memerlukan perubahan environment variable per platform dan tidak
mengaktifkan live ingestion secara otomatis.

Verifikasi: `pnpm verify` lulus (lint, TypeScript, 727 tes, build produksi),
diikuti 40 tes terarah setelah pengetatan validasi. Pengujian API memakai mock
offline; belum ada verifikasi dengan kredensial nyata. Form diperiksa di browser
pada desktop dan ponsel, termasuk tema terang/gelap, validasi field, Escape,
pembersihan isian saat ditutup, dan pencegahan autofill password login ke token API.
Perubahan masih lokal; belum di-push atau di-deploy.

## Popup koneksi platform — 15 Oktober 2026

Google Ads dan GA4 memakai **Continue with Google**: jendela resmi Google untuk
memilih akun dan memberi izin, lalu verifikasi akses laporan dan penyimpanan per
brand. Refresh token diterima otomatis. OAuth app workspace dapat dipakai ulang;
pengaturan app sendiri tersedia dalam disclosure, dan input token manual tetap
menjadi alternatif. Callback yang tepat ditampilkan untuk didaftarkan di Google
Cloud. Google Ads memakai scope ads standar Google; aplikasi hanya membaca data.

Semua konektor aktif memakai popup progres beridentitas platform, tahap koneksi,
hasil sukses dan penutupan otomatis setelah konfirmasi server. Pembatalan izin,
popup diblokir, sesi kedaluwarsa, grant tidak lengkap, serta kegagalan verifikasi
atau penyimpanan tidak menghasilkan sukses palsu. Konektor Planned tetap tidak
menawarkan koneksi sebelum implementasinya tersedia.

Verifikasi terbaru: lint, TypeScript, **734 tes**, dan build produksi lulus.
Browser memeriksa Google/GA4 dan progres Meta, error instalasi, Escape, kedua
tema, serta viewport ponsel 390px tanpa overflow horizontal pada halaman/dialog.
Footer aksi form tetap terlihat saat konten perlu digulir. Sukses, penolakan dan
grant parsial diuji offline dengan mock provider; izin akun nyata belum diuji.
Penyimpanan lokal belum dikonfigurasi. Perubahan belum di-push atau di-deploy.

## Perapian tabel dan insight — 16 Oktober 2026

Tabel memakai lebar workspace: teks membungkus pada desktop dan baris menjadi
kelompok metrik berlabel saat ruang menyempit. Header bertingkat tetap membawa
nama kelompok/tahun; tombol sortir tetap dapat digunakan. Format dan hari aktif
kreatif berada bersama identitas iklan, sementara rekomendasi tetap terbaca utuh.
Grafik donut, filter audit, detail teknis dan aktivitas Worklog ikut menyesuaikan
ruang, tanpa menyembunyikan kolom untuk menghilangkan scrollbar.

Hari aktif pada radar demo sekarang dibatasi tanggal awal–akhir filter secara
inklusif, dengan label **active days in period**. Durasi kreatif demo yang lebih
pendek tetap dipertahankan; perhitungan batas iklan memakai rata-rata belanja
harian dari rentang yang sama. Radar ini tetap ilustrasi, bukan laporan iklan live.

Insight & Recommendation memakai kolom badge tetap agar judul, penjelasan dan
sumber sejajar. Narasi berulang di luar card dihapus; catatan penting tentang
cakupan, konversi dan pembanding tersedia dalam disclosure di dalam card.
Tanggal kedaluwarsa Meta menggunakan kalender bawaan browser dengan validasi
tanggal dan konversi zona waktu, tanpa harus mengetik timestamp ISO.

Verifikasi lokal: lint, TypeScript, **738 tes**, dan build produksi lulus.
Pemeriksaan browser mencakup Paid ads (Google dan Meta), Store analytics,
Worklog, Data sources, Account dan sign-in pada 1440, 1024, 760 dan 390px,
tema terang/gelap. Jalur yang diperiksa mencakup tabel provider, keyword,
cohort, tabel tahunan, sortir, detail audit, indent insight dan kalender Meta.
Kredensial nyata serta persetujuan OAuth akun nyata belum diuji; verifikasi
provider memakai mock offline. Perubahan tetap lokal, belum di-push/deploy.

## Implementasi rancangan Google Stitch — 17 Oktober 2026

Enam halaman mengikuti pasangan Light/Dark pada rancangan **SatuLayar — Faithful
UI Replica**: Paid ads, Store analytics, Worklog, Data sources, Account & access,
dan sign-in. Implementasi memakai komponen React dan token Signal Workspace
yang ada, dengan sidebar gelap pada kedua tema, lebar workspace penuh, header
ringkas, kartu budget/platform terpadu, serta kartu workspace yang responsif.
Sign-in memakai komposisi 60:40, ilustrasi jaringan, headline statis, dan panel
form yang mengikuti tema. Label demo serta fungsi filter, form, izin dan
perhitungan yang ada tetap dipertahankan; mockup bukan sumber klaim live.

Timestamp audit contoh kini memakai snapshot dari server untuk menghindari
hydration mismatch. Menutup dialog koneksi mengembalikan fokus ke tombol asal.
Pemeriksaan responsif mencakup 1440, 1024, 760 dan 390px pada keenam halaman
dan kedua tema, tanpa scroll horizontal halaman. Perpindahan workspace,
Password/Magic link, dialog koneksi dan Escape diperiksa di browser. Ekstensi
Grammarly pada browser lokal masih dapat menambah atribut hydration sendiri;
ini bukan bukti console bersih pada browser tanpa ekstensi.

Perubahan masih lokal dan belum di-push atau di-deploy. Rincian kontrak visual
ada di `docs/design-system.md`.

Verifikasi akhir: lint, TypeScript, **738 tes**, dan build produksi lulus.

## Rekonstruksi Dark dari Stitch — 17 Oktober 2026

Tahap aktif mengikuti urutan Dark dashboard, Light, lalu halaman login. Dark
dashboard kini memakai permukaan charcoal datar, border mineral, kontrol yang
lebih tegas, tipografi operasional, dan sidebar ringkas. Snapshot dan disclosure
target berbagi satu kartu; budget pacing memakai progress bar dengan persentase
aktual dan jumlah over-budget yang tetap terlihat ketika bar mencapai 100%.
Budget kosong tetap N/A. Data sources menempatkan Planned dan Runtime readiness
berdampingan pada layar lebar. Status Config required memakai amber.

Tema awal kini Dark, termasuk ketika penyimpanan browser tidak tersedia;
pilihan Light/Dark yang sudah disimpan tetap dihormati. Perubahan Light dan
komposisi halaman login belum termasuk rekonstruksi tahap ini. Rincian referensi
dan kontrak ada di `docs/design-system.md`.

Kelima halaman dashboard diperiksa pada 1440, 1024, 760 dan 390px tanpa scroll
horizontal halaman atau kontrol utility keluar viewport. Filter Google/Meta,
persistensi tema, dialog koneksi ponsel, Escape/focus recovery, navigasi mobile
dan pengisian form dari contoh Worklog diperiksa. Uji konektor provider nyata
tidak dilakukan. Perubahan tetap lokal, belum di-push atau di-deploy.

Verifikasi tahap Dark: lint, TypeScript/build produksi, dan **740 tes** lulus.


### Koreksi kesesuaian dari ZIP — 17 Oktober 2026

ZIP yang diberikan Aditya menjadi referensi pembandingan langsung setelah
review sebelumnya belum cukup dekat dengan rancangan. Koreksi mencakup header
Paid selebar layar, breakpoint tabel desktop, tipografi per halaman, material
graphite Store, legenda dan tabel bulanan dalam kartu grafik, Worklog padat
dengan detail yang dapat dibuka, serta lima kartu workspace pada desktop.
Render Store panjang di ZIP memiliki styling yang benar dan menggantikan
kesimpulan sebelumnya tentang render hosted yang tidak terformat. Data dan
status aplikasi tetap berdasarkan implementasi, sehingga angka/tanggal/klaim
yang bersifat ilustratif pada rancangan tidak disalin sebagai fakta.

Lima route diperiksa pada 1280/1024/760/390px tanpa overflow horizontal halaman.
Filter tahun, tabel bulanan, perluasan sampel Worklog, autofill, filter platform
dan persistensi tema diperiksa. Perubahan masih lokal; Light dan rekonstruksi
login tetap tahap berikutnya. Verifikasi geometri visual ini tidak menyatakan
kesamaan piksel seluruh halaman.

Verifikasi koreksi ZIP: lint, **740/740 tes**, TypeScript dan build produksi
lulus. Build final sempat terkena EPERM folder output Windows, lalu lulus saat
diulang tanpa perubahan kode. Dialog koneksi mengembalikan fokus setelah
ditutup; tidak ada error console pada urutan interaksi yang diperiksa.


### Koreksi desain grafik

Atas instruksi lanjutan Aditya, cincin budget mengikuti draf awal Paid ads
yang dipilih secara eksplisit: ring amber/biru, persen di tengah, statistik
di samping. Ini menggantikan keputusan progress bar pada tahap sebelumnya.
Bar tahunan memakai batang ramping 10 unit, celah 4 unit, palet dari ZIP,
dan plot tanpa lapisan dekoratif. Orders trend dapat dinyalakan lewat legenda.
Stacked bar memakai sambungan segmen rata serta warna yang sama dengan bar
kategori dan legendanya. Bar komposisi menunjukkan persentase bagian dari
total; nilai nol tidak lagi diberi lebar/tinggi minimum buatan. Donut yang
sudah ada memakai material dan legenda yang konsisten. Perhitungan metrik,
scoring dan konektor tetap memakai data aplikasi.

Verifikasi grafik: **741/741 tes**, lint, TypeScript dan build produksi lulus.
Paid dan Store diperiksa pada 1280/1024/760/390px tanpa overflow horizontal
halaman. Toggle Orders, pilihan tahun, tooltip segmen stacked, warna kategori
dan kompatibilitas Light diperiksa; tema akhir Dark. Belum di-push/deploy.
