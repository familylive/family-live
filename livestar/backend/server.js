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
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIVim8Hu9raqSQ';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '6Le1bVEjKpwJCxqpfVuK1CibDLSHpfMn7fJIyn3qd6cC';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://familylive-vitm3l6f.livekit.cloud/';

// In-memory fallback when DATABASE_URL missing OR unreachable (app always works)
let mem = { users: [], broadcasts: [], gifts: [], tx: [] };
let useDb = false;
const dbUrl = (process.env.DATABASE_URL || '').trim();
console.log('🔌 24 DATABASE_URL:', dbUrl ? 'YES (host ' + (dbUrl.match(/@([^\/]+)/) || ['','?'])[1] + ')' : 'NO ❌');
let pool = null;
if (dbUrl) {
  try {
    pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
    useDb = true;
  } catch(e) { useDb = false; }
}
let dbFailCount = 0;
async function q(sql, p = []) {
  if (!useDb) return [];
  try { const r = await pool.query(sql, p); dbFailCount = 0; return r.rows; }
  catch(e) {
    dbFailCount++;
    if (dbFailCount > 10) { useDb = false; console.log('💾 تحول للذاكرة المؤقتة (إخفاقات متكررة)'); }
    return [];
  }
}
async function q1(sql, p = []) {
  if (!useDb) return null;
  try { const r = await pool.query(sql, p); dbFailCount = 0; return r.rows[0] || null; }
  catch(e) {
    dbFailCount++;
    if (dbFailCount > 10) { useDb = false; console.log('💾 تحول للذاكرة المؤقتة (إخفاقات متكررة)'); }
    return null;
  }
}

async function initDb() {
  if (!useDb) { console.log('💾 24 يعمل بذاكرة مؤقتة (بدون قاعدة) - أضف DATABASE_URL للتخزين الدائم'); return; }
  // Test the connection quickly; if unreachable -> fall back to memory
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout')), 60000))
      ]);
      break;
    } catch(e) {
      if (attempt === 6) {
        useDb = false;
        console.log('💾 قاعدة البيانات غير متاحة - يعمل بذاكرة مؤقتة (' + e.message + ')');
        return;
      }
      console.log('⏳ محاولة الاتصال ' + attempt + '... (' + e.message + ')');
      await new Promise(r => setTimeout(r, 5000));
    }
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
  // إعادة تعيين البثوث القديمة العالقة (بداية جديدة لكل إقلاع)
  try { await pool.query("UPDATE broadcasts SET status='ended' WHERE status='live'"); } catch(e) {}
  console.log('✅ 24 DB ready');
}
const dbReady = initDb().catch(e => { console.log('DB error:', e.message); });

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
  at.addGrant({ roomJoin: true, room, canPublish: true, canPublishData: true, canSubscribe: true });
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
  let bs = [];
  if (useDb) bs = await q(`SELECT b.*, u.name as host_name, u.avatar as host_avatar FROM broadcasts b JOIN users u ON b.host_id=u.id WHERE b.status='live'`);
  else bs = mem.broadcasts.filter(b => b.status === 'live');
  const list = bs.map(b => ({ ...b, support: rooms[b.id]?.support || 0, hearts: rooms[b.id]?.hearts || 0 }));
  list.sort((a, b) => (b.support || 0) - (a.support || 0)); // الترند أولاً
  res.json({ broadcasts: list, top5: list.slice(0, 5) });
}));

// Bot starts a fake broadcast
app.post('/api/bot/broadcast', ah(async (req, res) => {
  // نفتح بثاً وهمياً لبوت متاح (يعمل في الوضعين)
  let live, allBots, bot;
  if (useDb) {
    live = await q("SELECT id FROM broadcasts WHERE status='live'");
    if (live.length >= 10) return res.json({ message: 'مليان', count: live.length });
    const used = new Set(live.map(b => b.id ? b.host_id : b.id));
    allBots = await q("SELECT * FROM users WHERE id LIKE 'bot_%'");
    bot = allBots.find(u => !used.has(u.id));
    if (!bot) return res.json({ message: 'لا بوتات متاحة', count: live.length });
    const id = uuidv4();
    const room = uuidv4().slice(0, 8);
    await q("INSERT INTO broadcasts (id, room_name, host_id, title, status) VALUES ($1,$2,$3,$4,'live')", [id, room, bot.id, 'بث ' + bot.name]);
    if (!rooms[id]) rooms[id] = { viewers: new Map(), hearts: Math.floor(Math.random()*3000), support: Math.floor(Math.random()*12) };
    return res.json({ message: '🎬 ' + bot.name + ' بدأ بثاً', count: live.length + 1 });
  } else {
    live = mem.broadcasts.filter(b => b.status === 'live');
    if (live.length >= 10) return res.json({ message: 'مليان', count: live.length });
    const usedHosts = new Set(live.map(b => b.host_id));
    const bot = mem.users.find(u => u.id.startsWith('bot_') && !usedHosts.has(u.id));
    if (!bot) return res.json({ message: 'لا بوتات متاحة', count: live.length });
    const id = uuidv4();
    const room = uuidv4().slice(0, 8);
    mem.broadcasts.push({ id, room_name: room, host_id: bot.id, title: 'بث ' + bot.name, status: 'live', started_at: new Date().toISOString(), host_name: bot.name, host_avatar: bot.avatar });
    if (!rooms[id]) rooms[id] = { viewers: new Map(), hearts: Math.floor(Math.random()*3000), support: Math.floor(Math.random()*12) };
    return res.json({ message: '🎬 ' + bot.name + ' بدأ بثاً', count: mem.broadcasts.filter(b=>b.status==='live').length });
  }
}));

// ============ STORE (شراء كونزات - تجريبي) ============
app.post('/api/store/buy', auth, ah(async (req, res) => {
  const { coins } = req.body;
  const amount = parseInt(coins);
  const allowed = [1000, 5000, 10000, 25000];
  if (!allowed.includes(amount)) return res.status(400).json({ error: 'الباقة غير متاحة' });
  await q('UPDATE users SET coins=coins+$1 WHERE id=$2', [amount, req.user.id]);
  await q("INSERT INTO coin_tx (id, user_id, coins, type, detail) VALUES ($1,$2,$3,'store_buy',$4)", [uuidv4(), req.user.id, amount, 'شراء من المتجر']);
  const me = await q1('SELECT coins FROM users WHERE id=$1', [req.user.id]);
  res.json({ message: '🪙 اشتريت ' + amount + ' كونزه', coins: me.coins });
}));

// ============ COINS & GIFTS ============
app.post('/api/gift', auth, ah(async (req, res) => {
  const { toId, coins, emoji } = req.body;
  const amount = parseInt(coins) || 0;
  if (!toId || amount < 0) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (amount > 0) {
    const u = await q1('SELECT coins FROM users WHERE id=$1', [req.user.id]);
    if (!u || u.coins < amount) return res.status(400).json({ error: 'رصيدك لا يكفي' });
    await q('UPDATE users SET coins=coins-$1 WHERE id=$2', [amount, req.user.id]);
    await q('UPDATE users SET coins=coins+$1 WHERE id=$2', [amount, toId]);
    await q("INSERT INTO coin_tx (id, user_id, coins, type, detail) VALUES ($1,$2,$3,'gift_out',$4)", [uuidv4(), req.user.id, amount, 'هدية']);
  }
  await q('INSERT INTO gifts (id, from_user, to_user, coins, emoji) VALUES ($1,$2,$3,$4,$5)', [uuidv4(), req.user.id, toId, amount, emoji || '🎁']);
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

// ============ BOT BROADCASTS (تظاهر للتجربة) ============
const BOT_NAMES = ['فارس', 'سعود', 'نورة', 'ريم', 'خالد', 'لمى', 'يوسف', 'سارة', 'عمر', 'هند'];
async function seedBots() {
  BOT_NAMES.forEach(async (n, i) => {
    const uid = 'bot_' + i;
    if (useDb) {
      const ex = await q1('SELECT id FROM users WHERE id=$1', [uid]);
      if (!ex) await q('INSERT INTO users (id, name, email, password, coins, followers) VALUES ($1,$2,$3,$4,100000,$5)', [uid, n, 'bot' + i + '@24.app', 'x', Math.floor(Math.random()*900)+100]);
    } else {
      if (!mem.users.find(u => u.id === uid)) {
        mem.users.push({ id: uid, name: n, email: 'bot' + i + '@24.app', password: 'x', coins: 100000, avatar: '👤', followers: Math.floor(Math.random()*900)+100 });
      }
    }
  });
}
setTimeout(() => seedBots().then(() => {}), 1500);
setTimeout(() => seedBots().then(() => {}), 90000);

// ============ SOCKETS ============
const rooms = {}; // room -> { viewers: Map, hearts, support }
const HEARTS_PER_COIN = 500;
io.on('connection', (socket) => {
  socket.on('join_broadcast', ({ id, name }) => {
    socket.join('broadcast_' + id);
    if (!rooms[id]) rooms[id] = { viewers: new Map(), hearts: 0, support: 0 };
    rooms[id].viewers.set(socket.id, name || 'زائر');
    const names = [...rooms[id].viewers.values()];
    io.to('broadcast_' + id).emit('viewers', rooms[id].viewers.size);
    io.to('broadcast_' + id).emit('viewers_list', names);
  });
  socket.on('leave_broadcast', ({ id }) => {
    socket.leave('broadcast_' + id);
    if (rooms[id]) { rooms[id].viewers.delete(socket.id); io.to('broadcast_' + id).emit('viewers', rooms[id].viewers.size); io.to('broadcast_' + id).emit('viewers_list', [...rooms[id].viewers.values()]); }
  });
  socket.on('chat', (d) => { io.to('broadcast_' + d.id).emit('chat', d); });
  socket.on('heart', async (d) => {
    if (!rooms[d.id]) return;
    rooms[d.id].hearts = (rooms[d.id].hearts || 0) + 1;
    const hearts = rooms[d.id].hearts;
    // كل 500 تكبيسة = +1 كونزه لصاحب البث
    if (hearts % HEARTS_PER_COIN === 0) {
      rooms[d.id].support = (rooms[d.id].support || 0) + 1;
      try {
        const b = await q1('SELECT host_id FROM broadcasts WHERE id=$1 AND status=\'live\'', [d.id]);
        if (b) { await q('UPDATE users SET coins=coins+1 WHERE id=$1', [b.host_id]); }
      } catch(e) {}
      io.to('broadcast_' + d.id).emit('support', { support: rooms[d.id].support });
    }
    io.to('broadcast_' + d.id).emit('heart', d);
    io.to('broadcast_' + d.id).emit('hearts_count', hearts);
  });
  socket.on('gift', (d) => { io.to('broadcast_' + d.id).emit('gift', d); });
  // Host invites a viewer to join as guest (camera)
  socket.on('invite_guest', ({ id, viewerName, hostName, room }) => {
    if (!rooms[id]) return;
    let target = null;
    for (const [sid, name] of rooms[id].viewers.entries()) { if (name === viewerName) { target = sid; break; } }
    if (target) io.to(target).emit('guest_invite', { id, room, hostName });
  });
});

// فتح 10 بثوث روبوت تلقائياً بعد الإقلاع
async function openBotBroadcasts() {
  await dbReady; // انتظر جاهزية القاعدة أولاً
  try {
    let count = 0;
    for (let i = 0; i < 10; i++) {
      const r = await fetch('http://localhost:' + (process.env.PORT || 10001) + '/api/bot/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json()).catch(() => ({}));
      if (r.count) count = r.count;
    }
    console.log('🤖 بثوث الروبوت: ' + count);
  } catch(e) { console.log('Bot error:', e.message); }
}
// فتح البثوث بعد جاهزية القاعدة (مع حد أقصى 90 ثانية)
setTimeout(openBotBroadcasts, 1500);
setTimeout(openBotBroadcasts, 120000);

process.on('unhandledRejection', (r) => console.log('⚠️', r?.message || r));
process.on('uncaughtException', (e) => console.log('⚠️', e.message));

const PORT = process.env.PORT || 10001;
server.listen(PORT, () => console.log('🎬 24 live on ' + PORT));
