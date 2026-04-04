# Social Media Views Dashboard

Next.js dashboard untuk technical test Web Developer yang menampilkan data dari 3 platform secara bersamaan:

- TikTok
- YouTube
- Instagram

User dapat memasukkan username/channel, melihat informasi akun, total views, serta daftar konten terbaru, dan melakukan refresh data tanpa reload halaman.

---

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Server-side data aggregation via `/api/social`

---

## Cara Menjalankan

```bash
npm install
npm run dev

Pendekatan

Aplikasi ini menggunakan pendekatan server-side aggregation melalui endpoint:

app/api/social/route.ts

Endpoint ini bertugas untuk:

menerima input username dari masing-masing platform
mengambil data dari public source (API / HTML parsing)
menormalisasi data ke format yang seragam
mengirimkan response ke frontend

Pendekatan ini dipilih untuk:

menghindari CORS issue
menjaga keamanan API key
memastikan proses refresh data dapat dilakukan tanpa reload halaman
UI / UX

Dashboard dirancang dengan prinsip:

menampilkan ketiga platform secara berdampingan
status data yang jelas (Ready, Partial, Error)
tetap informatif meskipun terdapat keterbatasan data dari platform tertentu
Catatan Implementasi per Platform
YouTube

YouTube memiliki akses data publik yang paling stabil.

Data yang berhasil diambil:

nama channel
foto profil
total channel views
minimal 5 video terbaru
jumlah views per video

Implementasi YouTube merupakan bagian paling lengkap dalam aplikasi ini.

Instagram

Instagram masih menyediakan metadata akun publik seperti:

username
foto profil
sebagian informasi profil

Namun, untuk data konten (views per post), akses publik tanpa autentikasi memiliki keterbatasan dan tidak selalu konsisten, terutama pada environment produksi (deployment).

Pendekatan yang digunakan:

mengambil metadata akun sebagai data utama
mencoba mengambil konten terbaru secara best-effort
menampilkan status partial jika data konten tidak tersedia
TikTok

TikTok memiliki proteksi yang lebih ketat terhadap akses data publik.

Data yang masih dapat diakses:

username
foto profil
jumlah followers

Namun, untuk data video terbaru dan view count:

membutuhkan request signature / autentikasi
tidak tersedia secara stabil melalui public request

Pendekatan yang digunakan:

menampilkan metadata akun
menyediakan fallback untuk konten
menandai status sebagai partial
Kendala Teknis

Beberapa kendala utama dalam pengembangan:

Perbedaan struktur data dan kebijakan akses di setiap platform
Instagram dan TikTok membatasi akses data konten tanpa login
Endpoint publik sering berubah atau dibatasi di environment produksi

Solusi yang diterapkan:

menggunakan pendekatan hybrid (API + scraping)
menampilkan data publik yang tersedia secara maksimal
memberikan status dan warning yang transparan pada UI
menjaga agar aplikasi tetap stabil meskipun data tidak lengkap
Struktur Project
app/page.tsx → Dashboard UI
app/api/social/route.ts → Aggregation & data fetching
lib/ → Helper untuk masing-masing platform
components/ → UI components
Kesimpulan

Aplikasi ini dirancang tidak hanya untuk menampilkan data, tetapi juga untuk:

menangani perbedaan akses antar platform
tetap stabil dalam kondisi data terbatas
memberikan transparansi terhadap limitasi API publik

Pendekatan ini mencerminkan bagaimana aplikasi production menangani dependency eksternal yang tidak selalu konsisten.

Penjelasan Singkat (untuk submission)

Saya membangun dashboard menggunakan Next.js App Router dan TypeScript dengan pendekatan server-side data aggregation. Data dari TikTok, YouTube, dan Instagram diambil melalui public endpoint dan HTML parsing, kemudian dinormalisasi agar dapat ditampilkan secara konsisten di UI.

YouTube dapat diimplementasikan secara lengkap, sedangkan Instagram dan TikTok memiliki keterbatasan akses data publik, khususnya untuk konten dan view count tanpa autentikasi. Untuk itu, saya menerapkan pendekatan best-effort dan fallback, serta menampilkan status data secara transparan di dashboard.

Fokus utama dari solusi ini adalah menjaga stabilitas aplikasi sekaligus menunjukkan penanganan terhadap limitasi API dari masing-masing platform.