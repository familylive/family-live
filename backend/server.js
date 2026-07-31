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
app.use(express.json());

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
app.get('/api/admin/ads', authMiddleware, adminMiddleware, (req, res) => {
  const ads = db.getAllAds();
  res.json({ ads });
});

// Admin: add ad
app.post('/api/admin/ads/add', authMiddleware, adminMiddleware, (req, res) => {
  const { title, image_url, link_url, position } = req.body;
  if (!title) return res.status(400).json({ error: 'عنوان الإعلان مطلوب' });
  const ad = db.addAd(title, image_url || '', link_url || '', position || 'banner');
  res.json({ message: '✅ تم إضافة الإعلان', ad });
});

// Admin: update ad
app.post('/api/admin/ads/update', authMiddleware, adminMiddleware, (req, res) => {
  const { id, title, image_url, link_url, status } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الإعلان مطلوب' });
  const ad = db.updateAd(id, title, image_url || '', link_url || '', status || 'active');
  res.json({ message: '✅ تم تحديث الإعلان', ad });
});

// Admin: delete ad
app.post('/api/admin/ads/delete', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'معرف الإعلان مطلوب' });
  db.deleteAd(id);
  res.json({ message: '🗑️ تم حذف الإعلان' });
});

// =============== PROFILE ROUTES ===============

// Update profile
app.post('/api/profile/update', authMiddleware, (req, res) => {
  const { name, country, city, phone, avatar } = req.body;
  const user = db.updateProfile(req.user.id, { name, country, city, phone, avatar });
  res.json({ message: '✅ تم تحديث الملف الشخصي', user });
});

// Leave family
app.post('/api/profile/leave-family', authMiddleware, (req, res) => {
  const result = db.leaveFamily(req.user.id);
  if (result.error) return res.status(400).json(result);
  res.json({ message: 'تم الخروج من عائلة ' + result.family_name, success: true });
});

// =============== AUCTIONS ROUTES ===============

// Get active auctions (logged in users)
app.get('/api/auctions/active', authMiddleware, (req, res) => {
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
  res.json({ family, members, invitations });
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
  if (req.user.role !== 'founder') {
    return res.status(403).json({ error: 'فقط مؤسس العائلة يمكنه فتح الديوانية' });
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

// Get active diwaniya
app.get('/api/diwaniya/active', authMiddleware, (req, res) => {
  if (!req.user.familyId) return res.status(400).json({ error: 'لا يوجد عائلة' });
  const session = db.getActiveDiwaniya(req.user.familyId);
  res.json({ session });
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
  
  const result = db.addDiwaniyaMessage(sessionId, req.user.id, message);
  // Socket will also handle this, but this is for REST clients
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
    socket.join(`user_${userId}`);
    console.log(`Socket ${socket.id} joined user ${userId}`);
  });

  socket.on('join_session', (sessionId) => {
    socket.join(`session_${sessionId}`);
    console.log(`Socket ${socket.id} joined session ${sessionId}`);
  });

  socket.on('diwaniya_message', (data) => {
    const { sessionId, userId, message } = data;
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
  
  // Create default user if not exists
  try {
    const existing = db.getUserByEmail('abdrit9@gmail.com');
    if (!existing) {
      // Generate premium codes
      db.generatePremiumCode();
      db.generatePremiumCode();
      // Get the first available code
      const code = db.getFirstAvailablePremiumCode() || 'AAAAAAAA';
      const hashedPassword = bcrypt.hashSync('123456', 10);
      const family = db.createFamily('عائلتي', code);
      if (family) {
        const user = db.createUser('عبدالله', 'abdrit9@gmail.com', hashedPassword, family.id, 'founder');
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
