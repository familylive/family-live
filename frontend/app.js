// ==================== API CONFIG ====================
const API_BASE = window.location.origin;
let socket = null;

// ==================== تشخيص مرئي للأخطاء التقنية ====================
// أي خطأ غير متوقع يظهر في شريط أحمر أعلى الشاشة (يساعدنا نعرف سبب المشاكل)
window.addEventListener('error', function (e) {
  try {
    let banner = document.getElementById('tech-err-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'tech-err-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;font-size:12px;padding:6px 10px;font-family:sans-serif;direction:rtl;';
      document.body.appendChild(banner);
    }
    const src = e.filename ? e.filename.split('/').pop() : '';
    banner.textContent = '⚠️ خطأ تقني: ' + (e.message || 'خطأ') + (src ? ' — ' + src + ':' + e.lineno : '');
    clearTimeout(banner._t);
    banner._t = setTimeout(() => { banner.style.display = 'none'; }, 12000);
    sendDiag('error:' + (e.message || ''), { file: src, line: e.lineno });
  } catch (err) {}
});

// إرسال تقرير تشخيصي للسيرفر (يساعد في حل مشاكل الفيديو/الشاشة من جهاز المستخدم)
function sendDiag(msg, extra) {
  try {
    fetch(API_BASE + '/api/diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg, ua: navigator.userAgent, data: extra || {} })
    }).catch(() => {});
  } catch (e) {}
}

async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  const token = localStorage.getItem('token');
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
  opts.signal = controller.signal;
  
  try {
    const res = await fetch(`${API_BASE}${path}`, opts);
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) {
      // رصيد غير كافٍ → تنبيه شحن الرصيد (مرة واحدة)
      if (data.error && /رصيدك لا يكفي|رصيد الكوينزات لا يكفي|رصيدك انتهى/.test(data.error)) {
        offerRecharge(data.error);
      }
      throw new Error(data.error || 'خطأ في الاتصال');
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('انتهت مهلة الاتصال، تحقق من اتصالك');
    if (err.message === 'Failed to fetch') throw new Error('تعذر الاتصال بالخادم، حاول مرة أخرى');
    throw err;
  }
}

// ==================== INIT ====================
// تحديث بيانات المستخدم من الخادم (المستوى/الرصيد/الصورة) — يبقيها حية
async function refreshUserProfile() {
  try {
    const { user } = await api('GET', '/api/auth/verify');
    if (user) {
      state.user = { ...(state.user || {}), ...user };
      if (typeof updateTikTokLiveInfo === 'function') updateTikTokLiveInfo();
    }
  } catch(e) {}
}

// تنبيه انتهاء الرصيد: يظهر مرة واحدة ويدعو لصفحة الشحن
let _rechargePromptLock = false;
function offerRecharge(detail) {
  if (_rechargePromptLock) return;
  _rechargePromptLock = true;
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.onclick = (e) => { if (e.target === ov) { ov.remove(); _rechargePromptLock = false; } };
  ov.innerHTML =
    '<div class="modal-box" style="max-width:320px;text-align:center;border:1.5px solid rgba(255,80,80,.5)">' +
      '<div style="font-size:44px;margin-bottom:6px">⚠️</div>' +
      '<h3 style="color:var(--danger);margin-bottom:8px">رصيدك انتهى!</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">' + (detail || 'لا تملك كونزات كافية لهذه العملية') + '</p>' +
      '<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">اشحن كونزات بالريال (STC Pay / تحويل بنكي)</p>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-accent" style="flex:1" onclick="goToRecharge(this)">💳 شحن الرصيد</button>' +
        '<button class="btn btn-secondary" style="flex:1" onclick="this.closest(\'.modal-overlay\').remove();_rechargePromptLock=false">إلغاء</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
}
// زر الشحن: يغلق النافذة وينتقل لصفحة المحفظة (الشحن)
function goToRecharge(btn) {
  const ov = btn.closest('.modal-overlay');
  if (ov) ov.remove();
  _rechargePromptLock = false;
  if (typeof navigateTo === 'function') navigateTo('wallet');
  showToast('💳 اختر الباقة أو حدد المبلغ لشحن الكونزات', 'success');
}

// Tab-conflict guard: if another tab changes the session, reload (prevent token fighting)
window.addEventListener('storage', (e) => {
  if (e.key === 'token') {
    const cur = localStorage.getItem('token') || '';
    if (e.newValue !== cur && e.newValue !== null) {
      setTimeout(() => location.reload(), 100);
    }
  }
});

(async function init() {
  // انتظار اكتمال الصفحة قبل لمس DOM (كان سبب الشاشة البيضاء للزوار)
  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }
  // Check for auto-login token in URL (query param or hash)
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  let token = params.get('token') || (hash.startsWith('#token=') ? hash.replace('#token=', '') : null);
  
  // Invitation link (/invite?token=XXX) - prefill the invite code, don't clear URL
  const isInvitePage = window.location.pathname === '/invite' || window.location.pathname.startsWith('/invite');
  if (token && isInvitePage) {
    window.__inviteToken = token;
    // After splash: show the join-family form with the invite code prefilled
    setTimeout(() => {
      try {
        if (typeof switchRegTab === 'function') switchRegTab('join');
        if (typeof navigateTo === 'function') navigateTo('register');
      } catch(e) {}
      const invInput = document.getElementById('reg-invite-token');
      if (invInput) invInput.value = token;
      showToast('🔗 تم تجهيز الدعوة - أكمل التسجيل للانضمام للعائلة', 'success');
    }, 800);
  } else if (token && !isInvitePage) {
    localStorage.setItem('token', token);
    // Clean URL after saving token
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    try {
      const { user, family } = await api('GET', '/api/auth/verify');
      await loadApp(user, family);
      return;
    } catch(e) { localStorage.removeItem('token'); }
  }
  
  // فتح التطبيق فوراً (بدون انتظار ثابت) - سرعة فائقة
  function revealApp() {
    const splash = document.getElementById('splash-screen');
    document.getElementById('app').classList.add('visible');
    if (splash) splash.classList.add('hide');
    setTimeout(() => { if (splash) splash.style.display = 'none'; }, 600);
  }
  const savedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (savedToken) {
    try {
      const { user, family } = await api('GET', '/api/auth/verify');
      revealApp();
      await loadApp(user, family);
    } catch(e) {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      revealApp();
      showAuth('landing');
      loadLandingPage();
    }
  } else {
    revealApp();
    showAuth('landing');
    loadLandingPage();
    updateMenuVisibility();
  }
})();

// ==================== AUTH ====================
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('remember-me')?.checked;
  if (!email || !password) return showToast('يرجى ملء جميع الحقول', 'error');
  try {
    showToast('جاري تسجيل الدخول...');
    const { token, user, family } = await api('POST', '/api/auth/login', { email, password });
    if (remember) {
      localStorage.setItem('token', token);
    } else {
      // Session only - store in sessionStorage
      sessionStorage.setItem('token', token);
      localStorage.removeItem('token');
    }
    await loadApp(user, family);
    showToast('مرحباً بعودتك! 👋', 'success');
  } catch (e) { showToast(e.message || 'فشل تسجيل الدخول', 'error'); }
}

async function registerFound() {
  const data = {
    name: document.getElementById('reg-found-name').value.trim(),
    email: document.getElementById('reg-found-email').value.trim(),
    password: document.getElementById('reg-found-password').value,
    subscriptionCode: document.getElementById('reg-sub-code').value.trim(),
    familyName: document.getElementById('reg-family-name').value.trim(),
  };
  if (!data.familyName || !data.subscriptionCode || !data.name || !data.email || !data.password)
    return showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
  try {
    showToast('جاري تأسيس العائلة...');
    const { token, user, family } = await api('POST', '/api/auth/register', data);
    localStorage.setItem('token', token);
    await loadApp(user, family);
    showToast('🎉 تم تأسيس العائلة بنجاح!', 'success');
  } catch (e) { showToast(e.message || 'فشل تأسيس العائلة', 'error'); }
}

async function registerJoin() {
  const data = {
    name: document.getElementById('reg-join-name').value.trim(),
    email: document.getElementById('reg-join-email').value.trim(),
    password: document.getElementById('reg-join-password').value,
    token: document.getElementById('reg-invite-token').value.trim(),
  };
  if (!data.token || !data.name || !data.email || !data.password)
    return showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
  try {
    showToast('جاري الانضمام للعائلة...');
    const { token, user, family } = await api('POST', '/api/auth/register-invited', data);
    localStorage.setItem('token', token);
    await loadApp(user, family);
    showToast('🎉 مرحباً بك في العائلة!', 'success');
  } catch (e) { showToast(e.message || 'فشل الانضمام', 'error'); }
}

function switchRegTab(tab) {
  document.querySelectorAll('.reg-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.reg-form').forEach(f => f.classList.remove('active'));
  document.querySelector(`.reg-tab[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`reg-form-${tab}`)?.classList.add('active');
}

function logout() {
  if (!confirm('هل أنت متأكد من تسجيل الخروج؟')) return;
  // Clear ALL tokens from everywhere
  localStorage.clear();
  sessionStorage.clear();
  if (socket) socket.disconnect();
  // Reset state completely
  Object.assign(state, { user: null, family: null, isFounder: false, isLoggedIn: false, points: 0, members: [], challenges: [], invites: [], leaderboard: [], pendingChallenges: [], onlineMembers: [] });
  // Reset menu UI to defaults
  const menuName = document.getElementById('menu-user-name');
  const menuRole = document.getElementById('menu-user-role');
  const menuAvatar = document.getElementById('menu-avatar');
  const pointsDisplay = document.getElementById('points-display');
  const familyBadge = document.getElementById('family-badge');
  if (menuName) menuName.textContent = 'الاسم';
  if (menuRole) menuRole.textContent = 'عضو';
  if (menuAvatar) menuAvatar.textContent = '👤';
  if (pointsDisplay) pointsDisplay.textContent = '0';
  if (familyBadge) familyBadge.textContent = 'العائلة';
  // Hide logged-in-only menu items
  const joinMenu = document.getElementById('menu-join-family');
  const adminMenu = document.getElementById('menu-admin');
  const reportsMenu = document.getElementById('menu-reports-item');
  const modMenu = document.getElementById('menu-moderator');
  if (joinMenu) joinMenu.style.display = 'none';
  if (adminMenu) adminMenu.style.display = 'none';
  if (modMenu) modMenu.style.display = 'none';
  // Close side menu
  const menu = document.getElementById('side-menu');
  const overlay = document.getElementById('menu-overlay');
  if (menu) menu.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  // Show landing
  showAuth('landing');
  loadLandingPage();
  updateMenuVisibility();
  showToast('تم تسجيل الخروج 👋');
}

// ==================== LOAD APP ====================
async function loadApp(user, family) {
  Object.assign(state, { user, family, isFounder: user.role === 'founder', isLoggedIn: true, points: user.points || 0 });
  // Load coins (private - only for this user)
  try {
    const { wallet } = await api('GET', '/api/wallet');
    state.coins = wallet.coins || 0;
  } catch(e) { state.coins = 0; }
  
  // For admin or users without family, skip family-dependent calls
  const hasFamily = !!family || !!user.family_id;
  
  try {
    if (hasFamily) {
      const [famData, challData, lbData, diwData] = await Promise.all([
        api('GET', '/api/family'),
        api('GET', '/api/challenges'),
        api('GET', '/api/leaderboard'),
        api('GET', '/api/diwaniya/active'),
      ]);
      state.members = famData.members || [];
      state.invites = famData.invitations || [];
      state.challenges = challData.challenges || [];
      state.pendingChallenges = challData.pending || [];
      state.leaderboard = lbData.leaderboard || [];
      applyDiwaniyaSession(diwData.session);
      // استرجاع التحدي النشط فور فتح الصفحة (يبقى شريط PK ظاهراً بعد التحديث)
      try { await loadBattleStatus(); } catch(e) {}
    } else {
      // Admin or new user: load minimal data
      state.members = [];
      state.invites = [];
      state.challenges = [];
      state.pendingChallenges = [];
      state.leaderboard = [];
      state.activeSession = null;
      state.diwaniyaOpen = false;
    }
  } catch (e) { console.error('Load error:', e); }
  updateAllUI();
  connectSocket();
  loadOnlineStatus();
  startDiwaniyaStatusPoll();
  // Admin goes directly to admin panel
  navigateTo(user.role === 'admin' ? 'admin' : 'dashboard');
}

async function refreshData() {
  try {
    const [famData, challData, lbData] = await Promise.all([
      api('GET', '/api/family'),
      api('GET', '/api/challenges'),
      api('GET', '/api/leaderboard'),
    ]);
    Object.assign(state, {
      members: famData.members || [],
      invites: famData.invitations || [],
      challenges: challData.challenges || [],
      pendingChallenges: challData.pending || [],
      leaderboard: lbData.leaderboard || [],
    });
    updateAllUI();
  } catch(e) { console.error(e); }
}

function updateAllUI() {
  if (typeof updateLevelUI === 'function') updateLevelUI();
  if (typeof updateChatGiftBtn === 'function') updateChatGiftBtn();
  refreshDiwaniyaGlobalStatus();
  try {
  document.getElementById('menu-user-name').textContent = state.user?.name || '';
  document.getElementById('menu-user-role').textContent = state.isFounder ? 'المؤسس 👑' : 'عضو';
  const menuAv = document.getElementById('menu-avatar');
  if (state.user?.avatar && state.user.avatar.startsWith('data:')) {
    menuAv.innerHTML = '<img src="' + state.user.avatar + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
  } else {
    setAvatarEl(menuAv, state.user?.avatar, '👤');
  }
  document.getElementById('points-display').textContent = state.points || 0;
  const headerCoins = document.getElementById('header-coins');
  if (headerCoins) headerCoins.textContent = state.coins || 0;
  document.getElementById('family-badge').textContent = state.family?.name || 'العائلة';
  
  // Show family subscription code next to family name
  const codeBadge = document.getElementById('family-code-badge');
  if (codeBadge) {
    if (state.family?.subscription_code) {
      codeBadge.textContent = '🔑 ' + state.family.subscription_code;
      codeBadge.style.display = 'inline-flex';
    } else {
      codeBadge.style.display = 'none';
    }
  }

  // Welcome greeting
  const greeting = document.getElementById('dashboard-greeting');
  const familyName = document.getElementById('welcome-family');
  const avatar = document.getElementById('welcome-avatar');
  if (avatar) setAvatarEl(avatar, state.user?.avatar, state.user?.name?.charAt(0) || '👤');
  
  if (state.family) {
    if (greeting) greeting.textContent = '👋 مرحباً بك ' + (state.user?.name || '') + ' 🏡';
    if (familyName) familyName.textContent = 'في عائلة ' + state.family.name;
    const famCode = document.getElementById('welcome-family-code');
    if (famCode) {
      famCode.textContent = '🔑 ' + (state.family.subscription_code || '');
      famCode.style.display = 'inline-block';
    }
  } else if (state.user?.role === 'admin') {
    if (greeting) greeting.textContent = '👋 مرحباً بك ' + (state.user?.name || '') + ' ⚙️';
    if (familyName) familyName.textContent = 'لوحة تحكم إدارة التطبيق';
  } else if (state.isLoggedIn) {
    if (greeting) greeting.textContent = '👋 مرحباً بك ' + (state.user?.name || '') + ' 🆕';
    if (familyName) familyName.textContent = 'أنت جديد، استكشف التطبيق أو انضم لعائلة';
  }

  // Show/hide join family menu option
  const joinMenu = document.getElementById('menu-join-family');
  if (joinMenu) {
    joinMenu.style.display = state.isLoggedIn && !state.family ? 'flex' : 'none';
  }
  
  // Show/hide admin menu for admin role (المشرف المالي يرى القسم المالي)
  const adminMenu = document.getElementById('menu-admin');
  if (adminMenu) {
    adminMenu.style.display = (state.user?.role === 'admin' || state.user?.role === 'finance') ? 'flex' : 'none';
  }

  // للأدمن: عنصر الرئيسية (داشبورد) يتحول إلى "لوحة التحكم" — والرئيسية الجديدة ترجع للموقع
  const dashLabel = document.getElementById('menu-dashboard-label');
  if (dashLabel) {
    if (state.user?.role === 'admin') {
      dashLabel.textContent = 'لوحة التحكم';
      document.querySelector('#menu-dashboard-item .nav-icon').textContent = '🛠️';
    } else {
      dashLabel.textContent = 'الرئيسية';
      document.querySelector('#menu-dashboard-item .nav-icon').textContent = '📊';
    }
  }
  
  // Adapt menu for visitors vs logged-in users
  updateMenuVisibility();

  const inviteSection = document.getElementById('invite-section');
  const diwCtrl = document.getElementById('diwaniya-controls-card');
  if (inviteSection) inviteSection.style.display = state.isFounder ? 'block' : 'none';
  if (diwCtrl) diwCtrl.style.display = state.isFounder ? 'block' : 'none';

  document.getElementById('dashboard-user-name').textContent = state.user?.name || '!';
  document.getElementById('dashboard-points').textContent = state.points || 0;
  document.getElementById('stat-members').textContent = state.members?.length || 0;
  document.getElementById('stat-challenges').textContent = state.challenges?.length || 0;
  document.getElementById('stat-diwaniya').textContent = state.diwaniyaOpen ? '🟢 مفتوحة' : '🔴 متوقفة';

  const founder = state.members?.find(m => m.role === 'founder');
  if (founder) {
    document.getElementById('founder-name').innerHTML = escapeHtml(founder.name) + verifBadge(founder.family_verif || 'none', 18);
    setAvatarEl(document.getElementById('founder-avatar'), founder.avatar, founder.name?.charAt(0) || '👤');
  }
  updateMembersList();
  updateInvitations();
  updateChallenges();
  updateLeaderboard();
  updateOpponentSelect();

  if (state.diwaniyaOpen && state.activeSession) {
    const btn = document.getElementById('diwaniya-toggle-btn');
    if (btn) btn.textContent = '🔒 إغلاق الديوانية';
    enableChat(true);
    const remaining = Math.max(0, Math.floor(
      (new Date(state.activeSession.opened_at).getTime() + state.activeSession.duration_minutes * 60000 - Date.now()) / 1000
    ));
    if (remaining > 0) { state.diwaniyaRemaining = remaining; startDiwaniyaTimer(Math.ceil(remaining / 60)); }
    loadDiwaniyaMessages(state.activeSession.id);
  }
  } catch(e) { console.error('updateAllUI error:', e.message); }
}

// ==================== LEVELS CONFIG (admin) ====================
let lvImageBase64 = '';

function previewLvImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    lvImageBase64 = e.target.result;
    const prev = document.getElementById('lv-image-preview');
    if (prev) { prev.src = lvImageBase64; prev.style.display = 'block'; }
  };
  reader.readAsDataURL(file);
}

async function loadAdminLevels() {
  try {
    const { config } = await api('GET', '/api/admin/levels');
    const list = document.getElementById('admin-levels-list');
    if (!config?.length) { list.innerHTML = '<div class="empty-text">لا توجد مستويات</div>'; return; }
    list.innerHTML = config.map(c =>
      '<div class="admin-family-item">' +
        '<div class="admin-family-name">' + (c.image ? '<img src="' + c.image + '" style="width:28px;height:28px;object-fit:contain;vertical-align:middle;margin-left:6px">' : '') + 'المستوى ' + c.level + ' — ' + c.coins_needed.toLocaleString('en') + ' كونزه</div>' +
        '<div class="admin-family-actions">' +
          '<button class="btn btn-sm" onclick="editLevelAdmin(' + c.level + ', ' + c.coins_needed + ')">✏️ تعديل</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteLevelAdmin(' + c.level + ')">🗑️ حذف</button>' +
        '</div>' +
      '</div>'
    ).join('');
  } catch(e) {}
}

function editLevelAdmin(level, coins) {
  document.getElementById('lv-num').value = level;
  document.getElementById('lv-coins').value = coins;
  showToast('✏️ عدّل ثم اضغط حفظ المستوى', 'success');
}

async function saveLevelAdmin() {
  const level = document.getElementById('lv-num').value;
  const coins = document.getElementById('lv-coins').value;
  if (!level || !coins) return showToast('المستوى والكونزات مطلوبان', 'error');
  try {
    const r = await api('POST', '/api/admin/levels/save', { level, coins_needed: coins, image: lvImageBase64 || undefined });
    showToast(r.message, 'success');
    lvImageBase64 = '';
    document.getElementById('lv-image-file').value = '';
    const prev = document.getElementById('lv-image-preview');
    if (prev) { prev.style.display = 'none'; prev.src = ''; }
    loadAdminLevels();
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteLevelAdmin(level) {
  if (!confirm('🗑️ حذف المستوى ' + level + '؟')) return;
  try { await api('POST', '/api/admin/levels/delete', { level }); loadAdminLevels(); } catch(e) {}
}

// ==================== LEVELS ====================
function levelBadge(level) {
  const lv = parseInt(level) || 0;
  if (lv >= 0 && lv <= 100) {
    // 1-10: animated colored GIF icon (sparkling) - 11+: static image
    const file = (lv >= 1 && lv <= 10) ? 'gif' : 'png';
    return '<img src="/assets/levels/level_' + lv + '.' + file + '?v=2" class="level-img" title="المستوى ' + lv + ' (' + levelTierName(lv) + ')">';
  }
  const tier = lv >= 40 ? 'lv-diamond' : lv >= 30 ? 'lv-purple' : lv >= 20 ? 'lv-gold' : lv >= 10 ? 'lv-silver' : 'lv-bronze';
  return '<span class="level-badge ' + tier + '" title="المستوى ' + lv + '">Lv ' + lv + '</span>';
}
function levelImg(lv) {
  return '/assets/levels/level_' + lv + '.png';
}
function levelTierName(level) {
  const lv = parseInt(level) || 0;
  return lv >= 40 ? '💎 ماسي' : lv >= 30 ? '🟣 ملكي' : lv >= 20 ? '🟡 ذهبي' : lv >= 10 ? '⚪ فضي' : '🟤 برونزي';
}
function updateLevelUI() {
  const lv = parseInt(state.user?.level) || 0;
  const menuLv = document.getElementById('menu-level-badge');
  if (menuLv) menuLv.innerHTML = levelBadge(lv);
  const dashLv = document.getElementById('dashboard-level-badge');
  if (dashLv) dashLv.innerHTML = levelBadge(lv);
  const profLv = document.getElementById('profile-level');
  if (profLv) profLv.innerHTML = levelBadge(lv) + ' <span style="font-size:11px;color:var(--text-muted)">' + levelTierName(lv) + '</span>';
  const profPoints = document.getElementById('profile-level-points');
  if (profPoints) profPoints.textContent = 'الكونزات المصروفة على الدعم: ' + ((state.user?.support_spent || 0)).toLocaleString('en');
}

// العميل يضغط على مستواه → كم باقي للمستوى التالي
async function showLevelProgress() {
  const box = document.getElementById('level-progress-box');
  if (!box) return;
  if (box.style.display !== 'none') { box.style.display = 'none'; return; }
  try {
    const { level, spent, next, config } = await api('GET', '/api/levels');
    const currentCfg = (config || []).find(c => c.level === level);
    const lvImg = (lv) => (lv >= 0 && lv <= 100) ? '<img src="/assets/levels/level_' + lv + '.' + (lv <= 10 ? 'gif' : 'png') + '?v=2" style="width:44px;height:17px;vertical-align:middle">' : ('Lv ' + lv);
    let html = '<div style="font-weight:800;color:var(--gold);margin-bottom:6px">🎯 تقدم المستوى</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><span>مستواك الحالي</span><b>' + lvImg(level) + '</b></div>' +
      '<div style="display:flex;justify-content:space-between"><span>الكونزات المصروفة على الدعم</span><b>' + (spent||0).toLocaleString('en') + '</b></div>';
    if (next) {
      const remaining = Math.max(0, next.coins_needed - (spent||0));
      const pct = Math.min(100, Math.round((spent||0) / next.coins_needed * 100));
      html += '<div style="display:flex;justify-content:space-between;margin-top:6px;align-items:center"><span>المستوى التالي</span><b>' + lvImg(next.level) + ' — ' + next.coins_needed.toLocaleString('en') + ' كونزه</b></div>' +
        '<div style="height:8px;background:rgba(255,255,255,.12);border-radius:6px;margin-top:6px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#e8b830,#ffd75e);transition:width .5s"></div></div>' +
        '<div style="color:var(--danger);font-weight:800;margin-top:6px">⏳ تبقى لك: ' + remaining.toLocaleString('en') + ' كونزه دعم للمستوى ' + next.level + '</div>';
    } else {
      html += '<div style="color:var(--gold);font-weight:800;margin-top:6px">👑 أنت في أعلى مستوى!</div>';
    }
    box.innerHTML = html;
    box.style.display = 'block';
  } catch(e) {}
}

// ==================== MENU VISIBILITY ====================
function updateMenuVisibility() {
  const isLogged = !!(state.isLoggedIn && state.user);
  const loginItem = document.getElementById('menu-login-item');
  const registerItem = document.getElementById('menu-register-item');
  const logoutBtn = document.getElementById('menu-logout-btn');
  const aboutItem = document.getElementById('menu-about-item');
  const privacyItem = document.getElementById('menu-privacy-item');
  const supportVisitor = document.getElementById('menu-support-visitor');
  const supportItem = document.querySelector('.menu-nav-item[data-page="support"]');
  const joinMenu = document.getElementById('menu-join-family');
  const adminMenu = document.getElementById('menu-admin');
  const reportsMenu = document.getElementById('menu-reports-item');
  const modMenu = document.getElementById('menu-moderator');
  const onlineFam = document.getElementById('menu-online-families');
  // App pages
  const allPages = ['dashboard','family','diwaniya','games','challenges','leaderboard','codes','auctions','profile'];
  
  if (loginItem) loginItem.style.display = isLogged ? 'none' : 'flex';
  if (registerItem) registerItem.style.display = isLogged ? 'none' : 'flex';
  if (logoutBtn) logoutBtn.style.display = isLogged ? 'flex' : 'none';
  if (aboutItem) aboutItem.style.display = isLogged ? 'none' : 'flex';
  if (privacyItem) privacyItem.style.display = isLogged ? 'none' : 'flex';
  if (supportVisitor) supportVisitor.style.display = isLogged ? 'none' : 'flex';
  if (supportItem) supportItem.style.display = isLogged ? 'flex' : 'none';
  if (joinMenu) joinMenu.style.display = (isLogged && !state.family && state.user?.role !== 'moderator') ? 'flex' : 'none';
  if (adminMenu) adminMenu.style.display = (state.user?.role === 'admin') ? 'flex' : 'none';
  if (reportsMenu) reportsMenu.style.display = (state.user?.role === 'admin') ? 'flex' : 'none';
  if (modMenu) modMenu.style.display = (state.user?.role === 'moderator' || state.user?.role === 'admin') ? 'flex' : 'none';
  if (onlineFam) onlineFam.style.display = (state.user?.role === 'moderator') ? 'flex' : 'none';
  
  // Moderator: only home + profile visible from app pages (can only enter diwaniyas via visits)
  const isModerator = state.user?.role === 'moderator';
  allPages.forEach(p => {
    const item = document.querySelector('.menu-nav-item[data-page="' + p + '"]');
    if (!item) return;
    if (!isLogged) { item.style.display = 'none'; return; }
    if (isModerator) {
      // Moderator sees only home + profile (no family/diwaniya/games/etc)
      item.style.display = (p === 'dashboard' || p === 'profile') ? 'flex' : 'none';
    } else {
      item.style.display = 'flex';
    }
  });
}

// ==================== SOCKET ====================
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API_BASE, { transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    if (state.family?.id) socket.emit('join_family', state.family.id);
    if (state.user?.id) socket.emit('join_user', state.user.id);
    if (state.activeSession?.id) socket.emit('join_session', state.activeSession.id);
    // Re-join the audio call if I was in it (server restarts wipe rooms)
    if (inLiveCall && state.activeSession?.id && localStream) {
      socket.emit('join_audio_call', {
        sessionId: state.activeSession.id,
        userId: state.user.id,
        userName: state.user.name,
        isObserver: state.user?.role === 'moderator',
        wantsVideo: state.user?.role !== 'moderator'
      });
    }
  });
  socket.on('diwaniya_opened', (s) => {
    state.diwaniyaOpen = true; state.activeSession = s;
    updateDiwaniyaStat();
    document.getElementById('timer-display').className = 'timer-display active';
    document.getElementById('timer-num').textContent = String(s.duration_minutes).padStart(2,'0') + ':00';
    document.querySelector('#timer-display .timer-label').textContent = 'الديوانية مفتوحة';
    enableChat(true); socket.emit('join_session', s.id);
    showToast('🕌 فتحت الديوانية!', 'success');
  });
  socket.on('diwaniya_closed', () => {
    state.diwaniyaOpen = false; state.activeSession = null;
    stopDiwaniyaTimer(); enableChat(false);
    document.getElementById('diwaniya-toggle-btn').textContent = '🔓 فتح الديوانية';
    updateDiwaniyaStat();
  });
  socket.on('diwaniya_closed_violation', (data) => {
    // Close diwaniya UI
    state.diwaniyaOpen = false; state.activeSession = null;
    stopDiwaniyaTimer(); enableChat(false);
    document.getElementById('diwaniya-toggle-btn').textContent = '🔓 فتح الديوانية';
    updateDiwaniyaStat();
    // Show persistent violation banner with countdown
    showViolationBanner(data.violatorName, data.reason, data.lockedUntil || null);
  });
  socket.on('user_online', (data) => {
    if (state.family?.id && state.onlineMembers) {
      if (!state.onlineMembers.includes(data.userId)) state.onlineMembers.push(data.userId);
      updateMembersList();
    }
  });
  socket.on('user_offline', (data) => {
    if (state.onlineMembers) {
      state.onlineMembers = state.onlineMembers.filter(id => id !== data.userId);
      updateMembersList();
    }
  });
  socket.on('family_notification', (data) => {
    showFamilyNotification(data.title, data.message);
  });
  socket.on('gift_on_camera', (d) => {
    if (d && d.toId) { sessionGiftCoins[d.toId] = (sessionGiftCoins[d.toId] || 0) + (d.giftCoins || 0); updateCallPresence(); }
    // أنيميشن الهدية على الشاشة (نمط تيك توك) لكل من في البث — فقط أثناء البث
    if (d && d.giftName && inLiveCall) showGiftOnCamera(d);
  });
  socket.on('diwaniya_message', (msg) => {
    addChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id, msg.avatar, msg.user_level, msg.user_role === 'founder' ? (msg.family_verif || 'none') : 'none', msg.user_id);
    const tk = document.getElementById('tiktok-chat');
    if (tk && tk.style.display !== 'none') addTikTokChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id, msg.user_level, msg.user_role === 'founder' ? (msg.family_verif || 'none') : 'none');
  });
  socket.on('diwaniya_audio', (msg) => addAudioMessage(msg.user_name, msg.audio, msg.audioType, msg.user_id === state.user?.id, msg.user_role === 'founder' ? (msg.family_verif || 'none') : 'none'));
  socket.on('new_challenge', () => { showToast('⚔️ تحدٍ جديد!', 'success'); refreshData(); });
  socket.on('challenge_completed', () => { showToast('🏆 تم التحدي!', 'success'); refreshData(); });
  socket.on('leaderboard_update', () => refreshData());
  
  // WebRTC Audio Call Signaling
  socket.on('audio_offer', (data) => { if (data.avatar) peerAvatars[data.from] = data.avatar; handleAudioOffer(data.from, data.userName, data.offer); });
  socket.on('audio_answer', (data) => handleAudioAnswer(data.from, data.answer));
  socket.on('audio_ice_candidate', (data) => handleIceCandidate(data.from, data.candidate));
  socket.on('user_effect_changed', (data) => {
    applyEffectToTile(document.getElementById('video-' + data.userId), data.effectId);
  });
  socket.on('user_joined_call', (data) => {
    if (data.avatar) peerAvatars[data.userId] = data.avatar;
    if (data.level !== undefined) peerLevels[data.userId] = data.level;
    if (inLiveCall && data.userId !== state.user?.id) {
      showEntryBanner(data.userName, data.avatar, 'انضم للديوانية 🎉', data.level);
      if (!state.callMembers) state.callMembers = {};
      state.callMembers[data.userId] = data.userName;
      updateCallPresence();
      if (typeof updateViewerCount === 'function') updateViewerCount();
      // New user joined, send them an offer
      setTimeout(() => createOffer(data.userId, data.userName), 500);
    }
  });
  socket.on('user_left_call', (data) => {
    removeRemoteAudio(data.userId);
    if (state.callMembers) delete state.callMembers[data.userId];
    delete remoteScreenShare[data.userId];
    delete screenRotation[data.userId];
    updateCallPresence();
    if (typeof updateViewerCount === 'function') updateViewerCount();
  });
  // مشاركة الشاشة: وصول/توقف بث شاشة المؤسس
  socket.on('screen_share_state', (data) => {
    if (!data?.userId) return;
    if (state.user?.id && data.userId === state.user.id) return; // معاينتي تدار محلياً
    remoteScreenShare[data.userId] = !!data.active;
    applyScreenShareToTile(data.userId, !!data.active);
    if (data.active) showToast('🖥️ ' + (data.userName || 'المؤسس') + ' يشارك شاشته الآن', 'success');
  });
  socket.on('screen_share_denied', (data) => {
    showToast(data?.message || 'مشاركة الشاشة للمؤسس فقط', 'error');
  });
  // 🎬 مشاهدة معاً
  socket.on('watch_started', (data) => {
    if (data?.url) {
      if (window._watchUploadPending) {
        window._watchUploadPending = false;
        const wm = document.getElementById('watch-modal');
        if (wm) wm.style.display = 'none';
        const pw = document.getElementById('watch-progress-wrap');
        if (pw) pw.style.display = 'none';
        const su = document.getElementById('watch-upload-status');
        if (su) su.textContent = '';
      }
      renderWatchPlayer(data);
    }
  });
  socket.on('watch_control', (data) => {
    if (!watchTogether || watchIsHost || !data) return; // المضيف يتحكم بنفسه
    if (watchYT) {
      if (data.action === 'pause') watchYT.pauseVideo();
      else if (data.action === 'play') watchYT.playVideo();
      if (typeof data.time === 'number') { try { watchYT.seekTo(data.time, true); } catch (e) {} }
    } else if (watchVideo) {
      if (typeof data.time === 'number') { try { watchVideo.currentTime = data.time; } catch (e) {} }
      if (data.action === 'pause') watchVideo.pause();
      else if (data.action === 'play') watchVideo.play().catch(() => {});
    }
  });
  socket.on('watch_stopped', () => {
    hideWatchPlayer();
    showToast('🎬 انتهت المشاهدة المشتركة', 'success');
  });
  socket.on('call_full', (data) => {
    showToast(data.message || 'البث ممتلئ', 'error');
    leaveLiveAudio();
  });
  socket.on('recording_attempt_announce', (data) => {
    showRecordingAttemptAnnounce(data);
  });
  socket.on('diwaniya_kicked', (data) => {
    // I was kicked from the diwaniya
    showToast('👢 تم طردك من الديوانية بواسطة ' + (data.byName || 'المؤسس'), 'error');
    leaveLiveAudio();
    enableChat(false);
    // Close diwaniya view for me
    state.diwaniyaOpen = false;
    state.activeSession = null;
    stopDiwaniyaTimer();
    document.getElementById('diwaniya-toggle-btn').textContent = '🔓 فتح الديوانية';
    updateDiwaniyaStat();
  });
  socket.on('audio_kick', (data) => {
    if (data.userId === state.user?.id) {
      showToast('👢 تم طردك من البث', 'error');
      leaveLiveAudio();
    } else {
      removeRemoteAudio(data.userId);
      const chip = document.getElementById('participant-' + data.userId);
      if (chip) chip.remove();
    }
  });
  socket.on('diwaniya_restricted', (data) => {
    if (data.userId && data.userId !== state.user?.id) {
      // Another member restricted - show badge on their tile
      const tile = document.getElementById('video-' + data.userId);
      if (tile) {
        let badge = tile.querySelector('.restricted-badge');
        if (data.restricted && !badge) {
          badge = document.createElement('div');
          badge.className = 'restricted-badge';
          badge.textContent = '🙊';
          tile.appendChild(badge);
        } else if (!data.restricted && badge) { badge.remove(); }
      }
      return;
    }
    if (!data.userId || data.userId === state.user?.id) {
      // I am restricted - listen only
      if (data.restricted) {
        showToast('🙊 تم تقييدك - وضع الاستماع فقط (بدون كتابة أو كاميرا)', 'error');
        enableChat(false);
        // Force camera off + mic mute
        if (localStream) {
          camOff = true;
          localStream.getVideoTracks().forEach(t => t.enabled = false);
          const myVideo = document.getElementById('my-video');
          if (myVideo) myVideo.style.display = 'none';
          const camBtn = document.getElementById('cam-toggle-btn');
          if (camBtn) { camBtn.classList.add('off'); }
        }
      } else {
        showToast('✅ تم رفع التقييد - تقدر تشارك من جديد', 'success');
        enableChat(true);
      }
    }
  });
  socket.on('audio_restrict', (data) => {
    if (data.userId === state.user?.id) {
      if (localStream) {
        camOff = true;
        localStream.getVideoTracks().forEach(t => t.enabled = false);
        const myVideo = document.getElementById('my-video');
        if (myVideo) myVideo.style.display = 'none';
        const camBtn = document.getElementById('cam-toggle-btn');
        if (camBtn) { camBtn.classList.add('off'); }
      }
      showToast('🙊 تم إيقاف الكاميرا - وضع الاستماع فقط', 'error');
    }
  });
  socket.on('diwaniya_member_kicked', (data) => {
    removeRemoteAudio(data.userId);
    const chip = document.getElementById('participant-' + data.userId);
    if (chip) chip.remove();
    showToast('👢 تم طرد عضو بواسطة ' + (data.byName || 'المؤسس'), 'error');
  });
  socket.on('auction_report', (data) => {
    if (state.user?.role === 'admin') showToast(data.message || 'تقرير مزاد جديد', 'success');
  });
  socket.on('session_invalid', () => {
    localStorage.clear();
    sessionStorage.clear();
    if (socket) socket.disconnect();
    location.reload();
  });
  socket.on('auction_won', (data) => {
    showToast('🏆 مبروك! فزت بمزاد الرمز (' + (data.code || '') + ') - خُصمت عملاتك المحجوزة 🪙 ' + (data.coins || 0) + ' والرمز أصبح ملكك!', 'success');
    playNotificationSound();
    refreshWalletHeader();
    loadWallet();
    loadMyCodes();
  });
  socket.on('level_up', (data) => {
    const lv = data.level || 0;
    state.user.level = lv;
    updateLevelUI();
    showToast('🎉 مبروك! وصلت للمستوى ' + lv + ' (' + levelTierName(lv) + ')', 'success');
    playNotificationSound();
  });
  socket.on('hold_released', (data) => {
    showToast('🪙 عادت لك ' + (data.coins || 0) + ' 🪙 محجوزة من مزايدة الرمز (' + (data.code || '') + ')', 'success');
    playNotificationSound();
    refreshWalletHeader();
    loadWallet();
  });
  socket.on('coins_charged', (data) => {
    showToast('🎉 تم شحن حسابك بـ ' + data.amount + ' 🪙!', 'success');
    playNotificationSound();
    refreshWalletHeader();
  });
  socket.on('coins_transferred', (data) => {
    showToast('🔄 استلمت ' + data.amount + ' 🪙 من ' + (data.fromName || 'عضو') + ' (' + (data.fromPublicId || '') + ')', 'success');
    playNotificationSound();
    refreshWalletHeader();
  });
  socket.on('join_invite_rejected', (data) => {
    showToast('❌ مؤسس عائلة «' + (data.familyName || '') + '» (' + (data.founderName || '') + ') رفض التحدي', 'error');
    playNotificationSound();
  });
  socket.on('join_invite_accepted', (data) => {
    showToast('✅ ' + (data.founderName || '') + ' قبل الانضمام - سولفوا ثم أرسل التحدي ⚔️', 'success');
    playNotificationSound();
  });
  socket.on('family_join_invite', (data) => {
    pendingFamilyJoin = data;
    document.getElementById('family-join-text').textContent = data.fromName + ' (عائلة ' + (data.familyName || '') + ') يدعوك للانضمام لبثهم وسولفوا قبل التحدي ⚔️';
    document.getElementById('family-join-modal').style.display = 'flex';
    playNotificationSound();
  });
  socket.on('battle_invite', (data) => {
    pendingBattleInvite = data;
    document.getElementById('battle-invite-text').textContent = data.fromName + ' يتحداك في الديوانية! ⚔️ المدة: ' + data.duration + ' دقائق';
    document.getElementById('battle-invite-modal').style.display = 'flex';
    playNotificationSound();
  });
  socket.on('battle_started', (b) => {
    showToast('⚔️ بدأ التحدي! ادعموا لاعبيكم 🎁', 'success');
    renderBattle(b);
  });
  socket.on('battle_update', (b) => { if (currentBattle?.id === b.id) renderBattle(b); });
  socket.on('battle_victory', (b) => {
    // Victory round: 2 minutes - loser executes the penalty, tug-of-war line stays then disappears
    showToast('🏆 فاز ' + (b.winnerName || '') + '! جولة النصر بدأت - ' + (b.loserName || 'الخصم') + ' ينفذ الحكم', 'success');
    playNotificationSound();
    renderBattle({ ...b, status: 'victory' });
    startVictoryTimer();
  });
  socket.on('battle_finalized', () => {
    renderBattle(null);
  });
  socket.on('mic_forced', (data) => {
    // Founder forced my mic state
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => t.enabled = !data.muted);
    micMuted = !!data.muted;
    const micBtn = document.getElementById('mic-toggle-btn');
    if (micBtn) micBtn.classList.toggle('muted', micMuted);
    showToast(data.muted ? '🔇 تم كتم مايكك بواسطة المؤسس' : '🎙️ فتح المؤسس مايكك', data.muted ? 'error' : 'success');
  });
  socket.on('camera_invite', (data) => {
    // I was invited to go on camera
    pendingCameraInvite = data;
    selectedInviteMode = 'both';
    selectedInviteFilter = '';
    document.querySelectorAll('.invite-mode').forEach(m => m.classList.toggle('selected', m.dataset.mode === 'both'));
    document.querySelectorAll('.filter-opt').forEach(f => f.classList.toggle('selected', f.dataset.filter === ''));
    document.getElementById('camera-invite-text').textContent = 'تمت دعوتك للمشاركة بكاميرا الديوانية من قبل ' + (data.founderName || 'المؤسس');
    document.getElementById('camera-invite-modal').style.display = 'flex';
    playNotificationSound();
  });
  socket.on('camera_invite_response', (data) => {
    if (data.accept) showToast('🎥 ' + (data.inviteeName || 'العضو') + ' وافق على المشاركة بالكاميرا!', 'success');
    else showToast('❌ ' + (data.inviteeName || 'العضو') + ' رفض المشاركة بالكاميرا', 'error');
  });
  socket.on('session_member_left', (data) => {
    const msg = '👋 ' + (data.name || 'عضو') + (data.familyName ? ' (👪 ' + data.familyName + ')' : '') + ' غادر الديوانية';
    const room = document.getElementById('chat-room');
    if (room) {
      const empty = room.querySelector('.empty-state');
      if (empty) room.innerHTML = '';
      const sys = document.createElement('div');
      sys.className = 'system-msg';
      sys.style.cssText = 'text-align:center;font-size:12px;color:var(--text-muted);margin:6px 0;font-weight:700;background:rgba(255,255,255,.06);padding:7px;border-radius:8px';
      sys.textContent = msg;
      room.appendChild(sys);
      room.scrollTop = room.scrollHeight;
    }
    const tk = document.getElementById('tiktok-chat');
    if (tk && tk.style.display !== 'none') {
      const list = document.getElementById('tiktok-chat-list');
      if (list) {
        const m = document.createElement('div');
        m.className = 'tiktok-chat-msg system';
        m.style.cssText = 'background:rgba(255,255,255,.12);text-align:center;margin-left:auto;margin-right:auto;width:fit-content';
        m.textContent = msg;
        list.appendChild(m);
        while (list.children.length > 30) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
      }
    }
  });
  socket.on('session_member_joined', (data) => {
    const msg = '🎉 ' + (data.name || 'عضو') + (data.familyName ? ' (👪 ' + data.familyName + ')' : '') + ' انضم للبث';
    // System message in the main chat box
    const room = document.getElementById('chat-room');
    if (room) {
      const empty = room.querySelector('.empty-state');
      if (empty) room.innerHTML = '';
      const sys = document.createElement('div');
      sys.className = 'system-msg';
      sys.style.cssText = 'text-align:center;font-size:12px;color:var(--gold);margin:6px 0;font-weight:700;background:rgba(232,184,48,.12);padding:7px;border-radius:8px';
      sys.textContent = msg;
      room.appendChild(sys);
      room.scrollTop = room.scrollHeight;
    }
    // Also show in the TikTok on-screen chat if visible
    const tk = document.getElementById('tiktok-chat');
    if (tk && tk.style.display !== 'none') {
      const list = document.getElementById('tiktok-chat-list');
      if (list) {
        const m = document.createElement('div');
        m.className = 'tiktok-chat-msg system';
        m.style.cssText = 'background:rgba(232,184,48,.18);text-align:center;margin-left:auto;margin-right:auto;width:fit-content';
        m.textContent = msg;
        list.appendChild(m);
        while (list.children.length > 30) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
      }
    }
    playNotificationSound();
  });
  socket.on('diwaniya_action_announce', (data) => {
    // Public: everyone sees who was kicked/restricted and why
    const icon = data.action === 'kick' ? '👢' : '🙊';
    const actionName = data.action === 'kick' ? 'طرد' : 'تقييد';
    const msg = icon + ' تم ' + actionName + ' العضو «' + (data.victimName || 'عضو') + '» بسبب: ' + data.reason + ' — بواسطة مؤسس العائلة ' + (data.byName || '');
    showToast(msg, 'error');
    // Add as system message in diwaniya chat
    const room = document.getElementById('chat-room');
    if (room) {
      const sys = document.createElement('div');
      sys.className = 'system-msg';
      sys.style.cssText = 'text-align:center;font-size:12px;color:var(--gold);margin:8px 0;font-weight:700;background:rgba(232,184,48,.12);padding:8px;border-radius:8px';
      sys.textContent = msg;
      room.appendChild(sys);
      room.scrollTop = room.scrollHeight;
    }
  });
  socket.on('video_limit_updated', (data) => {
    const el = document.getElementById('video-limit-display');
    if (el) el.textContent = data.videoLimit || 6;
  });
  socket.on('video_slots_full', (data) => {
    // Turn off camera - become audio-only listener (still hears + sees others)
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.enabled = false);
      camOff = true;
      const myVideo = document.getElementById('my-video');
      if (myVideo) myVideo.style.display = 'none';
      const camBtn = document.getElementById('cam-toggle-btn');
      if (camBtn) { camBtn.classList.add('off'); }
    }
    showToast(data.message || '🎥 الكاميرات ممتلئة - ستنضم بالصوت', 'error');
  });
  socket.on('call_participants', (data) => {
    // Join existing participants
    if (!state.callMembers) state.callMembers = {};
    data.participants.forEach(p => {
      if (p.avatar) peerAvatars[p.userId] = p.avatar;
      if (p.level !== undefined) peerLevels[p.userId] = p.level;
      if (p.screenShare) remoteScreenShare[p.userId] = true;
      if (p.userId !== state.user?.id) {
        state.callMembers[p.userId] = p.userName;
        setTimeout(() => createOffer(p.userId, p.userName), 500);
      }
    });
    // Fancy entry: show the first existing member banner briefly (TikTok style)
    if (data.participants.length && data.participants[0].userId !== state.user?.id) {
      const first = data.participants[0];
      showEntryBanner(first.userName, first.avatar, 'موجود في الديوانية 👋', first.level);
    }
    updateCallPresence();
  });
}

// ==================== DIWANIYA ====================
// الحالة العالمية للديوانية (فيديو/صوت/صيانة) — تتحكم من لوحة الإدارة
let dwGlobal = { video_enabled: true, audio_enabled: true, maintenance: { active: false, until: null, reason: '' } };

async function refreshDiwaniyaGlobalStatus() {
  try {
    const s = await api('GET', '/api/diwaniya/global-status');
    dwGlobal = Object.assign(dwGlobal, s);
    applyDiwaniyaGlobalStatusUI();
  } catch(e) {}
}

function dwMaintenanceActive() {
  return !!(dwGlobal.maintenance && dwGlobal.maintenance.active);
}


function dwJoinBtnText(mode) {
  if (mode === 'video') return '🎥 انضم لبث الفيديو';
  if (mode === 'all') return '🎥🎤 انضم للبث (فيديو + صوت)';
  return '🎤 انضم للبث الصوتي';
}

function updateDiwaniyaStat() {
  const stat = document.getElementById('stat-diwaniya');
  if (!stat) return;
  if (dwMaintenanceActive() && state.user?.role !== 'admin') {
    stat.innerHTML = '<span style="color:#ff9800;font-weight:700">🟠 تحت الصيانة</span>';
  } else {
    stat.textContent = state.diwaniyaOpen ? '🟢 مفتوحة' : '🔴 متوقفة';
  }
}

function applyDiwaniyaGlobalStatusUI() {
  // مؤشر الرئيسية
  updateDiwaniyaStat();
  const isAdmin = state.user?.role === 'admin';
  const maint = dwMaintenanceActive();

  // بانر الصيانة في صفحة الديوانية
  const banner = document.getElementById('maintenance-banner');
  if (banner) {
    const show = maint && !isAdmin;
    banner.style.display = show ? 'block' : 'none';
    if (show) {
      const reasonEl = document.getElementById('maintenance-banner-reason');
      if (reasonEl) reasonEl.textContent = dwGlobal.maintenance.reason || 'جاري تحديث وصيانة الديوانيات';
      const untilEl = document.getElementById('maintenance-banner-until');
      if (untilEl) {
        try {
          const d = new Date(dwGlobal.maintenance.until);
          if (!isNaN(d)) untilEl.textContent = ' حتى ' + d.toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit' });
        } catch(e) {}
      }
    }
  }

  // إخفاء أزرار التحكم للمستخدم العادي أثناء الصيانة
  const controls = document.getElementById('diwaniya-controls-card');
  if (controls) controls.style.display = (maint && !isAdmin) ? 'none' : 'block';

  // تعطيل أوضاع الفيديو/الصوت من القائمة
  const modeSel = document.getElementById('diwaniya-mode');
  if (modeSel) {
    const opt = v => modeSel.querySelector('option[value="' + v + '"]');
    const setOpt = (v, enabled) => {
      const o = opt(v);
      if (o) {
        o.disabled = !enabled;
        o.textContent = (enabled ? '' : '⛔ ') + o.textContent.replace(/^⛔ /, '');
      }
    };
    setOpt('video', dwGlobal.video_enabled);
    setOpt('audio', dwGlobal.audio_enabled);
    setOpt('both', dwGlobal.video_enabled && dwGlobal.audio_enabled);
    setOpt('all', dwGlobal.video_enabled && dwGlobal.audio_enabled);
    // لو الوضع المحدد صار معطلاً → نرجع للكتابي
    const curOpt = modeSel.querySelector('option[value="' + modeSel.value + '"]');
    if (curOpt && curOpt.disabled) modeSel.value = 'text';
  }

  // إخفاء قسم المكالمة إذا كان الصوت أو الفيديو معطل
  const liveSection = document.getElementById('live-audio-section');
  if (liveSection && liveSection.style.display !== 'none' && state.diwaniyaOpen) {
    const mode = state.diwaniyaMode || 'text';
    const needsAudio = ['audio', 'video', 'both', 'all'].includes(mode);
    const needsVideo = ['video', 'all'].includes(mode);
    if (needsAudio && !dwGlobal.audio_enabled) liveSection.style.display = 'none';
    if (needsVideo && !dwGlobal.video_enabled) liveSection.style.display = 'none';
  }
}

async function toggleDiwaniya() {
  if (state.diwaniyaOpen) return closeDiwaniya();
  if (dwMaintenanceActive() && state.user?.role !== 'admin') {
    return showToast('🟠 الديوانية تحت الصيانة حالياً — جاري التحديث، حاول لاحقاً', 'error');
  }
  const duration = parseInt(document.getElementById('diwaniya-duration').value);
  const topic = document.getElementById('diwaniya-topic').value.trim();
  const mode = document.getElementById('diwaniya-mode')?.value || 'text';
  const capacity = parseInt(document.getElementById('diwaniya-capacity-select')?.value || '15');
  const secretCode = document.getElementById('diwaniya-secret-code')?.value.trim() || '';
  try {
    // Set capacity first if founder
    if (state.isFounder) {
      await api('POST', '/api/diwaniya/capacity/set', { capacity }).catch(() => {});
    }
    const session = await api('POST', '/api/diwaniya/open', { durationMinutes: duration, topic, mode, secretCode });
    // Show secret code to founder
    if (secretCode) {
      showToast('🗝️ الرقم السري: ' + secretCode, 'success');
    }
    state.diwaniyaOpen = true; state.activeSession = session;
    state.diwaniyaMode = mode;
    const modeSelAfterOpen = document.getElementById('diwaniya-mode');
    if (modeSelAfterOpen) modeSelAfterOpen.value = mode;
    document.getElementById('diwaniya-toggle-btn').textContent = '🔒 إغلاق الديوانية';
    updateDiwaniyaStat();
    const modeLabel = { text: '✍️ كتابي', audio: '🎤 صوتي', video: '🎥 فيديو', both: '📝🎤 كتابي+صوتي', all: '📝🎥🎤 كل شي' };
    document.querySelector('#timer-display .timer-label').textContent = 'الديوانية مفتوحة - ' + (modeLabel[mode] || mode);
    startDiwaniyaTimer(duration);
    setupChatMode(mode);
    startMessagePolling();
    // Show video limit control for founder
    const vlc = document.getElementById('video-limit-control');
    if (vlc) vlc.style.display = state.isFounder ? 'flex' : 'none';
    // Show the call section + join button immediately for audio/video modes
    const audioSection = document.getElementById('live-audio-section');
    if (audioSection && ['audio','video','both','all'].includes(mode)) audioSection.style.display = 'block';
    const joinBtn = document.getElementById('join-audio-btn');
    if (joinBtn && ['audio','video','both','all'].includes(mode)) {
      joinBtn.style.display = 'block';
      joinBtn.textContent = dwJoinBtnText(mode);
      joinBtn.className = 'btn btn-accent btn-full';
    }
    if (socket?.connected) socket.emit('join_session', session.id);
    showToast('🕌 فتحت الديوانية!', 'success');
  } catch (e) { showToast(e.message || 'فشل فتح الديوانية', 'error'); }
}

async function closeDiwaniya() {
  if (!state.activeSession?.id) return;
  try {
    await api('POST', `/api/diwaniya/close/${state.activeSession.id}`);
    state.diwaniyaOpen = false; state.activeSession = null;
    stopDiwaniyaTimer(); enableChat(false);
    document.getElementById('diwaniya-toggle-btn').textContent = '🔓 فتح الديوانية';
    updateDiwaniyaStat();
    const audioSection = document.getElementById('live-audio-section');
    if (audioSection) audioSection.style.display = 'none';
    if (inLiveCall) leaveLiveAudio();
  } catch(e) { showToast(e.message || 'فشل الإغلاق', 'error'); }
}

function sendChat() {
  const input = document.getElementById('chat-input-field');
  const text = input.value.trim();
  if (!text || !state.diwaniyaOpen) return;
  input.value = '';
  if (socket?.connected) {
    socket.emit('diwaniya_message', { sessionId: state.activeSession.id, userId: state.user.id, message: text });
  } else {
    api('POST', '/api/diwaniya/message', { sessionId: state.activeSession.id, message: text }).catch(() => {});
  }
}

// Instant check: fetch diwaniya status right now (used when opening the page)
async function refreshDiwaniyaNow() {
  try {
    const { session } = await api('GET', '/api/diwaniya/active');
    applyDiwaniyaSession(session);
  } catch(e) {}
  // استرجاع التحدي النشط (بعد تحديث الصفحة مثلاً) ليبقى شريط PK ظاهراً
  try { await loadBattleStatus(); } catch(e) {}
}

// Apply a fetched session to the UI (shared by poll + page open)
function applyDiwaniyaSession(session) {
  const isOpen = session?.status === 'open';
  const wasOpen = state.diwaniyaOpen;
  if (isOpen) {
    state.diwaniyaOpen = true;
    state.activeSession = session;
    const mode = session.mode || 'text';
    state.diwaniyaMode = mode;
    const modeSelLive = document.getElementById('diwaniya-mode');
    if (modeSelLive) modeSelLive.value = mode;
    const btn = document.getElementById('diwaniya-toggle-btn');
    if (btn) btn.textContent = '🔒 إغلاق الديوانية';
    const stat = document.getElementById('stat-diwaniya');
    if (stat) stat.textContent = '🟢 مفتوحة';
    const modeLabel = { text: '✍️ كتابي', audio: '🎤 صوتي', video: '🎥 فيديو', both: '📝🎤 كتابي+صوتي', all: '📝🎥🎤 كل شي' };
    const tl = document.querySelector('#timer-display .timer-label');
    if (tl) tl.textContent = 'الديوانية مفتوحة - ' + (modeLabel[mode] || mode);
    if (session.duration_minutes) startDiwaniyaTimer(session.duration_minutes);
    setupChatMode(mode);
    enableChat(true);
    startMessagePolling();
    if (socket?.connected) socket.emit('join_session', session.id);
    const audioSection = document.getElementById('live-audio-section');
    if (audioSection && ['audio','video','both','all'].includes(mode)) audioSection.style.display = 'block';
    // Show join button state based on mode
    const joinBtn = document.getElementById('join-audio-btn');
    if (joinBtn && ['audio','video','both','all'].includes(mode)) {
      joinBtn.style.display = 'block';
      joinBtn.textContent = dwJoinBtnText(mode);
      joinBtn.className = 'btn btn-accent btn-full';
    }
    if (!wasOpen) {
      showToast('🕌 الديوانية مفتوحة الآن! انضم', 'success');
      playNotificationSound();
    }
  }
  if (!isOpen && wasOpen) {
    state.diwaniyaOpen = false;
    state.activeSession = null;
    stopDiwaniyaTimer();
    enableChat(false);
    stopMessagePolling();
    const btn = document.getElementById('diwaniya-toggle-btn');
    if (btn) btn.textContent = '🔓 فتح الديوانية';
    const stat = document.getElementById('stat-diwaniya');
    if (stat) stat.textContent = '🔴 متوقفة';
    const audioSection = document.getElementById('live-audio-section');
    if (audioSection) audioSection.style.display = 'none';
    if (inLiveCall) leaveLiveAudio();
  }
}

// Live diwaniya status sync (every 15s) - members see it open in real-time
function startDiwaniyaStatusPoll() {
  if (state._statusPoll) clearInterval(state._statusPoll);
  state._statusPoll = setInterval(async () => {
    try {
      const { session } = await api('GET', '/api/diwaniya/active');
      const wasOpen = state.diwaniyaOpen;
      applyDiwaniyaSession(session);
      if (wasOpen && session?.status !== 'open') showToast('🔒 أغلقت الديوانية', 'error');
    } catch(e) {}
    // مزامنة التحدي النشط (شريط PK) كل دورة
    try { await loadBattleStatus(); } catch(e) {}
    // تحديث مستوى/رصيد المستخدم الحقيقي (يظهر بعد الدعم مباشرة)
    try { await refreshUserProfile(); } catch(e) {}
  }, 15000);
}

// Poll diwaniya messages every 4s while open (ensures moderator messages appear)
function startMessagePolling() {
  if (state._msgPoll) clearInterval(state._msgPoll);
  state._msgPoll = setInterval(() => {
    if (state.diwaniyaOpen && state.activeSession?.id) {
      loadDiwaniyaMessages(state.activeSession.id, true);
    }
  }, 3000);
}
function stopMessagePolling() {
  if (state._msgPoll) { clearInterval(state._msgPoll); state._msgPoll = null; }
}

let lastMsgCount = 0;
let notifiedMsgIds = new Set();
let lastMsgIds = '';

async function loadDiwaniyaMessages(sessionId, isPoll = false) {
  try {
    const { messages } = await api('GET', `/api/diwaniya/messages/${sessionId}`);
    const room = document.getElementById('chat-room'); if (!room) return;
    // No full re-render if nothing new (prevents flicker every 3s)
    const ids = (messages || []).map(m => m.id).join(',');
    const empty = room.querySelector('.empty-state');
    if (empty) room.innerHTML = '';
    if (isPoll && ids === lastMsgIds && room.children.length > 0) return;
    if (ids !== lastMsgIds) {
      room.innerHTML = '';
      messages.forEach(msg => addChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id, msg.avatar, msg.user_level, msg.user_role === 'founder' ? (msg.family_verif || 'none') : 'none', msg.user_id));
      lastMsgIds = ids;
    }
    // Sync TikTok overlay chat if visible
    const tk = document.getElementById('tiktok-chat');
    if (tk && tk.style.display !== 'none') syncTikTokChat();
    
    // Popup notification for NEW moderator/system messages (from others)
    if (isPoll && messages.length > lastMsgCount) {
      const newMsgs = messages.slice(lastMsgCount);
      newMsgs.forEach(msg => {
        if (msg.user_id !== state.user?.id && !notifiedMsgIds.has(msg.id)) {
          notifiedMsgIds.add(msg.id);
          // Moderator visit notifications
          if (msg.message.includes('🕵️') || msg.message.includes('📋') || msg.message.includes('المشرف')) {
            playNotificationSound();
            showFamilyNotification('🕵️ إشعار من الديوانية', msg.message);
          }
        }
      });
    }
    lastMsgCount = messages.length;
    // Keep set small
    if (notifiedMsgIds.size > 100) notifiedMsgIds = new Set(messages.slice(-20).map(m => m.id));
  } catch(e) { console.error(e); }
}

// ==================== INVITES ====================
function addInviteInput() {
  const container = document.getElementById('invite-inputs');
  const group = document.createElement('div'); group.className = 'invite-input-group';
  group.innerHTML = '<input class="form-input" type="email" placeholder="example@email.com" dir="ltr"><button class="btn-remove" onclick="this.parentElement.remove()">✕</button>';
  container.appendChild(group);
}

// ==================== WHATSAPP INVITES ====================
async function inviteViaWhatsApp() {
  const div = document.getElementById('whatsapp-members-select');
  const list = document.getElementById('whatsapp-members-list');
  if (div) div.style.display = div.style.display === 'none' ? 'block' : 'none';
  if (!list) return;
  if (state.user?.role !== 'founder' && state.user?.role !== 'admin' && state.user?.role !== 'moderator') {
    list.innerHTML = '<div class="empty-text" style="font-size:12px">أرقام الواتساب خاصة بالمؤسس فقط</div>';
    return;
  }
  let members = [];
  try {
    const r = await api('GET', '/api/family/whatsapp-numbers');
    members = r.numbers || [];
  } catch(e) { members = []; }
  const withWhatsApp = members.filter(m => m.whatsapp && m.name !== state.user?.name);
  if (!withWhatsApp.length) {
    list.innerHTML = '<div class="empty-text" style="font-size:12px">لا يوجد أعضاء سجلوا أرقام واتساب بعد</div>';
    return;
  }
  list.innerHTML = withWhatsApp.map(m => {
    const cleanNum = String(m.whatsapp).replace(/[^0-9]/g, '');
    const intl = cleanNum.startsWith('0') ? '966' + cleanNum.slice(1) : cleanNum;
    const diwaniyaLine = state.diwaniyaOpen ? '\n🕌 حياكم الله الديوانية مفتوحة' : '';
    const msg = encodeURIComponent('👋 دعوة من مؤسس عائلة ' + (state.family?.name || '') + ' للتواجد في التطبيق' + diwaniyaLine + '\n🔑 رمز العائلة: ' + (state.family?.subscription_code || '') + '\n🔗 https://family-live.onrender.com');
    return '<div class="my-family-item" style="cursor:pointer" onclick="window.open(\'https://wa.me/' + intl + '?text=' + msg + '\', \'_blank\')">' +
      '<span>📱 ' + (m.name || '') + '</span><span style="color:var(--gold)">' + (m.whatsapp || '') + '</span>' +
      '<span class="btn btn-sm btn-accent">إرسال</span></div>';
  }).join('');
}

function inviteViaWhatsAppShare() {
  const diwaniyaLine = state.diwaniyaOpen ? '\n🕌 حياكم الله الديوانية مفتوحة' : '';
  const msg = encodeURIComponent('👋 انضم لعائلة ' + (state.family?.name || '') + ' على تطبيق العائلة' + diwaniyaLine + '\n🔑 رمز العائلة: ' + (state.family?.subscription_code || '') + '\n🔗 https://family-live.onrender.com');
  window.open('https://wa.me/?text=' + msg, '_blank');
}

async function sendInvites() {
  const inputs = document.querySelectorAll('#invite-inputs .form-input');
  const emails = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
  if (!emails.length) return showToast('أدخل بريداً واحداً على الأقل', 'error');
  try {
    const { invitations } = await api('POST', '/api/family/invite', { emails });
    let resultsDiv = document.getElementById('invite-results');
    if (!resultsDiv) {
      resultsDiv = document.createElement('div'); resultsDiv.id = 'invite-results';
      resultsDiv.className = 'invite-results';
      document.getElementById('invite-section')?.appendChild(resultsDiv);
    }
    resultsDiv.innerHTML = invitations.map(inv => {
      const link = inv.inviteUrl || '';
      return '<div class="invite-result ' + (inv.status === 'sent' ? 'success' : 'error') + '">' +
        '<div><strong>' + inv.email + '</strong>: ' + (inv.status === 'sent' ? '✅ تم إنشاء الرابط' : '⏳ موجود بالفعل') + '</div>' +
        (inv.status === 'sent' && link ?
          '<div style="display:flex;gap:6px;margin-top:6px;align-items:center">' +
            '<input class="form-input" dir="ltr" readonly style="flex:1;font-size:11px" value="' + link + '">' +
            '<button class="btn btn-sm btn-accent" onclick="copyInviteLink(this)">📋 نسخ</button>' +
            '<a class="btn btn-sm" target="_blank" href="https://wa.me/?text=' + encodeURIComponent('انضم لعائلتنا عبر هذا الرابط: ' + link) + '">🟢 واتساب</a>' +
          '</div>' : '') +
      '</div>';
    }).join('');
    const { invitations: updated } = await api('GET', '/api/family/invitations');
    state.invites = updated; updateInvitations();
    showToast('📨 تم إرسال الدعوات!', 'success');
  } catch(e) { showToast(e.message || 'فشل الإرسال', 'error'); }
}

// Invite by phone -> WhatsApp (from founder's own WhatsApp)
async function inviteByWhatsApp() {
  const phone = document.getElementById('invite-phone')?.value.trim() || '';
  if (!phone) return showToast('أدخل رقم جوال العضو', 'error');
  try {
    const result = await api('POST', '/api/family/invite-phone', { phone });
    const box = document.getElementById('invite-wa-result');
    if (box) {
      box.innerHTML = '<div class="invite-result success">✅ تم تجهيز الدعوة لرقم ' + result.phone +
        '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<a class="btn btn-success btn-sm" style="flex:1" target="_blank" rel="noopener" href="' + result.waLink + '">📤 أرسل الآن عبر واتساب</a>' +
          '<button class="btn btn-sm" onclick="copyText(\'' + result.inviteUrl + '\')">📋 نسخ الرابط</button>' +
        '</div></div>';
    }
    showToast('📱 افتح واتساب وأرسل الدعوة', 'success');
    // Also refresh invitations list
    try {
      const { invitations } = await api('GET', '/api/family/invitations');
      state.invites = invitations; updateInvitations();
    } catch(e) {}
  } catch(e) { showToast(e.message, 'error'); }
}
function copyText(text) {
  if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => showToast('📋 تم النسخ', 'success')).catch(()=>{}); }
  else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('📋 تم النسخ', 'success'); }
}

// ==================== CHALLENGES ====================
async function sendChallenge() {
  const gameType = document.getElementById('challenge-game-type').value;
  const opponent = document.getElementById('challenge-opponent').value;
  const points = parseInt(document.getElementById('challenge-points').value) || 10;
  if (!opponent) return showToast('اختر خصماً', 'error');
  try {
    await api('POST', '/api/challenges/create', { gameType, opponentId: opponent, points });
    showToast('⚔️ تم إرسال التحدي!', 'success');
    refreshData();
  } catch(e) { showToast(e.message || 'فشل', 'error'); }
}

async function acceptChallenge(id) {
  try { await api('POST', '/api/challenges/respond/' + id, { accept: true }); showToast('🎉 قبلت التحدي!', 'success'); refreshData(); }
  catch(e) { showToast(e.message, 'error'); }
}
async function rejectChallenge(id) {
  try { await api('POST', '/api/challenges/respond/' + id, { accept: false }); showToast('تم الرفض'); refreshData(); }
  catch(e) { showToast(e.message, 'error'); }
}

function startGame(type) { showToast('🎮 اختر خصماً من التحديات', 'success'); navigateTo('games'); }

function updateOpponentSelect() {
  const select = document.getElementById('challenge-opponent'); if (!select) return;
  select.innerHTML = '<option value="">اختر عضواً</option>';
  (state.members || []).filter(m => m.id !== state.user?.id).forEach(m => {
    select.innerHTML += '<option value="' + m.id + '">' + (m.name || '') + '</option>';
  });
}

// ==================== UI UPDATES ====================
// فتح الملف العام لعضو (الاسم، المستوى، النقاط، رمز العضو فقط)
async function openMemberProfile(memberOrId) {
  let m = memberOrId;
  if (typeof m === 'string') {
    m = (state.members || []).find(x => x.id === m);
    if (!m) {
      try {
        const r = await api('GET', '/api/members/public/' + memberOrId);
        m = r.profile;
      } catch(e) { return showToast(e.message || 'لا يمكن عرض الملف', 'error'); }
    }
  }
  if (!m) return showToast('العضو غير موجود', 'error');
  document.getElementById('mp-avatar').textContent = m.avatar || m.name?.charAt(0) || '👤';
  document.getElementById('mp-name').innerHTML = (m.name || '') + verifBadge(m.role === 'founder' ? (m.family_verif || 'none') : 'none', 20);
  document.getElementById('mp-role').textContent = m.role === 'founder' ? 'المؤسس 👑' : (m.role === 'admin' ? 'مدير التطبيق 🛡️' : (m.role === 'moderator' ? 'مشرف الديوانيات 🕵️' : 'عضو'));
  const lv = parseInt(m.level) || 0;
  document.getElementById('mp-level').innerHTML = (lv >= 0 && lv <= 100) ? levelImgHtml(lv) : ('Lv ' + lv);
  document.getElementById('mp-points').textContent = (parseInt(m.points) || 0).toLocaleString('en');
  document.getElementById('mp-public-id').textContent = m.public_id || '------';
  document.getElementById('member-profile-modal').style.display = 'flex';
}

// جعل الاسم قابلاً للضغط لفتح الملف
function clickableName(name, userId, verif) {
  const onclk = userId ? ' onclick="event.stopPropagation();openMemberProfile(\'' + userId + '\')" style="cursor:pointer"' : '';
  return '<span class="member-name-link"' + onclk + ' title="عرض الملف">' + (name || '') + '</span>' + verifBadge(verif, 17);
}

function updateMembersList() {
  const list = document.getElementById('members-list');
  if (!state.members?.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-text">لا يوجد أعضاء</div></div>';
    document.getElementById('members-count').textContent = '0'; return;
  }
  document.getElementById('members-count').textContent = state.members.length;
  const onlineIds = state.onlineMembers || [];
  const famVerif = state.family?.verif_tier || 'none';
  list.innerHTML = state.members.map(m => {
    const isOnline = onlineIds.includes(m.id);
    return '<div class="member-item"><div class="member-avatar">' + (m.avatar || m.name?.charAt(0) || '👤') +
    '</div><div class="member-info"><div class="member-name">' + clickableName(m.name, m.id, (m.role === 'founder' && famVerif !== 'none') ? famVerif : 'none') +
    '<span class="online-status ' + (isOnline ? 'online' : 'offline') + '">' + (isOnline ? '● متصل الآن' : '○ غير متصل') + '</span></div>' +
    (m.role === 'founder' ? '<span class="member-role-tag">المؤسس</span>' : '') + '</div></div>';
  }).join('');
}

// Load online status for family members
async function loadOnlineStatus() {
  if (!state.family?.id) return;
  try {
    const { online } = await api('GET', '/api/family/online');
    state.onlineMembers = online || [];
    updateMembersList();
  } catch(e) {}
}

function copyInviteLink(btn) {
  const input = btn?.previousElementSibling;
  if (!input?.value) return;
  if (navigator.clipboard) { navigator.clipboard.writeText(input.value).then(() => showToast('📋 تم نسخ الرابط', 'success')).catch(() => selectCopy(input)); }
  else selectCopy(input);
}
function selectCopy(input) {
  input.select(); input.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); showToast('📋 تم نسخ الرابط', 'success'); } catch(e) {}
}

function updateInvitations() {
  const list = document.getElementById('invitations-list');
  if (!state.invites?.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد دعوات</div></div>'; return;
  }
  list.innerHTML = state.invites.map(inv => {
    const link = inv.token ? location.origin + '/invite?token=' + inv.token : '';
    const statusLabel = inv.status === 'accepted' ? '✅ مقبولة' : '⏳ معلقة';
    return '<div class="invitation-item">' +
      '<div class="invitation-info"><div class="invitation-email">' + (inv.email || '') +
      '</div><small class="invited-by">بواسطة ' + (inv.invited_by_name || '') + '</small></div>' +
      '<span class="invitation-status ' + (inv.status || 'pending') + '">' + statusLabel + '</span>' +
      (inv.status !== 'accepted' && link ?
        '<button class="btn btn-sm btn-accent" style="margin-top:6px" onclick="copyInviteLink(this)">📋 نسخ رابط الدعوة</button>' : '') +
    '</div>';
  }).join('');
}

function updateChallenges() {
  renderRecentChallenges();
  renderPendingChallenges();
  renderAllChallenges();
}

function renderRecentChallenges() {
  const container = document.getElementById('recent-challenges-list');
  const recent = (state.challenges || []).slice(0, 5);
  if (!recent.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد تحديات</div></div>'; return;
  }
  const labels = { pending:'معلق', accepted:'مقبول', completed:'مكتمل', rejected:'مرفوض', cancelled:'ملغي' };
  container.innerHTML = recent.map(c =>
    '<div class="challenge-item"><div class="challenge-info"><div class="challenge-title">' + (c.game_type || c.gameType || 'تحدي') +
    '</div><div class="challenge-meta">' + (c.opponent_name || '') + ' · ' + (c.points || 0) + ' نقطة</div></div>' +
    '<span class="challenge-status ' + (c.status || 'pending') + '">' + (labels[c.status] || c.status) + '</span></div>'
  ).join('');
}

function renderPendingChallenges() {
  const container = document.getElementById('pending-challenges-list');
  const pending = (state.pendingChallenges || []);
  if (!pending.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد تحديات معلقة</div></div>'; return;
  }
  container.innerHTML = pending.map(c =>
    '<div class="challenge-item"><div class="challenge-info"><div class="challenge-title">' + (c.game_type || c.gameType || 'تحدي') +
    '</div><div class="challenge-meta">من ' + (c.challenger_name || '') + ' · ' + (c.points || 0) + ' نقطة</div></div>' +
    '<div class="challenge-actions"><button class="btn btn-success btn-sm" onclick="acceptChallenge(\'' + c.id + '\')">✓ قبول</button>' +
    '<button class="btn btn-danger btn-sm" onclick="rejectChallenge(\'' + c.id + '\')">✕ رفض</button></div></div>'
  ).join('');
}

function renderAllChallenges() {
  const container = document.getElementById('all-challenges-table');
  const all = state.challenges || [];
  if (!all.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد تحديات</div></div>'; return;
  }
  const labels = { pending:'معلق', accepted:'مقبول', completed:'مكتمل', rejected:'مرفوض', cancelled:'ملغي' };
  container.innerHTML = all.map(c =>
    '<div class="challenge-item"><div class="challenge-info"><div class="challenge-title">' + (c.game_type || c.gameType || 'تحدي') +
    '</div><div class="challenge-meta">' + (c.challenger_name || '') + ' ← ' + (c.opponent_name || '') + ' · ' + (c.points || 0) + ' نقطة</div></div>' +
    '<span class="challenge-status ' + (c.status || 'pending') + '">' + (labels[c.status] || c.status) + '</span></div>'
  ).join('');
}

function updateLeaderboard() {
  const tbody = document.getElementById('leaderboard-body');
  const data = state.leaderboard || [];
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px">لا توجد بيانات</td></tr>'; return;
  }
  tbody.innerHTML = data.map((item, i) => {
    let rc = 'lb-rank';
    if (i === 0) rc += ' gold'; else if (i === 1) rc += ' silver'; else if (i === 2) rc += ' bronze';
    const init = item.name?.charAt(0) || '👤';
    return '<tr><td><span class="' + rc + '">' + (i+1) + '</span></td>' +
      '<td><div class="lb-player"><div class="lb-avatar">' + init + '</div><span class="lb-name">' + (item.name || '') + '</span></div></td>' +
      '<td class="lb-points">' + (item.points || 0) + '</td><td>' + (item.wins || 0) + '</td><td>' + (item.total_games || 0) + '</td></tr>';
  }).join('');
}

// ==================== DIWANIYA TIMER ====================
function startDiwaniyaTimer(minutes) {
  state.diwaniyaRemaining = minutes * 60;
  const timer = document.getElementById('timer-display');
  const num = document.getElementById('timer-num');
  timer.className = 'timer-display active';
  document.querySelector('#timer-display .timer-label').textContent = 'الديوانية مفتوحة';
  if (state.diwaniyaTimer) clearInterval(state.diwaniyaTimer);
  state.diwaniyaTimer = setInterval(() => {
    state.diwaniyaRemaining--;
    const m = Math.floor(state.diwaniyaRemaining / 60);
    const s = state.diwaniyaRemaining % 60;
    num.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    if (state.diwaniyaRemaining <= 60) timer.className = 'timer-display warning';
    if (state.diwaniyaRemaining <= 0) {
      clearInterval(state.diwaniyaTimer); state.diwaniyaTimer = null;
      state.diwaniyaOpen = false;
      document.getElementById('diwaniya-toggle-btn').textContent = '🔓 فتح الديوانية';
      timer.className = 'timer-display idle';
      num.textContent = '--:--';
      document.querySelector('#timer-display .timer-label').textContent = 'انتهت الجلسة';
      enableChat(false);
      showToast('انتهت الجلسة');
      refreshData();
    }
  }, 1000);
}

function stopDiwaniyaTimer() {
  if (state.diwaniyaTimer) { clearInterval(state.diwaniyaTimer); state.diwaniyaTimer = null; }
  const timer = document.getElementById('timer-display');
  timer.className = 'timer-display idle';
  document.getElementById('timer-num').textContent = '--:--';
  document.querySelector('#timer-display .timer-label').textContent = 'الديوانية مغلقة';
}

function enableChat(enabled) {
  const input = document.getElementById('chat-input-field');
  const btn = document.getElementById('chat-send-btn');
  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled;
}

function addChatMessage(name, text, isSent, avatar, level, verif, userId) {
  const room = document.getElementById('chat-room');
  if (!room) return;
  const empty = room.querySelector('.empty-state');
  if (empty) room.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isSent ? ' sent' : '');
  msg.avatar = avatar;
  msg.dataset.userId = userId || '';
  const initial = name?.charAt(0) || '👤';
  const time = new Date().toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });
  const badges = levelImgHtml(level) + verifBadge(verif, 17);
  msg.innerHTML = '<div class="chat-avatar">' + initial + '</div><div>' +
    '<div class="chat-sender">' + clickableName(name, userId, verif) + ' ' + levelImgHtml(level) + '</div>' +
    '<div class="chat-bubble">' + text +
    '</div><div class="chat-time">' + time + '</div></div>';
  room.appendChild(msg);
  room.scrollTop = room.scrollHeight;
}

// ==================== AUDIO RECORDING ====================
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let isRecording = false;

function setupChatMode(mode) {
  const chatInput = document.querySelector('.chat-input');
  const chatRoom = document.getElementById('chat-room');
  const liveAudioSection = document.getElementById('live-audio-section');
  if (!chatInput) return;

  // Mode indicator
  let modeLabel = document.getElementById('diwaniya-mode-label');
  if (!modeLabel) {
    modeLabel = document.createElement('div');
    modeLabel.id = 'diwaniya-mode-label';
    modeLabel.className = 'mode-indicator';
    if (chatRoom?.parentNode) chatRoom.parentNode.insertBefore(modeLabel, chatRoom);
  }
  const labels = { text: '✍️ الديوانية كتابية', audio: '🎤 الديوانية صوتية - بث مباشر', video: '🎥 بث فيديو - حد أقصى 6', both: '📝🎤 كتابية + صوتية', all: '📝🎥🎤 كل شي' };
  modeLabel.textContent = labels[mode] || '✍️ الديوانية';

  // Show/hide live video section
  if (liveAudioSection) {
    liveAudioSection.style.display = (mode === 'audio' || mode === 'video' || mode === 'both' || mode === 'all') ? 'block' : 'none';
  }

  if (mode === 'audio') {
    // Audio only - hide text input, show mic button
    chatInput.innerHTML = `
      <button class="btn btn-primary mic-btn" id="mic-btn" onclick="toggleRecording()">🎤 اضغط للتسجيل</button>
      <div class="recording-status" id="recording-status" style="display:none">
        <span class="rec-dot"></span> جاري التسجيل... <span id="rec-timer">00:00</span>
      </div>
      <audio id="audio-preview" controls style="display:none;width:100%;margin-top:8px"></audio>
    `;
    document.getElementById('chat-input-field')?.remove();
    document.getElementById('chat-send-btn')?.remove();
  } else if (mode === 'video') {
    // فيديو: الدردشة النصية تبقى ظاهرة (بجانب المكالمة)
    chatInput.innerHTML = `
      <input class="form-input" id="chat-input-field" type="text" placeholder="اكتب رسالتك...">
      <button class="btn btn-primary" id="chat-send-btn" onclick="sendChat()">إرسال</button>
    `;
    enableChat(true);
  } else if (mode === 'both' || mode === 'all') {
    // Both - keep text input + add mic button
    const sendBtn = chatInput.querySelector('#chat-send-btn');
    chatInput.innerHTML = `
      <input class="form-input" id="chat-input-field" type="text" placeholder="اكتب رسالتك...">
      <button class="btn btn-primary" id="chat-send-btn" onclick="sendChat()">إرسال</button>
      <button class="btn-mic-small" id="mic-small-btn" onclick="toggleRecording()" title="تسجيل صوتي">🎤</button>
    `;
    enableChat(true);
  } else {
    // Text only
    chatInput.innerHTML = `
      <input class="form-input" id="chat-input-field" type="text" placeholder="اكتب رسالتك...">
      <button class="btn btn-primary" id="chat-send-btn" onclick="sendChat()">إرسال</button>
    `;
    enableChat(true);
  }
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
    return;
  }
  
  if (!navigator.mediaDevices?.getUserMedia) {
    return showToast('التسجيل الصوتي غير مدعوم في متصفحك', 'error');
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      sendAudioMessage(audioBlob);
      if (audioStream) { audioStream.getTracks().forEach(t => t.stop()); audioStream = null; }
    };

    mediaRecorder.start();
    isRecording = true;
    
    const micBtn = document.getElementById('mic-btn') || document.getElementById('mic-small-btn');
    const status = document.getElementById('recording-status');
    if (micBtn) micBtn.textContent = '⏹️ إيقاف';
    if (micBtn) micBtn.style.background = 'var(--danger)';
    if (status) status.style.display = 'flex';
    
    // Start timer
    let sec = 0;
    state.recTimer = setInterval(() => {
      sec++;
      const t = document.getElementById('rec-timer');
      if (t) t.textContent = String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0');
      if (sec >= 180) { // 3 min max
        stopRecording();
        showToast('الحد الأقصى 3 دقائق للتسجيل');
      }
    }, 1000);
    
    showToast('🎤 جاري التسجيل...');
  } catch (e) {
    showToast('الرجاء السماح بالميكروفون', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    const micBtn = document.getElementById('mic-btn') || document.getElementById('mic-small-btn');
    if (micBtn) { micBtn.textContent = '🎤 اضغط للتسجيل'; micBtn.style.background = ''; }
    const status = document.getElementById('recording-status');
    if (status) status.style.display = 'none';
    if (state.recTimer) { clearInterval(state.recTimer); state.recTimer = null; }
  }
}

function sendAudioMessage(blob) {
  if (!dwGlobal.audio_enabled && state.user?.role !== 'admin') {
    return showToast('🎤 خاصية الصوت معطلة حالياً من إدارة التطبيق', 'error');
  }
  const reader = new FileReader();
  reader.onload = function() {
    const base64Audio = reader.result.split(',')[1];
    const audioMsg = {
      sessionId: state.activeSession.id,
      userId: state.user.id,
      message: '🎤 [رسالة صوتية]',
      audio: base64Audio,
      audioType: blob.type,
    };
    
    if (socket?.connected) {
      socket.emit('diwaniya_audio', audioMsg);
    }
    
    // Show in local chat
    addAudioMessage(state.user?.name || 'أنت', base64Audio, blob.type, true, state.user?.role === 'founder' ? (state.family?.verif_tier || 'none') : 'none');
  };
  reader.readAsDataURL(blob);
}

function addAudioMessage(name, audioBase64, audioType, isSent, verif) {
  const room = document.getElementById('chat-room');
  if (!room) return;
  const empty = room.querySelector('.empty-state');
  if (empty) room.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isSent ? ' sent' : '');
  const initial = name?.charAt(0) || '👤';
  const dataSrc = 'data:' + audioType + ';base64,' + audioBase64;
  
  msg.innerHTML = '<div class="chat-avatar">' + initial + '</div><div>' +
    '<div class="chat-sender">' + (name || '') + ' ' + verifBadge(verif, 17) + '</div>' +
    '<div class="audio-bubble"><audio controls src="' + dataSrc + '" style="height:40px;max-width:220px"></audio></div>' +
    '<div class="chat-time">' + new Date().toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) + '</div></div>';
  room.appendChild(msg);
  room.scrollTop = room.scrollHeight;
}

// ==================== LIVE AUDIO CALL (WebRTC) ====================
let localStream = null;
let peerConnections = {};
let inLiveCall = false;
let peerAvatars = {};
let peerLevels = {};

// TikTok-style entry banner (shows for ~5s when a member enters)
let entryBannerTimer = null;
// ألوان المستويات (نمط تيك توك): كل نطاق مستوى بلون مميز
function levelThemeColor(level) {
  const lv = parseInt(level) || 0;
  if (lv >= 90) return { c1: '#ffd700', c2: '#ff2d95', c3: '#00e5ff' };   // أسطوري
  if (lv >= 80) return { c1: '#ffd700', c2: '#ff9d00', c3: '#fff3b0' };   // ذهبي
  if (lv >= 70) return { c1: '#ff6b35', c2: '#ff2d55', c3: '#ffd700' };   // ناري
  if (lv >= 60) return { c1: '#ff2d55', c2: '#c026d3', c3: '#ff6b6b' };   // أحمر
  if (lv >= 50) return { c1: '#ff2d95', c2: '#a855f7', c3: '#ffb6d9' };   // وردي
  if (lv >= 40) return { c1: '#a855f7', c2: '#6366f1', c3: '#d8b4fe' };   // بنفسجي
  if (lv >= 30) return { c1: '#3b82f6', c2: '#06b6d4', c3: '#93c5fd' };   // أزرق
  if (lv >= 20) return { c1: '#06b6d4', c2: '#10b981', c3: '#67e8f9' };   // سماوي
  if (lv >= 10) return { c1: '#10b981', c2: '#84cc16', c3: '#86efac' };   // أخضر
  return { c1: '#94a3b8', c2: '#64748b', c3: '#e2e8f0' };                 // رمادي
}

function showEntryBanner(name, avatar, subText, level) {
  const banner = document.getElementById('entry-banner');
  if (!banner) return;
  const lv = parseInt(level) || 0;
  const theme = levelThemeColor(lv);
  // لون الشارة حسب مستوى الداخل
  banner.style.setProperty('--eb-c1', theme.c1);
  banner.style.setProperty('--eb-c2', theme.c2);
  banner.style.setProperty('--eb-c3', theme.c3);
  const nameEl = document.getElementById('entry-name');
  const subEl = document.getElementById('entry-sub');
  const avEl = document.getElementById('entry-avatar');
  const lvEl = document.getElementById('entry-level');
  if (nameEl) nameEl.textContent = name || 'عضو';
  if (subEl) subEl.textContent = subText || 'انضم للديوانية 🎉';
  if (lvEl) {
    lvEl.innerHTML = levelImgHtml(lv) +
      '<span class="eb-level-num">المستوى ' + lv + '</span>';
  }
  if (avEl) {
    avEl.innerHTML = (avatar && avatar.startsWith('data:'))
      ? '<img src="' + avatar + '" alt="">'
      : (avatar || '👤');
  }
  banner.style.display = 'flex';
  banner.classList.remove('show');
  void banner.offsetWidth; // restart animation
  banner.classList.add('show');
  if (entryBannerTimer) clearTimeout(entryBannerTimer);
  entryBannerTimer = setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => { banner.style.display = 'none'; }, 800);
  }, 5000);
}

// دعم الجلسة: { userId -> كونزات الهدايا التي استقبلها } لترتيب الأكثر دعماً أولاً
let sessionGiftCoins = {};
// Presence: members currently in the call - دوائر (أول 3 دخولاً، والأكثر دعماً يتقدم)
function updateCallPresence() {
  const countEl = document.getElementById('call-count');
  if (countEl) countEl.textContent = (Object.keys(state.callMembers || {}).length + 1);
  const list = document.getElementById('call-participants');
  if (!list) return;
  // الترتيب: الأكثر دعماً أولاً، ثم ترتيب الدخول
  const entries = Object.entries(state.callMembers || {});
  entries.sort((a, b) => (sessionGiftCoins[b[0]] || 0) - (sessionGiftCoins[a[0]] || 0));
  const all = [{ id: state.user?.id || 'me', name: 'أنت', avatar: state.user?.avatar || '👤', self: true }].concat(
    entries.map(([id, name]) => {
      const m = (state.members || []).find(mm => mm.id === id);
      return { id, name, avatar: m?.avatar || peerAvatars[id] || '👤', self: false };
    })
  );
  const visible = all.slice(0, 3);
  const rest = all.length - 3;
  list.innerHTML = visible.map(p => {
    const ava = p.avatar || '';
    const av = (ava.startsWith('data:') || ava.startsWith('http') || ava.startsWith('/')) ? '<img src="' + ava + '">' : (ava && ava.length <= 4 ? ava : '👤');
    const supported = !p.self && (sessionGiftCoins[p.id] || 0) > 0;
    const isHost = state.isFounder || state.user?.role === 'admin';
    // شارة كتم المايك على دائرة صاحب البث (أعلى اليمين)
    const muteBadge = p.self && micMuted ? '<span class="mic-muted-badge">🎤✕</span>' : '';
    return '<div class="call-participant"><div class="call-avatar-circle' + (p.self ? ' self' : '') + (supported ? ' supported' : '') + '" ' +
      (isHost && !p.self ? 'onclick="memberCircleAction(\'' + p.id + '\',\'' + p.name.replace(/'/g, '') + '\')"' : '') +
      ' title="' + p.name + '">' + av + muteBadge + '<span class="ca-name">' + p.name + '</span></div></div>';
  }).join('') + (rest > 0 ? '<div class="call-more" title="' + rest + ' آخرون">+' + rest + '</div>' : '');
  updateTikTokViewers();
}

// قائمة المشاهدين على يمين البث (نمط تيك توك)
function updateTikTokViewers() {
  const box = document.getElementById('tt-viewers');
  if (!box) return;
  if (!inLiveCall) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  const names = state.callMembers || {};
  const entries = Object.entries(names);
  const me = { id: state.user?.id, name: 'أنت', avatar: state.user?.avatar };
  const mems = (state.members || []);
  const others = entries.map(([id, name]) => {
    const m = mems.find(mm => mm.id === id);
    return { id, name, avatar: m?.avatar || peerAvatars[id] || '👤' };
  });
  const list = [me].concat(others);
  const visible = list.slice(0, 5);
  const rest = list.length - 5;
  const ava = (a) => (a || '').startsWith('data:') || (a || '').startsWith('http') || (a || '').startsWith('/')
    ? '<img src="' + a + '">' : ((a && a.length <= 4) ? a : '👤');
  box.innerHTML = visible.map(p =>
    '<div class="tt-viewer-chip" title="' + p.name + '">' + ava(p.avatar) + '</div>'
  ).join('') + (rest > 0 ? '<div class="tt-viewers-more" title="+' + rest + '">+' + rest + '</div>' : '');
}

// قائمة المشاهدين الكاملة (نقرة على الأفاتارات)
function openTikTokViewersList() {
  const names = state.callMembers || {};
  const entries = Object.entries(names);
  const list = [{ id: state.user?.id, name: 'أنت (أنت)' }].concat(entries.map(([id, n]) => ({ id, name: n })));
  const isHost = state.isFounder || state.user?.role === 'admin';
  const html = list.map(p => {
    const act = (isHost && p.id !== state.user?.id)
      ? '<button class="btn btn-sm btn-danger" style="padding:2px 10px" onclick="memberCircleAction(\'' + p.id + '\',\'' + String(p.name).replace(/'/g, '') + '\')">🚫</button>'
      : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08)">' +
      '<span style="font-weight:700">' + p.name + '</span>' + act + '</div>';
  }).join('');
  showModal('👥 المشاهدون (' + list.length + ')', html);
}
function showModal(title, body) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = '<div class="modal-box" style="max-width:320px">' +
    '<h3 style="color:var(--gold);margin-bottom:8px">' + title + '</h3>' +
    '<div style="max-height:50vh;overflow-y:auto">' + body + '</div>' +
    '<button class="btn btn-secondary btn-full" style="margin-top:10px" onclick="this.closest(\'.modal-overlay\').remove()">إغلاق</button></div>';
  document.body.appendChild(ov);
}
// المضيف: الضغط على دائرة عضو = طرد / تقييد
function memberCircleAction(id, name) {
  const act = confirm('👤 ' + name + '\n\n✅ موافق = طرد من الديوانية\n❌ إلغاء = رجوع');
  if (act) kickFromDiwaniya(id);
}

// ==================== CALL CONTROLS ====================
let micMuted = false;
let camOff = false;

// تبديل الكاميرا (أمامية/خلفية) - تعمل الآن
async function flipCamera() {
  if (!localStream) return showToast('ادخل البث أولاً', 'error');
  state.cameraFacing = state.cameraFacing === 'environment' ? 'user' : 'environment';
  try {
    const newVideo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const videoTrack = newVideo.getVideoTracks()[0];
    localStream.getVideoTracks().forEach(t => { try { localStream.removeTrack(t); t.stop(); } catch(e) {} });
    localStream.addTrack(videoTrack);
    const myVideo = document.getElementById('my-video');
    if (myVideo) myVideo.srcObject = localStream;
    // إعادة إرسال المسار الجديد للجميع
    Object.values(peerConnections).forEach(pc => {
      const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (s) s.replaceTrack(videoTrack).catch(() => {});
    });
    // إعادة تطبيق الفلتر إن كان مفعلاً
    if (activeFilter) applyFilterToFeed(activeFilter);
    showToast('🔄 بدلت الكاميرا (' + (state.cameraFacing === 'environment' ? 'خلفية' : 'أمامية') + ')', 'success');
  } catch(e) { showToast('فشل تبديل الكاميرا: ' + (e.message || ''), 'error'); }
}

function toggleMic() {
  if (!localStream) return;
  micMuted = !micMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
  const btn = document.getElementById('mic-toggle-btn');
  if (btn) {
    btn.classList.toggle('muted', micMuted);
    btn.classList.toggle('off', micMuted);
  }
  // Show state on my tile
  const tileState = document.getElementById('my-tile-state');
  if (tileState) {
    tileState.textContent = micMuted ? '🔇 كتم المايك' : '';
    tileState.classList.toggle('muted-state', micMuted);
  }
  showToast(micMuted ? '🔇 كتمت المايك - ما يسمعونك' : '🎤 فتحت المايك', micMuted ? 'error' : 'success');
  const barMicIco = document.getElementById('tt-bar-mic-ico');
  if (barMicIco) barMicIco.textContent = micMuted ? '🔇' : '🎤';
  const barMicLbl = document.getElementById('tt-bar-mic-label');
  if (barMicLbl) barMicLbl.textContent = micMuted ? 'مكتوم' : 'صوت';
  updateCallPresence();
}


function refreshCamOffOverlay() {
  const myTile = document.getElementById('my-video-tile');
  if (!myTile) return;
  myTile.classList.toggle('has-video', !camOff);
  const av = (typeof state !== 'undefined' && state?.user) ? (state.user.avatar || '') : '';
  const isImg = av.startsWith('data:') || av.startsWith('http') || av.startsWith('/');
  let overlay = myTile.querySelector('.cam-off-overlay');
  if (camOff) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'cam-off-overlay';
      myTile.appendChild(overlay);
    }
    // إعادة بناء دائمة: الصورة المختارة تملأ المربع بدل الكاميرا
    overlay.innerHTML = isImg
      ? '<img class="cam-off-img" src="' + av + '" alt="">' +
        '<div class="cam-off-chip">🚫 كاميرا مغلقة</div>'
      : '<div class="cam-off-circle">' + avatarHtml(av) + '</div><div class="cam-off-icon">🚫</div><div class="cam-off-label">كاميرا مغلقة</div>';
    overlay.style.display = 'flex';
  } else if (overlay) {
    overlay.style.display = 'none';
  }
}

function toggleCamera() {
  if (!localStream) return;
  camOff = !camOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !camOff);
  // Notify server (keeps the live camera count accurate)
  if (socket?.connected && state.activeSession?.id) {
    socket.emit('camera_state', { sessionId: state.activeSession.id, on: !camOff });
  }
  const btn = document.getElementById('cam-toggle-btn');
  const myVideo = document.getElementById('my-video');
  if (btn) {
    btn.classList.toggle('off', camOff);
  }
  if (myVideo) {
    myVideo.style.display = camOff ? 'none' : 'block';
    if (!camOff && !myVideo.srcObject) myVideo.srcObject = localStream;
  }
  refreshCamOffOverlay();
  const tileState = document.getElementById('my-tile-state');
  if (tileState) {
    tileState.textContent = '';
    if (!micMuted) tileState.classList.remove('muted-state');
  }
  showToast(camOff ? '🚫 أغلقت الكاميرا - يسمعونك فقط' : '🎥 فتحت الكاميرا', camOff ? 'error' : 'success');
  const barCamIco = document.getElementById('tt-bar-cam-ico');
  if (barCamIco) barCamIco.textContent = camOff ? '🚫' : '📷';
  const barCamLbl = document.getElementById('tt-bar-cam-label');
  if (barCamLbl) barCamLbl.textContent = camOff ? 'مغلقة' : 'كاميرا';
}

// ==================== مشاركة الشاشة (المؤسس يبث مباراة/مسلسل) ====================
let screenShareStream = null;
let screenShareActive = false;
let screenWasCamOff = false;
let remoteScreenShare = {};   // peerId -> true إذا يشارك شاشته
let screenRotation = {};      // peerId/'me' -> 0/90/180/270

function screenVideoEl(peerId) {
  if (peerId === 'me') return document.getElementById('my-video');
  const tile = document.getElementById('video-' + peerId);
  return tile ? tile.querySelector('video') : null;
}
function screenTileEl(peerId) {
  if (peerId === 'me') return document.getElementById('my-video-tile');
  return document.getElementById('video-' + peerId);
}
function applyScreenRotation(peerId) {
  const v = screenVideoEl(peerId);
  if (!v) return;
  const deg = screenRotation[peerId] || 0;
  const mirror = (peerId === 'me' && !screenShareActive);
  v.style.transform = deg ? (mirror ? 'scaleX(-1) rotate(' + deg + 'deg)' : 'rotate(' + deg + 'deg)') : '';
}
// 🔄 تدوير الشاشة (بالعرض/طول/مقلوب) — لكل مشاهد
function screenRotateBtn(peerId) {
  screenRotation[peerId] = ((screenRotation[peerId] || 0) + 90) % 360;
  applyScreenRotation(peerId);
}
// ⛶ تكبير الشاشة بالملء
function screenFullscreenBtn(peerId) {
  const tile = screenTileEl(peerId);
  if (!tile) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else tile.requestFullscreen().catch(() => showToast('التكبير غير مدعوم هنا', 'error'));
}

// إعادة تفاوض مع طرف واحد (عند إضافة مسار فيديو لاحقاً — مثل حالة انضمام بصوت فقط)
async function renegotiatePeer(peerId) {
  const pc = peerConnections[peerId];
  if (!pc || pc.signalingState !== 'stable') return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('audio_offer', {
      to: peerId, offer: pc.localDescription,
      sessionId: state.activeSession?.id,
      userName: state.user?.name, fromUserId: state.user?.id
    });
  } catch(e) {}
}

// نافذة توضيح لعدم دعم مشاركة الشاشة (الآيفون — قيد من أبل)
function showScreenUnsupportedModal() {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.style.display = 'flex';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div class="modal-box" style="max-width:330px;text-align:center">' +
      '<div style="font-size:44px;margin-bottom:6px">📱🚫</div>' +
      '<h3 style="margin-bottom:8px">مشاركة الشاشة لا تعمل على الآيفون</h3>' +
      '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">كروم الآيفون بنفس محرك سفاري — <b>أبل تمنع مشاركة الشاشة من المتصفح على الآيفون</b> (قيد تقني لا يمكن تجاوزه).</p>' +
      '<p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">لبث المباراة/المسلسل استخدم:<br>🖥️ <b>كمبيوتر</b> (كروم/إيدج) أو 📱 <b>جوال أندرويد</b></p>' +
      '<button class="btn btn-accent" style="width:100%" onclick="this.closest(\'.modal-overlay\').remove()">فهمت 👍</button>' +
    '</div>';
  document.body.appendChild(ov);
}

async function toggleScreenShare() {
  // تنبيه فوري عند أي ضغطة — لا صمت أبداً
  showToast('🖥️ جارٍ تجهيز مشاركة الشاشة...', 'success');
  sendDiag('share_press', { inLive: !!inLiveCall, hasStream: !!localStream, founder: state?.isFounder, role: state?.user?.role, gdm: typeof (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia), secure: !!window.isSecureContext });
  const isHost = state.isFounder || state.user?.role === 'admin';
  if (!isHost) return showToast('مشاركة الشاشة للمؤسس فقط', 'error');
  if (!localStream || !inLiveCall) return showToast('ادخل البث أولاً', 'error');
  if (screenShareActive) { stopScreenShare(false); return; }
  // دعم المتصفح: الآيفون/سفاري لا يدعم مشاركة الشاشة — نافذة واضحة لا تُفوَّت
  if (!window.isSecureContext) return showToast('مشاركة الشاشة تحتاج اتصالاً آمناً (HTTPS)', 'error');
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    sendDiag('share_unsupported_device', {});
    showScreenUnsupportedModal();
    return;
  }
  showToast('📡 فتح نافذة المشاركة — اختر الشاشة أو التبويب', 'success');
  let sc = null;
  try {
    sc = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
    sendDiag('gdm_first_ok', { tracks: sc.getTracks().map(t => t.kind) });
  } catch(e1) {
    sendDiag('gdm_first_fail', { err: e1.name + ':' + e1.message });
    // بعض أجهزة أندرويد ترفض صوت الشاشة — نجرّب بدون صوت
    try {
      sc = await navigator.mediaDevices.getDisplayMedia({ video: true });
      sendDiag('gdm_retry_ok', {});
    } catch(e2) {
      sendDiag('gdm_retry_fail', { err: e2.name + ':' + e2.message });
      if (e2.name === 'AbortError' || e2.name === 'NotAllowedError') {
        return showToast('🚫 ألغيت مشاركة الشاشة', 'error');
      }
      showToast('فشل فتح مشاركة الشاشة: ' + (e2.message || e2.name || ''), 'error');
      return;
    }
  }
  screenShareStream = sc;
  screenShareActive = true;
  screenWasCamOff = camOff;
  try {
    const vid = sc.getVideoTracks()[0];
    const aud = sc.getAudioTracks()[0];
    // الشاشة تحل محل الكاميرا عند الإرسال للجميع
    localStream.getVideoTracks().forEach(t => { try { localStream.removeTrack(t); t.stop(); } catch(e) {} });
    localStream.addTrack(vid);
    // صوت المباراة/المسلسل يندمج مع المايك
    if (aud && !localStream.getAudioTracks().some(t => t.id === aud.id)) localStream.addTrack(aud);
    const myVideo = document.getElementById('my-video');
    if (myVideo) { myVideo.srcObject = localStream; myVideo.style.display = 'block'; }
    refreshCamOffOverlay();
    // إعادة توجيه المسار الجديد لكل المتصلين
    Object.entries(peerConnections).forEach(([pid, pc]) => {
      const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (s) {
        s.replaceTrack(vid).catch(() => {});
      } else {
        // لا يوجد باعث فيديو (المؤسس دخل بث صوتي) — نضيف المسار ونعيد التفاوض
        try { pc.addTrack(vid, localStream); renegotiatePeer(pid); } catch(e) {}
      }
    });
    if (socket?.connected && state.activeSession?.id) {
      socket.emit('screen_share_state', { sessionId: state.activeSession.id, active: true });
    }
    updateScreenShareUI();
    screenRotation['me'] = 0;
    applyScreenRotation('me');
    sendDiag('share_started', { vids: localStream.getVideoTracks().length });
    showToast('🖥️ أنت تشارك شاشتك الآن — العائلة تشاهد معك', 'success');
    // لو المستخدم أوقف المشاركة من نافذة المتصفح (Stop sharing)
    vid.addEventListener('ended', () => stopScreenShare(true));
    // كاشف المصدر الأسود: بعض الأندرويد يعطي فيديو أسود عند اختيار تبويب خاطئ
    setTimeout(() => {
      const mv = document.getElementById('my-video');
      if (screenShareActive && mv && mv.srcObject && (mv.videoWidth === 0 || !mv.videoWidth)) {
        sendDiag('screen_black_detected', { w: mv.videoWidth, h: mv.videoHeight });
        stopScreenShare(true);
        showToast('🖥️ المصدر المحدد يظهر أسود — اضغط زر الشاشة واختر (الشاشة كاملة) أو تبويب آخر', 'error');
      }
    }, 2500);
  } catch(e) {
    screenShareActive = false;
    try { sc.getTracks().forEach(t => t.stop()); } catch(e2) {}
    showToast('خطأ ببدء المشاركة: ' + (e.message || ''), 'error');
  }
}

async function stopScreenShare(auto) {
  const hadStream = !!screenShareStream;
  const wasCamOff = screenWasCamOff;
  screenShareActive = false;
  if (hadStream) {
    try {
      screenShareStream.getVideoTracks().forEach(t => t.stop());
      screenShareStream.getAudioTracks().forEach(t => { try { if (localStream) localStream.removeTrack(t); t.stop(); } catch(e) {} });
    } catch(e) {}
    screenShareStream = null;
  }
  try {
    // استعادة الكاميرا (إلا إذا كانت مغلقة قبل المشاركة)
    if (!wasCamOff) {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.cameraFacing || 'environment' } });
      const camTrack = cam.getVideoTracks()[0];
      localStream.getVideoTracks().forEach(t => { try { localStream.removeTrack(t); t.stop(); } catch(e) {} });
      localStream.addTrack(camTrack);
      Object.values(peerConnections).forEach(pc => {
        const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (s) s.replaceTrack(camTrack).catch(() => {});
      });
    } else {
      // كانت الكاميرا مغلقة: نوقف إرسال الفيديو تماماً
      localStream.getVideoTracks().forEach(t => { try { localStream.removeTrack(t); t.stop(); } catch(e) {} });
      Object.values(peerConnections).forEach(pc => {
        const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (s) s.replaceTrack(null).catch(() => {});
      });
    }
    if (socket?.connected && state.activeSession?.id) {
      socket.emit('screen_share_state', { sessionId: state.activeSession.id, active: false });
    }
    const myVideo = document.getElementById('my-video');
    if (myVideo) myVideo.srcObject = localStream;
    camOff = wasCamOff;
    if (myVideo) myVideo.style.display = camOff ? 'none' : 'block';
    refreshCamOffOverlay();
    screenRotation['me'] = 0;
    applyScreenRotation('me');
    updateScreenShareUI();
    sendDiag('share_stopped', { auto: !!auto });
    showToast(auto ? '🖥️ انتهت مشاركة الشاشة' : '🖥️ أوقفت مشاركة الشاشة — رجعت الكاميرا', 'success');
  } catch(e) {
    showToast('خطأ بإيقاف المشاركة: ' + (e.message || ''), 'error');
    updateScreenShareUI();
  }
}

function updateScreenShareUI() {
  const btn = document.getElementById('tt-bar-screen');
  const ico = document.getElementById('tt-bar-screen-ico');
  const lbl = document.getElementById('tt-bar-screen-label');
  if (btn) btn.classList.toggle('active-share', screenShareActive);
  if (ico) ico.textContent = screenShareActive ? '⏹️' : '🖥️';
  if (lbl) lbl.textContent = screenShareActive ? 'إيقاف' : 'شاشة';
  // أخفي زر الكاميرا أثناء المشاركة (الشاشة مكانها)
  const camBtn = document.getElementById('tt-bar-cam');
  const isHost = state.isFounder || state.user?.role === 'admin';
  if (camBtn) camBtn.style.display = screenShareActive ? 'none' : (isHost ? 'block' : 'none');
  // أدوات التدوير/التكبير على معاينتي
  const myTile = document.getElementById('my-video-tile');
  if (myTile) {
    myTile.classList.toggle('screen-active', screenShareActive);
    const c = myTile.querySelector('.screen-controls');
    if (c) c.style.display = screenShareActive ? 'flex' : 'none';
    const b = myTile.querySelector('.screen-badge');
    if (b) b.style.display = screenShareActive ? 'block' : 'none';
  }
}

// جانب المشاهد: شاشة المؤسس تكبر + أزرار تدوير وتكبير
function applyScreenShareToTile(peerId, active) {
  const tile = document.getElementById('video-' + peerId);
  if (!tile) return;
  tile.classList.toggle('screen-active', !!active);
  const controls = tile.querySelector('.screen-controls');
  if (controls) controls.style.display = active ? 'flex' : 'none';
  const badge = tile.querySelector('.screen-badge');
  if (badge) badge.style.display = active ? 'block' : 'none';
  if (!active) { screenRotation[peerId] = 0; applyScreenRotation(peerId); }
}

// ==================== 🎬 مشاهدة معاً (Watch Together) ====================
let watchTogether = null;       // { url, playing, time, byName }
let watchIsHost = false;
let watchYT = null;             // مشغل يوتيوب
let watchVideo = null;          // عنصر فيديو HTML5
let watchPosTimer = null;

function ytVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/') || u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
      return u.searchParams.get('v');
    }
  } catch (e) {}
  return null;
}

function loadYTIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  return new Promise((resolve) => {
    if (window.__ytApiLoading) return setTimeout(resolve, 9000);
    window.__ytApiLoading = true;
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
    setTimeout(resolve, 9000);
  });
}

function fmtTime(s) {
  s = Math.floor(s || 0);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

async function renderWatchPlayer(data) {
  watchTogether = { url: data.url, playing: !!data.playing, time: data.time || 0, byName: data.byName || '' };
  watchIsHost = !!(state.isFounder || state.user?.role === 'admin');
  const ov = document.getElementById('watch-player-overlay');
  const stage = document.getElementById('watch-stage');
  if (!ov || !stage) return;
  ov.style.display = 'block';
  // المقطع المرفوع يبدأ متوقفاً → زر تشغيل كبير واضح
  const bigPlay = document.getElementById('watch-big-play');
  const bigPlayLabel = document.getElementById('watch-big-play-label');
  if (bigPlay) bigPlay.style.display = data.playing ? 'none' : 'flex';
  if (bigPlayLabel) bigPlayLabel.style.display = data.playing ? 'none' : 'block';
  if (!data.playing && hint) hint.style.display = 'none';
  const hostEl = document.getElementById('watch-host');
  if (hostEl) hostEl.textContent = watchIsHost ? 'أنت تتحكم — العائلة تشاهد معك' : ('مع ' + (data.byName || 'المؤسس'));
  const ctrls = document.getElementById('watch-controls');
  if (ctrls) ctrls.style.display = watchIsHost ? 'flex' : 'none';
  if (watchYT) { try { watchYT.destroy(); } catch (e) {} watchYT = null; }
  stage.innerHTML = '';
  const hint = document.getElementById('watch-tap-hint');
  if (hint) hint.style.display = 'none';
  // صندوق الخطأ الواضح (بدل الشاشة السوداء الصامتة)
  const errBox = document.createElement('div');
  errBox.className = 'watch-err';
  errBox.style.display = 'none';
  errBox.innerHTML = '⚠️ تعذر تشغيل هذا الرابط<br><small>تأكد أنه: رابط يوتيوب، أو رابط فيديو مباشر (ينتهي بـ .mp4)، أو رابط بث (m3u8)<br>المواقع العادية (صفحات المباريات) لا تدعم التضمين</small>';
  errBox.setAttribute('data-why', '');
  stage.appendChild(errBox);
  // مؤشر تحميل
  const loadBox = document.createElement('div');
  loadBox.className = 'watch-loading';
  loadBox.textContent = '⏳ جاري تحميل الفيديو...';
  stage.appendChild(loadBox);
  const showErr = (why) => {
    loadBox.style.display = 'none';
    if (why === 'youtube-timeout') {
      errBox.innerHTML = '⚠️ يوتيوب لم يستجب<br><small>افتح الرابط في تطبيق يوتيوب للتأكد أنه يعمل، ثم حاول مجدداً<br>أو حمّل المقطع وارفعه من الجهاز</small>';
    }
    errBox.style.display = 'flex';
    if (why) sendDiag('watch_video_error', { url: (watchTogether && watchTogether.url || '').slice(0, 200), why });
  };
  const vid = ytVideoId(data.url);
  sendDiag('watch_start_render', { kind: vid ? 'youtube' : 'other', url: data.url.slice(0, 160) });
  if (vid) {
    const iframe = document.createElement('iframe');
    iframe.id = 'watch-yt-frame';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.src = 'https://www.youtube.com/embed/' + vid + '?enablejsapi=1&autoplay=1&playsinline=1';
    stage.appendChild(iframe);
    loadBox.style.display = 'none';
    await loadYTIframeApi();
    if (!window.YT || typeof window.YT.Player !== 'function') {
      showErr('youtube-api');
      return;
    }
    watchYT = new YT.Player(iframe.id, {
      events: {
        onReady: () => {
          try {
            watchYT.seekTo(watchTogether.time, true);
            if (watchTogether.playing) watchYT.playVideo(); else watchYT.pauseVideo();
          } catch (e) {}
          watchStartPosLoop();
          // محاولات تشغيل تلقائية (iOS يمنع التشغيل الأول بالصوت — نعيد المحاولة + نظهر التلميح)
          let tries = 0;
          const retryPlay = setInterval(() => {
            tries++;
            try {
              const st = watchYT.getPlayerState();
              if (st === 1) { clearInterval(retryPlay); return; }
              if (st === 5) watchYT.playVideo(); // 5 = CUED — نحاول البدء
              if (tries === 2 || tries === 5) {
                const h = document.getElementById('watch-tap-hint');
                if (h) h.style.display = 'flex';
              }
            } catch (e) {}
            if (tries >= 8) clearInterval(retryPlay);
          }, 1500);
          // لو ما جاهز خلال 12 ثانية → رسالة واضحة
          setTimeout(() => {
            try { if (watchYT.getPlayerState && watchYT.getPlayerState() === -1) showErr('youtube-timeout'); } catch (e) {}
          }, 12000);
        },
        onError: () => showErr('youtube-error'),
        onStateChange: (ev) => {
          if (ev.data === YT.PlayerState.PLAYING) {
            const bp = document.getElementById('watch-big-play');
            const bpl = document.getElementById('watch-big-play-label');
            if (bp) bp.style.display = 'none';
            if (bpl) bpl.style.display = 'none';
          }
          if (ev.data === YT.PlayerState.ENDED && watchIsHost) emitWatchControl('pause', watchYT.getDuration());
          if (!watchIsHost) return;
          if (ev.data === YT.PlayerState.PLAYING) emitWatchControl('play', watchYT.getCurrentTime());
          if (ev.data === YT.PlayerState.PAUSED) emitWatchControl('pause', watchYT.getCurrentTime());
        }
      }
    });
    // الأعضاء: اضغط على المشغل لتشغيل الصوت/الفيديو (iOS يمنع التشغيل التلقائي بالصوت)
    stage.onclick = () => {
      const h = document.getElementById('watch-tap-hint');
      if (h) h.style.display = 'none';
      if (watchYT && watchYT.getPlayerState) {
        try { if (watchYT.getPlayerState() !== 1) watchYT.playVideo(); } catch (e) {}
      }
    };
    setTimeout(() => {
      try {
        if (watchYT && watchYT.getPlayerState && watchYT.getPlayerState() !== 1) {
          const h = document.getElementById('watch-tap-hint');
          if (h) h.style.display = 'flex';
        }
      } catch (e) {}
    }, 3500);
  } else {
    const v = document.createElement('video');
    v.id = 'watch-video';
    v.autoplay = !!watchTogether.playing; // في وضع الإيقاف: لا تشغيل تلقائي — زر التشغيل هو البادئ
    v.playsInline = true;
    stage.appendChild(v);
    watchVideo = v;
    const playIt = () => { v.play().catch(() => { const h = document.getElementById('watch-tap-hint'); if (h) h.style.display = 'flex'; }); };
    v.addEventListener('playing', () => {
      loadBox.style.display = 'none';
      errBox.style.display = 'none';
      const bp = document.getElementById('watch-big-play');
      const bpl = document.getElementById('watch-big-play-label');
      if (bp) bp.style.display = 'none';
      if (bpl) bpl.style.display = 'none';
    });
    if (/\.m3u8(\?|$)/i.test(data.url) && !v.canPlayType('application/vnd.apple.mpegurl')) {
      if (!window.Hls) {
        await new Promise((res) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
          s.onload = res; s.onerror = res;
          document.head.appendChild(s);
        });
      }
      if (window.Hls && window.Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(data.url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { loadBox.style.display = 'none'; try { v.currentTime = watchTogether.time; } catch (e) {} if (watchTogether.playing) playIt(); });
        hls.on(Hls.Events.ERROR, (ev, hd) => { if (hd && hd.fatal) showErr('hls-' + (hd.type || '?')); });
      } else { v.src = data.url; playIt(); }
    } else {
      v.src = data.url;
      v.addEventListener('loadedmetadata', () => {
        loadBox.style.display = 'none';
        try { v.currentTime = watchTogether.time; } catch (e) {}
        if (watchTogether.playing) playIt(); else v.pause();
      });
      if (watchTogether.playing) playIt();
    }
    v.addEventListener('play', () => { if (watchIsHost) emitWatchControl('play', v.currentTime); });
    v.addEventListener('pause', () => { if (watchIsHost) emitWatchControl('pause', v.currentTime); });
    // أخطاء الفيديو: رسالة واضحة بدل الشاشة السوداء
    v.addEventListener('error', () => { if (v.src) showErr('video-error'); });
    v.addEventListener('loadedmetadata', () => { loadBox.style.display = 'none'; errBox.style.display = 'none'; v.style.display = 'block'; });
    // مهلة تحميل: لو ما تحمّل خلال 15 ثانية → رسالة
    setTimeout(() => {
      if (watchVideo === v && v.readyState < 2 && !v.error && loadBox.style.display !== 'none') showErr('timeout');
    }, 15000);
    stage.onclick = () => { v.muted = false; v.play().catch(() => {}); const h = document.getElementById('watch-tap-hint'); if (h) h.style.display = 'none'; };
    // تشخيص: حالة عنصر الفيديو بعد 4 ثوانٍ (يكشف سبب الشاشة السوداء)
    setTimeout(() => {
      try {
        sendDiag('watch_video_state', {
          rs: v.readyState, ns: v.networkState, err: v.error ? v.error.code : 0,
          vw: v.videoWidth, vh: v.videoHeight, stageW: stage.clientWidth, stageH: stage.clientHeight,
          paused: v.paused, src: (v.currentSrc || '').slice(-40)
        });
      } catch (e) {}
    }, 4000);
    watchStartPosLoop();
  }
  const wm = document.getElementById('watch-modal');
  if (wm) wm.style.display = 'none';
  if (!data.silent) showToast('🎬 ' + (data.byName || 'المؤسس') + ' يشارك فيديو — مشاهدة معاً!', 'success');
}

function watchDuration() {
  if (watchYT && watchYT.getDuration) return watchYT.getDuration() || 0;
  if (watchVideo) return watchVideo.duration || 0;
  return 0;
}

function watchStartPosLoop() {
  if (watchPosTimer) clearInterval(watchPosTimer);
  watchPosTimer = setInterval(() => {
    let t = 0, d = 0;
    if (watchYT && watchYT.getCurrentTime) { t = watchYT.getCurrentTime() || 0; d = watchYT.getDuration() || 0; }
    else if (watchVideo) { t = watchVideo.currentTime || 0; d = watchVideo.duration || 0; }
    const seek = document.getElementById('watch-seek');
    const timeEl = document.getElementById('watch-time');
    if (seek && d > 0) seek.value = Math.min(1000, Math.round(t / d * 1000));
    if (timeEl) timeEl.textContent = fmtTime(t) + ' / ' + fmtTime(d);
    if (watchIsHost && watchTogether) watchTogether.time = t;
  }, 500);
}

function emitWatchControl(action, time) {
  if (!watchTogether || !state.activeSession?.id || !socket?.connected) return;
  socket.emit('watch_control', { sessionId: state.activeSession.id, action, time: typeof time === 'number' ? time : watchTogether.time });
}

// زر التشغيل الكبير للمقطع المرفوع (المضيف يبث للجميع، العضو يشغّل محلياً)
function watchBigPlay() {
  if (watchIsHost) {
    watchTogglePlay();
  } else if (watchVideo) {
    watchVideo.play().catch(() => {});
  } else if (watchYT) {
    try { watchYT.playVideo(); } catch (e) {}
  }
  const bp = document.getElementById('watch-big-play');
  const bpl = document.getElementById('watch-big-play-label');
  if (bp) bp.style.display = 'none';
  if (bpl) bpl.style.display = 'none';
}

function watchTogglePlay() {
  const btn = document.getElementById('watch-play-btn');
  if (watchYT) {
    const st = watchYT.getPlayerState();
    if (st === 1) { watchYT.pauseVideo(); if (btn) btn.textContent = '▶️'; }
    else { watchYT.playVideo(); if (btn) btn.textContent = '⏸️'; }
  } else if (watchVideo) {
    if (watchVideo.paused) { watchVideo.play().catch(() => {}); if (btn) btn.textContent = '⏸️'; }
    else { watchVideo.pause(); if (btn) btn.textContent = '▶️'; }
  }
}

function watchSeekInput(el) {
  const t = watchDuration() * (el.value / 1000);
  const timeEl = document.getElementById('watch-time');
  if (timeEl) timeEl.textContent = fmtTime(t) + ' / ' + fmtTime(watchDuration());
}

function watchSeekChange(el) {
  const t = watchDuration() * (el.value / 1000);
  if (watchYT) watchYT.seekTo(t, true);
  else if (watchVideo) { try { watchVideo.currentTime = t; } catch (e) {} }
  emitWatchControl('seek', t);
  const btn = document.getElementById('watch-play-btn');
  if (btn && watchTogether) btn.textContent = watchTogether.playing ? '⏸️' : '▶️';
}

function openWatchModal() {
  if (!state.activeSession?.id) return showToast('افتح البث أولاً', 'error');
  const input = document.getElementById('watch-url-input');
  if (input) input.value = '';
  document.getElementById('watch-modal').style.display = 'flex';
}

async function startWatchTogether() {
  const url = document.getElementById('watch-url-input').value.trim();
  if (!/^https?:\/\//i.test(url)) return showToast('أدخل رابطاً صحيحاً يبدأ بـ https://', 'error');
  if (!state.activeSession?.id) return showToast('افتح البث أولاً', 'error');
  socket.emit('watch_start', { sessionId: state.activeSession.id, url });
  document.getElementById('watch-modal').style.display = 'none';
}

// 📤 رفع مقطع فيديو من جهاز المؤسس (مشاهدة معاً)
function uploadWatchFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!state.activeSession?.id) return showToast('افتح البث أولاً', 'error');
  const maxMB = 180;
  if (file.size > maxMB * 1024 * 1024) {
    showToast('⚠️ المقطع أكبر من ' + maxMB + ' ميجا — اختر مقطعاً أصغر', 'error');
    input.value = '';
    return;
  }
  const statusEl = document.getElementById('watch-upload-status');
  const progWrap = document.getElementById('watch-progress-wrap');
  const progBar = document.getElementById('watch-progress-bar');
  const progPct = document.getElementById('watch-progress-pct');
  const doUpload = async () => {
    try {
      if (statusEl) statusEl.textContent = '⏳ جاري تجهيز المقطع (' + Math.round(file.size / 1048576) + 'MB)...';
      if (progWrap) progWrap.style.display = 'block';
      if (progBar) progBar.style.width = '2%';
      if (progPct) progPct.textContent = '0%';
      const reader = new FileReader();
      const dataUrl = await new Promise((res, rej) => {
        reader.onload = () => res(String(reader.result));
        reader.onerror = () => rej(new Error('تعذر قراءة الملف'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1] || '';
      sendDiag('watch_upload_start', { mb: Math.round(file.size / 1048576), name: file.name.slice(0, 60) });
      // رفع بتقدم حقيقي (XHR) — شريط أزرق بنسبة مئوية
      const token = localStorage.getItem('token');
      const uploaded = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + '/api/watch/upload');
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.timeout = 300000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && progBar && progPct) {
            const pct = Math.min(100, Math.round(e.loaded / e.total * 100));
            progBar.style.width = pct + '%';
            progPct.textContent = pct + '%';
            if (statusEl) statusEl.textContent = pct >= 100 ? '⏳ جاري التحويل للصيغة المتوافقة...' : '📤 جاري رفع المقطع: ' + pct + '%';
          }
        };
        xhr.onload = () => {
          try {
            const txt = xhr.responseText || '';
            const d = JSON.parse(txt || '{}');
            if (xhr.status >= 200 && xhr.status < 300) resolve(d);
            else reject(new Error(d.error || 'فشل الرفع (' + xhr.status + ')'));
          } catch (e2) {
            // الاستضافة كانت نائمة وردّت صفحة HTML — نعيد المحاولة بعد ثانية
            sendDiag('watch_upload_badresp', { status: xhr.status, len: (xhr.responseText || '').length, head: (xhr.responseText || '').slice(0, 60) });
            setTimeout(() => {
              const retry = new XMLHttpRequest();
              retry.open('POST', API_BASE + '/api/watch/upload');
              retry.setRequestHeader('Content-Type', 'application/json');
              if (token) retry.setRequestHeader('Authorization', 'Bearer ' + token);
              retry.timeout = 300000;
              retry.onload = () => {
                try {
                  const d2 = JSON.parse(retry.responseText || '{}');
                  if (retry.status >= 200 && retry.status < 300) resolve(d2);
                  else reject(new Error(d2.error || 'فشل الرفع (' + retry.status + ')'));
                } catch (e3) { reject(new Error('الاستضافة لم تستجب — أعد المحاولة بعد قليل')); }
              };
              retry.onerror = () => reject(new Error('تعذر الاتصال — أعد المحاولة'));
              retry.ontimeout = () => reject(new Error('انتهت مهلة الرفع'));
              retry.send(xhr.body);
            }, 1500);
          }
        };
        xhr.onerror = () => reject(new Error('تعذر الاتصال — تأكد أن الموقع مستيقظ وأعد المحاولة'));
        xhr.ontimeout = () => reject(new Error('انتهت مهلة الرفع'));
        xhr.send(JSON.stringify({ sessionId: state.activeSession.id, name: file.name, type: file.type || 'video/mp4', data: base64 }));
      });
      if (progBar) progBar.style.width = '100%';
      if (progPct) progPct.textContent = '100%';
      if (statusEl) statusEl.textContent = '✅ تم الرفع — جاري التحويل والتجهيز...';
      window._watchUploadPending = true;
      // المشغل يفتح عندما يصل watch_started من السيرفر (بعد التحويل)
      setTimeout(() => {
        if (window._watchUploadPending) {
          if (statusEl) statusEl.textContent = '⏳ التحويل يستغرق وقتاً للمقاطع الطويلة — انتظر قليلاً...';
        }
      }, 20000);
    } catch (e) {
      if (statusEl) statusEl.textContent = '';
      if (progWrap) progWrap.style.display = 'none';
      input.value = '';
      sendDiag('watch_upload_fail', { err: String(e.message || e).slice(0, 120) });
      showToast('فشل رفع المقطع: ' + (e.message || ''), 'error');
    }
  };
  // تأكيد للملفات الكبيرة
  if (file.size > 50 * 1024 * 1024) {
    const yes = confirm('المقطع حجمه ' + Math.round(file.size / 1048576) + 'MB — الرفع قد يأخذ دقيقة أو أكثر. متابعة؟');
    if (!yes) { input.value = ''; return; }
  }
  doUpload();
}

function stopWatchTogether() {
  if (!state.activeSession?.id) return;
  socket.emit('watch_stop', { sessionId: state.activeSession.id });
  hideWatchPlayer();
}

function hideWatchPlayer() {
  if (watchPosTimer) { clearInterval(watchPosTimer); watchPosTimer = null; }
  if (watchYT) { try { watchYT.destroy(); } catch (e) {} watchYT = null; }
  if (watchVideo) { try { watchVideo.pause(); watchVideo.src = ''; } catch (e) {} watchVideo = null; }
  watchTogether = null;
  const ov = document.getElementById('watch-player-overlay');
  if (ov) ov.style.display = 'none';
  const stage = document.getElementById('watch-stage');
  if (stage) stage.innerHTML = '';
}

let diwaniyaCodeVerified = false;
let pendingCallJoin = false;

async function checkDiwaniyaSecretCode() {
  const session = state.activeSession;
  if (!session) return true;
  // Founder always passes
  if (state.isFounder) return true;
  // Check if session has code (load fresh)
  try {
    const { session: fresh } = await api('GET', '/api/diwaniya/active');
    if (fresh?.secret_code) {
      if (!diwaniyaCodeVerified) {
        // Show code modal (pending call join)
        pendingCallJoin = true;
        document.getElementById('diwaniya-code-modal').style.display = 'flex';
        document.getElementById('diwaniya-code-input').value = '';
        return false;
      }
    }
  } catch(e) {}
  return true;
}

async function submitDiwaniyaCode() {
  const code = document.getElementById('diwaniya-code-input').value.trim();
  const sessionId = state.activeSession?.id;
  if (!code || !sessionId) return showToast('أدخل الرقم السري', 'error');
  try {
    await api('POST', '/api/diwaniya/verify-code', { sessionId, code });
    diwaniyaCodeVerified = true;
    document.getElementById('diwaniya-code-modal').style.display = 'none';
    showToast('🗝️ تم التحقق - أهلاً بك', 'success');
    enableChat(true);
    // If user was trying to join the call, proceed
    if (pendingCallJoin) {
      pendingCallJoin = false;
      joinLiveAudio();
    }
  } catch(e) { showToast(e.message, 'error'); }
}

// ==================== SECRET ROOM (PAID) ====================
async function setVideoLimit() {
  const sessionId = state.activeSession?.id;
  const limit = parseInt(document.getElementById('video-limit-select')?.value || '6');
  if (!sessionId) return;
  try {
    await api('POST', '/api/diwaniya/video-limit', { sessionId, limit });
    const vld = document.getElementById('video-limit-display'); if (vld) vld.textContent = limit;
    showToast('🎥 عدد الكاميرات: ' + limit, 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function loadSecretRoomStatus() {
  if (!state.family?.id || !state.isFounder) return;
  try {
    const status = await api('GET', '/api/diwaniya/secret-room');
    // Show the coin price from the admin pricing
    try {
      const { pricing } = await api('GET', '/api/pricing');
      const p = (pricing || []).find(x => x.feature === 'secret_room');
      const priceEl = document.getElementById('secret-room-price');
      if (priceEl) priceEl.textContent = p?.coins || 5000;
    } catch(e) {}
    const input = document.getElementById('diwaniya-secret-code');
    const btn = document.getElementById('secret-room-btn');
    const banner = document.getElementById('secret-room-banner');
    if (status.enabled) {
      if (input) input.placeholder = '🗝️ رقم سري (اختياري)';
      if (btn) { btn.textContent = '🟢 الغرفة المغلقة مفعلة'; btn.classList.add('btn-success'); }
      if (banner) banner.style.display = 'none';
    } else {
      if (input) input.placeholder = '🗝️ رقم سري (اختياري)';
      if (btn) { btn.textContent = '🔒 الغرفة المغلقة'; btn.classList.remove('btn-success'); }
      if (banner) banner.style.display = 'none';
    }
  } catch(e) {}
}

function toggleSecretRoomPurchase() {
  const banner = document.getElementById('secret-room-banner');
  if (banner) banner.style.display = banner.style.display === 'none' ? 'block' : 'none';
}

async function purchaseSecretRoom() {
  // Fetch the coin price first and confirm
  try {
    const { pricing } = await api('GET', '/api/pricing');
    const p = (pricing || []).find(x => x.feature === 'secret_room');
    const price = p?.coins || 10000;
    if (!confirm('🔒 تفعيل الغرفة المغلقة (شهرياً) - سعر الخدمة: 🪙 ' + price + ' 🪙. سيتم خصمها من رصيدك بعد التأكيد. متابعة؟')) return;
    const result = await api('POST', '/api/diwaniya/secret-room/purchase');
    showToast(result.message, 'success');
    refreshWalletHeader();
    loadSecretRoomStatus();
  } catch(e) { showToast(e.message, 'error'); }
}

async function loadBattleStatus() {
  if (!state.activeSession?.id) return;
  try {
    const { battle } = await api('GET', '/api/battles/active?sessionId=' + state.activeSession.id);
    if (battle) {
      // enrich names
      try {
        const { members } = await api('GET', '/api/family/members');
        const a = members.find(m => m.id === battle.player_a_id);
        const b = members.find(m => m.id === battle.player_b_id);
        battle.player_a_name = a?.name;
        battle.player_b_name = b?.name;
        if (!battle.player_a_name || !battle.player_b_name) {
          try {
            const { founders } = await api('GET', '/api/founders/online');
            founders.forEach(f => {
              if (f.id === battle.player_a_id && !battle.player_a_name) battle.player_a_name = f.name + ' (👪 ' + f.family_name + ')';
              if (f.id === battle.player_b_id && !battle.player_b_name) battle.player_b_name = f.name + ' (👪 ' + f.family_name + ')';
            });
          } catch(e) {}
        }
        if (!battle.player_a_name) battle.player_a_name = battle.player_a_id.slice(0,6);
        if (!battle.player_b_name) battle.player_b_name = battle.player_b_id.slice(0,6);
      } catch(e) {}
      renderBattle(battle);
    }
  } catch(e) {}
}

async function loadDiwaniyaCapacity() {
  if (!state.family?.id) return;
  try {
    const { capacity, packages } = await api('GET', '/api/diwaniya/capacity');
    // Show coin prices on the package cards
    try {
      const { pricing } = await api('GET', '/api/pricing');
      const p20 = (pricing || []).find(x => x.feature === 'capacity_20');
      const p40 = (pricing || []).find(x => x.feature === 'capacity_40');
      const el20 = document.getElementById('cap20-price');
      const el40 = document.getElementById('cap40-price');
      if (el20) el20.textContent = '<img src="/assets/coin.png" class="coin-ico" alt="🪙"> ' + (p20?.coins ?? 5000) + ' 🪙';
      if (el40) el40.textContent = '<img src="/assets/coin.png" class="coin-ico" alt="🪙"> ' + (p40?.coins ?? 10000) + ' 🪙';
    } catch(e) {}
    const info = document.getElementById('capacity-info');
    const sel = document.getElementById('diwaniya-capacity-select');
    const pkgs = document.getElementById('capacity-packages');
    if (info) info.textContent = '👥 الحد الأقصى للعائلة: ' + capacity + ' عضو' + (capacity === 15 ? ' (اشترِ باقة توسعة)' : '');
    if (sel) {
      const options = [15];
      if (capacity >= 20) options.push(20);
      if (capacity >= 40) options.push(40);
      sel.innerHTML = options.map(c => '<option value="' + c + '">👥 الحد الأقصى: ' + c + ' عضو</option>').join('');
    }
    if (pkgs) pkgs.style.display = (state.isFounder && capacity < 40) ? 'block' : 'none';
  } catch(e) {}
}

async function purchaseCapacity(cap) {
  // Fetch the coin price and confirm
  try {
    const { pricing } = await api('GET', '/api/pricing');
    const p = (pricing || []).find(x => x.feature === 'capacity_' + cap);
    const price = p?.coins || (cap === 20 ? 5000 : 10000);
    if (!confirm('👥 توسعة الديوانية إلى ' + cap + ' عضو - سعر الخدمة: 🪙 ' + price + ' 🪙\nسيتم خصمها من رصيدك بعد التأكيد. متابعة؟')) return;
    const result = await api('POST', '/api/diwaniya/capacity/purchase', { capacity: cap });
    showToast(result.message, 'success');
    refreshWalletHeader();
    loadDiwaniyaCapacity();
  } catch(e) { showToast(e.message, 'error'); }
}

async function joinLiveAudio() {
  if (inLiveCall) return leaveLiveAudio();
  // Verify secret code before joining
  const canJoin = await checkDiwaniyaSecretCode();
  if (!canJoin) return;
  
  const isModeratorVisit = (state.user?.role === 'moderator') || (state.user?.role === 'admin' && document.getElementById('moderator-send-box')?.style.display === 'block');
  
  try {
    // الكاميرا فقط للمؤسس (والأدمن) في أوضاع الفيديو — أعضاء العائلة ينضمون بالصوت فقط
    const isVideoMode = ['video', 'all'].includes(state.diwaniyaMode);
    const isHost = state.isFounder || state.user?.role === 'admin';
    const wantVideo = !isModeratorVisit && isVideoMode && isHost;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo ? { facingMode: state.cameraFacing || 'environment' } : false });
    
    if (isModeratorVisit) {
      // Forced observer: mute mic immediately, no camera at all
      localStream.getAudioTracks().forEach(t => t.enabled = false);
      micMuted = true;
      camOff = true;
    } else {
      camOff = !wantVideo;
    }
    
    inLiveCall = true;
    
    // مستوى حقيقي فور الدخول للبث (بدون انتظار الدورة)
    refreshUserProfile();
    
    // Notify server we're joining (observer flag for moderators)
    sendDiag('join_live', { wantVideo, role: state.user?.role, founder: state.isFounder, ua: navigator.userAgent });
    socket.emit('join_audio_call', { 
      sessionId: state.activeSession.id, 
      userId: state.user.id, 
      userName: state.user.name,
      isObserver: isModeratorVisit,
      wantsVideo: wantVideo
    });
    
    state.callMembers = {};
    updateCallPresence();
    showEntryBanner(state.user?.name, state.user?.avatar, 'انضممت للديوانية 🎉', state.user?.level);
    const presenceEl = document.getElementById('call-presence');
    if (presenceEl) presenceEl.style.display = 'block';
    const invBtn = document.getElementById('cam-invite-btn');
    if (invBtn) invBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    const famBtn = document.getElementById('families-btn');
    if (famBtn) famBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    const scrBtn = document.getElementById('tt-bar-screen');
    if (scrBtn) scrBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    const watchBtn = document.getElementById('tt-bar-watch');
    if (watchBtn) watchBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    const mmBtn = document.getElementById('mic-manage-btn');
    if (mmBtn) mmBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';

    const bsb = document.getElementById('battle-start-box');
    if (bsb) bsb.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    updateAudioCallUI(true);
    startCallWatermark();
    setTikTokMode(true); // TikTok layout by default with chat below
    updateTikTokLiveInfo();
    updateViewerCount();
    // الكاميرا تفتح تلقائياً فقط في أوضاع الفيديو — الصوتية تبدأ بالكاميرا مغلقة
    const myVideo2 = document.getElementById('my-video');
    if (myVideo2) { myVideo2.srcObject = localStream; myVideo2.style.display = camOff ? 'none' : 'block'; }
    refreshCamOffOverlay();
    // كاشف الكاميرا السوداء: إذا الصورة ما وصلت بعد 3 ثوانٍ → تنبيه بالإذن
    if (!camOff && wantVideo) {
      setTimeout(() => {
        const mv = document.getElementById('my-video');
        if (mv && mv.style.display !== 'none' && mv.srcObject && (mv.videoWidth === 0 || !mv.videoWidth)) {
          sendDiag('camera_black_detected', { w: mv.videoWidth, h: mv.videoHeight });
          showToast('📷 الكاميرا لا تعطي صورة — افحص إذن الكاميرا للمتصفح أو أعد فتح البث', 'error');
        }
      }, 3000);
    }
    const camBtn2 = document.getElementById('cam-toggle-btn');
    if (camBtn2) camBtn2.classList.toggle('off', camOff);
    const barCamIco2 = document.getElementById('tt-bar-cam-ico');
    if (barCamIco2) barCamIco2.textContent = camOff ? '🚫' : '📷';
    const barMicIco2 = document.getElementById('tt-bar-mic-ico');
    if (barMicIco2) barMicIco2.textContent = micMuted ? '🔇' : '🎤';
    const exitBtn = document.getElementById('call-exit-btn');
    if (exitBtn) exitBtn.style.display = 'flex';
    // Apply my saved effect
    if (state.user?.selected_effect) { myEffect = state.user.selected_effect; applyMyEffect(myEffect); }
    // Load my owned effects list to know what I own
    try {
      const { effects } = await api('GET', '/api/effects');
      myEffectOwned = true;
    } catch(e) {}
    if (isModeratorVisit) {
      showToast('🕵️ أنت مراقب - تسمع فقط، كاميرا ومايك مقفلان', 'success');
      // Force UI state
      const micBtn = document.getElementById('mic-toggle-btn');
      const camBtn = document.getElementById('cam-toggle-btn');
      if (micBtn) { micBtn.classList.add('muted'); micBtn.classList.add('off'); }
      if (camBtn) { camBtn.classList.add('off'); }
      const stateEl = document.getElementById('my-tile-state');
      if (stateEl) stateEl.textContent = '🕵️ مراقب - يسمع فقط';
    } else {
      if (!wantVideo) {
        const stateEl = document.getElementById('my-tile-state');
        if (stateEl) stateEl.textContent = '🎤 صوت فقط';
      }
      const preCam = document.getElementById('pre-cam-btn');
      if (preCam) preCam.style.display = isHost ? 'inline-block' : 'none';
      showToast(!isHost ? '🎤 انضممت للبث بالصوت فقط (الكاميرا للمؤسس)' : (isVideoMode ? '🎥 أنت في بث الفيديو الآن' : '🎤 أنت في البث الصوتي الآن'), 'success');
    }
  } catch(e) {
    showToast('الرجاء السماح بالميكروفون', 'error');
    inLiveCall = false;
  }
}

function leaveLiveAudio() {
  // إيقاف مشاركة الشاشة إن كانت مفعلة
  if (screenShareActive) {
    screenShareActive = false;
    if (screenShareStream) {
      try { screenShareStream.getTracks().forEach(t => t.stop()); } catch(e) {}
      screenShareStream = null;
    }
  }
  remoteScreenShare = {};
  screenRotation = {};
  hideWatchPlayer();
  // Close all peer connections
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  
  // Stop local stream
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  stopCallWatermark();
  // Reset state
  micMuted = false; camOff = false;
  const micBtn = document.getElementById('mic-toggle-btn');
  const camBtn = document.getElementById('cam-toggle-btn');
  const tileState = document.getElementById('my-tile-state');
  if (micBtn) { micBtn.classList.remove('off','muted'); }
  if (camBtn) { camBtn.classList.remove('off'); }
  if (tileState) { tileState.textContent = ''; tileState.classList.remove('muted-state'); }
  
  inLiveCall = false;
  if (filterPipeline) {
    clearInterval(filterPipeline.timer);
    if (filterPipeline.srcVideo) filterPipeline.srcVideo.remove();
    filterPipeline = null;
  }
  state.callMembers = {};
  const presenceEl2 = document.getElementById('call-presence');
  if (presenceEl2) presenceEl2.style.display = 'none';
  const exitBtn2 = document.getElementById('call-exit-btn');
  if (exitBtn2) exitBtn2.style.display = 'none';
  setTikTokMode(false);
  // Remove local video tile content + close overlays (gifts/zoom)
  const myTile = document.getElementById('my-video-tile');
  if (myTile) {
    const ov = myTile.querySelector('.cam-off-overlay');
    if (ov) ov.style.display = 'none';
  }
  if (socket?.connected) {
    socket.emit('leave_audio_call', {
      sessionId: state?.activeSession?.id || null,
      userId: state?.user?.id || null
    });
  }
    sessionGiftCoins = {};
  updateAudioCallUI(false);
  // Force-hide call UI even if updateAudioCallUI failed
  const ctrl = document.getElementById('call-controls');
  const grid = document.getElementById('video-grid');
  if (ctrl) ctrl.style.display = 'none';
  if (grid) {
    grid.style.display = 'none';
    // مسح بلاطات الفيديو فقط - الحفاظ على أدوات البث الثابتة
    grid.querySelectorAll('.video-tile').forEach(t => { if (t.id !== 'my-video-tile') t.remove(); });
  }
  // Reset my video
  const myVideo = document.getElementById('my-video');
  if (myVideo) { myVideo.srcObject = null; myVideo.style.display = 'none'; }
  showToast('غادرت البث');
}

function createPeerConnection(peerId, peerName) {
  if (peerConnections[peerId]) return;
  
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // TURN مجاني — يضمن الاتصال حتى بين الشبكات المقيدة (NAT متماثل)
      { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  });
  
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('audio_ice_candidate', {
        to: peerId,
        candidate: e.candidate,
        sessionId: state.activeSession.id,
        fromUserId: state.user.id
      });
    }
  };
  
  pc.ontrack = (e) => {
    addRemoteAudio(peerId, peerName, e.streams[0]);
  };
  
  // Add local stream
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
  
  peerConnections[peerId] = pc;
  return pc;
}

async function createOffer(peerId, peerName) {
  const pc = createPeerConnection(peerId, peerName);
  if (!pc) return;
  // Glare fix: if we already have a pending offer, skip - the peer's offer will arrive
  if (pc.signalingState !== 'stable') return;
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('audio_offer', {
      to: peerId,
      offer: pc.localDescription,
      sessionId: state.activeSession.id,
      userName: state.user.name,
      fromUserId: state.user.id
    });
  } catch(e) {
    console.error('Offer error:', e);
  }
}

async function handleAudioOffer(fromId, fromName, offer) {
  // Reuse existing peer connection for renegotiation (e.g. member adds camera later)
  let pc = peerConnections[fromId];
  if (!pc) pc = createPeerConnection(fromId, fromName);
  if (!pc) return;
  
  try {
    // Glare fix: both sides may send offers simultaneously - rollback ours and answer theirs
    if (pc.signalingState === 'have-local-offer') {
      await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('audio_answer', {
      to: fromId,
      answer: pc.localDescription,
      sessionId: state.activeSession?.id,
      fromUserId: state.user.id
    });
  } catch(e) {
    console.error('Answer error:', e);
  }
}

async function handleAudioAnswer(fromId, answer) {
  const pc = peerConnections[fromId];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  } catch(e) {
    console.error('Answer set error:', e);
  }
}

async function handleIceCandidate(fromId, candidate) {
  const pc = peerConnections[fromId];
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch(e) {
    console.error('ICE error:', e);
  }
}

// ==================== CALL WATERMARK (anti-recording) ====================
function startCallWatermark() {
  const wm = document.getElementById('call-watermark');
  if (!wm) return;
  const fam = state?.family?.name || 'العائلة';
  const me = state?.user?.name || '';
  wm.textContent = '🔒 ' + fam + ' · ' + me + ' · ' + new Date().toLocaleTimeString('ar-SA', {hour:'2-digit',minute:'2-digit'});
  wm.style.display = 'block';
}
function stopCallWatermark() {
  const wm = document.getElementById('call-watermark');
  if (wm) { wm.style.display = 'none'; wm.textContent = ''; }
}

// ==================== CALL POP-OUT (outside the page, covers full screen) ====================
let pipWin = null; // نافذة البث المنبثقة

function isPipActive() { return !!pipWin && !pipWin.closed; }

// البث يطلع برا الصفحة: نافذة منبثقة على الكمبيوتر، ملء الشاشة على الجوال
async function popOutCallGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  // 1) نافذة منبثقة حقيقية خارج المتصفح (Chrome/Edge على الكمبيوتر)
  if (window.documentPictureInPicture && !isPipActive()) {
    try {
      const w = await documentPictureInPicture.requestWindow({ width: 420, height: 760 });
      w.document.head.innerHTML = document.head.innerHTML; // نسخ كل التنسيقات
      const holder = document.createElement('div');
      holder.id = 'video-grid-pip-holder';
      holder.style.cssText = 'width:100%;min-height:280px;background:#000;color:#888;display:flex;align-items:center;justify-content:center;border-radius:14px;padding:24px;text-align:center;font-size:15px;flex-direction:column;gap:12px';
      holder.innerHTML = '🖥️ البث مفتوح في نافذة منفصلة تغطي الشاشة<br><button class="btn btn-accent" style="margin-top:6px" onclick="closePipBack()">↩️ الرجوع للصفحة</button>';
      grid.parentNode.insertBefore(holder, grid);
      w.document.body.appendChild(grid); // نقل الشبكة (الفيديو يكمل)
      // جسر: أزرار النافذة المنبثقة تعمل عبر الصفحة الأم
      const bridge = w.document.createElement('script');
      bridge.textContent = "for (const f of ['sendTtHeart','sendTikTokChat','askExitCall','toggleCallFullscreen','closePipBack','toggleTileFilterBar','tileSelectFilter']) window[f] = (...a) => window.opener && window.opener[f] ? window.opener[f](...a) : null;";
      w.document.body.appendChild(bridge);
      pipWin = w;
      // عند إغلاق النافذة: إرجاع البث للصفحة
      w.addEventListener('pagehide', () => {
        const h = document.getElementById('video-grid-pip-holder');
        if (h) h.replaceWith(grid);
        pipWin = null;
      });
      const btn = document.getElementById('fullscreen-toggle-btn');
      if (btn) { btn.textContent = '🪟'; btn.title = 'إغلاق النافذة المنبثقة'; btn.classList.add('zoom'); }
      showToast('🪟 البث فتح بنافذة منفصلة تغطي الشاشة', 'success');
      return;
    } catch(e) { /* المستخدم رفض أو غير مدعوم - ننتقل لملء الشاشة */ }
  }
  // 2) ملء الشاشة الكامل (الجوال: يغطي كل الشاشة)
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    if (btn0()) btn0().classList.remove('zoom');
    return;
  }
  function btn0() { return document.getElementById('fullscreen-toggle-btn'); }
  if (grid.requestFullscreen) {
    grid.requestFullscreen().then(() => {
      const b = btn0(); if (b) { b.textContent = '⛶'; b.classList.add('zoom'); }
    }).catch(() => {});
  } else {
    grid.classList.toggle('video-zoom');
    const b = btn0(); if (b) b.classList.toggle('zoom', grid.classList.contains('video-zoom'));
  }
}
function closePipBack() { if (isPipActive()) pipWin.close(); }

function toggleCallFullscreen() {
  // إغلاق النافذة المنبثقة
  if (isPipActive()) return closePipBack();
  popOutCallGrid();
}
// خروج من النافذة المنبثقة أو ملء الشاشة عند خروج المكالمة
function closePopOut() {
  if (isPipActive()) { try { pipWin.close(); } catch(e) {} pipWin = null; }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const h = document.getElementById('video-grid-pip-holder');
  const grid = document.getElementById('video-grid');
  if (h && grid && !grid.parentNode) h.replaceWith(grid);
  const btn = document.getElementById('fullscreen-toggle-btn');
  if (btn) { btn.textContent = '⛶'; btn.classList.remove('zoom'); btn.title = 'تكبير الشاشة'; }
}
// ==================== BATTLES (live support challenge) ====================
let currentBattle = null;
let battleTimer = null;

function openBattleModal() {
  const sel = document.getElementById('battle-opponent');
  sel.innerHTML = '<option value="">اختر الخصم...</option>';
  const members = state.callMembers || {};
  const pool = Object.keys(members).length ? members : (state.members || []);
  Object.entries(pool).forEach(([id, name]) => {
    if (id !== state.user?.id) sel.innerHTML += '<option value="' + id + '">' + (typeof name === 'string' ? name : name.name || 'عضو') + '</option>';
  });
  if (sel.options.length <= 1) return showToast('لا يوجد أعضاء لتحديهم - ادخلوا البث أولاً', 'error');
  document.getElementById('battle-modal').style.display = 'flex';
}

async function startBattle() {
  const opponentId = document.getElementById('battle-opponent')?.value;
  const duration = document.getElementById('battle-duration')?.value || '3';
  if (!opponentId) return showToast('اختر الخصم', 'error');
  if (!state.activeSession?.id) return showToast('الديوانية غير مفتوحة', 'error');
  try {
    const result = await api('POST', '/api/battles/start', { opponentId, sessionId: state.activeSession.id, durationMinutes: duration });
    showToast(result.message, 'success');
    document.getElementById('battle-modal').style.display = 'none';
    // أظهر شريط PK فوراً (بانتظار قبول الخصم)
    if (result.battle) renderBattle(result.battle);
  } catch(e) { showToast(e.message, 'error'); }
}

let pendingBattleInvite = null;
function respondBattle(accept) {
  const battleId = pendingBattleInvite?.battleId;
  if (!battleId) return;
  const endpoint = accept ? '/api/battles/accept' : '/api/battles/reject';
  api('POST', endpoint, { battleId }).then(r => {
    showToast(r.message, 'success');
  }).catch(e => showToast(e.message, 'error'));
  document.getElementById('battle-invite-modal').style.display = 'none';
  pendingBattleInvite = null;
}

function renderBattle(b) {
  currentBattle = b;
  const bar = document.getElementById('battle-bar');
  const startBox = document.getElementById('battle-start-box');
  const pkBar = document.getElementById('pk-bar');
  const grid = document.getElementById('video-grid');
  if (!bar || !b || (b.status !== 'active' && b.status !== 'pending' && b.status !== 'victory')) {
    if (bar) bar.style.display = 'none';
    if (startBox) startBox.style.display = 'block';
    const supRow = document.getElementById('battle-support-row');
    if (supRow) supRow.style.display = 'none';
    if (pkBar) pkBar.style.display = 'none';
    if (grid) grid.classList.remove('pk-split');
    if (grid) grid.querySelectorAll('.video-tile').forEach(t => t.classList.remove('pk-a', 'pk-b', 'pk-side-active'));
    // إعادة بلاطات الأعضاء لعمودها الأيمن بعد انتهاء التحدي
    if (grid) grid.querySelectorAll('.video-tile:not(.local)').forEach((t, i) => {
      t.style.bottom = (10 + (i % 6) * 150) + 'px';
      t.style.right = '10px';
      t.style.zIndex = 30;
    });
    const pkBtn = document.getElementById('tt-bar-pk');
    if (pkBtn) pkBtn.style.display = 'none';
    return;
  }
  if (startBox) startBox.style.display = 'none';
  bar.style.display = 'block';
  // أسماء اللاعبين: من بيانات المعركة أو من قائمة الأعضاء
  const memA = (state.members || []).find(m => m.id === b.player_a_id);
  const memB = (state.members || []).find(m => m.id === b.player_b_id);
  if (!b.player_a_name) b.player_a_name = memA?.name || state.callMembers?.[b.player_a_id] || 'لاعب أ';
  if (!b.player_b_name) b.player_b_name = memB?.name || state.callMembers?.[b.player_b_id] || 'لاعب ب';
  // Show the fixed support row when a battle is active
  const supRow = document.getElementById('battle-support-row');
  if (supRow) supRow.style.display = (b.status === 'active' || b.status === 'victory') ? 'flex' : 'none';
  // Players names/avatars
  const na = b.player_a_name || 'لاعب أ', nb = b.player_b_name || 'لاعب ب';
  document.getElementById('battle-name-a').textContent = na;
  document.getElementById('battle-name-b').textContent = nb;
  document.getElementById('battle-coins-a').textContent = '<img src="/assets/coin.png" class="coin-ico" alt="🪙"> ' + (b.coins_a || 0);
  document.getElementById('battle-coins-b').textContent = '<img src="/assets/coin.png" class="coin-ico" alt="🪙"> ' + (b.coins_b || 0);
  // Self-support button: show if I am one of the players
  const sself = document.getElementById('self-support-btn');
  if (sself) {
    const isPlayer = b.player_a_id === state.user?.id || b.player_b_id === state.user?.id;
    sself.style.display = isPlayer ? 'inline-block' : 'none';
  }
  // TikTok PK bar + split screen
  renderPkBar(b);
  applyPkLayout(b);
  // PK challenge icon in bottom bar (host only)
  const pkBtn = document.getElementById('tt-bar-pk');
  if (pkBtn) pkBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'flex' : 'none';
  // Victory round label
  const timerEl2 = document.getElementById('battle-timer');
  if (b.status === 'victory' && timerEl2 && !b._victoryStarted) {
    b._victoryStarted = true;
  }
  const total = (b.coins_a || 0) + (b.coins_b || 0);
  // Tug-of-war line: 50% = center, moves toward the leader
  const linePos = total ? 50 + ((b.coins_a || 0) - (b.coins_b || 0)) / total * 50 : 50;
  const line = document.getElementById('battle-line');
  if (line) {
    line.style.left = Math.max(3, Math.min(97, linePos)) + '%';
    line.classList.remove('sway');
    void line.offsetWidth;
    // sway when close to center (tie fight)
    if (Math.abs(linePos - 50) < 8) line.classList.add('sway');
  }
  // Timer
  if (b.status === 'active' && b.start_time) {
    const dur = (b.duration_minutes || 3) * 60;
    const elapsed = Math.floor((Date.now() - new Date(b.start_time).getTime()) / 1000);
    const left = Math.max(0, dur - elapsed);
    const m = Math.floor(left / 60), s = left % 60;
    document.getElementById('battle-timer').textContent = '⏱️ ' + m + ':' + String(s).padStart(2, '0');
    const pkTimer = document.getElementById('pk-timer');
    if (pkTimer) pkTimer.textContent = m + ':' + String(s).padStart(2, '0');
    if (battleTimer) clearInterval(battleTimer);
    battleTimer = setInterval(() => {
      const e = Math.floor((Date.now() - new Date(b.start_time).getTime()) / 1000);
      const l = Math.max(0, dur - e);
      const ms = Math.floor(l / 60) + ':' + String(l % 60).padStart(2, '0');
      document.getElementById('battle-timer').textContent = '⏱️ ' + ms;
      const pkTimer2 = document.getElementById('pk-timer');
      if (pkTimer2) pkTimer2.textContent = ms;
      if (l <= 0) { clearInterval(battleTimer); endBattleNow(); }
    }, 1000);
  }
}

// شريط PK العلوي (نمط تيك توك): طرفان + شريط نقاط + مؤقت
function renderPkBar(b) {
  const pkBar = document.getElementById('pk-bar');
  if (!pkBar) return;
  const aName = b.player_a_name || 'لاعب أ';
  const bName = b.player_b_name || 'لاعب ب';
  document.getElementById('pk-name-a').textContent = aName;
  document.getElementById('pk-name-b').textContent = bName;
  document.getElementById('pk-points-a').textContent = b.coins_a || 0;
  document.getElementById('pk-points-b').textContent = b.coins_b || 0;
  // الأفاتارات (من قائمة الأعضاء إن وجدت)
  const memsA = (state.members || []).find(m => m.id === b.player_a_id);
  const memsB = (state.members || []).find(m => m.id === b.player_b_id);
  const avA0 = b.player_a_avatar || memsA?.avatar || peerAvatars[b.player_a_id] || '👤';
  const avB0 = b.player_b_avatar || memsB?.avatar || peerAvatars[b.player_b_id] || '👤';
  const avA = String(avA0).startsWith('data:') || String(avA0).startsWith('http') || String(avA0).startsWith('/')
    ? '<img src="' + avA0 + '">' : avA0;
  const avB = String(avB0).startsWith('data:') || String(avB0).startsWith('http') || String(avB0).startsWith('/')
    ? '<img src="' + avB0 + '">' : avB0;
  document.getElementById('pk-avatar-a').innerHTML = avA;
  document.getElementById('pk-avatar-b').innerHTML = avB;
  // شريط التقدم: من المنتصف نحو الطرف الفائز
  const total = (b.coins_a || 0) + (b.coins_b || 0);
  const ratio = total ? (b.coins_a || 0) / total : 0.5;
  const fillA = document.getElementById('pk-fill-a');
  const fillB = document.getElementById('pk-fill-b');
  if (fillA) fillA.style.width = (ratio * 100) + '%';
  if (fillB) fillB.style.width = ((1 - ratio) * 100) + '%';
  pkBar.classList.remove('pk-victory-a', 'pk-victory-b');
  // التاج على الفائز
  const nameA = document.getElementById('pk-name-a'), nameB = document.getElementById('pk-name-b');
  if (nameA && nameA.querySelector('.pk-crown')) nameA.querySelector('.pk-crown').remove();
  if (nameB && nameB.querySelector('.pk-crown')) nameB.querySelector('.pk-crown').remove();
  if (b.status === 'victory') {
    const winnerSide = (b.coins_a || 0) >= (b.coins_b || 0) ? 'a' : 'b';
    pkBar.classList.add(winnerSide === 'a' ? 'pk-victory-a' : 'pk-victory-b');
    const target = winnerSide === 'a' ? nameA : nameB;
    if (target) target.insertAdjacentHTML('afterbegin', '<span class="pk-crown">👑</span> ');
  }
  pkBar.style.display = 'flex';
  // أزرار اختيار الجانب أسفل كل نصف شاشة
  const aBtn = document.getElementById('pk-pick-a'), bBtn = document.getElementById('pk-pick-b');
  if (aBtn) aBtn.classList.toggle('on', pkSide === 'a');
  if (bBtn) bBtn.classList.toggle('on', pkSide === 'b');
}

// تقسيم الشاشة: طرفا PK جنب بعض 50/50
function applyPkLayout(b) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  grid.classList.add('pk-split');
  const meId = state.user?.id;
  let localSide = null, remoteId = null;
  if (b.player_a_id === meId) { localSide = 'a'; remoteId = b.player_b_id; }
  else if (b.player_b_id === meId) { localSide = 'b'; remoteId = b.player_a_id; }
  const clearInline = (t) => { if (!t) return; t.style.bottom = ''; t.style.right = ''; t.style.zIndex = ''; t.style.width = ''; t.style.height = ''; };
  const localTile = document.getElementById('my-video-tile');
  if (localTile) {
    localTile.classList.remove('pk-a', 'pk-b');
    if (localSide) localTile.classList.add(localSide === 'a' ? 'pk-a' : 'pk-b');
  }
  const remoteTile = document.getElementById('video-' + remoteId);
  if (remoteTile) {
    remoteTile.classList.remove('pk-a', 'pk-b');
    remoteTile.classList.add(localSide === 'a' ? 'pk-b' : 'pk-a');
  }
  // إزالة الأنماط المضمنة حتى تسري أنماط التقسيم
  clearInline(localTile);
  clearInline(remoteTile);
}

// اختيار جانبي في PK (بالنقر على نصف الشاشة)
let pkSide = null;
function selectPkSide(side) {
  if (!currentBattle || currentBattle.status !== 'active') return showToast('لا يوجد تحدي PK نشط', 'error');
  pkSide = (pkSide === side) ? null : side;
  const grid = document.getElementById('video-grid');
  if (grid) grid.querySelectorAll('.video-tile').forEach(t => t.classList.remove('pk-side-active'));
  if (pkSide) {
    const tiles = grid ? grid.querySelectorAll('.video-tile') : [];
    const meId = state.user?.id;
    let sel = null;
    if (currentBattle.player_a_id === meId && pkSide === 'a') sel = document.getElementById('my-video-tile');
    else if (currentBattle.player_b_id === meId && pkSide === 'b') sel = document.getElementById('my-video-tile');
    else sel = document.getElementById('video-' + (pkSide === 'a' ? currentBattle.player_a_id : currentBattle.player_b_id));
    if (sel) sel.classList.add('pk-side-active');
    const sideName = pkSide === 'a' ? currentBattle.player_a_name : currentBattle.player_b_name;
    showToast(pkSide ? '🎯 تدعم ' + sideName + ' — اضغط ❤️ للدعم' : 'تم إلغاء اختيار الجانب', 'success');
  }
  renderPkBar(currentBattle);
}

// دعم PK بالقلب (مجاني +1 مع حد)
let pkTapLock = 0;
async function battleTap() {
  if (!currentBattle || currentBattle.status !== 'active') return;
  if (!pkSide) return showToast('اختر جانباً أولاً: انقر على نصف الشاشة الذي تريد دعمه', 'error');
  const now = Date.now();
  if (now - pkTapLock < 350) return;
  pkTapLock = now;
  try {
    const r = await api('POST', '/api/battles/tap', { battleId: currentBattle.id, side: pkSide });
    if (r && r.battle) renderBattle(r.battle);
  } catch(e) { /* throttle */ }
}

// تركيز مربع التعليق من الشريط السفلي
function focusTikTokChat() {
  const input = document.getElementById('tiktok-chat-input');
  if (input) { input.focus(); try { input.scrollIntoView({ block: 'center' }); } catch(e) {} }
}

async function supportBattle(side) {
  if (!currentBattle) return showToast('لا يوجد تحدٍّ نشط', 'error');
  const coins = prompt('🎁 كم <img src="/assets/coin.png" class="coin-ico" alt=""> تدعم به؟', '100');
  if (!coins || parseInt(coins) <= 0) return;
  if (!confirm('⚔️ دعم اللاعب بـ ' + coins + ' 🪙؟')) return;
  try {
    const r = await api('POST', '/api/battles/support', { battleId: currentBattle.id, side, coins });
    showToast(r.message, 'success');
    refreshWalletHeader();
  } catch(e) { showToast(e.message, 'error'); }
}

async function endBattleNow() {
  if (!currentBattle || currentBattle.status !== 'active') return;
  if (!confirm('🏁 إنهاء التحدي الآن؟')) return;
  try { await api('POST', '/api/battles/end', { battleId: currentBattle.id }); } catch(e) { showToast(e.message, 'error'); }
}

// Founder supports himself (boosts his side + raises his family ranking)
async function supportSelfBattle() {
  if (!currentBattle) return;
  const meId = state.user?.id;
  let side = null;
  if (currentBattle.player_a_id === meId) side = 'a';
  else if (currentBattle.player_b_id === meId) side = 'b';
  if (!side) return showToast('أنت لست طرفاً في هذا التحدي', 'error');
  const coins = prompt('🙋 كم <img src="/assets/coin.png" class="coin-ico" alt=""> تدعم نفسك به؟', '100');
  if (!coins || parseInt(coins) <= 0) return;
  if (!confirm('🙋 دعم نفسك بـ ' + coins + ' 🪙؟ (يرفع ترتيب عائلتك أيضاً)')) return;
  try {
    const r = await api('POST', '/api/battles/support', { battleId: currentBattle.id, side, coins });
    showToast(r.message, 'success');
    refreshWalletHeader();
  } catch(e) { showToast(e.message, 'error'); }
}


function openMicManager() {
  const list = document.getElementById('mic-manager-list');
  list.innerHTML = '';
  // Me (founder) always unmuted
  list.innerHTML += '<div class="my-family-item" style="justify-content:space-between;align-items:center;opacity:.85">' +
    '<div><b>' + (state.user?.name || 'أنت') + '</b> <span style="font-size:10px;color:var(--gold)">👑 أنت</span></div>' +
    '<span style="font-size:11px;color:var(--success)">🎙️ مفتوح دائماً</span></div>';
  Object.entries(state.callMembers || {}).forEach(([id, name]) => {
    list.innerHTML += '<div class="my-family-item" style="justify-content:space-between;align-items:center">' +
      '<div><b>' + name + '</b></div>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-sm btn-danger" onclick="micControl(\'' + id + '\', true)">🔇 كتم</button>' +
        '<button class="btn btn-sm btn-success" onclick="micControl(\'' + id + '\', false)">🎙️ فتح</button>' +
      '</div></div>';
  });
  document.getElementById('mic-manager-modal').style.display = 'flex';
}
function micControl(userId, muted) {
  if (!state.activeSession?.id) return;
  socket.emit('mic_control', { sessionId: state.activeSession.id, userId, muted });
  showToast((muted ? '🔇 تم كتم ' : '🎙️ تم فتح مايك ') + (state.callMembers[userId] || 'العضو'), muted ? 'error' : 'success');
}
function muteAllMics() {
  if (!state.activeSession?.id) return;
  if (!confirm('🔇 كتم كل المايكات وتتكلم أنت فقط؟')) return;
  socket.emit('mic_mute_all', { sessionId: state.activeSession.id, exceptId: state.user?.id });
  showToast('🔇 تم كتم الكل - تتكلم أنت فقط', 'error');
}
function unmuteAllMics() {
  if (!state.activeSession?.id) return;
  socket.emit('mic_mute_all', { sessionId: state.activeSession.id, exceptId: null });
  showToast('🎙️ فتحت كل المايكات', 'success');
}

// ==================== FILTER PIPELINE (applied to SENT video) ====================
const CSS_FILTERS = {
  '': '', 'filter-soft': 'blur(.35px) brightness(1.08) contrast(.9) saturate(1.15)',
  'filter-gold': 'sepia(.35) brightness(1.06) saturate(1.3) hue-rotate(-8deg)',
  'filter-pink': 'saturate(1.25) brightness(1.05) hue-rotate(320deg) sepia(.15)',
  'filter-vivid': 'saturate(1.6) contrast(1.08) brightness(1.02)',
  'filter-classic': 'sepia(.45) contrast(1.02) brightness(1.03)',
  'filter-bw': 'grayscale(1) contrast(1.1)'
};
let filterPipeline = null;
let activeFilter = '';

async function applyFilterToFeed(filterClass) {
  const myVideo = document.getElementById('my-video');
  if (!myVideo) return;
  activeFilter = filterClass || '';
  const filterCss = activeFilter ? (CSS_FILTERS[activeFilter] || '') : '';
  // 1) فلتر CSS مباشر على الصورة - تغيير فوري مضمون على الشاشة
  myVideo.style.filter = filterCss;
  if (!localStream) { updateTileFilterUI(); return; }
  const videoTrack = localStream.getVideoTracks()[0];
  // إيقاف لوحة الرسم السابقة
  if (filterPipeline) {
    clearInterval(filterPipeline.timer);
    if (filterPipeline.srcVideo) filterPipeline.srcVideo.remove();
    filterPipeline = null;
  }
  if (!activeFilter) {
    myVideo.srcObject = localStream;
    Object.values(peerConnections).forEach(pc => {
      const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (s) s.replaceTrack(videoTrack).catch(() => {});
    });
    updateTileFilterUI();
    return;
  }
  if (!videoTrack) { updateTileFilterUI(); return; }
  // 2) للبث المرسل للجميع: لوحة رسم (إن دعم المتصفح) - وإلا يبقى الفلتر محلي فقط
  try {
    const srcVideo = document.createElement('video');
    srcVideo.srcObject = localStream;
    srcVideo.autoplay = true;
    srcVideo.playsInline = true;
    srcVideo.muted = true;
    srcVideo.style.display = 'none';
    document.body.appendChild(srcVideo);
    const w = videoTrack.getSettings?.().width || 640;
    const h = videoTrack.getSettings?.().height || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx.filter) throw new Error('no ctx.filter');
    const canvasStream = canvas.captureStream(24);
    const newTrack = canvasStream.getVideoTracks()[0];
    const draw = () => {
      try { ctx.filter = CSS_FILTERS[activeFilter] || 'none'; ctx.drawImage(srcVideo, 0, 0, w, h); } catch(e) {}
    };
    draw();
    const timer = setInterval(draw, 70);
    myVideo.srcObject = canvasStream;
    Object.values(peerConnections).forEach(pc => {
      const s = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (s) s.replaceTrack(newTrack).catch(() => {});
    });
    filterPipeline = { timer, srcVideo };
  } catch(e) {
    // المتصفح لا يدعم لوحة الرسم المفلترة - الفلتر محلي على شاشتك فقط
    myVideo.srcObject = localStream;
  }
  updateTileFilterUI();
}

function toggleTileFilterBar() {
  const bar = document.getElementById('tile-filter-bar');
  if (bar) bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
}
function tileSelectFilter(el) {
  const f = el.dataset.filter || '';
  applyFilterToFeed(f);
  document.querySelectorAll('#tile-filter-bar .filter-opt').forEach(o => o.classList.toggle('selected', o.dataset.filter === f));
  document.getElementById('tile-filter-bar').style.display = 'none';
  showToast(f ? '✨ الفلتر مفعّل - الجميع يشاهدونه' : 'الفلتر متوقف', 'success');
}
function updateTileFilterUI() {
  const bar = document.getElementById('tile-filter-bar');
  if (bar) document.querySelectorAll('#tile-filter-bar .filter-opt').forEach(o => o.classList.toggle('selected', o.dataset.filter === activeFilter));
}

// Exit call with confirmation + back to dashboard
function askExitCall() {
  document.getElementById('exit-call-modal').style.display = 'flex';
}
function confirmExitCall(go) {
  document.getElementById('exit-call-modal').style.display = 'none';
  if (go) {
    // المؤسس/فاتح البث: ✕ يغلق البث للجميع
    const isHostUser = state.isFounder || state.user?.role === 'admin';
    if (isHostUser && state.activeSession?.id) {
      closePopOut();
      closeDiwaniya();
      return;
    }
    const leftSession = state.activeSession?.id;
    const leftUser = state.user?.id;
    // Tell everyone in the chat that I left
    if (socket?.connected && leftSession && leftUser) {
      socket.emit('diwaniya_leave', { sessionId: leftSession, userId: leftUser });
    }
    closePopOut();
    leaveLiveAudio();
    // Close the diwaniya FOR ME (others keep theirs)
    state.diwaniyaOpen = false;
    state.activeSession = null;
    stopDiwaniyaTimer();
    enableChat(false);
    stopMessagePolling();
    const btn = document.getElementById('diwaniya-toggle-btn');
    if (btn) btn.textContent = '🔓 فتح الديوانية';
    const stat = document.getElementById('stat-diwaniya');
    if (stat) stat.textContent = '🔴 متوقفة';
    setTimeout(() => navigateTo('dashboard'), 300);
    showToast('🚪 خرجت من الديوانية - أهلاً بك في الرئيسية', 'success');
  }
}

// Connected families (in the broadcast) - invite to join & chat, then battle
async function openConnectedFamilies() {
  const list = document.getElementById('connected-families-list');
  list.innerHTML = '<div class="empty-state"><div class="empty-text">جاري التحميل...</div></div>';
  document.getElementById('families-modal').style.display = 'flex';
  try {
    const { founders } = await api('GET', '/api/founders/online');
    if (!founders?.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد عوائل متصلة حالياً</div></div>';
      return;
    }
    const inCallIds = Object.keys(state.callMembers || {});
    // ONLY founders currently in the broadcast (+ the test bot always)
    let inBroadcast = founders.filter(f => inCallIds.includes(f.id));
    const bot = founders.find(f => (f.name || '').includes('بوت'));
    if (bot && !inBroadcast.includes(bot)) inBroadcast.unshift(bot);
    if (!inBroadcast.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">لا يوجد مؤسسون في البث حالياً<br><small style="color:var(--text-muted)">ادعُ عائلة للانضمام أولاً من المحادثة</small></div></div>';
      return;
    }
    list.innerHTML = inBroadcast.map(f => {
      const isBot = (f.name || '').includes('بوت');
      return '<div class="my-family-item founder-row" onclick="' + (isBot ? 'inviteToBroadcast(\'' + f.id + '\')' : 'inviteToBroadcast(\'' + f.id + '\')') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;width:100%">' +
          '<div><b style="color:var(--gold)">' + (f.name || 'مؤسس') + '</b> <span class="online-status online">' + (isBot ? '🤖 بوت - يقبل فوراً' : '● في البث') + '</span>' +
          '<div style="font-size:11px;color:var(--text-muted)">👪 ' + (f.family_name || 'عائلة') + ' · ' + (f.subscription_code || '') + '</div></div>' +
          '<span style="font-size:18px;color:var(--gold)">⚔️</span>' +
        '</div>' +
      '</div>';
    }).join('');
    list.innerHTML += '<p style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:8px">اضغط على اسم المؤسس لإرسال دعوة التحدي 📨</p>';
  } catch(e) { list.innerHTML = '<div class="empty-text">فشل التحميل</div>'; }
}

async function inviteToBroadcast(founderId) {
  if (!state.activeSession?.id) return showToast('افتح الديوانية أولاً', 'error');
  try {
    const r = await api('POST', '/api/battles/join-invite', { toUserId: founderId, sessionId: state.activeSession.id });
    showToast(r.message, 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function challengeFromFamilies(founderId) {
  const duration = prompt('⏱️ مدة التحدي (دقائق)؟', '3');
  if (!duration) return;
  try {
    const r = await api('POST', '/api/battles/start', { opponentId: founderId, sessionId: null, durationMinutes: duration });
    showToast(r.message, 'success');
    document.getElementById('families-modal').style.display = 'none';
  } catch(e) { showToast(e.message, 'error'); }
}

let pendingFamilyJoin = null;
function respondFamilyJoin(accept) {
  if (accept && pendingFamilyJoin) {
    // Join the broadcast as a guest - chat first, battle later
    state._guestSessionId = pendingFamilyJoin.sessionId;
    joinAsGuest();
    api('POST', '/api/battles/join-invite-response', { toUserId: pendingFamilyJoin.fromId, accept: true }).catch(() => {});
  } else if (pendingFamilyJoin) {
    // Reject: notify the challenger with the family name
    api('POST', '/api/battles/join-invite-response', { toUserId: pendingFamilyJoin.fromId, accept: false }).catch(() => {});
    showToast('رفضت الدعوة', 'error');
  }
  document.getElementById('family-join-modal').style.display = 'none';
  pendingFamilyJoin = null;
}

async function joinAsGuest() {
  try {
    if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    inLiveCall = true;
    const sessId = state._guestSessionId;
    // Fetch session to know its mode
    let s = state.activeSession;
    if (!s?.id || s.id !== sessId) {
      try { const r = await api('GET', '/api/diwaniya/active?sessionId=' + sessId); s = r.session || null; } catch(e) {}
      if (!s) { s = { id: sessId, mode: 'video' }; }
      state.activeSession = s;
      state.diwaniyaOpen = true;
    }
    socket.emit('join_audio_call', { sessionId: sessId, userId: state.user.id, userName: state.user.name, isObserver: false, wantsVideo: true });
    updateAudioCallUI(true);
    startCallWatermark();
    setTikTokMode(true);
    state.callMembers = {};
    updateCallPresence();
    showToast('📨 انضممت لبث عائلة أخرى - سولفوا ثم التحدي ⚔️', 'success');
  } catch(e) { showToast('فشل الانضمام: ' + (e.message || 'خطأ'), 'error'); }
}

// Show online founders + challenge one
async function openFounderBattleModal() {
  const list = document.getElementById('online-founders-list');
  list.innerHTML = '<div class="empty-state"><div class="empty-text">جاري التحميل...</div></div>';
  document.getElementById('founder-battle-modal').style.display = 'flex';
  try {
    const { founders } = await api('GET', '/api/founders/online');
    if (!founders?.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">لا يوجد مؤسسون متصلون حالياً</div></div>';
      return;
    }
    list.innerHTML = founders.map(f =>
      '<div class="my-family-item" style="justify-content:space-between;align-items:center">' +
        '<div><b>' + (f.name || 'مؤسس') + '</b><div style="font-size:11px;color:var(--text-muted)">👪 ' + (f.family_name || 'عائلة') + ' · رمز: ' + (f.subscription_code || '-') + '</div></div>' +
        '<button class="btn btn-sm btn-accent" onclick="startFounderBattle(\'' + f.id + '\')">⚔️ تحدي</button>' +
      '</div>'
    ).join('');
  } catch(e) { list.innerHTML = '<div class="empty-text">فشل التحميل</div>'; }
}

async function startFounderBattle(opponentId) {
  const duration = document.getElementById('founder-battle-duration')?.value || '3';
  try {
    const result = await api('POST', '/api/battles/start', { opponentId, sessionId: null, durationMinutes: duration });
    showToast(result.message, 'success');
    document.getElementById('founder-battle-modal').style.display = 'none';
  } catch(e) { showToast(e.message, 'error'); }
}

// Victory round timer (2 minutes) - line shows then disappears
let victoryTimer = null;
function startVictoryTimer() {
  if (victoryTimer) clearInterval(victoryTimer);
  const bar = document.getElementById('battle-bar');
  const timerEl = document.getElementById('battle-timer');
  let left = 120;
  if (timerEl) timerEl.textContent = '🏆 جولة النصر: ' + Math.floor(left/60) + ':' + String(left%60).padStart(2,'0');
  victoryTimer = setInterval(() => {
    left--;
    if (timerEl) timerEl.textContent = '🏆 جولة النصر: ' + Math.floor(left/60) + ':' + String(left%60).padStart(2,'0');
    if (left <= 0) {
      clearInterval(victoryTimer);
      renderBattle(null);
    }
  }, 1000);
}

// ==================== LIVEKIT REAL BROADCAST ====================
let lkRoom = null;
let lkMode = null; // 'host' | 'viewer'

async function getLiveKitToken(room, role) {
  const r = await api('POST', '/api/livekit/token', { room, role });
  return r;
}

async function toggleLiveKitBroadcast() {
  if (lkRoom) return stopLiveKitBroadcast();
  if (!state.activeSession?.id) return showToast('افتح الديوانية أولاً', 'error');
  try {
    const { token, url, identity } = await getLiveKitToken(state.activeSession.id, 'host');
    const room = new LivekitClient.Room({ adaptiveStream: true });
    room.on('trackPublished', (pub) => {
      if (pub.track) {
        const el = document.getElementById('lk-video');
        if (el) { el.srcObject = new MediaStream([pub.track]); el.style.display = 'block'; }
      }
    });
    room.on('trackSubscribed', (track) => {
      const el = document.getElementById('lk-video');
      if (el) { el.srcObject = new MediaStream([track]); el.style.display = 'block'; }
    });
    room.on('participantDisconnected', () => { updateViewerCount(); });
    await room.connect(url, token);
    // نشر الكاميرا والمايك
    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);
    lkRoom = room;
    lkMode = 'host';
    // إخفاء فيديو P2P وإظهار فيديو البث
    const myVideo = document.getElementById('my-video');
    if (myVideo) myVideo.style.display = 'none';
    const btn = document.getElementById('lk-broadcast-btn');
    if (btn) btn.textContent = '⏹️ إيقاف البث المباشر';
    showToast('🎬 بدأ البث المباشر! المشاهدون يرونك الآن', 'success');
    // إظهار زر المشاهدة للآخرين عبر السيرفر (فيسبوكي) - نكتفي بالإشعار
    io?.emit && socket.emit('broadcast_started', { sessionId: state.activeSession.id, hostName: state.user.name });
    updateViewerCount();
  } catch(e) { showToast('فشل البث: ' + (e.message || ''), 'error'); }
}

async function stopLiveKitBroadcast() {
  try { await lkRoom?.disconnect(); } catch(e) {}
  lkRoom = null; lkMode = null;
  const el = document.getElementById('lk-video');
  if (el) { el.srcObject = null; el.style.display = 'none'; }
  const myVideo = document.getElementById('my-video');
  if (myVideo && localStream) { myVideo.srcObject = localStream; myVideo.style.display = 'block'; }
  const btn = document.getElementById('lk-broadcast-btn');
  if (btn) btn.textContent = '🎬 بث مباشر (جمهور)';
  showToast('⏹️ توقف البث المباشر', 'error');
}

async function watchLiveKitBroadcast() {
  if (lkRoom) return stopLiveKitBroadcast();
  if (!state.activeSession?.id) return showToast('لا يوجد بث نشط', 'error');
  try {
    const { token, url } = await getLiveKitToken(state.activeSession.id, 'viewer');
    const room = new LivekitClient.Room({ adaptiveStream: true });
    room.on('trackSubscribed', (track) => {
      const el = document.getElementById('lk-video');
      if (el) { el.srcObject = new MediaStream([track]); el.style.display = 'block'; }
    });
    room.on('participantConnected', () => { if (typeof updateViewerCount === 'function') updateViewerCount(); });
    await room.connect(url, token);
    lkRoom = room;
    lkMode = 'viewer';
    // مشاهدة كاملة: إخفاء كاميرتي وفتح شاشة البث
    const myVideo = document.getElementById('my-video');
    if (myVideo) myVideo.style.display = 'none';
    const btn = document.getElementById('lk-watch-btn');
    if (btn) btn.textContent = '⏹️ خروج من المشاهدة';
    showToast('👀 أنت تشاهد البث الآن', 'success');
    updateViewerCount();
  } catch(e) { showToast('فشل المشاهدة: ' + (e.message || ''), 'error'); }
}

// إشعار بدء البث للأعضاء
socket?.on('broadcast_started', (data) => {
  const btn = document.getElementById('lk-watch-btn');
  if (btn && !lkRoom) btn.style.display = 'block';
  if (data?.hostName && data.hostName !== state.user?.name) {
    showToast('🎬 ' + data.hostName + ' بدأ بثاً مباشراً - شاهد الآن!', 'success');
  }
});

// ==================== TIKTOK LIVE (hearts, host info, viewers) ====================
function updateTikTokLiveInfo() {
  const lv = parseInt(state.user?.level) || 0;
  const lvEl = document.getElementById('tt-host-level');
  if (lvEl) lvEl.innerHTML = (lv >= 0 && lv <= 100) ? '<img src="/assets/levels/level_' + lv + '.' + (lv >= 1 && lv <= 10 ? 'gif' : 'png') + '?v=5" style="width:40px;height:15px;vertical-align:middle">' + '<span class="tt-host-lv-num">' + lv + '</span>' : '';
  const nameEl = document.getElementById('tt-host-name-text');
  if (nameEl) nameEl.textContent = state.user?.name || '';
  const avEl = document.getElementById('tt-host-avatar');
  if (avEl) avEl.innerHTML = (state.user?.avatar && state.user.avatar.startsWith('data:')) ? '<img src="' + state.user.avatar + '">' : (state.user?.avatar || '👤');
  const famEl = document.getElementById('tt-host-family');
  if (famEl) {
    famEl.textContent = state.family?.name || '';
    // شارة مستوى/توثيق العائلة بجانب الاسم + مستوى العائلة
    const fv = state.family?.verif_tier || 'none';
    const flv = parseInt(state.family?.family_level) || 0;
    let famHtml = escapeHtml(state.family?.name || '');
    if (fv !== 'none') famHtml += ' ' + verifBadge(fv, 15);
    if (flv >= 1 && flv <= 100) {
      famHtml += ' <img src="/assets/levels/level_' + flv + '.' + (flv >= 1 && flv <= 10 ? 'gif' : 'png') + '?v=5" style="width:40px;height:15px;vertical-align:middle"> <span class="tt-host-lv-num">' + flv + '</span>';
    }
    famEl.innerHTML = famHtml;
  }
}

function updateViewerCount() {
  const el = document.getElementById('tt-viewer-count');
  if (el) el.textContent = (Object.keys(state.callMembers || {}).length + 1);
}

let ttLikes = 0;
function sendTtHeart() {
  // في وضع PK: القلب = دعم الجانب المختار (+1 مجاني)
  if (currentBattle && currentBattle.status === 'active') {
    battleTap();
  }
  ttLikes++;
  const cnt = document.getElementById('tt-like-count');
  if (cnt) cnt.textContent = ttLikes;
  const cntTop = document.getElementById('tt-top-count-num');
  if (cntTop) cntTop.textContent = ttLikes;
  const cntBar = document.getElementById('tt-bar-like-count');
  if (cntBar) cntBar.textContent = ttLikes;
  const layer = document.getElementById('tt-hearts-layer');
  if (!layer) return;
  const heart = document.createElement('div');
  heart.className = 'tt-heart';
  heart.textContent = '❤️';
  heart.style.left = (30 + Math.random() * 40) + '%';
  heart.style.animationDelay = (Math.random() * .3) + 's';
  layer.appendChild(heart);
  setTimeout(() => heart.remove(), 2500);
}

// ==================== TIKTOK CHAT (on the black screen) ====================
function sendTikTokChat() {
  const input = document.getElementById('tiktok-chat-input');
  const text = input.value.trim();
  if (!text || !state.diwaniyaOpen) return;
  input.value = '';
  if (socket?.connected) {
    socket.emit('diwaniya_message', { sessionId: state.activeSession.id, userId: state.user.id, message: text });
  } else {
    api('POST', '/api/diwaniya/message', { sessionId: state.activeSession.id, message: text }).catch(() => {});
  }
}

function addTikTokChatMessage(name, text, isSent, level, verif) {
  const list = document.getElementById('tiktok-chat-list');
  if (!list) return;
  const msg = document.createElement('div');
  msg.className = 'tiktok-chat-msg' + (isSent ? ' mine' : '');
  const lvBadge = levelImgHtml(level);
  msg.innerHTML = '<span class="tiktok-chat-name">' + (name || '') + '</span> ' + lvBadge + verifBadge(verif, 16) + escapeHtml(text);
  list.appendChild(msg);
  // Keep max 30 messages
  while (list.children.length > 30) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function syncTikTokChat() {
  // Re-render from the main chat room messages if available (keeps level + verification badges)
  const list = document.getElementById('tiktok-chat-list');
  const room = document.getElementById('chat-room');
  if (!list || !room) return;
  list.innerHTML = '';
  Array.from(room.querySelectorAll('.chat-msg')).forEach(m => {
    const senderEl = m.querySelector('.chat-sender');
    const nameEl = senderEl?.firstChild;
    const name = nameEl ? (nameEl.textContent || '') : (senderEl?.textContent || '');
    const text = m.querySelector('.chat-bubble')?.textContent || '';
    const isSent = m.classList.contains('sent');
    const lvImg = senderEl?.querySelector('img');
    const lvHtml = lvImg ? lvImg.outerHTML : '';
    const fvBadge = senderEl?.querySelector('.fv-badge');
    const fvHtml = fvBadge ? fvBadge.outerHTML : '';
    const msg = document.createElement('div');
    msg.className = 'tiktok-chat-msg' + (isSent ? ' mine' : '');
    msg.innerHTML = '<span class="tiktok-chat-name">' + escapeHtml(name) + '</span> ' + lvHtml + fvHtml + escapeHtml(text);
    list.appendChild(msg);
  });
  while (list.children.length > 30) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}

// TikTok mode: self big + participants as small corner tiles
function setTikTokMode(on) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  grid.classList.toggle('tiktok-mode', on);
  grid.classList.toggle('audio-mode', on); // audio-only: black + avatar circles
  const tk = document.getElementById('tiktok-chat');
  if (tk) tk.style.display = on ? 'flex' : 'none';
  const btn = document.getElementById('tiktok-mode-btn');
  if (btn) btn.classList.toggle('zoom', on);
  if (on) {
    setTimeout(syncTikTokChat, 300);
    ensureAudioOverlays();
    setTimeout(() => { if (!recentCommentsLoaded) loadRecentComments(); }, 800);
    showChatPanel();
  } else {
    recentCommentsLoaded = false;
  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// Ensure every tile shows the avatar circle in audio mode
function ensureAudioOverlays() {
  const myTile = document.getElementById('my-video-tile');
  if (myTile && !myTile.querySelector('.cam-off-overlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'cam-off-overlay';
    overlay.style.display = 'none';
    const av = state.user?.avatar || '';
    const isImg = av.startsWith('data:') || av.startsWith('http') || av.startsWith('/');
    overlay.innerHTML = isImg
      ? '<img class="cam-off-img" src="' + av + '" alt=""><div class="cam-off-chip">🚫 كاميرا مغلقة</div>'
      : '<div class="cam-off-circle">' + avatarHtml(av) + '</div><div class="cam-off-icon">🚫</div><div class="cam-off-label">كاميرا مغلقة</div>';
    myTile.appendChild(overlay);
  }
  document.querySelectorAll('.video-tile:not(.local)').forEach(tile => {
    if (!tile.querySelector('.cam-off-overlay')) {
      const pid = (tile.id || '').replace('video-', '');
      const overlay = document.createElement('div');
      overlay.className = 'cam-off-overlay';
      overlay.style.display = 'none';
      overlay.innerHTML = '<div class="cam-off-circle">' + avatarHtml(peerAvatars[pid]) + '</div><div class="cam-off-icon">🚫</div><div class="cam-off-label">كاميرا مغلقة</div>';
      tile.appendChild(overlay);
    }
  });
}

function toggleTikTokMode() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const on = !grid.classList.contains('tiktok-mode');
  setTikTokMode(on);
  showToast(on ? '🎬 وضع تيك توك - أنت كبير والدردشة تحت' : '🖼 وضع الشبكة - بجوار بعض', 'success');
}

// Tap on any video tile to zoom / PK side select
function bindVideoTileZoom() {
  document.getElementById('video-grid')?.addEventListener('click', (e) => {
    // Ignore clicks on chat/buttons - only the video area opens fullscreen
    if (e.target.closest('.tiktok-chat') || e.target.closest('.tt-heart-btn') || e.target.closest('button,input,select,textarea') || e.target.closest('.tt-bottom-bar') || e.target.closest('.pk-bar')) return;
    const tile = e.target.closest('.video-tile');
    if (!tile) return;
    // في PK: النقر على نصف شاشة طرف = اختياره للدعم
    if (currentBattle && (currentBattle.status === 'active' || currentBattle.status === 'victory') && (tile.classList.contains('pk-a') || tile.classList.contains('pk-b'))) {
      const side = tile.classList.contains('pk-a') ? 'a' : 'b';
      selectPkSide(side);
      return;
    }
    toggleCallFullscreen();
  }, true);
}
if (document.readyState !== 'loading') bindVideoTileZoom();
else document.addEventListener('DOMContentLoaded', bindVideoTileZoom);
setTimeout(bindVideoTileZoom, 2000);

// ==================== WALLET HEADER REFRESH ====================
async function refreshWalletHeader() {
  try {
    const { wallet } = await api('GET', '/api/wallet');
    state.coins = wallet.coins || 0;
    const el = document.getElementById('header-coins');
    if (el) el.textContent = state.coins;
  } catch(e) {}
}

// ==================== FAMILY IMAGE (founder) ====================
let familyImageBase64 = '';

function previewFamilyImage(input) {
  const file = input.files?.[0];
  const preview = document.getElementById('family-image-preview');
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('الصورة كبيرة - الحد الأقصى 2MB', 'error');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    familyImageBase64 = e.target.result;
    if (preview) { preview.src = familyImageBase64; preview.style.display = 'block'; }
  };
  reader.readAsDataURL(file);
}

function showFamilyWins() {
  const card = document.getElementById('family-wins-card');
  const cups = document.getElementById('family-wins-cups');
  const wins = parseInt(state.family?.battle_wins) || 0;
  if (card) card.style.display = state.isFounder ? 'block' : 'none';
  if (cups) cups.textContent = wins > 0 ? '🏆'.repeat(Math.min(wins, 10)) : 'لا توجد كؤوس بعد';
}

function showFamilyImageInUI() {
  showFamilyWins();
  const card = document.getElementById('family-image-card');
  if (card) card.style.display = state?.isFounder ? 'block' : 'none';
  const img = document.getElementById('family-image-current');
  if (img && state?.family?.image && state.family.image.startsWith('data:')) {
    img.src = state.family.image;
    img.style.display = 'block';
  } else if (img) { img.style.display = 'none'; }
}

async function saveFamilyImage() {
  if (!familyImageBase64) return showToast('اختر صورة أولاً', 'error');
  try {
    const { family } = await api('POST', '/api/family/edit', { image: familyImageBase64 });
    state.family = family;
    familyImageBase64 = '';
    const fileEl = document.getElementById('family-image-file');
    if (fileEl) fileEl.value = '';
    const prev = document.getElementById('family-image-preview');
    if (prev) { prev.style.display = 'none'; prev.src = ''; }
    showFamilyImageInUI();
    updateAllUI();
    showToast('✅ تم حفظ صورة العائلة', 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

// ==================== FAMILY PAGE LOAD ====================
async function loadFamilyPageData() {
  showFamilyImageInUI();
  try {
    const { members } = await api('GET', '/api/family/members');
    state.members = members || [];
    updateMembersList();
  } catch(e) {}
  loadAnnouncements();
  populateAnnTarget();
  populateManagerSelect();
}

// عرض الصورة بشكل صحيح (base64/رابط/إيموجي) في أي عنصر
function setAvatarEl(el, avatar, fallback) {
  if (!el) return;
  const av = avatar || '';
  if (av.startsWith('data:') || av.startsWith('http') || av.startsWith('/')) {
    el.innerHTML = '<img src="' + av + '" alt="">';
  } else {
    el.textContent = av || fallback || '👤';
  }
}
function avatarHtml(avatar) {
  if (avatar && avatar.startsWith('data:')) return '<img src="' + avatar + '" alt="">';
  return '<div class="avatar-emoji">' + (avatar || '👤') + '</div>';
}

// ==================== PRESET AVATARS (صور جاهزة للمؤسس) ====================
const PRESET_AVATARS = [
  { emoji: '🧔', bg1: '#2b3a67', bg2: '#0e1526' },
  { emoji: '👨‍🦱', bg1: '#5b2c6f', bg2: '#1a0f2e' },
  { emoji: '👨‍🦳', bg1: '#6d4c41', bg2: '#2c1a12' },
  { emoji: '👩‍🦰', bg1: '#8d2f47', bg2: '#33101c' },
  { emoji: '👧', bg1: '#1f6f5c', bg2: '#0b2e25' },
  { emoji: '🦸', bg1: '#7a3c1d', bg2: '#2b1205' },
  { emoji: '🧙', bg1: '#3c3f92', bg2: '#14163f' },
  { emoji: '🤴', bg1: '#a67c00', bg2: '#3d2d00' },
  { emoji: '👳', bg1: '#2874a6', bg2: '#0d2b40' },
  { emoji: '🐱', bg1: '#c2672f', bg2: '#4a240b' },
  { emoji: '🦁', bg1: '#8a6d1f', bg2: '#33280a' },
  { emoji: '🦅', bg1: '#5d4037', bg2: '#221712' },
];
function presetAvatarDataURI(emoji, bg1, bg2) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + bg1 + '"/><stop offset="1" stop-color="' + bg2 + '"/></linearGradient></defs>' +
    '<rect width="200" height="200" rx="100" fill="url(#g)"/>' +
    '<circle cx="100" cy="100" r="86" fill="rgba(255,255,255,.08)"/>' +
    '<text x="100" y="135" font-size="120" text-anchor="middle">' + emoji + '</text></svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
function renderPresetAvatars() {
  const box = document.getElementById('preset-avatars-grid');
  if (!box) return;
  box.innerHTML = PRESET_AVATARS.map((p, i) => {
    const uri = presetAvatarDataURI(p.emoji, p.bg1, p.bg2);
    return '<div class="preset-avatar" onclick="choosePresetAvatar(' + i + ')" title="اختر هذه الصورة">' +
      '<img src="' + uri + '" alt="' + p.emoji + '"></div>';
  }).join('');
}
let chosenPresetIndex = -1;
function choosePresetAvatar(i) {
  const p = PRESET_AVATARS[i];
  if (!p) return;
  chosenPresetIndex = i;
  profileAvatarBase64 = presetAvatarDataURI(p.emoji, p.bg1, p.bg2);
  const preview = document.getElementById('profile-avatar-preview');
  if (preview) { preview.src = profileAvatarBase64; preview.style.display = 'block'; }
  document.querySelectorAll('#preset-avatars-grid .preset-avatar').forEach((el, idx) => el.classList.toggle('selected', idx === i));
  showToast('🎨 اخترت صورة جاهزة — اضغط حفظ التعديلات', 'success');
}

function setRemoteCamOverlay(peerId, off) {
  const tile = document.getElementById('video-' + peerId);
  if (!tile) return;
  const overlay = tile.querySelector('.cam-off-overlay');
  const video = tile.querySelector('video');
  if (overlay) overlay.style.display = off ? 'flex' : 'none';
  if (video) video.style.display = off ? 'none' : 'block';
}

function addRemoteAudio(peerId, peerName, stream) {
  // Remove old elements if exist
  const old = document.getElementById('audio-' + peerId);
  if (old) old.remove();
  const oldV = document.getElementById('video-' + peerId);
  if (oldV) oldV.remove();
  
  const audio = document.createElement('audio');
  audio.id = 'audio-' + peerId;
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.controls = false;
  audio.style.display = 'none';
  document.body.appendChild(audio);
  
  // Create video tile
  const videoGrid = document.getElementById('video-grid');
  if (videoGrid) {
    const tile = document.createElement('div');
    tile.id = 'video-' + peerId;
    tile.className = 'video-tile';
    tile.innerHTML =
      '<video autoplay playsinline muted></video>' +
      '<div class="screen-badge" style="display:none">🖥️ شاشة</div>' +
      '<div class="screen-controls" style="display:none">' +
        '<button onclick="screenRotateBtn(\'' + peerId + '\')" title="تدوير الشاشة">🔄</button>' +
        '<button onclick="screenFullscreenBtn(\'' + peerId + '\')" title="تكبير بالملء">⛶</button>' +
      '</div>' +
      '<div class="cam-off-overlay" style="display:none">' +
        '<div class="cam-off-circle">' + avatarHtml(peerAvatars[peerId]) + '</div>' +
        '<div class="cam-off-icon">🚫</div>' +
        '<div class="cam-off-label">كاميرا مغلقة</div>' +
      '</div>' +
      '<div class="video-name">' + peerName + '</div>';
    videoGrid.appendChild(tile);
    // لو المؤسس يشارك شاشته بالفعل (انضممت بعد بدء المشاركة) -> فعّل العرض الكبير
    if (remoteScreenShare[peerId]) applyScreenShareToTile(peerId, true);
    // ترتيب بلاطات الأعضاء: عمود على اليمين (بدل nth-of-type الذي ينكسر بالعناصر الجديدة)
    const peerTiles = [...videoGrid.querySelectorAll('.video-tile:not(.local)')];
    const idx = peerTiles.indexOf(tile);
    tile.style.bottom = (10 + (idx % 6) * 150) + 'px';
    tile.style.right = '10px';
    tile.style.zIndex = 30;
    const video = tile.querySelector('video');
    const videoTracks = stream.getVideoTracks();
    // If participant has NO video track at all (audio-only listener) -> show overlay
    if (!videoTracks.length) {
      setRemoteCamOverlay(peerId, true);
    } else {
      const videoStream = new MediaStream(videoTracks);
      video.srcObject = videoStream;
      // Track mute/unmute -> camera on/off
      videoTracks.forEach(t => {
        t.onmute = () => setRemoteCamOverlay(peerId, true);
        t.onunmute = () => setRemoteCamOverlay(peerId, false);
        if (t.muted || !t.enabled) setRemoteCamOverlay(peerId, true);
      });
    }
    videoGrid.appendChild(tile);
  }
  
  // Setup speaking detection for this peer
  setupSpeakingDetection(peerId, peerName, stream);
  
  // Presence list is rendered by updateCallPresence (from callMembers)
}

let founderActionTarget = null; // { userId, action }

// ==================== CAMERA INVITE (founder -> member) ====================
function openCameraInvite() {
  const sel = document.getElementById('cam-invite-target');
  if (!sel) return;
  sel.innerHTML = '<option value="">اختر العضو...</option>';
  const members = state.callMembers || {};
  if (!Object.keys(members).length) return showToast('لا يوجد متواجدون في البث حالياً', 'error');
  Object.entries(members).forEach(([id, name]) => {
    sel.innerHTML += '<option value="' + id + '">' + name + '</option>';
  });
  document.getElementById('cam-invite-modal').style.display = 'flex';
}

function sendCameraInvite() {
  const to = document.getElementById('cam-invite-target')?.value;
  if (!to) return showToast('اختر العضو', 'error');
  socket.emit('camera_invite', {
    to,
    sessionId: state.activeSession?.id,
    founderId: state.user?.id,
    founderName: state.user?.name
  });
  document.getElementById('cam-invite-modal').style.display = 'none';
  showToast('📹 تم إرسال دعوة الكاميرا - بانتظار الموافقة', 'success');
}

// Member: accept/decline camera invite
async function enableMyCamera() {
  try {
    if (!localStream) return false;
    let videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) {
      const ms = await navigator.mediaDevices.getUserMedia({ video: true });
      videoTrack = ms.getVideoTracks()[0];
      if (!videoTrack) return false;
      localStream.addTrack(videoTrack);
      // Send new video track to all peers
      Object.entries(peerConnections).forEach(([pid, pc]) => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack).catch(() => {});
        else { try { pc.addTrack(videoTrack, localStream); } catch(e) {} }
        // Renegotiate
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
          socket.emit('audio_offer', {
            to: pid, offer: pc.localDescription,
            sessionId: state.activeSession?.id,
            userName: state.user?.name
          });
        }).catch(() => {});
      });
    } else {
      videoTrack.enabled = true;
    }
    camOff = false;
    const myVideo = document.getElementById('my-video');
    if (myVideo) { myVideo.srcObject = localStream; myVideo.style.display = 'block'; }
    const camBtn = document.getElementById('cam-toggle-btn');
    if (camBtn) { camBtn.classList.remove('off'); }
    const myTile = document.getElementById('my-video-tile');
    const ov = myTile?.querySelector('.cam-off-overlay');
    if (ov) ov.style.display = 'none';
    if (socket?.connected && state.activeSession?.id) {
      socket.emit('camera_state', { sessionId: state.activeSession.id, on: true });
    }
    return true;
  } catch(e) { console.error('Camera enable error:', e); return false; }
}

let pendingCameraInvite = null;
let selectedInviteMode = 'both';
let selectedInviteFilter = '';

function selectInviteFilter(el) {
  document.querySelectorAll('.filter-opt').forEach(f => f.classList.remove('selected'));
  el.classList.add('selected');
  selectedInviteFilter = el.dataset.filter || '';
}

function selectInviteMode(el) {
  document.querySelectorAll('.invite-mode').forEach(m => m.classList.remove('selected'));
  el.classList.add('selected');
  selectedInviteMode = el.dataset.mode;
}

function respondCameraInvite(accept) {
  const modal = document.getElementById('camera-invite-modal');
  if (accept && !pendingCameraInvite) return;
  if (accept) {
    const wantCam = selectedInviteMode === 'both' || selectedInviteMode === 'cam_mute';
    const wantMic = selectedInviteMode === 'both' || selectedInviteMode === 'audio_only';
    // Apply mic state
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = wantMic);
      micMuted = !wantMic;
      const micBtn = document.getElementById('mic-toggle-btn');
      if (micBtn) micBtn.classList.toggle('muted', !wantMic);
    }
    if (wantCam) {
      enableMyCamera().then(ok => {
        // Apply the chosen filter to the SENT feed (everyone sees it)
        if (ok) applyFilterToFeed(selectedInviteFilter);
        socket.emit('camera_invite_response', { to: pendingCameraInvite.founderId, accept: ok, inviteeName: state.user?.name });
        showToast(ok ? '🎥 تم تشغيل كاميرتك - أنت الآن بالمشاركة!' : 'تعذر تشغيل الكاميرا', ok ? 'success' : 'error');
      });
    } else {
      // Camera stays off
      if (localStream) {
        camOff = true;
        localStream.getVideoTracks().forEach(t => t.enabled = false);
        const camBtn = document.getElementById('cam-toggle-btn');
        if (camBtn) camBtn.classList.add('off');
        const myVideo = document.getElementById('my-video');
        if (myVideo) myVideo.style.display = 'none';
      }
      socket.emit('camera_invite_response', { to: pendingCameraInvite.founderId, accept: true, inviteeName: state.user?.name });
      showToast('✅ وافقت على المشاركة' + (wantMic ? '' : ' بدون صوت'), 'success');
    }
  } else {
    socket.emit('camera_invite_response', { to: pendingCameraInvite?.founderId, accept: false, inviteeName: state.user?.name });
    showToast('❌ رفضت الدعوة', 'error');
  }
  pendingCameraInvite = null;
  if (modal) modal.style.display = 'none';
}

// Founder: kick member from diwaniya (any mode) - with reason
function kickFromDiwaniya(userId) {
  founderActionTarget = { userId, action: 'kick' };
  openFounderActionModal();
}

// Founder: restrict member (listen only) - with reason
function restrictMember(userId) {
  founderActionTarget = { userId, action: 'restrict' };
  openFounderActionModal();
}

async function openFounderActionModal() {
  const isKick = founderActionTarget.action === 'kick';
  document.getElementById('founder-action-title').textContent = isKick ? '👢 سبب طرد العضو' : '🙊 سبب تقييد العضو';
  const name = document.getElementById('participant-' + founderActionTarget.userId)?.textContent?.replace(/[⛔🙊]/g, '')?.trim() || 'العضو';
  document.getElementById('founder-action-victim').textContent = 'العضو: ' + name;
  // Load templates
  try {
    const { templates } = await api('GET', '/api/violations/templates');
    const sel = document.getElementById('founder-action-reason');
    sel.innerHTML = '<option value="">اختر السبب...</option>' +
      (templates || []).map(t => '<option value="' + t.name + '">' + (t.icon || '🚫') + ' ' + t.name + '</option>').join('') +
      '<option value="__custom__">✍️ سبب آخر...</option>';
  } catch(e) {}
  document.getElementById('founder-action-modal').style.display = 'flex';
}

function founderActionCustom() {
  const v = document.getElementById('founder-action-reason').value;
  document.getElementById('founder-action-custom-wrap').style.display = v === '__custom__' ? 'block' : 'none';
}

async function confirmFounderAction() {
  if (!founderActionTarget) return;
  let reason = document.getElementById('founder-action-reason').value;
  if (reason === '__custom__') reason = document.getElementById('founder-action-custom').value.trim();
  if (!reason) return showToast('اختر أو اكتب سبب ' + (founderActionTarget.action === 'kick' ? 'الطرد' : 'التقييد'), 'error');
  const { userId, action } = founderActionTarget;
  const sessionId = state.activeSession?.id;
  if (!sessionId) return;
  try {
    const endpoint = action === 'kick' ? '/api/diwaniya/kick' : '/api/diwaniya/restrict';
    const result = await api('POST', endpoint, { userId, sessionId, reason, restricted: action === 'restrict' });
    showToast(result.message, 'success');
    document.getElementById('founder-action-modal').style.display = 'none';
    founderActionTarget = null;
  } catch(e) { showToast(e.message, 'error'); }
}

// Admin: violation templates
async function loadAdminViolationTemplates() {
  try {
    const { templates } = await api('GET', '/api/admin/violation-templates');
    const list = document.getElementById('admin-vt-list');
    if (templates?.length) {
      list.innerHTML = templates.map(t =>
        '<div class="admin-family-item" style="display:flex;justify-content:space-between;align-items:center">' +
          '<div>' + (t.icon || '🚫') + ' ' + t.name + '</div>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteViolationTemplateAdmin(\'' + t.id + '\')">🗑️</button>' +
        '</div>'
      ).join('');
    } else {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد أنواع</div></div>';
    }
  } catch(e) {}
}
async function addViolationTemplateAdmin() {
  const name = document.getElementById('vt-name').value.trim();
  const icon = document.getElementById('vt-icon').value.trim();
  if (!name) return showToast('اسم النوع مطلوب', 'error');
  try {
    await api('POST', '/api/admin/violation-templates/add', { name, icon });
    showToast('✅ تمت الإضافة', 'success');
    document.getElementById('vt-name').value = '';
    document.getElementById('vt-icon').value = '';
    loadAdminViolationTemplates();
  } catch(e) { showToast(e.message, 'error'); }
}
async function deleteViolationTemplateAdmin(id) {
  if (!confirm('🗑️ حذف نوع المخالفة؟')) return;
  try { await api('POST', '/api/admin/violation-templates/delete', { id }); loadAdminViolationTemplates(); } catch(e) {}
}

function removeRemoteAudio(peerId) {
  const audio = document.getElementById('audio-' + peerId);
  if (audio) { audio.pause(); audio.remove(); }
  const video = document.getElementById('video-' + peerId);
  if (video) video.remove();
  const p = document.getElementById('participant-' + peerId);
  if (p) p.remove();
  
  const pc = peerConnections[peerId];
  if (pc) { pc.close(); delete peerConnections[peerId]; }
}

// نقل أدوات البث داخل الشبكة بشكل دائم (يعمل على كل المتصفحات)
document.addEventListener('DOMContentLoaded', function() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  ['call-controls', 'battle-section', 'video-limit-control'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !grid.contains(el)) grid.appendChild(el);
  });
  // أزرار الأدوات: طفل مباشر للشبكة (تخرج من أي تداخل)
  const cb = document.querySelector('.call-buttons');
  if (cb) grid.appendChild(cb);
});
let callExtrasOpen = false;
function toggleCallExtras() {
  const row = document.querySelector('.call-buttons');
  callExtrasOpen = !callExtrasOpen;
  if (row) row.classList.toggle('extras-open', callExtrasOpen);
  const btn = document.getElementById('call-settings-btn');
  if (btn) btn.textContent = callExtrasOpen ? '✕' : '⚙️';
  const giftBtn = document.getElementById('gift-box-btn');
  if (giftBtn) giftBtn.style.display = callExtrasOpen ? 'none' : 'flex';
}
let bcastMoved = [];
function moveControlsIntoGrid() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const ids = ['call-controls', 'battle-section', 'video-limit-control'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && !grid.contains(el)) { bcastMoved.push({ el, parent: el.parentNode, next: el.nextSibling }); grid.appendChild(el); }
  });
  const cb = document.querySelector('.call-buttons');
  if (cb && !grid.contains(cb)) { bcastMoved.push({ el: cb, parent: cb.parentNode, next: cb.nextSibling }); grid.appendChild(cb); }
}
function restoreMovedControls() {
  while (bcastMoved.length) {
    const m = bcastMoved.pop();
    try { m.parent.insertBefore(m.el, m.next); } catch(e) {}
  }
}

function updateAudioCallUI(inCall) {
  const btn = document.getElementById('join-audio-btn');
  if (!btn) return;
  
  if (inCall) {
    btn.textContent = '🔴 إنهاء البث';
    btn.className = 'btn btn-danger btn-full';
    document.getElementById('call-controls').style.display = 'block';
    document.getElementById('video-grid').style.display = 'grid';
    // زر الكاميرا يظهر فقط في أوضاع الفيديو وللمضيف فقط (المؤسس/الأدمن) — الأعضاء بدون كاميرا
    const isVideoMode2 = ['video', 'all'].includes(state.diwaniyaMode);
    const isHost2 = state.isFounder || state.user?.role === 'admin';
    const camBtn3 = document.getElementById('cam-toggle-btn');
    if (camBtn3) camBtn3.style.display = (isVideoMode2 && isHost2) ? 'flex' : 'none';
    const flipBtn3 = document.getElementById('flip-cam-btn');
    if (flipBtn3) flipBtn3.style.display = (isVideoMode2 && isHost2) ? 'flex' : 'none';
    // الأيقونات السفلية (نمط تيك توك): الكاميرا للمضيف فقط
    const barCam = document.getElementById('tt-bar-cam');
    if (barCam) barCam.style.display = (isVideoMode2 && isHost2) ? 'flex' : 'none';
    const barMic = document.getElementById('tt-bar-mic');
    if (barMic) barMic.style.display = 'flex';
    // زر العوائل المتصلة + PK للمضيف فقط
    const barFam = document.getElementById('tt-bar-families');
    if (barFam) barFam.style.display = isHost2 ? 'flex' : 'none';
    // البث شاشة منفصلة تغطي كل الشاشة (بدون مغادرة الصفحة)
    document.body.classList.add('bcast-open');
    moveControlsIntoGrid();
    // زر الإعدادات يظهر للمضيف فقط (المؤسس أو فاتح البث)
    const host = state.isFounder || state.user?.role === 'admin' || (state.activeSession && state.activeSession.opened_by === state.user?.id);
    const sBtn = document.getElementById('call-settings-btn');
    if (sBtn) sBtn.style.display = host ? 'flex' : 'none';
    // Show my local video (audio-only: stays hidden since camOff)
    const myVideo = document.getElementById('my-video');
    if (myVideo && localStream) {
      myVideo.srcObject = localStream;
      myVideo.style.display = camOff ? 'none' : 'block';
    }
  } else {
    btn.textContent = dwJoinBtnText(state.diwaniyaMode || 'text');
    btn.className = 'btn btn-accent btn-full';
    document.getElementById('call-controls').style.display = 'none';
    document.getElementById('video-grid').style.display = 'none';
    restoreMovedControls();
    document.body.classList.remove('bcast-open');
    closePopOut();
  }
}

// ==================== SPEAKING INDICATOR ====================
const speakingState = {};

function setupSpeakingDetection(peerId, peerName, stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const data = new Uint8Array(analyser.frequencyBinCount);
    
    setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      const isSpeaking = avg > 15; // Threshold
      updateSpeakingIndicator(peerId, peerName, isSpeaking);
    }, 400);
  } catch(e) {
    console.error('Speaking detection error:', e);
  }
}

function updateSpeakingIndicator(peerId, peerName, isSpeaking) {
  const banner = document.getElementById('speaking-banner');
  const nameSpan = document.getElementById('speaking-name');
  if (!banner || !nameSpan) return;
  
  // Only show if someone is speaking and I'm in the call
  if (isSpeaking) {
    speakingState[peerId] = true;
    nameSpan.textContent = peerName;
    banner.classList.add('show');
  } else {
    speakingState[peerId] = false;
    // Hide if nobody else is speaking
    const anyoneSpeaking = Object.values(speakingState).some(v => v);
    if (!anyoneSpeaking) banner.classList.remove('show');
  }
}

// ==================== PRESS-ZOOM AVATAR ====================
// Press and hold avatar to enlarge; release to return
function initAvatarZoom() {
  let zoomOverlay = null;
  let pressTimer = null;
  
  function createZoomOverlay(src) {
    zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'avatar-zoom-overlay';
    zoomOverlay.innerHTML = '<img src="' + src + '">';
    document.body.appendChild(zoomOverlay);
    requestAnimationFrame(() => zoomOverlay.classList.add('show'));
  }
  function closeZoomOverlay() {
    if (zoomOverlay) {
      zoomOverlay.classList.remove('show');
      setTimeout(() => zoomOverlay.remove(), 200);
      zoomOverlay = null;
    }
  }
  
  // Watch for avatars (image or emoji) - attach to any .menu-avatar, .chat-avatar, .member-avatar, .profile-avatar, .lb-avatar
  document.addEventListener('mousedown', (e) => {
    const av = e.target.closest('.menu-avatar img, .chat-avatar img, .member-avatar img, .profile-avatar img, .lb-avatar img, #profile-avatar-preview');
    if (av) {
      const src = av.src || av.getAttribute('src');
      if (src && src.startsWith('data:')) {
        e.preventDefault();
        pressTimer = setTimeout(() => createZoomOverlay(src), 200);
      }
    }
  });
  document.addEventListener('mouseup', () => {
    clearTimeout(pressTimer);
    setTimeout(closeZoomOverlay, 100);
  });
  document.addEventListener('touchstart', (e) => {
    const av = e.target.closest('.menu-avatar img, .chat-avatar img, .member-avatar img, .profile-avatar img, .lb-avatar img, #profile-avatar-preview');
    if (av) {
      const src = av.src || av.getAttribute('src');
      if (src && src.startsWith('data:')) {
        pressTimer = setTimeout(() => createZoomOverlay(src), 200);
      }
    }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
    setTimeout(closeZoomOverlay, 100);
  });
  document.addEventListener('touchcancel', () => {
    clearTimeout(pressTimer);
    closeZoomOverlay();
  });
}
document.addEventListener('DOMContentLoaded', initAvatarZoom);
setTimeout(initAvatarZoom, 1500);

// ==================== PRICING PAGE (ميز عائلتك) ====================
async function loadPremiumPricing() {
  try {
    const { rate } = await api('GET', '/api/pricing');
    state.sarRate = rate || 50;
    const premiumSar = 2000; // سعر الرمز المميز
    const customSar = 2500;  // سعر المخصص
    const e1 = document.getElementById('pricing-premium-coins');
    const e2 = document.getElementById('pricing-premium-sar');
    const e3 = document.getElementById('pricing-custom-coins');
    const e4 = document.getElementById('pricing-custom-sar');
    if (e1) e1.textContent = (premiumSar * rate).toLocaleString('en');
    if (e2) e2.textContent = '= ' + premiumSar.toLocaleString('en') + ' ريال';
    if (e3) e3.textContent = (customSar * rate).toLocaleString('en');
    if (e4) e4.textContent = '= ' + customSar.toLocaleString('en') + ' ريال';
  } catch(e) {}
}

// ==================== BUY PAGE + CUSTOM PACKAGE ====================
let customRate = 50;
let customMode = 'coins';

async function loadBuyPage() {
  try {
    const { wallet } = await api('GET', '/api/wallet');
    const el = document.getElementById('buy-coins-display');
    if (el) el.textContent = wallet.coins || 0;
  } catch(e) {}
  try {
    const data = await api('GET', '/api/wallet');
    const packages = data.packages || [];
    const list = document.getElementById('buy-packages-list');
    if (packages?.length) {
      list.innerHTML = '<div class="coin-packages-grid">' + packages.map((p, i) => {
        const tiers = ['tiny','shine','exclusive','silver','premium','gold'];
        const tier = tiers[i % tiers.length];
        const hot = p.badge && String(p.badge).includes('خصم');
        return '<div class="coin-package-card ' + tier + (hot ? ' hot' : '') + '" onclick="buyCoinsPackage(\'' + p.id + '\', ' + p.price + ', ' + p.coins + ')">' +
          (p.badge ? '<span class="pkg-badge">' + p.badge + '</span>' : '') +
          '<div class="pkg-coins"><img src="/assets/coin.png" alt="كونزه"> <b>' + p.coins.toLocaleString('en') + '</b></div>' +
          '<div class="pkg-title">' + (p.title || 'باقة') + '</div>' +
          '<div class="pkg-price">' + p.price + ' ريال</div>' +
          '<div class="pkg-usd">≈ $' + (p.usd || (p.price/3.75).toFixed(2)) + '</div>' +
        '</div>';
      }).join('') + '</div>';
    } else {
      list.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد باقات</div></div>';
    }
  } catch(e) {}
}

function getCustomInput() {
  const el = document.getElementById('custom-coins-input') || document.getElementById('custom-coins-input-w');
  return el ? parseInt(el.value) || 0 : 0;
}

function setCustomMode(mode) {
  customMode = mode;
  const bC = document.getElementById('custom-mode-coins');
  const bS = document.getElementById('custom-mode-sar');
  if (bC) bC.className = 'btn btn-sm ' + (mode === 'coins' ? 'btn-accent' : 'btn-secondary');
  if (bS) bS.className = 'btn btn-sm ' + (mode === 'sar' ? 'btn-accent' : 'btn-secondary');
  const input = document.getElementById('custom-coins-input') || document.getElementById('custom-coins-input-w');
  const icon = document.getElementById('custom-mode-icon');
  if (input) input.placeholder = mode === 'coins' ? 'عدد الكونزات (مثال: 1000)' : 'المبلغ بالريال (مثال: 100)';
  if (icon) icon.src = mode === 'coins' ? '/assets/coin.png' : 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><text y=%2218%22 font-size=%2214%22>💵</text></svg>';
  if (input) input.value = '';
  const box = document.getElementById('custom-details');
  if (box) box.style.display = 'none';
}

async function calcCustomPackage() {
  const val = getCustomInput();
  const box = document.getElementById('custom-details');
  if (val <= 0) { if (box) box.style.display = 'none'; return; }
  try {
    const { rate } = await api('GET', '/api/pricing');
    customRate = rate || 50;
    let coins, price;
    if (customMode === 'coins') {
      coins = val;
      price = Math.round((coins / customRate) * 100) / 100;
    } else {
      price = val;
      coins = Math.round(price * customRate);
    }
    const vat = Math.round(price * 0.15 * 100) / 100;
    const total = Math.round((price + vat) * 100) / 100;
    const usd = Math.round((total / 3.75) * 100) / 100;
    const e1 = document.getElementById('custom-coins-total');
    const e2 = document.getElementById('custom-coins-sum');
    const e3 = document.getElementById('custom-price');
    const e4 = document.getElementById('custom-vat');
    const e5 = document.getElementById('custom-usd');
    const e6 = document.getElementById('custom-total');
    if (e1) e1.textContent = coins;
    if (e2) e2.textContent = coins + ' 🪙';
    if (e3) e3.textContent = price + ' ريال';
    if (e4) e4.textContent = vat + ' ريال';
    if (e5) e5.textContent = '$' + usd;
    if (e6) e6.textContent = total + ' ريال';
    if (box) box.style.display = 'block';
  } catch(e) {}
}

async function calcCustomPackageW() {
  const val = getCustomInput();
  const box = document.getElementById('custom-details-w');
  if (val <= 0) { if (box) box.style.display = 'none'; return; }
  try {
    const { rate } = await api('GET', '/api/pricing');
    customRate = rate || 50;
    let coins, price;
    if (customMode === 'coins') {
      coins = val;
      price = Math.round((coins / customRate) * 100) / 100;
    } else {
      price = val;
      coins = Math.round(price * customRate);
    }
    const vat = Math.round(price * 0.15 * 100) / 100;
    const total = Math.round((price + vat) * 100) / 100;
    const e1 = document.getElementById('custom-price-w');
    const e2 = document.getElementById('custom-vat-w');
    const e3 = document.getElementById('custom-total-w');
    if (e1) e1.textContent = price + ' ريال';
    if (e2) e2.textContent = vat + ' ريال';
    if (e3) e3.textContent = total + ' ريال';
    if (box) box.style.display = 'block';
  } catch(e) {}
}

async function buyCustomCoins() {
  const val = getCustomInput();
  if (!val || val <= 0) return showToast(customMode === 'coins' ? 'أدخل عدد الكونزات أولاً' : 'أدخل المبلغ بالريال أولاً', 'error');
  let coins = val;
  if (customMode === 'sar') {
    try { const { rate } = await api('GET', '/api/pricing'); coins = Math.round(val * (rate || 50)); } catch(e) {}
  }
  try {
    const result = await api('POST', '/api/wallet/buy-custom', { coins });
    if (result.requiresPayment) {
      showPaymentModal(result.total, 'شراء كونزات مخصص (' + coins + ')');
      showToast('📋 تفاصيل العملية: ' + coins + ' 🪙 · السعر ' + result.price + ' ريال · ضريبة ' + result.vat + ' ريال · الإجمالي ' + result.total + ' ريال', 'success');
    }
  } catch(e) { showToast(e.message, 'error'); }
}

// Coin display helper: image + number + riyal below
function coinVal(coins) {
  const c = parseInt(coins) || 0;
  const sar = Math.round((c / (state.sarRate || 50)) * 100) / 100;
  return '<span class="coin-val"><img src="/assets/coin.png" class="coin-ico" alt="كونزه"> <b>' + c.toLocaleString('en') + '</b>' +
    '<span class="coin-sar">= ' + sar + ' ريال</span></span>';
}

// ==================== FAMILY VERIFICATION BADGE (توثيق العائلات) ====================
let fvGradCounter = 0;
const FV_TIERS = {
  black:    { g1: '#4a4a55', g2: '#0a0a0d', ring: '#cfd3d9', check: '#ffffff', label: 'أسود' },
  blue:     { g1: '#4db8ff', g2: '#0e6fb8', ring: '#bfe6ff', check: '#ffffff', label: 'أزرق' },
  silver:   { g1: '#f7f8fa', g2: '#a9b0b9', ring: '#ffffff', check: '#3f4a55', label: 'فضي' },
  gold:     { g1: '#ffe08a', g2: '#cf9b1f', ring: '#fff6d8', check: '#ffffff', label: 'ذهبي' },
  platinum: { g1: '#eef4ff', g2: '#93b2d8', ring: '#ffffff', check: '#1d4ed8', label: 'بلاتيني' },
};
// مسار دائرة "مكرمشة" — بتلات دائرية حول المحيط (نفس شكل الصورة المرفقة)
function scallopPath(cx, cy, R, r, n) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i * 2 * Math.PI) / n - Math.PI / 2;
    const a1 = a0 + Math.PI / n;
    const a2 = a0 + (2 * Math.PI) / n;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
    const p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
    if (i === 0) d += 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2);
    d += 'Q' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) + ' ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
  }
  return d + 'Z';
}
// شارة تويتر مكرمشة: الديسك المكرمش ثابت + حلقة مكرمشة تدور حوله بشرارة + صح أبيض ثابت يخترق الحافة
function verifBadge(tier, size) {
  if (!tier || tier === 'none' || !FV_TIERS[tier]) return '';
  const c = FV_TIERS[tier];
  const n = ++fvGradCounter;
  const s = size || 18;
  const disc = scallopPath(12, 12, 9.5, 8.1, 12);       // الديسك المكرمش (ثابت)
  const ring = scallopPath(12, 12, 11.3, 10.0, 12);     // الحلقة المكرمشة (تدور)
  const sx = (12 + 10.65 * Math.cos(-Math.PI / 2)).toFixed(2); // موضع الشرارة أعلى الحلقة
  const sy = (12 + 10.65 * Math.sin(-Math.PI / 2)).toFixed(2);
  return '<span class="fv-badge fv-' + tier + '" style="width:' + s + 'px;height:' + s + 'px" title="توثيق ' + c.label + '">' +
    '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '">' +
      '<defs>' +
        '<linearGradient id="fv-g' + n + '" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="' + c.g1 + '"/><stop offset="1" stop-color="' + c.g2 + '"/></linearGradient>' +
        '<linearGradient id="fv-sh' + n + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>' +
        '<clipPath id="fv-cl' + n + '"><path d="' + disc + '"/></clipPath>' +
      '</defs>' +
      '<path d="' + disc + '" fill="url(#fv-g' + n + ')"/>' +
      '<g clip-path="url(#fv-cl' + n + ')">' +
        '<ellipse cx="12" cy="8.4" rx="10.8" ry="5.2" fill="url(#fv-sh' + n + ')"/>' +
        '<ellipse cx="9.0" cy="5.9" rx="3.8" ry="2.1" fill="#ffffff" opacity="0.7"/>' +
        '<path d="M5.6 6.8 Q12 3.4 18.4 6.8" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity="1"/>' +
      '</g>' +
      '<g class="fv-rotate">' +
        '<path d="' + ring + '" fill="none" stroke="' + c.ring + '" stroke-width="1.6"/>' +
        '<circle cx="' + sx + '" cy="' + sy + '" r="1.0" fill="#ffffff" class="fv-spark"/>' +
      '</g>' +
      '<path d="M5.8 14.3 C6.9 16.0, 8.9 17.4, 10.9 17.2 C13.2 17.0, 15.0 14.2, 15.7 11.2 C16.1 9.7, 16.2 8.3, 17.2 7.7 C17.8 7.4, 18.3 8.1, 18.1 8.8" fill="none" stroke="' + c.check + '" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg></span>';
}
function fvTierLabel(tier) { return (FV_TIERS[tier] && FV_TIERS[tier].label) || tier || ''; }
// شارة مستوى بجانب الاسم في الشات
function levelImgHtml(lv) {
  const level = parseInt(lv);
  if (isNaN(level) || level < 0 || level > 100) return '';
  // المستوى 0 والمرتفعة صور PNG — المستويات 1-10 صور GIF
  return '<img src="/assets/levels/level_' + level + '.' + (level >= 1 && level <= 10 ? 'gif' : 'png') + '?v=3" style="width:34px;height:13px;vertical-align:middle;margin:0 3px">';
}

// ==================== ADMIN: شحن الموقع + النسخ الاحتياطي ====================
async function chargeSite() {
  const input = document.getElementById('site-charge-input');
  if (!input) return;
  const coins = parseInt(input.value);
  if (!coins || coins <= 0) return showToast('أدخل عدد الكونزات أولاً', 'error');
  if (!confirm('💳 شحن رصيد الموقع بـ ' + coins.toLocaleString('en') + ' كونزه؟')) return;
  try {
    const r = await api('POST', '/api/admin/site-charge', { coins });
    showToast(r.message, 'success');
    input.value = '';
    const scd = document.getElementById('site-coins-display');
    if (scd) scd.innerHTML = '<img src="/assets/coin.png" class="coin-ico" alt="كونزه"> ' + (r.siteCoins || 0).toLocaleString('en');
    if (typeof loadReportsPage === 'function') loadReportsPage();
  } catch(e) { showToast(e.message || 'فشل الشحن', 'error'); }
}
async function exportBackup() {
  try {
    const data = await api('GET', '/api/admin/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'family_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('📥 نُزّلت النسخة الاحتياطية', 'success');
  } catch(e) { showToast('فشل التصدير: ' + (e.message || ''), 'error'); }
}
async function restoreBackup(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!confirm('📤 استبدال كل البيانات الحالية بالنسخة من الملف؟ (لا يمكن التراجع)')) { input.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const r = await api('POST', '/api/admin/restore', data);
    showToast(r.message || '✅ تمت الاستعادة', 'success');
    setTimeout(() => location.reload(), 1200);
  } catch(e) { showToast('فشل الاستعادة: ' + (e.message || ''), 'error'); }
}

// ==================== ADMIN: التقارير + سجل شحن الموقع ====================
function fmtDateTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t).slice(0, 16);
  const p = n => String(n).padStart(2, '0');
  return d.toLocaleDateString('en-GB') + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function loadReportsPage() {
  try {
    const [reports, siteLogs, auctionLogs] = await Promise.all([
      api('GET', '/api/admin/reports'),
      api('GET', '/api/admin/site-logs'),
      api('GET', '/api/admin/auction-logs')
    ]);

    // رصيد الموقع الكلي
    const sc = document.getElementById('rpt-site-coins');
    if (sc) sc.textContent = (reports.site_balance || 0).toLocaleString('en');
    const ss = document.getElementById('rpt-site-sar');
    if (ss) ss.textContent = '≈ ' + (reports.site_balance_sar || 0).toLocaleString('en') + ' ريال';

    // سجل شحن الموقع
    const sl = document.getElementById('rpt-site-logs');
    if (sl) {
      const logs = siteLogs.logs || [];
      sl.innerHTML = logs.length ? logs.map(l => {
        const coinsHtml = (l.coins && l.coins > 0) ? '<b style="color:var(--success)">+' + (+l.coins).toLocaleString('en') + ' <img src="/assets/coin.png" class="coin-ico" alt="كونزه"></b> ' : '';
        return '<div class="admin-family-item">' +
          '<div class="admin-family-name">' + (l.by_user_name ? escapeHtml(l.by_user_name) : 'أدمن') + ' · ' + fmtDateTime(l.created_at) + '</div>' +
          '<div class="admin-family-actions">' +
            coinsHtml +
            '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(l.detail || '') + '</div>' +
          '</div></div>';
      }).join('') : '<div class="empty-text">لا توجد عمليات بعد</div>';
    }

    // أفضل 10 عائلات
    const tf = document.getElementById('rpt-top-families');
    if (tf) {
      const fs = reports.top_families || [];
      tf.innerHTML = fs.length ? fs.map((f, i) =>
        '<div class="admin-family-item">' +
          '<div class="admin-family-name">' + (i + 1) + '. ' + escapeHtml(f.name) + '</div>' +
          '<div class="admin-family-actions"><b>' + (+f.total_coins).toLocaleString('en') + ' <img src="/assets/coin.png" class="coin-ico" alt="كونزه"></b> <span style="font-size:11px;color:var(--text-muted)">(' + f.tx_count + ' حركة)</span></div>' +
        '</div>').join('') : '<div class="empty-text">لا توجد بيانات بعد</div>';
    }

    // أفضل 10 شاحنين
    const tc = document.getElementById('rpt-top-chargers');
    if (tc) {
      const cs = reports.top_chargers || [];
      tc.innerHTML = cs.length ? cs.map((u, i) =>
        '<div class="admin-family-item">' +
          '<div class="admin-family-name">' + (i + 1) + '. ' + escapeHtml(u.name) + '</div>' +
          '<div class="admin-family-actions"><b>' + (+u.charged).toLocaleString('en') + ' <img src="/assets/coin.png" class="coin-ico" alt="كونزه"></b> <span style="font-size:11px;color:var(--text-muted)">≈ ' + (+u.charged_sar).toLocaleString('en') + ' ريال</span></div>' +
        '</div>').join('') : '<div class="empty-text">لا توجد بيانات بعد</div>';
    }

    // طلبات السحب آخر 30 يوم
    const wd = document.getElementById('rpt-withdrawals');
    if (wd) {
      const ws = reports.withdrawals || [];
      wd.innerHTML = ws.length ? ws.map(w =>
        '<div class="admin-family-item">' +
          '<div class="admin-family-name">' + escapeHtml(w.user_name || '') + ' · ' + (+w.amount).toLocaleString('en') + ' ريال · ' + (w.method || '') + '</div>' +
          '<div class="admin-family-actions">' + (w.status === 'paid' ? '✅ مدفوع' : '⏳ ' + (w.status || '')) + ' · ' + fmtDateTime(w.created_at) + '</div>' +
        '</div>').join('') : '<div class="empty-text">لا توجد سحوبات في آخر 30 يوم</div>';
    }

    // تقارير المزادات
    const al = document.getElementById('rpt-auction-logs');
    if (al) {
      const logs = auctionLogs.logs || [];
      al.innerHTML = logs.length ? logs.map(l =>
        '<div class="admin-family-item">' +
          '<div class="admin-family-name">' + (l.event === 'sold' ? '🟢 بيع' : l.event === 'returned' ? '🔵 إرجاع' : '⚪ ' + escapeHtml(l.event || '')) + ' · ' + escapeHtml(l.code || '') + '</div>' +
          '<div class="admin-family-actions"><b>' + (+l.amount).toLocaleString('en') + ' <img src="/assets/coin.png" class="coin-ico" alt="كونزه"></b> · ' + fmtDateTime(l.created_at) + '</div>' +
        '</div>').join('') : '<div class="empty-text">لا توجد تقارير</div>';
    }
  } catch(e) { showToast(e.message || 'فشل تحميل التقارير', 'error'); }
}

// ==================== ADMIN: نظام توثيق العائلات ====================
async function loadFamilyVerificationSettings() {
  try {
    const { settings } = await api('GET', '/api/admin/family-verification');
    const map = { 'fv-black':'black', 'fv-blue':'blue', 'fv-silver':'silver', 'fv-gold':'gold', 'fv-platinum':'platinum' };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if (el && settings[map[id]] !== undefined) el.value = settings[map[id]];
    });
    previewFvBadges();
  } catch(e) { console.error('Family verification settings:', e); }
}
function previewFvBadges() {
  const wrap = document.getElementById('fv-preview-badges');
  if (!wrap) return;
  wrap.innerHTML = Object.keys(FV_TIERS).map(t =>
    '<div style="text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px">' +
      '<div style="width:46px;height:46px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border-radius:12px">' + verifBadge(t, 34) + '</div>' +
      '<div style="font-size:11px;color:var(--text-muted)">' + fvTierLabel(t) + '</div>' +
    '</div>').join('');
}
async function saveFamilyVerification() {
  const g = id => document.getElementById(id)?.value;
  try {
    const r = await api('POST', '/api/admin/family-verification', {
      black: g('fv-black'), blue: g('fv-blue'), silver: g('fv-silver'), gold: g('fv-gold'), platinum: g('fv-platinum')
    });
    showToast(r.message, 'success');
  } catch(e) { showToast(e.message || 'فشل حفظ إعدادات التوثيق', 'error'); }
}

// ==================== ADMIN: إدارة الديوانية ====================
async function loadDiwaniyaAdminSettings() {
  try {
    const { settings, sessions } = await api('GET', '/api/admin/diwaniya-settings');
    document.getElementById('dw-video-toggle').value = settings.video_enabled ? '1' : '0';
    document.getElementById('dw-audio-toggle').value = settings.audio_enabled ? '1' : '0';
    const st = document.getElementById('dw-maint-status');
    if (st) {
      if (settings.maintenance.active) {
        st.innerHTML = '<span style="color:#ff9800;font-weight:700">🟠 الصيانة مفعلة حتى ' + new Date(settings.maintenance.until).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }) + '</span>' + (settings.maintenance.reason ? ' — ' + settings.maintenance.reason : '');
      } else {
        st.textContent = 'لا توجد صيانة مفعلة حالياً';
      }
    }
    const cnt = document.getElementById('dw-sessions-count');
    if (cnt) cnt.textContent = sessions.length;
    const list = document.getElementById('dw-sessions-list');
    if (list) {
      list.innerHTML = sessions.length ? sessions.map(s => {
        const open = s.status === 'open';
        const modeLabel = { text: '✍️', audio: '🎤', video: '🎥', both: '📝🎤', all: '📝🎥🎤' }[s.mode] || s.mode;
        return '<div class="admin-family-item">' +
          '<div class="admin-family-name">' + escapeHtml(s.family_name || 'بدون عائلة') + ' · ' + modeLabel + ' · ' + (s.topic || '') + '</div>' +
          '<div class="admin-family-actions">' +
            '<span style="font-size:11px;color:var(--text-muted)">' + (s.msg_count || 0) + ' رسالة · ' + fmtDateTime(s.opened_at) + '</span>' +
            (open ? '<button class="btn btn-sm btn-danger" onclick="closeDiwaniyaAdmin(\'' + s.id + '\')">🔒 إغلاق</button>' : '<span class="empty-text" style="font-size:11px">مغلقة</span>') +
          '</div></div>';
      }).join('') : '<div class="empty-text">لا توجد جلسات بعد</div>';
    }
  } catch(e) { console.error('Diwaniya admin:', e); }
}
async function saveDiwaniyaToggles() {
  try {
    const r = await api('POST', '/api/admin/diwaniya-settings', {
      video_enabled: document.getElementById('dw-video-toggle').value === '1',
      audio_enabled: document.getElementById('dw-audio-toggle').value === '1'
    });
    showToast(r.message, 'success');
    dwGlobal = Object.assign(dwGlobal, r.settings);
    applyDiwaniyaGlobalStatusUI();
  } catch(e) { showToast(e.message || 'فشل الحفظ', 'error'); }
}
async function disableAllDiwaniyaModes() {
  if (!confirm('⛔ إيقاف الفيديو والصوت معاً؟ (الديوانية كتابية فقط)')) return;
  try {
    const r = await api('POST', '/api/admin/diwaniya-settings', { video_enabled: false, audio_enabled: false });
    document.getElementById('dw-video-toggle').value = '0';
    document.getElementById('dw-audio-toggle').value = '0';
    showToast('⛔ تم إيقاف الفيديو والصوت — الديوانية كتابية فقط', 'success');
    dwGlobal = Object.assign(dwGlobal, r.settings);
    applyDiwaniyaGlobalStatusUI();
  } catch(e) { showToast(e.message || 'فشل', 'error'); }
}
async function startDiwaniyaMaintenance() {
  const minutes = parseInt(document.getElementById('dw-maint-minutes').value) || 30;
  const reason = document.getElementById('dw-maint-reason').value.trim();
  if (!confirm('🟠 إغلاق كل الديوانيات وبدء الصيانة لمدة ' + minutes + ' دقيقة؟\n' + (reason ? '(' + reason + ')' : ''))) return;
  try {
    const r = await api('POST', '/api/admin/diwaniya-maintenance', { action: 'start', minutes, reason });
    showToast(r.message, 'success');
    loadDiwaniyaAdminSettings();
    refreshDiwaniyaGlobalStatus();
  } catch(e) { showToast(e.message || 'فشل بدء الصيانة', 'error'); }
}
async function endDiwaniyaMaintenance() {
  try {
    const r = await api('POST', '/api/admin/diwaniya-maintenance', { action: 'end' });
    showToast(r.message, 'success');
    loadDiwaniyaAdminSettings();
    refreshDiwaniyaGlobalStatus();
  } catch(e) { showToast(e.message || 'فشل إيقاف الصيانة', 'error'); }
}
async function closeDiwaniyaAdmin(sessionId) {
  if (!confirm('🔒 إغلاق هذه الديوانية؟')) return;
  try {
    const r = await api('POST', '/api/admin/diwaniyas/close', { sessionId });
    showToast(r.message, 'success');
    loadDiwaniyaAdminSettings();
  } catch(e) { showToast(e.message || 'فشل الإغلاق', 'error'); }
}


// ============ كاشف النسخ الجديدة (ينهي مشكلة الصفحات القديمة) ============
(function versionWatcher() {
  const getVer = () => {
    try {
      const src = document.querySelector('script[src*="app.js"]');
      if (!src) return null;
      const m = src.getAttribute('src').match(/v=(\d+)/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  };
  let curVer = getVer();
  if (!curVer) return;
  window._curAppVer = curVer;
  const check = () => {
    fetch('/?nv=' + Date.now(), { cache: 'no-store' })
      .then(r => r.text())
      .then(html => {
        const m = html.match(/app\.js\?v=(\d+)/);
        if (m && m[1] !== curVer) {
          curVer = m[1];
          if (!document.getElementById('ver-update-banner')) {
            const b = document.createElement('div');
            b.id = 'ver-update-banner';
            b.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:99998;background:linear-gradient(135deg,#e8b830,#c8930c);color:#1a1a2e;font-weight:800;font-size:13px;padding:10px 18px;border-radius:30px;box-shadow:0 6px 24px rgba(0,0,0,.45);cursor:pointer;font-family:sans-serif;direction:rtl;';
            b.textContent = '🔄 نسخة جديدة متاحة — اضغط هنا للتحديث';
            b.onclick = () => location.reload();
            document.body.appendChild(b);
          }
        }
      }).catch(() => {});
  };
  setTimeout(check, 8000);
  setInterval(check, 45000);
})();

// ==================== 💼 القسم المالي — طلبات السحب (لوحة الإدارة) ====================
let wdAll = [];
const WD_STATUS = { pending: ['📤 تم الرفع', '#ff9f43'], received: ['📤 تم الرفع', '#ff9f43'], confirmed: ['📥 تم استلام الطلب', '#3b82f6'], processing: ['🔄 جاري معالجة الطلب', '#a855f7'], paid: ['✅ تم التحويل', '#22c55e'], rejected: ['❌ مرفوض', '#ef4444'] };

function wdStatusHtml(s) {
  const st = WD_STATUS[s] || [s, '#888'];
  return '<span style="color:' + st[1] + ';font-weight:800;font-size:12px">' + st[0] + '</span>';
}

async function loadAdminFinance() {
  try {
    const { withdrawals, pendingCount, overdueCount, overdueList } = await api('GET', '/api/admin/withdrawals');
    wdAll = withdrawals || [];
    // تنبيه الطلبات المتجاوزة لمهلة المرحلة (5 أيام عمل)
    const ovEl = document.getElementById('wd-overdue-alert');
    if (ovEl) {
      if (overdueList && overdueList.length) {
        ovEl.style.display = 'block';
        ovEl.innerHTML = '⏰ <b>إنذار: ' + overdueList.length + ' طلب تجاوز الوقت المعياري (5 أيام عمل)</b><br><small>' +
          overdueList.map(o => 'طلب #' + String(o.id).slice(0, 8) + ' للعضو ' + (o.user_name || '') + ' — مرحلة: ' + (o.phase || '') + ' — الموعد: ' + new Date(o.deadline).toLocaleString('ar-SA') + (o.net ? ' — المبلغ: ' + o.net + ' ريال' : '')).join('<br>') +
          '</small>';
      } else {
        ovEl.style.display = 'none';
      }
    }
    const badge = document.getElementById('wd-pending-badge');
    if (badge) {
      if (pendingCount > 0) badge.innerHTML = '<span style="background:rgba(255,80,80,.2);color:#ff8b8b;border-radius:20px;padding:2px 10px;font-size:12px">🔴 ' + pendingCount + ' جديد</span>';
      else badge.innerHTML = '<span style="background:rgba(34,197,94,.15);color:#22c55e;border-radius:20px;padding:2px 10px;font-size:12px">✅ لا طلبات معلقة</span>';
    }
    const alert = document.getElementById('wd-alert');
    if (alert) alert.style.display = pendingCount > 0 ? 'block' : 'none';
    const list = document.getElementById('wd-list');
    if (!list) return;
    if (!wdAll.length) { list.innerHTML = '<div class="empty-text">لا توجد طلبات سحب بعد</div>'; return; }
    list.innerHTML = wdAll.map(w => {
      return '<div style="background:var(--bg-hover);border-radius:12px;padding:10px 12px;margin-bottom:8px;border-right:4px solid ' + (WD_STATUS[w.status] ? WD_STATUS[w.status][1] : '#888') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<div><b style="font-size:14px">👤 ' + (w.user_name || '') + '</b> <span style="font-size:11px;color:var(--text-muted)">🆔 ' + (w.public_id || '-') + '</span></div>' +
          wdStatusHtml(w.status) +
        '</div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:12px">' +
          '<span>🪙 <b>' + (w.coins ? Number(w.coins).toLocaleString('en') : (w.amount ? Math.round(w.amount * (parseInt(state.sarRate) || 50)).toLocaleString('en') + ' ~' : '-')) + '</b></span>' +
          '<span>💵 إجمالي: <b>' + Number(w.sar_gross || w.amount || 0).toFixed(2) + ' ريال</b></span>' +
          '<span style="color:#ff6b6b">🏢 حسم 30%: <b>' + Number(w.commission_sar || 0).toFixed(2) + '</b></span>' +
          '<span style="color:#22c55e;font-weight:800">✅ صافي: <b>' + Number(w.sar_net || w.amount || 0).toFixed(2) + ' ريال</b></span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">📞 ' + (w.phone || '-') + ' · ' + (w.created_at || '') + (w.transfer_days ? ' · ⏱️ ' + w.transfer_days + ' يوم' : '') + (w.transfer_date ? ' · 📅 ' + w.transfer_date : '') + (w.admin_note ? ' · 📝 ' + w.admin_note : '') + '</div>' +
        (w.sla ? '<div style="font-size:11px;margin-top:4px;color:' + (w.sla.overdue ? '#ef4444' : 'var(--text-muted)') + '">⏱️ مرحلة: <b>' + (w.sla.phaseLabel || '') + '</b> · مهلة المرحلة: ' + w.sla.phaseSlaDays + ' يوم عمل · الموعد: ' + new Date(w.sla.phaseDeadline).toLocaleString('ar-SA') + (w.sla.overdue ? ' · <b style="color:#ef4444">⚠️ تجاوز الوقت المعياري!</b>' : '') + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">' +
          '<button class="btn btn-sm btn-success" onclick="wdSetStatus(\'' + w.id + '\',\'confirmed\')">📥 استلام الطلب</button>' +
          '<button class="btn btn-sm btn-accent" onclick="wdSetStatus(\'' + w.id + '\',\'processing\')">⚙️ جاري المعالجة</button>' +
          '<button class="btn btn-sm btn-secondary" onclick="wdSetStatus(\'' + w.id + '\',\'paid\')">💸 تم التحويل</button>' +
          '<button class="btn btn-sm" style="background:rgba(239,68,68,.15);color:#ef4444" onclick="wdSetStatus(\'' + w.id + '\',\'rejected\')">❌ رفض</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) { console.log('finance err', e.message); }
}

function openWdActivate(id) {
  openWdEdit(id, true);
}
function openWdEdit(id, activating) {
  const w = wdAll.find(x => x.id === id);
  if (!w) return;
  const days = prompt((activating ? '✅ تفعيل السحب — ' : '✏️ تعديل — ') + 'مدة التحويل (بالأيام):', w.transfer_days || '3');
  if (days === null) return;
  const dateStr = prompt('📅 تاريخ التحويل (YYYY-MM-DD):', w.transfer_date || '');
  if (dateStr === null) return;
  const note = prompt('📝 ملاحظة (اختياري):', w.admin_note || '');
  if (note === null) return;
  const status = activating ? 'processing' : w.status;
  wdSetStatusFull(id, status, parseInt(days) || null, dateStr, note || '');
}
async function wdSetStatus(id, status) {
  if (status === 'rejected') {
    const ok = confirm('❌ رفض طلب السحب هذا؟ (لا يمكن التراجع)');
    if (!ok) return;
  }
  wdSetStatusFull(id, status, null, null, null);
}
async function wdSetStatusFull(id, status, days, date, note) {
  try {
    const r = await api('POST', '/api/admin/withdrawals/update', { id, status, transfer_days: days, transfer_date: date, admin_note: note });
    showToast(r.message, 'success');
    loadAdminFinance();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadWdStats() {
  const period = document.getElementById('wd-period').value;
  try {
    const { stats } = await api('GET', '/api/admin/withdrawals/stats?period=' + period);
    const el = document.getElementById('wd-stats');
    if (!el) return;
    const labels = { daily: 'اليومي', weekly: 'الأسبوعي', monthly: 'الشهري', half: 'نصف السنوي', year: 'السنوي' };
    el.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:8px">' +
        statBox('🪙 الكونزات المسحوبة', Number(stats.coins || 0).toLocaleString('en'), 'var(--gold)') +
        statBox('💵 الإجمالي (قبل الحسم)', Number(stats.gross || 0).toFixed(2) + ' ريال', '#3b82f6') +
        statBox('🏢 حصة الموقع 30%', Number(stats.commission || 0).toFixed(2) + ' ريال', '#ff6b6b') +
        statBox('✅ صافي المسحوب', Number(stats.net || 0).toFixed(2) + ' ريال', '#22c55e') +
        statBox('📄 عدد العمليات', stats.count + ' عملية', '#a78bfa') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:6px">التقرير ' + (labels[period] || period) + ' — حتى الآن · المعلقة: ' + (stats.pending || 0) + '</div>';
    window._wdStats = stats; window._wdPeriod = labels[period] || period;
  } catch (e) { showToast(e.message, 'error'); }
}
function statBox(label, value, color) {
  return '<div style="background:var(--bg-hover);border-radius:12px;padding:10px;text-align:center;border:1px solid var(--border)">' +
    '<div style="font-size:11px;color:var(--text-muted)">' + label + '</div>' +
    '<div style="font-size:17px;font-weight:900;color:' + color + ';margin-top:4px">' + value + '</div></div>';
}

function printWdReport() {
  const s = window._wdStats;
  if (!s) return showToast('اعرض التقرير أولاً', 'error');
  const rows = wdAll.filter(w => w.status !== 'rejected').map(w =>
    '<tr><td>' + (w.user_name || '') + '</td><td>' + (w.public_id || '-') + '</td><td>' + (w.coins ? Number(w.coins).toLocaleString('en') : '-') + '</td><td>' + Number(w.sar_gross || 0).toFixed(2) + '</td><td>' + Number(w.commission_sar || 0).toFixed(2) + '</td><td>' + Number(w.sar_net || 0).toFixed(2) + '</td><td>' + (w.status || '') + '</td><td>' + (w.created_at || '') + '</td></tr>'
  ).join('');
  const win = window.open('', '_blank', 'width=900,height=600');
  if (!win) return showToast('السماح بالنوافذ المنبثقة للطباعة', 'error');
  win.document.write(
    '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير السحوبات</title>' +
    '<style>body{font-family:Tahoma,Arial;padding:24px;color:#111} h1{font-size:20px;margin:0 0 4px} .meta{color:#666;font-size:12px;margin-bottom:16px} ' +
    '.totals{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px} .tbox{border:1px solid #ccc;border-radius:10px;padding:10px 16px;text-align:center} .tbox b{display:block;font-size:16px} .tbox span{font-size:11px;color:#666} ' +
    'table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #bbb;padding:6px 8px;text-align:center} th{background:#f0f0f0} ' +
    '@media print{ .noprint{display:none} }</style></head><body>' +
    '<h1>💼 تقرير السحوبات — ' + (window._wdPeriod || '') + '</h1>' +
    '<div class="meta">Family Live · تاريخ التقرير: ' + new Date().toLocaleString('ar-SA') + '</div>' +
    '<div class="totals">' +
      '<div class="tbox"><b>' + Number(s.coins || 0).toLocaleString('en') + '</b><span>🪙 الكونزات المسحوبة</span></div>' +
      '<div class="tbox"><b>' + Number(s.gross || 0).toFixed(2) + ' ر.س</b><span>💵 الإجمالي</span></div>' +
      '<div class="tbox"><b>' + Number(s.commission || 0).toFixed(2) + ' ر.س</b><span>🏢 حصة الموقع 30%</span></div>' +
      '<div class="tbox"><b>' + Number(s.net || 0).toFixed(2) + ' ر.س</b><span>✅ صافي المسحوب</span></div>' +
      '<div class="tbox"><b>' + s.count + '</b><span>📄 عدد العمليات</span></div>' +
    '</div>' +
    '<table><thead><tr><th>المستخدم</th><th>الايدي</th><th>الكونزات</th><th>الإجمالي</th><th>حصة الموقع</th><th>الصافي</th><th>الحالة</th><th>التاريخ</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="8">لا توجد عمليات</td></tr>') + '</tbody></table>' +
    '<div class="noprint" style="margin-top:16px"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer">🖨️ طباعة</button></div>' +
    '</body></html>'
  );
  win.document.close();
}

// ==================== 🔐 تبديل وتحويل الكونزات وطلبات السحب (محمي برمز سري) ====================
function walletUnlocked() {
  const t = parseInt(localStorage.getItem('wallet2fa_at') || '0', 10);
  return !!t && (Date.now() - t) < 30 * 60000;
}

function toggleWalletExchange() {
  const wrap = document.getElementById('wallet-exchange-wrap');
  if (!wrap) return;
  if (walletUnlocked()) {
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    const arr = document.getElementById('wallet-exchange-arrow');
    if (arr) arr.textContent = wrap.style.display === 'none' ? '🔓' : '🔓';
    return;
  }
  // مقفل: نطلب الرمز السري
  document.getElementById('wallet-code-modal').style.display = 'flex';
  const msg = document.getElementById('wallet-code-msg');
  if (msg) msg.textContent = 'اضغط "إرسال الرمز لبريدي" أولاً';
  document.getElementById('wallet-code-input').value = '';
}

async function sendWalletCode() {
  const msg = document.getElementById('wallet-code-msg');
  try {
    const r = await api('POST', '/api/wallet/send-code');
    if (msg) {
      if (r.sent) msg.innerHTML = '✅ أُرسل الرمز إلى بريدك — تحقق من صندوق الوارد/السبام';
      else msg.innerHTML = '⚠️ لم يُرسل البريد (الإعداد غير مفعل) — استخدم الرمز: <b style="letter-spacing:3px;color:var(--gold)">' + (r.devCode || '') + '</b>';
    }
  } catch (e) {
    if (msg) msg.textContent = e.message;
  }
}

async function verifyWalletCode() {
  const code = document.getElementById('wallet-code-input').value.trim();
  const msg = document.getElementById('wallet-code-msg');
  if (!code) { if (msg) msg.textContent = 'أدخل الرمز أولاً'; return; }
  try {
    const r = await api('POST', '/api/wallet/verify-code', { code });
    localStorage.setItem('wallet2fa_at', String(Date.now()));
    document.getElementById('wallet-code-modal').style.display = 'none';
    const wrap = document.getElementById('wallet-exchange-wrap');
    if (wrap) wrap.style.display = 'block';
    const arr = document.getElementById('wallet-exchange-arrow');
    if (arr) arr.textContent = '🔓';
    showToast(r.message || '✅ تم التحقق', 'success');
  } catch (e) {
    if (msg) msg.textContent = e.message;
  }
}

// إعدادات البريد (SMTP) من الإدارة
async function loadSmtpSettings() {
  try {
    const { smtp } = await api('GET', '/api/admin/smtp');
    if (smtp) {
      if (document.getElementById('smtp-host')) document.getElementById('smtp-host').value = smtp.host || '';
      if (document.getElementById('smtp-port')) document.getElementById('smtp-port').value = smtp.port || '587';
      if (document.getElementById('smtp-user')) document.getElementById('smtp-user').value = smtp.user || '';
      if (document.getElementById('smtp-pass')) document.getElementById('smtp-pass').value = smtp.pass || '';
      if (document.getElementById('smtp-from')) document.getElementById('smtp-from').value = smtp.from || '';
      if (document.getElementById('smtp-secure')) document.getElementById('smtp-secure').checked = smtp.secure === '1';
    }
  } catch (e) {}
}
async function saveSmtpSettings() {
  try {
    const r = await api('POST', '/api/admin/smtp', {
      host: document.getElementById('smtp-host').value.trim(),
      port: document.getElementById('smtp-port').value.trim(),
      user: document.getElementById('smtp-user').value.trim(),
      pass: document.getElementById('smtp-pass').value.trim(),
      from: document.getElementById('smtp-from').value.trim(),
      secure: document.getElementById('smtp-secure').checked
    });
    showToast(r.message, 'success');
    const msg = document.getElementById('smtp-msg');
    if (msg) msg.textContent = 'جرّب الآن من أي عضو: قسم التحويل والسحب ← إرسال الرمز لبريدي';
  } catch (e) { showToast(e.message, 'error'); }
}

// ==================== 🎁 تحويل كونزات الدعم المستلمة إلى رصيد (حسم 25%) ====================
function calcSupportConvert() {
  const coins = parseInt(document.getElementById('convert-support-input').value) || 0;
  const banner = document.getElementById('support-convert-banner');
  if (!coins) { banner.style.display = 'none'; return; }
  const fee = Math.floor(coins * 0.25);
  const net = coins - fee;
  document.getElementById('sc-coins').textContent = coins.toLocaleString('en') + ' كونزه';
  document.getElementById('sc-fee').textContent = fee.toLocaleString('en') + ' كونزه';
  document.getElementById('sc-net').textContent = net.toLocaleString('en') + ' كونزه';
  banner.style.display = 'block';
}

async function convertSupportCoins() {
  const coins = parseInt(document.getElementById('convert-support-input').value);
  if (!coins || coins < 1) return showToast('أدخل عدد كونزات الدعم', 'error');
  const pool = parseInt(document.getElementById('wallet-support-coins').textContent.replace(/,/g, '')) || 0;
  if (coins > pool) return showToast('⚠️ كونزات الدعم لا تكفي — لديك ' + pool.toLocaleString('en') + ' كونزه', 'error');
  // لافتة تأكيد بالحسم
  const fee = Math.floor(coins * 0.25);
  const net = coins - fee;
  const ok = confirm('💱 سيتم تحويل ' + coins.toLocaleString('en') + ' كونزه دعم\n🏢 يُحسم منها 25% نسبة الموقع = ' + fee.toLocaleString('en') + ' كونزه\n✅ سيُضاف إلى رصيدك: ' + net.toLocaleString('en') + ' كونزه\n\nمتابعة؟');
  if (!ok) return;
  try {
    const r = await api('POST', '/api/wallet/convert-support', { coins });
    showToast(r.message, 'success');
    document.getElementById('convert-support-input').value = '';
    document.getElementById('support-convert-banner').style.display = 'none';
    loadWallet();
  } catch (e) { showToast(e.message, 'error'); }
}

// ==================== 💬 سحب الكومنتات (يسار للإخفاء / يمين للإظهار) ====================
let chatDrag = null;
function initChatSwipe() {
  const chat = document.getElementById('tiktok-chat');
  const tab = document.getElementById('tt-chat-tab');
  if (!chat) return;
  for (const el of [chat, tab]) {
    if (!el) continue;
    el.addEventListener('pointerdown', (e) => {
      chatDrag = { startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, active: false, el };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!chatDrag) return;
      chatDrag.dx = e.clientX - chatDrag.startX;
      chatDrag.dy = e.clientY - chatDrag.startY;
      if (!chatDrag.active && Math.abs(chatDrag.dx) > 14 && Math.abs(chatDrag.dx) > Math.abs(chatDrag.dy)) {
        chatDrag.active = true;
        if (chatDrag.el === tab) { // سحب يمين على التبويب → فتح
          showChatPanel();
          chat.classList.add('dragging');
        } else {
          chat.classList.add('dragging');
        }
      }
      if (chatDrag.active && chatDrag.el === chat) {
        chat.style.transform = 'translateX(' + Math.min(chatDrag.dx, 0) + 'px)';
      }
    });
    const endDrag = () => {
      if (!chatDrag) return;
      const dx = chatDrag.dx, el2 = chatDrag.el;
      chatDrag = null;
      chat.classList.remove('dragging');
      if (el2 === chat) {
        if (dx < -chat.offsetWidth * 0.35) hideChatPanel();
        else { chat.style.transform = ''; }
      } else if (el2 === tab) {
        // بعد أي سحب/نقر على التبويب: نضمن ظهور الكومنت واختفاء التبويب
        showChatPanel();
      }
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  }
}
function hideChatPanel() {
  const chat = document.getElementById('tiktok-chat');
  const tab = document.getElementById('tt-chat-tab');
  if (!chat) return;
  chat.classList.add('chat-hidden');
  chat.style.transform = '';
  if (tab) tab.style.display = 'flex';
}
function showChatPanel() {
  const chat = document.getElementById('tiktok-chat');
  const tab = document.getElementById('tt-chat-tab');
  if (!chat) return;
  chat.classList.remove('chat-hidden');
  chat.style.transform = '';
  if (tab) tab.style.display = 'none';
}
window.addEventListener('load', () => { setTimeout(initChatSwipe, 500); });

// ==================== ⏫ ترجيع آخر 20 كومنت ====================
let recentCommentsLoaded = false;
async function loadRecentComments() {
  if (!state.activeSession) return showToast('ادخل البث أولاً', 'error');
  try {
    const r = await api('GET', '/api/diwaniya/messages/' + encodeURIComponent(state.activeSession.id) + '?limit=20');
    const msgs = r.messages || [];
    const list = document.getElementById('tiktok-chat-list');
    if (!list) return;
    const oldBlock = document.getElementById('tt-recent-block');
    if (oldBlock) oldBlock.remove();
    if (!msgs.length) return showToast('لا توجد كومنتات سابقة', 'info');
    const block = document.createElement('div');
    block.id = 'tt-recent-block';
    const divider = document.createElement('div');
    divider.className = 'tt-chat-divider';
    divider.textContent = '⏫ كومنتات سابقة (' + msgs.length + ')';
    block.appendChild(divider);
    for (const m of msgs) block.appendChild(buildHistoryMsg(m));
    list.insertBefore(block, list.firstChild);
    recentCommentsLoaded = true;
    const btn = document.getElementById('tt-chat-history-btn');
    if (btn) btn.style.display = 'none';
  } catch (e) { showToast(e.message, 'error'); }
}
function buildHistoryMsg(m) {
  const msg = document.createElement('div');
  msg.className = 'tiktok-chat-msg' + (m.user_id === state.user?.id ? ' mine' : '');
  const lv = parseInt(m.user_level) || 0;
  const lvImg = (lv >= 1 && lv <= 100) ? '<img src="/assets/levels/level_' + lv + '.' + (lv >= 1 && lv <= 10 ? 'gif' : 'png') + '?v=5" style="width:32px;height:12px;vertical-align:middle">' : '';
  msg.innerHTML = '<span class="tiktok-chat-name">' + escapeHtml(m.user_name || '') + '</span> ' + lvImg + verifBadge(m.family_verif || 'none', 16) + escapeHtml(m.message || '');
  return msg;
}

// ==================== 🎁 إدارة الهدايا (لوحة التحكم) ====================
let giftEditId = null;
function isGiftVideo(src) {
  if (!src) return false;
  if (/^data:video\//i.test(src)) return true;
  return /\.(mp4|webm|ogv|mov|m4v)(\?|$)/i.test(src);
}
async function loadAdminGifts() {
  try {
    const { gifts } = await api('GET', '/api/admin/gift-items');
    const list = document.getElementById('admin-gifts-list');
    if (!list) return;
    if (!gifts?.length) { list.innerHTML = '<div class="empty-text">لا توجد هدايا — أضف أول هدية من الأعلى</div>'; return; }
    const now = Date.now();
    list.innerHTML = gifts.map(g => {
      const s = g.start_date ? new Date(g.start_date) : null;
      const e = g.end_date ? new Date(g.end_date) : null;
      const notStarted = s && s.getTime() > now;
      const expired = e && e.getTime() < now;
      const stBadge = g.status !== 'active' ? '<span style="color:#ff6b6b;font-weight:800">⛔ موقوفة</span>'
        : expired ? '<span style="color:#ff6b6b;font-weight:800">⏰ منتهية</span>'
        : notStarted ? '<span style="color:#ffb74d;font-weight:800">🕐 لم تبدأ</span>'
        : '<span style="color:var(--success);font-weight:800">✅ مفعلة</span>';
      const fmt = d => d ? d.toLocaleString('ar-SA-u-nu-latn', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
      const gIcon = g.gift_image
        ? (isGiftVideo(g.gift_image)
            ? '<video src="' + g.gift_image + '" style="width:34px;height:30px;object-fit:contain;vertical-align:middle;border-radius:8px;margin-left:4px" muted autoplay loop playsinline preload="metadata"></video>'
            : '<img src="' + g.gift_image + '" style="width:30px;height:30px;object-fit:contain;vertical-align:middle;border-radius:8px;margin-left:4px">')
        : (g.emoji || '🎁');
      return '<div class="admin-family-item">' +
        '<div class="admin-family-name">' + gIcon + ' <b>' + escapeHtml(g.name) + '</b> — ' + (parseInt(g.coins)||0).toLocaleString('en') + ' كونزه' + (parseInt(g.price) ? ' · 💰' + g.price + ' ريال' : '') +
          '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">📅 من ' + fmt(s) + ' إلى ' + fmt(e) + '</div>' +
          '<div style="margin-top:2px">' + stBadge + '</div>' +
        '</div>' +
        '<div class="admin-family-actions">' +
          '<button class="btn btn-sm" onclick="editGiftAdmin(\'' + g.id + '\')">✏️ تعديل</button>' +
          (g.status === 'active'
            ? '<button class="btn btn-sm" onclick="toggleGiftAdmin(\'' + g.id + '\',\'inactive\')">⛔ إيقاف</button>'
            : '<button class="btn btn-sm" style="color:var(--success)" onclick="toggleGiftAdmin(\'' + g.id + '\',\'active\')">✅ تفعيل</button>') +
          '<button class="btn btn-sm btn-danger" onclick="deleteGiftAdmin(\'' + g.id + '\')">🗑️ حذف</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    const list = document.getElementById('admin-gifts-list');
    if (list) list.innerHTML = '<div class="empty-text">تعذر التحميل: ' + escapeHtml(e.message) + '</div>';
  }
}

function pickGiftEmoji(e) {
  const el = document.getElementById('gift-emoji');
  if (el) el.value = e;
  showToast('تم اختيار الرمز ' + e, 'success');
}
function resetGiftForm() {
  giftEditId = null;
  giftImageBase64 = '';
  ['gift-name','gift-emoji','gift-coins','gift-price','gift-start','gift-end'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const imgFile = document.getElementById('gift-image-file');
  if (imgFile) imgFile.value = '';
  const prev = document.getElementById('gift-image-preview');
  if (prev) { prev.style.display = 'none'; prev.src = ''; }
  const vPrev = document.getElementById('gift-video-preview');
  if (vPrev) { vPrev.style.display = 'none'; vPrev.src = ''; }
  const st = document.getElementById('gift-status');
  if (st) st.value = 'active';
  const btn = document.getElementById('gift-save-btn');
  if (btn) btn.textContent = '➕ إضافة هدية';
  const cb = document.getElementById('gift-cancel-btn');
  if (cb) cb.style.display = 'none';
}

async function saveGiftAdmin() {
  const name = document.getElementById('gift-name').value.trim();
  const coins = document.getElementById('gift-coins').value;
  if (!name) return showToast('اسم الهدية مطلوب', 'error');
  if (!coins || parseInt(coins) < 1) return showToast('عدد الكونزات مطلوب', 'error');
  const payload = {
    name,
    emoji: document.getElementById('gift-emoji').value.trim() || '🎁',
    coins: parseInt(coins),
    price: parseInt(document.getElementById('gift-price').value) || 0,
    start_date: document.getElementById('gift-start').value || null,
    end_date: document.getElementById('gift-end').value || null,
    status: document.getElementById('gift-status').value,
    gift_image: giftImageBase64 || undefined
  };
  // تحقق: النهاية بعد البداية
  if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
    return showToast('⚠️ تاريخ الانتهاء قبل تاريخ البداية — راجع التواريخ', 'error');
  }
  try {
    const r = giftEditId
      ? await api('POST', '/api/admin/gift-items/update', { ...payload, id: giftEditId })
      : await api('POST', '/api/admin/gift-items/add', payload);
    showToast(r.message, 'success');
    resetGiftForm();
    loadAdminGifts();
  } catch (e) { showToast(e.message, 'error'); }
}

async function editGiftAdmin(id) {
  try {
    const { gifts } = await api('GET', '/api/admin/gift-items');
    const g = gifts.find(x => x.id === id);
    if (!g) return showToast('الهدية غير موجودة', 'error');
    giftEditId = id;
    document.getElementById('gift-name').value = g.name || '';
    document.getElementById('gift-emoji').value = g.emoji || '';
    document.getElementById('gift-coins').value = g.coins || '';
    document.getElementById('gift-price').value = g.price || '';
    document.getElementById('gift-start').value = g.start_date || '';
    document.getElementById('gift-end').value = g.end_date || '';
    giftImageBase64 = '';
    const imgFile = document.getElementById('gift-image-file');
    if (imgFile) imgFile.value = '';
    const prev = document.getElementById('gift-image-preview');
    const vPrev = document.getElementById('gift-video-preview');
    if (prev && vPrev) {
      if (g.gift_image && isGiftVideo(g.gift_image)) {
        vPrev.src = g.gift_image; vPrev.style.display = 'block';
        prev.style.display = 'none'; prev.src = '';
      } else if (g.gift_image) {
        prev.src = g.gift_image; prev.style.display = 'block';
        vPrev.style.display = 'none'; vPrev.src = '';
      } else {
        prev.style.display = 'none'; prev.src = '';
        vPrev.style.display = 'none'; vPrev.src = '';
      }
      giftImageBase64 = g.gift_image || '';
    }
    const st = document.getElementById('gift-status');
    if (st) st.value = g.status || 'active';
    const btn = document.getElementById('gift-save-btn');
    if (btn) btn.textContent = '💾 حفظ التعديل';
    const cb = document.getElementById('gift-cancel-btn');
    if (cb) cb.style.display = '';
    document.getElementById('gift-name').scrollIntoView({ block: 'center', behavior: 'smooth' });
    showToast('✏️ عدّل البيانات ثم اضغط حفظ', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function toggleGiftAdmin(id, status) {
  try {
    const r = await api('POST', '/api/admin/gift-items/update', { id, status });
    showToast(status === 'active' ? '✅ تم تفعيل الهدية' : '⛔ تم إيقاف الهدية', 'success');
    loadAdminGifts();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteGiftAdmin(id) {
  if (!confirm('🗑️ حذف هذه الهدية نهائياً؟')) return;
  try {
    const r = await api('POST', '/api/admin/gift-items/delete', { id });
    showToast(r.message, 'success');
    if (giftEditId === id) resetGiftForm();
    loadAdminGifts();
  } catch (e) { showToast(e.message, 'error'); }
}
