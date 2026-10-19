# Buku Absen Kelas

Aplikasi absensi kelas sederhana: catat kehadiran, lihat rekap dalam bentuk matriks
siswa dikali tanggal, lalu unduh hasilnya sebagai CSV.

Dibuat dengan HTML, CSS, dan JavaScript biasa. Tanpa framework, tanpa build step.
Siap diunggah ke Vercel.

## Isi berkas

| Berkas | Fungsi |
| --- | --- |
| `index.html` | Kerangka halaman: pemilih kelas, tab Absen / Rekap / Siswa |
| `styles.css` | Seluruh tampilan |
| `app.js` | Logika aplikasi: baca-tulis data, render, unduh CSV. Kelas bawaan `X-3` |
| `config.js` | Kredensial Supabase (kosongkan untuk mode lokal) |
| `api/config.js` | Vercel Function yang membaca environment variable |
| `supabase/schema.sql` | Tabel dan kebijakan keamanan Supabase |

## Cara kerja penyimpanan

Aplikasi memilih backend secara otomatis:

1. Kalau `config.js` sudah diisi, data masuk ke **Supabase** dan bisa dibuka dari
   perangkat mana pun.
2. Kalau `config.js` masih kosong, aplikasi mencoba `/api/config` (dipakai di Vercel
   setelah environment variable diisi).
3. Kalau keduanya tidak ada, aplikasi jalan dalam **mode lokal**: data disimpan di
   browser lewat `localStorage`, hanya untuk perangkat itu. Berguna untuk mencoba
   tanpa akun Supabase.

## Menyiapkan Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, tempel seluruh isi `supabase/schema.sql`, lalu Run.
3. Buka **Project Settings > API**, salin `Project URL` dan kunci `anon public`.

## Menjalankan di komputer

Karena memakai ES module dan `fetch`, halaman perlu dibuka lewat server lokal,
bukan klik dua kali pada berkas:

```bash
python -m http.server 5173
# lalu buka http://localhost:5173
```

Isi `config.js` lebih dulu kalau ingin langsung tersambung ke Supabase.

## Deploy ke Vercel

1. Unggah folder ini ke repositori GitHub, atau jalankan `npx vercel` dari folder ini.
2. Di Vercel, buka **Project Settings > Environment Variables**, tambahkan:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Deploy ulang supaya environment variable terbaca.

Berkas `config.js` boleh dibiarkan kosong saat deploy: nilainya diambil dari
`/api/config`. Kalau tidak ingin memakai environment variable, isi `config.js`
langsung dengan kredensial — anon key memang dirancang untuk sisi browser.

## Catatan keamanan

- `anon key` **bukan** rahasia, tetapi keamanan datanya bergantung sepenuhnya pada
  Row Level Security. `schema.sql` sudah mengaktifkan RLS.
- Kebijakan di `schema.sql` mengizinkan siapa saja yang punya alamat situs untuk
  membaca dan mengubah data. Untuk kelas kecil ini biasanya cukup. Kalau perlu
  lebih ketat, tambahkan Supabase Auth dan batasi kebijakan tulis ke `authenticated`.
- Jangan pernah menaruh `service_role key` di berkas ini.

**Kelas bawaan** `X-3`. Bisa diganti kapan saja lewat kolom Kelas pada bagian atas halaman.

## Cara kerja sesi absen

Satu kelas punya satu sesi per tanggal. Sesi baru terbentuk begitu status
pertama ditandai, jadi sekadar membuka tanggal tidak menambah baris kosong
di rekap. Kolom **Kegiatan** hanya label yang boleh diisi kapan saja, dan
perubahannya tersimpan otomatis tanpa menghapus tanda kehadiran.

## Format CSV
- Pemisah `;` dan BOM UTF-8, supaya rapi langsung dibuka di Excel versi Indonesia.
- Kolom: nomor, nama, NIS, satu kolom per tanggal, rekap tiap status, persen hadir.
- Simbol status: H = hadir, S = sakit, I = izin, A = alpa, TK = tanpa keterangan.
