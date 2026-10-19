// Vercel Function: membagikan kredensial Supabase ke browser.
//
// Dipakai kalau config.js dibiarkan kosong. Set dua environment variable
// di Vercel (Project Settings > Environment Variables):
//
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//
// anon key memang dirancang untuk dipakai di sisi browser. Keamanan data
// bergantung pada Row Level Security di tabel Supabase, bukan pada
// kerahasiaan kunci ini.

module.exports = function handler(_req, res) {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_ANON_KEY || "";

  res.setHeader("Cache-Control", "public, max-age=300");

  if (!url || !key) {
    res.status(200).json({ configured: false });
    return;
  }

  res.status(200).json({ configured: true, url, key });
};
