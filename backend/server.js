const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const JWT_SECRET = process.env.JWT_SECRET || 'family-app-secret-key-2026';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// No-cache headers for frontend files
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'توكن غير موجود' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'توكن غير صالح' });
  }
}

// =============== AUTH ROUTES ===============

// Register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, subscriptionCode, familyName } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول المطلوبة' });
  }

  // Check if user exists
  const existing = db.getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  // If subscription code provided, it's a founder creating a family
  if (subscriptionCode && familyName) {
    // Check if user already has a family
    const existingUser = db.getUserByEmail(email);
    if (existingUser && existingUser.family_id) {
      return res.status(400).json({ error: 'لديك عائلة بالفعل. يمكنك إنشاء عائلة واحدة فقط.' });
    }
    
    const validCode = db.validateSubscriptionCode(subscriptionCode);
    if (!validCode) {
      return res.status(400).json({ error: 'رمز الاشتراك غير صالح أو مستخدم مسبقاً' });
    }
    
    const family = db.createFamily(familyName, subscriptionCode);
    if (!family) {
      return res.status(400).json({ error: 'فشل في إنشاء العائلة' });
    }
    
    const user = db.createUser(name, email, hashedPassword, family.id, 'founder');
    // Update family with founder
    db.updateFamilyFounder(family.id, user.id);
    
    const token = jwt.sign({ id: user.id, email: user.email, familyId: user.family_id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    
    return res.json({
      token,
      user,
      family: db.getFamily(family.id)
    });
  }

  // Without subscription code - check if coming from invitation
  // (handled by invitation flow)
  return res.status(400).json({ error: 'مطلوب رمز الاشتراك لتسجيل عائلة جديدة' });
});

// Register via invitation
app.post('/api/auth/register-invited', (req, res) => {
  const { name, email, password, token } = req.body;
  
  if (!name || !email || !password || !token) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول' });
  }

  const invitation = db.getInvitationByToken(token);
  if (!invitation) {
    return res.status(400).json({ error: 'الدعوة غير صالحة أو منتهية' });
  }

  const existing = db.getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const user = db.createUser(name, email, hashedPassword, invitation.family_id, 'member');
  
  // Accept invitation
  db.acceptInvitation(token, user.id);
  
  const tokenJwt = jwt.sign({ id: user.id, email: user.email, familyId: user.family_id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token: tokenJwt,
    user,
    family: db.getFamily(user.family_id)
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });
  }

  const user = db.getUserByEmail(email);
  if (!user) {
    return res.status(400).json({ error: 'البريد غير مسجل' });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });
  }
  
  // Check active ban
  const activeBan = db.getActiveBan(user.id);
  if (activeBan) {
    return res.status(403).json({ banned: true, reason: activeBan.reason, banned_until: activeBan.banned_until });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, familyId: user.family_id, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      family_id: user.family_id,
      role: user.role,
      avatar: user.avatar,
      points: user.points
    },
    family: user.family_id ? db.getFamily(user.family_id) : null
  });
});

// Verify token
app.get('/api/auth/verify', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  db.updateLastSeen(req.user.id);
  res.json({ user, family: user.family_id ? db.getFamily(user.family_id) : null });
});

// =============== CODES ROUTES ===============

// Get available premium codes
app.get('/api/codes/available', authMiddleware, (req, res) => {
  const codes = db.getAvailablePremiumCodes();
  res.json({ codes });
});

// Purchase a premium code
app.post('/api/codes/purchase', authMiddleware, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'الرمز مطلوب' });
  const result = db.purchaseCode(req.user.id, code);
  if (!result) return res.status(400).json({ error: 'الرمز غير متاح للشراء' });
  res.json({ message: 'تم شراء الرمز المميز بنجاح بقيمة 200 ريال ✅', code: result });
});

// Generate premium code
app.post('/api/codes/generate-premium', (req, res) => {
  const code = db.generatePremiumCode();
  res.json({ code, message: 'تم إنشاء رمز مميز: ' + code });
});

// Get user's purchased codes
app.get('/api/codes/my', authMiddleware, (req, res) => {
  const codes = db.getUserCodes(req.user.id);
  res.json({ codes });
});

// Forgot password
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  const user = db.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'البريد غير مسجل' });
  const resetToken = require('uuid').v4();
  res.json({ message: 'تم إرسال رابط إعادة تعيين كلمة المرور', devToken: resetToken });
});

// Reset password
app.post('/api/auth/reset-password', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان' });
  const user = db.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'البريد غير مسجل' });
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.updatePassword(email, hashedPassword);
  res.json({ message: 'تم تغيير كلمة المرور بنجاح ✅' });
});

// Get all codes (admin)
app.get('/api/codes/admin/all', authMiddleware, (req, res) => {
  const d = db.getDb();
  try {
    const result = d.exec("SELECT code, type, price, purchased_by, used FROM subscription_codes ORDER BY type DESC, code ASC");
    const codes = [];
    if (result && result.length > 0) {
      const cols = result[0].columns;
      result[0].values.forEach(row => {
        const obj = {};
        cols.forEach((col, i) => obj[col] = row[i]);
        codes.push(obj);
      });
    }
    res.json({ codes });
  } catch(e) {
    res.json({ codes: [] });
  }
});

// Update code price (admin)
app.post('/api/codes/admin/update-price', authMiddleware, (req, res) => {
  const { code, price } = req.body;
  if (!code || price === undefined) return res.status(400).json({ error: 'الرمز والسعر مطلوبان' });
  db.updatePrice(code, parseInt(price));
  res.json({ message: '✅ تم تحديث السعر', code, price: parseInt(price) });
});

// Admin middleware - only admin role can access
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'هذه الصلاحية للمدير فقط' });
  }
  next();
}

// Admin or moderator middleware
function adminOrModerator(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
    return res.status(403).json({ error: 'هذه الصلاحية للإدارة أو المشرفين' });
  }
  next();
}

// =============== ADMIN: FAMILY MANAGEMENT ===============

// List all families (admin)
app.get('/api/admin/families', authMiddleware, adminMiddleware, (req, res) => {
  const families = db.getAllFamilies();
  res.json({ families });
});

// Update family (admin)
app.post('/api/admin/families/update', authMiddleware, adminMiddleware, (req, res) => {
  const { familyId, name, subscription_code, status } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  const result = db.updateFamilyData(familyId, { name, subscription_code, status });
  if (result?.error) return res.status(400).json(result);
  res.json({ message: '✅ تم تحديث العائلة', family: result });
});

// Set family status active/inactive (admin)
app.post('/api/admin/families/status', authMiddleware, adminMiddleware, (req, res) => {
  const { familyId, status } = req.body;
  if (!familyId || !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }
  const family = db.setFamilyStatus(familyId, status);
  res.json({ message: status === 'active' ? '✅ تم تفعيل العائلة' : '⛔ تم إيقاف العائلة', family });
});

// Delete family (admin)
app.post('/api/admin/families/delete', authMiddleware, adminMiddleware, (req, res) => {
  const { familyId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  db.deleteFamily(familyId);
  res.json({ message: '🗑️ تم حذف العائلة' });
});

// Admin dashboard stats
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const stats = db.getAdminStats();
  res.json({ stats });
});

// =============== ADS & PUBLIC ROUTES ===============

// Get active ads (public)
app.get('/api/ads', (req, res) => {
  const ads = db.getActiveAds();
  res.json({ ads });
});

// Track ad view (public)
app.post('/api/ads/view', (req, res) => {
  const { id } = req.body;
  if (id) db.trackAdView(id);
  res.json({ ok: true });
});

// Track ad click (public)
app.post('/api/ads/click', (req, res) => {
  const { id } = req.body;
  if (id) db.trackAdClick(id);
  res.json({ ok: true });
});

// Admin: ads stats
app.get('/api/admin/ads/stats', authMiddleware, adminMiddleware, (req, res) => {
  const stats = db.getAdsStats();
  const ads = db.getAllAds();
  res.json({ stats, ads });
});

// Get featured families (public)
app.get('/api/featured-families', (req, res) => {
  const families = db.getFeaturedFamilies(5);
  res.json({ families });
});

// Admin: all ads
app.get('/api/admin/ads', authMiddleware, adminOrModerator, (req, res) => {
  const ads = db.getAllAds();
  res.json({ ads });
});

// Admin: add ad
app.post('/api/admin/ads/add', authMiddleware, adminOrModerator, (req, res) => {
  const { title, image_url, link_url, position } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  const ad = db.addAd(title, image_url || '', link_url || '', position || 'banner');
  res.json({ message: '✅ تم إضافة الإعلان', ad });
});

// Admin: update ad
app.post('/api/admin/ads/update', authMiddleware, adminOrModerator, (req, res) => {
  const { id, title, image_url, link_url, status } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الإعلان مطلوب' });
  const ad = db.updateAd(id, title, image_url || '', link_url || '', status || 'active');
  res.json({ message: '✅ تم تحديث الإعلان', ad });
});

// Admin: delete ad
app.post('/api/admin/ads/delete', authMiddleware, adminOrModerator, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الإعلان مطلوب' });
  db.deleteAd(id);
  res.json({ message: '🗑️ تم حذف الإعلان' });
});

// =============== FOUNDER: EDIT OWN FAMILY ===============

// Founder edits own family name (and optionally code)
app.post('/api/family/edit', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط مؤسس العائلة يمكنه التعديل' });
  const { name, subscription_code } = req.body;
  if (name) {
    db.getDb().run('UPDATE families SET name = ? WHERE id = ?', [name, req.user.familyId]);
  }
  if (subscription_code) {
    // Check not used by another family
    const used = db.getDb().exec("SELECT id FROM families WHERE subscription_code = ? AND id != ?", [subscription_code, req.user.familyId]);
    if (used.length && used[0].values.length) {
      return res.status(400).json({ error: 'الرمز مستخدم من عائلة أخرى' });
    }
    db.getDb().run('UPDATE families SET subscription_code = ? WHERE id = ?', [subscription_code, req.user.familyId]);
  }
  res.json({ message: '✅ تم تحديث بيانات العائلة', family: db.getFamily(req.user.familyId) });
});

// =============== PROFILE ROUTES ===============

// Update profile
app.post('/api/profile/update', authMiddleware, (req, res) => {
  const { name, country, city, phone, whatsapp, avatar } = req.body;
  const user = db.updateProfile(req.user.id, { name, country, city, phone, whatsapp, avatar });
  res.json({ message: '✅ تم تحديث الملف الشخصي', user });
});

// Leave family
app.post('/api/profile/leave-family', authMiddleware, (req, res) => {
  const result = db.leaveFamily(req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ message: 'تم الخروج من عائلة ' + result.family_name, success: true });
});

// Get user's subscribed families
app.get('/api/profile/families', authMiddleware, (req, res) => {
  const families = db.getUserFamilies(req.user.id);
  res.json({ families, currentFamilyId: req.user.familyId });
});

// Switch current family
app.post('/api/profile/switch-family', authMiddleware, (req, res) => {
  const { familyId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  
  // Check user is subscribed to this family
  const families = db.getUserFamilies(req.user.id);
  const exists = families.find(f => f.family_id === familyId);
  if (!exists) return res.status(400).json({ error: 'أنت غير مشترك في هذه العائلة' });
  
  const family = db.getFamily(familyId);
  if (!family || family.status === 'inactive') return res.status(400).json({ error: 'العائلة غير متاحة' });
  
  db.setCurrentFamily(req.user.id, familyId);
  db.getDb().run('UPDATE users SET family_id = ? WHERE id = ?', [familyId, req.user.id]);
  
  res.json({ message: '✅ تم التبديل إلى عائلة ' + family.name, family });
});

// =============== ONLINE & FAMILY MEMBERSHIP ===============

// Online user IDs (tracked via socket)
const onlineUsers = new Set();

// Get online status of family members
app.get('/api/family/online', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.json({ online: [] });
  const members = db.getFamilyMembers(req.user.familyId);
  const online = members.filter(m => onlineUsers.has(m.id)).map(m => m.id);
  res.json({ online });
});

// Get all online users (admin)
app.get('/api/admin/online', authMiddleware, adminMiddleware, (req, res) => {
  const allUsers = db.getDb().exec('SELECT id, name, family_id FROM users');
  let users = [];
  if (allUsers && allUsers.length > 0) {
    const cols = allUsers[0].columns;
    users = allUsers[0].values.map(row => {
      const o = {};
      cols.forEach((c, i) => o[c] = row[i]);
      return o;
    });
  }
  const result = users.map(u => ({ ...u, online: onlineUsers.has(u.id) }));
  // Group by family
  const d = db.getDb();
  let families = [];
  try {
    const famRes = d.exec('SELECT * FROM families');
    if (famRes.length) {
      const cols = famRes[0].columns;
      families = famRes[0].values.map(row => {
        const o = {};
        cols.forEach((c, i) => o[c] = row[i]);
        return o;
      });
    }
  } catch(e) {}
  const famData = families.map(f => {
    const members = result.filter(u => u.family_id === f.id);
    const onlineCount = members.filter(m => m.online).length;
    return { ...f, members, onlineCount };
  });
  res.json({ onlineUsers: [...onlineUsers], families: famData });
});

// Join family by subscription code (logged-in user, no registration needed)
app.post('/api/family/join-by-code', authMiddleware, (req, res) => {
  const { code, paid } = req.body;
  if (!code) return res.status(400).json({ error: 'رمز العائلة مطلوب' });
  
  // Find family by code
  const families = db.getDb().exec("SELECT id, name, status FROM families WHERE subscription_code = ?", [code.toUpperCase()]);
  if (!families.length || !families[0].values.length) {
    return res.status(404).json({ error: 'رمز العائلة غير صحيح' });
  }
  const family = { id: families[0].values[0][0], name: families[0].values[0][1], status: families[0].values[0][2] };
  if (family.status === 'inactive') return res.status(400).json({ error: 'هذه العائلة موقوفة' });
  
  const count = db.getUserFamilyCount(req.user.id);
  const joinPrice = parseInt(db.getSetting('join_family_price', '20'));
  
  // Already in this family?
  const existing = db.getUserFamilies(req.user.id).find(f => f.family_id === family.id);
  if (existing) return res.status(400).json({ error: 'أنت بالفعل في هذه العائلة' });
  
  if (count >= 5) return res.status(400).json({ error: 'وصلت للحد الأقصى 5 عوائل' });
  
  // Check premium code (auction winners get 5 families free)
  let hasPremium = false;
  try {
    const pc = db.getDb().exec("SELECT COUNT(*) c FROM user_codes WHERE user_id = ? AND type = 'premium'", [req.user.id]);
    if (pc.length && pc[0].values.length) hasPremium = pc[0].values[0][0] > 0;
  } catch(e) {}
  
  // 1st family free (or premium holder), 2nd+ requires 20 SAR
  const needsPayment = count >= 1 && !hasPremium;
  if (needsPayment && !paid) {
    return res.json({ requiresPayment: true, price: joinPrice, family: { id: family.id, name: family.name, code: code.toUpperCase() } });
  }
  
  db.addUserToFamily(req.user.id, family.id, 1);
  db.setCurrentFamily(req.user.id, family.id);
  db.getDb().run('UPDATE users SET family_id = ? WHERE id = ?', [family.id, req.user.id]);
  
  res.json({ message: '✅ تم الانضمام لعائلة ' + family.name, family: { ...family, code: code.toUpperCase() } });
});

// Join another family (with payment for 2nd+)
app.post('/api/family/join', authMiddleware, (req, res) => {
  const { familyId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  
  const count = db.getUserFamilyCount(req.user.id);
  const joinPrice = parseInt(db.getSetting('join_family_price', '20'));
  
  // Check if user bought premium from auction (5 families free)
  const maxFree = 1;
  const maxFamilies = 5;
  const hasPremium = count >= 0; // placeholder check
  
  if (count >= maxFamilies) {
    return res.status(400).json({ error: 'وصلت للحد الأقصى 5 عوائل' });
  }
  
  const family = db.getFamily(familyId);
  if (!family) return res.status(400).json({ error: 'العائلة غير موجودة' });
  if (family.status === 'inactive') return res.status(400).json({ error: 'العائلة موقوفة' });
  
  // Already in this family?
  const existing = db.getUserFamilies(req.user.id).find(f => f.family_id === familyId);
  if (existing) return res.status(400).json({ error: 'أنت بالفعل في هذه العائلة' });
  
  // 1st family free, 2nd+ requires payment
  const needsPayment = count >= 1;
  if (needsPayment) {
    // Simulate payment check
    const { paid } = req.body;
    if (!paid) {
      return res.json({ requiresPayment: true, price: joinPrice, family: { id: family.id, name: family.name } });
    }
  }
  
  db.addUserToFamily(req.user.id, familyId, 1);
  db.setCurrentFamily(req.user.id, familyId);
  // Update users table to current family
  db.getDb().run('UPDATE users SET family_id = ? WHERE id = ?', [familyId, req.user.id]);
  
  // If user has premium code from auction, they get 5 families free - check user_codes
  const premiumCodes = db.getDb().exec("SELECT COUNT(*) c FROM user_codes WHERE user_id = ? AND type = 'premium'", [req.user.id]);
  let hasPremiumCode = false;
  if (premiumCodes.length && premiumCodes[0].values.length) {
    hasPremiumCode = premiumCodes[0].values[0][0] > 0;
  }
  
  res.json({ message: '✅ تم الانضمام للعائلة ' + family.name, family, hasPremiumCode });
});

// =============== ANNOUNCEMENTS & LAST SEEN ===============

// Update last seen (call on auth)
app.get('/api/auth/verify', (req, res, next) => {
  // Original verify handler runs below - just update last_seen
  next();
});

// Create announcement (founder)
app.post('/api/announcements/create', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const { title, content, announceType, targetUserId, eventTime } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  const ann = db.createAnnouncement(req.user.familyId, req.user.id, title, content, announceType, targetUserId, eventTime);
  // Notify family members via socket
  io.to(`family_${req.user.familyId}`).emit('family_notification', {
    title: '📢 ' + title,
    message: content || 'إعلان جديد من مؤسس العائلة',
    time: Date.now()
  });
  res.json({ message: '📢 تم نشر الإعلان', announcement: ann });
});

// Get announcements for current user
app.get('/api/announcements', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.json({ announcements: [] });
  const announcements = db.getAnnouncementsForUser(req.user.familyId, req.user.id);
  res.json({ announcements });
});

// Delete/dismiss announcement
app.post('/api/announcements/delete', authMiddleware, (req, res) => {
  const { id } = req.body;
  db.deleteAnnouncement(id);
  res.json({ message: 'تم' });
});

// =============== VIOLATIONS ROUTES ===============

// Get all users for violation reporting (admin)
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const d = db.getDb();
  const r = d.exec('SELECT id, name, email, role FROM users ORDER BY name');
  let users = [];
  if (r.length) {
    const cols = r[0].columns;
    users = r[0].values.map(row => {
      const o = {};
      cols.forEach((c, i) => o[c] = row[i]);
      return o;
    });
  }
  res.json({ users });
});

// Add violation (admin) - AI employee takes violation, sets duration
app.post('/api/admin/violations/add', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, reason, durationHours, violationType, evidence } = req.body;
  if (!userId || !reason || !durationHours) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const violation = db.addViolation(userId, reason, parseInt(durationHours), violationType || 'text', evidence, req.user.id);
  
  // If violation is diwaniya-related, close diwaniya + lock it
  const violator = db.getUserById(userId);
  if (violator && violator.family_id) {
    const activeSession = db.getActiveDiwaniya(violator.family_id);
    if (activeSession) {
      db.closeDiwaniya(activeSession.id);
    }
    // Lock diwaniya: founder ban duration, otherwise 24 hours
    const durationMs = (violator.role === 'founder' ? parseInt(durationHours) : 24) * 3600000;
    const lockedUntil = new Date(Date.now() + durationMs).toISOString();
    db.lockDiwaniya(violator.family_id, lockedUntil, reason, violator.name);
    
    // Notify family: diwaniya closed due to violation, show violator name + lock time
    io.to(`family_${violator.family_id}`).emit('diwaniya_closed_violation', {
      violatorName: violator.name,
      reason: reason,
      sessionId: activeSession ? activeSession.id : null,
      lockedUntil: lockedUntil,
      lockedHours: violator.role === 'founder' ? parseInt(durationHours) : 24,
      closedAt: new Date().toISOString()
    });
    console.log(`🔒 Diwaniya locked until ${lockedUntil} due to violation by ${violator.name}`);
  }
  
  res.json({ message: '⛔ تم تسجيل المخالفة وإيقاف العضوية', violation });
});

// Get all violations (admin)
app.get('/api/admin/violations', authMiddleware, adminMiddleware, (req, res) => {
  const violations = db.getAllViolations();
  const stats = db.getViolationStats();
  res.json({ violations, stats });
});

// Moderation settings (admin)
app.get('/api/admin/moderation-settings', authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.getModerationSettings());
});
app.post('/api/admin/moderation-settings', authMiddleware, adminMiddleware, (req, res) => {
  const { ai_monitor_enabled, auto_ban_after, ai_employee_name } = req.body;
  if (ai_monitor_enabled !== undefined) db.setModerationSetting('ai_monitor_enabled', ai_monitor_enabled);
  if (auto_ban_after !== undefined) db.setModerationSetting('auto_ban_after', auto_ban_after);
  if (ai_employee_name !== undefined) db.setModerationSetting('ai_employee_name', ai_employee_name);
  res.json({ message: '✅ تم حفظ الإعدادات', settings: db.getModerationSettings() });
});

// =============== SUPPORT SYSTEM ROUTES ===============

// Admin: support messages CRUD
app.get('/api/admin/support-messages', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ messages: db.getSupportMessages() });
});
app.post('/api/admin/support-messages/add', authMiddleware, adminMiddleware, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
  db.addSupportMessage(title, content);
  res.json({ message: '✅ تمت إضافة الرسالة' });
});
app.post('/api/admin/support-messages/delete', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.body;
  db.deleteSupportMessage(id);
  res.json({ message: '🗑️ تم الحذف' });
});

// Get support messages for moderator (during visits)
app.get('/api/support-messages', authMiddleware, (req, res) => {
  res.json({ messages: db.getSupportMessages() });
});

// Moderator: send predefined message in diwaniya during visit
app.post('/api/moderator/send-message', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (user.role !== 'moderator' && user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط المشرفون' });
  }
  const { sessionId, messageId } = req.body;
  if (!sessionId || !messageId) return res.status(400).json({ error: 'الرسالة المطلوبة' });
  const msg = db.getDb().exec('SELECT * FROM support_messages WHERE id = ?', [messageId]);
  if (!msg.length || !msg[0].values.length) return res.status(400).json({ error: 'الرسالة غير موجودة' });
  const cols = msg[0].columns;
  const row = msg[0].values[0];
  const content = row[cols.indexOf('content')];
  const title = row[cols.indexOf('title')];
  
  // Post as moderator observer message (visible, not chat message)
  io.to(`session_${sessionId}`).emit('moderator_message', {
    moderatorName: user.name,
    title: title,
    content: content
  });
  res.json({ message: '💬 تم إرسال رسالة المشرف' });
});

// Support tickets (users → admin only)
app.post('/api/support/ticket', authMiddleware, (req, res) => {
  const { subject, message } = req.body;
  if (!message) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
  const user = db.getUserById(req.user.id);
  const ticket = db.createSupportTicket(req.user.id, user.name, subject || 'استفسار', message);
  res.json({ message: '📨 تم إرسال رسالتك للإدارة', ticket });
});
app.get('/api/support/my-tickets', authMiddleware, (req, res) => {
  res.json({ tickets: db.getMyTickets(req.user.id) });
});
app.get('/api/admin/support-tickets', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ tickets: db.getSupportTickets() });
});
app.post('/api/admin/support-tickets/reply', authMiddleware, adminMiddleware, (req, res) => {
  const { ticketId, reply } = req.body;
  if (!ticketId || !reply) return res.status(400).json({ error: 'الرد مطلوب' });
  db.replyTicket(ticketId, reply);
  res.json({ message: '✅ تم إرسال الرد' });
});
app.post('/api/admin/support-tickets/close', authMiddleware, adminMiddleware, (req, res) => {
  const { ticketId } = req.body;
  db.closeTicket(ticketId);
  res.json({ message: 'تم إغلاق التذكرة' });
});

// =============== USERS MANAGEMENT (ADMIN) ===============

// Get all users detailed (admin)
app.get('/api/admin/users-detailed', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ users: db.getAllUsersDetailed() });
});

// Update user (admin) - edit, promote/demote
app.post('/api/admin/users/update', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, name, email, whatsapp, phone, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
  const result = db.updateUserByAdmin(userId, { name, email, whatsapp, phone, role });
  if (result?.error) return res.status(400).json(result);
  res.json({ message: '✅ تم تحديث بيانات المستخدم', user: result });
});

// Delete user (admin)
app.post('/api/admin/users/delete', authMiddleware, adminMiddleware, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
  db.deleteUserByAdmin(userId);
  res.json({ message: '🗑️ تم حذف المستخدم' });
});

// =============== MODERATOR STARS & TIERS ===============

// Moderator profile (stars, tier, visits, rating)
app.get('/api/moderator/profile', authMiddleware, (req, res) => {
  const profile = db.getModeratorProfile(req.user.id);
  const tier = profile ? db.getModeratorTier(profile.stars || 0) : 'none';
  res.json({ profile, tier, tierSettings: db.getTierSettings() });
});

// Award stars on visit exit (every visit = stars)
// Rate moderator (family members rate 1-5 after moderator exits)
app.post('/api/moderator/rate', authMiddleware, (req, res) => {
  const { moderatorId, visitId, rating, comment } = req.body;
  if (!moderatorId || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'التقييم من 1 إلى 5 نجوم' });
  }
  db.rateModerator(moderatorId, visitId, req.user.familyId, parseInt(rating), comment, req.user.id);
  // Stars based on rating: rating * 10 stars
  const stars = parseInt(rating) * 10;
  db.addModeratorStars(moderatorId, stars);
  res.json({ message: '⭐ تم تقييم المشرف', stars_added: stars });
});

// Admin: tier settings management
app.get('/api/admin/tier-settings', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ settings: db.getTierSettings() });
});
app.post('/api/admin/tier-settings', authMiddleware, adminMiddleware, (req, res) => {
  const { black, blue, silver, gold, platinum, stars_per_visit } = req.body;
  if (black) db.setSetting('tier_black', black);
  if (blue) db.setSetting('tier_blue', blue);
  if (silver) db.setSetting('tier_silver', silver);
  if (gold) db.setSetting('tier_gold', gold);
  if (platinum) db.setSetting('tier_platinum', platinum);
  if (stars_per_visit) db.setSetting('stars_per_visit', stars_per_visit);
  res.json({ message: '✅ تم حفظ إعدادات التوثيق', settings: db.getTierSettings() });
});

// Admin: upgrade moderator tier manually
app.post('/api/admin/moderator/tier', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, tier } = req.body;
  if (!userId || !['none','black','blue','silver','gold','platinum'].includes(tier)) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }
  db.updateModeratorTier(userId, tier);
  res.json({ message: '🏅 تم تحديث توثيق المشرف إلى ' + tier });
});

// Award stars for visit completion (called in exitModeratorVisit flow)
// =============== MODERATOR VISITS ===============

// Moderator: request visit to diwaniya (with reason)
app.post('/api/moderator/visit/request', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (user.role !== 'moderator' && user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط المشرفون يمكنهم طلب الزيارة' });
  }
  const { familyId, reason } = req.body;
  if (!familyId || !reason) return res.status(400).json({ error: 'العائلة وسبب الزيارة مطلوبان' });
  const visit = db.requestModeratorVisit(req.user.id, user.name, familyId, reason);
  // Notify the family diwaniya (if active)
  const active = db.getActiveDiwaniya(familyId);
  if (active) {
    io.to(`family_${familyId}`).emit('moderator_visit_requested', {
      moderatorName: user.name,
      reason: reason,
      scheduledAt: visit.scheduled_at,
      visitId: visit.id
    });
  }
  res.json({ message: '🕵️ تم إرسال طلب الزيارة، ستدخل بعد دقيقة', visit });
});

// Moderator: enter diwaniya (after 1 min)
app.post('/api/moderator/visit/enter', authMiddleware, (req, res) => {
  const { visitId } = req.body;
  const visit = db.enterModeratorVisit(visitId);
  if (!visit) return res.status(400).json({ error: 'الزيارة غير موجودة' });
  if (visit.family_id) {
    io.to(`family_${visit.family_id}`).emit('moderator_entered', { moderatorName: visit.moderator_name });
  }
  res.json({ message: '🕵️ دخلت كمراقب تفقدي - لا يحق لك المشاركة', visit });
});

// Moderator: exit + send report
app.post('/api/moderator/visit/exit', authMiddleware, (req, res) => {
  const { visitId, report } = req.body;
  const visit = db.exitModeratorVisit(visitId, report);
  if (!visit) return res.status(400).json({ error: 'الزيارة غير موجودة' });
  // Award stars for completed visit
  const starsPerVisit = parseInt(db.getSetting('stars_per_visit', '10'));
  const profile = db.addModeratorStars(visit.moderator_id, starsPerVisit);
  const tier = db.getModeratorTier(profile.stars || 0);
  if (visit.family_id) {
    io.to(`family_${visit.family_id}`).emit('moderator_exited', { 
      moderatorName: visit.moderator_name, 
      moderatorId: visit.moderator_id,
      visitId: visit.id
    });
    // Notify family to rate the moderator
    io.to(`family_${visit.family_id}`).emit('moderator_rate_request', { 
      moderatorId: visit.moderator_id,
      moderatorName: visit.moderator_name,
      visitId: visit.id
    });
  }
  res.json({ message: '📋 تم إرسال تقرير الزيارة + ⭐ ' + starsPerVisit + ' نجوم', visit, stars: profile.stars, tier });
});

// Moderator: online families with active diwaniya (only these can be visited)
app.get('/api/moderator/online-families', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (user.role !== 'moderator' && user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط المشرفون' });
  }
  const families = db.getFamiliesWithActiveDiwaniya();
  res.json({ families });
});

// Moderator: my visits
app.get('/api/moderator/visits', authMiddleware, (req, res) => {
  res.json({ visits: db.getModeratorVisitsByUser(req.user.id) });
});

// Admin: all moderator visits
app.get('/api/admin/moderator-visits', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ visits: db.getModeratorVisits() });
});

// =============== AGREEMENTS ROUTES ===============

// Get my agreement status
app.get('/api/agreements/status', authMiddleware, (req, res) => {
  const ag = db.getAgreement(req.user.id);
  res.json({ agreement: ag, canOpenDiwaniya: db.canOpenDiwaniya(req.user.id) });
});

// Accept agreement (permanent)
app.post('/api/agreements/accept', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  const role = user && user.can_open_diwaniya == 1 ? 'manager' : (req.user.role === 'founder' ? 'founder' : 'member');
  const ag = db.acceptAgreement(req.user.id, req.user.familyId, role);
  if (ag.agreed == 0) return res.status(403).json({ error: 'لا يمكن تغيير قرار الرفض' });
  res.json({ message: '✅ تم تسجيل موافقتك على اتفاقية استخدام البرنامج', agreement: ag });
});

// Reject agreement (permanent - cannot open diwaniya ever)
app.post('/api/agreements/reject', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id);
  const role = user && user.can_open_diwaniya == 1 ? 'manager' : (req.user.role === 'founder' ? 'founder' : 'member');
  const ag = db.rejectAgreement(req.user.id, req.user.familyId, role);
  res.json({ message: 'تم تسجيل رفضك - لن تستطيع فتح الديوانية', agreement: ag });
});

// Get family agreements (founder)
app.get('/api/agreements/family', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.json({ agreements: [] });
  const agreements = db.getFamilyAgreements(req.user.familyId);
  res.json({ agreements });
});

// Get all agreements (admin)
app.get('/api/admin/agreements', authMiddleware, adminMiddleware, (req, res) => {
  const agreements = db.getAllAgreements();
  const founders = agreements.filter(a => a.role_at_agreement === 'founder');
  const managers = agreements.filter(a => a.role_at_agreement === 'manager');
  const members = agreements.filter(a => a.role_at_agreement === 'member');
  res.json({ founders, managers, members, total: agreements.length });
});

// =============== MODERATION ROUTES ===============

// Banned words (admin)
app.get('/api/admin/banned-words', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ words: db.getBannedWords() });
});
app.post('/api/admin/banned-words/add', authMiddleware, adminMiddleware, (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ error: 'الكلمة مطلوبة' });
  db.addBannedWord(word);
  res.json({ message: '🚫 تمت إضافة الكلمة للقائمة السوداء' });
});
app.post('/api/admin/banned-words/delete', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.body;
  db.deleteBannedWord(id);
  res.json({ message: '✅ تم الحذف' });
});

// Ban/unban user (admin)
app.get('/api/admin/bans', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ bans: db.getAllBans() });
});
app.post('/api/admin/bans/ban', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, reason, durationHours } = req.body;
  if (!userId || !reason || !durationHours) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const ban = db.banUser(userId, reason, parseInt(durationHours), req.user.id);
  res.json({ message: '⛔ تم إيقاف العضوية', ban });
});
app.post('/api/admin/bans/unban', authMiddleware, adminMiddleware, (req, res) => {
  const { userId } = req.body;
  db.unbanUser(userId);
  res.json({ message: '✅ تم إلغاء الإيقاف' });
});

// Diwaniya managers (founder)
app.post('/api/family/diwaniya-manager', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط المؤسس' });
  const { userId, canOpen } = req.body;
  if (!userId) return res.status(400).json({ error: 'العضو مطلوب' });
  if (canOpen && db.countDiwaniyaManagers(req.user.familyId) >= 2) {
    return res.status(400).json({ error: 'الحد الأقصى عضوان يمكنهم فتح الديوانية' });
  }
  db.setDiwaniyaManager(userId, canOpen);
  res.json({ message: canOpen ? '✅ تم منح الصلاحية' : 'تم سحب الصلاحية' });
});

// =============== AUCTIONS ROUTES ===============

// Get active auctions (public - visitors can view, login to bid)
app.get('/api/auctions/active', (req, res) => {
  const auctions = db.getActiveAuctions();
  res.json({ auctions });
});

// Get auction details with bids
app.get('/api/auctions/:id', authMiddleware, (req, res) => {
  const auction = db.getAuctionById(req.params.id);
  if (!auction) return res.status(404).json({ error: 'المزاد غير موجود' });
  const bids = db.getAuctionBids(req.params.id);
  const participated = !!db.isAuctionParticipant(req.params.id, req.user.id);
  res.json({ auction, bids, participated });
});

// Join auction (pay entry fee - simulated)
app.post('/api/auctions/join', authMiddleware, (req, res) => {
  const { auctionId } = req.body;
  if (!auctionId) return res.status(400).json({ error: 'معرف المزاد مطلوب' });
  const result = db.joinAuction(auctionId, req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ message: '✅ تم الدخول للمزاد (رسوم الدخول: ' + result.entry_fee + ' ريال)', joined: true });
});

// Place bid
app.post('/api/auctions/bid', authMiddleware, (req, res) => {
  const { auctionId, amount } = req.body;
  if (!auctionId || !amount) return res.status(400).json({ error: 'المزاد والمبلغ مطلوبان' });
  const result = db.placeBid(auctionId, req.user.id, parseInt(amount));
  if (result.error) return res.status(400).json(result);
  res.json({ message: '✅ تمت المزايدة: ' + amount + ' ريال', auction: result });
});

// Admin: create auction
app.post('/api/admin/auctions/create', authMiddleware, adminMiddleware, (req, res) => {
  const { code, startingPrice, entryFee, durationMinutes, minIncrement } = req.body;
  if (!code || !startingPrice || !entryFee || !durationMinutes) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  const auction = db.createAuction(code, parseInt(startingPrice), parseInt(entryFee), parseInt(durationMinutes), parseInt(minIncrement || 10), req.user.id);
  if (auction?.error) return res.status(400).json(auction);
  res.json({ message: '🏷️ تم فتح المزاد', auction });
});

// Get available codes for auction (admin)
app.get('/api/admin/auctions/available-codes', authMiddleware, adminMiddleware, (req, res) => {
  const codes = db.getAvailableAuctionCodes();
  res.json({ codes });
});

// Admin: all auctions
app.get('/api/admin/auctions', authMiddleware, adminMiddleware, (req, res) => {
  const auctions = db.getAllAuctions();
  res.json({ auctions });
});

// Admin: end auction
app.post('/api/admin/auctions/end', authMiddleware, adminMiddleware, (req, res) => {
  const { auctionId } = req.body;
  const auction = db.endAuction(auctionId);
  if (!auction) return res.status(400).json({ error: 'المزاد غير متاح' });
  res.json({ message: '🏁 تم إنهاء المزاد', auction });
});

// Admin: confirm payment
app.post('/api/admin/auctions/confirm-payment', authMiddleware, adminMiddleware, (req, res) => {
  const { auctionId } = req.body;
  const auction = db.confirmAuctionPayment(auctionId);
  if (!auction) return res.status(400).json({ error: 'المزاد غير موجود' });
  res.json({ message: '💰 تم تأكيد السداد، وحصل الفائز على الرمز', auction });
});

// Admin: cancel auction
app.post('/api/admin/auctions/cancel', authMiddleware, adminMiddleware, (req, res) => {
  const { auctionId } = req.body;
  const auction = db.cancelAuction(auctionId);
  if (!auction) return res.status(400).json({ error: 'المزاد غير موجود' });
  res.json({ message: '❌ تم إلغاء المزاد', auction });
});

// =============== FAMILY ROUTES ===============

// Get family info
app.get('/api/family', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const family = db.getFamily(req.user.familyId);
  const members = db.getFamilyMembers(req.user.familyId);
  const invitations = db.getInvitationsByFamily(req.user.familyId);
  const founder = db.getUserById(family.founder_id);
  res.json({ family, members, invitations, founder });
});

// Send invitations
app.post('/api/family/invite', authMiddleware, (req, res) => {
  if (req.user.role !== 'founder') {
    return res.status(403).json({ error: 'فقط مؤسس العائلة يمكنه إرسال الدعوات' });
  }
  
  const { emails } = req.body; // array of emails
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'يرجى إرسال قائمة بالإيميلات' });
  }

  const results = [];
  for (const email of emails) {
    const inv = db.createInvitation(req.user.familyId, email.trim(), req.user.id);
    if (inv) {
      results.push({
        email: inv.email,
        token: inv.token,
        status: 'sent',
        inviteUrl: `${req.protocol}://${req.get('host')}/invite?token=${inv.token}`
      });
    } else {
      results.push({ email, status: 'already_pending_or_member' });
    }
  }
  
  res.json({ invitations: results });
});

// Get family invitations
app.get('/api/family/invitations', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const invitations = db.getInvitationsByFamily(req.user.familyId);
  res.json({ invitations });
});

// =============== DIWANIYA ROUTES ===============

// Open diwaniya
app.post('/api/diwaniya/open', authMiddleware, (req, res) => {
  const userFull = db.getUserById(req.user.id);
  const isFounder = req.user.role === 'founder';
  const isManager = userFull && userFull.can_open_diwaniya == 1;
  if (!isFounder && !isManager) {
    return res.status(403).json({ error: 'فقط المؤسس أو من منحه الصلاحية يمكنه فتح الديوانية' });
  }
  
  // Check agreement - rejected users can NEVER open diwaniya
  const ag = db.getAgreement(req.user.id);
  if (ag && ag.agreed == 0) {
    return res.status(403).json({ error: '❌ لم توافق على اتفاقية استخدام البرنامج، لا يمكنك فتح الديوانية أبداً' });
  }
  
  // Check diwaniya lockdown
  if (req.user.familyId) {
    const lock = db.getDiwaniyaLock(req.user.familyId);
    if (lock) {
      const remainingMs = new Date(lock.locked_until).getTime() - Date.now();
      const remainingH = Math.floor(remainingMs / 3600000);
      const remainingM = Math.floor((remainingMs % 3600000) / 60000);
      return res.status(403).json({
        error: '🔒 الديوانية مغلقة بسبب مخالفة من ' + lock.locked_by + '، متبقي ' + remainingH + ' ساعة و ' + remainingM + ' دقيقة',
        locked: true,
        locked_until: lock.locked_until,
        locked_by: lock.locked_by,
        reason: lock.reason
      });
    }
  }
  
  const { durationMinutes, topic, mode } = req.body;
  const duration = durationMinutes || 30;
  const diwaniyaMode = mode || 'text';
  
  if (duration < 15 || duration > 60) {
    return res.status(400).json({ error: 'المدة يجب أن تكون بين 15 و 60 دقيقة' });
  }
  
  if (!['text', 'audio', 'video', 'both', 'all'].includes(diwaniyaMode)) {
    return res.status(400).json({ error: 'نوع الديوانية غير صالح' });
  }

  const result = db.openDiwaniya(req.user.familyId, req.user.id, duration, topic || '', diwaniyaMode);
  if (result.error) {
    return res.status(400).json(result);
  }
  
  // Notify family members via socket
  io.to(`family_${req.user.familyId}`).emit('diwaniya_opened', result);
  
  res.json(result);
});

// Close diwaniya
app.post('/api/diwaniya/close/:sessionId', authMiddleware, (req, res) => {
  if (req.user.role !== 'founder') {
    return res.status(403).json({ error: 'فقط مؤسس العائلة يمكنه إغلاق الديوانية' });
  }
  
  const result = db.closeDiwaniya(req.params.sessionId, req.user.id);
  if (!result) return res.status(404).json({ error: 'الديوانية غير موجودة أو مغلقة' });
  
  io.to(`family_${req.user.familyId}`).emit('diwaniya_closed', result);
  res.json(result);
});

// Get active diwaniya + lockdown status
app.get('/api/diwaniya/active', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const session = db.getActiveDiwaniya(req.user.familyId);
  const lock = db.getDiwaniyaLock(req.user.familyId);
  res.json({ session, lock });
});

// Get diwaniya history
app.get('/api/diwaniya/history', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const history = db.getDiwaniyaHistory(req.user.familyId);
  res.json({ history });
});

// Get diwaniya messages
app.get('/api/diwaniya/messages/:sessionId', authMiddleware, (req, res) => {
  const messages = db.getDiwaniyaMessages(req.params.sessionId);
  res.json({ messages });
});

// Send message to diwaniya (REST fallback)
app.post('/api/diwaniya/message', authMiddleware, (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'الرسالة مطلوبة' });
  
  // Moderator is observer only - cannot post
  const msgUser = db.getUserById(req.user.id);
  if (msgUser && msgUser.role === 'moderator') {
    return res.status(403).json({ error: '🕵️ المشرف مراقب فقط ولا يحق له المشاركة' });
  }
  
  // Check banned words
  const banned = db.checkBannedWord(message);
  if (banned) {
    return res.status(400).json({ error: '🚫 تحتوي الرسالة على كلمة ممنوعة، تم حجبها', bannedWord: banned });
  }
  
  const result = db.addDiwaniyaMessage(sessionId, req.user.id, message);
  io.to(`session_${sessionId}`).emit('diwaniya_message', result);
  res.json(result);
});

// =============== CHALLENGES & GAMES ROUTES ===============

// Create challenge
app.post('/api/challenges/create', authMiddleware, (req, res) => {
  const { gameType, opponentId, points } = req.body;
  if (!gameType || !opponentId) return res.status(400).json({ error: 'نوع اللعبة والمعارض مطلوب' });
  
  const challenge = db.createChallenge(req.user.familyId, gameType, req.user.id, opponentId, points || 10);
  
  // Notify opponent via socket
  io.to(`user_${opponentId}`).emit('new_challenge', challenge);
  io.to(`family_${req.user.familyId}`).emit('challenge_created', challenge);
  
  res.json(challenge);
});

// Respond to challenge
app.post('/api/challenges/respond/:challengeId', authMiddleware, (req, res) => {
  const { accept } = req.body; // true/false
  const challenge = db.respondToChallenge(req.params.challengeId, req.user.id, accept);
  if (!challenge) return res.status(404).json({ error: 'التحدي غير موجود' });
  
  io.to(`family_${req.user.familyId}`).emit('challenge_responded', challenge);
  res.json(challenge);
});

// Complete challenge
app.post('/api/challenges/complete/:challengeId', authMiddleware, (req, res) => {
  const { winnerId, challengerScore, opponentScore } = req.body;
  const challenge = db.completeChallenge(req.params.challengeId, winnerId, challengerScore, opponentScore);
  if (!challenge) return res.status(404).json({ error: 'التحدي غير موجود' });
  
  io.to(`family_${req.user.familyId}`).emit('challenge_completed', challenge);
  // Update leaderboard
  io.to(`family_${req.user.familyId}`).emit('leaderboard_update', db.getFamilyLeaderboard(req.user.familyId));
  
  res.json(challenge);
});

// Get family challenges
app.get('/api/challenges', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const challenges = db.getFamilyChallenges(req.user.familyId);
  const pending = db.getPendingChallenges(req.user.id);
  res.json({ challenges, pending });
});

// =============== LEADERBOARD ===============

app.get('/api/leaderboard', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const leaderboard = db.getFamilyLeaderboard(req.user.familyId);
  res.json({ leaderboard });
});

// =============== VALIDATE SUBSCRIPTION CODE ===============

app.post('/api/validate-code', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'الرمز مطلوب' });
  const valid = db.validateSubscriptionCode(code);
  res.json({ valid: !!valid });
});

// =============== SOCKET.IO ===============

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_family', (familyId) => {
    socket.join(`family_${familyId}`);
    console.log(`Socket ${socket.id} joined family ${familyId}`);
  });

  socket.on('join_user', (userId) => {
    socket.userId = userId;
    socket.join(`user_${userId}`);
    onlineUsers.add(userId);
    console.log(`🟢 ${userId} online`);
    // Notify family members that this user is online
    const user = db.getUserById(userId);
    if (user && user.family_id) {
      io.to(`family_${user.family_id}`).emit('user_online', { userId, name: user.name });
    }
  });

  socket.on('join_session', (sessionId) => {
    socket.join(`session_${sessionId}`);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('diwaniya_message', (data) => {
    const { sessionId, userId, message } = data;
    // Moderator is observer only
    const sender = db.getUserById(userId);
    if (sender && sender.role === 'moderator') {
      io.to(`user_${userId}`).emit('message_blocked', { message: '🕵️ المشرف مراقب فقط ولا يحق له المشاركة' });
      return;
    }
    // Check banned words - block and warn the writer
    const banned = db.checkBannedWord(message);
    if (banned) {
      io.to(`user_${userId}`).emit('message_blocked', {
        message: '🚫 رسالتك تحتوي على كلمة ممنوعة ولم تُرسل',
        bannedWord: banned
      });
      return;
    }
    const result = db.addDiwaniyaMessage(sessionId, userId, message);
    if (result) {
      io.to(`session_${sessionId}`).emit('diwaniya_message', result);
      const user = db.getUserById(userId);
      if (user?.family_id) {
        io.to(`family_${user.family_id}`).emit('diwaniya_activity', {
          sessionId, userName: result.user_name, preview: message.substring(0, 50)
        });
      }
    }
  });

  socket.on('diwaniya_audio', (data) => {
    const { sessionId, userId, message, audio, audioType } = data;
    const result = db.addDiwaniyaMessage(sessionId, userId, message);
    if (result) {
      // Broadcast audio to all in session
      io.to(`session_${sessionId}`).emit('diwaniya_audio', {
        user_name: result.user_name, audio, audioType, user_id: userId
      });
    }
  });

  socket.on('game_move', (data) => {
    const { challengeId, gameType, move } = data;
    // Forward game moves to the other player
    socket.to(`game_${challengeId}`).emit('game_move', move);
  });

  socket.on('join_game', (challengeId) => {
    socket.join(`game_${challengeId}`);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
    // Remove user from online if they had joined
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      const user = db.getUserById(socket.userId);
      if (user && user.family_id) {
        io.to(`family_${user.family_id}`).emit('user_offline', { userId: socket.userId });
      }
      console.log(`🔴 ${socket.userId} offline`);
    }
  });

  // Family notification (invite all members)
  socket.on('family_notify', (data) => {
    const { familyId, message, title } = data;
    io.to(`family_${familyId}`).emit('family_notification', { title: title || '🔔 تنبيه العائلة', message, time: Date.now() });
    console.log(`🔔 Notification sent to family ${familyId}`);
  });

  // WebRTC Audio Call Signaling
  const audioRooms = {};
  
  socket.on('join_audio_call', (data) => {
    const { sessionId, userId, userName } = data;
    socket.join(`audio_${sessionId}`);
    
    if (!audioRooms[sessionId]) audioRooms[sessionId] = [];
    const participants = audioRooms[sessionId];
    
    // Max 6 participants in video/audio call
    if (participants.length >= 6) {
      socket.emit('call_full', { message: 'المكالمة ممتلئة - الحد الأقصى 6 مشاركين' });
      socket.leave(`audio_${sessionId}`);
      return;
    }
    
    // Tell existing participants about new user
    participants.forEach(p => {
      io.to(p.socketId).emit('user_joined_call', { userId, userName });
    });
    
    participants.push({ socketId: socket.id, userId, userName });
    
    // Send current participants to the new user
    socket.emit('call_participants', { 
      participants: participants.filter(p => p.socketId !== socket.id)
    });
    
    console.log(`🎤 ${userName} joined audio call ${sessionId} (${participants.length}/6)`);
  });
  
  socket.on('leave_audio_call', (data) => {
    const { sessionId, userId } = data;
    socket.leave(`audio_${sessionId}`);
    
    if (audioRooms[sessionId]) {
      audioRooms[sessionId] = audioRooms[sessionId].filter(p => p.socketId !== socket.id);
      if (audioRooms[sessionId].length === 0) delete audioRooms[sessionId];
    }
    
    socket.to(`audio_${sessionId}`).emit('user_left_call', { userId });
    console.log(`🎤 User left audio call ${sessionId}`);
  });
  
  socket.on('audio_offer', (data) => {
    const { to, offer, sessionId, userName } = data;
    io.to(to).emit('audio_offer', { from: socket.id, offer, userName, sessionId });
  });
  
  socket.on('audio_answer', (data) => {
    const { to, answer, sessionId } = data;
    io.to(to).emit('audio_answer', { from: socket.id, answer, sessionId });
  });
  
  socket.on('audio_ice_candidate', (data) => {
    const { to, candidate, sessionId } = data;
    io.to(to).emit('audio_ice_candidate', { from: socket.id, candidate, sessionId });
  });
});

// =============== SEED DATA ===============

async function seedData() {
  await db.getDb();
  try {
    // Generate some subscription codes directly
    const newCodes = db.generateSubscriptionCodes(5);
    // Get available codes by reading from the database via our helper
    console.log('📋 رموز الاشتراك المتاحة:', newCodes.join(', '));
  } catch(e) {
    console.log('Seed error:', e.message);
  }
}

// =============== START SERVER ===============

seedData().then(() => {
  // Create default admin account
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@familylive.com';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123456';
    const existingAdmin = db.getUserByEmail(adminEmail);
    if (!existingAdmin) {
      const hashedPass = bcrypt.hashSync(adminPass, 10);
      db.createAdminUser(adminEmail, hashedPass);
      console.log('✅ Created admin account: ' + adminEmail);
    }
  } catch(e) { console.log('Admin seed error:', e.message); }
  
  // Create default moderator account
  try {
    const modEmail = 'abdmmm9@gmail.com';
    const modPass = 'Koad@055282312';
    const hashedMod = bcrypt.hashSync(modPass, 10);
    db.createUserByRole(modEmail, hashedMod, 'مشرف الديوانيات', 'moderator');
    console.log('✅ Created moderator account: ' + modEmail);
  } catch(e) { console.log('Moderator seed error:', e.message); }
  
  // Seed default support messages
  try {
    if (db.countSupportMessages() === 0) {
      db.addSupportMessage('تحية مراقب الديوانيات', 'السلام عليكم ورحمة الله وبركاته، أنا مراقب الديوانيات جئت للسماع منكم عن مشاكل التطبيق ومقترحاتكم.');
      db.addSupportMessage('التواصل مع الدعم الفني', 'تنبيه: عند وجود مقترحات أو شكاوى أو مشاكل فنية بالحساب، يرجى مراسلة الإدارة عبر برنامج الدعم الفني فقط.');
      console.log('✅ Seeded default support messages');
    }
  } catch(e) { console.log('Support seed error:', e.message); }
  
  // Create default user if not exists
  try {
    const existing = db.getUserByEmail('abdm@live.com');
    if (!existing) {
      // Generate premium codes
      db.generatePremiumCode();
      db.generatePremiumCode();
      // Get the first available code
      const code = db.getFirstAvailablePremiumCode() || 'AAAAAAAA';
      const hashedPassword = bcrypt.hashSync('Koad@055282312', 10);
      const family = db.createFamily('عائلتي', code);
      if (family) {
        const user = db.createUser('عبدالله', 'abdm@live.com', hashedPassword, family.id, 'founder');
        db.updateFamilyFounder(family.id, user.id);
        console.log('✅ Created default user and family');
      }
    }
  } catch(e) { console.log('Seed error:', e.message); }
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌙 تطبيق العائلة يعمل على المنفذ ${PORT}`);
    console.log(`📱 افتح المتصفح: http://localhost:${PORT}`);
  });
});
