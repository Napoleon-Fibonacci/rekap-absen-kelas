// Isi dua nilai di bawah dengan kredensial project Supabase kamu.
//
//   SUPABASE_URL      : Project URL, contoh "https://abcdefgh.supabase.co"
//   SUPABASE_ANON_KEY: kunci "anon public" (bukan service_role)
//
// Keduanya bisa dilihat di Supabase Dashboard > Project Settings > API.
//
// Kalau dua nilai ini dibiarkan kosong, aplikasi tetap jalan memakai
// mode lokal: data disimpan di browser (localStorage) dan tidak dibagikan
// ke perangkat lain. Cocok untuk coba-coba sebelum Supabase disiapkan.
//
// PENTING: anon key memang aman dipakai di browser selama Row Level Security
// aktif pada tabel. Jalankan supabase/schema.sql lebih dulu.

window.APP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
