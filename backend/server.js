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
app.use(async (req, res, next) => {
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
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, subscriptionCode, familyName } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول المطلوبة' });
  }

  // Check if user exists
  const existing = await db.getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  // If subscription code provided, it's a founder creating a family
  if (subscriptionCode && familyName) {
    // Check if user already has a family
    const existingUser = await db.getUserByEmail(email);
    if (existingUser && existingUser.family_id) {
      return res.status(400).json({ error: 'لديك عائلة بالفعل. يمكنك إنشاء عائلة واحدة فقط.' });
    }
    
    const validCode = await db.validateSubscriptionCode(subscriptionCode);
    if (!validCode) {
      return res.status(400).json({ error: 'رمز الاشتراك غير صالح أو مستخدم مسبقاً' });
    }
    
    const family = await db.createFamily(familyName, subscriptionCode);
    if (!family) {
      return res.status(400).json({ error: 'فشل في إنشاء العائلة' });
    }
    
    const user = await db.createUser(name, email, hashedPassword, family.id, 'founder');
    // Update family with founder
    await db.updateFamilyFounder(family.id, user.id);
    
    const token = jwt.sign({ id: user.id, email: user.email, familyId: user.family_id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    
    return res.json({
      token,
      user,
      family: await db.getFamily(family.id)
    });
  }

  // Without subscription code - check if coming from invitation
  // (handled by invitation flow)
  return res.status(400).json({ error: 'مطلوب رمز الاشتراك لتسجيل عائلة جديدة' });
});

// Register via invitation
app.post('/api/auth/register-invited', async (req, res) => {
  const { name, email, password, token } = req.body;
  
  if (!name || !email || !password || !token) {
    return res.status(400).json({ error: 'يرجى تعبئة جميع الحقول' });
  }

  const invitation = await db.getInvitationByToken(token);
  if (!invitation) {
    return res.status(400).json({ error: 'الدعوة غير صالحة أو منتهية' });
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const user = await db.createUser(name, email, hashedPassword, invitation.family_id, 'member');
  
  // Accept invitation
  await db.acceptInvitation(token, user.id);
  
  const tokenJwt = jwt.sign({ id: user.id, email: user.email, familyId: user.family_id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  
  res.json({
    token: tokenJwt,
    user,
    family: await db.getFamily(user.family_id)
  });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'يرجى إدخال البريد وكلمة المرور' });
  }

  const user = await db.getUserByEmail(email);
  if (!user) {
    return res.status(400).json({ error: 'البريد غير مسجل' });
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });
  }
  
  // Check active ban
  const activeBan = await db.getActiveBan(user.id);
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
    family: user.family_id ? await db.getFamily(user.family_id) : null
  });
});

// Verify token
app.get('/api/auth/verify', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  await db.updateLastSeen(req.user.id);
  res.json({ user, family: user.family_id ? await db.getFamily(user.family_id) : null });
});

// =============== CODES ROUTES ===============

// Get available premium codes
app.get('/api/codes/available', authMiddleware, async (req, res) => {
  const codes = await db.getAvailablePremiumCodes();
  res.json({ codes });
});

// Purchase a premium code
app.post('/api/codes/purchase', authMiddleware, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'الرمز مطلوب' });
  const result = await db.purchaseCode(req.user.id, code);
  if (!result) return res.status(400).json({ error: 'الرمز غير متاح للشراء' });
  res.json({ message: 'تم شراء الرمز المميز بنجاح بقيمة 200 ريال ✅', code: result });
});

// Generate premium code
app.post('/api/codes/generate-premium', async (req, res) => {
  const code = await db.generatePremiumCode();
  res.json({ code, message: 'تم إنشاء رمز مميز: ' + code });
});

// Get user's purchased codes
app.get('/api/codes/my', authMiddleware, async (req, res) => {
  const codes = await db.getUserCodes(req.user.id);
  res.json({ codes });
});

// Forgot password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  const user = await db.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'البريد غير مسجل' });
  const resetToken = require('uuid').v4();
  res.json({ message: 'تم إرسال رابط إعادة تعيين كلمة المرور', devToken: resetToken });
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان' });
  const user = await db.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'البريد غير مسجل' });
  const hashedPassword = bcrypt.hashSync(password, 10);
  await db.updatePassword(email, hashedPassword);
  res.json({ message: 'تم تغيير كلمة المرور بنجاح ✅' });
});

// Get all codes (admin)
app.get('/api/codes/admin/all', authMiddleware, async (req, res) => {
  try {
    const codes = await db.execQuery("SELECT code, type, price, purchased_by, used FROM subscription_codes ORDER BY type DESC, code ASC");
    res.json({ codes });
  } catch(e) {
    res.json({ codes: [] });
  }
});

// Update code price (admin)
app.post('/api/codes/admin/update-price', authMiddleware, async (req, res) => {
  const { code, price } = req.body;
  if (!code || price === undefined) return res.status(400).json({ error: 'الرمز والسعر مطلوبان' });
  await db.updatePrice(code, parseInt(price));
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
app.get('/api/admin/families', authMiddleware, adminMiddleware, async (req, res) => {
  const families = await db.getAllFamilies();
  res.json({ families });
});

// Update family (admin)
app.post('/api/admin/families/update', authMiddleware, adminMiddleware, async (req, res) => {
  const { familyId, name, subscription_code, status } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  const result = await db.updateFamilyData(familyId, { name, subscription_code, status });
  if (result?.error) return res.status(400).json(result);
  res.json({ message: '✅ تم تحديث العائلة', family: result });
});

// Set family status active/inactive (admin)
app.post('/api/admin/families/status', authMiddleware, adminMiddleware, async (req, res) => {
  const { familyId, status } = req.body;
  if (!familyId || !['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }
  const family = await db.setFamilyStatus(familyId, status);
  res.json({ message: status === 'active' ? '✅ تم تفعيل العائلة' : '⛔ تم إيقاف العائلة', family });
});

// Delete family (admin)
app.post('/api/admin/families/delete', authMiddleware, adminMiddleware, async (req, res) => {
  const { familyId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  await db.deleteFamily(familyId);
  res.json({ message: '🗑️ تم حذف العائلة' });
});

// Admin dashboard stats
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const stats = await db.getAdminStats();
  res.json({ stats });
});

// =============== ADS & PUBLIC ROUTES ===============

// Get active ads (public)
app.get('/api/ads', async (req, res) => {
  const ads = await db.getActiveAds();
  res.json({ ads });
});

// Track ad view (public)
app.post('/api/ads/view', async (req, res) => {
  const { id } = req.body;
  if (id) await db.trackAdView(id);
  res.json({ ok: true });
});

// Track ad click (public)
app.post('/api/ads/click', async (req, res) => {
  const { id } = req.body;
  if (id) await db.trackAdClick(id);
  res.json({ ok: true });
});

// Admin: ads stats
app.get('/api/admin/ads/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const stats = await db.getAdsStats();
  const ads = await db.getAllAds();
  res.json({ stats, ads });
});

// Get featured families (public)
app.get('/api/featured-families', async (req, res) => {
  const families = await db.getFeaturedFamilies(5);
  res.json({ families });
});

// Admin: all ads
app.get('/api/admin/ads', authMiddleware, adminOrModerator, async (req, res) => {
  const ads = await db.getAllAds();
  res.json({ ads });
});

// Admin: add ad
app.post('/api/admin/ads/add', authMiddleware, adminOrModerator, async (req, res) => {
  const { title, image_url, link_url, position } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  const ad = await db.addAd(title, image_url || '', link_url || '', position || 'banner');
  res.json({ message: '✅ تم إضافة الإعلان', ad });
});

// Admin: update ad
app.post('/api/admin/ads/update', authMiddleware, adminOrModerator, async (req, res) => {
  const { id, title, image_url, link_url, status } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الإعلان مطلوب' });
  const ad = await db.updateAd(id, title, image_url || '', link_url || '', status || 'active');
  res.json({ message: '✅ تم تحديث الإعلان', ad });
});

// Admin: delete ad
app.post('/api/admin/ads/delete', authMiddleware, adminOrModerator, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الإعلان مطلوب' });
  await db.deleteAd(id);
  res.json({ message: '🗑️ تم حذف الإعلان' });
});

// =============== FOUNDER: EDIT OWN FAMILY ===============

// Get family edit info (founder)
app.get('/api/family/edit-info', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  res.json({ info: await db.getFamilyEditInfo(req.user.familyId) });
});

// Founder edits own family name (90-day rule + 3 free changes + 100 SAR payment)
app.post('/api/family/edit', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط مؤسس العائلة يمكنه التعديل' });
  const { name, subscription_code, paid } = req.body;
  
  const info = await db.getFamilyEditInfo(req.user.familyId);
  const isNameChange = name && name !== await db.getFamily(req.user.familyId).name;
  
  if (isNameChange) {
    // 90-day check
    if (info.days_left > 0) {
      return res.status(403).json({
        error: 'لا يمكنك تعديل اسم العائلة إلا بعد ' + info.days_left + ' يوم',
        daysLeft: info.days_left,
        requiresConfirm: true
      });
    }
    // Free changes check
    if (info.changes_count >= info.free_changes && !paid) {
      return res.json({
        requiresPayment: true,
        price: info.price,
        message: 'استهلكت ' + info.free_changes + ' تعديلات مجانية - التعديل القادم بـ ' + info.price + ' ريال'
      });
    }
    await db.recordFamilyNameChange(req.user.familyId);
  }
  
  if (name) {
    await db.runRaw('UPDATE families SET name = ? WHERE id = ?', [name, req.user.familyId]);
  }
  if (subscription_code) {
    const used = await db.execQuery("SELECT id FROM families WHERE subscription_code = $1 AND id != $2", [subscription_code, req.user.familyId]);
    if (used.length) {
      return res.status(400).json({ error: 'الرمز مستخدم من عائلة أخرى' });
    }
    await db.runRaw('UPDATE families SET subscription_code = ? WHERE id = ?', [subscription_code, req.user.familyId]);
  }
  res.json({ message: '✅ تم تحديث بيانات العائلة', family: await db.getFamily(req.user.familyId) });
});

// =============== PROFILE ROUTES ===============

// Update profile
app.post('/api/profile/update', authMiddleware, async (req, res) => {
  const { name, country, city, phone, whatsapp, avatar, currency } = req.body;
  const user = await db.updateProfile(req.user.id, { name, country, city, phone, whatsapp, avatar, currency });
  res.json({ message: '✅ تم تحديث الملف الشخصي', user });
});

// Leave family
app.post('/api/profile/leave-family', authMiddleware, async (req, res) => {
  const result = await db.leaveFamily(req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ message: 'تم الخروج من عائلة ' + result.family_name, success: true });
});

// Get user's subscribed families
app.get('/api/profile/families', authMiddleware, async (req, res) => {
  const families = await db.getUserFamilies(req.user.id);
  res.json({ families, currentFamilyId: req.user.familyId });
});

// Switch current family
app.post('/api/profile/switch-family', authMiddleware, async (req, res) => {
  const { familyId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  
  // Check user is subscribed to this family
  const families = await db.getUserFamilies(req.user.id);
  const exists = families.find(f => f.family_id === familyId);
  if (!exists) return res.status(400).json({ error: 'أنت غير مشترك في هذه العائلة' });
  
  const family = await db.getFamily(familyId);
  if (!family || family.status === 'inactive') return res.status(400).json({ error: 'العائلة غير متاحة' });
  
  await db.setCurrentFamily(req.user.id, familyId);
  await db.runRaw('UPDATE users SET family_id = ? WHERE id = ?', [familyId, req.user.id]);
  
  res.json({ message: '✅ تم التبديل إلى عائلة ' + family.name, family });
});

// =============== ONLINE & FAMILY MEMBERSHIP ===============

// Online user IDs (tracked via socket)
const onlineUsers = new Set();

// Get online status of family members
app.get('/api/family/online', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.json({ online: [] });
  const members = await db.getFamilyMembers(req.user.familyId);
  const online = members.filter(m => onlineUsers.has(m.id)).map(m => m.id);
  res.json({ online });
});

// Get all online users (admin)
app.get('/api/admin/online', authMiddleware, adminMiddleware, async (req, res) => {
  const allUsers = await db.execQuery('SELECT id, name, family_id FROM users');
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
  let families = [];
  try {
    families = await db.execQuery('SELECT * FROM families');
  } catch(e) {}
  const famData = families.map(f => {
    const members = result.filter(u => u.family_id === f.id);
    const onlineCount = members.filter(m => m.online).length;
    return { ...f, members, onlineCount };
  });
  res.json({ onlineUsers: [...onlineUsers], families: famData });
});

// Join family by subscription code (logged-in user, no registration needed)
app.post('/api/family/join-by-code', authMiddleware, async (req, res) => {
  const { code, paid } = req.body;
  if (!code) return res.status(400).json({ error: 'رمز العائلة مطلوب' });
  
  // Find family by code
  const families = await db.execQuery("SELECT id, name, status FROM families WHERE subscription_code = $1", [code.toUpperCase()]);
  if (!families.length) {
    return res.status(404).json({ error: 'رمز العائلة غير صحيح' });
  }
  const family = { id: families[0].id, name: families[0].name, status: families[0].status };
  if (family.status === 'inactive') return res.status(400).json({ error: 'هذه العائلة موقوفة' });
  
  const count = await db.getUserFamilyCount(req.user.id);
  const joinPrice = parseInt(await db.getSetting('join_family_price', '20'));
  
  // Already in this family?
  const existing = await db.getUserFamilies(req.user.id).find(f => f.family_id === family.id);
  if (existing) return res.status(400).json({ error: 'أنت بالفعل في هذه العائلة' });
  
  if (count >= 5) return res.status(400).json({ error: 'وصلت للحد الأقصى 5 عوائل' });
  
  // Check premium code (auction winners get 5 families free)
  let hasPremium = false;
  try {
    const pc = await db.execQuery("SELECT COUNT(*) c FROM user_codes WHERE user_id = $1 AND type = 'premium'", [req.user.id]);
    if (pc.length) hasPremium = pc[0].c > 0;
  } catch(e) {}
  
  // 1st family free (or premium holder), 2nd+ requires 20 SAR
  const needsPayment = count >= 1 && !hasPremium;
  if (needsPayment && !paid) {
    return res.json({ requiresPayment: true, price: joinPrice, family: { id: family.id, name: family.name, code: code.toUpperCase() } });
  }
  
  await db.addUserToFamily(req.user.id, family.id, 1);
  await db.setCurrentFamily(req.user.id, family.id);
  await db.runRaw('UPDATE users SET family_id = ? WHERE id = ?', [family.id, req.user.id]);
  
  res.json({ message: '✅ تم الانضمام لعائلة ' + family.name, family: { ...family, code: code.toUpperCase() } });
});

// Join another family (with payment for 2nd+)
app.post('/api/family/join', authMiddleware, async (req, res) => {
  const { familyId } = req.body;
  if (!familyId) return res.status(400).json({ error: 'معرف العائلة مطلوب' });
  
  const count = await db.getUserFamilyCount(req.user.id);
  const joinPrice = parseInt(await db.getSetting('join_family_price', '20'));
  
  // Check if user bought premium from auction (5 families free)
  const maxFree = 1;
  const maxFamilies = 5;
  const hasPremium = count >= 0; // placeholder check
  
  if (count >= maxFamilies) {
    return res.status(400).json({ error: 'وصلت للحد الأقصى 5 عوائل' });
  }
  
  const family = await db.getFamily(familyId);
  if (!family) return res.status(400).json({ error: 'العائلة غير موجودة' });
  if (family.status === 'inactive') return res.status(400).json({ error: 'العائلة موقوفة' });
  
  // Already in this family?
  const existing = await db.getUserFamilies(req.user.id).find(f => f.family_id === familyId);
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
  
  await db.addUserToFamily(req.user.id, familyId, 1);
  await db.setCurrentFamily(req.user.id, familyId);
  // Update users table to current family
  await db.runRaw('UPDATE users SET family_id = ? WHERE id = ?', [familyId, req.user.id]);
  
  // If user has premium code from auction, they get 5 families free - check user_codes
  const premiumCodes = await db.execQuery("SELECT COUNT(*) c FROM user_codes WHERE user_id = $1 AND type = 'premium'", [req.user.id]);
  let hasPremiumCode = false;
  if (premiumCodes.length) {
    hasPremiumCode = premiumCodes[0].c > 0;
  }
  
  res.json({ message: '✅ تم الانضمام للعائلة ' + family.name, family, hasPremiumCode });
});

// =============== ANNOUNCEMENTS & LAST SEEN ===============

// Update last seen (call on auth)
app.get('/api/auth/verify', async (req, res, next) => {
  // Original verify handler runs below - just update last_seen
  next();
});

// Create announcement (founder)
app.post('/api/announcements/create', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const { title, content, announceType, targetUserId, eventTime } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  const ann = await db.createAnnouncement(req.user.familyId, req.user.id, title, content, announceType, targetUserId, eventTime);
  // Notify family members via socket
  io.to(`family_${req.user.familyId}`).emit('family_notification', {
    title: '📢 ' + title,
    message: content || 'إعلان جديد من مؤسس العائلة',
    time: Date.now()
  });
  res.json({ message: '📢 تم نشر الإعلان', announcement: ann });
});

// Get announcements for current user
app.get('/api/announcements', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.json({ announcements: [] });
  const announcements = await db.getAnnouncementsForUser(req.user.familyId, req.user.id);
  res.json({ announcements });
});

// Delete/dismiss announcement
app.post('/api/announcements/delete', authMiddleware, async (req, res) => {
  const { id } = req.body;
  await db.deleteAnnouncement(id);
  res.json({ message: 'تم' });
});

// =============== VIOLATIONS ROUTES ===============

// Get all users for violation reporting (admin)
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await db.execQuery('SELECT id, name, email, role FROM users ORDER BY name');
    res.json({ users });
  } catch(e) { res.json({ users: [] }); }
});

// Add violation (admin) - AI employee takes violation, sets duration
app.post('/api/admin/violations/add', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, reason, durationHours, violationType, evidence } = req.body;
  if (!userId || !reason || !durationHours) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const violation = await db.addViolation(userId, reason, parseInt(durationHours), violationType || 'text', evidence, req.user.id);
  
  // If violation is diwaniya-related, close diwaniya + lock it
  const violator = await db.getUserById(userId);
  if (violator && violator.family_id) {
    const activeSession = await db.getActiveDiwaniya(violator.family_id);
    if (activeSession) {
      await db.closeDiwaniya(activeSession.id);
    }
    // Lock diwaniya: founder ban duration, otherwise 24 hours
    const durationMs = (violator.role === 'founder' ? parseInt(durationHours) : 24) * 3600000;
    const lockedUntil = new Date(Date.now() + durationMs).toISOString();
    await db.lockDiwaniya(violator.family_id, lockedUntil, reason, violator.name);
    
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
app.get('/api/admin/violations', authMiddleware, adminMiddleware, async (req, res) => {
  const violations = await db.getAllViolations();
  const stats = await db.getViolationStats();
  res.json({ violations, stats });
});

// Moderation settings (admin)
app.get('/api/admin/moderation-settings', authMiddleware, adminMiddleware, async (req, res) => {
  res.json(await db.getModerationSettings());
});
app.post('/api/admin/moderation-settings', authMiddleware, adminMiddleware, async (req, res) => {
  const { ai_monitor_enabled, auto_ban_after, ai_employee_name } = req.body;
  if (ai_monitor_enabled !== undefined) await db.setModerationSetting('ai_monitor_enabled', ai_monitor_enabled);
  if (auto_ban_after !== undefined) await db.setModerationSetting('auto_ban_after', auto_ban_after);
  if (ai_employee_name !== undefined) await db.setModerationSetting('ai_employee_name', ai_employee_name);
  res.json({ message: '✅ تم حفظ الإعدادات', settings: await db.getModerationSettings() });
});

// =============== SUPPORT SYSTEM ROUTES ===============

// Admin: support messages CRUD
app.get('/api/admin/support-messages', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ messages: await db.getSupportMessages() });
});
app.post('/api/admin/support-messages/add', authMiddleware, adminMiddleware, async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
  await db.addSupportMessage(title, content);
  res.json({ message: '✅ تمت إضافة الرسالة' });
});
app.post('/api/admin/support-messages/delete', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.body;
  await db.deleteSupportMessage(id);
  res.json({ message: '🗑️ تم الحذف' });
});

// Get support messages for moderator (during visits)
app.get('/api/support-messages', authMiddleware, async (req, res) => {
  res.json({ messages: await db.getSupportMessages() });
});

// Moderator: send predefined message in diwaniya during visit
app.post('/api/moderator/send-message', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (user.role !== 'moderator' && user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط المشرفون' });
  }
  const { sessionId, messageId } = req.body;
  if (!sessionId || !messageId) return res.status(400).json({ error: 'الرسالة المطلوبة' });
  const msg = await db.execQuery('SELECT * FROM support_messages WHERE id = $1', [messageId]);
  if (!msg.length) return res.status(400).json({ error: 'الرسالة غير موجودة' });
  const row = msg[0];
  const content = row.content;
  const title = row.title;
  
  // Save as diwaniya message (persists in chat history)
  try {
    await db.addDiwaniyaMessage(sessionId, user.id, '🕵️ ' + title + ' — ' + content);
  } catch(e) {}
  io.to(`session_${sessionId}`).emit('moderator_message', {
    moderatorName: user.name,
    title: title,
    content: content
  });
  res.json({ message: '💬 تم إرسال رسالة المشرف' });
});

// Support tickets (users → admin only)
app.post('/api/support/ticket', authMiddleware, async (req, res) => {
  const { subject, message } = req.body;
  if (!message) return res.status(400).json({ error: 'نص الرسالة مطلوب' });
  const user = await db.getUserById(req.user.id);
  const ticket = await db.createSupportTicket(req.user.id, user.name, subject || 'استفسار', message);
  res.json({ message: '📨 تم إرسال رسالتك للإدارة', ticket });
});
app.get('/api/support/my-tickets', authMiddleware, async (req, res) => {
  res.json({ tickets: await db.getMyTickets(req.user.id) });
});
app.get('/api/admin/support-tickets', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ tickets: await db.getSupportTickets() });
});
app.post('/api/admin/support-tickets/reply', authMiddleware, adminMiddleware, async (req, res) => {
  const { ticketId, reply } = req.body;
  if (!ticketId || !reply) return res.status(400).json({ error: 'الرد مطلوب' });
  await db.replyTicket(ticketId, reply);
  res.json({ message: '✅ تم إرسال الرد' });
});
app.post('/api/admin/support-tickets/close', authMiddleware, adminMiddleware, async (req, res) => {
  const { ticketId } = req.body;
  await db.closeTicket(ticketId);
  res.json({ message: 'تم إغلاق التذكرة' });
});

// =============== USERS MANAGEMENT (ADMIN) ===============

// Get all users detailed (admin)
app.get('/api/admin/users-detailed', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ users: await db.getAllUsersDetailed() });
});

// Update user (admin) - edit, promote/demote
app.post('/api/admin/users/update', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, name, email, whatsapp, phone, role } = req.body;
  if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
  const result = await db.updateUserByAdmin(userId, { name, email, whatsapp, phone, role });
  if (result?.error) return res.status(400).json(result);
  res.json({ message: '✅ تم تحديث بيانات المستخدم', user: result });
});

// Delete user (admin)
app.post('/api/admin/users/delete', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
  await db.deleteUserByAdmin(userId);
  res.json({ message: '🗑️ تم حذف المستخدم' });
});

// =============== MODERATOR STARS & TIERS ===============

// Moderator profile (stars, tier, visits, rating)
app.get('/api/moderator/profile', authMiddleware, async (req, res) => {
  const profile = await db.getModeratorProfile(req.user.id);
  const tier = profile ? await db.getModeratorTier(profile.stars || 0) : 'none';
  res.json({ profile, tier, tierSettings: await db.getTierSettings() });
});

// Award stars on visit exit (every visit = stars)
// Rate moderator (family members rate 1-5 after moderator exits)
app.post('/api/moderator/rate', authMiddleware, async (req, res) => {
  const { moderatorId, visitId, rating, comment } = req.body;
  if (!moderatorId || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'التقييم من 1 إلى 5 نجوم' });
  }
  await db.rateModerator(moderatorId, visitId, req.user.familyId, parseInt(rating), comment, req.user.id);
  // Stars based on rating: rating * 10 stars
  const stars = parseInt(rating) * 10;
  await db.addModeratorStars(moderatorId, stars);
  res.json({ message: '⭐ تم تقييم المشرف', stars_added: stars });
});

// Admin: tier settings management
app.get('/api/admin/tier-settings', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ settings: await db.getTierSettings() });
});
app.post('/api/admin/tier-settings', authMiddleware, adminMiddleware, async (req, res) => {
  const { black, blue, silver, gold, platinum, stars_per_visit } = req.body;
  if (black) await db.setSetting('tier_black', black);
  if (blue) await db.setSetting('tier_blue', blue);
  if (silver) await db.setSetting('tier_silver', silver);
  if (gold) await db.setSetting('tier_gold', gold);
  if (platinum) await db.setSetting('tier_platinum', platinum);
  if (stars_per_visit) await db.setSetting('stars_per_visit', stars_per_visit);
  res.json({ message: '✅ تم حفظ إعدادات التوثيق', settings: await db.getTierSettings() });
});

// Admin: upgrade moderator tier manually
app.post('/api/admin/moderator/tier', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, tier } = req.body;
  if (!userId || !['none','black','blue','silver','gold','platinum'].includes(tier)) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }
  await db.updateModeratorTier(userId, tier);
  res.json({ message: '🏅 تم تحديث توثيق المشرف إلى ' + tier });
});

// Award stars for visit completion (called in exitModeratorVisit flow)
// =============== MODERATOR VISITS ===============

// Moderator: request visit to diwaniya (with reason)
app.post('/api/moderator/visit/request', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (user.role !== 'moderator' && user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط المشرفون يمكنهم طلب الزيارة' });
  }
  const { familyId, reason } = req.body;
  if (!familyId || !reason) return res.status(400).json({ error: 'العائلة وسبب الزيارة مطلوبان' });
  const visit = await db.requestModeratorVisit(req.user.id, user.name, familyId, reason);
  // Notify the family diwaniya (if active)
  const active = await db.getActiveDiwaniya(familyId);
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
app.post('/api/moderator/visit/enter', authMiddleware, async (req, res) => {
  const { visitId } = req.body;
  const visit = await db.enterModeratorVisit(visitId);
  if (!visit) return res.status(400).json({ error: 'الزيارة غير موجودة' });
  // Save system message in the active diwaniya
  const active = await db.getActiveDiwaniya(visit.family_id);
  if (active) {
    try { await db.addDiwaniyaMessage(active.id, visit.moderator_id, '🕵️ دخل المشرف ' + (visit.moderator_name||'') + ' للزيارة التفقدية (مراقب - لا يشارك)'); } catch(e) {}
  }
  if (visit.family_id) {
    io.to(`family_${visit.family_id}`).emit('moderator_entered', { moderatorName: visit.moderator_name });
  }
  // SERVER-SIDE auto-exit after 2 minutes (enforced regardless of client)
  setTimeout(async () => {
    try {
      const current = await db.execQuery("SELECT * FROM moderator_visits WHERE id = $1", [visitId]);
      if (current.length) {
        const row = current[0];
        const status = row.status;
        if (status === 'entered') {
          await db.exitModeratorVisit(visitId, 'خروج تلقائي بعد انتهاء مدة الزيارة (دقيقتين)');
          const fam = await db.getFamily(visit.family_id);
          if (fam) {
            io.to(`family_${fam.id}`).emit('moderator_exited', { moderatorName: visit.moderator_name, auto: true });
          }
          console.log('⏱️ Auto-exited moderator visit ' + visitId);
        }
      }
    } catch(e) { console.log('Auto-exit error:', e.message); }
  }, 120000);
  res.json({ message: '🕵️ دخلت كمراقب تفقدي - لا يحق لك المشاركة', visit });
});

// Moderator: exit + send report
app.post('/api/moderator/visit/exit', authMiddleware, async (req, res) => {
  const { visitId, report } = req.body;
  const visit = await db.exitModeratorVisit(visitId, report);
  if (!visit) return res.status(400).json({ error: 'الزيارة غير موجودة' });
  // Save exit system message
  const active = await db.getActiveDiwaniya(visit.family_id);
  if (active) {
    try { await db.addDiwaniyaMessage(active.id, visit.moderator_id, '📋 أنهى المشرف ' + (visit.moderator_name||'') + ' الزيارة التفقدية'); } catch(e) {}
  }
  // Award stars for completed visit
  const starsPerVisit = parseInt(await db.getSetting('stars_per_visit', '10'));
  const profile = await db.addModeratorStars(visit.moderator_id, starsPerVisit);
  const tier = await db.getModeratorTier(profile.stars || 0);
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
app.get('/api/moderator/online-families', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  if (user.role !== 'moderator' && user.role !== 'admin') {
    return res.status(403).json({ error: 'فقط المشرفون' });
  }
  const families = await db.getFamiliesWithActiveDiwaniya();
  res.json({ families });
});

// Moderator: my visits
app.get('/api/moderator/visits', authMiddleware, async (req, res) => {
  res.json({ visits: await db.getModeratorVisitsByUser(req.user.id) });
});

// Admin: all moderator visits
app.get('/api/admin/moderator-visits', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ visits: await db.getModeratorVisits() });
});

// =============== AGREEMENTS ROUTES ===============

// Get my agreement status
app.get('/api/agreements/status', authMiddleware, async (req, res) => {
  const ag = await db.getAgreement(req.user.id);
  res.json({ agreement: ag, canOpenDiwaniya: await db.canOpenDiwaniya(req.user.id) });
});

// Accept agreement (permanent)
app.post('/api/agreements/accept', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  const role = user && user.can_open_diwaniya == 1 ? 'manager' : (req.user.role === 'founder' ? 'founder' : 'member');
  const ag = await db.acceptAgreement(req.user.id, req.user.familyId, role);
  if (ag.agreed == 0) return res.status(403).json({ error: 'لا يمكن تغيير قرار الرفض' });
  res.json({ message: '✅ تم تسجيل موافقتك على اتفاقية استخدام البرنامج', agreement: ag });
});

// Reject agreement (permanent - cannot open diwaniya ever)
app.post('/api/agreements/reject', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  const role = user && user.can_open_diwaniya == 1 ? 'manager' : (req.user.role === 'founder' ? 'founder' : 'member');
  const ag = await db.rejectAgreement(req.user.id, req.user.familyId, role);
  res.json({ message: 'تم تسجيل رفضك - لن تستطيع فتح الديوانية', agreement: ag });
});

// Get family agreements (founder)
app.get('/api/agreements/family', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.json({ agreements: [] });
  const agreements = await db.getFamilyAgreements(req.user.familyId);
  res.json({ agreements });
});

// Get all agreements (admin)
app.get('/api/admin/agreements', authMiddleware, adminMiddleware, async (req, res) => {
  const agreements = await db.getAllAgreements();
  const founders = agreements.filter(a => a.role_at_agreement === 'founder');
  const managers = agreements.filter(a => a.role_at_agreement === 'manager');
  const members = agreements.filter(a => a.role_at_agreement === 'member');
  res.json({ founders, managers, members, total: agreements.length });
});

// =============== MODERATION ROUTES ===============

// Banned words (admin)
app.get('/api/admin/banned-words', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ words: await db.getBannedWords() });
});
app.post('/api/admin/banned-words/add', authMiddleware, adminMiddleware, async (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ error: 'الكلمة مطلوبة' });
  await db.addBannedWord(word);
  res.json({ message: '🚫 تمت إضافة الكلمة للقائمة السوداء' });
});
app.post('/api/admin/banned-words/delete', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.body;
  await db.deleteBannedWord(id);
  res.json({ message: '✅ تم الحذف' });
});

// Ban/unban user (admin)
app.get('/api/admin/bans', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ bans: await db.getAllBans() });
});
app.post('/api/admin/bans/ban', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, reason, durationHours } = req.body;
  if (!userId || !reason || !durationHours) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const ban = await db.banUser(userId, reason, parseInt(durationHours), req.user.id);
  res.json({ message: '⛔ تم إيقاف العضوية', ban });
});
app.post('/api/admin/bans/unban', authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.body;
  await db.unbanUser(userId);
  res.json({ message: '✅ تم إلغاء الإيقاف' });
});

// Diwaniya managers (founder)
app.post('/api/family/diwaniya-manager', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط المؤسس' });
  const { userId, canOpen } = req.body;
  if (!userId) return res.status(400).json({ error: 'العضو مطلوب' });
  if (canOpen && await db.countDiwaniyaManagers(req.user.familyId) >= 2) {
    return res.status(400).json({ error: 'الحد الأقصى عضوان يمكنهم فتح الديوانية' });
  }
  await db.setDiwaniyaManager(userId, canOpen);
  res.json({ message: canOpen ? '✅ تم منح الصلاحية' : 'تم سحب الصلاحية' });
});

// =============== SECRET ROOM (PAID) ===============

// Get secret room status
app.get('/api/diwaniya/secret-room', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.json({ enabled: false, price: 100 });
  res.json(await db.getSecretRoomStatus(req.user.familyId));
});

// Purchase secret room (creates payment, admin confirms)
app.post('/api/diwaniya/secret-room/purchase', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط المؤسس' });
  const status = await db.getSecretRoomStatus(req.user.familyId);
  if (status.enabled) return res.json({ message: 'الغرفة المغلقة مفعلة بالفعل', enabled: true });
  // Create payment via gateway
  const user = await db.getUserById(req.user.id);
  const payment = await db.createPayment(req.user.id, user.name, 'stcpay', status.price, 'تفعيل الغرفة المغلقة', '');
  res.json({ requiresPayment: true, price: status.price, paymentId: payment.id, message: '📨 أرسل إثبات الدفع ثم تؤكد الإدارة التفعيل' });
});

// Admin: confirm payment activates secret room automatically
// (hook into confirmPayment - after confirming, if purpose is secret room, enable)

// =============== DIWANIYA CAPACITY ===============

// Get capacity info + packages
app.get('/api/diwaniya/capacity', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.json({ capacity: 15, packages: [] });
  const capacity = await db.getFamilyCapacity(req.user.familyId);
  res.json({ capacity, packages: await db.getCapacityPackages(), defaultMax: 15 });
});

// Purchase capacity package
app.post('/api/diwaniya/capacity/purchase', authMiddleware, async (req, res) => {
  const { capacity } = req.body;
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط المؤسس' });
  if (capacity !== 20 && capacity !== 40) return res.status(400).json({ error: 'الباقة غير متاحة' });
  const current = await db.getFamilyCapacity(req.user.familyId);
  if (capacity <= current) return res.status(400).json({ error: 'سعتك الحالية ' + current + ' أكبر أو تساوي هذه الباقة' });
  const newCap = await db.purchaseCapacity(req.user.familyId, capacity);
  res.json({ message: '✅ تم شراء توسعة الديوانية إلى ' + newCap + ' عضو', capacity: newCap });
});

// Set diwaniya capacity for a session (founder picks number)
app.post('/api/diwaniya/capacity/set', authMiddleware, async (req, res) => {
  const { capacity } = req.body;
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  if (req.user.role !== 'founder') return res.status(403).json({ error: 'فقط المؤسس' });
  const result = await db.setDiwaniyaCapacity(req.user.familyId, parseInt(capacity));
  if (result.error) return res.status(400).json(result);
  res.json({ message: '✅ تم تحديد سعة الديوانية: ' + capacity, capacity });
});

// =============== AUCTIONS ROUTES ===============

// Get active auctions (public - visitors can view, login to bid)
app.get('/api/auctions/active', async (req, res) => {
  const auctions = await db.getActiveAuctions();
  res.json({ auctions });
});

// Get auction details with bids
app.get('/api/auctions/:id', authMiddleware, async (req, res) => {
  const auction = await db.getAuctionById(req.params.id);
  if (!auction) return res.status(404).json({ error: 'المزاد غير موجود' });
  const bids = await db.getAuctionBids(req.params.id);
  const participated = !!await db.isAuctionParticipant(req.params.id, req.user.id);
  res.json({ auction, bids, participated });
});

// Join auction (pay entry fee - simulated)
app.post('/api/auctions/join', authMiddleware, async (req, res) => {
  const { auctionId } = req.body;
  if (!auctionId) return res.status(400).json({ error: 'معرف المزاد مطلوب' });
  const result = await db.joinAuction(auctionId, req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ message: '✅ تم الدخول للمزاد (رسوم الدخول: ' + result.entry_fee + ' ريال)', joined: true });
});

// Place bid
app.post('/api/auctions/bid', authMiddleware, async (req, res) => {
  const { auctionId, amount } = req.body;
  if (!auctionId || !amount) return res.status(400).json({ error: 'المزاد والمبلغ مطلوبان' });
  const result = await db.placeBid(auctionId, req.user.id, parseInt(amount));
  if (result.error) return res.status(400).json(result);
  res.json({ message: '✅ تمت المزايدة: ' + amount + ' ريال', auction: result });
});

// Admin: create auction
app.post('/api/admin/auctions/create', authMiddleware, adminMiddleware, async (req, res) => {
  const { code, startingPrice, entryFee, durationMinutes, minIncrement } = req.body;
  if (!code || !startingPrice || !entryFee || !durationMinutes) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  const auction = await db.createAuction(code, parseInt(startingPrice), parseInt(entryFee), parseInt(durationMinutes), parseInt(minIncrement || 10), req.user.id);
  if (auction?.error) return res.status(400).json(auction);
  res.json({ message: '🏷️ تم فتح المزاد', auction });
});

// Get available codes for auction (admin)
app.get('/api/admin/auctions/available-codes', authMiddleware, adminMiddleware, async (req, res) => {
  const codes = await db.getAvailableAuctionCodes();
  res.json({ codes });
});

// Admin: all auctions
app.get('/api/admin/auctions', authMiddleware, adminMiddleware, async (req, res) => {
  const auctions = await db.getAllAuctions();
  res.json({ auctions });
});

// Admin: end auction
app.post('/api/admin/auctions/end', authMiddleware, adminMiddleware, async (req, res) => {
  const { auctionId } = req.body;
  const auction = await db.endAuction(auctionId);
  if (!auction) return res.status(400).json({ error: 'المزاد غير متاح' });
  res.json({ message: '🏁 تم إنهاء المزاد', auction });
});

// Admin: confirm payment
app.post('/api/admin/auctions/confirm-payment', authMiddleware, adminMiddleware, async (req, res) => {
  const { auctionId } = req.body;
  const auction = await db.confirmAuctionPayment(auctionId);
  if (!auction) return res.status(400).json({ error: 'المزاد غير موجود' });
  res.json({ message: '💰 تم تأكيد السداد، وحصل الفائز على الرمز', auction });
});

// Admin: cancel auction
app.post('/api/admin/auctions/cancel', authMiddleware, adminMiddleware, async (req, res) => {
  const { auctionId } = req.body;
  const auction = await db.cancelAuction(auctionId);
  if (!auction) return res.status(400).json({ error: 'المزاد غير موجود' });
  res.json({ message: '❌ تم إلغاء المزاد', auction });
});

// =============== CURRENCY ===============

// Get currency rate + user preference
app.get('/api/currency', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  res.json({ currency: user ? user.currency || 'sar' : 'sar', rate: await db.getCurrencyRate() });
});

// Admin: set currency rate
app.post('/api/admin/currency/rate', authMiddleware, adminMiddleware, async (req, res) => {
  const { rate } = req.body;
  if (!rate) return res.status(400).json({ error: 'السعر مطلوب' });
  await db.setCurrencyRate(parseFloat(rate));
  res.json({ message: '✅ تم تحديث سعر الصرف', rate });
});

// =============== PACKAGES MANAGEMENT ===============

// Public: get active packages for home page
app.get('/api/packages', async (req, res) => {
  const packages = await db.getActivePackages();
  res.json({ packages });
});

// Admin: all packages
app.get('/api/admin/packages', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ packages: await db.getAllPackages() });
});

// Admin: add package
app.post('/api/admin/packages/add', authMiddleware, adminMiddleware, async (req, res) => {
  const { title, code_example, price, features } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان الباقة مطلوب' });
  const pkg = await db.addPackage(title, code_example, price, features);
  res.json({ message: '✅ تمت إضافة الباقة', package: pkg });
});

// Admin: update package
app.post('/api/admin/packages/update', authMiddleware, adminMiddleware, async (req, res) => {
  const { id, title, code_example, price, features, status } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الباقة مطلوب' });
  const pkg = await db.updatePackage(id, { title, code_example, price, features, status });
  res.json({ message: '✅ تم تحديث الباقة', package: pkg });
});

// Admin: delete package
app.post('/api/admin/packages/delete', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.body;
  await db.deletePackage(id);
  res.json({ message: '🗑️ تم حذف الباقة' });
});

// =============== PAYMENT GATEWAYS ===============

// Get payment settings (public - shows what's enabled)
app.get('/api/payment/settings', async (req, res) => {
  const settings = await db.getPaymentSettings();
  res.json({ settings });
});

// Admin: save payment settings (toggle + numbers + details)
app.post('/api/admin/payment/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const settings = await db.savePaymentSettings(req.body);
  res.json({ message: '✅ تم حفظ إعدادات الدفع', settings });
});

// User: submit payment confirmation
app.post('/api/payments/confirm', authMiddleware, async (req, res) => {
  const { gateway, amount, purpose, reference } = req.body;
  if (!gateway || !amount) return res.status(400).json({ error: 'البيانات ناقصة' });
  const user = await db.getUserById(req.user.id);
  const payment = await db.createPayment(req.user.id, user.name, gateway, parseInt(amount), purpose || '', reference || '');
  res.json({ message: '📨 تم إرسال إثبات الدفع — بانتظار تأكيد الإدارة', payment });
});

// User: my payments
app.get('/api/payments/my', authMiddleware, async (req, res) => {
  res.json({ payments: await db.getMyPayments(req.user.id) });
});

// Admin: all payments
app.get('/api/admin/payments', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ payments: await db.getAllPayments() });
});

// Admin: confirm payment
app.post('/api/admin/payments/confirm', authMiddleware, adminMiddleware, async (req, res) => {
  const { paymentId } = req.body;
  const payment = await db.confirmPayment(paymentId);
  // If payment purpose is secret room, activate it for the family
  if (payment && payment.purpose === 'تفعيل الغرفة المغلقة') {
    const user = await db.getUserById(payment.user_id);
    if (user && user.family_id) {
      await db.enableSecretRoom(user.family_id);
    }
  }
  res.json({ message: '✅ تم تأكيد الدفع', payment });
});

// Admin: reject payment
app.post('/api/admin/payments/reject', authMiddleware, adminMiddleware, async (req, res) => {
  const { paymentId } = req.body;
  const payment = await db.rejectPayment(paymentId);
  res.json({ message: '❌ تم رفض الدفع', payment });
});

// =============== FAMILY ROUTES ===============

// Get family info
app.get('/api/family', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const family = await db.getFamily(req.user.familyId);
  const members = await db.getFamilyMembers(req.user.familyId);
  const invitations = await db.getInvitationsByFamily(req.user.familyId);
  const founder = await db.getUserById(family.founder_id);
  res.json({ family, members, invitations, founder });
});

// Send invitations
app.post('/api/family/invite', authMiddleware, async (req, res) => {
  if (req.user.role !== 'founder') {
    return res.status(403).json({ error: 'فقط مؤسس العائلة يمكنه إرسال الدعوات' });
  }
  
  const { emails } = req.body; // array of emails
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'يرجى إرسال قائمة بالإيميلات' });
  }

  const results = [];
  for (const email of emails) {
    const inv = await db.createInvitation(req.user.familyId, email.trim(), req.user.id);
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
app.get('/api/family/invitations', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const invitations = await db.getInvitationsByFamily(req.user.familyId);
  res.json({ invitations });
});

// =============== DIWANIYA ROUTES ===============

// Open diwaniya
app.post('/api/diwaniya/open', authMiddleware, async (req, res) => {
  const userFull = await db.getUserById(req.user.id);
  const isFounder = req.user.role === 'founder';
  const isManager = userFull && userFull.can_open_diwaniya == 1;
  if (!isFounder && !isManager) {
    return res.status(403).json({ error: 'فقط المؤسس أو من منحه الصلاحية يمكنه فتح الديوانية' });
  }
  
  // Check agreement - rejected users can NEVER open diwaniya
  const ag = await db.getAgreement(req.user.id);
  if (ag && ag.agreed == 0) {
    return res.status(403).json({ error: '❌ لم توافق على اتفاقية استخدام البرنامج، لا يمكنك فتح الديوانية أبداً' });
  }
  
  // Check diwaniya lockdown
  if (req.user.familyId) {
    const lock = await db.getDiwaniyaLock(req.user.familyId);
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
  
  const { durationMinutes, topic, mode, secretCode } = req.body;
  const duration = durationMinutes || 30;
  const diwaniyaMode = mode || 'text';
  
  if (duration < 15 || duration > 60) {
    return res.status(400).json({ error: 'المدة يجب أن تكون بين 15 و 60 دقيقة' });
  }
  
  if (!['text', 'audio', 'video', 'both', 'all'].includes(diwaniyaMode)) {
    return res.status(400).json({ error: 'نوع الديوانية غير صالح' });
  }

  const result = await db.openDiwaniya(req.user.familyId, req.user.id, duration, topic || '', diwaniyaMode);
  if (result.error) {
    return res.status(400).json(result);
  }
  
  // Notify family members via socket
  io.to(`family_${req.user.familyId}`).emit('diwaniya_opened', result);
  
  res.json(result);
});

// Close diwaniya
app.post('/api/diwaniya/close/:sessionId', authMiddleware, async (req, res) => {
  const userFull = await db.getUserById(req.user.id);
  const isFounder = req.user.role === 'founder';
  const isManager = userFull && userFull.can_open_diwaniya == 1;
  if (!isFounder && !isManager) {
    return res.status(403).json({ error: 'فقط المؤسس أو من منحه الصلاحية يمكنه إغلاق الديوانية' });
  }
  
  const result = await db.closeDiwaniya(req.params.sessionId, req.user.id);
  if (!result) return res.status(404).json({ error: 'الديوانية غير موجودة أو مغلقة' });
  
  io.to(`family_${req.user.familyId}`).emit('diwaniya_closed', result);
  res.json(result);
});

// Record screen-recording attempt + announce + auto-ban
app.post('/api/diwaniya/recording-attempt', authMiddleware, async (req, res) => {
  const user = await db.getUserById(req.user.id);
  const result = await db.recordRecordingAttempt(req.user.id);
  const attemptLabel = ['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة','الثامنة','التاسعة','العاشرة'][result.attempts - 1] || 'المرة ' + result.attempts;
  
  // Announce to family (founder + members) - shows on camera too
  if (user && user.family_id) {
    io.to(`family_${user.family_id}`).emit('recording_attempt_announce', {
      userName: user.name,
      attempts: result.attempts,
      attemptLabel: attemptLabel,
      banned: result.banned,
      durationHours: result.durationHours,
      reason: result.reason
    });
  }
  
  res.json({ ...result, attemptLabel });
});

// Set video limit (founder, after opening)
app.post('/api/diwaniya/video-limit', authMiddleware, async (req, res) => {
  const { sessionId, limit } = req.body;
  if (!sessionId || !limit || limit < 1 || limit > 6) return res.status(400).json({ error: 'الحد من 1 إلى 6 كاميرات' });
  const user = await db.getUserById(req.user.id);
  const isFounder = req.user.role === 'founder';
  const isManager = user && user.can_open_diwaniya == 1;
  if (!isFounder && !isManager) return res.status(403).json({ error: 'فقط المؤسس أو المخول' });
  const session = await db.setVideoLimit(sessionId, parseInt(limit));
  io.to(`session_${sessionId}`).emit('video_limit_updated', { videoLimit: parseInt(limit) });
  res.json({ message: '✅ عدد الكاميرات: ' + limit, session });
});

// Verify diwaniya secret code
app.post('/api/diwaniya/verify-code', authMiddleware, async (req, res) => {
  const { sessionId, code } = req.body;
  if (!sessionId || !code) return res.status(400).json({ error: 'رقم الجلسة والرمز مطلوبان' });
  const result = await db.verifyDiwaniyaCode(sessionId, code);
  if (result.error) return res.status(403).json(result);
  res.json({ ok: true });
});

// Get active diwaniya + lockdown status
app.get('/api/diwaniya/active', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const session = await db.getActiveDiwaniya(req.user.familyId);
  const lock = await db.getDiwaniyaLock(req.user.familyId);
  res.json({ session, lock });
});

// Get diwaniya history
app.get('/api/diwaniya/history', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const history = await db.getDiwaniyaHistory(req.user.familyId);
  res.json({ history });
});

// Get diwaniya messages
app.get('/api/diwaniya/messages/:sessionId', authMiddleware, async (req, res) => {
  const messages = await db.getDiwaniyaMessages(req.params.sessionId);
  res.json({ messages });
});

// Send message to diwaniya (REST fallback)
app.post('/api/diwaniya/message', authMiddleware, async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'الرسالة مطلوبة' });
  
  // Moderator is observer only - cannot post
  const msgUser = await db.getUserById(req.user.id);
  if (msgUser && msgUser.role === 'moderator') {
    return res.status(403).json({ error: '🕵️ المشرف مراقب فقط ولا يحق له المشاركة' });
  }
  
  // Check banned words
  const banned = await db.checkBannedWord(message);
  if (banned) {
    return res.status(400).json({ error: '🚫 تحتوي الرسالة على كلمة ممنوعة، تم حجبها', bannedWord: banned });
  }
  
  const result = await db.addDiwaniyaMessage(sessionId, req.user.id, message);
  io.to(`session_${sessionId}`).emit('diwaniya_message', result);
  res.json(result);
});

// =============== CHALLENGES & GAMES ROUTES ===============

// Create challenge
app.post('/api/challenges/create', authMiddleware, async (req, res) => {
  const { gameType, opponentId, points } = req.body;
  if (!gameType || !opponentId) return res.status(400).json({ error: 'نوع اللعبة والمعارض مطلوب' });
  
  const challenge = await db.createChallenge(req.user.familyId, gameType, req.user.id, opponentId, points || 10);
  
  // Notify opponent via socket
  io.to(`user_${opponentId}`).emit('new_challenge', challenge);
  io.to(`family_${req.user.familyId}`).emit('challenge_created', challenge);
  
  res.json(challenge);
});

// Respond to challenge
app.post('/api/challenges/respond/:challengeId', authMiddleware, async (req, res) => {
  const { accept } = req.body; // true/false
  const challenge = await db.respondToChallenge(req.params.challengeId, req.user.id, accept);
  if (!challenge) return res.status(404).json({ error: 'التحدي غير موجود' });
  
  io.to(`family_${req.user.familyId}`).emit('challenge_responded', challenge);
  res.json(challenge);
});

// Complete challenge
app.post('/api/challenges/complete/:challengeId', authMiddleware, async (req, res) => {
  const { winnerId, challengerScore, opponentScore } = req.body;
  const challenge = await db.completeChallenge(req.params.challengeId, winnerId, challengerScore, opponentScore);
  if (!challenge) return res.status(404).json({ error: 'التحدي غير موجود' });
  
  io.to(`family_${req.user.familyId}`).emit('challenge_completed', challenge);
  // Update leaderboard
  io.to(`family_${req.user.familyId}`).emit('leaderboard_update', await db.getFamilyLeaderboard(req.user.familyId));
  
  res.json(challenge);
});

// Get family challenges
app.get('/api/challenges', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const challenges = await db.getFamilyChallenges(req.user.familyId);
  const pending = await db.getPendingChallenges(req.user.id);
  res.json({ challenges, pending });
});

// =============== LEADERBOARD ===============

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const leaderboard = await db.getFamilyLeaderboard(req.user.familyId);
  res.json({ leaderboard });
});

// =============== VALIDATE SUBSCRIPTION CODE ===============

app.post('/api/validate-code', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'الرمز مطلوب' });
  const valid = await db.validateSubscriptionCode(code);
  res.json({ valid: !!valid });
});

// =============== SOCKET.IO ===============

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_family', async (familyId) => {
    socket.join(`family_${familyId}`);
    console.log(`Socket ${socket.id} joined family ${familyId}`);
  });

  socket.on('join_user', async (userId) => {
    socket.userId = userId;
    socket.join(`user_${userId}`);
    onlineUsers.add(userId);
    console.log(`🟢 ${userId} online`);
    // Notify family members that this user is online
    const user = await db.getUserById(userId);
    if (user && user.family_id) {
      io.to(`family_${user.family_id}`).emit('user_online', { userId, name: user.name });
    }
  });

  socket.on('join_session', async (sessionId) => {
    socket.join(`session_${sessionId}`);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('diwaniya_message', async (data) => {
    const { sessionId, userId, message } = data;
    // Moderator is observer only
    const sender = await db.getUserById(userId);
    if (sender && sender.role === 'moderator') {
      io.to(`user_${userId}`).emit('message_blocked', { message: '🕵️ المشرف مراقب فقط ولا يحق له المشاركة' });
      return;
    }
    // Check banned words - block and warn the writer
    const banned = await db.checkBannedWord(message);
    if (banned) {
      io.to(`user_${userId}`).emit('message_blocked', {
        message: '🚫 رسالتك تحتوي على كلمة ممنوعة ولم تُرسل',
        bannedWord: banned
      });
      return;
    }
    const result = await db.addDiwaniyaMessage(sessionId, userId, message);
    if (result) {
      io.to(`session_${sessionId}`).emit('diwaniya_message', result);
      const user = await db.getUserById(userId);
      if (user?.family_id) {
        io.to(`family_${user.family_id}`).emit('diwaniya_activity', {
          sessionId, userName: result.user_name, preview: message.substring(0, 50)
        });
      }
    }
  });

  socket.on('diwaniya_audio', async (data) => {
    const { sessionId, userId, message, audio, audioType } = data;
    const result = await db.addDiwaniyaMessage(sessionId, userId, message);
    if (result) {
      // Broadcast audio to all in session
      io.to(`session_${sessionId}`).emit('diwaniya_audio', {
        user_name: result.user_name, audio, audioType, user_id: userId
      });
    }
  });

  socket.on('game_move', async (data) => {
    const { challengeId, gameType, move } = data;
    // Forward game moves to the other player
    socket.to(`game_${challengeId}`).emit('game_move', move);
  });

  socket.on('join_game', async (challengeId) => {
    socket.join(`game_${challengeId}`);
  });

  socket.on('disconnect', async () => {
    console.log('Socket disconnected:', socket.id);
    // Remove user from online if they had joined
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      const user = await db.getUserById(socket.userId);
      if (user && user.family_id) {
        io.to(`family_${user.family_id}`).emit('user_offline', { userId: socket.userId });
      }
      console.log(`🔴 ${socket.userId} offline`);
    }
  });

  // Family notification (invite all members)
  socket.on('family_notify', async (data) => {
    const { familyId, message, title } = data;
    io.to(`family_${familyId}`).emit('family_notification', { title: title || '🔔 تنبيه العائلة', message, time: Date.now() });
    console.log(`🔔 Notification sent to family ${familyId}`);
  });

  // WebRTC Audio Call Signaling
  const audioRooms = {};
  
  socket.on('join_audio_call', async (data) => {
    const { sessionId, userId, userName, isObserver } = data;
    socket.join(`audio_${sessionId}`);
    
    if (!audioRooms[sessionId]) audioRooms[sessionId] = [];
    const participants = audioRooms[sessionId];
    
    // Observers (moderators) don't count toward the capacity limit
    const familyId = await db.getActiveDiwaniya(sessionId)?.family_id;
    const maxCap = familyId ? await db.getFamilyCapacity(familyId) : 15;
    const activeCount = participants.filter(p => !p.isObserver).length;
    if (!isObserver && activeCount >= maxCap) {
      socket.emit('call_full', { message: 'المكالمة ممتلئة - الحد الأقصى للعائلة ' + maxCap + ' عضو' });
      socket.leave(`audio_${sessionId}`);
      return;
    }
    
    // Tell existing participants about new user (observers included so they receive audio)
    participants.forEach(p => {
      io.to(p.socketId).emit('user_joined_call', { userId, userName, isObserver: !!isObserver });
    });
    
    participants.push({ socketId: socket.id, userId, userName, isObserver: !!isObserver });
    
    // Send current participants to the new user
    socket.emit('call_participants', { 
      participants: participants.filter(p => p.socketId !== socket.id)
    });
    
    console.log(`${isObserver ? '🕵️ Observer' : '🎤'} ${userName} joined audio call ${sessionId} (${participants.length})`);
  });
  
  socket.on('leave_audio_call', async (data) => {
    const { sessionId, userId } = data;
    socket.leave(`audio_${sessionId}`);
    
    if (audioRooms[sessionId]) {
      audioRooms[sessionId] = audioRooms[sessionId].filter(p => p.socketId !== socket.id);
      if (audioRooms[sessionId].length === 0) delete audioRooms[sessionId];
    }
    
    socket.to(`audio_${sessionId}`).emit('user_left_call', { userId });
    console.log(`🎤 User left audio call ${sessionId}`);
  });
  
  socket.on('audio_offer', async (data) => {
    const { to, offer, sessionId, userName } = data;
    io.to(to).emit('audio_offer', { from: socket.id, offer, userName, sessionId });
  });
  
  socket.on('audio_answer', async (data) => {
    const { to, answer, sessionId } = data;
    io.to(to).emit('audio_answer', { from: socket.id, answer, sessionId });
  });
  
  socket.on('audio_ice_candidate', async (data) => {
    const { to, candidate, sessionId } = data;
    io.to(to).emit('audio_ice_candidate', { from: socket.id, candidate, sessionId });
  });
});

// =============== SEED DATA ===============


// =============== PROCESS ERROR HANDLERS (prevent crash) ===============
process.on('unhandledRejection', (reason) => {
  console.log('⚠️ Unhandled rejection:', reason && reason.message || reason);
});
process.on('uncaughtException', (err) => {
  console.log('⚠️ Uncaught exception:', err.message);
});

// Async route wrapper (Express 4 doesn't catch async errors)
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// =============== GLOBAL ERROR HANDLER ===============
app.use((err, req, res, next) => {
  console.log('❌ Route error:', err.message, err.code || '');
  res.status(500).json({ error: err.message || 'خطأ داخلي', code: err.code || '' });
});

// =============== START SERVER ===============

async function bootstrap() {
  console.log('🔌 DATABASE_URL set:', process.env.DATABASE_URL ? 'YES (length ' + process.env.DATABASE_URL.length + ')' : 'NO ❌');
  try {
    await db.initDb();
    console.log('✅ Database ready (PostgreSQL)');
  } catch(e) { console.log('DB init error:', e.message, e.code || ''); }
  
  // Seed subscription codes if empty
  try {
    const codes = await db.execQuery('SELECT COUNT(*) c FROM subscription_codes');
    if (!codes.length || codes[0].c === 0) {
      const newCodes = await db.generateSubscriptionCodes(5);
      console.log('📋 رموز الاشتراك المتاحة: ' + newCodes.join(', '));
    }
  } catch(e) {}
  
  // Seed default packages
  try {
    const pkgs = await db.execQuery('SELECT COUNT(*) c FROM packages');
    if (!pkgs.length || pkgs[0].c === 0) {
      await db.addPackage('🎁 مجاني', '0X7K9M2F', 0, JSON.stringify(['رمز عشوائي 8 أحرف', 'تأسيس عائلة واحدة']));
      await db.addPackage('👑 مخصص', 'FAMILY88', 500, JSON.stringify(['رمز مخصص من اختيارك', 'رمز فريد لعائلتك']));
      await db.addPackage('👥 زيادة الأعضاء', '20 عضو', 50, JSON.stringify(['توسعة الديوانية إلى 20 عضو', 'من 15 إلى 20']));
      await db.addPackage('👥 زيادة الأعضاء', '40 عضو', 100, JSON.stringify(['توسعة الديوانية إلى 40 عضو', 'من 15 إلى 40']));
      console.log('✅ Seeded default packages');
    }
  } catch(e) { console.log('Packages seed error:', e.message); }
  
  // Create default admin account
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@familylive.com';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123456';
    const existingAdmin = await db.getUserByEmail(adminEmail);
    if (!existingAdmin) {
      const hashedPass = bcrypt.hashSync(adminPass, 10);
      await db.createAdminUser(adminEmail, hashedPass);
      console.log('✅ Created admin account: ' + adminEmail);
    }
  } catch(e) { console.log('Admin seed error:', e.message); }
  
  // Create default moderator account
  try {
    const modEmail = 'abdmmm9@gmail.com';
    const modPass = 'Koad@055282312';
    const hashedMod = bcrypt.hashSync(modPass, 10);
    await db.createUserByRole(modEmail, hashedMod, 'مشرف الديوانيات', 'moderator');
    console.log('✅ Created moderator account: ' + modEmail);
  } catch(e) { console.log('Moderator seed error:', e.message); }
  
  // Seed default support messages
  try {
    if (await db.countSupportMessages() === 0) {
      await db.addSupportMessage('تحية مراقب الديوانيات', 'السلام عليكم ورحمة الله وبركاته، أنا مراقب الديوانيات جئت للسماع منكم عن مشاكل التطبيق ومقترحاتكم.');
      await db.addSupportMessage('التواصل مع الدعم الفني', 'تنبيه: عند وجود مقترحات أو شكاوى أو مشاكل فنية بالحساب، يرجى مراسلة الإدارة عبر برنامج الدعم الفني فقط.');
      console.log('✅ Seeded default support messages');
    }
  } catch(e) { console.log('Support seed error:', e.message); }
  
  // Create default user and family if not exists
  try {
    const existing = await db.getUserByEmail('abdm@live.com');
    if (!existing) {
      await db.generatePremiumCode();
      await db.generatePremiumCode();
      const code = (await db.getFirstAvailablePremiumCode()) || 'AAAAAAAA';
      const hashedPassword = bcrypt.hashSync('Koad@055282312', 10);
      const family = await db.createFamily('عائلتي', code);
      if (family) {
        const user = await db.createUser('عبدالله', 'abdm@live.com', hashedPassword, family.id, 'founder');
        await db.updateFamilyFounder(family.id, user.id);
        console.log('✅ Created default user and family');
      }
    }
  } catch(e) { console.log('Seed error:', e.message); }
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌙 تطبيق العائلة يعمل على المنفذ ${PORT}`);
    console.log(`📱 افتح المتصفح: http://localhost:${PORT}`);
  });
}

bootstrap();
