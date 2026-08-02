const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
function makePublicId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/family',
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function query(sql, params = []) {
  const r = await getPool().query(sql, params);
  return r.rows;
}
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}
async function run(sql, params = []) {
  await getPool().query(sql, params);
}
const queryAll = query;

async function getDb() { return getPool(); }

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, name TEXT NOT NULL, subscription_code TEXT NOT NULL UNIQUE, founder_id TEXT, status TEXT DEFAULT 'active', diwaniya_locked_until TEXT, diwaniya_lock_reason TEXT, diwaniya_locked_by TEXT, name_changed_at TEXT, name_changes_count INTEGER DEFAULT 0, diwaniya_capacity INTEGER DEFAULT 15, secret_room_enabled INTEGER DEFAULT 0, secret_room_purchased_at TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, phone TEXT, whatsapp TEXT, country TEXT, city TEXT, family_id TEXT, role TEXT DEFAULT 'member', avatar TEXT DEFAULT '👤', points INTEGER DEFAULT 0, stars INTEGER DEFAULT 0, moderator_tier TEXT DEFAULT 'none', last_seen TEXT, can_open_diwaniya INTEGER DEFAULT 0, currency TEXT DEFAULT 'sar', recording_attempts INTEGER DEFAULT 0, coins INTEGER DEFAULT 0, wallet INTEGER DEFAULT 0, created_at TEXT DEFAULT now())`);
  try { await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id TEXT'); } catch(e) {}
  // Backfill public_id for existing users + ensure unique
  try {
    const noId = await query("SELECT id FROM users WHERE public_id IS NULL OR public_id = ''");
    for (const u of noId) {
      let pid = makePublicId();
      let guard = 0;
      while (guard < 10 && (await queryOne('SELECT 1 FROM users WHERE public_id = $1', [pid]))) { pid = makePublicId(); guard++; }
      await run('UPDATE users SET public_id = $1 WHERE id = $2', [pid, u.id]);
    }
  } catch(e) {}
  try { await run('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS phone TEXT'); } catch(e) {}
  await run(`CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, email TEXT NOT NULL, invited_by TEXT NOT NULL, status TEXT DEFAULT 'pending', token TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS diwaniya_sessions (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, opened_by TEXT NOT NULL, opened_at TEXT DEFAULT now(), closed_at TEXT, duration_minutes INTEGER DEFAULT 30, status TEXT DEFAULT 'open', topic TEXT, mode TEXT DEFAULT 'text', capacity INTEGER DEFAULT 15, secret_code TEXT, video_limit INTEGER DEFAULT 6)`);
  await run(`CREATE TABLE IF NOT EXISTS diwaniya_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, game_type TEXT NOT NULL, challenger_id TEXT NOT NULL, opponent_id TEXT NOT NULL, status TEXT DEFAULT 'pending', winner_id TEXT, points INTEGER DEFAULT 10, challenger_score INTEGER DEFAULT 0, opponent_score INTEGER DEFAULT 0, created_at TEXT DEFAULT now(), completed_at TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS subscription_codes (code TEXT PRIMARY KEY, used INTEGER DEFAULT 0, family_id TEXT, type TEXT DEFAULT 'free', price INTEGER DEFAULT 0, purchased_by TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS user_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code TEXT NOT NULL, type TEXT DEFAULT 'free', purchase_date TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS user_families (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL, is_current INTEGER DEFAULT 0, joined_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS ads (id TEXT PRIMARY KEY, title TEXT NOT NULL, image_url TEXT, link_url TEXT, status TEXT DEFAULT 'active', position TEXT DEFAULT 'banner', start_time TEXT, end_time TEXT, views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS auctions (id TEXT PRIMARY KEY, code TEXT NOT NULL, starting_price INTEGER DEFAULT 100, entry_fee INTEGER DEFAULT 50, current_price INTEGER DEFAULT 100, min_increment INTEGER DEFAULT 10, start_time TEXT DEFAULT now(), end_time TEXT NOT NULL, status TEXT DEFAULT 'active', winner_id TEXT, paid INTEGER DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS auction_bids (id TEXT PRIMARY KEY, auction_id TEXT NOT NULL, user_id TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS auction_participants (id TEXT PRIMARY KEY, auction_id TEXT NOT NULL, user_id TEXT NOT NULL, paid_entry INTEGER DEFAULT 1, joined_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, created_by TEXT NOT NULL, title TEXT NOT NULL, content TEXT, announce_type TEXT DEFAULT 'text', target_user_id TEXT, event_time TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS banned_words (id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS bans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT, duration_hours INTEGER DEFAULT 24, banned_until TEXT, status TEXT DEFAULT 'active', created_by TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS agreements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT, role_at_agreement TEXT DEFAULT 'member', agreed INTEGER DEFAULT 0, agreed_at TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS moderator_visits (id TEXT PRIMARY KEY, moderator_id TEXT NOT NULL, moderator_name TEXT, diwaniya_session_id TEXT, family_id TEXT, reason TEXT NOT NULL, status TEXT DEFAULT 'requested', requested_at TEXT DEFAULT now(), scheduled_at TEXT, entered_at TEXT, exit_at TEXT, report TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS moderator_ratings (id TEXT PRIMARY KEY, moderator_id TEXT NOT NULL, visit_id TEXT, family_id TEXT, rating INTEGER NOT NULL, comment TEXT, rated_by TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS support_tickets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT, subject TEXT, message TEXT NOT NULL, status TEXT DEFAULT 'open', admin_reply TEXT, replied_at TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT, gateway TEXT NOT NULL, amount INTEGER NOT NULL, purpose TEXT, reference TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT now(), confirmed_at TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS violation_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT DEFAULT '🚫', status TEXT DEFAULT 'active', created_at TEXT DEFAULT now())`);
  try { await run("ALTER TABLE violations ADD COLUMN IF NOT EXISTS action TEXT"); } catch(e) {}
  try { await run("ALTER TABLE violations ADD COLUMN IF NOT EXISTS by_user_name TEXT"); } catch(e) {}
  await run(`CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '✨', css_class TEXT, price INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS user_effects (user_id TEXT NOT NULL, effect_id TEXT NOT NULL, purchased_at TEXT DEFAULT now(), PRIMARY KEY (user_id, effect_id))`);
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_effect TEXT"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS battle_wins INTEGER DEFAULT 0"); } catch(e) {}
  await run(`CREATE TABLE IF NOT EXISTS battles (id TEXT PRIMARY KEY, session_id TEXT, player_a_id TEXT, player_b_id TEXT, status TEXT DEFAULT 'pending', duration_minutes INTEGER DEFAULT 3, coins_a INTEGER DEFAULT 0, coins_b INTEGER DEFAULT 0, winner_id TEXT, start_time TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS diwaniya_restrictions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT DEFAULT 'restrict', created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS gift_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, emoji TEXT DEFAULT '🎁', coins INTEGER DEFAULT 10, price INTEGER DEFAULT 0, status TEXT DEFAULT 'active', gift_image TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS coin_packages (id TEXT PRIMARY KEY, coins INTEGER NOT NULL, price INTEGER NOT NULL, status TEXT DEFAULT 'active', created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS gifts (id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT NOT NULL, coins INTEGER NOT NULL, message TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS coin_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, coins INTEGER DEFAULT 0, amount INTEGER DEFAULT 0, detail TEXT, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS withdrawals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT, amount INTEGER NOT NULL, method TEXT DEFAULT 'stcpay', phone TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT now(), paid_at TEXT)`);
  await run(`CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, title TEXT NOT NULL, code_example TEXT, price INTEGER DEFAULT 0, features TEXT DEFAULT '[]', status TEXT DEFAULT 'active', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT now())`);
  await run(`CREATE TABLE IF NOT EXISTS capacity_purchases (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, capacity INTEGER NOT NULL, price INTEGER NOT NULL, purchased_at TEXT DEFAULT now())`);
  
  // Migrations for existing databases
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'sar'"); } catch(e) {}
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS stars INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS moderator_tier TEXT DEFAULT 'none'"); } catch(e) {}
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp TEXT"); } catch(e) {}
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS recording_attempts INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS diwaniya_capacity INTEGER DEFAULT 15"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS secret_room_enabled INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS secret_room_purchased_at TEXT"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS name_changed_at TEXT"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS name_changes_count INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS image TEXT"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS support_points INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE battles ADD COLUMN IF NOT EXISTS family_a_id TEXT"); } catch(e) {}
  try { await run("ALTER TABLE battles ADD COLUMN IF NOT EXISTS family_b_id TEXT"); } catch(e) {}
  try { await run("ALTER TABLE battles ADD COLUMN IF NOT EXISTS cross_family INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE battles ADD COLUMN IF NOT EXISTS victory_at TEXT"); } catch(e) {}
  try { await run("ALTER TABLE families ADD COLUMN IF NOT EXISTS description TEXT"); } catch(e) {}
  try { await run("ALTER TABLE diwaniya_sessions ADD COLUMN IF NOT EXISTS secret_code TEXT"); } catch(e) {}
  try { await run("ALTER TABLE diwaniya_sessions ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 15"); } catch(e) {}
  try { await run("ALTER TABLE diwaniya_sessions ADD COLUMN IF NOT EXISTS video_limit INTEGER DEFAULT 6"); } catch(e) {}
  try { await run("ALTER TABLE gift_items ADD COLUMN IF NOT EXISTS gift_image TEXT"); } catch(e) {}
  try { await run("ALTER TABLE gift_items ADD COLUMN IF NOT EXISTS price INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE ads ADD COLUMN IF NOT EXISTS start_time TEXT"); } catch(e) {}
  try { await run("ALTER TABLE ads ADD COLUMN IF NOT EXISTS end_time TEXT"); } catch(e) {}
  try { await run("ALTER TABLE ads ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0"); } catch(e) {}
  try { await run("ALTER TABLE ads ADD COLUMN IF NOT EXISTS clicks INTEGER DEFAULT 0"); } catch(e) {}
}

// =============== USERS & FAMILY ===============
async function createUser(name, email, password, familyId, role = 'member') {
  const id = uuidv4();
  const pid = makePublicId();
  await run('INSERT INTO users (id, name, email, password, family_id, role, public_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, name, email, password, familyId, role, pid]);
  return queryOne('SELECT id, name, email, family_id, role, points, avatar, created_at FROM users WHERE id = $1', [id]);
}
async function getUserByEmail(email) { return queryOne('SELECT * FROM users WHERE lower(email) = lower($1)', [email]); }
async function getUserById(id) { return queryOne('SELECT id, name, email, phone, whatsapp, country, city, family_id, role, avatar, points, stars, moderator_tier, can_open_diwaniya, last_seen, currency, public_id, created_at FROM users WHERE id = $1', [id]); }
async function getFamilyMembers(familyId) { return query('SELECT id, name, email, phone, whatsapp, role, avatar, points, public_id, last_seen, can_open_diwaniya FROM users WHERE family_id = $1 ORDER BY role DESC, points DESC', [familyId]); }
async function updateProfile(userId, data) {
  const { name, country, city, phone, whatsapp, avatar, currency } = data;
  if (name !== undefined) await run('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
  if (country !== undefined) await run('UPDATE users SET country = $1 WHERE id = $2', [country, userId]);
  if (city !== undefined) await run('UPDATE users SET city = $1 WHERE id = $2', [city, userId]);
  if (phone !== undefined) await run('UPDATE users SET phone = $1 WHERE id = $2', [phone, userId]);
  if (whatsapp !== undefined) await run('UPDATE users SET whatsapp = $1 WHERE id = $2', [whatsapp, userId]);
  if (avatar !== undefined) await run('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, userId]);
  if (currency !== undefined && ['sar','usd'].includes(currency)) await run('UPDATE users SET currency = $1 WHERE id = $2', [currency, userId]);
  return getUserById(userId);
}
async function updateLastSeen(userId) { await run("UPDATE users SET last_seen = now() WHERE id = $1", [userId]); }
async function updatePassword(email, newPassword) { await run('UPDATE users SET password = $1 WHERE email = $2', [newPassword, email]); }
async function userHasFamily(userId) { const u = await queryOne('SELECT family_id, role FROM users WHERE id = $1', [userId]); return !!(u && u.family_id && u.role === 'founder'); }

async function createFamily(name, subscriptionCode) {
  const id = uuidv4();
  const code = await queryOne('SELECT * FROM subscription_codes WHERE code = $1 AND (used = 0 OR used IS NULL)', [subscriptionCode]);
  if (!code) return null;
  await run('INSERT INTO families (id, name, subscription_code) VALUES ($1,$2,$3)', [id, name, subscriptionCode]);
  await run('UPDATE subscription_codes SET used = 1, family_id = $1 WHERE code = $2', [id, subscriptionCode]);
  return queryOne('SELECT * FROM families WHERE id = $1', [id]);
}
async function getFamily(id) { return queryOne('SELECT * FROM families WHERE id = $1', [id]); }
async function validateSubscriptionCode(code) { return queryOne('SELECT * FROM subscription_codes WHERE code = $1 AND (used = 0 OR used IS NULL)', [code]); }
async function updateFamilyFounder(familyId, userId) { await run('UPDATE families SET founder_id = $1 WHERE id = $2', [userId, familyId]); }
async function leaveFamily(userId) {
  const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user || !user.family_id) return { error: 'أنت لست في عائلة' };
  const family = await queryOne('SELECT * FROM families WHERE id = $1', [user.family_id]);
  await run('DELETE FROM user_families WHERE user_id = $1 AND family_id = $2', [userId, user.family_id]);
  await run("UPDATE users SET family_id = NULL, role = 'member' WHERE id = $1", [userId]);
  if (user.role === 'founder') await run('UPDATE families SET founder_id = NULL WHERE id = $1', [user.family_id]);
  return { success: true, family_name: family ? family.name : '' };
}

// =============== CODES ===============
async function generateSubscriptionCodes(count = 5) {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) code += chars[Math.floor(Math.random() * chars.length)];
    try { await run('INSERT INTO subscription_codes (code, type, price) VALUES ($1,$2,$3)', [code, 'free', 0]); codes.push(code); } catch(e) {}
  }
  return codes;
}
async function generatePremiumCode() {
  const patterns = [];
  for (let i = 0; i < 26; i++) patterns.push(String.fromCharCode(65 + i).repeat(8));
  for (let i = 0; i < 10; i++) patterns.push(String(i).repeat(8));
  for (const pattern of patterns) {
    const existing = await queryOne('SELECT * FROM subscription_codes WHERE code = $1', [pattern]);
    if (!existing) { await run("INSERT INTO subscription_codes (code, type, price) VALUES ($1, 'premium', 200)", [pattern]); return pattern; }
  }
  return 'NONE';
}
async function getAvailablePremiumCodes() { return query("SELECT * FROM subscription_codes WHERE type = 'premium' AND (used = 0 OR used IS NULL) AND purchased_by IS NULL"); }
async function purchaseCode(userId, code) {
  const c = await queryOne("SELECT * FROM subscription_codes WHERE code = $1 AND type = 'premium' AND (used = 0 OR used IS NULL) AND purchased_by IS NULL", [code]);
  if (!c) return null;
  await run('UPDATE subscription_codes SET purchased_by = $1, used = 1 WHERE code = $2', [userId, code]);
  await run('INSERT INTO user_codes (id, user_id, code, type) VALUES ($1,$2,$3,$4)', [uuidv4(), userId, code, 'premium']);
  return queryOne('SELECT * FROM subscription_codes WHERE code = $1', [code]);
}
async function getUserCodes(userId) { return query('SELECT * FROM user_codes WHERE user_id = $1 ORDER BY purchase_date DESC', [userId]); }
async function getFirstAvailablePremiumCode() { const r = await queryOne("SELECT code FROM subscription_codes WHERE used = 0 AND type = 'premium' LIMIT 1"); return r ? r.code : null; }
async function updatePrice(code, price) { await run('UPDATE subscription_codes SET price = $1 WHERE code = $2', [price, code]); }

// =============== INVITATIONS ===============
async function createInvitation(familyId, email, invitedBy) {
  const id = uuidv4(); const token = uuidv4();
  const existing = await queryOne("SELECT * FROM invitations WHERE family_id = $1 AND email = $2 AND status = 'pending'", [familyId, email]);
  if (existing) return null;
  await run('INSERT INTO invitations (id, family_id, email, invited_by, token) VALUES ($1,$2,$3,$4,$5)', [id, familyId, email, invitedBy, token]);
  return queryOne('SELECT * FROM invitations WHERE id = $1', [id]);
}
async function createInvitationByPhone(familyId, phone, invitedBy) {
  const id = uuidv4(); const token = uuidv4();
  const existing = await queryOne("SELECT * FROM invitations WHERE family_id = $1 AND phone = $2 AND status = 'pending'", [familyId, phone]);
  if (existing) return existing;
  await run('INSERT INTO invitations (id, family_id, email, phone, invited_by, token) VALUES ($1,$2,$3,$4,$5,$6)', [id, familyId, '', phone, invitedBy, token]);
  return queryOne('SELECT * FROM invitations WHERE id = $1', [id]);
}
async function getInvitationsByFamily(familyId) { return query('SELECT i.*, u.name as invited_by_name FROM invitations i JOIN users u ON i.invited_by = u.id WHERE i.family_id = $1 ORDER BY i.created_at DESC', [familyId]); }
async function getInvitationByToken(token) { return queryOne("SELECT * FROM invitations WHERE token = $1 AND status = 'pending'", [token]); }
async function acceptInvitation(token, userId) {
  const inv = await queryOne("SELECT * FROM invitations WHERE token = $1 AND status = 'pending'", [token]);
  if (!inv) return null;
  await run("UPDATE invitations SET status = 'accepted' WHERE id = $1", [inv.id]);
  await run('UPDATE users SET family_id = $1 WHERE id = $2', [inv.family_id, userId]);
  await addUserToFamily(userId, inv.family_id, 1);
  await setCurrentFamily(userId, inv.family_id);
  return inv;
}

// =============== DIWANIYA ===============
async function openDiwaniya(familyId, userId, durationMinutes, topic = '', mode = 'text', secretCode = '') {
  const family = await getFamily(familyId);
  const capacity = family ? family.diwaniya_capacity : 15;
  const id = uuidv4();
  await run("INSERT INTO diwaniya_sessions (id, family_id, opened_by, duration_minutes, status, topic, mode, capacity, secret_code) VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8)", [id, familyId, userId, durationMinutes, topic, mode, capacity, secretCode || null]);
  return queryOne('SELECT * FROM diwaniya_sessions WHERE id = $1', [id]);
}

async function verifyDiwaniyaCode(sessionId, code) {
  const session = await queryOne('SELECT * FROM diwaniya_sessions WHERE id = $1', [sessionId]);
  if (!session) return { error: 'الجلسة غير موجودة' };
  if (!session.secret_code) return { ok: true }; // no code required
  if (session.secret_code !== code) return { error: 'الرقم السري غير صحيح' };
  return { ok: true };
}
async function closeDiwaniya(sessionId) {
  const session = await queryOne("SELECT * FROM diwaniya_sessions WHERE id = $1 AND status = 'open'", [sessionId]);
  if (!session) return null;
  await run("UPDATE diwaniya_sessions SET status = 'closed', closed_at = now() WHERE id = $1", [sessionId]);
  return queryOne('SELECT * FROM diwaniya_sessions WHERE id = $1', [sessionId]);
}
async function getActiveDiwaniya(familyId) { return queryOne("SELECT * FROM diwaniya_sessions WHERE family_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1", [familyId]); }
async function getDiwaniyaSessionById(sessionId) { return queryOne('SELECT * FROM diwaniya_sessions WHERE id = $1', [sessionId]); }
async function getDiwaniyaHistory(familyId) { return query('SELECT ds.*, u.name as opened_by_name FROM diwaniya_sessions ds JOIN users u ON ds.opened_by = u.id WHERE ds.family_id = $1 ORDER BY ds.opened_at DESC LIMIT 20', [familyId]); }
async function addDiwaniyaMessage(sessionId, userId, message) {
  const id = uuidv4();
  await run('INSERT INTO diwaniya_messages (id, session_id, user_id, message) VALUES ($1,$2,$3,$4)', [id, sessionId, userId, message]);
  return queryOne('SELECT dm.*, u.name as user_name, u.avatar FROM diwaniya_messages dm JOIN users u ON dm.user_id = u.id WHERE dm.id = $1', [id]);
}
async function getDiwaniyaMessages(sessionId) { return query('SELECT dm.*, u.name as user_name, u.avatar FROM diwaniya_messages dm JOIN users u ON dm.user_id = u.id WHERE dm.session_id = $1 ORDER BY dm.created_at ASC', [sessionId]); }

// =============== CHALLENGES ===============
async function createChallenge(familyId, gameType, challengerId, opponentId, points = 10) {
  const id = uuidv4();
  await run('INSERT INTO challenges (id, family_id, game_type, challenger_id, opponent_id, points) VALUES ($1,$2,$3,$4,$5,$6)', [id, familyId, gameType, challengerId, opponentId, points]);
  return getChallengeById(id);
}
async function getChallengeById(id) { return queryOne('SELECT c.*, u1.name as challenger_name, u2.name as opponent_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id WHERE c.id = $1', [id]); }
async function respondToChallenge(challengeId, userId, accept) {
  const challenge = await queryOne("SELECT * FROM challenges WHERE id = $1 AND status = 'pending'", [challengeId]);
  if (!challenge || challenge.opponent_id !== userId) return null;
  const status = accept ? 'accepted' : 'rejected';
  await run('UPDATE challenges SET status = $1 WHERE id = $2', [status, challengeId]);
  return getChallengeById(challengeId);
}
async function completeChallenge(challengeId, winnerId, challengerScore, opponentScore) {
  const challenge = await queryOne("SELECT * FROM challenges WHERE id = $1 AND status = 'accepted'", [challengeId]);
  if (!challenge) return null;
  await run("UPDATE challenges SET status = 'completed', winner_id = $1, challenger_score = $2, opponent_score = $3, completed_at = now() WHERE id = $4", [winnerId, challengerScore, opponentScore, challengeId]);
  if (winnerId) {
    await run('UPDATE users SET points = points + $1 WHERE id = $2', [challenge.points, winnerId]);
    const loserId = winnerId === challenge.challenger_id ? challenge.opponent_id : challenge.challenger_id;
    await run('UPDATE users SET points = points + $1 WHERE id = $2', [Math.floor(challenge.points / 2), loserId]);
  }
  return queryOne('SELECT c.*, u1.name as challenger_name, u2.name as opponent_name, uw.name as winner_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id LEFT JOIN users uw ON c.winner_id = uw.id WHERE c.id = $1', [challengeId]);
}
async function getFamilyChallenges(familyId) { return query('SELECT c.*, u1.name as challenger_name, u2.name as opponent_name, uw.name as winner_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id LEFT JOIN users uw ON c.winner_id = uw.id WHERE c.family_id = $1 ORDER BY c.created_at DESC LIMIT 50', [familyId]); }
async function getPendingChallenges(userId) { return query("SELECT c.*, u1.name as challenger_name, u2.name as opponent_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id WHERE c.opponent_id = $1 AND c.status = 'pending' ORDER BY c.created_at DESC", [userId]); }
async function getFamilyLeaderboard(familyId) { return query('SELECT id, name, avatar, points, role, (SELECT COUNT(*) FROM challenges WHERE (challenger_id = users.id OR opponent_id = users.id) AND winner_id = users.id) as wins, (SELECT COUNT(*) FROM challenges WHERE (challenger_id = users.id OR opponent_id = users.id) AND status = \'completed\') as total_games FROM users WHERE family_id = $1 ORDER BY points DESC', [familyId]); }

// =============== AUCTIONS ===============
async function createAuction(code, startingPrice, entryFee, durationMinutes, minIncrement, createdBy) {
  const codeCheck = await queryOne('SELECT * FROM subscription_codes WHERE code = $1', [code]);
  if (!codeCheck) { await run("INSERT INTO subscription_codes (code, type, price) VALUES ($1, 'premium', $2)", [code, startingPrice]); }
  else if (codeCheck.used == 1) return { error: 'هذا الرمز مستخدم مسبقاً' };
  const inAuction = await queryOne("SELECT * FROM auctions WHERE code = $1 AND status = 'active'", [code]);
  if (inAuction) return { error: 'هذا الرمز في مزاد نشط' };
  const id = uuidv4();
  const endTime = new Date(Date.now() + durationMinutes * 60000).toISOString();
  await run('INSERT INTO auctions (id, code, starting_price, entry_fee, current_price, min_increment, end_time, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, code, startingPrice, entryFee, startingPrice, minIncrement, endTime, createdBy]);
  await run('UPDATE subscription_codes SET used = 1 WHERE code = $1', [code]);
  return queryOne('SELECT * FROM auctions WHERE id = $1', [id]);
}
async function getActiveAuctions() {
  await run("UPDATE auctions SET status = 'ended' WHERE status = 'active' AND end_time::timestamptz < now()", []);
  return query('SELECT a.*, u.name as winner_name FROM auctions a LEFT JOIN users u ON a.winner_id = u.id WHERE a.status = \'active\' ORDER BY a.created_at DESC');
}
async function getAllAuctions() { return query('SELECT a.*, u.name as winner_name FROM auctions a LEFT JOIN users u ON a.winner_id = u.id ORDER BY a.created_at DESC LIMIT 30'); }
async function getAuctionById(id) { return queryOne('SELECT a.*, u.name as winner_name FROM auctions a LEFT JOIN users u ON a.winner_id = u.id WHERE a.id = $1', [id]); }
async function joinAuction(auctionId, userId) {
  const existing = await queryOne('SELECT * FROM auction_participants WHERE auction_id = $1 AND user_id = $2', [auctionId, userId]);
  if (existing) return { joined: true };
  const auction = await queryOne("SELECT * FROM auctions WHERE id = $1 AND status = 'active'", [auctionId]);
  if (!auction) return { error: 'المزاد غير متاح' };
  await run('INSERT INTO auction_participants (id, auction_id, user_id, paid_entry) VALUES ($1,$2,$3,1)', [uuidv4(), auctionId, userId]);
  return { joined: true, entry_fee: auction.entry_fee };
}
async function placeBid(auctionId, userId, amount) {
  const auction = await queryOne("SELECT * FROM auctions WHERE id = $1 AND status = 'active'", [auctionId]);
  if (!auction) return { error: 'المزاد غير متاح' };
  if (auction.end_time <= new Date().toISOString()) { await run('UPDATE auctions SET status = \'ended\', winner_id = $1 WHERE id = $2', [auction.winner_id, auctionId]); return { error: 'انتهى المزاد' }; }
  if (amount < auction.current_price + auction.min_increment) return { error: 'المبلغ أقل من الحد الأدنى للمزايدة (' + (auction.current_price + auction.min_increment) + ' ريال)' };
  const participant = await queryOne('SELECT * FROM auction_participants WHERE auction_id = $1 AND user_id = $2', [auctionId, userId]);
  if (!participant) return { error: 'يجب دفع رسوم الدخول أولاً' };
  await run('INSERT INTO auction_bids (id, auction_id, user_id, amount) VALUES ($1,$2,$3,$4)', [uuidv4(), auctionId, userId, amount]);
  await run('UPDATE auctions SET current_price = $1 WHERE id = $2', [amount, auctionId]);
  return getAuctionById(auctionId);
}
async function endAuction(auctionId) {
  const auction = await queryOne("SELECT * FROM auctions WHERE id = $1 AND status = 'active'", [auctionId]);
  if (!auction) return null;
  const lastBid = await queryOne('SELECT * FROM auction_bids WHERE auction_id = $1 ORDER BY created_at DESC, amount DESC LIMIT 1', [auctionId]);
  const winnerId = lastBid ? lastBid.user_id : null;
  await run("UPDATE auctions SET status = 'ended', winner_id = $1 WHERE id = $2", [winnerId, auctionId]);
  if (!winnerId) await run('UPDATE subscription_codes SET used = 0 WHERE code = $1', [auction.code]);
  return getAuctionById(auctionId);
}
async function confirmAuctionPayment(auctionId) {
  await run('UPDATE auctions SET paid = 1 WHERE id = $1', [auctionId]);
  const auction = await getAuctionById(auctionId);
  if (auction && auction.winner_id && auction.paid) await run('INSERT INTO user_codes (id, user_id, code, type) VALUES ($1,$2,$3,$4)', [uuidv4(), auction.winner_id, auction.code, 'premium']);
  return auction;
}
async function cancelAuction(auctionId) {
  const auction = await queryOne('SELECT * FROM auctions WHERE id = $1', [auctionId]);
  await run("UPDATE auctions SET status = 'cancelled' WHERE id = $1", [auctionId]);
  if (auction) await run('UPDATE subscription_codes SET used = 0 WHERE code = $1', [auction.code]);
  return getAuctionById(auctionId);
}
async function getAuctionBids(auctionId) { return query('SELECT ab.*, u.name as user_name FROM auction_bids ab JOIN users u ON ab.user_id = u.id WHERE ab.auction_id = $1 ORDER BY ab.created_at DESC, ab.amount DESC', [auctionId]); }
async function isAuctionParticipant(auctionId, userId) { return queryOne('SELECT * FROM auction_participants WHERE auction_id = $1 AND user_id = $2', [auctionId, userId]); }
async function getAvailableAuctionCodes() { return query("SELECT * FROM subscription_codes WHERE type = 'premium' AND (used = 0 OR used IS NULL) ORDER BY code ASC"); }

// =============== ADMIN: FAMILIES & USERS ===============
async function getAllFamilies() { return query('SELECT f.*, (SELECT COUNT(*) FROM users WHERE family_id = f.id) as members_count, u.name as founder_name, u.last_seen as founder_last_seen FROM families f LEFT JOIN users u ON f.founder_id = u.id ORDER BY f.created_at DESC'); }
async function updateFamilyData(familyId, data) {
  const { name, subscription_code, status } = data;
  if (name !== undefined) await run('UPDATE families SET name = $1 WHERE id = $2', [name, familyId]);
  if (status !== undefined) await run('UPDATE families SET status = $1 WHERE id = $2', [status, familyId]);
  if (subscription_code !== undefined) {
    const existing = await queryOne('SELECT * FROM families WHERE subscription_code = $1 AND id != $2', [subscription_code, familyId]);
    if (existing) return { error: 'رمز العائلة مستخدم من عائلة أخرى' };
    await run('UPDATE families SET subscription_code = $1 WHERE id = $2', [subscription_code, familyId]);
  }
  return queryOne('SELECT * FROM families WHERE id = $1', [familyId]);
}
async function setFamilyStatus(familyId, status) { await run('UPDATE families SET status = $1 WHERE id = $2', [status, familyId]); return queryOne('SELECT * FROM families WHERE id = $1', [familyId]); }
async function deleteFamily(familyId) {
  await run('DELETE FROM challenges WHERE family_id = $1', [familyId]);
  await run('DELETE FROM diwaniya_messages WHERE session_id IN (SELECT id FROM diwaniya_sessions WHERE family_id = $1)', [familyId]);
  await run('DELETE FROM diwaniya_sessions WHERE family_id = $1', [familyId]);
  await run('DELETE FROM invitations WHERE family_id = $1', [familyId]);
  await run('UPDATE users SET family_id = NULL WHERE family_id = $1', [familyId]);
  await run('DELETE FROM families WHERE id = $1', [familyId]);
  return true;
}
async function getAllUsersDetailed() { return query('SELECT u.id, u.name, u.email, u.phone, u.whatsapp, u.country, u.city, u.role, u.points, u.public_id, u.last_seen, u.can_open_diwaniya, f.name as family_name, f.subscription_code FROM users u LEFT JOIN families f ON u.family_id = f.id ORDER BY u.role, u.name'); }
async function updateUserByAdmin(userId, data) {
  const { name, email, whatsapp, phone, role } = data;
  if (name !== undefined) await run('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
  if (email !== undefined) { const exists = await queryOne('SELECT * FROM users WHERE email = $1 AND id != $2', [email, userId]); if (exists) return { error: 'البريد مستخدم' }; await run('UPDATE users SET email = $1 WHERE id = $2', [email, userId]); }
  if (whatsapp !== undefined) await run('UPDATE users SET whatsapp = $1 WHERE id = $2', [whatsapp, userId]);
  if (phone !== undefined) await run('UPDATE users SET phone = $1 WHERE id = $2', [phone, userId]);
  if (role !== undefined) await run('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
  return queryOne('SELECT id, name, email, phone, whatsapp, role, points FROM users WHERE id = $1', [userId]);
}
async function deleteUserByAdmin(userId) { await run('DELETE FROM users WHERE id = $1', [userId]); return true; }
async function createAdminUser(email, password, name = 'مدير التطبيق') { return createUserByRole(email, password, name, 'admin'); }
async function createUserByRole(email, password, name, role) {
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const id = uuidv4();
  const pid2 = makePublicId();
  await run('INSERT INTO users (id, name, email, password, role, public_id) VALUES ($1,$2,$3,$4,$5,$6)', [id, name, email, password, role, pid2]);
  return queryOne('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
}
async function getAdminStats() {
  const f = await queryOne('SELECT COUNT(*) as c FROM families');
  const u = await queryOne('SELECT COUNT(*) as c FROM users');
  const c = await queryOne('SELECT COUNT(*) as c FROM challenges');
  return { families: f ? f.c : 0, users: u ? u.c : 0, challenges: c ? c.c : 0 };
}

// =============== ADS ===============
async function getActiveAds() { return query("SELECT * FROM ads WHERE status = 'active' AND (start_time IS NULL OR start_time::timestamptz <= now()) AND (end_time IS NULL OR end_time::timestamptz >= now()) ORDER BY created_at DESC"); }
async function getAllAds() { return query('SELECT * FROM ads ORDER BY created_at DESC'); }
async function addAd(title, imageUrl, linkUrl, position = 'banner', startTime = null, endTime = null) {
  const id = uuidv4();
  await run('INSERT INTO ads (id, title, image_url, link_url, position, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, title, imageUrl || '', linkUrl || '', position, startTime, endTime]);
  return queryOne('SELECT * FROM ads WHERE id = $1', [id]);
}
async function updateAd(id, title, imageUrl, linkUrl, status, startTime, endTime) {
  await run('UPDATE ads SET title = $1, image_url = $2, link_url = $3, status = $4, start_time = $5, end_time = $6 WHERE id = $7', [title, imageUrl || '', linkUrl || '', status, startTime, endTime, id]);
  return queryOne('SELECT * FROM ads WHERE id = $1', [id]);
}
async function deleteAd(id) { await run('DELETE FROM ads WHERE id = $1', [id]); return true; }
async function trackAdView(id) { await run('UPDATE ads SET views = views + 1 WHERE id = $1', [id]); }
async function trackAdClick(id) { await run('UPDATE ads SET clicks = clicks + 1 WHERE id = $1', [id]); }
async function getAdsStats() { const r = await queryOne('SELECT COUNT(*) as total, COALESCE(SUM(views),0) as views, COALESCE(SUM(clicks),0) as clicks FROM ads'); return { total: r.total || 0, views: r.views || 0, clicks: r.clicks || 0 }; }
async function getFeaturedFamilies(limit = 5) { return query("SELECT f.id, f.name, f.subscription_code, f.image, f.support_points, f.battle_wins, (SELECT COUNT(*) FROM users WHERE family_id = f.id) as members_count, u.name as founder_name FROM families f LEFT JOIN users u ON f.founder_id = u.id WHERE f.status = 'active' ORDER BY f.support_points DESC, members_count DESC LIMIT $1", [limit]); }

// =============== USER FAMILIES ===============
async function getUserFamilies(userId) { return query('SELECT uf.*, f.name as family_name, f.subscription_code FROM user_families uf JOIN families f ON uf.family_id = f.id WHERE uf.user_id = $1 ORDER BY uf.joined_at DESC', [userId]); }
async function getUserFamilyCount(userId) { const r = await queryOne('SELECT COUNT(*) as c FROM user_families WHERE user_id = $1', [userId]); return r ? r.c : 0; }
async function addUserToFamily(userId, familyId, isCurrent = 0) {
  const existing = await queryOne('SELECT * FROM user_families WHERE user_id = $1 AND family_id = $2', [userId, familyId]);
  if (existing) return false;
  await run('INSERT INTO user_families (id, user_id, family_id, is_current) VALUES ($1,$2,$3,$4)', [uuidv4(), userId, familyId, isCurrent]);
  return true;
}
async function setCurrentFamily(userId, familyId) { await run('UPDATE user_families SET is_current = 0 WHERE user_id = $1', [userId]); await run('UPDATE user_families SET is_current = 1 WHERE user_id = $1 AND family_id = $2', [userId, familyId]); }

// =============== SETTINGS ===============
let cachedRate = null;
let cachedAt = 0;

async function getCurrencyRate() {
  // Use cached live rate (valid 1 hour)
  if (cachedRate && (Date.now() - cachedAt < 3600000)) return cachedRate;
  // Try live rate
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data && data.rates && data.rates.SAR) {
      cachedRate = parseFloat(data.rates.SAR);
      cachedAt = Date.now();
      await setSetting('currency_rate', cachedRate.toString());
      return cachedRate;
    }
  } catch(e) {}
  // Fallback to setting or fixed
  const fallback = parseFloat(await getSetting('currency_rate', '3.75'));
  cachedRate = fallback;
  cachedAt = Date.now();
  return fallback;
}
async function setCurrencyRate(rate) { await setSetting('currency_rate', rate); cachedRate = parseFloat(rate); cachedAt = Date.now(); }

async function getSetting(key, def) { const r = await queryOne('SELECT value FROM settings WHERE key = $1', [key]); return r ? r.value : def; }
async function setSetting(key, value) { await run('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]); }

// =============== DIWANIYA LOCK ===============
async function lockDiwaniya(familyId, untilIso, reason, lockedByName) { await run('UPDATE families SET diwaniya_locked_until = $1, diwaniya_lock_reason = $2, diwaniya_locked_by = $3 WHERE id = $4', [untilIso, reason, lockedByName, familyId]); }
async function getDiwaniyaLock(familyId) {
  const family = await queryOne('SELECT diwaniya_locked_until, diwaniya_lock_reason, diwaniya_locked_by FROM families WHERE id = $1', [familyId]);
  if (!family || !family.diwaniya_locked_until) return null;
  if (family.diwaniya_locked_until <= new Date().toISOString()) { await run('UPDATE families SET diwaniya_locked_until = NULL, diwaniya_lock_reason = NULL, diwaniya_locked_by = NULL WHERE id = $1', [familyId]); return null; }
  return { locked_until: family.diwaniya_locked_until, reason: family.diwaniya_lock_reason, locked_by: family.diwaniya_locked_by };
}

// =============== MODERATION ===============
async function getBannedWords() { return query('SELECT * FROM banned_words ORDER BY created_at DESC'); }
async function addBannedWord(word) { try { await run('INSERT INTO banned_words (id, word) VALUES ($1,$2) ON CONFLICT (word) DO NOTHING', [uuidv4(), word.toLowerCase().trim()]); return queryOne('SELECT * FROM banned_words WHERE word = $1', [word.toLowerCase().trim()]); } catch(e) { return null; } }
async function deleteBannedWord(id) { await run('DELETE FROM banned_words WHERE id = $1', [id]); return true; }
async function checkBannedWord(text) {
  const words = await getBannedWords();
  if (!words.length) return null;
  const lower = (text || '').toLowerCase();
  for (const w of words) if (lower.includes(w.word.toLowerCase())) return w.word;
  return null;
}
async function banUser(userId, reason, durationHours, createdBy) {
  const id = uuidv4();
  const until = new Date(Date.now() + durationHours * 3600000).toISOString();
  await run("UPDATE bans SET status = 'expired' WHERE user_id = $1 AND status = 'active'", [userId]);
  await run('INSERT INTO bans (id, user_id, reason, duration_hours, banned_until, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, userId, reason, durationHours, until, createdBy]);
  return queryOne('SELECT * FROM bans WHERE id = $1', [id]);
}
async function getActiveBan(userId) {
  const ban = await queryOne("SELECT * FROM bans WHERE user_id = $1 AND status = 'active'", [userId]);
  if (!ban) return null;
  if (ban.banned_until <= new Date().toISOString()) { await run("UPDATE bans SET status = 'expired' WHERE id = $1", [ban.id]); return null; }
  return ban;
}
async function getAllBans() { return query("SELECT b.*, u.name as user_name, u.email as user_email FROM bans b JOIN users u ON b.user_id = u.id WHERE b.status = 'active' ORDER BY b.created_at DESC"); }
async function unbanUser(userId) { await run("UPDATE bans SET status = 'expired' WHERE user_id = $1 AND status = 'active'", [userId]); return true; }
async function setDiwaniyaManager(userId, canOpen) { await run('UPDATE users SET can_open_diwaniya = $1 WHERE id = $2', [canOpen ? 1 : 0, userId]); return getUserById(userId); }
async function countDiwaniyaManagers(familyId) { const r = await queryOne('SELECT COUNT(*) as c FROM users WHERE family_id = $1 AND can_open_diwaniya = 1', [familyId]); return r ? r.c : 0; }

// =============== VIOLATIONS ===============
async function addViolation(userId, reason, durationHours, violationType, evidence, createdBy) {
  const id = uuidv4();
  const bannedUntil = new Date(Date.now() + durationHours * 3600000).toISOString();
  await run('INSERT INTO violations (id, user_id, reason, duration_hours, violation_type, evidence, created_by, banned_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, userId, reason, durationHours, violationType, evidence || '', createdBy, bannedUntil]);
  await run("UPDATE bans SET status = 'expired' WHERE user_id = $1 AND status = 'active'", [userId]);
  await run('INSERT INTO bans (id, user_id, reason, duration_hours, banned_until, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [uuidv4(), userId, reason, durationHours, bannedUntil, createdBy]);
  return queryOne('SELECT * FROM violations WHERE id = $1', [id]);
}
async function getAllViolations() { return query('SELECT v.*, u.name as user_name, u.email as user_email FROM violations v JOIN users u ON v.user_id = u.id ORDER BY v.created_at DESC LIMIT 50'); }
async function getViolationStats() {
  const total = await queryOne('SELECT COUNT(*) as c FROM violations');
  const text = await queryOne("SELECT COUNT(*) as c FROM violations WHERE violation_type = 'text'");
  const audio = await queryOne("SELECT COUNT(*) as c FROM violations WHERE violation_type = 'audio'");
  const video = await queryOne("SELECT COUNT(*) as c FROM violations WHERE violation_type = 'video'");
  return { total: total ? total.c : 0, text: text ? text.c : 0, audio: audio ? audio.c : 0, video: video ? video.c : 0 };
}
async function getModerationSettings() { return { ai_monitor_enabled: await getSetting('ai_monitor_enabled', '1'), auto_ban_after: await getSetting('auto_ban_after', '3'), ai_employee_name: await getSetting('ai_employee_name', 'موظف الذكاء الاصطناعي') }; }
async function setModerationSetting(key, value) { await setSetting(key, value); }

// =============== AGREEMENTS ===============
async function getAgreement(userId) { return queryOne('SELECT * FROM agreements WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]); }
async function acceptAgreement(userId, familyId, role) {
  const existing = await getAgreement(userId);
  if (existing) return existing;
  const id = uuidv4();
  await run("INSERT INTO agreements (id, user_id, family_id, role_at_agreement, agreed, agreed_at) VALUES ($1,$2,$3,$4,1, now())", [id, userId, familyId, role]);
  return queryOne('SELECT * FROM agreements WHERE id = $1', [id]);
}
async function rejectAgreement(userId, familyId, role) {
  const existing = await getAgreement(userId);
  if (existing) return existing;
  const id = uuidv4();
  await run("INSERT INTO agreements (id, user_id, family_id, role_at_agreement, agreed, agreed_at) VALUES ($1,$2,$3,$4,0, now())", [id, userId, familyId, role]);
  return queryOne('SELECT * FROM agreements WHERE id = $1', [id]);
}
async function canOpenDiwaniya(userId) { const ag = await getAgreement(userId); if (!ag) return true; return ag.agreed == 1; }
async function getFamilyAgreements(familyId) { return query('SELECT a.*, u.name as user_name, u.role as user_role FROM agreements a JOIN users u ON a.user_id = u.id WHERE a.family_id = $1 ORDER BY a.role_at_agreement, a.created_at DESC', [familyId]); }
async function getAllAgreements() { return query('SELECT a.*, u.name as user_name, u.email as user_email, u.role as user_role, f.name as family_name FROM agreements a JOIN users u ON a.user_id = u.id LEFT JOIN families f ON a.family_id = f.id ORDER BY a.role_at_agreement, a.created_at DESC'); }

// =============== SUPPORT ===============
async function addSupportMessage(title, content) { const id = uuidv4(); await run('INSERT INTO support_messages (id, title, content) VALUES ($1,$2,$3)', [id, title, content]); return queryOne('SELECT * FROM support_messages WHERE id = $1', [id]); }
async function getSupportMessages() { return query('SELECT * FROM support_messages ORDER BY created_at DESC'); }
async function deleteSupportMessage(id) { await run('DELETE FROM support_messages WHERE id = $1', [id]); return true; }
async function countSupportMessages() { const r = await queryOne('SELECT COUNT(*) as c FROM support_messages'); return r ? r.c : 0; }
async function createSupportTicket(userId, userName, subject, message) { const id = uuidv4(); await run('INSERT INTO support_tickets (id, user_id, user_name, subject, message) VALUES ($1,$2,$3,$4,$5)', [id, userId, userName, subject, message]); return queryOne('SELECT * FROM support_tickets WHERE id = $1', [id]); }
async function getSupportTickets() { return query('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 100'); }
async function getMyTickets(userId) { return query('SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC', [userId]); }
async function replyTicket(ticketId, adminReply) { await run("UPDATE support_tickets SET status = 'answered', admin_reply = $1, replied_at = now() WHERE id = $2", [adminReply, ticketId]); return queryOne('SELECT * FROM support_tickets WHERE id = $1', [ticketId]); }
async function closeTicket(ticketId) { await run("UPDATE support_tickets SET status = 'closed' WHERE id = $1", [ticketId]); return queryOne('SELECT * FROM support_tickets WHERE id = $1', [ticketId]); }

// =============== MODERATOR VISITS & STARS ===============
async function requestModeratorVisit(moderatorId, moderatorName, familyId, reason) {
  const id = uuidv4();
  const scheduledAt = new Date(Date.now() + 60000).toISOString();
  await run("INSERT INTO moderator_visits (id, moderator_id, moderator_name, family_id, reason, status, scheduled_at) VALUES ($1,$2,$3,$4,$5,'requested',$6)", [id, moderatorId, moderatorName, familyId, reason, scheduledAt]);
  return queryOne('SELECT * FROM moderator_visits WHERE id = $1', [id]);
}
async function approveModeratorVisit(visitId, sessionId) { await run("UPDATE moderator_visits SET status = 'approved', diwaniya_session_id = $1 WHERE id = $2", [sessionId, visitId]); return queryOne('SELECT * FROM moderator_visits WHERE id = $1', [visitId]); }
async function enterModeratorVisit(visitId) { await run("UPDATE moderator_visits SET status = 'entered', entered_at = now() WHERE id = $1", [visitId]); return queryOne('SELECT * FROM moderator_visits WHERE id = $1', [visitId]); }
async function exitModeratorVisit(visitId, report) { await run("UPDATE moderator_visits SET status = 'exited', exit_at = now(), report = $1 WHERE id = $2", [report || '', visitId]); return queryOne('SELECT * FROM moderator_visits WHERE id = $1', [visitId]); }
async function getModeratorVisits() { return query('SELECT * FROM moderator_visits ORDER BY requested_at DESC LIMIT 50'); }
async function getModeratorVisitsByUser(userId) { return query('SELECT * FROM moderator_visits WHERE moderator_id = $1 ORDER BY requested_at DESC LIMIT 20', [userId]); }
async function getPendingVisitByModerator(userId) { return queryOne("SELECT * FROM moderator_visits WHERE moderator_id = $1 AND status IN ('requested','approved','entered') ORDER BY requested_at DESC LIMIT 1", [userId]); }
async function getFamiliesWithActiveDiwaniya() { return query("SELECT DISTINCT f.id, f.name, f.subscription_code, ds.duration_minutes, ds.opened_at, ds.topic, u.name as founder_name FROM diwaniya_sessions ds JOIN families f ON ds.family_id = f.id LEFT JOIN users u ON f.founder_id = u.id WHERE ds.status = 'open' ORDER BY ds.opened_at DESC"); }

async function addModeratorStars(userId, stars) { await run('UPDATE users SET stars = stars + $1 WHERE id = $2', [stars, userId]); return getModeratorProfile(userId); }
async function getModeratorProfile(userId) {
  const user = await queryOne('SELECT id, name, email, stars, moderator_tier, points, created_at FROM users WHERE id = $1', [userId]);
  if (!user) return null;
  const visits = await queryOne("SELECT COUNT(*) as c FROM moderator_visits WHERE moderator_id = $1 AND status = 'exited'", [userId]);
  const ratings = await query('SELECT rating FROM moderator_ratings WHERE moderator_id = $1', [userId]);
  const avg = ratings.length ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1) : 0;
  return { ...user, visits: visits ? visits.c : 0, ratings_count: ratings.length, avg_rating: avg };
}
async function rateModerator(moderatorId, visitId, familyId, rating, comment, ratedBy) {
  await run('INSERT INTO moderator_ratings (id, moderator_id, visit_id, family_id, rating, comment, rated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uuidv4(), moderatorId, visitId, familyId, rating, comment || '', ratedBy]);
  return true;
}
async function getModeratorTier(stars) {
  const t1 = parseInt(await getSetting('tier_black', '1000'));
  const t2 = parseInt(await getSetting('tier_blue', '5000'));
  const t3 = parseInt(await getSetting('tier_silver', '10000'));
  const t4 = parseInt(await getSetting('tier_gold', '20000'));
  const t5 = parseInt(await getSetting('tier_platinum', '40000'));
  if (stars >= t5) return 'platinum';
  if (stars >= t4) return 'gold';
  if (stars >= t3) return 'silver';
  if (stars >= t2) return 'blue';
  if (stars >= t1) return 'black';
  return 'none';
}
async function updateModeratorTier(userId, tier) { await run('UPDATE users SET moderator_tier = $1 WHERE id = $2', [tier, userId]); return getUserById(userId); }
async function getTierSettings() {
  return {
    black: parseInt(await getSetting('tier_black', '1000')),
    blue: parseInt(await getSetting('tier_blue', '5000')),
    silver: parseInt(await getSetting('tier_silver', '10000')),
    gold: parseInt(await getSetting('tier_gold', '20000')),
    platinum: parseInt(await getSetting('tier_platinum', '40000')),
    stars_per_visit: parseInt(await getSetting('stars_per_visit', '10')),
    stars_per_500_visits: parseInt(await getSetting('stars_per_500_visits', '5000')),
  };
}

// =============== FAMILY EDIT & CAPACITY ===============
async function getActivePackages() { return query("SELECT * FROM packages WHERE status = 'active' ORDER BY sort_order, price"); }
async function getAllPackages() { return query('SELECT * FROM packages ORDER BY sort_order, price'); }
async function addPackage(title, codeExample, price, features) {
  const id = uuidv4();
  await run('INSERT INTO packages (id, title, code_example, price, features) VALUES ($1,$2,$3,$4,$5)', [id, title, codeExample || '', parseInt(price) || 0, features || '[]']);
  return queryOne('SELECT * FROM packages WHERE id = $1', [id]);
}
async function updatePackage(id, data) {
  const { title, code_example, price, features, status } = data;
  if (title !== undefined) await run('UPDATE packages SET title = $1 WHERE id = $2', [title, id]);
  if (code_example !== undefined) await run('UPDATE packages SET code_example = $1 WHERE id = $2', [code_example, id]);
  if (price !== undefined) await run('UPDATE packages SET price = $1 WHERE id = $2', [price, id]);
  if (features !== undefined) await run('UPDATE packages SET features = $1 WHERE id = $2', [features, id]);
  if (status !== undefined) await run('UPDATE packages SET status = $1 WHERE id = $2', [status, id]);
  return queryOne('SELECT * FROM packages WHERE id = $1', [id]);
}
async function deletePackage(id) { await run('DELETE FROM packages WHERE id = $1', [id]); return true; }

// =============== COINS & WALLET ===============
async function seedViolationTemplates() {
  const c = await queryOne('SELECT COUNT(*) as c FROM violation_templates');
  if (c && c.c > 0) return;
  const defaults = [
    { name: 'سياسية', icon: '🏛️' },
    { name: 'عنصرية', icon: '🚫' },
    { name: 'إباحية', icon: '🔞' },
    { name: 'عدم احترام الموجودين', icon: '😠' },
    { name: 'كلام غير لائق', icon: '🗣️' }
  ];
  for (const d of defaults) {
    await run('INSERT INTO violation_templates (id, name, icon) VALUES ($1,$2,$3)', [uuidv4(), d.name, d.icon]);
  }
}
async function getViolationTemplates() { return query("SELECT * FROM violation_templates WHERE status = 'active' ORDER BY created_at"); }
async function getAllViolationTemplates() { return query('SELECT * FROM violation_templates ORDER BY created_at'); }
async function addViolationTemplate(name, icon) {
  const id = uuidv4();
  await run('INSERT INTO violation_templates (id, name, icon) VALUES ($1,$2,$3)', [id, name, icon || '🚫']);
  return queryOne('SELECT * FROM violation_templates WHERE id = $1', [id]);
}
async function deleteViolationTemplate(id) { await run('DELETE FROM violation_templates WHERE id = $1', [id]); return true; }
async function addFounderViolation(userId, reason, action, byUserId, byUserName) {
  const id = uuidv4();
  const bannedUntil = action === 'kick' ? null : null;
  await run("INSERT INTO violations (id, user_id, reason, duration_hours, violation_type, evidence, created_by, banned_until, action, by_user_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [id, userId, reason, 0, 'broadcast_rules', '', byUserName + ' (مؤسس العائلة)', bannedUntil, action, byUserName]);
  return queryOne('SELECT * FROM violations WHERE id = $1', [id]);
}

async function getEffects() { return query("SELECT * FROM effects WHERE status = 'active' ORDER BY price"); }
async function getEffectById(id) { return queryOne('SELECT * FROM effects WHERE id = $1', [id]); }
async function addEffect(name, emoji, cssClass, price) {
  const id = uuidv4();
  await run('INSERT INTO effects (id, name, emoji, css_class, price) VALUES ($1,$2,$3,$4,$5)', [id, name, emoji, cssClass || '', parseInt(price) || 0]);
  return queryOne('SELECT * FROM effects WHERE id = $1', [id]);
}
async function getUserEffects(userId) { return query('SELECT effect_id FROM user_effects WHERE user_id = $1', [userId]); }
async function buyEffect(userId, effectId) {
  await run('INSERT INTO user_effects (user_id, effect_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, effectId]);
  return true;
}
async function selectEffect(userId, effectId) {
  await run('UPDATE users SET selected_effect = $1 WHERE id = $2', [effectId || null, userId]);
  return getUserById(userId);
}
async function addFamilyBattleWin(familyId) {
  if (!familyId) return;
  await run('UPDATE families SET battle_wins = battle_wins + 1 WHERE id = $1', [familyId]);
  const f = await getFamily(familyId);
  return f;
}
async function createBattle(sessionId, playerA, playerB, durationMinutes, familyAId, familyBId) {
  const id = uuidv4();
  const cross = familyAId && familyBId && familyAId !== familyBId ? 1 : 0;
  await run('INSERT INTO battles (id, session_id, player_a_id, player_b_id, duration_minutes, family_a_id, family_b_id, cross_family) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, sessionId || null, playerA, playerB, parseInt(durationMinutes) || 3, familyAId || null, familyBId || null, cross]);
  return queryOne('SELECT * FROM battles WHERE id = $1', [id]);
}
async function addFamilySupportPoints(familyId, coins) {
  if (!familyId) return;
  await run('UPDATE families SET support_points = support_points + $1 WHERE id = $2', [coins, familyId]);
}
async function getOnlineFounders() {
  return query("SELECT u.id, u.name, u.avatar, u.public_id, f.id as family_id, f.name as family_name, f.subscription_code FROM users u LEFT JOIN families f ON u.family_id = f.id WHERE u.role = 'founder' ORDER BY u.name");
}
async function getBattleById(id) { return queryOne('SELECT * FROM battles WHERE id = $1', [id]); }
async function getActiveBattle(sessionId) {
  return queryOne("SELECT * FROM battles WHERE session_id = $1 AND status IN ('pending','active') ORDER BY created_at DESC LIMIT 1", [sessionId]);
}
async function acceptBattle(id, startTime) {
  await run("UPDATE battles SET status = 'active', start_time = $1 WHERE id = $2", [startTime, id]);
  return queryOne('SELECT * FROM battles WHERE id = $1', [id]);
}
async function rejectBattle(id) {
  await run("UPDATE battles SET status = 'rejected' WHERE id = $1", [id]);
  return true;
}
async function supportBattle(id, side, coins) {
  if (side === 'a') await run('UPDATE battles SET coins_a = coins_a + $1 WHERE id = $2', [coins, id]);
  else await run('UPDATE battles SET coins_b = coins_b + $1 WHERE id = $2', [coins, id]);
  return queryOne('SELECT * FROM battles WHERE id = $1', [id]);
}
async function endBattle(id, winnerId) {
  // Victory round: status 'victory' for 2 minutes (loser executes the penalty), then 'done'
  await run("UPDATE battles SET status = 'victory', winner_id = $1, victory_at = $2 WHERE id = $3", [winnerId, new Date().toISOString(), id]);
  return queryOne('SELECT * FROM battles WHERE id = $1', [id]);
}
async function finalizeBattle(id) {
  await run("UPDATE battles SET status = 'done' WHERE id = $1", [id]);
  return queryOne('SELECT * FROM battles WHERE id = $1', [id]);
}
async function isDiwaniyaRestricted(sessionId, userId) {
  const r = await queryOne('SELECT * FROM diwaniya_restrictions WHERE session_id = $1 AND user_id = $2', [sessionId, userId]);
  return r || null;
}
async function restrictFromDiwaniya(sessionId, userId, type = 'restrict') {
  const ex = await isDiwaniyaRestricted(sessionId, userId);
  if (ex) {
    await run('UPDATE diwaniya_restrictions SET type = $1 WHERE id = $2', [type, ex.id]);
    return queryOne('SELECT * FROM diwaniya_restrictions WHERE id = $1', [ex.id]);
  }
  const id = uuidv4();
  await run('INSERT INTO diwaniya_restrictions (id, session_id, user_id, type) VALUES ($1,$2,$3,$4)', [id, sessionId, userId, type]);
  return queryOne('SELECT * FROM diwaniya_restrictions WHERE id = $1', [id]);
}
async function unrestrictFromDiwaniya(sessionId, userId) {
  await run('DELETE FROM diwaniya_restrictions WHERE session_id = $1 AND user_id = $2', [sessionId, userId]);
  return true;
}
async function getDiwaniyaRestrictions(sessionId) {
  return query('SELECT r.*, u.name as user_name FROM diwaniya_restrictions r JOIN users u ON r.user_id = u.id WHERE r.session_id = $1', [sessionId]);
}

async function getGiftItems() { return query("SELECT * FROM gift_items WHERE status = 'active' ORDER BY coins"); }
async function getAllGiftItems() { return query('SELECT * FROM gift_items ORDER BY coins'); }
async function addGiftItem(name, emoji, coins, giftImage, price) {
  const id = uuidv4();
  await run('INSERT INTO gift_items (id, name, emoji, coins, price, gift_image) VALUES ($1,$2,$3,$4,$5,$6)', [id, name, emoji || '🎁', parseInt(coins) || 10, parseInt(price) || 0, giftImage || null]);
  return queryOne('SELECT * FROM gift_items WHERE id = $1', [id]);
}
async function updateGiftItem(id, data) {
  const { name, emoji, coins, price, status, gift_image } = data;
  if (name !== undefined) await run('UPDATE gift_items SET name = $1 WHERE id = $2', [name, id]);
  if (emoji !== undefined) await run('UPDATE gift_items SET emoji = $1 WHERE id = $2', [emoji, id]);
  if (coins !== undefined) await run('UPDATE gift_items SET coins = $1 WHERE id = $2', [coins, id]);
  if (price !== undefined) await run('UPDATE gift_items SET price = $1 WHERE id = $2', [price, id]);
  if (status !== undefined) await run('UPDATE gift_items SET status = $1 WHERE id = $2', [status, id]);
  if (gift_image !== undefined) await run('UPDATE gift_items SET gift_image = $1 WHERE id = $2', [gift_image, id]);
  return queryOne('SELECT * FROM gift_items WHERE id = $1', [id]);
}
async function deleteGiftItem(id) { await run('DELETE FROM gift_items WHERE id = $1', [id]); return true; }

async function getCoinPackages() { return query("SELECT * FROM coin_packages WHERE status = 'active' ORDER BY price"); }
async function getAllCoinPackages() { return query('SELECT * FROM coin_packages ORDER BY price'); }
async function addCoinPackage(coins, price) {
  const id = uuidv4();
  await run('INSERT INTO coin_packages (id, coins, price) VALUES ($1,$2,$3)', [id, coins, price]);
  return queryOne('SELECT * FROM coin_packages WHERE id = $1', [id]);
}
async function updateCoinPackage(id, data) {
  const { coins, price, status } = data;
  if (coins !== undefined) await run('UPDATE coin_packages SET coins = $1 WHERE id = $2', [coins, id]);
  if (price !== undefined) await run('UPDATE coin_packages SET price = $1 WHERE id = $2', [price, id]);
  if (status !== undefined) await run('UPDATE coin_packages SET status = $1 WHERE id = $2', [status, id]);
  return queryOne('SELECT * FROM coin_packages WHERE id = $1', [id]);
}
async function deleteCoinPackage(id) { await run('DELETE FROM coin_packages WHERE id = $1', [id]); return true; }

async function getWallet(userId) {
  const user = await queryOne('SELECT coins, wallet FROM users WHERE id = $1', [userId]);
  return { coins: user ? user.coins : 0, wallet: user ? user.wallet : 0 };
}
async function addCoins(userId, coins) { await run('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, userId]); return getWallet(userId); }
async function deductCoins(userId, coins) {
  const w = await getWallet(userId);
  if (w.coins < coins) return null;
  await run('UPDATE users SET coins = coins - $1 WHERE id = $2', [coins, userId]);
  return getWallet(userId);
}
async function sendGift(fromId, toId, coins, message) {
  const w = await deductCoins(fromId, coins);
  if (!w) return { error: 'رصيدك لا يكفي' };
  await run('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, toId]);
  const id = uuidv4();
  await run('INSERT INTO gifts (id, from_user, to_user, coins, message) VALUES ($1,$2,$3,$4,$5)', [id, fromId, toId, coins, message || '']);
  await run("INSERT INTO coin_transactions (id, user_id, type, coins, detail) VALUES ($1,$2,'gift_out',$3,$4)", [uuidv4(), fromId, coins, 'هدية إلى ' + toId]);
  await run("INSERT INTO coin_transactions (id, user_id, type, coins, detail) VALUES ($1,$2,'gift_in',$3,$4)", [uuidv4(), toId, coins, 'هدية من ' + fromId]);
  return { ok: true, wallet: w };
}
async function convertCoinsToWallet(userId, coins) {
  const w = await getWallet(userId);
  if (w.coins < coins) return { error: 'رصيد الكوينزات لا يكفي' };
  const rate = parseFloat(await getSetting('coin_to_sar', '1'));
  const amount = Math.floor(coins * rate);
  await run('UPDATE users SET coins = coins - $1, wallet = wallet + $2 WHERE id = $3', [coins, amount, userId]);
  await run("INSERT INTO coin_transactions (id, user_id, type, coins, amount, detail) VALUES ($1,$2,'convert',$3,$4,$5)", [uuidv4(), userId, coins, amount, 'تحويل كوينزات إلى مبلغ']);
  return getWallet(userId);
}
async function requestWithdrawal(userId, userName, amount, phone) {
  const w = await getWallet(userId);
  if (w.wallet < amount) return { error: 'رصيد المحفظة لا يكفي' };
  await run('UPDATE users SET wallet = wallet - $1 WHERE id = $2', [amount, userId]);
  const id = uuidv4();
  await run("INSERT INTO withdrawals (id, user_id, user_name, amount, phone, status) VALUES ($1,$2,$3,$4,$5,'pending')", [id, userId, userName, amount, phone || '']);
  await run("INSERT INTO coin_transactions (id, user_id, type, amount, detail) VALUES ($1,$2,'withdraw',$3,$4)", [uuidv4(), userId, amount, 'طلب سحب']);
  return queryOne('SELECT * FROM withdrawals WHERE id = $1', [id]);
}
async function getAllWithdrawals() { return query("SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 100"); }
async function getMyWithdrawals(userId) { return query('SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC', [userId]); }
async function updateWithdrawal(id, status) {
  await run("UPDATE withdrawals SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE paid_at END WHERE id = $2", [status, id]);
  return queryOne('SELECT * FROM withdrawals WHERE id = $1', [id]);
}
async function getUserByPublicId(publicId) {
  return queryOne('SELECT * FROM users WHERE UPPER(public_id) = UPPER($1)', [publicId]);
}
async function transferCoins(fromId, toId, coins, fromName, toName, fromPublicId, toPublicId) {
  const w = await deductCoins(fromId, coins);
  if (!w) return { error: 'رصيدك لا يكفي للتحويل' };
  await run('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, toId]);
  const now = new Date().toISOString();
  await run("INSERT INTO coin_transactions (id, user_id, type, coins, detail, created_at) VALUES ($1,$2,'transfer_out',$3,$4,$5)",
    [uuidv4(), fromId, coins, 'تحويل إلى ' + toName + ' (' + toPublicId + ')', now]);
  await run("INSERT INTO coin_transactions (id, user_id, type, coins, detail, created_at) VALUES ($1,$2,'transfer_in',$3,$4,$5)",
    [uuidv4(), toId, coins, 'تحويل من ' + fromName + ' (' + fromPublicId + ')', now]);
  return { ok: true, wallet: w };
}

async function getMyTransactions(userId) { return query('SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId]); }
async function getAllTransactions() { return query('SELECT * FROM coin_transactions ORDER BY created_at DESC LIMIT 100'); }
async function getMyGifts(userId) { return query('SELECT g.*, u.name as from_name FROM gifts g JOIN users u ON g.from_user = u.id WHERE g.to_user = $1 ORDER BY g.created_at DESC', [userId]); }
async function getGiftsByUser(userId) { return query('SELECT g.*, u.name as to_name FROM gifts g JOIN users u ON g.to_user = u.id WHERE g.from_user = $1 ORDER BY g.created_at DESC', [userId]); }

async function getPaymentSettings() {
  return {
    stcpay_enabled: await getSetting('stcpay_enabled', '1'),
    stcpay_number: await getSetting('stcpay_number', ''),
    bank_enabled: await getSetting('bank_enabled', '1'),
    bank_details: await getSetting('bank_details', ''),
  };
}
async function savePaymentSettings(settings) {
  if (settings.stcpay_enabled !== undefined) await setSetting('stcpay_enabled', settings.stcpay_enabled);
  if (settings.stcpay_number !== undefined) await setSetting('stcpay_number', settings.stcpay_number);
  if (settings.bank_enabled !== undefined) await setSetting('bank_enabled', settings.bank_enabled);
  if (settings.bank_details !== undefined) await setSetting('bank_details', settings.bank_details);
  return getPaymentSettings();
}
async function createPayment(userId, userName, gateway, amount, purpose, reference) {
  const id = uuidv4();
  await run("INSERT INTO payments (id, user_id, user_name, gateway, amount, purpose, reference) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, userId, userName, gateway, amount, purpose, reference || '']);
  return queryOne('SELECT * FROM payments WHERE id = $1', [id]);
}
async function getAllPayments() { return query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 100'); }
async function getMyPayments(userId) { return query('SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC', [userId]); }
async function confirmPayment(paymentId) { await run("UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [paymentId]); return queryOne('SELECT * FROM payments WHERE id = $1', [paymentId]); }
async function rejectPayment(paymentId) { await run("UPDATE payments SET status = 'rejected' WHERE id = $1", [paymentId]); return queryOne('SELECT * FROM payments WHERE id = $1', [paymentId]); }

async function setVideoLimit(sessionId, limit) {
  await run('UPDATE diwaniya_sessions SET video_limit = $1 WHERE id = $2', [limit, sessionId]);
  return queryOne('SELECT * FROM diwaniya_sessions WHERE id = $1', [sessionId]);
}

async function recordRecordingAttempt(userId) {
  await run('UPDATE users SET recording_attempts = recording_attempts + 1 WHERE id = $1', [userId]);
  const user = await queryOne('SELECT recording_attempts FROM users WHERE id = $1', [userId]);
  const attempts = user ? user.recording_attempts : 1;
  const reason = 'محاولة تصوير الشاشة (' + attempts + ' مرات)';
  
  // Ban thresholds: 3 -> 24h, 6 -> 28h, 7-10 -> 30 days
  let durationHours = null;
  if (attempts >= 7) durationHours = 720; // 30 days
  else if (attempts >= 6) durationHours = 28;
  else if (attempts >= 3) durationHours = 24;
  
  let banned = false;
  if (durationHours) {
    await banUser(userId, reason, durationHours, 'system');
    banned = true;
  }
  
  // Save as violation record (shows in admin + member logs)
  try {
    await run("INSERT INTO violations (id, user_id, reason, duration_hours, violation_type, evidence, created_by, banned_until) VALUES ($1,$2,$3,$4,'screen_recording','','system',$5)",
      [uuidv4(), userId, reason, durationHours || 0, durationHours ? new Date(Date.now() + durationHours * 3600000).toISOString() : null]);
  } catch(e) {}
  
  return { attempts, banned, durationHours, reason };
}

// Get violations for a specific user (member's own record)
async function getViolationsByUser(userId) {
  return query('SELECT * FROM violations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
}

async function getSecretRoomStatus(familyId) {
  const family = await queryOne('SELECT secret_room_enabled, secret_room_purchased_at FROM families WHERE id = $1', [familyId]);
  const price = parseInt(await getSetting('secret_room_price', '100'));
  return {
    enabled: family ? (family.secret_room_enabled == 1) : false,
    purchased_at: family ? family.secret_room_purchased_at : null,
    price: price
  };
}
async function enableSecretRoom(familyId) {
  await run("UPDATE families SET secret_room_enabled = 1, secret_room_purchased_at = now() WHERE id = $1", [familyId]);
  return getSecretRoomStatus(familyId);
}

async function getFamilyEditInfo(familyId) {
  const family = await queryOne('SELECT name_changed_at, name_changes_count FROM families WHERE id = $1', [familyId]);
  const price = parseInt(await getSetting('family_edit_price', '100'));
  const freeChanges = parseInt(await getSetting('family_free_changes', '3'));
  const intervalDays = parseInt(await getSetting('family_edit_interval_days', '90'));
  let daysLeft = 0;
  if (family && family.name_changed_at) {
    const last = new Date(family.name_changed_at);
    const diff = Date.now() - last.getTime();
    daysLeft = Math.max(0, intervalDays - Math.floor(diff / 86400000));
  }
  return { last_changed: family ? family.name_changed_at : null, changes_count: family ? family.name_changes_count : 0, free_changes: freeChanges, price, interval_days: intervalDays, days_left: daysLeft };
}
async function recordFamilyNameChange(familyId) { await run("UPDATE families SET name_changed_at = now(), name_changes_count = name_changes_count + 1 WHERE id = $1", [familyId]); }
async function getFamilyCapacity(familyId) { const f = await queryOne('SELECT diwaniya_capacity FROM families WHERE id = $1', [familyId]); return f ? (f.diwaniya_capacity || 15) : 15; }
async function purchaseCapacity(familyId, capacity) {
  const price = capacity === 20 ? 50 : (capacity === 40 ? 100 : 50);
  await run('INSERT INTO capacity_purchases (id, family_id, capacity, price) VALUES ($1,$2,$3,$4)', [uuidv4(), familyId, capacity, price]);
  await run('UPDATE families SET diwaniya_capacity = $1 WHERE id = $2', [capacity, familyId]);
  return getFamilyCapacity(familyId);
}
async function setDiwaniyaCapacity(familyId, capacity) {
  const current = await getFamilyCapacity(familyId);
  if (capacity > current) return { error: 'الحد الأقصى المشترى ' + current };
  await run('UPDATE families SET diwaniya_capacity = $1 WHERE id = $2', [capacity, familyId]);
  return { capacity };
}
async function getCapacityPackages() { return [{ capacity: 20, price: 50 }, { capacity: 40, price: 100 }]; }

// =============== ANNOUNCEMENTS ===============
async function createAnnouncement(familyId, createdBy, title, content, announceType, targetUserId, eventTime) {
  const id = uuidv4();
  await run('INSERT INTO announcements (id, family_id, created_by, title, content, announce_type, target_user_id, event_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, familyId, createdBy, title, content || '', announceType || 'text', targetUserId || null, eventTime || null]);
  return queryOne('SELECT * FROM announcements WHERE id = $1', [id]);
}
async function getFamilyAnnouncements(familyId) { return query("SELECT a.*, u.name as creator_name FROM announcements a JOIN users u ON a.created_by = u.id WHERE a.family_id = $1 AND a.status = 'active' ORDER BY a.created_at DESC", [familyId]); }
async function getAnnouncementsForUser(familyId, userId) { return query("SELECT a.*, u.name as creator_name FROM announcements a JOIN users u ON a.created_by = u.id WHERE a.family_id = $1 AND a.status = 'active' AND (a.target_user_id IS NULL OR a.target_user_id = $2) ORDER BY a.created_at DESC", [familyId, userId]); }
async function deleteAnnouncement(id) { await run("UPDATE announcements SET status = 'done' WHERE id = $1", [id]); return true; }

// =============== MISC ===============
async function execQuery(sql, params = []) { return query(sql, params); }
async function runRaw(sql, params = []) { await run(sql, params); }
async function getDbRaw() { return getPool(); }

module.exports = {
  getDb, initDb, queryAll, queryOne, run, execQuery, runRaw, getDbRaw,
  createUser, getUserByEmail, getUserById, getFamilyMembers, updateProfile, updateLastSeen, updatePassword, userHasFamily,
  createFamily, getFamily, validateSubscriptionCode, updateFamilyFounder, leaveFamily,
  generateSubscriptionCodes, generatePremiumCode, getAvailablePremiumCodes, purchaseCode, getUserCodes, getFirstAvailablePremiumCode, updatePrice,
  createInvitation, createInvitationByPhone, getInvitationsByFamily, getInvitationByToken, acceptInvitation,
  openDiwaniya, closeDiwaniya, getActiveDiwaniya, getDiwaniyaSessionById, verifyDiwaniyaCode, getDiwaniyaHistory, addDiwaniyaMessage, getDiwaniyaMessages,
  createChallenge, respondToChallenge, completeChallenge, getFamilyChallenges, getPendingChallenges, getFamilyLeaderboard,
  createAuction, getActiveAuctions, getAllAuctions, getAuctionById, joinAuction, placeBid, endAuction, confirmAuctionPayment, cancelAuction, getAuctionBids, isAuctionParticipant, getAvailableAuctionCodes,
  getAllFamilies, updateFamilyData, setFamilyStatus, deleteFamily, getAllUsersDetailed, updateUserByAdmin, deleteUserByAdmin, createAdminUser, createUserByRole, getAdminStats,
  getActiveAds, getAllAds, addAd, updateAd, deleteAd, trackAdView, trackAdClick, getAdsStats, getFeaturedFamilies,
  getUserFamilies, getUserFamilyCount, addUserToFamily, setCurrentFamily, getSetting, setSetting,
  lockDiwaniya, getDiwaniyaLock,
  getBannedWords, addBannedWord, deleteBannedWord, checkBannedWord, banUser, getActiveBan, getAllBans, unbanUser, setDiwaniyaManager, countDiwaniyaManagers,
  addViolation, getAllViolations, getViolationStats, getViolationsByUser, getModerationSettings, setModerationSetting,
  getAgreement, acceptAgreement, rejectAgreement, canOpenDiwaniya, getFamilyAgreements, getAllAgreements,
  addSupportMessage, getSupportMessages, deleteSupportMessage, countSupportMessages, createSupportTicket, getSupportTickets, getMyTickets, replyTicket, closeTicket,
  requestModeratorVisit, approveModeratorVisit, enterModeratorVisit, exitModeratorVisit, getModeratorVisits, getModeratorVisitsByUser, getPendingVisitByModerator, getFamiliesWithActiveDiwaniya,
  addModeratorStars, getModeratorProfile, rateModerator, getModeratorTier, updateModeratorTier, getTierSettings,
  getActivePackages, getAllPackages, addPackage, updatePackage, deletePackage, getPaymentSettings, savePaymentSettings, createPayment, getAllPayments, getMyPayments, confirmPayment, rejectPayment, getFamilyEditInfo, recordFamilyNameChange, getFamilyCapacity, purchaseCapacity, setDiwaniyaCapacity, getCapacityPackages,
  createAnnouncement, getFamilyAnnouncements, getAnnouncementsForUser, deleteAnnouncement,
  createBattle, getBattleById, getActiveBattle, acceptBattle, rejectBattle, supportBattle, endBattle, finalizeBattle, addFamilySupportPoints, getOnlineFounders,
  getEffects, getEffectById, addEffect, getUserEffects, buyEffect, selectEffect, addFamilyBattleWin,
  isDiwaniyaRestricted, restrictFromDiwaniya, unrestrictFromDiwaniya, getDiwaniyaRestrictions,
  seedViolationTemplates, getViolationTemplates, getAllViolationTemplates, addViolationTemplate, deleteViolationTemplate, addFounderViolation,
  getGiftItems, getAllGiftItems, addGiftItem, updateGiftItem, deleteGiftItem,
  getWallet, addCoins, deductCoins, sendGift, convertCoinsToWallet, getUserByPublicId, transferCoins, getCoinPackages, getAllCoinPackages, addCoinPackage, updateCoinPackage, deleteCoinPackage,
  requestWithdrawal, getMyWithdrawals, getAllWithdrawals, updateWithdrawal,
  getMyTransactions, getAllTransactions, getMyGifts, getGiftsByUser,
  getCurrencyRate, setCurrencyRate, getSecretRoomStatus, enableSecretRoom,
  recordRecordingAttempt, setVideoLimit,
};
