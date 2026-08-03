const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const JWT_SECRET = process.env.JWT_SECRET || 'livestar-24-secret';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIj9zp2ZvZviH6';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '7VL0TwtiCnACUWA3h604mL4d9EInFjULZ2EdOrDoE4P';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://familylive-vitm3l6f.livekit.cloud/';

// In-memory fallback when DATABASE_URL missing OR unreachable (app always works)
let mem = { users: [], broadcasts: [], gifts: [], tx: [] };
let useDb = false;
const dbUrl = (process.env.DATABASE_URL || '').trim();
let pool = null;
if (dbUrl) {
  try {
    pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    useDb = true;
  } catch(e) { useDb = false; }
}
async function q(sql, p = []) { if (!useDb) return []; const r = await pool.query(sql, p); return r.rows; }
async function q1(sql, p = []) { if (!useDb) return null; const r = await pool.query(sql, p); return r.rows[0] || null; }

async function initDb() {
  if (!useDb) { console.log('💾 24 يعمل بذاكرة مؤقتة (بدون قاعدة) - أضف DATABASE_URL للتخزين الدائم'); return; }
  // Test the connection quickly; if unreachable -> fall back to memory
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 5000))
    ]);
  } catch(e) {
    useDb = false;
    console.log('💾 قاعدة البيانات غير متاحة - يعمل بذاكرة مؤقتة (' + e.message + ')');
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    coins INTEGER DEFAULT 0, avatar TEXT DEFAULT '👤', followers INTEGER DEFAULT 0, created_at TEXT DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY, room_name TEXT NOT NULL, host_id TEXT NOT NULL, title TEXT DEFAULT '',
    status TEXT DEFAULT 'live', started_at TEXT DEFAULT now(), ended_at TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS gifts (
    id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT NOT NULL, coins INTEGER NOT NULL,
    emoji TEXT DEFAULT '🎁', created_at TEXT DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS coin_tx (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, coins INTEGER DEFAULT 0, type TEXT, detail TEXT, created_at TEXT DEFAULT now()
  )`);
  console.log('✅ 24 DB ready');
}
initDb().catch(e => { console.log('DB error:', e.message); });

// Memory helpers (when no DB)
function memUsers() { return useDb ? [] : mem.users; }
function findUserByEmail(email) { return useDb ? null : mem.users.find(u => u.email.toLowerCase() === (email||'').toLowerCase()); }
function findUserById(id) { return useDb ? null : mem.users.find(u => u.id === id); }

function auth(req, res, next) {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ error: 'توكن غير موجود' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'توكن غير صالح' }); }
}
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============ AUTH ============
app.post('/api/auth/register', ah(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'املأ جميع الحقول' });
  let ex = await q1('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
  if (useDb && ex) return res.status(400).json({ error: 'البريد مسجل مسبقاً' });
  if (!useDb && findUserByEmail(email)) return res.status(400).json({ error: 'البريد مسجل مسبقاً' });
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 10);
  if (useDb) await q('INSERT INTO users (id, name, email, password, coins) VALUES ($1,$2,$3,$4,1000)', [id, name, email, hashed]);
  else mem.users.push({ id, name, email, password: hashed, coins: 1000, avatar: '👤', followers: 0 });
  const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id, name, email, coins: 1000, avatar: '👤', followers: 0 } });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body;
  const u = useDb ? await q1('SELECT * FROM users WHERE lower(email)=lower($1)', [email]) : findUserByEmail(email);
  if (!u || !bcrypt.compareSync(password, u.password)) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
  const token = jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, coins: u.coins, avatar: u.avatar, followers: u.followers } });
}));

app.get('/api/me', auth, ah(async (req, res) => {
  const u = await q1('SELECT id, name, email, coins, avatar, followers FROM users WHERE id=$1', [req.user.id]);
  res.json({ user: u });
}));

// ============ LIVEKIT ============
app.post('/api/livekit/token', auth, ah(async (req, res) => {
  const { room, role } = req.body;
  if (!room) return res.status(400).json({ error: 'اسم الغرفة مطلوب' });
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: req.user.id + '_' + (role === 'host' ? 'h' : 'v'), name: req.user.name, ttl: '4h' });
  at.addGrant({ roomJoin: true, room, canPublish: true, canPublishData: true, canSubscribe: true, canPublishSources: ['camera','microphone'] });
  res.json({ token: await at.toJwt(), url: LIVEKIT_URL, role });
}));

// ============ BROADCASTS ============
app.post('/api/broadcast/start', auth, ah(async (req, res) => {
  const { title } = req.body;
  const room = uuidv4().slice(0, 8);
  const id = uuidv4();
  await q('INSERT INTO broadcasts (id, room_name, host_id, title, status) VALUES ($1,$2,$3,$4,$5)', [id, room, req.user.id, title || 'بث جديد', 'live']);
  res.json({ id, room });
}));
app.post('/api/broadcast/stop', auth, ah(async (req, res) => {
  const { id } = req.body;
  await q("UPDATE broadcasts SET status='ended', ended_at=now() WHERE id=$1", [id]);
  io.to('broadcast_' + id).emit('broadcast_ended');
  res.json({ ok: true });
}));
app.get('/api/broadcasts', ah(async (req, res) => {
  const bs = await q(`SELECT b.*, u.name as host_name, u.avatar as host_avatar FROM broadcasts b JOIN users u ON b.host_id=u.id WHERE b.status='live' ORDER BY b.started_at DESC`);
  res.json({ broadcasts: bs });
}));

// ============ COINS & GIFTS ============
app.post('/api/gift', auth, ah(async (req, res) => {
  const { toId, coins, emoji } = req.body;
  const amount = parseInt(coins);
  if (!toId || !amount || amount <= 0) return res.status(400).json({ error: 'بيانات ناقصة' });
  const u = await q1('SELECT coins FROM users WHERE id=$1', [req.user.id]);
  if (!u || u.coins < amount) return res.status(400).json({ error: 'رصيدك لا يكفي' });
  await q('UPDATE users SET coins=coins-$1 WHERE id=$2', [amount, req.user.id]);
  await q('UPDATE users SET coins=coins+$1 WHERE id=$2', [amount, toId]);
  await q('INSERT INTO gifts (id, from_user, to_user, coins, emoji) VALUES ($1,$2,$3,$4,$5)', [uuidv4(), req.user.id, toId, amount, emoji || '🎁']);
  await q("INSERT INTO coin_tx (id, user_id, coins, type, detail) VALUES ($1,$2,$3,'gift_out',$4)", [uuidv4(), req.user.id, amount, 'هدية']);
  const me = await q1('SELECT coins FROM users WHERE id=$1', [req.user.id]);
  res.json({ message: '🎁 أرسلت هدية!', coins: me.coins });
}));

// ============ ADMIN (صفحة الإدارة) ============
const ADMIN_EMAILS = ['admin@familylive.com'];
function isAdmin(email) { return ADMIN_EMAILS.includes((email || '').toLowerCase()); }

app.get('/api/admin/broadcasts', auth, ah(async (req, res) => {
  const u = await q1('SELECT email FROM users WHERE id=$1', [req.user.id]);
  if (!isAdmin(u?.email)) return res.status(403).json({ error: 'لست إدارة' });
  res.json({ broadcasts: await q(`SELECT b.*, u.name as host_name FROM broadcasts b JOIN users u ON b.host_id=u.id WHERE b.status='live'`) });
}));
app.post('/api/admin/broadcast/stop', auth, ah(async (req, res) => {
  const u = await q1('SELECT email FROM users WHERE id=$1', [req.user.id]);
  if (!isAdmin(u?.email)) return res.status(403).json({ error: 'لست إدارة' });
  await q("UPDATE broadcasts SET status='ended', ended_at=now() WHERE id=$1", [req.body.id]);
  io.to('broadcast_' + req.body.id).emit('broadcast_ended');
  res.json({ message: '⏹️ أوقفت البث' });
}));
app.get('/api/admin/users', auth, ah(async (req, res) => {
  const u = await q1('SELECT email FROM users WHERE id=$1', [req.user.id]);
  if (!isAdmin(u?.email)) return res.status(403).json({ error: 'لست إدارة' });
  res.json({ users: await q('SELECT id, name, email, coins, followers FROM users ORDER BY coins DESC LIMIT 50') });
}));
app.post('/api/admin/charge', auth, ah(async (req, res) => {
  const u = await q1('SELECT email FROM users WHERE id=$1', [req.user.id]);
  if (!isAdmin(u?.email)) return res.status(403).json({ error: 'لست إدارة' });
  const coins = parseInt(req.body.coins);
  await q('UPDATE users SET coins=coins+$1 WHERE id=$2', [coins, req.body.userId]);
  await q("INSERT INTO coin_tx (id, user_id, coins, type, detail) VALUES ($1,$2,$3,'admin_charge',$4)", [uuidv4(), req.body.userId, coins, 'شحن إداري']);
  res.json({ message: '✅ شحنت ' + coins + ' كونزه' });
}));
app.get('/api/admin/gifts', auth, ah(async (req, res) => {
  const u = await q1('SELECT email FROM users WHERE id=$1', [req.user.id]);
  if (!isAdmin(u?.email)) return res.status(403).json({ error: 'لست إدارة' });
  res.json({ gifts: await q(`SELECT g.*, u.name as from_name FROM gifts g JOIN users u ON g.from_user=u.id ORDER BY g.created_at DESC LIMIT 50`) });
}));

// ============ SOCKETS ============
const rooms = {}; // room -> { viewers: Set }
io.on('connection', (socket) => {
  socket.on('join_broadcast', ({ id, name }) => {
    socket.join('broadcast_' + id);
    if (!rooms[id]) rooms[id] = { viewers: new Set() };
    rooms[id].viewers.add(name || 'زائر');
    io.to('broadcast_' + id).emit('viewers', rooms[id].viewers.size);
  });
  socket.on('leave_broadcast', ({ id, name }) => {
    socket.leave('broadcast_' + id);
    if (rooms[id]) { rooms[id].viewers.delete(name || 'زائر'); io.to('broadcast_' + id).emit('viewers', rooms[id].viewers.size); }
  });
  socket.on('chat', (d) => { io.to('broadcast_' + d.id).emit('chat', d); });
  socket.on('heart', (d) => { io.to('broadcast_' + d.id).emit('heart', d); });
  socket.on('gift', (d) => { io.to('broadcast_' + d.id).emit('gift', d); });
});

const PORT = process.env.PORT || 10001;
server.listen(PORT, () => console.log('🎬 24 live on ' + PORT));
