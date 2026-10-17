require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { q, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const CATS = ['imggen','nlp','audio','video','vision','coding','agent','data','llm'];

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ---- pengunjung anonim: cookie → baris user permanen di Neon ---- */
app.use(async (req, res, next) => {
  try {
    let uid = req.cookies.forge_uid;
    if (uid) {
      const ok = await q('SELECT id FROM users WHERE id = $1', [uid]);
      if (ok.length) { req.userId = uid; return next(); }
    }
    uid = crypto.randomUUID();
    await q('INSERT INTO users (id) VALUES ($1)', [uid]);
    res.cookie('forge_uid', uid, { maxAge: 10 * 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax' });
    req.userId = uid; next();
  } catch (e) { next(e); }
});

/* ---- unggahan berkas: disimpan DI DALAM database (bytea) ---- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /\.(apk|exe|msi|zip|aab)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new Error('Ekstensi tidak didukung — gunakan .apk / .exe / .msi / .zip / .aab'))
});

function toolJSON(t) {
  const rc = t.rc || 0, avg = t.avg_r || 0;
  let v = t.base_rate, c = t.base_rc;
  if (rc) { v = (t.base_rate * t.base_rc + avg * rc) / (t.base_rc + rc); c = t.base_rc + rc; }
  return {
    id: t.id, name: t.name, tagline: t.tagline, cat: t.cat,
    plat: (t.plat || '').split(',').filter(Boolean),
    price: t.price, disc: t.disc || 0, lic: t.lic, dev: t.dev,
    tags: (t.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    ver: t.ver, sizeMb: t.size_mb, downloads: t.downloads,
    hasFile: !!t.file_data, fileName: t.file_name, releaseUrl: t.release_url,
    rating: c ? Math.round(v * 100) / 100 : 0, ratingCount: c,
    description: t.description, createdAt: t.created_at
  };
}
const TOOL_FULL = `SELECT t.*, COALESCE(AVG(r.rate),0)::float AS avg_r, COUNT(r.id)::int AS rc
  FROM tools t LEFT JOIN reviews r ON r.tool_id = t.id`;

/* ================= API ================= */

app.get('/api/stats', async (req, res) => {
  try {
    const [t] = await q('SELECT COUNT(*)::int AS c FROM tools');
    const [r] = await q('SELECT COUNT(*)::int AS c FROM reviews');
    const [p] = await q('SELECT COUNT(*)::int AS c FROM purchases');
    const [u] = await q('SELECT COUNT(*)::int AS c FROM users');
    res.json({ tools: t.c, reviews: r.c, purchases: p.c, users: u.c,
      host: new URL(process.env.DATABASE_URL).hostname });
  } catch (e) { res.status(500).json({ error: 'Database tidak merespons' }); }
});

app.get('/api/tools', async (req, res) => {
  try {
    const rows = await q(TOOL_FULL + ' GROUP BY t.id ORDER BY t.created_at DESC');
    res.json(rows.map(toolJSON));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat tools' }); }
});

app.get('/api/tools/:id', async (req, res) => {
  try {
    const rows = await q(TOOL_FULL + ' WHERE t.id = $1 GROUP BY t.id', [+req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tool tidak ditemukan' });
    const reviews = await q('SELECT name, rate, text, created_at FROM reviews WHERE tool_id = $1 ORDER BY created_at DESC', [+req.params.id]);
    const owned = await q('SELECT id FROM purchases WHERE user_id = $1 AND tool_id = $2', [req.userId, +req.params.id]);
    res.json({ tool: toolJSON(rows[0]), reviews, owned: !!owned.length });
  } catch (e) { res.status(500).json({ error: 'Gagal memuat detail' }); }
});

app.post('/api/tools', upload.single('file'), async (req, res) => {
  try {
    const b = req.body;
    const name = (b.name || '').trim(), desc = (b.description || '').trim();
    const plats = [].concat(b.plat || []).filter(p => ['windows', 'android'].includes(p));
    if (name.length < 3) return res.status(400).json({ error: 'Nama tool minimal 3 karakter.' });
    if (!CATS.includes(b.cat)) return res.status(400).json({ error: 'Kategori tidak valid.' });
    if (!plats.length) return res.status(400).json({ error: 'Pilih minimal satu platform.' });
    if (desc.length < 20) return res.status(400).json({ error: 'Deskripsi minimal 20 karakter.' });
    if (!req.file && !(b.release_url || '').trim())
      return res.status(400).json({ error: 'Lampirkan berkas (maks 8 MB) atau tautan rilis.' });
    const price = b.price_mode === 'paid' ? Math.max(1, parseInt(b.price) || 99) * 1000 : 0;
    const rows = await q(
      `INSERT INTO tools (name,tagline,cat,plat,price,lic,dev,tags,ver,size_mb,downloads,file_data,file_name,file_mime,release_url,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'1.0.0',$9,0,$10,$11,$12,$13,$14) RETURNING *`,
      [name.slice(0, 60), (b.tagline || '').trim().slice(0, 120), b.cat, plats.join(','), price,
       ['MIT','Apache-2.0','GPL-3.0','MPL-2.0','Indie'].includes(b.lic) ? b.lic : 'MIT',
       (b.dev || 'Komunitas').trim().slice(0, 60) || 'Komunitas',
       (b.tags || '').slice(0, 120),
       req.file ? Math.max(1, Math.round(req.file.size / 1048576)) : 100,
       req.file ? req.file.buffer : null,
       req.file ? req.file.originalname : null,
       req.file ? (req.file.mimetype || 'application/octet-stream') : null,
       (b.release_url || '').trim() || null,
       desc.slice(0, 4000)]);
    res.status(201).json(toolJSON(rows[0]));
  } catch (e) { res.status(400).json({ error: e.message || 'Gagal menyimpan tool' }); }
});

app.post('/api/tools/:id/reviews', async (req, res) => {
  try {
    const t = (await q('SELECT id FROM tools WHERE id = $1', [+req.params.id]))[0];
    if (!t) return res.status(404).json({ error: 'Tool tidak ditemukan' });
    const name = (req.body.name || '').trim(), text = (req.body.text || '').trim();
    const rate = Math.min(5, Math.max(1, +req.body.rate || 0));
    if (name.length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter.' });
    if (text.length < 10) return res.status(400).json({ error: 'Ulasan minimal 10 karakter.' });
    if (!rate) return res.status(400).json({ error: 'Pilih rating 1–5.' });
    await q('INSERT INTO reviews (tool_id, name, rate, text) VALUES ($1,$2,$3,$4)',
      [t.id, name.slice(0, 24), rate, text.slice(0, 1000)]);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'Gagal menyimpan ulasan' }); }
});

app.get('/api/wishlist', async (req, res) => {
  const rows = await q('SELECT tool_id FROM wishlist WHERE user_id = $1', [req.userId]);
  res.json(rows.map(r => r.tool_id));
});
app.post('/api/wishlist/:id', async (req, res) => {
  const id = +req.params.id;
  const has = (await q('SELECT tool_id FROM wishlist WHERE user_id = $1 AND tool_id = $2', [req.userId, id]))[0];
  if (has) { await q('DELETE FROM wishlist WHERE user_id = $1 AND tool_id = $2', [req.userId, id]); return res.json({ in: false }); }
  await q('INSERT INTO wishlist (user_id, tool_id) VALUES ($1,$2)', [req.userId, id]);
  res.json({ in: true });
});

app.post('/api/checkout', async (req, res) => {
  try {
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'Tidak ada item.' });
    const order = 'FRG-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const items = [];
    for (const id of ids) {
      const t = (await q('SELECT * FROM tools WHERE id = $1', [id]))[0];
      if (!t) continue;
      const dup = (await q('SELECT id FROM purchases WHERE user_id = $1 AND tool_id = $2', [req.userId, id]))[0];
      if (dup) { items.push({ id, name: t.name, pricePaid: 0, note: 'sudah dimiliki' }); continue; }
      const paid = t.disc ? Math.round(t.price * (100 - t.disc) / 100 / 500) * 500 : t.price;
      await q('INSERT INTO purchases (order_id, user_id, tool_id, price_paid) VALUES ($1,$2,$3,$4)', [order, req.userId, id, paid]);
      items.push({ id, name: t.name, pricePaid: paid });
    }
    res.json({ order, items, total: items.reduce((s, i) => s + i.pricePaid, 0) });
  } catch (e) { res.status(500).json({ error: 'Checkout gagal' }); }
});

app.get('/api/library', async (req, res) => {
  const rows = await q(`SELECT p.order_id, p.price_paid, p.created_at AS bought, t.id
    FROM purchases p JOIN tools t ON t.id = p.tool_id
    WHERE p.user_id = $1 ORDER BY p.created_at DESC`, [req.userId]);
  const tools = await q(TOOL_FULL + ' GROUP BY t.id');
  const map = new Map(tools.map(t => [t.id, toolJSON(t)]));
  res.json(rows.map(r => ({ ...map.get(r.id), orderId: r.order_id, pricePaid: r.price_paid, bought: r.bought })));
});

app.get('/api/download/:id', async (req, res) => {
  try {
    const t = (await q('SELECT * FROM tools WHERE id = $1', [+req.params.id]))[0];
    if (!t) return res.status(404).json({ error: 'Tool tidak ditemukan' });
    const owned = (await q('SELECT id FROM purchases WHERE user_id = $1 AND tool_id = $2', [req.userId, t.id]))[0];
    if (!owned) return res.status(403).json({ error: 'Miliki tool ini dulu (Dapatkan / beli).' });
    if (!t.file_data) return res.status(409).json({ error: 'Tool contoh tanpa berkas nyata — unggah tool untuk mencoba unduhan sungguhan.' });
    await q('UPDATE tools SET downloads = downloads + 1 WHERE id = $1', [t.id]);
    res.setHeader('Content-Disposition', 'attachment; filename="' + String(t.file_name || 'tool.bin').replace(/["\\]/g, '') + '"');
    res.setHeader('Content-Type', t.file_mime || 'application/octet-stream');
    res.send(Buffer.from(t.file_data));
  } catch (e) { res.status(500).json({ error: 'Gagal mengunduh' }); }
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Kesalahan permintaan.' });
  next();
});

init().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  FORGE + Neon siap  →  port ' + PORT);
    console.log('  Database permanen  →  ' + new URL(process.env.DATABASE_URL).hostname);
    console.log('  Semua data tersimpan di Neon PostgreSQL.\n');
  });
}).catch(e => {
  console.error('\n  Gagal terhubung ke Neon: ' + e.message);
  process.exit(1);
});
