# Scrapbook Puzzle Cam

Sebuah aplikasi bilik foto (*photobooth*) interaktif berbasis web yang bisa dikendalikan dengan gerakan tangan (*hand gestures*) maupun sentuhan layar. Pecahkan *sliding puzzle* untuk mendapatkan fotomu, lalu hias hasil jepretanmu dengan stiker bergaya *scrapbook* — semuanya langsung di *browser*, di komputer maupun di HP, tanpa perlu instalasi aplikasi tambahan!

## COBA LANGSUNG

Tidak perlu instalasi. Buka demo-nya langsung di browser, di komputer maupun di HP:

**[https://crafty-9.github.io/Scrapbook-Puzzle-Cam/](https://crafty-9.github.io/Scrapbook-Puzzle-Cam/)**

Izinkan akses kamera saat diminta, dan pastikan koneksi internet stabil karena model pelacak tangan perlu diunduh saat pertama kali dibuka.

---

## FITUR UTAMA

- **Hand-Gesture Capture:** Buat bingkai (*frame*) dengan kedua telunjukmu di depan kamera, lalu cubit (*pinch*) dengan kedua tangan untuk mengambil foto. Di HP, cukup tekan tombol **Ambil Foto**.
- **Sliding Puzzle Minigame:** Foto yang diambil dipecah menjadi kepingan (3x3 atau 4x4) dan diacak. Susun kembali dengan gerakan mencubit di depan kamera, atau **geser langsung dengan jari di layar**. Setelah selesai, buat kepalan tangan (*fist*) atau tekan **Simpan** di HP.
- **Mobile Friendly:** Tombol mengambang (**Ambil Foto**, **Simpan**, **Ulang**), geser kepingan dengan sentuhan, area ambil dan snap yang lebih longgar, galeri foto yang disembunyikan agar tidak menutupi puzzle, serta layar yang tetap menyala selama bermain.
- **Photobooth Layouts:** Pilih strip foto sebelum mulai (2, 3, atau 4 foto) dan ukuran puzzle (3x3 atau 4x4).
- **Aesthetic Filters:** Pilihan filter *Original*, *B&W*, *Vintage*, *Korean*, *Warm Glow*, dan *Cool Blue*.
- **Scrapbook Editor:** Hias foto *strip*-mu di ruang edit virtual! Pilih warna bingkai (10 warna pastel) dan gaya bingkai (polkadot, gingham, garis, hati, bintang, bunga) lengkap dengan hiasan jahitan dan pita (warna pita menyesuaikan bingkai), tulis catatan (gaya teks saja, label, atau panel, dengan warna teks putih atau hitam yang menyesuaikan bingkai; catatan panjang otomatis turun ke baris berikutnya), tempelkan stiker dengan *drag-and-drop* (mouse maupun sentuhan), dan ubah warna tiap stiker lewat palet **Sticker Color** (ketuk stiker di foto untuk memilihnya, lalu pilih warna).
- **Printing Animation:** Rasakan sensasi menunggu foto dicetak dengan animasi mesin cetak virtual sebelum masuk ke mode edit!

---

## CARA MENJALANKAN DI KOMPUTER LOKAL

Aplikasi ini berjalan murni di *frontend* (browser). Karena alasan keamanan, browser hanya mengizinkan akses kamera lewat **HTTPS** atau **localhost**, sehingga aplikasi ini harus dijalankan melalui **Local Server**.

### 1. Klon Repositori Ini
```bash
git clone https://github.com/Crafty-9/Scrapbook-Puzzle-Cam
cd Scrapbook-Puzzle-Cam
```

### 2. Jalankan Local Server
Kamu bisa menggunakan ekstensi **Live Server** di VSCode, atau menggunakan Python (jika sudah terinstal):
```bash
python -m http.server 8000
```

### 3. Buka di Browser
Buka browser (disarankan **Google Chrome** atau **Microsoft Edge**) lalu akses URL:
```text
http://localhost:8000
```
*Catatan: Pastikan komputermu terhubung ke internet saat pertama kali dibuka karena aplikasi akan mengunduh model pelacak tangan (sekitar 10 MB) dari Google MediaPipe.*

---

## CARA MENJALANKAN DI HP

Kamera di HP hanya bisa dipakai lewat **HTTPS**, jadi alamat lokal biasa seperti `http://192.168.x.x:8000` **tidak akan bekerja**. Cara tercepat adalah membuka [demo langsung](https://crafty-9.github.io/Scrapbook-Puzzle-Cam/) dari HP, karena sudah memakai HTTPS. Kalau ingin menjalankan sendiri, pilih salah satu cara berikut:

- **Deploy ke hosting statis (paling mudah).** Unggah repositori ini ke **GitHub Pages**, **Netlify**, atau **Vercel**, lalu buka alamat HTTPS-nya dari HP. Untuk GitHub Pages: buka *Settings → Pages*, pilih branch `main`, lalu simpan.
- **Uji dari komputer.** Pakai terowongan HTTPS seperti `ngrok` atau Cloudflare Tunnel yang mengarah ke server lokal, atau di Chrome desktop buka `chrome://inspect` dan aktifkan *port forwarding* agar `localhost` bisa dibuka dari HP lewat kabel USB.

Disarankan memakai **Google Chrome**. Safari di iPhone belum diuji.

---

## CARA BERMAIN

> Setiap kali menekan **START CREATING**, popup singkat **Panduan Gestur Tangan** muncul sebelum kamera menyala. Panduan bermain lengkap untuk komputer dan HP ada di **Rules** atau ikon **?** di header layar pemilihan, serta ikon **?** di samping tombol fullscreen saat bermain.

### Di komputer (gestur tangan)

1. Buka aplikasi, pilih **Layout**, ukuran puzzle, dan **Filter**, lalu klik "START CREATING".
2. Di depan kamera, buat bentuk **bingkai (frame)** dengan kedua jari telunjukmu, lalu **cubit (pinch)** dengan kedua tangan dan tahan sebentar.
3. Setelah hitung mundur, aplikasi mengambil gambar dan mengacaknya menjadi *puzzle*.
4. Gunakan gestur **mencubit (pinch)** dan geser tanganmu untuk memindahkan kepingan. Kamu juga bisa menyeretnya dengan mouse.
5. Setelah *puzzle* tersusun, buat **kepalan tangan (fist)** dan tahan untuk menyimpan. Kalau puzzle belum selesai, kepalan tangan akan mengulang pengambilan foto.
6. Ulangi sampai seluruh slot foto pada layout *photobooth* terpenuhi.
7. Tunggu animasi *printing* selesai, lalu hias fotomu di ruang edit dengan stiker dan warna bingkai.
8. Simpan hasilnya dengan tombol **Save Photo** untuk mengunduh gambar.

### Di HP

1. Sandarkan HP (misalnya pada tripod atau tumpukan buku) dengan **kamera depan** menghadap ke arahmu.
2. Pilih **Layout**, ukuran puzzle, dan **Filter**, lalu ketuk "START CREATING" dan izinkan akses kamera.
3. Tunggu sampai status **"siap"**, lalu ketuk **Ambil Foto**. Kamu punya 5 detik untuk bergaya sebelum foto diambil di bingkai tengah layar.
4. **Geser kepingan dengan jari** di layar untuk menyusun puzzle. Gestur cubit di depan kamera tetap bisa dipakai.
5. Setelah puzzle tersusun, ketuk **Simpan**. Ketuk **Ulang** kalau ingin mengambil foto lagi. Foto-foto sebelumnya disembunyikan agar tidak menutupi puzzle; ketuk penghitung foto di bagian atas layar (misalnya `1 / 3`) untuk melihatnya sebentar.
6. Ulangi sampai strip foto penuh, lalu hias di ruang edit: seret stiker dengan jari dan buang ke ikon tempat sampah.
7. Simpan hasil akhir dengan tombol **Save Photo** atau ikon simpan di bar bawah.

---

## TIPS & PEMECAHAN MASALAH

- **Kamera tidak menyala:** pastikan aplikasi dibuka lewat HTTPS (atau `localhost` di komputer) dan izin kamera sudah diberikan di pengaturan browser.
- **Tombol "Ambil Foto" tidak muncul:** tunggu sampai model tangan selesai dimuat (status berubah menjadi "siap"). Unduhan pertama sekitar 10 MB, jadi butuh koneksi yang stabil.
- **Deteksi tangan patah-patah di HP:** tutup aplikasi lain, gunakan pencahayaan yang cukup, dan pakai Chrome versi terbaru. Di HP tanpa dukungan WebGL, aplikasi otomatis beralih ke mode CPU yang lebih lambat.
- **Cubitan terlalu sensitif atau sulit terdeteksi:** sesuaikan nilai `PINCH_ON_RATIO` dan `PINCH_OFF_RATIO` di `app.js`.
- **Hasil tidak terunduh di iPhone:** Safari kadang membuka gambar di tab baru. Tekan lama gambar tersebut lalu pilih *Simpan ke Foto*.

---

## TEKNOLOGI YANG DIGUNAKAN

- **HTML5 & Vanilla JavaScript** (ES6 Modules)
- **CSS3 & Tailwind CSS** (untuk *layout* UI estetik dan responsif)
- **Google MediaPipe Hands** (deteksi kerangka tangan secara *real-time*, dengan fallback CPU)
- **HTML5 Canvas API** (manipulasi gambar, filter, dan fitur *drag-and-drop* kepingan serta stiker)
- **Pointer Events & Screen Wake Lock API** (kontrol sentuhan dan layar tetap menyala di HP)

---

*Created and Modified by altherion*