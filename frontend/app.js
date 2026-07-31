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
(async function init() {
  // Check for auto-login token in URL (query param or hash)
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  let token = params.get('token') || (hash.startsWith('#token=') ? hash.replace('#token=', '') : null);
  
  if (token) {
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
  
  const savedToken = localStorage.getItem('token');
  if (savedToken) {
    try {
      const { user, family } = await api('GET', '/api/auth/verify');
      await loadApp(user, family);
    } catch(e) {
      localStorage.removeItem('token');
      showAuth('login');
    }
  } else {
    showAuth('login');
  }
})();

// ==================== AUTH ====================
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showToast('يرجى ملء جميع الحقول', 'error');
  try {
    showToast('جاري تسجيل الدخول...');
    const { token, user, family } = await api('POST', '/api/auth/login', { email, password });
    localStorage.setItem('token', token);
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
  localStorage.removeItem('token');
  if (socket) socket.disconnect();
  state.isLoggedIn = false; state.user = null; state.family = null;
  showAuth('login');
}

// ==================== LOAD APP ====================
async function loadApp(user, family) {
  Object.assign(state, { user, family, isFounder: user.role === 'founder', isLoggedIn: true, points: user.points || 0 });
  try {
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
    state.activeSession = diwData.session;
    state.diwaniyaOpen = diwData.session?.status === 'open';
  } catch (e) { console.error('Load error:', e); }
  updateAllUI();
  connectSocket();
  navigateTo('dashboard');
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
  document.getElementById('menu-avatar').textContent = state.user?.avatar || '👤';
  document.getElementById('points-display').textContent = state.points || 0;
  document.getElementById('family-badge').textContent = state.family?.name || 'العائلة';

  // Welcome greeting
  const greeting = document.getElementById('dashboard-greeting');
  const familyName = document.getElementById('welcome-family');
  const avatar = document.getElementById('welcome-avatar');
  if (avatar) avatar.textContent = state.user?.avatar || state.user?.name?.charAt(0) || '👤';
  
  if (state.family) {
    if (greeting) greeting.textContent = '👋 مرحباً بك ' + (state.user?.name || '') + ' 🏡';
    if (familyName) familyName.textContent = 'في عائلة ' + state.family.name;
  } else if (state.isLoggedIn) {
    if (greeting) greeting.textContent = '👋 مرحباً بك ' + (state.user?.name || '') + ' 🆕';
    if (familyName) familyName.textContent = 'أنت جديد، استكشف التطبيق أو انضم لعائلة';
  }

  // Show/hide join family menu option
  const joinMenu = document.getElementById('menu-join-family');
  if (joinMenu) {
    joinMenu.style.display = state.isLoggedIn && !state.family ? 'flex' : 'none';
  }

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

// ==================== SOCKET ====================
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(API_BASE, { transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    if (state.family?.id) socket.emit('join_family', state.family.id);
    if (state.user?.id) socket.emit('join_user', state.user.id);
    if (state.activeSession?.id) socket.emit('join_session', state.activeSession.id);
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
  socket.on('diwaniya_message', (msg) => addChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id));
  socket.on('diwaniya_audio', (msg) => addAudioMessage(msg.user_name, msg.audio, msg.audioType, msg.user_id === state.user?.id));
  socket.on('new_challenge', () => { showToast('⚔️ تحدٍ جديد!', 'success'); refreshData(); });
  socket.on('challenge_completed', () => { showToast('🏆 تم التحدي!', 'success'); refreshData(); });
  socket.on('leaderboard_update', () => refreshData());
  
  // WebRTC Audio Call Signaling
  socket.on('audio_offer', (data) => handleAudioOffer(data.from, data.userName, data.offer));
  socket.on('audio_answer', (data) => handleAudioAnswer(data.from, data.answer));
  socket.on('audio_ice_candidate', (data) => handleIceCandidate(data.from, data.candidate));
  socket.on('user_joined_call', (data) => {
    if (inLiveCall && data.userId !== state.user?.id) {
      // New user joined, send them an offer
      setTimeout(() => createOffer(data.userId, data.userName), 500);
    }
  });
  socket.on('user_left_call', (data) => removeRemoteAudio(data.userId));
  socket.on('call_participants', (data) => {
    // Join existing participants
    data.participants.forEach(p => {
      if (p.userId !== state.user?.id) {
        setTimeout(() => createOffer(p.userId, p.userName), 500);
      }
    });
  });
}

// ==================== DIWANIYA ====================
async function toggleDiwaniya() {
  if (state.diwaniyaOpen) return closeDiwaniya();
  const duration = parseInt(document.getElementById('diwaniya-duration').value);
  const topic = document.getElementById('diwaniya-topic').value.trim();
  const mode = document.getElementById('diwaniya-mode')?.value || 'text';
  try {
    const session = await api('POST', '/api/diwaniya/open', { durationMinutes: duration, topic, mode });
    state.diwaniyaOpen = true; state.activeSession = session;
    state.diwaniyaMode = mode;
    document.getElementById('diwaniya-toggle-btn').textContent = '🔒 إغلاق الديوانية';
    document.getElementById('stat-diwaniya').textContent = '🟢 مفتوحة';
    const modeLabel = { text: '✍️ كتابي', audio: '🎤 صوتي', both: '📝🎤 كتابي+صوتي' };
    document.querySelector('#timer-display .timer-label').textContent = 'الديوانية مفتوحة - ' + (modeLabel[mode] || mode);
    startDiwaniyaTimer(duration);
    setupChatMode(mode);
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

async function loadDiwaniyaMessages(sessionId) {
  try {
    const { messages } = await api('GET', `/api/diwaniya/messages/${sessionId}`);
    const room = document.getElementById('chat-room'); if (!room) return;
    room.innerHTML = '';
    messages.forEach(msg => addChatMessage(msg.user_name, msg.message, msg.user_id === state.user?.id));
  } catch(e) { console.error(e); }
}

// ==================== INVITES ====================
function addInviteInput() {
  const container = document.getElementById('invite-inputs');
  const group = document.createElement('div'); group.className = 'invite-input-group';
  group.innerHTML = '<input class="form-input" type="email" placeholder="example@email.com" dir="ltr"><button class="btn-remove" onclick="this.parentElement.remove()">✕</button>';
  container.appendChild(group);
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
    resultsDiv.innerHTML = invitations.map(inv =>
      `<div class="invite-result ${inv.status === 'sent' ? 'success' : 'error'}">${inv.email}: ${inv.status === 'sent' ? '✅ تم' : '⏳ موجود'}</div>`
    ).join('');
    const { invitations: updated } = await api('GET', '/api/family/invitations');
    state.invites = updated; updateInvitations();
    showToast('📨 تم إرسال الدعوات!', 'success');
  } catch(e) { showToast(e.message || 'فشل الإرسال', 'error'); }
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
  list.innerHTML = state.members.map(m =>
    '<div class="member-item"><div class="member-avatar">' + (m.avatar || m.name?.charAt(0) || '👤') +
    '</div><div class="member-info"><div class="member-name">' + (m.name || '') + '</div>' +
    (m.role === 'founder' ? '<span class="member-role-tag">المؤسس</span>' : '') + '</div></div>'
  ).join('');
}

function updateInvitations() {
  const list = document.getElementById('invitations-list');
  if (!state.invites?.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-text">لا توجد دعوات</div></div>'; return;
  }
  list.innerHTML = state.invites.map(inv =>
    '<div class="invitation-item"><div class="invitation-info"><div class="invitation-email">' + (inv.email || '') +
    '</div><small class="invited-by">بواسطة ' + (inv.invited_by_name || '') + '</small></div>' +
    '<span class="invitation-status ' + (inv.status || 'pending') + '">' +
    (inv.status === 'accepted' ? '✅ مقبولة' : '⏳ معلقة') + '</span></div>'
  ).join('');
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

function addChatMessage(name, text, isSent) {
  const room = document.getElementById('chat-room');
  if (!room) return;
  const empty = room.querySelector('.empty-state');
  if (empty) room.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isSent ? ' sent' : '');
  const initial = name?.charAt(0) || '👤';
  const time = new Date().toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });
  msg.innerHTML = '<div class="chat-avatar">' + initial + '</div><div><div class="chat-bubble">' + text +
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
  const labels = { text: '✍️ الديوانية كتابية', audio: '🎤 الديوانية صوتية - مكالمة مباشرة', both: '📝🎤 كتابية + مكالمة صوتية' };
  modeLabel.textContent = labels[mode] || '✍️ الديوانية';

  // Show/hide live audio section
  if (liveAudioSection) {
    liveAudioSection.style.display = (mode === 'audio' || mode === 'both') ? 'block' : 'none';
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
  } else if (mode === 'both') {
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
    '<div class="audio-bubble"><audio controls src="' + dataSrc + '" style="height:40px;max-width:220px"></audio></div>' +
    '<div class="chat-time">' + new Date().toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) + '</div></div>';
  room.appendChild(msg);
  room.scrollTop = room.scrollHeight;
}

// ==================== LIVE AUDIO CALL (WebRTC) ====================
let localStream = null;
let peerConnections = {};
let inLiveCall = false;

async function joinLiveAudio() {
  if (inLiveCall) return leaveLiveAudio();
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    inLiveCall = true;
    
    // Notify server we're joining
    socket.emit('join_audio_call', { 
      sessionId: state.activeSession.id, 
      userId: state.user.id, 
      userName: state.user.name 
    });
    
    updateAudioCallUI(true);
    showToast('🎤 أنت في المكالمة الصوتية الآن', 'success');
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
  
  inLiveCall = false;
  socket.emit('leave_audio_call', { sessionId: state.activeSession.id, userId: state.user.id });
  updateAudioCallUI(false);
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
        sessionId: state.activeSession.id
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
  
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('audio_offer', {
      to: peerId,
      offer: pc.localDescription,
      sessionId: state.activeSession.id,
      userName: state.user.name
    });
  } catch(e) {
    console.error('Offer error:', e);
  }
}

async function handleAudioOffer(fromId, fromName, offer) {
  const pc = createPeerConnection(fromId, fromName);
  if (!pc) return;
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('audio_answer', {
      to: fromId,
      answer: pc.localDescription,
      sessionId: state.activeSession.id
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

function addRemoteAudio(peerId, peerName, stream) {
  // Remove old audio element if exists
  const old = document.getElementById('audio-' + peerId);
  if (old) old.remove();
  
  const audio = document.createElement('audio');
  audio.id = 'audio-' + peerId;
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.controls = false;
  audio.style.display = 'none';
  document.body.appendChild(audio);
  
  // Show in call indicator
  const participantsDiv = document.getElementById('call-participants');
  if (participantsDiv) {
    const p = document.createElement('div');
    p.id = 'participant-' + peerId;
    p.className = 'call-participant';
    p.innerHTML = '<span class="call-dot"></span> ' + peerName;
    participantsDiv.appendChild(p);
  }
}

function removeRemoteAudio(peerId) {
  const audio = document.getElementById('audio-' + peerId);
  if (audio) { audio.pause(); audio.remove(); }
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
  } else {
    btn.textContent = '🎤 انضم للمكالمة الصوتية';
    btn.className = 'btn btn-accent btn-full';
    document.getElementById('call-controls').style.display = 'none';
  }
}
