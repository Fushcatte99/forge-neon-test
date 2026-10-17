require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n  DATABASE_URL belum diatur.');
  console.error('  Di Render: Settings > Environment > tambahkan variabel DATABASE_URL.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

/* ---------- SKEMA: dibuat otomatis sekali di Neon ---------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tools (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT DEFAULT '',
  cat TEXT NOT NULL,
  plat TEXT NOT NULL,
  price INTEGER DEFAULT 0,
  disc INTEGER DEFAULT 0,
  lic TEXT DEFAULT 'MIT',
  dev TEXT DEFAULT 'Komunitas',
  tags TEXT DEFAULT '',
  ver TEXT DEFAULT '1.0.0',
  size_mb INTEGER DEFAULT 100,
  base_rate REAL DEFAULT 0,
  base_rc INTEGER DEFAULT 0,
  downloads INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  file_data BYTEA,
  file_name TEXT,
  file_mime TEXT,
  release_url TEXT,
  description TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id TEXT NOT NULL,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tool_id)
);
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  price_paid INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_tool ON reviews(tool_id);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
`;

/* ---------- DATA AWAL: hanya bila tabel tools kosong ---------- */
const SEED_TOOLS = [
  ['PikselNusa','Studio gambar AI generatif yang berjalan 100% offline di GPU lokal.','imggen','windows',0,0,'MIT','Kolektif Tanah Air','stable-diffusion,offline,batch','2.4.1',1840,4.8,214,4123,
   'Studio text-to-image lengkap: manajemen model, LoRA, dan antrian render batch. Semua inferensi terjadi di GPU-mu. (Entri contoh — tanpa berkas unduhan.)'],
  ['OtakLokal','Antarmuka elegan untuk menjalankan LLM apa pun di komputermu.','llm','windows',0,0,'MIT','Dapur Model','llama-cpp,privasi,model-manager','5.2.3',120,4.9,298,3026,
   'Membungkus llama.cpp dengan manajer model, obrolan multi-dokumen, dan API server lokal. Semuanya offline. (Entri contoh — tanpa berkas unduhan.)'],
  ['GemaSuara','Kloning suara & TTS berkualitas studio tanpa cloud.','audio','windows',249000,15,'Indie','Rumah Narasi','tts,kloning-suara','3.1.2',980,4.5,92,964,
   'Rekam 60 detik referensi suara, lalu bangkitkan narasi berkualitas studio langsung di mesin lokal. (Entri contoh — tanpa berkas unduhan.)'],
  ['LisanKita','Perkakas NLP bahasa Indonesia, dari tokenisasi sampai sentimen.','nlp','windows,android',0,0,'Apache-2.0','Yayasan Bahasa Terbuka','bahasa-indonesia,sentimen','1.8.0',640,4.7,187,3881,
   'Toolkit NLP untuk bahasa Indonesia: tokenisasi, POS-tagging, frasa kunci, dan analisis sentimen. (Entri contoh — tanpa berkas unduhan.)'],
  ['WayangVision','Deteksi objek real-time sepenuhnya di perangkat Android.','vision','android',0,0,'GPL-3.0','Lab Layar','deteksi-objek,realtime','1.5.0',220,4.4,110,1758,
   'Model deteksi ringan yang berjalan di kamera ponsel tanpa internet — 30 FPS di kelas menengah. (Entri contoh — tanpa berkas unduhan.)'],
  ['RantaiKerja','Kanvas visual untuk merangkai layanan dan model jadi pipeline.','agent','windows',149000,20,'Indie','Pabrik Alur','workflow,integrasi','3.0.2',380,4.4,37,449,
   'Menyambungkan 140+ konektor dalam kanvas alur yang jelas, dengan pemicu jadwal/webhook. (Entri contoh — tanpa berkas unduhan.)'],
  ['KanvasGerak','Pipeline video AI untuk pembuat film indie.','video','windows',549000,30,'Indie','Kolektif Sinema','video-ai,upscale','3.5.1',3400,4.5,65,389,
   'Text-to-video, interpolasi frame, dan upscale 4K dalam satu timeline. (Entri contoh — tanpa berkas unduhan.)'],
  ['DataSawah','Kelola, beri label, dan bagikan dataset dari satu tempat.','data','windows,android',0,0,'CC-BY-4.0','Koperasi Data','dataset,labeling','2.3.0',210,4.6,98,1563,
   'Versi dataset, anotasi kolaboratif, dan ekspor ke format pelatihan populer. (Entri contoh — tanpa berkas unduhan.)'],
  ['TukangKode','Tinjau kode otomatis yang menjelaskan alasannya.','coding','windows,android',79000,25,'Indie','Bengkel Review','review-kode,pr','1.8.0',240,4.4,46,672,
   'Membaca pull request, menandai risiko, dan menyarankan perbaikan yang bisa ditindaklanjuti. (Entri contoh — tanpa berkas unduhan.)'],
];
const SEED_REVIEWS = {
  'PikselNusa': [['Bagas P.',5,'Berjalan mulus di laptop kentang saya. Benar-benar mengubah cara kerja saya.'],['Rina W.',4,'Fitur lengkap, tapi batch besar butuh GPU lumayan.']],
  'OtakLokal': [['Dewa A.',5,'Privasi terjaga dan responsif — wajib punya.'],['Sari K.',5,'Manajer modelnya paling rapi yang pernah saya coba.']],
  'GemaSuara': [['Yoga M.',4,'Kualitas suaranya mengagetkan untuk ukuran lokal.'],['Intan P.',4,'Editor prosodi bisa lebih intuitif.']],
};

async function seed() {
  const { c } = (await q('SELECT COUNT(*)::int AS c FROM tools'))[0];
  if (c > 0) return; // sudah ada data — jangan timpa data pengguna
  for (const t of SEED_TOOLS) {
    const rows = await q(
      `INSERT INTO tools (name,tagline,cat,plat,price,disc,lic,dev,tags,ver,size_mb,base_rate,base_rc,downloads,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, t);
    for (const [name, rate, text] of (SEED_REVIEWS[t[0]] || [])) {
      await q('INSERT INTO reviews (tool_id,name,rate,text) VALUES ($1,$2,$3,$4)', [rows[0].id, name, rate, text]);
    }
  }
  console.log('  Data awal dimasukkan ke Neon.');
}

async function init() {
  await q(SCHEMA);
  await seed();
}

module.exports = { pool, q, init };
