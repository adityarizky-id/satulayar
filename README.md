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
