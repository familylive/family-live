// ==================== API CONFIG ====================
const API_BASE = window.location.origin;
let socket = null;

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
    if (!res.ok) throw new Error(data.error || 'خطأ في الاتصال');
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('انتهت مهلة الاتصال، تحقق من اتصالك');
    if (err.message === 'Failed to fetch') throw new Error('تعذر الاتصال بالخادم، حاول مرة أخرى');
    throw err;
  }
}

// ==================== INIT ====================
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
    }, 2600);
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
  
  // Wait for splash, then check auth
  await new Promise(r => setTimeout(r, 1500));
  const splash = document.getElementById('splash-screen');
  if (splash) splash.classList.add('hide');
  await new Promise(r => setTimeout(r, 600));
  document.getElementById('app').classList.add('visible');
  if (splash) splash.style.display = 'none';
  
  const savedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (savedToken) {
    try {
      const { user, family } = await api('GET', '/api/auth/verify');
      await loadApp(user, family);
    } catch(e) {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      showAuth('landing');
      loadLandingPage();
    }
  } else {
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
  try {
  document.getElementById('menu-user-name').textContent = state.user?.name || '';
  document.getElementById('menu-user-role').textContent = state.isFounder ? 'المؤسس 👑' : 'عضو';
  const menuAv = document.getElementById('menu-avatar');
  if (state.user?.avatar && state.user.avatar.startsWith('data:')) {
    menuAv.innerHTML = '<img src="' + state.user.avatar + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
  } else {
    menuAv.textContent = state.user?.avatar || '👤';
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
  if (avatar) avatar.textContent = state.user?.avatar || state.user?.name?.charAt(0) || '👤';
  
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
  
  // Show/hide admin menu for admin role
  const adminMenu = document.getElementById('menu-admin');
  if (adminMenu) {
    adminMenu.style.display = state.user?.role === 'admin' ? 'flex' : 'none';
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
    document.getElementById('founder-name').textContent = founder.name;
    document.getElementById('founder-avatar').textContent = founder.avatar || founder.name?.charAt(0) || '👤';
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
    document.getElementById('stat-diwaniya').textContent = '🟢 مفتوحة';
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
    document.getElementById('stat-diwaniya').textContent = '🔴 متوقفة';
  });
  socket.on('diwaniya_closed_violation', (data) => {
    // Close diwaniya UI
    state.diwaniyaOpen = false; state.activeSession = null;
    stopDiwaniyaTimer(); enableChat(false);
    document.getElementById('diwaniya-toggle-btn').textContent = '🔓 فتح الديوانية';
    document.getElementById('stat-diwaniya').textContent = '🔴 متوقفة';
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
  socket.on('diwaniya_message', (msg) => {
    addChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id);
    const tk = document.getElementById('tiktok-chat');
    if (tk && tk.style.display !== 'none') addTikTokChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id);
  });
  socket.on('diwaniya_audio', (msg) => addAudioMessage(msg.user_name, msg.audio, msg.audioType, msg.user_id === state.user?.id));
  socket.on('new_challenge', () => { showToast('⚔️ تحدٍ جديد!', 'success'); refreshData(); });
  socket.on('challenge_completed', () => { showToast('🏆 تم التحدي!', 'success'); refreshData(); });
  socket.on('leaderboard_update', () => refreshData());
  
  // WebRTC Audio Call Signaling
  socket.on('audio_offer', (data) => { if (data.avatar) peerAvatars[data.from] = data.avatar; handleAudioOffer(data.from, data.userName, data.offer); });
  socket.on('audio_answer', (data) => handleAudioAnswer(data.from, data.answer));
  socket.on('audio_ice_candidate', (data) => handleIceCandidate(data.from, data.candidate));
  socket.on('user_joined_call', (data) => {
    if (data.avatar) peerAvatars[data.userId] = data.avatar;
    if (inLiveCall && data.userId !== state.user?.id) {
      showEntryBanner(data.userName, data.avatar, 'انضم للديوانية 🎉');
      if (!state.callMembers) state.callMembers = {};
      state.callMembers[data.userId] = data.userName;
      updateCallPresence();
      // New user joined, send them an offer
      setTimeout(() => createOffer(data.userId, data.userName), 500);
    }
  });
  socket.on('user_left_call', (data) => {
    removeRemoteAudio(data.userId);
    if (state.callMembers) delete state.callMembers[data.userId];
    updateCallPresence();
  });
  socket.on('call_full', (data) => {
    showToast(data.message || 'المكالمة ممتلئة', 'error');
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
    document.getElementById('stat-diwaniya').textContent = '🔴 متوقفة';
  });
  socket.on('audio_kick', (data) => {
    if (data.userId === state.user?.id) {
      showToast('👢 تم طردك من المكالمة', 'error');
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
  socket.on('session_invalid', () => {
    localStorage.clear();
    sessionStorage.clear();
    if (socket) socket.disconnect();
    location.reload();
  });
  socket.on('coins_charged', (data) => {
    showToast('🎉 تم شحن حسابك بـ ' + data.amount + ' كوينز!', 'success');
    playNotificationSound();
    refreshWalletHeader();
  });
  socket.on('coins_transferred', (data) => {
    showToast('🔄 استلمت ' + data.amount + ' كوينز من ' + (data.fromName || 'عضو') + ' (' + (data.fromPublicId || '') + ')', 'success');
    playNotificationSound();
    refreshWalletHeader();
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
  socket.on('battle_ended', (b) => {
    showToast('🏆 فاز ' + (b.winnerName || 'أحد اللاعبين') + ' وحصل على 500 كوينز!', 'success');
    playNotificationSound();
    renderBattle(null);
  });
  socket.on('camera_invite', (data) => {
    // I was invited to go on camera
    pendingCameraInvite = data;
    document.getElementById('camera-invite-text').textContent = 'تمت دعوتك للمشاركة بكاميرا الديوانية من قبل ' + (data.founderName || 'المؤسس');
    document.getElementById('camera-invite-modal').style.display = 'flex';
    playNotificationSound();
  });
  socket.on('camera_invite_response', (data) => {
    if (data.accept) showToast('🎥 ' + (data.inviteeName || 'العضو') + ' وافق على المشاركة بالكاميرا!', 'success');
    else showToast('❌ ' + (data.inviteeName || 'العضو') + ' رفض المشاركة بالكاميرا', 'error');
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
      if (p.userId !== state.user?.id) {
        state.callMembers[p.userId] = p.userName;
        setTimeout(() => createOffer(p.userId, p.userName), 500);
      }
    });
    // Fancy entry: show the first existing member banner briefly (TikTok style)
    if (data.participants.length && data.participants[0].userId !== state.user?.id) {
      const first = data.participants[0];
      showEntryBanner(first.userName, first.avatar, 'موجود في الديوانية 👋');
    }
    updateCallPresence();
  });
}

// ==================== DIWANIYA ====================
async function toggleDiwaniya() {
  if (state.diwaniyaOpen) return closeDiwaniya();
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
    document.getElementById('diwaniya-toggle-btn').textContent = '🔒 إغلاق الديوانية';
    document.getElementById('stat-diwaniya').textContent = '🟢 مفتوحة';
    const modeLabel = { text: '✍️ كتابي', audio: '🎤 صوتي', video: '🎥 فيديو', both: '📝🎤 كتابي+صوتي', all: '📝🎥🎤 كل شي' };
    document.querySelector('#timer-display .timer-label').textContent = 'الديوانية مفتوحة - ' + (modeLabel[mode] || mode);
    startDiwaniyaTimer(duration);
    setupChatMode(mode);
    startMessagePolling();
    // Show video limit control for founder
    const vlc = document.getElementById('video-limit-control');
    if (vlc) vlc.style.display = state.isFounder ? 'flex' : 'none';
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
    document.getElementById('stat-diwaniya').textContent = '🔴 متوقفة';
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
      joinBtn.textContent = '🎥 انضم لمكالمة الفيديو';
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

async function loadDiwaniyaMessages(sessionId, isPoll = false) {
  try {
    const { messages } = await api('GET', `/api/diwaniya/messages/${sessionId}`);
    const room = document.getElementById('chat-room'); if (!room) return;
    room.innerHTML = '';
    messages.forEach(msg => addChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id, msg.avatar));
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
function inviteViaWhatsApp() {
  const div = document.getElementById('whatsapp-members-select');
  const list = document.getElementById('whatsapp-members-list');
  if (div) div.style.display = div.style.display === 'none' ? 'block' : 'none';
  if (!list) return;
  const withWhatsApp = (state.members || []).filter(m => m.whatsapp && m.id !== state.user?.id);
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
function updateMembersList() {
  const list = document.getElementById('members-list');
  if (!state.members?.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-text">لا يوجد أعضاء</div></div>';
    document.getElementById('members-count').textContent = '0'; return;
  }
  document.getElementById('members-count').textContent = state.members.length;
  const onlineIds = state.onlineMembers || [];
  list.innerHTML = state.members.map(m => {
    const isOnline = onlineIds.includes(m.id);
    return '<div class="member-item"><div class="member-avatar">' + (m.avatar || m.name?.charAt(0) || '👤') +
    '</div><div class="member-info"><div class="member-name">' + (m.name || '') + ' ' +
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

function addChatMessage(name, text, isSent, avatar) {
  const room = document.getElementById('chat-room');
  if (!room) return;
  const empty = room.querySelector('.empty-state');
  if (empty) room.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isSent ? ' sent' : '');
  msg.avatar = avatar;
  const initial = name?.charAt(0) || '👤';
  const time = new Date().toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });
  msg.innerHTML = '<div class="chat-avatar">' + initial + '</div><div>' +
    '<div class="chat-sender">' + (name || '') + '</div>' +
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
  const labels = { text: '✍️ الديوانية كتابية', audio: '🎤 الديوانية صوتية - مكالمة مباشرة', video: '🎥 مكالمة فيديو - حد أقصى 6', both: '📝🎤 كتابية + صوتية', all: '📝🎥🎤 كل شي' };
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
    // Video only - hide text input, video call via join button
    chatInput.innerHTML = '';
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
    addAudioMessage(state.user?.name || 'أنت', base64Audio, blob.type, true);
  };
  reader.readAsDataURL(blob);
}

function addAudioMessage(name, audioBase64, audioType, isSent) {
  const room = document.getElementById('chat-room');
  if (!room) return;
  const empty = room.querySelector('.empty-state');
  if (empty) room.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isSent ? ' sent' : '');
  const initial = name?.charAt(0) || '👤';
  const dataSrc = 'data:' + audioType + ';base64,' + audioBase64;
  
  msg.innerHTML = '<div class="chat-avatar">' + initial + '</div><div>' +
    '<div class="chat-sender">' + (name || '') + '</div>' +
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

// TikTok-style entry banner (shows for ~5s when a member enters)
let entryBannerTimer = null;
function showEntryBanner(name, avatar, subText) {
  const banner = document.getElementById('entry-banner');
  if (!banner) return;
  const nameEl = document.getElementById('entry-name');
  const subEl = document.getElementById('entry-sub');
  const avEl = document.getElementById('entry-avatar');
  if (nameEl) nameEl.textContent = name || 'عضو';
  if (subEl) subEl.textContent = subText || 'انضم للديوانية 🎉';
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
    setTimeout(() => { banner.style.display = 'none'; }, 600);
  }, 6500);
}

// Presence: members currently in the call
function updateCallPresence() {
  const countEl = document.getElementById('call-count');
  if (countEl) countEl.textContent = (Object.keys(state.callMembers || {}).length + 1);
  const list = document.getElementById('call-participants');
  if (!list) return;
  let html = '<div class="call-participant"><span class="call-dot"></span> أنت</div>';
  Object.entries(state.callMembers || {}).forEach(([id, name]) => {
    html += '<div class="call-participant" id="participant-' + id + '"><span class="call-dot"></span> ' + name +
      (state.isFounder || state.user?.role === 'admin' ?
        ' <button class="member-action-btn" title="طرد من الديوانية" onclick="kickFromDiwaniya(\'' + id + '\')">⛔</button>' +
        '<button class="member-action-btn" title="تقييد (يستمع فقط)" onclick="restrictMember(\'' + id + '\')">🙊</button>' : '') +
    '</div>';
  });
  list.innerHTML = html;
}

// ==================== CALL CONTROLS ====================
let micMuted = false;
let camOff = false;

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
  if (myVideo) myVideo.style.display = camOff ? 'none' : 'block';
  const myTile = document.getElementById('my-video-tile');
  if (myTile) {
    let overlay = myTile.querySelector('.cam-off-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'cam-off-overlay';
      overlay.style.display = 'none';
      overlay.innerHTML = '<div class="cam-off-circle">' + avatarHtml(globalThis.state?.user?.avatar) + '</div><div class="cam-off-icon">🚫</div><div class="cam-off-label">كاميرا مغلقة</div>';
      myTile.appendChild(overlay);
    }
    overlay.style.display = camOff ? 'flex' : 'none';
  }
  const tileState = document.getElementById('my-tile-state');
  if (tileState) {
    tileState.textContent = '';
    if (!micMuted) tileState.classList.remove('muted-state');
  }
  showToast(camOff ? '🚫 أغلقت الكاميرا - يسمعونك فقط' : '🎥 فتحت الكاميرا', camOff ? 'error' : 'success');
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
    document.getElementById('video-limit-display').textContent = limit;
    showToast('🎥 عدد الكاميرات: ' + limit, 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function loadSecretRoomStatus() {
  if (!state.family?.id || !state.isFounder) return;
  try {
    const status = await api('GET', '/api/diwaniya/secret-room');
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
  try {
    const result = await api('POST', '/api/diwaniya/secret-room/purchase');
    document.getElementById('secret-room-price').textContent = result.price;
    showToast(result.message, 'success');
    showPaymentModal(result.price, 'تفعيل الغرفة المغلقة');
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
        battle.player_a_name = a?.name || battle.player_a_id.slice(0,6);
        battle.player_b_name = b?.name || battle.player_b_id.slice(0,6);
      } catch(e) {}
      renderBattle(battle);
    }
  } catch(e) {}
}

async function loadDiwaniyaCapacity() {
  if (!state.family?.id) return;
  try {
    const { capacity, packages } = await api('GET', '/api/diwaniya/capacity');
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
  if (!confirm('💳 شراء باقة توسعة الديوانية إلى ' + cap + ' عضو؟')) return;
  try {
    const result = await api('POST', '/api/diwaniya/capacity/purchase', { capacity: cap });
    showToast(result.message, 'success');
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
    // Normal users: request camera (server limits to 6). Moderator: audio only.
    const wantVideo = !isModeratorVisit;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
    
    if (isModeratorVisit) {
      // Forced observer: mute mic immediately, no camera at all
      localStream.getAudioTracks().forEach(t => t.enabled = false);
      micMuted = true;
      camOff = true;
    }
    
    inLiveCall = true;
    
    // Notify server we're joining (observer flag for moderators)
    socket.emit('join_audio_call', { 
      sessionId: state.activeSession.id, 
      userId: state.user.id, 
      userName: state.user.name,
      isObserver: isModeratorVisit,
      wantsVideo: !isModeratorVisit
    });
    
    state.callMembers = {};
    updateCallPresence();
    showEntryBanner(state.user?.name, state.user?.avatar, 'انضممت للديوانية 🎉');
    const presenceEl = document.getElementById('call-presence');
    if (presenceEl) presenceEl.style.display = 'block';
    const invBtn = document.getElementById('cam-invite-btn');
    if (invBtn) invBtn.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    const bsb = document.getElementById('battle-start-box');
    if (bsb) bsb.style.display = (state.isFounder || state.user?.role === 'admin') ? 'block' : 'none';
    updateAudioCallUI(true);
    startCallWatermark();
    setTikTokMode(true); // TikTok layout by default with chat below
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
      showToast('🎤 أنت في المكالمة الصوتية الآن', 'success');
    }
  } catch(e) {
    showToast('الرجاء السماح بالميكروفون', 'error');
    inLiveCall = false;
  }
}

function leaveLiveAudio() {
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
  state.callMembers = {};
  const presenceEl2 = document.getElementById('call-presence');
  if (presenceEl2) presenceEl2.style.display = 'none';
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
  updateAudioCallUI(false);
  // Force-hide call UI even if updateAudioCallUI failed
  const ctrl = document.getElementById('call-controls');
  const grid = document.getElementById('video-grid');
  if (ctrl) ctrl.style.display = 'none';
  if (grid) { grid.style.display = 'none'; grid.innerHTML = ''; }
  // Reset my video
  const myVideo = document.getElementById('my-video');
  if (myVideo) { myVideo.srcObject = null; myVideo.style.display = 'none'; }
  showToast('غادرت المكالمة');
}

function createPeerConnection(peerId, peerName) {
  if (peerConnections[peerId]) return;
  
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
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

// ==================== CALL FULLSCREEN (tap camera to zoom) ====================
function toggleCallFullscreen() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const btn = document.getElementById('fullscreen-toggle-btn');
  // Fullscreen API
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    if (btn) btn.classList.remove('zoom');
    grid.classList.remove('video-zoom');
    return;
  }
  if (grid.requestFullscreen) {
    grid.requestFullscreen().catch(() => {
      grid.classList.toggle('video-zoom');
      if (btn) btn.classList.toggle('zoom', grid.classList.contains('video-zoom'));
    });
    document.addEventListener('fullscreenchange', function fs() {
      if (!document.fullscreenElement) {
        grid.classList.remove('video-zoom');
        if (btn) btn.classList.remove('zoom');
        document.removeEventListener('fullscreenchange', fs);
      }
    });
  } else {
    grid.classList.toggle('video-zoom');
    if (btn) btn.classList.toggle('zoom', grid.classList.contains('video-zoom'));
  }
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
  if (sel.options.length <= 1) return showToast('لا يوجد أعضاء لتحديهم - ادخلوا المكالمة أولاً', 'error');
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
  if (!bar || !b || (b.status !== 'active' && b.status !== 'pending')) { if (bar) bar.style.display = 'none'; if (startBox) startBox.style.display = 'block'; return; }
  if (startBox) startBox.style.display = 'none';
  bar.style.display = 'block';
  // Players names/avatars
  const na = b.player_a_name || 'لاعب أ', nb = b.player_b_name || 'لاعب ب';
  document.getElementById('battle-name-a').textContent = na;
  document.getElementById('battle-name-b').textContent = nb;
  document.getElementById('battle-coins-a').textContent = '🪙 ' + (b.coins_a || 0);
  document.getElementById('battle-coins-b').textContent = '🪙 ' + (b.coins_b || 0);
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
    if (battleTimer) clearInterval(battleTimer);
    battleTimer = setInterval(() => {
      const e = Math.floor((Date.now() - new Date(b.start_time).getTime()) / 1000);
      const l = Math.max(0, dur - e);
      document.getElementById('battle-timer').textContent = '⏱️ ' + Math.floor(l / 60) + ':' + String(l % 60).padStart(2, '0');
      if (l <= 0) { clearInterval(battleTimer); endBattleNow(); }
    }, 1000);
  }
}

async function supportBattle(side) {
  if (!currentBattle) return;
  const coins = prompt('🎁 كم كوينز تدعم به؟', '100');
  if (!coins || parseInt(coins) <= 0) return;
  if (!confirm('⚔️ دعم اللاعب بـ ' + coins + ' كوينز؟')) return;
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

function addTikTokChatMessage(name, text, isSent) {
  const list = document.getElementById('tiktok-chat-list');
  if (!list) return;
  const msg = document.createElement('div');
  msg.className = 'tiktok-chat-msg' + (isSent ? ' mine' : '');
  msg.innerHTML = '<span class="tiktok-chat-name">' + (name || '') + '</span> ' + escapeHtml(text);
  list.appendChild(msg);
  // Keep max 30 messages
  while (list.children.length > 30) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function syncTikTokChat() {
  // Re-render from the main chat room messages if available
  const list = document.getElementById('tiktok-chat-list');
  const room = document.getElementById('chat-room');
  if (!list || !room) return;
  list.innerHTML = '';
  Array.from(room.querySelectorAll('.chat-msg')).forEach(m => {
    const name = m.querySelector('.chat-sender')?.textContent || '';
    const text = m.querySelector('.chat-bubble')?.textContent || '';
    const isSent = m.classList.contains('sent');
    const msg = document.createElement('div');
    msg.className = 'tiktok-chat-msg' + (isSent ? ' mine' : '');
    msg.innerHTML = '<span class="tiktok-chat-name">' + escapeHtml(name) + '</span> ' + escapeHtml(text);
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
  const tk = document.getElementById('tiktok-chat');
  if (tk) tk.style.display = on ? 'flex' : 'none';
  const btn = document.getElementById('tiktok-mode-btn');
  if (btn) btn.classList.toggle('zoom', on);
  if (on) setTimeout(syncTikTokChat, 300);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function toggleTikTokMode() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const on = !grid.classList.contains('tiktok-mode');
  setTikTokMode(on);
  showToast(on ? '🎬 وضع تيك توك - أنت كبير والدردشة تحت' : '🖼 وضع الشبكة - بجوار بعض', 'success');
}

// Tap on any video tile to zoom
function bindVideoTileZoom() {
  document.getElementById('video-grid')?.addEventListener('click', (e) => {
    if (e.target.closest('.video-tile')) toggleCallFullscreen();
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

function showFamilyImageInUI() {
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

function avatarHtml(avatar) {
  if (avatar && avatar.startsWith('data:')) return '<img src="' + avatar + '" alt="">';
  return '<div class="avatar-emoji">' + (avatar || '👤') + '</div>';
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
      '<div class="cam-off-overlay" style="display:none">' +
        '<div class="cam-off-circle">' + avatarHtml(peerAvatars[peerId]) + '</div>' +
        '<div class="cam-off-icon">🚫</div>' +
        '<div class="cam-off-label">كاميرا مغلقة</div>' +
      '</div>' +
      '<div class="video-name">' + peerName + '</div>';
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
  if (!Object.keys(members).length) return showToast('لا يوجد متواجدون في المكالمة حالياً', 'error');
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
function respondCameraInvite(accept) {
  const modal = document.getElementById('camera-invite-modal');
  if (accept && !pendingCameraInvite) return;
  if (accept) {
    enableMyCamera().then(ok => {
      socket.emit('camera_invite_response', {
        to: pendingCameraInvite.founderId,
        accept: ok,
        inviteeName: state.user?.name
      });
      showToast(ok ? '🎥 تم تشغيل كاميرتك - أنت الآن بالمشاركة!' : 'تعذر تشغيل الكاميرا - ارفض أو جرب مرة أخرى', ok ? 'success' : 'error');
    });
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

function updateAudioCallUI(inCall) {
  const btn = document.getElementById('join-audio-btn');
  if (!btn) return;
  
  if (inCall) {
    btn.textContent = '🔴 إنهاء المكالمة';
    btn.className = 'btn btn-danger btn-full';
    document.getElementById('call-controls').style.display = 'block';
    document.getElementById('video-grid').style.display = 'grid';
    // Show my local video
    const myVideo = document.getElementById('my-video');
    if (myVideo && localStream) {
      myVideo.srcObject = localStream;
      myVideo.style.display = 'block';
    }
  } else {
    btn.textContent = '🎥 انضم لمكالمة الفيديو';
    btn.className = 'btn btn-accent btn-full';
    document.getElementById('call-controls').style.display = 'none';
    document.getElementById('video-grid').style.display = 'none';
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
