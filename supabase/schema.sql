-- Skema Supabase untuk aplikasi Buku Absen Kelas.
-- Jalankan di Supabase Dashboard > SQL Editor > New query > Run.

create extension if not exists "pgcrypto";

-- Daftar siswa per kelas.
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  kelas text not null,
  nama text not null,
  nis text,
  urut int,
  created_at timestamptz not null default now()
);

-- Satu baris = satu pertemuan (satu kelas, satu tanggal). Kolom kegiatan
-- hanya label, misalnya "Matematika, bab 3".
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  kelas text not null,
  tanggal date not null,
  kegiatan text,
  created_at timestamptz not null default now()
);

-- Satu baris = status satu siswa pada satu pertemuan.
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null check (status in ('hadir', 'sakit', 'izin', 'alpa', 'tanpa_keterangan')),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists students_kelas_idx on students (kelas);
create index if not exists sessions_kelas_tanggal_idx on sessions (kelas, tanggal);
create index if not exists attendance_session_idx on attendance (session_id);

-- Keamanan: Row Level Security wajib aktif karena anon key dipakai di browser.
alter table students enable row level security;
alter table sessions enable row level security;
alter table attendance enable row level security;

-- Kebijakan di bawah cocok untuk kelas kecil: siapa pun yang punya URL situs
-- bisa membaca DAN mengubah data. Kalau hanya kamu (dan wali kelas) yang boleh
-- mengubah, tambahkan Supabase Auth dan ganti "anon" menjadi "authenticated"
-- pada bagian tulis (insert/update/delete).
drop policy if exists "students_read" on students;
drop policy if exists "students_write" on students;
drop policy if exists "sessions_read" on sessions;
drop policy if exists "sessions_write" on sessions;
drop policy if exists "attendance_read" on attendance;
drop policy if exists "attendance_write" on attendance;

create policy "students_read" on students for select to anon using (true);
create policy "students_write" on students for all to anon using (true) with check (true);

create policy "sessions_read" on sessions for select to anon using (true);
create policy "sessions_write" on sessions for all to anon using (true) with check (true);

create policy "attendance_read" on attendance for select to anon using (true);
create policy "attendance_write" on attendance for all to anon using (true) with check (true);

-- Satu kelas hanya punya satu sesi per tanggal. Kegiatan cukup jadi label
-- yang bisa diubah kapan saja, bukan bagian dari identitas sesi.
drop index if exists sessions_unik_idx;
create unique index if not exists sessions_kelas_tanggal_unik_idx on sessions (kelas, tanggal);
