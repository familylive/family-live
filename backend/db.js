const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'family_app.db');
let db;
let SQL;

async function getDb() {
  if (!db) {
    SQL = await initSqlJs();
    
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
    
    db.run('PRAGMA foreign_keys = ON');
    initDb();
    saveDb();
  }
  return db;
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function initDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subscription_code TEXT NOT NULL UNIQUE,
      founder_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      diwaniya_locked_until TEXT,
      diwaniya_lock_reason TEXT,
      diwaniya_locked_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      phone TEXT,
      whatsapp TEXT,
      country TEXT,
      city TEXT,
      family_id TEXT,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('founder', 'member', 'admin', 'moderator')),
      avatar TEXT DEFAULT '👤',
      points INTEGER DEFAULT 0,
      stars INTEGER DEFAULT 0,
      moderator_tier TEXT DEFAULT 'none',
      last_seen TEXT,
      can_open_diwaniya INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (family_id) REFERENCES families(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'expired')),
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (family_id) REFERENCES families(id),
      FOREIGN KEY (invited_by) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS diwaniya_sessions (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      topic TEXT,
      mode TEXT NOT NULL DEFAULT 'text',
      FOREIGN KEY (family_id) REFERENCES families(id),
      FOREIGN KEY (opened_by) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS diwaniya_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES diwaniya_sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      game_type TEXT NOT NULL CHECK(game_type IN ('ludo', 'carrom', 'quiz', 'memory')),
      challenger_id TEXT NOT NULL,
      opponent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'completed', 'cancelled')),
      winner_id TEXT,
      points INTEGER DEFAULT 10,
      challenger_score INTEGER DEFAULT 0,
      opponent_score INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (family_id) REFERENCES families(id),
      FOREIGN KEY (challenger_id) REFERENCES users(id),
      FOREIGN KEY (opponent_id) REFERENCES users(id),
      FOREIGN KEY (winner_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS subscription_codes (
      code TEXT PRIMARY KEY,
      used INTEGER DEFAULT 0,
      family_id TEXT,
      type TEXT NOT NULL DEFAULT 'free' CHECK(type IN ('free', 'premium')),
      price INTEGER DEFAULT 0,
      purchased_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS ads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      image_url TEXT,
      link_url TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      position TEXT NOT NULL DEFAULT 'banner',
      start_time TEXT,
      end_time TEXT,
      views INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS auctions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      starting_price INTEGER NOT NULL DEFAULT 100,
      entry_fee INTEGER NOT NULL DEFAULT 50,
      current_price INTEGER NOT NULL DEFAULT 100,
      min_increment INTEGER NOT NULL DEFAULT 10,
      start_time TEXT DEFAULT (datetime('now')),
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended', 'cancelled')),
      winner_id TEXT,
      paid INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS auction_bids (
      id TEXT PRIMARY KEY,
      auction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (auction_id) REFERENCES auctions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS auction_participants (
      id TEXT PRIMARY KEY,
      auction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      paid_entry INTEGER DEFAULT 1,
      joined_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (auction_id) REFERENCES auctions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS user_families (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      is_current INTEGER DEFAULT 0,
      joined_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (family_id) REFERENCES families(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      announce_type TEXT NOT NULL DEFAULT 'text' CHECK(announce_type IN ('text', 'diwaniya', 'challenge', 'presence')),
      target_user_id TEXT,
      event_time TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'done')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (family_id) REFERENCES families(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS banned_words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS bans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT,
      duration_hours INTEGER DEFAULT 24,
      banned_until TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired')),
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS violations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      duration_hours INTEGER DEFAULT 24,
      violation_type TEXT NOT NULL DEFAULT 'text' CHECK(violation_type IN ('text', 'audio', 'video', 'image')),
      evidence TEXT,
      created_by TEXT,
      banned_until TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS agreements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      role_at_agreement TEXT NOT NULL DEFAULT 'member' CHECK(role_at_agreement IN ('founder', 'manager', 'member')),
      agreed INTEGER NOT NULL DEFAULT 0,
      agreed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS moderator_visits (
      id TEXT PRIMARY KEY,
      moderator_id TEXT NOT NULL,
      moderator_name TEXT,
      diwaniya_session_id TEXT,
      family_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'approved', 'entered', 'exited', 'rejected')),
      requested_at TEXT DEFAULT (datetime('now')),
      scheduled_at TEXT,
      entered_at TEXT,
      exit_at TEXT,
      report TEXT,
      FOREIGN KEY (moderator_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'answered', 'closed')),
      admin_reply TEXT,
      replied_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS moderator_ratings (
      id TEXT PRIMARY KEY,
      moderator_id TEXT NOT NULL,
      visit_id TEXT,
      family_id TEXT,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      rated_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (moderator_id) REFERENCES users(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS user_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'free',
      purchase_date TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

// Helper to run a query and return objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// User functions
function createUser(name, email, password, familyId, role = 'member') {
  const id = uuidv4();
  run('INSERT INTO users (id, name, email, password, family_id, role) VALUES (?, ?, ?, ?, ?, ?)', [id, name, email, password, familyId, role]);
  return queryOne('SELECT id, name, email, family_id, role, points, avatar, created_at FROM users WHERE id = ?', [id]);
}

function getUserByEmail(email) {
  return queryOne('SELECT * FROM users WHERE email = ?', [email]);
}

function getUserById(id) {
  return queryOne('SELECT id, name, email, phone, whatsapp, country, city, family_id, role, avatar, points, created_at FROM users WHERE id = ?', [id]);
}

function getFamilyMembers(familyId) {
  return queryAll('SELECT id, name, email, phone, whatsapp, role, avatar, points, last_seen FROM users WHERE family_id = ? ORDER BY role DESC, points DESC', [familyId]);
}

// Family functions
function createFamily(name, subscriptionCode) {
  const id = uuidv4();
  const code = queryOne('SELECT * FROM subscription_codes WHERE code = ? AND (used = 0 OR used IS NULL)', [subscriptionCode]);
  if (!code) return null;
  run('INSERT INTO families (id, name, subscription_code) VALUES (?, ?, ?)', [id, name, subscriptionCode]);
  run("UPDATE subscription_codes SET used = 1, family_id = ? WHERE code = ?", [id, subscriptionCode]);
  return queryOne('SELECT * FROM families WHERE id = ?', [id]);
}

function getFamily(id) {
  return queryOne('SELECT * FROM families WHERE id = ?', [id]);
}

function validateSubscriptionCode(code) {
  return queryOne('SELECT * FROM subscription_codes WHERE code = ? AND (used = 0 OR used IS NULL)', [code]);
}

// Invitation functions
function createInvitation(familyId, email, invitedBy) {
  const id = uuidv4();
  const token = uuidv4();
  const existing = queryOne('SELECT * FROM invitations WHERE family_id = ? AND email = ? AND status = ?', [familyId, email, 'pending']);
  if (existing) return null;
  run('INSERT INTO invitations (id, family_id, email, invited_by, token) VALUES (?, ?, ?, ?, ?)', [id, familyId, email, invitedBy, token]);
  return queryOne('SELECT * FROM invitations WHERE id = ?', [id]);
}

function getInvitationsByFamily(familyId) {
  return queryAll(
    'SELECT i.*, u.name as invited_by_name FROM invitations i JOIN users u ON i.invited_by = u.id WHERE i.family_id = ? ORDER BY i.created_at DESC',
    [familyId]
  );
}

function getInvitationByToken(token) {
  return queryOne('SELECT * FROM invitations WHERE token = ? AND status = ?', [token, 'pending']);
}

function acceptInvitation(token, userId) {
  const inv = queryOne('SELECT * FROM invitations WHERE token = ? AND status = ?', [token, 'pending']);
  if (!inv) return null;
  run('UPDATE invitations SET status = ? WHERE id = ?', ['accepted', inv.id]);
  run('UPDATE users SET family_id = ? WHERE id = ?', [inv.family_id, userId]);
  addUserToFamily(userId, inv.family_id, 1);
  setCurrentFamily(userId, inv.family_id);
  return inv;
}

// Diwaniya functions
function openDiwaniya(familyId, userId, durationMinutes, topic = '', mode = 'text') {
  const today = new Date().toISOString().split('T')[0];
  const existingSessions = queryAll("SELECT * FROM diwaniya_sessions WHERE family_id = ? AND opened_at LIKE ? AND status = 'closed'", [familyId, today + '%']);
  const totalMinutes = existingSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
  const maxDaily = 60;
  if (totalMinutes + durationMinutes > maxDaily) {
    return { error: 'المدة الإجمالية لليوم لا تتجاوز ساعة. المتبقي: ' + (maxDaily - totalMinutes) + ' دقيقة' };
  }
  const id = uuidv4();
  run("INSERT INTO diwaniya_sessions (id, family_id, opened_by, duration_minutes, status, topic, mode) VALUES (?, ?, ?, ?, 'open', ?, ?)", [id, familyId, userId, durationMinutes, topic, mode]);
  return queryOne('SELECT * FROM diwaniya_sessions WHERE id = ?', [id]);
}

function closeDiwaniya(sessionId) {
  const session = queryOne("SELECT * FROM diwaniya_sessions WHERE id = ? AND status = 'open'", [sessionId]);
  if (!session) return null;
  run("UPDATE diwaniya_sessions SET status = 'closed', closed_at = datetime('now') WHERE id = ?", [sessionId]);
  return queryOne('SELECT * FROM diwaniya_sessions WHERE id = ?', [sessionId]);
}

function getActiveDiwaniya(familyId) {
  return queryOne("SELECT * FROM diwaniya_sessions WHERE family_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1", [familyId]);
}

function getDiwaniyaHistory(familyId) {
  return queryAll('SELECT ds.*, u.name as opened_by_name FROM diwaniya_sessions ds JOIN users u ON ds.opened_by = u.id WHERE ds.family_id = ? ORDER BY ds.opened_at DESC LIMIT 20', [familyId]);
}

function addDiwaniyaMessage(sessionId, userId, message) {
  const id = uuidv4();
  run('INSERT INTO diwaniya_messages (id, session_id, user_id, message) VALUES (?, ?, ?, ?)', [id, sessionId, userId, message]);
  return queryOne('SELECT dm.*, u.name as user_name, u.avatar FROM diwaniya_messages dm JOIN users u ON dm.user_id = u.id WHERE dm.id = ?', [id]);
}

function getDiwaniyaMessages(sessionId) {
  return queryAll('SELECT dm.*, u.name as user_name, u.avatar FROM diwaniya_messages dm JOIN users u ON dm.user_id = u.id WHERE dm.session_id = ? ORDER BY dm.created_at ASC', [sessionId]);
}

// Challenge functions
function createChallenge(familyId, gameType, challengerId, opponentId, points = 10) {
  const id = uuidv4();
  run('INSERT INTO challenges (id, family_id, game_type, challenger_id, opponent_id, points) VALUES (?, ?, ?, ?, ?, ?)', [id, familyId, gameType, challengerId, opponentId, points]);
  return getChallengeById(id);
}

function getChallengeById(id) {
  return queryOne(
    'SELECT c.*, u1.name as challenger_name, u2.name as opponent_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id WHERE c.id = ?',
    [id]
  );
}

function respondToChallenge(challengeId, userId, accept) {
  const challenge = queryOne("SELECT * FROM challenges WHERE id = ? AND status = 'pending'", [challengeId]);
  if (!challenge || challenge.opponent_id !== userId) return null;
  const status = accept ? 'accepted' : 'rejected';
  run('UPDATE challenges SET status = ? WHERE id = ?', [status, challengeId]);
  return getChallengeById(challengeId);
}

function completeChallenge(challengeId, winnerId, challengerScore, opponentScore) {
  const challenge = queryOne("SELECT * FROM challenges WHERE id = ? AND status = 'accepted'", [challengeId]);
  if (!challenge) return null;
  run("UPDATE challenges SET status = 'completed', winner_id = ?, challenger_score = ?, opponent_score = ?, completed_at = datetime('now') WHERE id = ?",
    [winnerId, challengerScore, opponentScore, challengeId]);
  if (winnerId) {
    run('UPDATE users SET points = points + ? WHERE id = ?', [challenge.points, winnerId]);
    const loserId = winnerId === challenge.challenger_id ? challenge.opponent_id : challenge.challenger_id;
    run('UPDATE users SET points = points + ? WHERE id = ?', [Math.floor(challenge.points / 2), loserId]);
  }
  return queryOne(
    'SELECT c.*, u1.name as challenger_name, u2.name as opponent_name, uw.name as winner_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id LEFT JOIN users uw ON c.winner_id = uw.id WHERE c.id = ?',
    [challengeId]
  );
}

function getFamilyChallenges(familyId) {
  return queryAll(
    'SELECT c.*, u1.name as challenger_name, u2.name as opponent_name, uw.name as winner_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id LEFT JOIN users uw ON c.winner_id = uw.id WHERE c.family_id = ? ORDER BY c.created_at DESC LIMIT 50',
    [familyId]
  );
}

function getPendingChallenges(userId) {
  return queryAll(
    "SELECT c.*, u1.name as challenger_name, u2.name as opponent_name FROM challenges c JOIN users u1 ON c.challenger_id = u1.id JOIN users u2 ON c.opponent_id = u2.id WHERE c.opponent_id = ? AND c.status = 'pending' ORDER BY c.created_at DESC",
    [userId]
  );
}

function getFamilyLeaderboard(familyId) {
  return queryAll(`
    SELECT id, name, avatar, points, role,
      (SELECT COUNT(*) FROM challenges WHERE (challenger_id = users.id OR opponent_id = users.id) AND winner_id = users.id) as wins,
      (SELECT COUNT(*) FROM challenges WHERE (challenger_id = users.id OR opponent_id = users.id) AND status = 'completed') as total_games
    FROM users WHERE family_id = ? ORDER BY points DESC
  `, [familyId]);
}

function generateSubscriptionCodes(count = 5) {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) code += chars[Math.floor(Math.random() * chars.length)];
    try {
      run('INSERT OR IGNORE INTO subscription_codes (code, type, price) VALUES (?, ?, ?)', [code, 'free', 0]);
      codes.push(code);
    } catch(e) { /* ignore duplicates */ }
  }
  return codes;
}

function generatePremiumCode() {
  // All English letters A-Z repeated 8 times + digits 0-9 repeated 8 times
  const patterns = [];
  for (let i = 0; i < 26; i++) {
    patterns.push(String.fromCharCode(65 + i).repeat(8));
  }
  for (let i = 0; i < 10; i++) {
    patterns.push(String(i).repeat(8));
  }
  
  for (const pattern of patterns) {
    const existing = queryOne('SELECT * FROM subscription_codes WHERE code = ?', [pattern]);
    if (!existing) {
      run("INSERT INTO subscription_codes (code, type, price) VALUES (?, 'premium', 200)", [pattern]);
      return pattern;
    }
  }
  return 'NONE';
}

function getAvailablePremiumCodes() {
  return queryAll("SELECT * FROM subscription_codes WHERE type = 'premium' AND (used = 0 OR used IS NULL) AND purchased_by IS NULL");
}

function purchaseCode(userId, code) {
  const c = queryOne("SELECT * FROM subscription_codes WHERE code = ? AND type = 'premium' AND (used = 0 OR used IS NULL) AND purchased_by IS NULL", [code]);
  if (!c) return null;
  run('UPDATE subscription_codes SET purchased_by = ?, used = 1 WHERE code = ?', [userId, code]);
  run('INSERT OR IGNORE INTO user_codes (id, user_id, code, type) VALUES (?, ?, ?, ?)', [uuidv4(), userId, code, 'premium']);
  return queryOne('SELECT * FROM subscription_codes WHERE code = ?', [code]);
}

function getUserCodes(userId) {
  return queryAll('SELECT * FROM user_codes WHERE user_id = ? ORDER BY purchase_date DESC', [userId]);
}

function userHasFamily(userId) {
  const user = queryOne('SELECT family_id, role FROM users WHERE id = ?', [userId]);
  return user && user.family_id && user.role === 'founder';
}

function updatePassword(email, newPassword) {
  run('UPDATE users SET password = ? WHERE email = ?', [newPassword, email]);
}

function updateFamilyFounder(familyId, userId) {
  run('UPDATE families SET founder_id = ? WHERE id = ?', [userId, familyId]);
}

function getFirstAvailablePremiumCode() {
  const r = queryOne("SELECT code FROM subscription_codes WHERE used = 0 AND type = 'premium' LIMIT 1");
  return r ? r.code : null;
}

// =============== ADMIN FUNCTIONS ===============
function getUserFamilies(userId) {
  return queryAll(`
    SELECT uf.*, f.name as family_name, f.subscription_code
    FROM user_families uf
    JOIN families f ON uf.family_id = f.id
    WHERE uf.user_id = ?
    ORDER BY uf.joined_at DESC
  `, [userId]);
}

function getUserFamilyCount(userId) {
  const r = queryOne('SELECT COUNT(*) as c FROM user_families WHERE user_id = ?', [userId]);
  return r ? r.c : 0;
}

function addUserToFamily(userId, familyId, isCurrent = 0) {
  const existing = queryOne('SELECT * FROM user_families WHERE user_id = ? AND family_id = ?', [userId, familyId]);
  if (existing) return false;
  run('INSERT INTO user_families (id, user_id, family_id, is_current) VALUES (?, ?, ?, ?)', [uuidv4(), userId, familyId, isCurrent]);
  return true;
}

function setCurrentFamily(userId, familyId) {
  run('UPDATE user_families SET is_current = 0 WHERE user_id = ?', [userId]);
  run('UPDATE user_families SET is_current = 1 WHERE user_id = ? AND family_id = ?', [userId, familyId]);
}

function getSetting(key, def) {
  const r = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return r ? r.value : def;
}

function setSetting(key, value) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
}

// =============== DIWANIYA LOCKDOWN ===============
function lockDiwaniya(familyId, untilIso, reason, lockedByName) {
  run('UPDATE families SET diwaniya_locked_until = ?, diwaniya_lock_reason = ?, diwaniya_locked_by = ? WHERE id = ?',
    [untilIso, reason, lockedByName, familyId]);
}

function getDiwaniyaLock(familyId) {
  const family = queryOne('SELECT diwaniya_locked_until, diwaniya_lock_reason, diwaniya_locked_by FROM families WHERE id = ?', [familyId]);
  if (!family || !family.diwaniya_locked_until) return null;
  const now = new Date().toISOString();
  if (family.diwaniya_locked_until <= now) {
    // Lock expired - clear it
    run('UPDATE families SET diwaniya_locked_until = NULL, diwaniya_lock_reason = NULL, diwaniya_locked_by = NULL WHERE id = ?', [familyId]);
    return null;
  }
  return {
    locked_until: family.diwaniya_locked_until,
    reason: family.diwaniya_lock_reason,
    locked_by: family.diwaniya_locked_by
  };
}

// =============== AGREEMENTS ===============
function getAgreement(userId) {
  return queryOne('SELECT * FROM agreements WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
}
function acceptAgreement(userId, familyId, role) {
  const existing = getAgreement(userId);
  if (existing && existing.agreed == 1) return existing;
  if (existing && existing.agreed == 0) return existing; // rejected - permanent
  const id = uuidv4();
  run("INSERT INTO agreements (id, user_id, family_id, role_at_agreement, agreed, agreed_at) VALUES (?, ?, ?, ?, 1, datetime('now'))",
    [id, userId, familyId, role]);
  return queryOne('SELECT * FROM agreements WHERE id = ?', [id]);
}
function rejectAgreement(userId, familyId, role) {
  const existing = getAgreement(userId);
  if (existing) return existing; // permanent - cannot change
  const id = uuidv4();
  run("INSERT INTO agreements (id, user_id, family_id, role_at_agreement, agreed, agreed_at) VALUES (?, ?, ?, ?, 0, datetime('now'))",
    [id, userId, familyId, role]);
  return queryOne('SELECT * FROM agreements WHERE id = ?', [id]);
}
function canOpenDiwaniya(userId) {
  const ag = getAgreement(userId);
  if (!ag) return true; // not decided yet - show terms
  return ag.agreed == 1;
}
function getFamilyAgreements(familyId) {
  return queryAll(`
    SELECT a.*, u.name as user_name, u.role as user_role
    FROM agreements a
    JOIN users u ON a.user_id = u.id
    WHERE a.family_id = ?
    ORDER BY a.role_at_agreement, a.created_at DESC
  `, [familyId]);
}
function getAllAgreements() {
  return queryAll(`
    SELECT a.*, u.name as user_name, u.email as user_email, u.role as user_role, f.name as family_name
    FROM agreements a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN families f ON a.family_id = f.id
    ORDER BY a.role_at_agreement, a.created_at DESC
  `);
}

// =============== USERS MANAGEMENT & MODERATOR VISITS ===============
function getAllUsersDetailed() {
  return queryAll(`
    SELECT u.id, u.name, u.email, u.phone, u.whatsapp, u.country, u.city, u.role, u.points, u.last_seen,
      u.can_open_diwaniya, f.name as family_name, f.subscription_code
    FROM users u
    LEFT JOIN families f ON u.family_id = f.id
    ORDER BY u.role, u.name
  `);
}

function updateUserByAdmin(userId, data) {
  const { name, email, whatsapp, phone, role } = data;
  if (name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', [name, userId]);
  if (email !== undefined) {
    const exists = queryOne('SELECT * FROM users WHERE email = ? AND id != ?', [email, userId]);
    if (exists) return { error: 'البريد مستخدم من شخص آخر' };
    run('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
  }
  if (whatsapp !== undefined) run('UPDATE users SET whatsapp = ? WHERE id = ?', [whatsapp, userId]);
  if (phone !== undefined) run('UPDATE users SET phone = ? WHERE id = ?', [phone, userId]);
  if (role !== undefined && ['admin', 'moderator', 'founder', 'member'].includes(role)) {
    run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
  }
  return queryOne('SELECT id, name, email, phone, whatsapp, role, points FROM users WHERE id = ?', [userId]);
}

function deleteUserByAdmin(userId) {
  run('DELETE FROM users WHERE id = ?', [userId]);
  return true;
}

// Moderator visits
function requestModeratorVisit(moderatorId, moderatorName, familyId, reason) {
  const id = uuidv4();
  const scheduledAt = new Date(Date.now() + 60000).toISOString(); // +1 minute
  run("INSERT INTO moderator_visits (id, moderator_id, moderator_name, family_id, reason, status, scheduled_at) VALUES (?, ?, ?, ?, ?, 'requested', ?)",
    [id, moderatorId, moderatorName, familyId, reason, scheduledAt]);
  return queryOne('SELECT * FROM moderator_visits WHERE id = ?', [id]);
}
function approveModeratorVisit(visitId, sessionId) {
  run("UPDATE moderator_visits SET status = 'approved', diwaniya_session_id = ? WHERE id = ?", [sessionId, visitId]);
  return queryOne('SELECT * FROM moderator_visits WHERE id = ?', [visitId]);
}
function enterModeratorVisit(visitId) {
  run("UPDATE moderator_visits SET status = 'entered', entered_at = datetime('now') WHERE id = ?", [visitId]);
  return queryOne('SELECT * FROM moderator_visits WHERE id = ?', [visitId]);
}
function exitModeratorVisit(visitId, report) {
  run("UPDATE moderator_visits SET status = 'exited', exit_at = datetime('now'), report = ? WHERE id = ?", [report || '', visitId]);
  return queryOne('SELECT * FROM moderator_visits WHERE id = ?', [visitId]);
}
function getFamiliesWithActiveDiwaniya() {
  return queryAll(`
    SELECT DISTINCT f.id, f.name, f.subscription_code, ds.duration_minutes, ds.opened_at, ds.topic,
      u.name as founder_name
    FROM diwaniya_sessions ds
    JOIN families f ON ds.family_id = f.id
    LEFT JOIN users u ON f.founder_id = u.id
    WHERE ds.status = 'open'
    ORDER BY ds.opened_at DESC
  `);
}

function getModeratorVisits() {
  return queryAll('SELECT * FROM moderator_visits ORDER BY requested_at DESC LIMIT 50');
}
function getModeratorVisitsByUser(userId) {
  return queryAll('SELECT * FROM moderator_visits WHERE moderator_id = ? ORDER BY requested_at DESC LIMIT 20', [userId]);
}
function getPendingVisitByModerator(userId) {
  return queryOne("SELECT * FROM moderator_visits WHERE moderator_id = ? AND status IN ('requested', 'approved', 'entered') ORDER BY requested_at DESC LIMIT 1", [userId]);
}

// =============== SUPPORT SYSTEM ===============
function addSupportMessage(title, content) {
  const id = uuidv4();
  run('INSERT INTO support_messages (id, title, content) VALUES (?, ?, ?)', [id, title, content]);
  return queryOne('SELECT * FROM support_messages WHERE id = ?', [id]);
}
function getSupportMessages() {
  return queryAll('SELECT * FROM support_messages ORDER BY created_at DESC');
}
function deleteSupportMessage(id) {
  run('DELETE FROM support_messages WHERE id = ?', [id]);
  return true;
}

function createSupportTicket(userId, userName, subject, message) {
  const id = uuidv4();
  run('INSERT INTO support_tickets (id, user_id, user_name, subject, message) VALUES (?, ?, ?, ?, ?)',
    [id, userId, userName, subject, message]);
  return queryOne('SELECT * FROM support_tickets WHERE id = ?', [id]);
}
function getSupportTickets() {
  return queryAll('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 100');
}
function getMyTickets(userId) {
  return queryAll('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}
function replyTicket(ticketId, adminReply) {
  run("UPDATE support_tickets SET status = 'answered', admin_reply = ?, replied_at = datetime('now') WHERE id = ?", [adminReply, ticketId]);
  return queryOne('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
}
function closeTicket(ticketId) {
  run("UPDATE support_tickets SET status = 'closed' WHERE id = ?", [ticketId]);
  return queryOne('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
}

// =============== MODERATOR STARS & TIERS ===============
function addModeratorStars(userId, stars) {
  run('UPDATE users SET stars = stars + ? WHERE id = ?', [stars, userId]);
  return getModeratorProfile(userId);
}

function getModeratorProfile(userId) {
  const user = queryOne('SELECT id, name, email, stars, moderator_tier, points, created_at FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const visits = queryOne("SELECT COUNT(*) as c FROM moderator_visits WHERE moderator_id = ? AND status = 'exited'", [userId]);
  const ratings = queryAll('SELECT rating FROM moderator_ratings WHERE moderator_id = ?', [userId]);
  const avg = ratings.length ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1) : 0;
  return { ...user, visits: visits ? visits.c : 0, ratings_count: ratings.length, avg_rating: avg };
}

function rateModerator(moderatorId, visitId, familyId, rating, comment, ratedBy) {
  run('INSERT INTO moderator_ratings (id, moderator_id, visit_id, family_id, rating, comment, rated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), moderatorId, visitId, familyId, rating, comment || '', ratedBy]);
  return queryOne('SELECT * FROM moderator_ratings WHERE id = (SELECT MAX(rowid) FROM moderator_ratings)');
}

// Tier calculation based on settings
function getModeratorTier(stars) {
  const t1 = parseInt(getSetting('tier_black', '1000'));
  const t2 = parseInt(getSetting('tier_blue', '5000'));
  const t3 = parseInt(getSetting('tier_silver', '10000'));
  const t4 = parseInt(getSetting('tier_gold', '20000'));
  const t5 = parseInt(getSetting('tier_platinum', '40000'));
  if (stars >= t5) return 'platinum';
  if (stars >= t4) return 'gold';
  if (stars >= t3) return 'silver';
  if (stars >= t2) return 'blue';
  if (stars >= t1) return 'black';
  return 'none';
}

function updateModeratorTier(userId, tier) {
  run('UPDATE users SET moderator_tier = ? WHERE id = ?', [tier, userId]);
  return getUserById(userId);
}

function getTierSettings() {
  return {
    black: parseInt(getSetting('tier_black', '1000')),
    blue: parseInt(getSetting('tier_blue', '5000')),
    silver: parseInt(getSetting('tier_silver', '10000')),
    gold: parseInt(getSetting('tier_gold', '20000')),
    platinum: parseInt(getSetting('tier_platinum', '40000')),
    stars_per_visit: parseInt(getSetting('stars_per_visit', '10')),
    stars_per_500_visits: parseInt(getSetting('stars_per_500_visits', '5000')),
  };
}

// =============== MODERATION ===============
function getBannedWords() {
  return queryAll('SELECT * FROM banned_words ORDER BY created_at DESC');
}
function addBannedWord(word) {
  try {
    run('INSERT OR IGNORE INTO banned_words (id, word) VALUES (?, ?)', [uuidv4(), word.toLowerCase().trim()]);
    return queryOne('SELECT * FROM banned_words WHERE word = ?', [word.toLowerCase().trim()]);
  } catch(e) { return null; }
}
function deleteBannedWord(id) {
  run('DELETE FROM banned_words WHERE id = ?', [id]);
  return true;
}
function checkBannedWord(text) {
  const words = getBannedWords();
  if (!words.length) return null;
  const lower = (text || '').toLowerCase();
  for (const w of words) {
    if (lower.includes(w.word.toLowerCase())) return w.word;
  }
  return null;
}

function banUser(userId, reason, durationHours, createdBy) {
  const id = uuidv4();
  const until = new Date(Date.now() + durationHours * 3600000).toISOString();
  run("UPDATE bans SET status = 'expired' WHERE user_id = ? AND status = 'active'", [userId]);
  run('INSERT INTO bans (id, user_id, reason, duration_hours, banned_until, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, reason, durationHours, until, createdBy]);
  return queryOne('SELECT * FROM bans WHERE id = ?', [id]);
}
function getActiveBan(userId) {
  const ban = queryOne("SELECT * FROM bans WHERE user_id = ? AND status = 'active'", [userId]);
  if (!ban) return null;
  const now = new Date().toISOString();
  if (ban.banned_until <= now) {
    run("UPDATE bans SET status = 'expired' WHERE id = ?", [ban.id]);
    return null;
  }
  return ban;
}
function getAllBans() {
  return queryAll(`
    SELECT b.*, u.name as user_name, u.email as user_email
    FROM bans b
    JOIN users u ON b.user_id = u.id
    WHERE b.status = 'active'
    ORDER BY b.created_at DESC
  `);
}
function unbanUser(userId) {
  run("UPDATE bans SET status = 'expired' WHERE user_id = ? AND status = 'active'", [userId]);
  return true;
}

// =============== VIOLATIONS (AI EMPLOYEE SYSTEM) ===============
function addViolation(userId, reason, durationHours, violationType, evidence, createdBy) {
  const id = uuidv4();
  const bannedUntil = new Date(Date.now() + durationHours * 3600000).toISOString();
  run('INSERT INTO violations (id, user_id, reason, duration_hours, violation_type, evidence, created_by, banned_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, reason, durationHours, violationType, evidence || '', createdBy, bannedUntil]);
  // Auto-ban the user
  run("UPDATE bans SET status = 'expired' WHERE user_id = ? AND status = 'active'", [userId]);
  run('INSERT INTO bans (id, user_id, reason, duration_hours, banned_until, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), userId, reason, durationHours, bannedUntil, createdBy]);
  return queryOne('SELECT * FROM violations WHERE id = ?', [id]);
}

function getAllViolations() {
  return queryAll(`
    SELECT v.*, u.name as user_name, u.email as user_email
    FROM violations v
    JOIN users u ON v.user_id = u.id
    ORDER BY v.created_at DESC LIMIT 50
  `);
}

function getViolationStats() {
  const total = queryOne('SELECT COUNT(*) as c FROM violations');
  const text = queryOne("SELECT COUNT(*) as c FROM violations WHERE violation_type = 'text'");
  const audio = queryOne("SELECT COUNT(*) as c FROM violations WHERE violation_type = 'audio'");
  const video = queryOne("SELECT COUNT(*) as c FROM violations WHERE violation_type = 'video'");
  return {
    total: total ? total.c : 0,
    text: text ? text.c : 0,
    audio: audio ? audio.c : 0,
    video: video ? video.c : 0,
  };
}

function getModerationSettings() {
  return {
    ai_monitor_enabled: getSetting('ai_monitor_enabled', '1'),
    auto_ban_after: getSetting('auto_ban_after', '3'),
    ai_employee_name: getSetting('ai_employee_name', 'موظف الذكاء الاصطناعي'),
  };
}

function setModerationSetting(key, value) {
  setSetting(key, value);
}

// Diwaniya managers
function setDiwaniyaManager(userId, canOpen) {
  run('UPDATE users SET can_open_diwaniya = ? WHERE id = ?', [canOpen ? 1 : 0, userId]);
  return getUserById(userId);
}
function countDiwaniyaManagers(familyId) {
  const r = queryOne('SELECT COUNT(*) as c FROM users WHERE family_id = ? AND can_open_diwaniya = 1', [familyId]);
  return r ? r.c : 0;
}

function updateLastSeen(userId) {
  run("UPDATE users SET last_seen = datetime('now') WHERE id = ?", [userId]);
}

function getLastSeen(userId) {
  const r = queryOne('SELECT last_seen FROM users WHERE id = ?', [userId]);
  return r ? r.last_seen : null;
}

// Announcements
function createAnnouncement(familyId, createdBy, title, content, announceType, targetUserId, eventTime) {
  const id = uuidv4();
  run('INSERT INTO announcements (id, family_id, created_by, title, content, announce_type, target_user_id, event_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, familyId, createdBy, title, content || '', announceType || 'text', targetUserId || null, eventTime || null]);
  return queryOne('SELECT * FROM announcements WHERE id = ?', [id]);
}
function getFamilyAnnouncements(familyId) {
  return queryAll(`
    SELECT a.*, u.name as creator_name
    FROM announcements a
    JOIN users u ON a.created_by = u.id
    WHERE a.family_id = ? AND a.status = 'active'
    ORDER BY a.created_at DESC
  `, [familyId]);
}
function getAnnouncementsForUser(familyId, userId) {
  return queryAll(`
    SELECT a.*, u.name as creator_name
    FROM announcements a
    JOIN users u ON a.created_by = u.id
    WHERE a.family_id = ? AND a.status = 'active'
      AND (a.target_user_id IS NULL OR a.target_user_id = ?)
    ORDER BY a.created_at DESC
  `, [familyId, userId]);
}
function deleteAnnouncement(id) {
  run("UPDATE announcements SET status = 'done' WHERE id = ?", [id]);
  return true;
}

function updateProfile(userId, data) {
  const { name, country, city, phone, whatsapp, avatar } = data;
  if (name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', [name, userId]);
  if (country !== undefined) run('UPDATE users SET country = ? WHERE id = ?', [country, userId]);
  if (city !== undefined) run('UPDATE users SET city = ? WHERE id = ?', [city, userId]);
  if (phone !== undefined) run('UPDATE users SET phone = ? WHERE id = ?', [phone, userId]);
  if (whatsapp !== undefined) run('UPDATE users SET whatsapp = ? WHERE id = ?', [whatsapp, userId]);
  if (avatar !== undefined) run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, userId]);
  return getUserById(userId);
}

function leaveFamily(userId) {
  const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user || !user.family_id) return { error: 'أنت لست في عائلة' };
  const family = queryOne('SELECT * FROM families WHERE id = ?', [user.family_id]);
  // Remove from user_families
  run('DELETE FROM user_families WHERE user_id = ? AND family_id = ?', [userId, user.family_id]);
  // If founder leaves, remove founder
  run('UPDATE users SET family_id = NULL, role = ? WHERE id = ?', ['member', userId]);
  if (user.role === 'founder') {
    run('UPDATE families SET founder_id = NULL WHERE id = ?', [user.family_id]);
  }
  return { success: true, family_name: family ? family.name : '' };
}

function createAdminUser(email, password, name = 'مدير التطبيق') {
  const existing = queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (existing) return existing;
  const id = uuidv4();
  run("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, 'admin')", [id, name, email, password]);
  return queryOne('SELECT id, name, email, role FROM users WHERE id = ?', [id]);
}

// =============== ADS FUNCTIONS ===============
function getActiveAds() {
  const now = new Date().toISOString();
  return queryAll("SELECT * FROM ads WHERE status = 'active' AND (start_time IS NULL OR start_time <= ?) AND (end_time IS NULL OR end_time >= ?) ORDER BY created_at DESC", [now, now]);
}
function getAllAds() {
  return queryAll('SELECT * FROM ads ORDER BY created_at DESC');
}
function trackAdView(id) {
  run('UPDATE ads SET views = views + 1 WHERE id = ?', [id]);
}
function trackAdClick(id) {
  run('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [id]);
}
function getAdsStats() {
  const r = queryOne('SELECT COUNT(*) as total, SUM(views) as views, SUM(clicks) as clicks FROM ads');
  return { total: r ? r.total || 0 : 0, views: r ? r.views || 0 : 0, clicks: r ? r.clicks || 0 : 0 };
}
function addAd(title, imageUrl, linkUrl, position = 'banner', startTime = null, endTime = null) {
  const id = uuidv4();
  run('INSERT INTO ads (id, title, image_url, link_url, position, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, title, imageUrl || '', linkUrl || '', position, startTime, endTime]);
  return queryOne('SELECT * FROM ads WHERE id = ?', [id]);
}
function updateAd(id, title, imageUrl, linkUrl, status, startTime, endTime) {
  run('UPDATE ads SET title = ?, image_url = ?, link_url = ?, status = ?, start_time = ?, end_time = ? WHERE id = ?', [title, imageUrl || '', linkUrl || '', status, startTime, endTime, id]);
  return queryOne('SELECT * FROM ads WHERE id = ?', [id]);
}
function deleteAd(id) {
  run('DELETE FROM ads WHERE id = ?', [id]);
  return true;
}
function getFeaturedFamilies(limit = 5) {
  return queryAll(`
    SELECT f.id, f.name, f.subscription_code, 
      (SELECT COUNT(*) FROM users WHERE family_id = f.id) as members_count,
      u.name as founder_name
    FROM families f
    LEFT JOIN users u ON f.founder_id = u.id
    WHERE f.status = 'active'
    ORDER BY members_count DESC LIMIT ?
  `, [limit]);
}

// =============== AUCTION FUNCTIONS ===============
function createAuction(code, startingPrice, entryFee, durationMinutes, minIncrement, createdBy) {
  // Check code exists and is not already used in another auction
  const codeCheck = queryOne('SELECT * FROM subscription_codes WHERE code = ?', [code]);
  if (!codeCheck) {
    // Create the premium code if it doesn't exist
    run("INSERT INTO subscription_codes (code, type, price) VALUES (?, 'premium', ?)", [code, startingPrice]);
  } else if (codeCheck.used == 1) {
    return { error: 'هذا الرمز مستخدم مسبقاً، اختر رمزاً آخر' };
  }
  
  // Check code not in another active auction
  const inAuction = queryOne("SELECT * FROM auctions WHERE code = ? AND status = 'active'", [code]);
  if (inAuction) return { error: 'هذا الرمز في مزاد نشط بالفعل' };
  
  const id = uuidv4();
  const endTime = new Date(Date.now() + durationMinutes * 60000).toISOString();
  run('INSERT INTO auctions (id, code, starting_price, entry_fee, current_price, min_increment, end_time, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, code, startingPrice, entryFee, startingPrice, minIncrement, endTime, createdBy]);
  // Mark code as reserved (used in auction)
  run("UPDATE subscription_codes SET used = 1 WHERE code = ?", [code]);
  return queryOne('SELECT * FROM auctions WHERE id = ?', [id]);
}

function getActiveAuctions() {
  const now = new Date().toISOString();
  // Auto-end expired auctions
  run("UPDATE auctions SET status = 'ended' WHERE status = 'active' AND end_time < ?", [now]);
  return queryAll(`
    SELECT a.*, u.name as winner_name
    FROM auctions a
    LEFT JOIN users u ON a.winner_id = u.id
    WHERE a.status = 'active'
    ORDER BY a.created_at DESC
  `);
}

function getAllAuctions() {
  return queryAll(`
    SELECT a.*, u.name as winner_name
    FROM auctions a
    LEFT JOIN users u ON a.winner_id = u.id
    ORDER BY a.created_at DESC LIMIT 30
  `);
}

function getAuctionById(id) {
  return queryOne(`
    SELECT a.*, u.name as winner_name
    FROM auctions a
    LEFT JOIN users u ON a.winner_id = u.id
    WHERE a.id = ?
  `, [id]);
}

function joinAuction(auctionId, userId) {
  // Check if already joined
  const existing = queryOne('SELECT * FROM auction_participants WHERE auction_id = ? AND user_id = ?', [auctionId, userId]);
  if (existing) return { joined: true };
  const auction = queryOne("SELECT * FROM auctions WHERE id = ? AND status = 'active'", [auctionId]);
  if (!auction) return { error: 'المزاد غير متاح' };
  // Deduct entry fee (simulated payment - in production, real payment)
  run('INSERT INTO auction_participants (id, auction_id, user_id, paid_entry) VALUES (?, ?, ?, 1)', [uuidv4(), auctionId, userId]);
  return { joined: true, entry_fee: auction.entry_fee };
}

function placeBid(auctionId, userId, amount) {
  const auction = queryOne("SELECT * FROM auctions WHERE id = ? AND status = 'active'", [auctionId]);
  if (!auction) return { error: 'المزاد غير متاح' };
  const now = new Date().toISOString();
  if (auction.end_time <= now) {
    // End auction
    run("UPDATE auctions SET status = 'ended', winner_id = ? WHERE id = ?", [auction.winner_id, auctionId]);
    return { error: 'انتهى المزاد' };
  }
  if (amount < auction.current_price + auction.min_increment) {
    return { error: 'المبلغ أقل من الحد الأدنى للمزايدة (' + (auction.current_price + auction.min_increment) + ' ريال)' };
  }
  // Check participant
  const participant = queryOne('SELECT * FROM auction_participants WHERE auction_id = ? AND user_id = ?', [auctionId, userId]);
  if (!participant) return { error: 'يجب دفع رسوم الدخول أولاً للمشاركة' };
  
  run('INSERT INTO auction_bids (id, auction_id, user_id, amount) VALUES (?, ?, ?, ?)', [uuidv4(), auctionId, userId, amount]);
  run('UPDATE auctions SET current_price = ? WHERE id = ?', [amount, auctionId]);
  return getAuctionById(auctionId);
}

function endAuction(auctionId) {
  const auction = queryOne("SELECT * FROM auctions WHERE id = ? AND status = 'active'", [auctionId]);
  if (!auction) return null;
  // Winner = last bidder
  const lastBid = queryOne('SELECT * FROM auction_bids WHERE auction_id = ? ORDER BY created_at DESC, amount DESC LIMIT 1', [auctionId]);
  const winnerId = lastBid ? lastBid.user_id : null;
  run("UPDATE auctions SET status = 'ended', winner_id = ? WHERE id = ?", [winnerId, auctionId]);
  // If no winner, free the code
  if (!winnerId) {
    run('UPDATE subscription_codes SET used = 0 WHERE code = ?', [auction.code]);
  }
  return getAuctionById(auctionId);
}

function confirmAuctionPayment(auctionId) {
  run('UPDATE auctions SET paid = 1 WHERE id = ?', [auctionId]);
  const auction = getAuctionById(auctionId);
  // Give winner the code
  if (auction && auction.winner_id && auction.paid) {
    run('INSERT OR IGNORE INTO user_codes (id, user_id, code, type) VALUES (?, ?, ?, ?)', [uuidv4(), auction.winner_id, auction.code, 'premium']);
  }
  return auction;
}

function cancelAuction(auctionId) {
  const auction = queryOne('SELECT * FROM auctions WHERE id = ?', [auctionId]);
  run("UPDATE auctions SET status = 'cancelled' WHERE id = ?", [auctionId]);
  // Free the code for reuse
  if (auction) run('UPDATE subscription_codes SET used = 0 WHERE code = ?', [auction.code]);
  return getAuctionById(auctionId);
}

function getAvailableAuctionCodes() {
  return queryAll("SELECT * FROM subscription_codes WHERE type = 'premium' AND (used = 0 OR used IS NULL) ORDER BY code ASC");
}

function getAuctionBids(auctionId) {
  return queryAll(`
    SELECT ab.*, u.name as user_name
    FROM auction_bids ab
    JOIN users u ON ab.user_id = u.id
    WHERE ab.auction_id = ?
    ORDER BY ab.created_at DESC, ab.amount DESC
  `, [auctionId]);
}

function isAuctionParticipant(auctionId, userId) {
  return queryOne('SELECT * FROM auction_participants WHERE auction_id = ? AND user_id = ?', [auctionId, userId]);
}

function getAdminStats() {
  const families = queryOne('SELECT COUNT(*) as c FROM families');
  const users = queryOne('SELECT COUNT(*) as c FROM users');
  const challenges = queryOne('SELECT COUNT(*) as c FROM challenges');
  return {
    families: families ? families.c : 0,
    users: users ? users.c : 0,
    challenges: challenges ? challenges.c : 0,
  };
}

function getAllFamilies() {
  return queryAll(`
    SELECT f.*, 
      (SELECT COUNT(*) FROM users WHERE family_id = f.id) as members_count,
      u.name as founder_name,
      u.last_seen as founder_last_seen
    FROM families f
    LEFT JOIN users u ON f.founder_id = u.id
    ORDER BY f.created_at DESC
  `);
}

function updateFamilyData(familyId, data) {
  const { name, subscription_code, status } = data;
  if (name !== undefined) run('UPDATE families SET name = ? WHERE id = ?', [name, familyId]);
  if (status !== undefined) run('UPDATE families SET status = ? WHERE id = ?', [status, familyId]);
  if (subscription_code !== undefined) {
    // Check code not used by another family
    const existing = queryOne('SELECT * FROM families WHERE subscription_code = ? AND id != ?', [subscription_code, familyId]);
    if (existing) return { error: 'رمز العائلة مستخدم من عائلة أخرى' };
    run('UPDATE families SET subscription_code = ? WHERE id = ?', [subscription_code, familyId]);
  }
  return queryOne('SELECT * FROM families WHERE id = ?', [familyId]);
}

function setFamilyStatus(familyId, status) {
  run('UPDATE families SET status = ? WHERE id = ?', [status, familyId]);
  // If inactive, block family members login
  return queryOne('SELECT * FROM families WHERE id = ?', [familyId]);
}

function deleteFamily(familyId) {
  run('DELETE FROM challenges WHERE family_id = ?', [familyId]);
  run('DELETE FROM diwaniya_messages WHERE session_id IN (SELECT id FROM diwaniya_sessions WHERE family_id = ?)', [familyId]);
  run('DELETE FROM diwaniya_sessions WHERE family_id = ?', [familyId]);
  run('DELETE FROM invitations WHERE family_id = ?', [familyId]);
  run('UPDATE users SET family_id = NULL WHERE family_id = ?', [familyId]);
  run('DELETE FROM families WHERE id = ?', [familyId]);
  return true;
}

function updatePrice(code, price) {
  run('UPDATE subscription_codes SET price = ? WHERE code = ?', [price, code]);
}

module.exports = {
  getDb, createUser, getUserByEmail, getUserById, getFamilyMembers,
  createFamily, getFamily, validateSubscriptionCode,
  createInvitation, getInvitationsByFamily, getInvitationByToken, acceptInvitation,
  openDiwaniya, closeDiwaniya, getActiveDiwaniya, getDiwaniyaHistory,
  addDiwaniyaMessage, getDiwaniyaMessages,
  createChallenge, respondToChallenge, completeChallenge,
  getFamilyChallenges, getPendingChallenges, getFamilyLeaderboard,
  generateSubscriptionCodes, updateFamilyFounder,
  generatePremiumCode, getAvailablePremiumCodes, purchaseCode, getUserCodes, userHasFamily, updatePassword,
  updatePrice, getFirstAvailablePremiumCode,
  getAllFamilies, updateFamilyData, setFamilyStatus, deleteFamily, createAdminUser, getAdminStats,
  getActiveAds, getAllAds, addAd, updateAd, deleteAd, trackAdView, trackAdClick, getAdsStats, getFeaturedFamilies,
  lockDiwaniya, getDiwaniyaLock, addSupportMessage, getSupportMessages, deleteSupportMessage, createSupportTicket, getSupportTickets, getMyTickets, replyTicket, closeTicket, getAllUsersDetailed, updateUserByAdmin, deleteUserByAdmin, requestModeratorVisit, approveModeratorVisit, enterModeratorVisit, exitModeratorVisit, getModeratorVisits, getModeratorVisitsByUser, getPendingVisitByModerator, getAgreement, acceptAgreement, rejectAgreement, canOpenDiwaniya, getFamilyAgreements, getAllAgreements, getBannedWords, addBannedWord, deleteBannedWord, checkBannedWord, addViolation, getAllViolations, getViolationStats, getModerationSettings, setModerationSetting, banUser, getActiveBan, getAllBans, unbanUser, setDiwaniyaManager, countDiwaniyaManagers, updateProfile, leaveFamily, updateLastSeen, getLastSeen, createAnnouncement, getFamilyAnnouncements, getAnnouncementsForUser, deleteAnnouncement, getUserFamilies, getUserFamilyCount, addUserToFamily, setCurrentFamily, getSetting, setSetting, createAuction, getActiveAuctions, getAllAuctions, getAuctionById, joinAuction, placeBid, getAvailableAuctionCodes,
  endAuction, confirmAuctionPayment, cancelAuction, getAuctionBids, isAuctionParticipant,
};
