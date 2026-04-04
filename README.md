Social Media Views Dashboard

Next.js dashboard untuk technical test Web Developer yang menampilkan data dari 3 platform secara bersamaan:

TikTok
YouTube
Instagram

User dapat memasukkan username/channel, melihat informasi akun, total views, serta daftar konten terbaru, dan melakukan refresh data tanpa reload halaman.

Tech Stack
Next.js (App Router)
TypeScript
Tailwind CSS
Server-side data aggregation via /api/social
Cara Menjalankan
npm install
npm run dev
Architecture Overview

Aplikasi ini menggunakan pendekatan server-side aggregation melalui endpoint:

app/api/social/route.ts

Endpoint ini bertugas untuk:

Menerima input username dari masing-masing platform
Mengambil data dari public source (API / HTML parsing)
Menormalisasi data ke format yang seragam
Mengembalikan response ke frontend
Alasan Pendekatan

Pendekatan ini dipilih untuk:

Menghindari CORS issue
Menjaga keamanan API key (tidak expose ke client)
Menyederhanakan logic di frontend
Mendukung refresh data tanpa reload halaman
Mengontrol error handling secara terpusat
Data Normalization Strategy

Setiap platform memiliki struktur data yang berbeda.
Untuk itu, aplikasi ini menggunakan format response yang diseragamkan:

{
  platform: string;
  username: string;
  profileImage: string;
  totalViews?: number;
  contents: {
    title?: string;
    thumbnail?: string;
    views?: number;
  }[];
  status: "success" | "partial" | "error";
}

Tujuannya:

Mempermudah rendering di UI
Mengurangi conditional logic di frontend
Membuat sistem scalable untuk penambahan platform baru
UI / UX Principles

Dashboard dirancang dengan prinsip:

Menampilkan ketiga platform secara berdampingan
Status data yang jelas: success, partial, error
Tetap informatif meskipun data tidak lengkap
Tidak bergantung pada satu sumber data saja
Platform Implementation
YouTube

Platform dengan akses data paling stabil melalui API publik.

Data yang berhasil diambil:

Nama channel
Foto profil
Total views channel
Minimal 5 video terbaru
Views per video

→ Implementasi YouTube bersifat fully functional

Instagram

Instagram membatasi akses data konten tanpa autentikasi.

Data yang dapat diambil:

Username
Foto profil
Metadata akun

Kendala:

Data konten tidak selalu tersedia tanpa login
Perbedaan behavior antara local dan production (Vercel)

Pendekatan:

Menggunakan metadata sebagai primary data
Mengambil konten secara best-effort
Menandai status sebagai partial jika data tidak lengkap
TikTok

TikTok memiliki proteksi yang lebih ketat terhadap scraping/public access.

Data yang dapat diambil:

Username
Foto profil
Jumlah followers

Kendala utama:

Endpoint memerlukan signature/authentication
Data video dan views tidak tersedia secara konsisten

Pendekatan:

Menggunakan metadata sebagai fallback
Tidak memaksakan scraping yang tidak stabil
Menandai status sebagai partial
Known Issues

Beberapa keterbatasan yang diketahui:

Instagram: error saat deployment (Vercel) karena perbedaan environment / proteksi request
TikTok: data konten dan views tidak dapat diakses secara reliable tanpa autentikasi
Perubahan struktur HTML/API dari platform dapat menyebabkan data parsing gagal
Technical Constraints & Trade-offs

Beberapa keputusan yang diambil selama development:

Tidak menggunakan unofficial/private API untuk menghindari ketidakstabilan
Tidak memaksakan scraping kompleks yang rentan break
Mengutamakan stabilitas aplikasi dibanding “fake completeness”

Trade-off:

Data tidak selalu lengkap
Namun aplikasi tetap konsisten dan dapat diandalkan
Future Improvements

Jika dikembangkan lebih lanjut:

Integrasi official API Instagram Graph (dengan authentication)
Penggunaan proxy service untuk TikTok scraping (jika diperlukan)
Caching layer (Redis / ISR) untuk mengurangi request berulang
Rate limit handling per platform
Monitoring error per platform
Project Structure
app/page.tsx              → Dashboard UI
app/api/social/route.ts  → Data aggregation
lib/                     → Platform-specific logic
components/              → UI components
Conclusion

Aplikasi ini tidak hanya berfokus pada menampilkan data, tetapi juga pada:

Handling perbedaan akses antar platform
Menjaga stabilitas di tengah keterbatasan API publik
Memberikan transparansi terhadap status data

Pendekatan ini mencerminkan implementasi nyata dalam production system yang bergantung pada external services.

Short Explanation (Submission)

Saya membangun dashboard menggunakan Next.js App Router dan TypeScript dengan pendekatan server-side data aggregation.

Data dari YouTube berhasil diimplementasikan secara lengkap menggunakan API publik. Untuk Instagram dan TikTok, terdapat keterbatasan akses data tanpa autentikasi, sehingga saya menerapkan pendekatan best-effort dan fallback, serta menampilkan status data secara transparan di UI.

Fokus utama solusi ini adalah menjaga stabilitas aplikasi sekaligus menunjukkan bagaimana menangani limitasi API eksternal secara realistis.