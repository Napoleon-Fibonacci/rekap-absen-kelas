/* Buku Absen Kelas — logika aplikasi.
   Vanilla JS, tanpa build step. Dua backend:
   - Supabase (kalau kredensial tersedia)
   - localStorage (fallback, data hanya di browser ini) */

const STATUSES = [
  { id: "hadir", label: "Hadir", short: "H" },
  { id: "sakit", label: "Sakit", short: "S" },
  { id: "izin", label: "Izin", short: "I" },
  { id: "alpa", label: "Alpa", short: "A" },
  { id: "tanpa_keterangan", label: "Tanpa keterangan", short: "TK" }
];

const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

// Kelas bawaan. Bisa diganti kapan saja lewat kolom Kelas.
const DEFAULT_KELAS = "X-3";

const el = {
  kelas: document.getElementById("inputKelas"),
  tanggal: document.getElementById("inputTanggal"),
  kegiatan: document.getElementById("inputKegiatan"),
  kelasList: document.getElementById("kelasList"),
  storeNote: document.getElementById("storeNote"),
  footerStat: document.getElementById("footerStat"),
  toast: document.getElementById("toast"),
  views: {
    absen: document.getElementById("view-absen"),
    rekap: document.getElementById("view-rekap"),
    siswa: document.getElementById("view-siswa")
  }
};

/* ---------- utilitas ---------- */

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

const normKegiatan = (value) => {
  const t = (value || "").trim();
  return t ? t : null;
};

/* ---------- konfigurasi & koneksi ---------- */

async function resolveConnection() {
  const cfg = window.APP_CONFIG || {};
  let url = (cfg.SUPABASE_URL || "").trim();
  let key = (cfg.SUPABASE_ANON_KEY || "").trim();

  if (!url || !key) {
    try {
      const res = await fetch("/api/config", { headers: { accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.configured && data.url && data.key) {
          url = data.url;
          key = data.key;
        }
      }
    } catch {
      /* tidak ada endpoint: pakai mode lokal */
    }
  }

  if (!url || !key) return null;

  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    return mod.createClient(url, key);
  } catch {
    return null;
  }
}

/* ---------- backend: Supabase ---------- */

function supabaseStore(client) {
  async function must(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  }

  return {
    label: "Supabase",

    async classes() {
      const rows = await must(client.from("students").select("kelas"));
      return [...new Set(rows.map((r) => r.kelas))].sort((a, b) => a.localeCompare(b));
    },

    students(kelas) {
      return must(
        client
          .from("students")
          .select("*")
          .eq("kelas", kelas)
          .order("urut", { ascending: true, nullsFirst: false })
          .order("nama", { ascending: true })
      );
    },

    async addStudents(kelas, rows) {
      if (!rows.length) return [];
      return must(
        client
          .from("students")
          .insert(rows.map((r) => ({ kelas, nama: r.nama, nis: r.nis || null, urut: r.urut ?? null })))
          .select()
      );
    },

    removeStudent(id) {
      return must(client.from("students").delete().eq("id", id));
    },

    findSession({ kelas, tanggal }) {
      return must(
        client.from("sessions").select("*").eq("kelas", kelas).eq("tanggal", tanggal).maybeSingle()
      );
    },

    async ensureSession({ kelas, tanggal }) {
      const found = await this.findSession({ kelas, tanggal });
      if (found) return found;

      const created = await client
        .from("sessions")
        .insert({ kelas, tanggal })
        .select()
        .maybeSingle();

      if (created.error) {
        // Kemungkinan sesi kembar dibuat dari perangkat lain: ambil yang sudah ada.
        const retry = await this.findSession({ kelas, tanggal });
        if (retry) return retry;
        throw new Error(created.error.message);
      }
      return created.data;
    },

    async updateSession(id, patch) {
      return must(client.from("sessions").update(patch).eq("id", id).select().maybeSingle());
    },

    sessions(kelas) {
      return must(
        client
          .from("sessions")
          .select("*")
          .eq("kelas", kelas)
          .order("tanggal", { ascending: true })
          .order("created_at", { ascending: true })
      );
    },

    attendance(sessionId) {
      return must(client.from("attendance").select("*").eq("session_id", sessionId));
    },

    attendanceForSessions(sessionIds) {
      if (!sessionIds.length) return Promise.resolve([]);
      return must(client.from("attendance").select("*").in("session_id", sessionIds));
    },

    async setMany(sessionId, entries) {
      if (!entries.length) return;
      const now = new Date().toISOString();
      await must(
        client
          .from("attendance")
          .upsert(
            entries.map((e) => ({
              session_id: sessionId,
              student_id: e.student_id,
              status: e.status,
              updated_at: now
            })),
            { onConflict: "session_id,student_id" }
          )
          .select()
      );
    },

    async removeOne(sessionId, studentId) {
      await must(
        client.from("attendance").delete().eq("session_id", sessionId).eq("student_id", studentId)
      );
    },

    async clearSession(sessionId) {
      await must(client.from("attendance").delete().eq("session_id", sessionId));
    }
  };
}

/* ---------- backend: localStorage ---------- */

function localStore() {
  const KEYS = { students: "absen.students", sessions: "absen.sessions", attendance: "absen.attendance" };

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const bySort = (a, b) => (a.urut ?? 9999) - (b.urut ?? 9999) || a.nama.localeCompare(b.nama);

  return {
    label: "mode lokal",

    async classes() {
      return [...new Set(read(KEYS.students, []).map((s) => s.kelas))].sort((a, b) => a.localeCompare(b));
    },

    async students(kelas) {
      return read(KEYS.students, []).filter((s) => s.kelas === kelas).sort(bySort);
    },

    async addStudents(kelas, rows) {
      const all = read(KEYS.students, []);
      const created = rows.map((r) => ({
        id: uid(),
        kelas,
        nama: r.nama,
        nis: r.nis || null,
        urut: r.urut ?? null,
        created_at: new Date().toISOString()
      }));
      write(KEYS.students, all.concat(created));
      return created;
    },

    async removeStudent(id) {
      write(KEYS.students, read(KEYS.students, []).filter((s) => s.id !== id));
      write(KEYS.attendance, read(KEYS.attendance, []).filter((a) => a.student_id !== id));
    },

    async findSession({ kelas, tanggal }) {
      const all = read(KEYS.sessions, []);
      return all.find((s) => s.kelas === kelas && s.tanggal === tanggal) || null;
    },

    async ensureSession({ kelas, tanggal }) {
      const found = await this.findSession({ kelas, tanggal });
      if (found) return found;

      const created = { id: uid(), kelas, tanggal, kegiatan: null, created_at: new Date().toISOString() };
      write(KEYS.sessions, read(KEYS.sessions, []).concat(created));
      return created;
    },

    async updateSession(id, patch) {
      const all = read(KEYS.sessions, []);
      const idx = all.findIndex((s) => s.id === id);
      if (idx < 0) return null;
      all[idx] = { ...all[idx], ...patch };
      write(KEYS.sessions, all);
      return all[idx];
    },

    async sessions(kelas) {
      return read(KEYS.sessions, [])
        .filter((s) => s.kelas === kelas)
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || String(a.created_at).localeCompare(String(b.created_at)));
    },

    async attendance(sessionId) {
      return read(KEYS.attendance, []).filter((a) => a.session_id === sessionId);
    },

    async attendanceForSessions(sessionIds) {
      const set = new Set(sessionIds);
      return read(KEYS.attendance, []).filter((a) => set.has(a.session_id));
    },

    async setMany(sessionId, entries) {
      const all = read(KEYS.attendance, []);
      const now = new Date().toISOString();
      for (const entry of entries) {
        const idx = all.findIndex((a) => a.session_id === sessionId && a.student_id === entry.student_id);
        const row = { session_id: sessionId, student_id: entry.student_id, status: entry.status, updated_at: now };
        if (idx >= 0) all[idx] = { ...all[idx], ...row };
        else all.push({ id: uid(), ...row });
      }
      write(KEYS.attendance, all);
    },

    async removeOne(sessionId, studentId) {
      write(
        KEYS.attendance,
        read(KEYS.attendance, []).filter((a) => !(a.session_id === sessionId && a.student_id === studentId))
      );
    },

    async clearSession(sessionId) {
      write(KEYS.attendance, read(KEYS.attendance, []).filter((a) => a.session_id !== sessionId));
    }
  };
}

/* ---------- state ---------- */

const state = {
  view: "absen",
  kelas: "",
  tanggal: todayISO(),
  kegiatan: "",
  students: [],
  session: null,
  marks: {},          // student_id -> status (sesi aktif)
  sessions: [],
  matrix: {},         // session_id -> { student_id: status }
  classes: []
};

let store = localStore();
let modeNote = "";

/* ---------- notifikasi & status simpan ---------- */

let toastTimer = 0;
function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle("toast--err", isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, isError ? 5200 : 2600);
}

let noteTimer = 0;
function setNote(html) {
  el.storeNote.innerHTML = html;
  clearTimeout(noteTimer);
  if (modeNote) noteTimer = setTimeout(() => (el.storeNote.innerHTML = modeNote), 4000);
}

function stampSaved() {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  setNote(`Tersimpan <b>${time}</b>`);
}

/* ---------- render: kerangka ---------- */

function renderTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    const on = tab.dataset.view === state.view;
    tab.setAttribute("aria-selected", String(on));
  });
  Object.entries(el.views).forEach(([name, node]) => {
    node.hidden = name !== state.view;
  });
}

function renderClasses() {
  el.kelasList.innerHTML = state.classes.map((c) => `<option value="${esc(c)}"></option>`).join("");
}

function renderFooter() {
  if (!state.kelas) {
    el.footerStat.textContent = "";
    return;
  }
  const parts = [state.kelas, `${state.students.length} siswa`];
  if (state.sessions.length) parts.push(`${state.sessions.length} sesi tercatat`);
  el.footerStat.textContent = parts.join(" · ");
}

function countsOf(map) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  let marked = 0;
  Object.values(map || {}).forEach((status) => {
    if (counts[status] !== undefined) counts[status] += 1;
    if (status) marked += 1;
  });
  return { counts, marked };
}

/* ---------- render: absen ---------- */

function tallyHtml() {
  const { counts, marked } = countsOf(state.marks);
  const total = state.students.length;
  const belum = total - marked;

  const segments = STATUSES.filter((s) => counts[s.id] > 0)
    .map((s) => `<i class="meter__seg status--${s.id}" style="flex:${counts[s.id]}"></i>`)
    .join("");
  const kosong = belum > 0 ? `<i class="meter__seg meter__seg--kosong" style="flex:${belum}"></i>` : "";
  const meter = segments + kosong || `<i class="meter__seg meter__seg--kosong"></i>`;

  const label = STATUSES.filter((s) => counts[s.id] > 0)
    .map((s) => `${counts[s.id]} ${s.label.toLowerCase()}`)
    .join(", ");

  return `
    <div class="tally">
      <p class="tally__lead">${counts.hadir}<span>dari ${total} hadir</span></p>
      <div class="meter" role="img" aria-label="${counts.hadir} dari ${total} hadir. ${label || "Belum ada yang ditandai"}. ${belum} belum ditandai.">
        ${meter}
      </div>
      <ul class="tally__list">
        ${STATUSES.map(
          (s) =>
            `<li><span class="tally__short">${esc(s.short)}</span><span class="tally__long">${esc(
              s.label
            )}</span> <b>${counts[s.id]}</b></li>`
        ).join("")}
        <li><span class="tally__long">Belum ditandai</span><span class="tally__short">Belum</span> <b>${belum}</b></li>
      </ul>
    </div>`;
}

function renderAbsen() {
  const node = el.views.absen;

  if (!state.kelas) {
    node.innerHTML = emptyState(
      "Pilih kelas dulu",
      "Isi nama kelas di kolom atas, misalnya “X-3”. Setelah kelas diisi, daftar siswa muncul di sini."
    );
    return;
  }

  if (!state.students.length) {
    node.innerHTML = emptyState(
      "Belum ada siswa di kelas ini",
      `Tambahkan daftar siswa untuk kelas <b>${esc(state.kelas)}</b> lewat tab Siswa. Ada tombol untuk menempel banyak nama sekaligus.`,
      "Tambah siswa",
      "goto-siswa"
    );
    return;
  }

  const toolbar = `
    <div class="toolbar">
      <button class="btn btn--primary" data-act="all-hadir">Tandai semua hadir</button>
      <button class="btn btn--ghost" data-act="clear-session" ${
        Object.keys(state.marks).length ? "" : "disabled"
      }>Kosongkan sesi ini</button>
    </div>`;

  const rows = state.students
    .map((student, index) => {
      const current = state.marks[student.id];
      const buttons = STATUSES.map(
        (s) => `
        <button class="seg__btn status--${s.id}"
                data-act="status"
                data-id="${esc(student.id)}"
                data-status="${s.id}"
                aria-pressed="${String(current === s.id)}"
                title="${esc(s.label)}">
          <span class="seg__long">${esc(s.label)}</span><span class="seg__short">${esc(s.short)}</span>
        </button>`
      ).join("");

      return `
      <li class="roll__item" data-row="${esc(student.id)}">
        <span class="roll__no">${String(index + 1).padStart(2, "0")}</span>
        <span class="roll__who" title="${esc(student.nama)}">
          <span class="roll__name">${esc(student.nama)}</span>
          ${student.nis ? `<span class="roll__nis">${esc(student.nis)}</span>` : ""}
        </span>
        <div class="seg roll__seg" role="group" aria-label="Status ${esc(student.nama)}">${buttons}</div>
      </li>`;
    })
    .join("");

  node.innerHTML = tallyHtml() + toolbar + `<ol class="roll">${rows}</ol>`;
}

/* Perbarui satu baris saja supaya fokus tombol tidak hilang setelah diklik. */
function paintRow(studentId) {
  const node = el.views.absen;
  const row = node.querySelector(`.roll__item[data-row="${CSS.escape(studentId)}"]`);
  if (row) {
    const current = state.marks[studentId];
    row.querySelectorAll('[data-act="status"]').forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.status === current));
      btn.classList.remove("is-stamp");
    });
  }
  const tally = node.querySelector(".tally");
  if (tally) tally.outerHTML = tallyHtml();
  const clear = node.querySelector('[data-act="clear-session"]');
  if (clear) clear.disabled = !Object.keys(state.marks).length;
}

function emptyState(title, body, actionLabel, action) {
  return `
    <div class="empty">
      <h2>${title}</h2>
      <p>${body}</p>
      ${actionLabel ? `<button class="btn" data-act="${action}">${actionLabel}</button>` : ""}
    </div>`;
}

/* ---------- render: rekap ---------- */

function renderRekap() {
  const node = el.views.rekap;

  if (!state.kelas) {
    node.innerHTML = emptyState("Belum ada kelas dipilih", "Isi nama kelas di kolom atas untuk melihat rekap kehadirannya.");
    return;
  }

  if (!state.students.length) {
    node.innerHTML = emptyState(
      "Belum ada siswa di kelas ini",
      `Rekap butuh daftar siswa. Tambahkan dulu di tab Siswa untuk kelas <b>${esc(state.kelas)}</b>.`,
      "Tambah siswa",
      "goto-siswa"
    );
    return;
  }

  if (!state.sessions.length) {
    node.innerHTML = emptyState(
      "Belum ada sesi tercatat",
      "Rekap muncul setelah kamu menandai kehadiran minimal satu hari di tab Absen.",
      "Ke tab Absen",
      "goto-absen"
    );
    return;
  }

  const head = state.sessions
    .map(
      (s) => `
      <th scope="col" title="${esc(s.kegiatan || "Tanpa kegiatan")}">
        <span class="th-date">${esc(fmtDateShort(s.tanggal))}</span>
        <span class="th-sub">${esc(s.kegiatan || "—")}</span>
      </th>`
    )
    .join("");

  const body = state.students
    .map((student, index) => {
      const marks = state.sessions.map((s) => (state.matrix[s.id] || {})[student.id]);

      const cells = state.sessions
        .map((s, i) => {
          const status = marks[i];
          if (!status) return `<td class="cell cell--kosong" title="Belum ditandai">·</td>`;
          return `<td class="cell cell--${status}" title="${esc(STATUS_MAP[status].label)}">${esc(
            STATUS_MAP[status].short
          )}</td>`;
        })
        .join("");

      const tally = Object.fromEntries(STATUSES.map((s) => [s.id, marks.filter((m) => m === s.id).length]));
      const pct = state.sessions.length ? (tally.hadir / state.sessions.length) * 100 : 0;

      return `
      <tr>
        <td class="col-no">${String(index + 1).padStart(2, "0")}</td>
        <td class="col-name" title="${esc(student.nama)}">${esc(student.nama)}</td>
        ${cells}
        ${STATUSES.map((s) => `<td class="tot" title="${esc(s.label)}">${tally[s.id] || "·"}</td>`).join("")}
        <td class="tot tot--akhir">${pct.toFixed(1).replace(".", ",")}%</td>
      </tr>`;
    })
    .join("");

  node.innerHTML = `
    <div class="tally tally--ringkas">
      <p class="tally__lead">${state.sessions.length}<span>sesi tercatat untuk ${esc(state.kelas)}</span></p>
      <ul class="tally__list">
        <li>${state.students.length} siswa</li>
        <li>Huruf: ${STATUSES.map((s) => `${esc(s.short)} = ${esc(s.label.toLowerCase())}`).join(", ")}</li>
      </ul>
    </div>
    <div class="toolbar">
      <button class="btn btn--primary" data-act="export">Unduh CSV</button>
      <span class="hint" style="align-self:center;margin:0">Titik (·) berarti belum ditandai.</span>
    </div>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead>
          <tr>
            <th scope="col" class="col-no">No</th>
            <th scope="col" class="col-name">Nama</th>
            ${head}
            ${STATUSES.map((s) => `<th scope="col" class="tot" title="${esc(s.label)}">${esc(s.short)}</th>`).join("")}
            <th scope="col" class="tot tot--akhir">Hadir</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/* ---------- render: siswa ---------- */

function renderSiswa() {
  const node = el.views.siswa;

  if (!state.kelas) {
    node.innerHTML = emptyState("Isi nama kelas dulu", "Daftar siswa selalu terikat pada satu kelas. Isi kolom Kelas di atas, lalu kembali ke sini.");
    return;
  }

  const list = state.students.length
    ? `<ul class="daftar">${state.students
        .map(
          (s, i) => `
        <li>
          <span class="roll__no">${String(i + 1).padStart(2, "0")}</span>
          <span class="roll__who"><span class="roll__name">${esc(s.nama)}</span>${
            s.nis ? `<span class="roll__nis">${esc(s.nis)}</span>` : ""
          }</span>
          <button class="hapus" data-act="del-siswa" data-id="${esc(s.id)}" data-nama="${esc(
            s.nama
          )}">Hapus</button>
        </li>`
        )
        .join("")}</ul>`
    : `<p class="hint">Belum ada siswa di kelas ${esc(state.kelas)}.</p>`;

  node.innerHTML = `
    <div class="siswa-grid">
      <div class="panel">
        <h2>Tambah satu siswa</h2>
        <form data-form="siswa-satu">
          <div class="form-row">
            <label class="field">
              <span class="field__label">Nama</span>
              <input name="nama" required placeholder="Nama lengkap" autocomplete="off">
            </label>
            <label class="field">
              <span class="field__label">No / NIS</span>
              <input name="nis" placeholder="Opsional" autocomplete="off">
            </label>
          </div>
          <div class="form-actions">
            <button class="btn" type="submit">Tambah</button>
          </div>
        </form>

        <h2 style="margin-top:30px">Tambah banyak sekaligus</h2>
        <form data-form="siswa-banyak">
          <label class="field">
            <span class="field__label">Satu siswa per baris</span>
            <textarea name="bulk" placeholder="Ahmad Fauzi&#10;Siti Rahma; 12&#10;Bagas Pratama"></textarea>
          </label>
          <div class="form-actions">
            <button class="btn" type="submit">Tambah semua</button>
          </div>
          <p class="hint">Format tiap baris: <b>Nama</b> atau <b>Nama; No/NIS</b>. Nomor urut mengikuti urutan baris.</p>
        </form>
      </div>

      <div class="panel">
        <h2>Daftar ${esc(state.kelas)} (${state.students.length})</h2>
        ${list}
        <p class="hint">Menghapus siswa juga menghapus catatan absennya.</p>
      </div>
    </div>`;
}

/* ---------- render utama ---------- */

function render() {
  renderTabs();
  renderClasses();
  renderAbsen();
  renderRekap();
  renderSiswa();
  renderFooter();
}

/* ---------- pemuatan data ---------- */

async function loadClasses() {
  try {
    state.classes = await store.classes();
    if (!state.kelas && state.classes.length) {
      state.kelas = state.classes[0];
      el.kelas.value = state.kelas;
    }
    renderClasses();
  } catch (err) {
    toast(`Gagal memuat daftar kelas: ${err.message}`, true);
  }
}

async function loadAbsen() {
  if (!state.kelas) {
    state.students = [];
    state.session = null;
    state.marks = {};
    state.sessions = [];
    state.matrix = {};
    render();
    return;
  }

  try {
    state.students = await store.students(state.kelas);

    if (!state.students.length) {
      state.session = null;
      state.marks = {};
      state.sessions = [];
      state.matrix = {};
      render();
      return;
    }

    state.session = await store.findSession({ kelas: state.kelas, tanggal: state.tanggal });

    if (state.session) {
      const rows = await store.attendance(state.session.id);
      state.marks = Object.fromEntries(rows.map((r) => [r.student_id, r.status]));
    } else {
      // Sesi dibuat baru saat status pertama ditandai.
      state.marks = {};
    }

    // Jangan timpa kegiatan yang sedang diketik pengguna.
    if (document.activeElement === el.kegiatan) {
      state.kegiatan = el.kegiatan.value;
    } else {
      const kegiatan = (state.session && state.session.kegiatan) || "";
      if (el.kegiatan.value !== kegiatan) el.kegiatan.value = kegiatan;
      state.kegiatan = kegiatan;
    }
  } catch (err) {
    toast(`Gagal memuat absensi: ${err.message}`, true);
  }

  await loadSessions();
  render();
}

async function loadSessions() {
  if (!state.kelas) {
    state.sessions = [];
    state.matrix = {};
    return;
  }
  try {
    state.sessions = await store.sessions(state.kelas);
    const rows = await store.attendanceForSessions(state.sessions.map((s) => s.id));
    state.matrix = {};
    for (const row of rows) {
      state.matrix[row.session_id] = state.matrix[row.session_id] || {};
      state.matrix[row.session_id][row.student_id] = row.status;
    }
  } catch (err) {
    toast(`Gagal memuat rekap: ${err.message}`, true);
  }
}

/* ---------- aksi ---------- */

async function ensureActiveSession() {
  if (state.session) return state.session;

  state.session = await store.ensureSession({ kelas: state.kelas, tanggal: state.tanggal });

  const kegiatan = normKegiatan(state.kegiatan);
  if (kegiatan) {
    await store.updateSession(state.session.id, { kegiatan });
    state.session.kegiatan = kegiatan;
  }

  await loadSessions();
  renderFooter();
  return state.session;
}

async function setStatus(studentId, status) {
  if (!state.kelas || !state.students.length) return;
  const previous = state.marks[studentId];
  const next = previous === status ? null : status;

  state.marks[studentId] = next;
  if (!next) delete state.marks[studentId];

  paintRow(studentId);

  const button = el.views.absen.querySelector(
    `[data-row="${CSS.escape(studentId)}"] [data-status="${status}"]`
  );
  if (button && next) button.classList.add("is-stamp");

  try {
    const session = await ensureActiveSession();

    if (next) {
      await store.setMany(session.id, [{ student_id: studentId, status: next }]);
    } else {
      await store.removeOne(session.id, studentId);
    }

    stampSaved();
    state.matrix[session.id] = state.matrix[session.id] || {};
    if (next) state.matrix[session.id][studentId] = next;
    else delete state.matrix[session.id][studentId];
    renderFooter();
    if (state.view === "rekap") renderRekap();
  } catch (err) {
    if (previous) state.marks[studentId] = previous;
    else delete state.marks[studentId];
    paintRow(studentId);
    toast(`Gagal menyimpan: ${err.message}`, true);
  }
}

async function markAllHadir() {
  if (!state.kelas || !state.students.length) return;
  const entries = state.students.map((s) => ({ student_id: s.id, status: "hadir" }));
  entries.forEach((e) => (state.marks[e.student_id] = "hadir"));
  renderAbsen();
  try {
    const session = await ensureActiveSession();
    await store.setMany(session.id, entries);
    state.matrix[session.id] = Object.fromEntries(entries.map((e) => [e.student_id, e.status]));
    stampSaved();
    render();
  } catch (err) {
    toast(`Gagal menyimpan: ${err.message}`, true);
    await loadAbsen();
  }
}

async function clearSession() {
  if (!state.session) return;
  if (!confirm("Kosongkan semua tanda kehadiran pada sesi ini?")) return;
  try {
    await store.clearSession(state.session.id);
    state.marks = {};
    state.matrix[state.session.id] = {};
    stampSaved();
    render();
  } catch (err) {
    toast(`Gagal mengosongkan sesi: ${err.message}`, true);
  }
}

async function addStudents(rows, sourceForm) {
  if (!rows.length) return;
  try {
    await store.addStudents(state.kelas, rows);
    if (sourceForm) sourceForm.reset();
    await loadClasses();
    await loadAbsen();
    stampSaved();
    toast(`${rows.length} siswa ditambahkan.`);
  } catch (err) {
    toast(`Gagal menambah siswa: ${err.message}`, true);
  }
}

async function removeStudent(id, nama) {
  if (!confirm(`Hapus ${nama} dari daftar kelas? Catatan absennya ikut terhapus.`)) return;
  try {
    await store.removeStudent(id);
    await loadAbsen();
    render();
    stampSaved();
  } catch (err) {
    toast(`Gagal menghapus: ${err.message}`, true);
  }
}

/* ---------- unduh CSV ---------- */

function exportCsv() {
  if (!state.sessions.length || !state.students.length) return;

  const sep = ";";
  const cell = (value) => {
    const text = String(value ?? "");
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = [
    "No",
    "Nama",
    "No/NIS",
    ...state.sessions.map((s) => `${fmtDate(s.tanggal)} ${s.kegiatan || "-"}`),
    ...STATUSES.map((s) => s.label),
    "Persen hadir"
  ];

  const lines = [header.map(cell).join(sep)];

  state.students.forEach((student, index) => {
    const marks = state.sessions.map((s) => (state.matrix[s.id] || {})[student.id] || "");
    const tally = STATUSES.map((s) => marks.filter((m) => m === s.id).length);
    const pct = state.sessions.length ? ((tally[0] / state.sessions.length) * 100).toFixed(1).replace(".", ",") : "0";

    lines.push(
      [
        index + 1,
        student.nama,
        student.nis || "",
        ...marks.map((m) => (m ? STATUS_MAP[m].short : "")),
        ...tally,
        `${pct}%`
      ]
        .map(cell)
        .join(sep)
    );
  });

  const slug = state.kelas.replace(/[^\w]+/g, "-").toLowerCase();
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rekap-absen-${slug}-${todayISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Berkas CSV diunduh.");
}

/* ---------- event ---------- */

document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (tab) {
    state.view = tab.dataset.view;
    render();
    return;
  }

  const trigger = event.target.closest("[data-act]");
  if (!trigger) return;

  const act = trigger.dataset.act;
  if (act === "status") setStatus(trigger.dataset.id, trigger.dataset.status);
  else if (act === "all-hadir") markAllHadir();
  else if (act === "clear-session") clearSession();
  else if (act === "export") exportCsv();
  else if (act === "del-siswa") removeStudent(trigger.dataset.id, trigger.dataset.nama);
  else if (act === "goto-siswa") {
    state.view = "siswa";
    render();
  } else if (act === "goto-absen") {
    state.view = "absen";
    render();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();

  if (form.dataset.form === "siswa-satu") {
    const data = new FormData(form);
    const nama = String(data.get("nama") || "").trim();
    if (!nama) return;
    addStudents([{ nama, nis: String(data.get("nis") || "").trim() }], form);
    return;
  }

  if (form.dataset.form === "siswa-banyak") {
    const raw = String(new FormData(form).get("bulk") || "");
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [nama, nis] = line.split(/[;\t]/);
        return { nama: nama.trim(), nis: (nis || "").trim(), urut: index + 1 };
      })
      .filter((r) => r.nama);
    if (!rows.length) return;
    addStudents(rows, form);
  }
});

document.querySelector(".tabs").addEventListener("keydown", (event) => {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const tabs = [...document.querySelectorAll(".tab")];
  const index = tabs.findIndex((t) => t.dataset.view === state.view);
  const next = tabs[(index + step + tabs.length) % tabs.length];
  state.view = next.dataset.view;
  render();
  document.getElementById(`tab-${state.view}`).focus();
});

let inputTimer = 0;
function scheduleReload(delay = 650) {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(async () => {
    await loadAbsen();
  }, delay);
}

let kegiatanTimer = 0;
function scheduleKegiatanSave() {
  clearTimeout(kegiatanTimer);
  kegiatanTimer = setTimeout(async () => {
    if (!state.session) return;
    const kegiatan = normKegiatan(state.kegiatan);
    if ((state.session.kegiatan || null) === kegiatan) return;
    try {
      await store.updateSession(state.session.id, { kegiatan });
      state.session.kegiatan = kegiatan;
      const row = state.sessions.find((s) => s.id === state.session.id);
      if (row) row.kegiatan = kegiatan;
      stampSaved();
      if (state.view === "rekap") renderRekap();
    } catch (err) {
      toast(`Gagal menyimpan kegiatan: ${err.message}`, true);
    }
  }, 700);
}

el.kelas.addEventListener("input", () => {
  state.kelas = el.kelas.value.trim();
  localStorage.setItem("absen.kelas", state.kelas);
  scheduleReload();
});

el.tanggal.addEventListener("change", () => {
  state.tanggal = el.tanggal.value || todayISO();
  localStorage.setItem("absen.tanggal", state.tanggal);
  state.marks = {};
  loadAbsen();
});

el.kegiatan.addEventListener("input", () => {
  state.kegiatan = el.kegiatan.value;
  scheduleKegiatanSave();
});

/* ---------- mulai ---------- */

async function boot() {
  const client = await resolveConnection();
  if (client) {
    store = supabaseStore(client);
    modeNote = "Terhubung ke <b>Supabase</b>. Data bisa dibuka dari perangkat lain.";
  } else {
    modeNote = "Mode lokal: data tersimpan di browser ini saja.";
  }
  el.storeNote.innerHTML = modeNote;

  el.kelas.value = localStorage.getItem("absen.kelas") ?? DEFAULT_KELAS;
  state.kelas = el.kelas.value.trim();
  el.tanggal.value = localStorage.getItem("absen.tanggal") || state.tanggal;
  state.tanggal = el.tanggal.value;

  render();
  await loadClasses();
  await loadAbsen();
}

boot();
