# Social Media Views Dashboard

Next.js dashboard untuk technical test Web Developer yang menampilkan data dari 3 platform sekaligus:

- TikTok
- YouTube
- Instagram

User bisa memasukkan username/channel, melihat nama akun, foto profil, total views, dan daftar konten terbaru, lalu me-refresh data tanpa reload halaman.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Server-side aggregation via `/api/social`

## Cara Menjalankan

```bash
npm install
npm run dev
```

App akan jalan di `http://localhost:3000`.

## Pendekatan

Dashboard ini memakai satu endpoint server-side: `app/api/social/route.ts`.

Endpoint tersebut:

- menerima username TikTok, YouTube, dan Instagram
- mengambil data public page masing-masing platform
- menormalisasi hasil ke format yang sama
- mengirimkan response ke UI agar dashboard bisa di-refresh tanpa full page reload

UI ada di `app/page.tsx` dan dibuat supaya:

- semua platform tampil berdampingan
- status data jelas (`Ready`, `Partial`, `Error`)
- limitasi public data tetap transparan ke reviewer

## Catatan per Platform

### YouTube

YouTube public channel page masih cukup bisa diparsing dari HTML publik.

Data yang diambil:

- nama channel
- avatar
- total channel views dari tab About
- minimal 5 video terbaru
- views per video

Ini adalah integrasi yang paling lengkap di app ini.

### Instagram

Instagram public profile masih menampilkan metadata akun seperti:

- nama akun
- foto profil
- deskripsi/follower snippet

Namun untuk views post terbaru, endpoint publik tanpa login sering dibatasi. Karena itu implementasi di project ini memakai best-effort fetch untuk 5 post terbaru, tetapi bila endpoint diblokir maka dashboard tetap menampilkan profile metadata dan warning yang jelas.

### TikTok

TikTok public page masih memungkinkan pengambilan metadata akun seperti:

- nama akun
- avatar
- follower info

Tetapi list recent post views untuk request publik/logged-out sudah tidak stabil. Karena itu card TikTok dibuat `partial` dan limitation tersebut ditampilkan langsung di UI.

## Kendala yang Ditemui

- Tiap platform punya struktur halaman dan kebijakan akses data publik yang berbeda.
- YouTube relatif paling mudah karena data masih ada di HTML page.
- Instagram dan TikTok jauh lebih ketat untuk data konten/view saat request tanpa login.
- Karena requirement membolehkan “API resmi atau metode lain yang sah”, pendekatan terbaik untuk technical test ini adalah:
  - ambil data publik yang memang tersedia
  - tampilkan hasil semaksimal mungkin
  - jelaskan limitasi secara jujur di UI dan dokumentasi

## Struktur Penting

- `app/page.tsx`: dashboard UI
- `app/api/social/route.ts`: fetch + parsing + normalisasi data platform
- `app/layout.tsx`: metadata aplikasi


## Contoh Penjelasan Singkat untuk Pengumpulan

Saya membangun dashboard dengan Next.js App Router dan TypeScript. Data dari TikTok, YouTube, dan Instagram diambil di sisi server melalui public endpoints/page parsing, lalu dinormalisasi ke satu format response agar UI bisa menampilkan ketiga platform secara konsisten dan bisa di-refresh tanpa reload halaman. Kendala utama ada pada limitasi akses public data Instagram dan TikTok, terutama untuk view per konten terbaru tanpa login, sehingga solusi saya adalah menampilkan data publik yang tersedia semaksimal mungkin dan menandai limitasinya secara jelas di dashboard.
