/**
 * app.js - 三年日記 Today 頁面核心互動、排版與 IndexedDB 整合
 */

// ==================== Apple-style Toast Notifications ====================
window.showToast = function(message, type = 'success') {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast-notification';
    const deviceFrame = document.querySelector('.device-frame');
    if (deviceFrame) {
      deviceFrame.appendChild(toast);
    } else {
      document.body.appendChild(toast);
    }
  }
  toast.textContent = message;
  toast.className = 'toast-notification show' + (type === 'error' ? ' error' : '');
  if (window.toastTimeout) clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
};

// Override default window.alert with Apple-style toast notifications
window.alert = function(msg) {
  const isError = msg.includes('⚠️') || msg.includes('失敗') || msg.includes('錯誤') || msg.includes('限制') || msg.includes('無效') || msg.includes('有誤') || msg.includes('未填寫') || msg.includes('最多');
  window.showToast(msg, isError ? 'error' : 'success');
};

const State = {
  selectedMood: 'black',
  diaryWordCount: 0,
  uploadedImages: [], // 儲存當前正在新增/編輯的備忘錄圖片 (Base64)
  editingMemoId: null, // 當前正在編輯的備忘錄 ID，null 表示新增模式
  activeDate: '2026-07-15', // 模擬今天日期
  weeklyOffset: 0, // 週記回顧的週數偏移量 (0:當週, -1:上一週...)
  currentUser: 'user_a', // 當前登入用戶 (模擬 User A / User B)
  splashDismissed: false
};

let activeCryptoAction = null; // 'backup' 或 'restore'
let activeRestorePayload = null; // 暫存等待密碼解密的備份資料

// ==================== PWA SyncManager (Retry Queue & Auto-Sync) ====================
const SyncManager = {
  getQueue() {
    try {
      return JSON.parse(localStorage.getItem('sync_retry_queue') || '[]');
    } catch (_) {
      return [];
    }
  },
  saveQueue(queue) {
    localStorage.setItem('sync_retry_queue', JSON.stringify(queue));
  },
  addToQueue(action, data) {
    const queue = this.getQueue();
    queue.push({
      id: Math.random().toString(36).substring(2, 9),
      action,
      data,
      timestamp: Date.now()
    });
    this.saveQueue(queue);
    this.updateStatusUI();
    this.processQueue();
  },
  updateStatusUI() {
    const indicator = document.getElementById('sync-status-indicator');
    if (!indicator) return;
    const queue = this.getQueue();
    if (!navigator.onLine) {
      indicator.textContent = '離線中';
      indicator.style.backgroundColor = 'rgba(92, 92, 94, 0.15)';
      indicator.style.color = 'var(--color-mood-black)';
    } else if (queue.length > 0) {
      indicator.textContent = `待同步 (${queue.length})`;
      indicator.style.backgroundColor = 'rgba(233, 196, 106, 0.15)';
      indicator.style.color = 'var(--color-mood-yellow)';
    } else {
      indicator.textContent = '已同步';
      indicator.style.backgroundColor = 'rgba(138, 154, 134, 0.15)';
      indicator.style.color = 'var(--color-mood-green)';
    }
  },
  async processQueue() {
    if (!navigator.onLine) {
      this.updateStatusUI();
      return;
    }
    let queue = this.getQueue();
    if (queue.length === 0) {
      this.updateStatusUI();
      return;
    }
    console.log(`[SyncManager] Processing ${queue.length} queued sync tasks...`);
    while (queue.length > 0) {
      const item = queue[0];
      try {
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log(`[SyncManager] Synced item: ${item.action}`, item.data);
        queue.shift();
        this.saveQueue(queue);
        this.updateStatusUI();
      } catch (err) {
        console.error('[SyncManager] Sync failed:', err);
        break;
      }
    }
  }
};

window.addEventListener('online', () => {
  console.log('[Network] Browser came online. Triggering Sync...');
  SyncManager.processQueue();
});
window.addEventListener('offline', () => {
  console.log('[Network] Browser went offline.');
  SyncManager.updateStatusUI();
});

// ==================== AirPods-style Mood Notification Toast ====================
let airpodsToastTimeout = null;

function showAirpodsToast(mood, title) {
  const toast = document.getElementById('airpods-toast');
  const dot = document.getElementById('airpods-toast-dot');
  const text = document.getElementById('airpods-toast-text');
  
  if (!toast || !dot || !text) return;
  
  const colors = {
    black: '#4a4a4a',
    yellow: '#E8C547',
    green: '#8A9A86',
    blue: '#70A9A1',
    red: '#AB3B3A'
  };
  
  dot.style.backgroundColor = colors[mood] || '#fff';
  text.textContent = `今日心情：${title}`;
  
  toast.classList.remove('show');
  void toast.offsetWidth; // Force layout engine reflow to restart transition
  toast.classList.add('show');
  
  if (airpodsToastTimeout) clearTimeout(airpodsToastTimeout);
  airpodsToastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

// ==================== NextAuth Session 模擬 ====================
function getSession() {
  try {
    const sessionStr = localStorage.getItem('next_auth_session');
    if (!sessionStr) return null;
    const session = JSON.parse(sessionStr);
    if (session.expires && new Date(session.expires) < new Date()) {
      localStorage.removeItem('next_auth_session');
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

function setSession(userId, email, provider) {
  const expires = new Date();
  expires.setDate(expires.getDate() + 30); // 30-day session lifetime
  const session = {
    userId,
    user: { id: userId, email, provider },
    expires: expires.toISOString()
  };
  localStorage.setItem('next_auth_session', JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem('next_auth_session');
}

let cachedUserObj = null;

async function fetchCurrentUserObj() {
  const session = getSession();
  if (session) {
    cachedUserObj = await DiaryDB.getUser(session.userId);
  } else {
    cachedUserObj = null;
  }
  return cachedUserObj;
}

function getCachedUser() {
  return cachedUserObj;
}

// ==================== 路由與頁面保護 ====================
/**
 * 核心路由器 (handleRouting)
 * 負責攔截無效雜湊 (hash) 導航，並實施安全保護防線：
 * 1. 認證檢查 (Authentication Guard)：無 Session 時強制導回 #login，隱藏導航與切換器。
 * 2. 註冊引導檢查 (Onboarding Guard)：已登入但未設定暱稱時強制進入 #onboarding。
 * 3. 頁面狀態同步：將登入用戶 ID 映射至 State.currentUser 並重繪所有視圖。
 */
async function handleRouting() {
  const session = getSession();
  
  const indicators = document.getElementById('app-story-indicators');
  const switcher = document.querySelector('.profile-switcher-container');
  
  const loginPage = document.getElementById('login-page');
  const onboardingPage = document.getElementById('onboarding-page');
  const todayPage = document.getElementById('today-page');
  const weeklyPage = document.getElementById('weekly-page');
  const gardenPage = document.getElementById('garden-page');
  const partnerPage = document.getElementById('partner-page');
  
  const splashPage = document.getElementById('splash-page');

  // 檢查是否已認證：若 session 不存在或過期，強制引導至初始畫面或登入頁
  if (!session) {
    if (!State.splashDismissed) {
      if (window.location.hash !== '#splash') {
        window.location.hash = 'splash';
        return;
      }
      if (indicators) indicators.style.display = 'none';
      if (switcher) switcher.style.display = 'none';
      
      if (splashPage) splashPage.classList.remove('hidden');
      if (loginPage) loginPage.classList.add('hidden');
      if (onboardingPage) onboardingPage.classList.add('hidden');
      if (todayPage) todayPage.classList.add('hidden');
      if (weeklyPage) weeklyPage.classList.add('hidden');
      if (gardenPage) gardenPage.classList.add('hidden');
      if (partnerPage) partnerPage.classList.add('hidden');
      return;
    }

    if (window.location.hash !== '#login' && window.location.hash !== '#onboarding') {
      window.location.hash = 'login';
      return;
    }
    
    if (window.location.hash === '#onboarding') {
      if (indicators) indicators.style.display = 'none';
      if (switcher) switcher.style.display = 'none';
      
      if (splashPage) splashPage.classList.add('hidden');
      if (loginPage) loginPage.classList.add('hidden');
      if (onboardingPage) onboardingPage.classList.remove('hidden');
      if (todayPage) todayPage.classList.add('hidden');
      if (weeklyPage) weeklyPage.classList.add('hidden');
      if (gardenPage) gardenPage.classList.add('hidden');
      if (partnerPage) partnerPage.classList.add('hidden');
      setupOnboardingInput();
      return;
    }
    
    if (indicators) indicators.style.display = 'none';
    if (switcher) switcher.style.display = 'none';
    
    if (splashPage) splashPage.classList.add('hidden');
    if (loginPage) loginPage.classList.remove('hidden');
    if (onboardingPage) onboardingPage.classList.add('hidden');
    if (todayPage) todayPage.classList.add('hidden');
    if (weeklyPage) weeklyPage.classList.add('hidden');
    if (gardenPage) gardenPage.classList.add('hidden');
    if (partnerPage) partnerPage.classList.add('hidden');
    
    return;
  }

  // 已認證狀態下，隱藏初始畫面與登入畫面
  if (splashPage) splashPage.classList.add('hidden');
  if (loginPage) loginPage.classList.add('hidden');
  
  // 檢查 User Profile 是否已填寫 display name (防範跳過引導頁)
  const user = await DiaryDB.getUser(session.userId);
  if (!user || !user.displayName) {
    if (window.location.hash !== '#onboarding') {
      window.location.hash = 'onboarding';
      return;
    }
    
    if (indicators) indicators.style.display = 'none';
    if (switcher) switcher.style.display = 'none';
    
    if (loginPage) loginPage.classList.add('hidden');
    if (onboardingPage) onboardingPage.classList.remove('hidden');
    if (todayPage) todayPage.classList.add('hidden');
    if (weeklyPage) weeklyPage.classList.add('hidden');
    if (gardenPage) gardenPage.classList.add('hidden');
    if (partnerPage) partnerPage.classList.add('hidden');
    
    setupOnboardingInput();
    return;
  }
  
  // 登入且已 onboarding，將 State.currentUser 映射到該使用者 ID，並載入快取
  State.currentUser = user.id;
  await fetchCurrentUserObj();
  updateSettingsProfileUI(user);
  
  if (indicators) indicators.style.display = '';
  if (switcher) switcher.style.display = '';
  
  // 修正 profile switcher 對應值
  const profileSwitcher = document.getElementById('profile-switcher');
  if (profileSwitcher) {
    profileSwitcher.value = State.currentUser;
  }
  
  if (window.location.hash === '#login' || window.location.hash === '#onboarding' || !window.location.hash) {
    window.location.hash = 'today';
    return;
  }
  
  const currentHash = window.location.hash.substring(1);
  
  if (loginPage) loginPage.classList.add('hidden');
  if (onboardingPage) onboardingPage.classList.add('hidden');
  if (partnerPage) partnerPage.classList.add('hidden');
  
  if (currentHash === 'today') {
    if (todayPage) todayPage.classList.remove('hidden');
    if (weeklyPage) weeklyPage.classList.add('hidden');
    if (gardenPage) gardenPage.classList.add('hidden');
    
    const barToday = document.getElementById('bar-today');
    const barWeekly = document.getElementById('bar-weekly');
    const barGarden = document.getElementById('bar-garden');
    const barPartner = document.getElementById('bar-partner');
    if (barToday) barToday.classList.add('active');
    if (barWeekly) barWeekly.classList.remove('active');
    if (barGarden) barGarden.classList.remove('active');
    if (barPartner) barPartner.classList.remove('active');
    
    await loadTodayData();
    await checkBackupReminder();
  } else if (currentHash === 'weekly') {
    if (todayPage) todayPage.classList.add('hidden');
    if (weeklyPage) weeklyPage.classList.remove('hidden');
    if (gardenPage) gardenPage.classList.add('hidden');
    
    const barToday = document.getElementById('bar-today');
    const barWeekly = document.getElementById('bar-weekly');
    const barGarden = document.getElementById('bar-garden');
    const barPartner = document.getElementById('bar-partner');
    if (barToday) barToday.classList.remove('active');
    if (barWeekly) barWeekly.classList.add('active');
    if (barGarden) barGarden.classList.remove('active');
    if (barPartner) barPartner.classList.remove('active');
    
    await initWeeklyReview();
  } else if (currentHash === 'garden') {
    if (todayPage) todayPage.classList.add('hidden');
    if (weeklyPage) weeklyPage.classList.add('hidden');
    if (gardenPage) gardenPage.classList.remove('hidden');
    
    const barToday = document.getElementById('bar-today');
    const barWeekly = document.getElementById('bar-weekly');
    const barGarden = document.getElementById('bar-garden');
    const barPartner = document.getElementById('bar-partner');
    if (barToday) barToday.classList.remove('active');
    if (barWeekly) barWeekly.classList.remove('active');
    if (barGarden) barGarden.classList.add('active');
    if (barPartner) barPartner.classList.remove('active');
    
    await initGarden();
  } else if (currentHash === 'partner') {
    if (todayPage) todayPage.classList.add('hidden');
    if (weeklyPage) weeklyPage.classList.add('hidden');
    if (gardenPage) gardenPage.classList.add('hidden');
    if (partnerPage) partnerPage.classList.remove('hidden');
    
    const barToday = document.getElementById('bar-today');
    const barWeekly = document.getElementById('bar-weekly');
    const barGarden = document.getElementById('bar-garden');
    const barPartner = document.getElementById('bar-partner');
    if (barToday) barToday.classList.remove('active');
    if (barWeekly) barWeekly.classList.remove('active');
    if (barGarden) barGarden.classList.remove('active');
    if (barPartner) barPartner.classList.add('active');
    
    await loadTodayData();
  }
}

// Onboarding 暱稱字數即時計算與驗證
function validateDisplayName(name) {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: '暱稱為必填欄位！' };
  }
  if (trimmed.length > 10) {
    return { valid: false, error: '暱稱長度最多 10 個字元！' };
  }
  return { valid: true, error: '' };
}

function setupOnboardingInput() {
  const nameInput = document.getElementById('onboarding-name-input');
  const errorMsg = document.getElementById('onboarding-error-msg');
  const counter = document.getElementById('onboarding-char-counter');
  
  if (!nameInput || !errorMsg || !counter) return;
  
  const handleInput = () => {
    const rawVal = nameInput.value;
    const trimmed = rawVal.trim();
    counter.textContent = `${trimmed.length} / 10`;
    
    const check = validateDisplayName(rawVal);
    if (!check.valid) {
      errorMsg.textContent = check.error;
    } else {
      errorMsg.textContent = '';
    }
  };
  
  nameInput.removeEventListener('input', handleInput);
  nameInput.addEventListener('input', handleInput);
  handleInput(); // 初始載入更新狀態
}

// 設定頁面暱稱即時計算與顯示更新
function updateSettingsProfileUI(user) {
  const nameInput = document.getElementById('settings-name-input');
  const errorMsg = document.getElementById('settings-name-error');
  const counter = document.getElementById('settings-name-counter');
  const providerSpan = document.getElementById('settings-provider-span');
  const emailSpan = document.getElementById('settings-email-span');
  const saveBtn = document.getElementById('btn-save-settings-name');
  
  if (nameInput) {
    nameInput.value = user.displayName || '';
    if (counter) counter.textContent = `${(user.displayName || '').length} / 10`;
  }
  if (providerSpan) providerSpan.textContent = user.provider === 'google' ? 'Google' : (user.provider === 'apple' ? 'Apple' : '本機帳號');
  if (emailSpan) emailSpan.textContent = user.email || '-';
  
  const handleInput = () => {
    if (!nameInput || !counter || !errorMsg) return;
    const rawVal = nameInput.value;
    const trimmed = rawVal.trim();
    counter.textContent = `${trimmed.length} / 10`;
    
    const check = validateDisplayName(rawVal);
    if (!check.valid) {
      errorMsg.textContent = check.error;
    } else {
      errorMsg.textContent = '';
    }
  };
  
  if (nameInput) {
    nameInput.removeEventListener('input', handleInput);
    nameInput.addEventListener('input', handleInput);
  }
  
  if (saveBtn) {
    const handleSave = async () => {
      const rawVal = nameInput.value;
      const check = validateDisplayName(rawVal);
      if (!check.valid) {
        alert('⚠️ ' + check.error);
        return;
      }
      
      user.displayName = rawVal.trim();
      user.updatedAt = new Date().toISOString();
      await DiaryDB.saveUser(user);
      await fetchCurrentUserObj();
      alert('🎉 暱稱已成功更新！');
    };
    saveBtn.removeEventListener('click', handleSave);
    saveBtn.addEventListener('click', handleSave);
  }
}

async function getPartnerName() {
  const partnerId = PartnerService.getPartnerId(State.currentUser);
  if (partnerId) {
    const partnerUser = await DiaryDB.getUser(partnerId);
    if (partnerUser && partnerUser.displayName) {
      return partnerUser.displayName;
    }
    return partnerId === 'user_a' ? 'User A' : (partnerId === 'user_b' ? 'User B' : partnerId);
  }
  return '筆友';
}

// 伴侶日記分享 Mock 服務
const PartnerService = {
  getPartnerId(userId) {
    const links = JSON.parse(localStorage.getItem('partner_links') || '{}');
    return links[userId] || null;
  },
  generateInviteCode(userId) {
    const codes = JSON.parse(localStorage.getItem('partner_invite_codes') || '{}');
    // 清除舊邀請碼
    for (const pin in codes) {
      if (codes[pin] === userId) delete codes[pin];
    }
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    codes[pin] = userId;
    localStorage.setItem('partner_invite_codes', JSON.stringify(codes));
    return pin;
  },
  acceptInviteCode(userId, pin) {
    const codes = JSON.parse(localStorage.getItem('partner_invite_codes') || '{}');
    const generatorId = codes[pin];
    if (generatorId && generatorId !== userId) {
      const links = JSON.parse(localStorage.getItem('partner_links') || '{}');
      links[userId] = generatorId;
      links[generatorId] = userId;
      localStorage.setItem('partner_links', JSON.stringify(links));
      
      delete codes[pin];
      localStorage.setItem('partner_invite_codes', JSON.stringify(codes));
      return true;
    }
    return false;
  },
  cancelSharing(userId) {
    const links = JSON.parse(localStorage.getItem('partner_links') || '{}');
    const partnerId = links[userId];
    if (partnerId) {
      delete links[userId];
      delete links[partnerId];
      localStorage.setItem('partner_links', JSON.stringify(links));
      return true;
    }
    return false;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // 0. 初始化 PWA 同步狀態指示器
  SyncManager.updateStatusUI();
  
  // 1. 初始化 50 格作文稿紙 (8x7 Grid with 2 spacers)
  initManuscriptGrid();

  // 2. 綁定事件監聽 (優先同步執行，確保按鈕必定有反應！)
  setupEventListeners();

  // 3. 初始化 Lucide Icons (防範 CDN 連線異常阻擋)
  try {
    lucide.createIcons();
  } catch (iconErr) {
    console.warn('Lucide icons loading warning:', iconErr);
  }

  // 3.5 啟用隨筆抽屜手勢/拖曳展開至全螢幕
  makeDrawerExpandable('memo-drawer');
  makeDrawerExpandable('review-memo-drawer');

  // 4. 監聽雜湊改變
  window.addEventListener('hashchange', handleRouting);

  (async () => {
    try {
      await seedMockDataIfNeeded();
      await handleRouting();
    } catch (err) {
      console.error('初始化載入失敗:', err);
    }
  })();
});

// 讓隨筆抽屜可以自行拉開到全螢幕的拖曳功能
function makeDrawerExpandable(drawerId) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  const handle = drawer.querySelector('.memo-drawer-handle');
  const content = drawer.querySelector('.memo-drawer-content');
  if (!handle || !content) return;
  
  let startY = 0;
  let startHeight = 0;
  let isDragging = false;
  
  const onStart = (e) => {
    startY = e.clientY || (e.touches && e.touches[0].clientY);
    startHeight = content.getBoundingClientRect().height;
    isDragging = true;
    
    content.style.transition = 'none'; // 拖曳時停用 CSS 過渡，確保流暢度
    
    const onMove = (moveEvt) => {
      if (!isDragging) return;
      const currentY = moveEvt.clientY || (moveEvt.touches && moveEvt.touches[0].clientY);
      const deltaY = startY - currentY; // 往上拉時 deltaY 為正
      const newHeight = startHeight + deltaY;
      
      const parentHeight = drawer.getBoundingClientRect().height;
      const newHeightPct = Math.min(Math.max((newHeight / parentHeight) * 100, 20), 100);
      content.style.height = `${newHeightPct}%`;
    };
    
    const onEnd = () => {
      isDragging = false;
      content.style.transition = ''; // 恢復平滑 transition
      
      const currentHeightPct = (content.getBoundingClientRect().height / drawer.getBoundingClientRect().height) * 100;
      if (currentHeightPct > 88) {
        content.style.height = '100%';
      } else if (currentHeightPct < 40) {
        // 如果往下拉超過閥值，直接關閉抽屜
        drawer.classList.add('hidden');
        content.style.height = '';
        if (drawerId === 'memo-drawer') {
          exitEditMode();
        }
      } else {
        content.style.height = ''; // 恢復 CSS 預設高度 (86% 或 70%)
      }
      
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };
  
  handle.addEventListener('pointerdown', onStart);
  handle.addEventListener('touchstart', onStart, { passive: false });
}

// ==================== 稿紙網格初始化與輸入連動 ====================
function initManuscriptGrid() {
  const grid = document.getElementById('manuscript-grid');
  if (!grid) return;

  grid.innerHTML = '';
  
  // 建立 50 個寫作格子 (10x5 layout)
  for (let i = 0; i < 50; i++) {
    const cell = document.createElement('div');
    cell.className = 'manuscript-cell';
    cell.setAttribute('data-index', i);
    grid.appendChild(cell);
  }
}

function updateManuscriptCells(text) {
  const cells = document.querySelectorAll('#manuscript-grid .manuscript-cell');
  const trimmed = text.slice(0, 50); // 限制最多 50 字

  cells.forEach((cell, idx) => {
    if (idx < trimmed.length) {
      cell.textContent = trimmed[idx];
      cell.classList.add('has-char');
    } else {
      cell.textContent = '';
      cell.classList.remove('has-char');
    }
  });
}

function highlightManuscriptCursor() {
  removeManuscriptCursor();
  const textarea = document.getElementById('diary-textarea');
  if (!textarea) return;
  
  const caretPos = textarea.selectionStart;
  const targetIdx = Math.min(caretPos, 49);
  const cell = document.querySelector(`#manuscript-grid .manuscript-cell[data-index="${targetIdx}"]`);
  if (cell) {
    cell.classList.add('active-cursor');
  }
}

function removeManuscriptCursor() {
  document.querySelectorAll('#manuscript-grid .manuscript-cell').forEach(c => {
    c.classList.remove('active-cursor');
  });
}

// 渲染交換日記的 10x5 實線格子 (唯讀)
function renderPartnerManuscriptGrid(content, mood = 'black') {
  const grid = document.getElementById('partner-manuscript-grid');
  const container = document.getElementById('partner-manuscript-container');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  // 設定心情樣式
  if (container) {
    container.className = `manuscript-container mood-${mood}`;
  }
  
  const trimmed = (content || '').slice(0, 50);
  
  // 建立 50 個唯讀格子
  for (let i = 0; i < 50; i++) {
    const cell = document.createElement('div');
    cell.className = 'manuscript-cell';
    
    if (trimmed && i < trimmed.length) {
      cell.textContent = trimmed[i];
      cell.classList.add('has-char');
    }
    
    grid.appendChild(cell);
  }
}

// ==================== IndexedDB 數據載入與渲染 ====================
async function loadTodayData() {
  try {
    // 0. 更新角色切換器的選項文字
    const switcher = document.getElementById('profile-switcher');
    if (switcher) {
      const optA = switcher.querySelector('option[value="user_a"]');
      const optB = switcher.querySelector('option[value="user_b"]');
      if (optA && optB) {
        if (State.currentUser === 'user_a') {
          optA.textContent = '我 (User A)';
          optB.textContent = '筆友 (User B)';
        } else {
          optA.textContent = '筆友 (User A)';
          optB.textContent = '我 (User B)';
        }
      }
    }

    // 0. 更新 Today 頁面標題日期與寫作區名稱
    const todayHeaderSubtitle = document.querySelector('#today-page .header-subtitle');
    if (todayHeaderSubtitle) {
      todayHeaderSubtitle.textContent = State.activeDate.replace(/-/g, '.');
    }
    const todaySectionTitle = document.querySelector('#today-page .section-title');
    if (todaySectionTitle) {
      todaySectionTitle.textContent = (State.activeDate === '2026-07-15') ? '書寫今日' : '編輯日記';
    }

    // A. 載入今日日記
    const diary = await DiaryDB.getDiary(State.activeDate, State.currentUser);
    const textarea = document.getElementById('diary-textarea');
    let loadedContent = '';
    
    if (textarea) {
      if (diary) {
        loadedContent = diary.content;
      } else {
        const draftContent = localStorage.getItem(`draft_diary_${State.currentUser}_${State.activeDate}`);
        if (draftContent !== null) {
          loadedContent = draftContent;
        }
      }
      textarea.value = loadedContent;
      State.diaryWordCount = loadedContent.length;
      document.getElementById('diary-word-count').textContent = `${State.diaryWordCount} / 50`;
      updateManuscriptCells(loadedContent);
    }

    // 載入並套用心情顏色
    let activeMood = 'black';
    if (diary) {
      activeMood = diary.mood;
    } else {
      const draftMood = localStorage.getItem(`draft_mood_${State.currentUser}_${State.activeDate}`);
      if (draftMood !== null) {
        activeMood = draftMood;
      }
    }
    State.selectedMood = activeMood;
    document.querySelectorAll('.mood-dots-row .mood-dot').forEach(d => {
      d.classList.toggle('active', d.getAttribute('data-mood') === activeMood);
    });
    const container = document.getElementById('manuscript-container-box');
    if (container) {
      container.className = `manuscript-container mood-${activeMood}`;
    }

    // B. 載入備忘錄時間軸
    await renderMemoTimeline();

    // C. 載入三年同日歷史回顧
    await renderPreviousYearsReview();

    // D. 載入伴侶今日日記狀態與介面
    const partnerId = PartnerService.getPartnerId(State.currentUser);
    const partnerStatusTag = document.getElementById('partner-status-tag');
    const panelUnlinked = document.getElementById('partner-unlinked-panel');
    const panelInviteGen = document.getElementById('partner-invite-gen-panel');
    const panelInviteInput = document.getElementById('partner-invite-input-panel');
    const panelPaired = document.getElementById('partner-paired-panel');
    
    if (partnerStatusTag && panelUnlinked && panelInviteGen && panelInviteInput && panelPaired) {
      if (!partnerId) {
        // 未聯結狀態
        partnerStatusTag.textContent = '尚未聯結';
        partnerStatusTag.style.backgroundColor = 'var(--color-primary-light)';
        partnerStatusTag.style.color = 'var(--color-text-sub)';
        
        panelUnlinked.classList.remove('hidden');
        panelInviteGen.classList.add('hidden');
        panelInviteInput.classList.add('hidden');
        panelPaired.classList.add('hidden');
        
        const partnerMemosContainer = document.getElementById('partner-paired-memos-container');
        if (partnerMemosContainer) partnerMemosContainer.style.display = 'none';
      } else {
        // 已聯結狀態
        partnerStatusTag.textContent = '已聯結';
        partnerStatusTag.style.backgroundColor = 'rgba(138, 154, 134, 0.1)';
        partnerStatusTag.style.color = 'var(--color-mood-green)';
        
        panelUnlinked.classList.add('hidden');
        panelInviteGen.classList.add('hidden');
        panelInviteInput.classList.add('hidden');
        panelPaired.classList.remove('hidden');
        
        // 載入伴侶日記
        const partnerDiary = await DiaryDB.getDiary(State.activeDate, partnerId);
        const partnerMeta = document.getElementById('partner-paired-meta');
        const partnerName = await getPartnerName();
        
        if (partnerMeta) {
          if (partnerDiary && partnerDiary.content && partnerDiary.content.trim()) {
            renderPartnerManuscriptGrid(partnerDiary.content, partnerDiary.mood);
            partnerMeta.textContent = `${partnerName}已寫下今日日記 (唯讀)`;
          } else {
            renderPartnerManuscriptGrid('', 'black');
            partnerMeta.textContent = `${partnerName}今天尚未寫下日記字句。`;
          }
        }

        // 載入伴侶今天隨筆 memos (直接顯示)
        const partnerMemosContainer = document.getElementById('partner-paired-memos-container');
        const partnerMemosList = document.getElementById('partner-paired-memos-list');
        if (partnerMemosContainer && partnerMemosList) {
          const dividerTitle = partnerMemosContainer.querySelector('.section-divider-title');
          if (dividerTitle) dividerTitle.textContent = `${partnerName}的隨筆`;
          
          const partnerMemos = await DiaryDB.getMemosForDate(State.activeDate, partnerId);
          if (partnerMemos && partnerMemos.length > 0) {
            partnerMemosContainer.style.display = 'block';
            partnerMemosList.innerHTML = '';
            
            const fragment = document.createDocumentFragment();
            partnerMemos.forEach(memo => {
              const item = document.createElement('div');
              item.className = 'timeline-item';
              
              const timeSpan = document.createElement('span');
              timeSpan.className = 'item-time';
              timeSpan.textContent = memo.time + ':';
              
              const body = document.createElement('div');
              body.className = 'item-body';
              
              const textNode = document.createElement('div');
              textNode.className = 'item-text';
              textNode.textContent = memo.content;
              body.appendChild(textNode);
              
              // 圖片網格
              if (memo.images && memo.images.length > 0) {
                const imgGrid = document.createElement('div');
                imgGrid.className = 'timeline-images-grid';
                
                memo.images.forEach(base64 => {
                  const wrapper = document.createElement('div');
                  wrapper.className = 'timeline-image-wrapper';
                  const img = document.createElement('img');
                  const safeSrc = isSafeImageUri(base64) ? base64 : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  img.src = safeSrc;
                  img.loading = 'lazy'; // Lazy-load images
                  img.alt = '筆友隨筆圖片';
                  img.addEventListener('click', () => {
                    const w = window.open();
                    if (w) {
                      const body = w.document.body;
                      body.style.margin = '0';
                      body.style.backgroundColor = '#000';
                      body.style.display = 'flex';
                      body.style.alignItems = 'center';
                      body.style.justifyContent = 'center';
                      body.style.height = '100vh';
                      
                      const largeImg = w.document.createElement('img');
                      largeImg.src = safeSrc;
                      largeImg.style.maxWidth = '100%';
                      largeImg.style.maxHeight = '100vh';
                      largeImg.style.display = 'block';
                      largeImg.style.margin = 'auto';
                      body.appendChild(largeImg);
                    }
                  });
                  wrapper.appendChild(img);
                  imgGrid.appendChild(wrapper);
                });
                body.appendChild(imgGrid);
              }
              
              item.appendChild(timeSpan);
              item.appendChild(body);
              fragment.appendChild(item);
            });
            partnerMemosList.appendChild(fragment);
          } else {
            partnerMemosContainer.style.display = 'none';
          }
        }
      }
    }

    // 重新繪製 Lucide 圖標
    try {
      lucide.createIcons();
    } catch (e) {}

  } catch (err) {
    console.error('資料庫載入失敗:', err);
  }
}

async function renderMemoTimeline() {
  const timelineList = document.getElementById('memo-timeline-list');
  if (!timelineList) return;

  timelineList.innerHTML = '';
  const memos = await DiaryDB.getMemosForDate(State.activeDate, State.currentUser);

  if (memos.length === 0) {
    timelineList.innerHTML = '<p class="empty-state">今天還沒有寫下隨筆記錄。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  memos.forEach(memo => {
    const item = document.createElement('div');
    item.className = 'timeline-item';

    // 時間
    const timeSpan = document.createElement('span');
    timeSpan.className = 'item-time';
    timeSpan.textContent = memo.time + ':';

    // 內文與操作按鈕容器
    const body = document.createElement('div');
    body.className = 'item-body';

    // 文字段落
    const textPara = document.createElement('p');
    textPara.className = 'item-text';
    textPara.textContent = memo.content;
    body.appendChild(textPara);

    // 圖片網格
    if (memo.images && memo.images.length > 0) {
      const imgGrid = document.createElement('div');
      imgGrid.className = 'timeline-images-grid';
      
      memo.images.forEach(imgData => {
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'timeline-image-wrapper';
        const img = document.createElement('img');
        const safeSrc = isSafeImageUri(imgData) ? imgData : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        img.src = safeSrc;
        img.loading = 'lazy'; // Lazy-load images
        img.alt = '時光隨筆圖片';
        img.addEventListener('click', () => {
          // 極簡點擊看大圖
          const win = window.open();
          if (win) {
            const body = win.document.body;
            body.style.margin = '0';
            body.style.backgroundColor = '#000';
            body.style.display = 'flex';
            body.style.alignItems = 'center';
            body.style.justifyContent = 'center';
            body.style.height = '100vh';
            
            const largeImg = win.document.createElement('img');
            largeImg.src = safeSrc;
            largeImg.style.maxWidth = '100%';
            largeImg.style.maxHeight = '100vh';
            largeImg.style.display = 'block';
            largeImg.style.margin = 'auto';
            body.appendChild(largeImg);
          }
        });
        imgWrapper.appendChild(img);
        imgGrid.appendChild(imgWrapper);
      });
      
      body.appendChild(imgGrid);
    }

    // 頂部列（含操作按鈕，移至文字/圖片下方）
    const header = document.createElement('div');
    header.className = 'timeline-item-header';
    
    const actions = document.createElement('div');
    actions.className = 'timeline-actions';

    const editBtn = document.createElement('a');
    editBtn.className = 'action-link';
    editBtn.textContent = '編輯';
    editBtn.addEventListener('click', () => loadMemoToForm(memo));

    const deleteBtn = document.createElement('a');
    deleteBtn.className = 'action-link delete-link';
    deleteBtn.textContent = '刪除';
    deleteBtn.addEventListener('click', () => handleDeleteMemo(memo.id));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(actions);
    body.appendChild(header);

    item.appendChild(timeSpan);
    item.appendChild(body);
    fragment.appendChild(item);
  });
  timelineList.appendChild(fragment);
}

// ==================== 事件監聽設定 ====================
function setupEventListeners() {
  const textarea = document.getElementById('diary-textarea');
  const grid = document.getElementById('manuscript-grid');

  // 點擊網格聚焦輸入框
  if (grid && textarea) {
    grid.addEventListener('click', () => {
      textarea.focus();
    });
  }

  // 文字輸入同步與字數統計
  if (textarea) {
    textarea.addEventListener('input', (e) => {
      const text = e.target.value;
      State.diaryWordCount = text.length;
      document.getElementById('diary-word-count').textContent = `${State.diaryWordCount} / 50`;
      updateManuscriptCells(text);
      highlightManuscriptCursor();
      localStorage.setItem(`draft_diary_${State.currentUser}_${State.activeDate}`, text);
    });

    textarea.addEventListener('focus', () => {
      highlightManuscriptCursor();
    });

    textarea.addEventListener('keyup', () => {
      highlightManuscriptCursor();
    });

    textarea.addEventListener('blur', () => {
      removeManuscriptCursor();
    });

    // Listen to selectionchange to handle cursor navigation, deletions, and insertions
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === textarea) {
        highlightManuscriptCursor();
      }
    });
  }

  // 心情選擇 Dot 點擊切換
  document.querySelectorAll('.mood-dots-row .mood-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      document.querySelectorAll('.mood-dots-row .mood-dot').forEach(d => d.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      State.selectedMood = target.getAttribute('data-mood');
      showAirpodsToast(State.selectedMood, target.getAttribute('title') || '普通');

      // 更新稿紙卡片背景氣氛
      const container = document.getElementById('manuscript-container-box');
      if (container) {
        container.className = `manuscript-container mood-${State.selectedMood}`;
      }
      localStorage.setItem(`draft_mood_${State.currentUser}_${State.activeDate}`, State.selectedMood);
    });
  });

  // SAVE 按鈕點擊寫入 IndexedDB
  const saveBtn = document.getElementById('btn-save-diary');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const text = textarea ? textarea.value.trim() : '';
      if (!text) {
        alert('請先在格子中寫下今天的日記內容。');
        return;
      }
      
      try {
        await DiaryDB.saveDiary({
          date: State.activeDate,
          content: textarea.value,
          mood: State.selectedMood,
          timestamp: new Date().toISOString()
        }, State.currentUser);
        // 儲存今天日記後，立即更新熱力圖中的點點顏色與觸發圓滿動畫
        const dot = document.querySelector(`.garden-dot[data-date="${State.activeDate}"]`);
        if (dot) {
          const hadNoMood = !dot.classList.contains('mood-black') && 
                            !dot.classList.contains('mood-yellow') && 
                            !dot.classList.contains('mood-green') && 
                            !dot.classList.contains('mood-blue') && 
                            !dot.classList.contains('mood-red');
          if (hadNoMood) {
            dot.classList.add('animate-completion');
            setTimeout(() => {
              dot.classList.remove('animate-completion');
            }, 250);
          }
        }
        await updateGardenDotsColor();
        await checkThreeYearCompletion();
        await checkBackupReminder();
        
        // 清理草稿與寫入同步佇列
        localStorage.removeItem(`draft_diary_${State.currentUser}_${State.activeDate}`);
        localStorage.removeItem(`draft_mood_${State.currentUser}_${State.activeDate}`);
        SyncManager.addToQueue('save_diary', { date: State.activeDate, content: textarea.value, mood: State.selectedMood });
      } catch (err) {
        console.error('日記保存失敗:', err);
        alert('日記保存失敗：' + (err ? (err.name + ': ' + err.message) : '未知錯誤'));
      }
    });
  }

  // 圖片上傳與 Base64 壓縮預覽
  const imageInput = document.getElementById('image-upload-input');
  if (imageInput) {
    imageInput.addEventListener('change', handleImageUpload);
  }

  // 備忘錄送出 (ADD / UPDATE) 按鈕
  const submitMemoBtn = document.getElementById('btn-submit-memo');
  if (submitMemoBtn) {
    submitMemoBtn.addEventListener('click', handleMemoSubmit);
  }

  // 編輯模式取消按鈕
  const cancelMemoBtn = document.getElementById('btn-cancel-memo');
  if (cancelMemoBtn) {
    cancelMemoBtn.addEventListener('click', exitEditMode);
  }

  // 備忘錄輸入草稿同步
  const memoTextarea = document.getElementById('memo-textarea');
  if (memoTextarea) {
    memoTextarea.addEventListener('input', (e) => {
      if (State.editingMemoId === null) {
        localStorage.setItem(`draft_memo_text_${State.currentUser}_${State.activeDate}`, e.target.value);
      }
    });
  }

  // === 備忘錄抽屜顯示/隱藏控制 ===
  const btnOpenMemo = document.getElementById('btn-open-memo');
  const btnCloseMemo = document.getElementById('btn-close-memo');
  const drawerOverlay = document.getElementById('memo-drawer-overlay');
  const drawer = document.getElementById('memo-drawer');

  if (btnOpenMemo && drawer) {
    btnOpenMemo.addEventListener('click', () => {
      drawer.classList.remove('hidden');
      
      // 若非編輯模式，自動還原尚未送出的隨筆草稿
      if (State.editingMemoId === null) {
        const draftText = localStorage.getItem(`draft_memo_text_${State.currentUser}_${State.activeDate}`);
        const draftImagesRaw = localStorage.getItem(`draft_memo_images_${State.currentUser}_${State.activeDate}`);
        
        if (draftText !== null && memoTextarea) {
          memoTextarea.value = draftText;
        }
        if (draftImagesRaw !== null) {
          try {
            State.uploadedImages = JSON.parse(draftImagesRaw);
            renderUploadedImages();
          } catch (_) {}
        }
      }
    });
  }

  if (btnCloseMemo && drawer) {
    btnCloseMemo.addEventListener('click', () => {
      drawer.classList.add('hidden');
      exitEditMode();
    });
  }

  if (drawer) {
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer || e.target === drawerOverlay) {
        drawer.classList.add('hidden');
        drawer.querySelector('.memo-drawer-content').style.height = '';
        exitEditMode();
      }
    });
  }

  // === 歷史回顧備忘錄抽屜顯示/隱藏控制 ===
  const btnCloseReviewMemo = document.getElementById('btn-close-review-memo');
  const reviewMemoDrawerOverlay = document.getElementById('review-memo-drawer-overlay');
  const reviewMemoDrawer = document.getElementById('review-memo-drawer');

  if (btnCloseReviewMemo && reviewMemoDrawer) {
    btnCloseReviewMemo.addEventListener('click', () => {
      reviewMemoDrawer.classList.add('hidden');
      reviewMemoDrawer.querySelector('.memo-drawer-content').style.height = '';
    });
  }

  if (reviewMemoDrawer) {
    reviewMemoDrawer.addEventListener('click', (e) => {
      if (e.target === reviewMemoDrawer || e.target === reviewMemoDrawerOverlay) {
        reviewMemoDrawer.classList.add('hidden');
        reviewMemoDrawer.querySelector('.memo-drawer-content').style.height = '';
      }
    });
  }

  // === 伴侶日記與角色切換事件監聽 ===
  const profileSwitcher = document.getElementById('profile-switcher');
  if (profileSwitcher) {
    profileSwitcher.addEventListener('change', async (e) => {
      State.currentUser = e.target.value;
      await fetchCurrentUserObj();
      
      // 重新載入新角色的今日頁面與 Yearly 熱力圖
      await loadTodayData();
      await initGarden();
      
      // 切換至 Today 主頁面
      await switchToPage('today');
      await checkBackupReminder();
    });
  }

  // === 設定彈窗與帳號永久刪除/匯出事件監聽 ===
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');
  const settingsModal = document.getElementById('settings-modal');
  const btnTriggerDeleteFlow = document.getElementById('btn-trigger-delete-flow');
  
  const deleteConfirmModal = document.getElementById('delete-confirm-modal');
  const btnCloseDeleteConfirmModal = document.getElementById('btn-close-delete-confirm-modal');
  const btnCancelDelete = document.getElementById('btn-cancel-delete');
  const deleteConfirmPassword = document.getElementById('delete-confirm-password');
  const btnConfirmExportDelete = document.getElementById('btn-confirm-export-delete');

  if (btnOpenSettings && settingsModal) {
    btnOpenSettings.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
      renderArchivedDiariesList(); // 渲染已封存的日記
    });
  }

  if (btnCloseSettingsModal && settingsModal) {
    btnCloseSettingsModal.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }

  if (btnTriggerDeleteFlow && deleteConfirmModal && settingsModal) {
    btnTriggerDeleteFlow.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
      deleteConfirmModal.classList.remove('hidden');
      if (deleteConfirmPassword) deleteConfirmPassword.value = '';
    });
  }

  if (btnCloseDeleteConfirmModal && deleteConfirmModal) {
    btnCloseDeleteConfirmModal.addEventListener('click', () => {
      deleteConfirmModal.classList.add('hidden');
    });
  }

  if (btnCancelDelete && deleteConfirmModal) {
    btnCancelDelete.addEventListener('click', () => {
      deleteConfirmModal.classList.add('hidden');
    });
  }

  if (btnConfirmExportDelete && deleteConfirmModal && deleteConfirmPassword) {
    btnConfirmExportDelete.addEventListener('click', async () => {
      const password = deleteConfirmPassword.value.trim();
      if (password !== '123456') {
        alert('密碼輸入錯誤，請輸入 123456 作為模擬驗證密碼。');
        return;
      }

      // 1. 生成備份網頁
      const exportHtml = await generateExportHTML(State.currentUser);

      // 2. 開啟列印視窗
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('請允許此網頁開啟彈出視窗以完成備份匯出。');
        return;
      }
      printWindow.document.write(exportHtml);
      printWindow.document.close();
      printWindow.focus();

      // 預留些許時間給瀏覽器渲染
      setTimeout(() => {
        printWindow.print();
      }, 600);

      // 3. 執行資料永久刪除事務 (Security deletion transaction)
      await DiaryDB.deleteUser(State.currentUser);
      await DiaryDB.clearUserData(State.currentUser);
      
      // 4. 解除伴侶關係
      PartnerService.cancelSharing(State.currentUser);

      // 清除登入狀態
      clearSession();

      // 關閉確認視窗
      deleteConfirmModal.classList.add('hidden');

      alert('備份已成功生成！您的帳號資料與筆友連結已永久安全刪除。');
      
      // 5. 重新載入網頁回到初始狀態
      window.location.hash = 'login';
      window.location.reload();
    });
  }

  // === 三年圓滿總結提示視窗事件監聽 ===
  const completionModal = document.getElementById('completion-modal');
  const btnCompletionOpt1 = document.getElementById('btn-completion-opt1');
  const btnCompletionOpt2 = document.getElementById('btn-completion-opt2');
  const btnCloseCompletion = document.getElementById('btn-close-completion');
  const btnDevTriggerCompletion = document.getElementById('btn-dev-trigger-completion');

  if (btnCompletionOpt1 && deleteConfirmModal && completionModal) {
    btnCompletionOpt1.addEventListener('click', () => {
      completionModal.classList.add('hidden');
      deleteConfirmModal.classList.remove('hidden');
      if (deleteConfirmPassword) deleteConfirmPassword.value = '';
    });
  }

  if (btnCompletionOpt2) {
    btnCompletionOpt2.addEventListener('click', async () => {
      if (confirm('確定要封存目前日記並開啟全新的三年日記週期嗎？此操作將會清空當前工作區。')) {
        await archiveCurrentCycle();
      }
    });
  }

  if (btnCloseCompletion && completionModal) {
    btnCloseCompletion.addEventListener('click', () => {
      completionModal.classList.add('hidden');
      localStorage.setItem(`completion_modal_dismissed_${State.currentUser}`, 'true');
    });
  }

  if (btnDevTriggerCompletion && completionModal && settingsModal) {
    btnDevTriggerCompletion.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
      completionModal.classList.remove('hidden');
    });
  }

  const btnDevGenerateMockData = document.getElementById('btn-dev-generate-mock-data');
  if (btnDevGenerateMockData && settingsModal) {
    btnDevGenerateMockData.addEventListener('click', async () => {
      settingsModal.classList.add('hidden');
      localStorage.removeItem('diary_mock_populated');
      await seedMockDataIfNeeded();
      alert('隨機歷史日記與隨筆數據已成功生成！將重新載入頁面。');
      window.location.reload();
    });
  }
  const devActiveYearSelect = document.getElementById('dev-active-year-select');
  if (devActiveYearSelect && settingsModal) {
    devActiveYearSelect.addEventListener('change', async (e) => {
      settingsModal.classList.add('hidden');
      State.activeDate = e.target.value;
      await loadTodayData();
      await initGarden();
      alert(`🎉 成功！已模擬當前日期為：${State.activeDate} (${new Date(State.activeDate).getFullYear()}年)`);
    });
  }
  // 產生邀請碼
  const btnPartnerGenCode = document.getElementById('btn-partner-gen-code');
  const btnPartnerGenBack = document.getElementById('btn-partner-gen-back');
  const panelUnlinked = document.getElementById('partner-unlinked-panel');
  const panelInviteGen = document.getElementById('partner-invite-gen-panel');
  const pinBox = document.getElementById('partner-pin-box');

  if (btnPartnerGenCode && panelInviteGen && panelUnlinked && pinBox) {
    btnPartnerGenCode.addEventListener('click', () => {
      const pin = PartnerService.generateInviteCode(State.currentUser);
      pinBox.textContent = `${pin.substring(0, 3)} ${pin.substring(3)}`;
      panelUnlinked.classList.add('hidden');
      panelInviteGen.classList.remove('hidden');
    });
  }

  if (btnPartnerGenBack && panelInviteGen && panelUnlinked) {
    btnPartnerGenBack.addEventListener('click', () => {
      panelInviteGen.classList.add('hidden');
      panelUnlinked.classList.remove('hidden');
    });
  }

  // 輸入邀請碼
  const btnPartnerEnterCode = document.getElementById('btn-partner-enter-code');
  const btnPartnerInputBack = document.getElementById('btn-partner-input-back');
  const panelInviteInput = document.getElementById('partner-invite-input-panel');
  const pinInput = document.getElementById('partner-pin-input');

  if (btnPartnerEnterCode && panelInviteInput && panelUnlinked) {
    btnPartnerEnterCode.addEventListener('click', () => {
      panelUnlinked.classList.add('hidden');
      panelInviteInput.classList.remove('hidden');
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    });
  }

  if (btnPartnerInputBack && panelInviteInput && panelUnlinked) {
    btnPartnerInputBack.addEventListener('click', () => {
      panelInviteInput.classList.add('hidden');
      panelUnlinked.classList.remove('hidden');
    });
  }

  // 驗證邀請碼
  const btnPartnerVerifyCode = document.getElementById('btn-partner-verify-code');
  if (btnPartnerVerifyCode && pinInput) {
    btnPartnerVerifyCode.addEventListener('click', async () => {
      const pin = pinInput.value.trim().replace(/\s/g, '');
      if (pin.length !== 6 || isNaN(pin)) {
        alert('請輸入 6 位數字邀請碼。');
        return;
      }
      
      const success = PartnerService.acceptInviteCode(State.currentUser, pin);
      if (success) {
        const partnerName = await getPartnerName();
        alert(`聯結成功！現在可以開始查看${partnerName}的今日日記。`);
        pinInput.value = '';
        panelInviteInput.classList.add('hidden');
        await loadTodayData();
      } else {
        alert('驗證失敗，請輸入正確的邀請碼，且不可驗證自己所產生的代碼。');
      }
    });
  }

  // 解除聯結
  const btnPartnerUnlink = document.getElementById('btn-partner-unlink');
  if (btnPartnerUnlink) {
    btnPartnerUnlink.addEventListener('click', async () => {
      const partnerName = await getPartnerName();
      if (!confirm(`確定要解除與${partnerName}的聯結嗎？\n解除後將立即雙向撤銷今日日記的互看權限。`)) return;
      
      PartnerService.cancelSharing(State.currentUser);
      alert('聯結已成功解除，權限已雙向收回。');
      await loadTodayData();
    });
  }

  // === 統一分頁切換控制器 (switchToPage) ===
  window.switchToPage = async function(pageName, customDate = null) {
    // 離開頁面時自動收回/關閉所有全螢幕或半螢幕抽屜與彈窗
    const memoDrawer = document.getElementById('memo-drawer');
    if (memoDrawer) {
      memoDrawer.classList.add('hidden');
      const content = memoDrawer.querySelector('.memo-drawer-content');
      if (content) content.style.height = '';
      exitEditMode();
    }
    const reviewMemoDrawer = document.getElementById('review-memo-drawer');
    if (reviewMemoDrawer) {
      reviewMemoDrawer.classList.add('hidden');
      const content = reviewMemoDrawer.querySelector('.memo-drawer-content');
      if (content) content.style.height = '';
    }
    const gardenDetailModal = document.getElementById('garden-detail-modal');
    if (gardenDetailModal) {
      gardenDetailModal.classList.add('hidden');
    }

    const barToday = document.getElementById('bar-today');
    const barWeekly = document.getElementById('bar-weekly');
    const barGarden = document.getElementById('bar-garden');
    const barPartner = document.getElementById('bar-partner');
    
    const todayPage = document.getElementById('today-page');
    const weeklyPage = document.getElementById('weekly-page');
    const gardenPage = document.getElementById('garden-page');
    const partnerPage = document.getElementById('partner-page');

    if (!barToday || !barWeekly || !barGarden || !barPartner || !todayPage || !weeklyPage || !gardenPage || !partnerPage) return;

    // 重設高亮狀態
    barToday.classList.remove('active');
    barWeekly.classList.remove('active');
    barGarden.classList.remove('active');
    barPartner.classList.remove('active');

    // 隱藏所有分頁
    todayPage.classList.add('hidden');
    weeklyPage.classList.add('hidden');
    gardenPage.classList.add('hidden');
    partnerPage.classList.add('hidden');

    if (pageName === 'today') {
      barToday.classList.add('active');
      todayPage.classList.remove('hidden');
      if (customDate) {
        State.activeDate = customDate;
      } else {
        State.activeDate = '2026-07-15';
      }
      await loadTodayData();
    } else if (pageName === 'weekly') {
      barWeekly.classList.add('active');
      weeklyPage.classList.remove('hidden');
      await initWeeklyReview();
    } else if (pageName === 'garden') {
      barGarden.classList.add('active');
      gardenPage.classList.remove('hidden');
      await initGarden();
    } else if (pageName === 'partner') {
      barPartner.classList.add('active');
      partnerPage.classList.remove('hidden');
      await loadTodayData();
    }
  };

  // === 時光花園、週記回顧、今日書寫、交換日記分頁切換控制 (IG 限動橫線指標) ===
  const barToday = document.getElementById('bar-today');
  const barWeekly = document.getElementById('bar-weekly');
  const barGarden = document.getElementById('bar-garden');
  const barPartner = document.getElementById('bar-partner');

  if (barToday && barWeekly && barGarden && barPartner) {
    barToday.addEventListener('click', () => switchToPage('today'));
    barWeekly.addEventListener('click', () => switchToPage('weekly'));
    barGarden.addEventListener('click', () => switchToPage('garden'));
    barPartner.addEventListener('click', () => switchToPage('partner'));
  }

  // === 左右側點擊切換分頁 (Instagram Story 模式) ===
  const deviceFrame = document.querySelector('.device-frame');
  if (deviceFrame) {
    deviceFrame.addEventListener('click', async (e) => {
      // 1. 檢查是否有打開彈窗或抽屜，若有則不跳頁
      const gardenModal = document.getElementById('garden-detail-modal');
      const memoDrawer = document.getElementById('memo-drawer');
      const isModalOpen = gardenModal && !gardenModal.classList.contains('hidden');
      const isDrawerOpen = memoDrawer && !memoDrawer.classList.contains('hidden');
      if (isModalOpen || isDrawerOpen) return;

      // 2. 檢查點擊的目標是否為可互動元素，若是則忽略跳頁
      const isInteractive = e.target.closest('button, textarea, input, a, .manuscript-cell, .garden-dot, .diary-review-card, .btn-circle-plus, .timeline-item, .timeline-image-wrapper, .mood-dot, .btn-close-modal, .story-bar, svg, path, i');
      if (isInteractive) return;

      // 3. 計算點擊相對於手機外框的水平比例
      const rect = deviceFrame.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const frameWidth = rect.width;
      const ratio = clickX / frameWidth;

      // 獲取當前分頁名稱
      let currentPage = 'today';
      if (barGarden && barGarden.classList.contains('active')) currentPage = 'garden';
      if (barWeekly && barWeekly.classList.contains('active')) currentPage = 'weekly';
      if (barToday && barToday.classList.contains('active')) currentPage = 'today';
      if (barPartner && barPartner.classList.contains('active')) currentPage = 'partner';

      // 4. 左側點擊 (前進到左邊: Partner -> Today -> Weekly -> Garden)
      if (ratio < 0.22) {
        if (currentPage === 'partner') {
          await switchToPage('today');
        } else if (currentPage === 'today') {
          await switchToPage('weekly');
        } else if (currentPage === 'weekly') {
          await switchToPage('garden');
        }
      }
      // 5. 右側點擊 (前進到右邊: Garden -> Weekly -> Today -> Partner)
      else if (ratio > 0.78) {
        if (currentPage === 'garden') {
          await switchToPage('weekly');
        } else if (currentPage === 'weekly') {
          await switchToPage('today');
        } else if (currentPage === 'today') {
          await switchToPage('partner');
        }
      }
    });
  }

  // === 時光花園詳細對照彈窗關閉 ===
  const btnCloseGardenModal = document.getElementById('btn-close-garden-modal');
  const gardenDetailModal = document.getElementById('garden-detail-modal');
  if (btnCloseGardenModal && gardenDetailModal) {
    btnCloseGardenModal.addEventListener('click', () => {
      gardenDetailModal.classList.add('hidden');
    });
    
    // 點擊遮罩背景也能關閉
    gardenDetailModal.addEventListener('click', (e) => {
      if (e.target === gardenDetailModal) {
        gardenDetailModal.classList.add('hidden');
      }
    });
  }

  // === 加密備份與還原系統事件監聽 ===
  const btnBackupNow = document.getElementById('btn-backup-now');
  const btnRestoreNow = document.getElementById('btn-restore-now');
  const btnBannerBackup = document.getElementById('btn-banner-backup');
  const btnBannerClose = document.getElementById('btn-banner-close');
  const backupFileInput = document.getElementById('backup-file-input');
  const btnClosePasscodeModal = document.getElementById('btn-close-passcode-modal');
  const btnCancelPasscode = document.getElementById('btn-cancel-passcode');
  const btnConfirmPasscode = document.getElementById('btn-confirm-passcode');
  
  if (btnBackupNow) btnBackupNow.addEventListener('click', triggerBackupFlow);
  if (btnBannerBackup) btnBannerBackup.addEventListener('click', triggerBackupFlow);
  
  if (btnBannerClose) {
    btnBannerClose.addEventListener('click', () => {
      const banner = document.getElementById('backup-reminder-banner');
      if (banner) {
        banner.classList.add('hidden');
      }
      const until = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem(`backup_reminder_dismissed_until_${State.currentUser}`, String(until));
    });
  }
  
  if (btnRestoreNow && backupFileInput) {
    btnRestoreNow.addEventListener('click', () => {
      backupFileInput.click();
    });
  }
  
  if (backupFileInput) {
    backupFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        triggerRestoreFlow(file);
      }
      backupFileInput.value = ''; // 重置，允許重複選擇同一個檔案
    });
  }
  
  const closePasscode = () => {
    const modal = document.getElementById('passcode-modal');
    if (modal) modal.classList.add('hidden');
    activeCryptoAction = null;
    activeRestorePayload = null;
  };
  
  if (btnClosePasscodeModal) btnClosePasscodeModal.addEventListener('click', closePasscode);
  if (btnCancelPasscode) btnCancelPasscode.addEventListener('click', closePasscode);
  
  if (btnConfirmPasscode) {
    btnConfirmPasscode.addEventListener('click', async () => {
      const passcodeVal = document.getElementById('passcode-input').value;
      if (!passcodeVal || passcodeVal.length < 6) {
        alert('請設定 6 位以上的密碼！');
        return;
      }
      
      const modal = document.getElementById('passcode-modal');
      modal.classList.add('hidden');
      
      if (activeCryptoAction === 'backup') {
        try {
          const diaries = await DiaryDB.getAllDiaries(State.currentUser);
          const memos = await DiaryDB.getAllMemos(State.currentUser);
          const dataToEncrypt = JSON.stringify({ diaries, memos });
          
          const encrypted = await encryptData(dataToEncrypt, passcodeVal);
          
          const backupObj = {
            version: 1,
            userId: State.currentUser,
            timestamp: Date.now(),
            salt: encrypted.salt,
            iv: encrypted.iv,
            ciphertext: encrypted.ciphertext
          };
          
          const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const dateStr = new Date().toISOString().split('T')[0];
          a.href = url;
          a.download = `diary_backup_${State.currentUser}_${dateStr}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          localStorage.setItem(`last_backup_timestamp_${State.currentUser}`, Date.now());
          await checkBackupReminder();
          alert('🎉 加密備份下載完成！請妥善保存您的備份檔案。');
        } catch (err) {
          console.error('備份失敗:', err);
          alert('備份失敗: ' + err.message);
        }
      } else if (activeCryptoAction === 'restore' && activeRestorePayload) {
        try {
          const decryptedText = await decryptData(
            activeRestorePayload.ciphertext,
            passcodeVal,
            activeRestorePayload.salt,
            activeRestorePayload.iv
          );
          
          const restoreData = JSON.parse(decryptedText);
          if (!restoreData.diaries || !restoreData.memos) {
            throw new Error('備份檔案內容結構不符！');
          }
          
          // 還原日記
          for (const d of restoreData.diaries) {
            await DiaryDB.saveDiary(d, State.currentUser);
          }
          // 還原隨筆
          for (const m of restoreData.memos) {
            await DiaryDB.saveMemo(m, State.currentUser);
          }
          
          alert('🎉 備份還原成功！網頁即將重新整理以加載資料。');
          window.location.reload();
        } catch (err) {
          console.error('還原解密失敗:', err);
          alert('⚠️ 密碼錯誤或解密失敗！還原終止。');
        }
      }
    });
  }

  // === 登入與 Onboarding 事件監聽 ===
  const btnLoginGoogle = document.getElementById('btn-login-google');
  const btnOnboardingSubmit = document.getElementById('btn-onboarding-submit');
  const btnLogout = document.getElementById('btn-logout');

  if (btnLoginGoogle) {
    btnLoginGoogle.addEventListener('click', async () => {
      const loginOptionsModal = document.getElementById('login-options-modal');
      if (loginOptionsModal) loginOptionsModal.classList.add('hidden');
      
      if (window.auth && typeof firebase !== 'undefined') {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
          try {
            await window.auth.signInWithPopup(provider);
          } catch (popupErr) {
            if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/cancelled-popup-request') {
              console.warn("[Firebase Auth] Popup blocked, trying redirect flow...");
              await window.auth.signInWithRedirect(provider);
              return;
            }
            throw popupErr;
          }
        } catch (e) {
          console.warn("[Firebase Auth] Google Auth failed, checking environment:", e);
          
          const isSandboxEnv = (window.location.hostname === '127.0.0.1' && window.location.port !== '8080') || 
                               new URLSearchParams(window.location.search).has('run-tests');
                               
          if (isSandboxEnv && (e.code === 'auth/unauthorized-domain' || e.code === 'auth/operation-not-allowed' || e.message.includes('domain') || e.message.includes('auth'))) {
            console.log("[Firebase Auth] Sandbox context detected. Initiating Development Sandbox Account...");
            if (window.loginSandboxUser) {
              await window.loginSandboxUser();
            }
          } else {
            console.error("Google Auth login failure:", e);
            alert("登入失敗，請稍候重試：" + (e.message || e.code || e));
          }
        }
      } else {
        // Fallback to original mock login behavior if offline/unloaded
        setSession('user_a', 'user.google@gmail.com', 'google');
        await handleRouting();
      }
    });
  }

  if (btnOnboardingSubmit) {
    btnOnboardingSubmit.addEventListener('click', async () => {
      const nameInput = document.getElementById('onboarding-name-input');
      if (!nameInput) return;
      const rawVal = nameInput.value;
      const check = validateDisplayName(rawVal);
      if (!check.valid) {
        alert('⚠️ ' + check.error);
        return;
      }
      
      const displayName = rawVal.trim();
      let session = getSession();
      let userId;
      
      if (session) {
        userId = session.userId;
      } else {
        // Fallback to nickname login if session does not exist
        userId = 'user_' + encodeURIComponent(displayName).replace(/%/g, '').toLowerCase().substring(0, 16);
        setSession(userId, `${userId}@local.diary`, 'local');
        session = getSession();
      }
      
      const startYear = new Date(State.activeDate).getFullYear();
      
      // 建立 User Profile
      const newUser = {
        id: userId,
        displayName: displayName,
        email: session.user.email,
        provider: session.user.provider,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: State.activeDate
      };
      
      await DiaryDB.saveUser(newUser);
      localStorage.setItem(`cycle_start_year_${newUser.id}`, String(startYear));
      localStorage.setItem(`cycle_start_date_${newUser.id}`, State.activeDate);
      await fetchCurrentUserObj();
      
      window.location.hash = 'today';
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('確定要登出您的時光日記帳號嗎？')) {
        clearSession();
        State.splashDismissed = false; // Reset splash screen so it triggers on next launch
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) settingsModal.classList.add('hidden');
        window.location.hash = 'splash';
      }
    });
  }

  // === 初始畫面 (Splash Page) 輕點事件監聽 ===
  const splashPage = document.getElementById('splash-page');
  if (splashPage) {
    splashPage.addEventListener('click', async () => {
      State.splashDismissed = true;
      splashPage.classList.add('hidden');
      await handleRouting();
    });
  }

  // === 登入選單彈出視窗事件監聽 ===
  const btnLoginTrigger = document.getElementById('btn-login-trigger');
  const loginOptionsModal = document.getElementById('login-options-modal');
  const btnCloseLoginModal = document.getElementById('btn-close-login-modal');

  if (btnLoginTrigger && loginOptionsModal) {
    btnLoginTrigger.addEventListener('click', () => {
      loginOptionsModal.classList.remove('hidden');
    });
  }

  if (btnCloseLoginModal && loginOptionsModal) {
    btnCloseLoginModal.addEventListener('click', () => {
      loginOptionsModal.classList.add('hidden');
    });
  }

  // === Security 資訊打字機動畫監聽 ===
  let typingTimer = null;
  const btnSecurityTrigger = document.getElementById('btn-security-trigger');
  const securityInfo = document.getElementById('login-security-info');
  const securityText = document.getElementById('login-security-text');

  if (btnSecurityTrigger && securityInfo && securityText) {
    btnSecurityTrigger.addEventListener('click', () => {
      securityInfo.classList.remove('hidden');
      const fullText = "您的日記與隨筆資料預設將完全保存在本地資料庫（IndexedDB/LocalStorage fallback）中。未經您的授權與主動加密備份，任何人均無法存取您的內容。";
      
      if (typingTimer) clearInterval(typingTimer);
      securityText.textContent = "";
      
      let index = 0;
      typingTimer = setInterval(() => {
        if (index < fullText.length) {
          securityText.textContent += fullText.charAt(index);
          index++;
        } else {
          clearInterval(typingTimer);
          typingTimer = null;
        }
      }, 50);
    });
  }
}

// ==================== 備忘錄圖片壓縮與預覽 ====================
function handleImageUpload(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const currentCount = State.uploadedImages.length;
  if (currentCount + files.length > 9) { // 隨筆放寬圖片限制
    alert('為了保持版面的簡潔，單則備忘錄最多支援上傳 9 張圖片。');
    return;
  }

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const maxDim = 600;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        State.uploadedImages.push(compressedBase64);
        renderUploadedImages();
      };
    };
    reader.readAsDataURL(file);
  });

  e.target.value = '';
}

function renderUploadedImages() {
  const preview = document.getElementById('memo-images-preview');
  if (!preview) return;
  preview.innerHTML = '';

  const statusText = document.getElementById('upload-status-text');
  if (statusText) {
    const len = State.uploadedImages.length;
    statusText.textContent = len > 0 ? `已選擇 ${len} 張圖片` : '未加入圖片';
  }

  const fragment = document.createDocumentFragment();
  State.uploadedImages.forEach((base64, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'memo-image-wrapper';
    
    const img = document.createElement('img');
    img.src = isSafeImageUri(base64) ? base64 : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.loading = 'lazy'; // Lazy-load images
    img.alt = '上傳相片';
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-image';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = () => {
      State.uploadedImages.splice(index, 1);
      renderUploadedImages();
    };

    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    fragment.appendChild(wrapper);
  });
  preview.appendChild(fragment);

  // 自動保存隨筆圖片草稿
  if (State.editingMemoId === null) {
    localStorage.setItem(`draft_memo_images_${State.currentUser}_${State.activeDate}`, JSON.stringify(State.uploadedImages));
  }
}

// ==================== 備忘錄新增與編輯流程 ====================
async function handleMemoSubmit() {
  const textarea = document.getElementById('memo-textarea');
  if (!textarea) return;

  const content = textarea.value.trim();
  if (!content && State.uploadedImages.length === 0) {
    alert('請填寫隨筆內容或上傳至少一張圖片。');
    return;
  }

  try {
    if (State.editingMemoId === null) {
      // 1. 新增模式 (Create)
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      await DiaryDB.saveMemo({
        date: State.activeDate,
        time: timeStr,
        content: content,
        images: State.uploadedImages
      }, State.currentUser);
    } else {
      // 2. 編輯更新模式 (Update)
      // 先抓取原有 memo 的時間，以保持時間戳不變
      const allMemos = await DiaryDB.getMemosForDate(State.activeDate, State.currentUser);
      const original = allMemos.find(m => m.id === State.editingMemoId);
      const originalTime = original ? original.time : '00:00';

      await DiaryDB.saveMemo({
        id: State.editingMemoId,
        date: State.activeDate,
        time: originalTime,
        content: content,
        images: State.uploadedImages
      }, State.currentUser);
    }

    // 重設狀態與清空欄位
    exitEditMode();
    // 重新渲染時間軸
    await renderMemoTimeline();
    
    // 清理隨筆草稿與寫入同步佇列
    localStorage.removeItem(`draft_memo_text_${State.currentUser}_${State.activeDate}`);
    localStorage.removeItem(`draft_memo_images_${State.currentUser}_${State.activeDate}`);
    SyncManager.addToQueue('save_memo', { date: State.activeDate, content: content });

  } catch (err) {
    console.error('儲存隨筆失敗:', err);
    alert('儲存隨筆失敗：' + (err ? (err.name + ': ' + err.message + '\nStack: ' + err.stack) : '未知錯誤'));
  }
}

function loadMemoToForm(memo) {
  const textarea = document.getElementById('memo-textarea');
  const formTitle = document.getElementById('memo-form-title');
  const submitBtn = document.getElementById('btn-submit-memo');
  const cancelBtn = document.getElementById('btn-cancel-memo');

  if (!textarea) return;

  // 載入內文與圖片到暫存區
  textarea.value = memo.content;
  State.uploadedImages = [...(memo.images || [])];
  renderUploadedImages();

  // 切換為編輯狀態
  State.editingMemoId = memo.id;
  
  if (formTitle) formTitle.textContent = `正在修改發布於 ${memo.time} 的隨筆：`;
  if (submitBtn) submitBtn.textContent = 'UPDATE';
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  // 捲動至輸入框，方便使用者編輯
  textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  textarea.focus();
}

function exitEditMode() {
  const textarea = document.getElementById('memo-textarea');
  const formTitle = document.getElementById('memo-form-title');
  const submitBtn = document.getElementById('btn-submit-memo');
  const cancelBtn = document.getElementById('btn-cancel-memo');

  // 清空暫存與輸入
  if (textarea) textarea.value = '';
  State.uploadedImages = [];
  renderUploadedImages();
  State.editingMemoId = null;

  // 恢復預設介面文字與按鈕
  if (formTitle) formTitle.textContent = '時光隨筆';
  if (submitBtn) submitBtn.textContent = 'ADD';
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

async function handleDeleteMemo(id) {
  if (!confirm('確定要永久刪除這則隨筆記錄嗎？')) return;

  try {
    await DiaryDB.deleteMemo(id, State.currentUser);
    await renderMemoTimeline();
    // 如果正在編輯的剛好是被刪除的，退出編輯模式
    if (State.editingMemoId === id) {
      exitEditMode();
    }
    SyncManager.addToQueue('delete_memo', { id });
  } catch (err) {
    console.error('刪除隨筆失敗:', err);
    alert('刪除隨筆失敗，請重試。');
  }
}

// ==================== 時光花園 (Year Garden) 資料載入與渲染 ====================

// 1. 若資料庫是空的，預載一些過往模擬資料以顯示美麗的彩色花園
async function seedMockDataIfNeeded() {
  // 生產環境發布版：不載入任何模擬資料，資料庫預設保持完全空白
  return;
  
  const count = await DiaryDB.getCompletedDiariesCount(State.currentUser);
  if (localStorage.getItem('diary_mock_populated') && count > 0) return;
  
  // 額外寫入特定的同日日記與隨筆，確保測試 "那年的今天" 與 "伴侶日記" 有豐富的現成資料 (涵蓋 07-14 至 07-17)
  const testDates = ['07-14', '07-15', '07-16', '07-17'];
  const mockDiaries = {
    'user_a': {
      '07-14': {
        2025: { mood: 'blue', content: '去年今天自己在家做手工皮件，磨了半天，手有點酸但很有成就感。' },
        2024: { mood: 'green', content: '前年今天去了植物園溫室，裡面非常濕熱，不過蘭花開得很漂亮。' }
      },
      '07-15': {
        2025: { mood: 'yellow', content: '去年今天和家人出門野餐，天氣非常好，風吹起來很舒服。' },
        2024: { mood: 'red', content: '前年今天經歷了一場小雷雨，不過後來天邊掛起了一道雙彩虹，非常驚喜。' }
      },
      '07-16': {
        2025: { mood: 'blue', content: '去年今天在家裡看了一整天的老電影，享受安靜的獨處時光。' },
        2024: { mood: 'yellow', content: '前年今天和朋友去吃火鍋，聊到深夜，笑到肚子痛。' }
      },
      '07-17': {
        2025: { mood: 'green', content: '去年今天嘗試自己做手沖麵包，發酵得很完美，烤出來金黃酥脆。' },
        2024: { mood: 'black', content: '前年今天下了一整天的大雨，待在房間聽純音樂寫日記，非常沉靜。' }
      }
    },
    'user_b': {
      '07-14': {
        2026: { mood: 'red', content: '今天買了一把新吉他，抱著彈了一晚上，指尖有點痛但很滿足。' },
        2025: { mood: 'yellow', content: '去年今天在陽台吹著晚風聽歌，看著遠處的霓虹燈火，發呆了很久。' },
        2024: { mood: 'black', content: '前年今天整理了舊抽屜，翻出很多小時候的信件，回憶滿滿。' }
      },
      '07-15': {
        2026: { mood: 'blue', content: '今天一整天都在忙，感覺有點累，不過收到好聽的歌很開心。' },
        2025: { mood: 'green', content: '去年今天在咖啡店讀了一整下午的書，聽著爵士樂，內心十分平靜。' },
        2024: { mood: 'yellow', content: '前年今天在海邊看夕陽，落日把海水染成一片橙紅，美得像一幅畫。' }
      },
      '07-16': {
        2026: { mood: 'yellow', content: '今天去烘焙坊買了剛出爐的肉桂捲，香氣四溢，味道超級驚艷！' },
        2025: { mood: 'blue', content: '去年今天在湖邊散步，看到夕陽餘暉倒映在水面上，非常浪漫。' },
        2024: { mood: 'green', content: '前年今天讀了一本關於宇宙起源的書，感覺自己如此渺小。' }
      },
      '07-17': {
        2026: { mood: 'black', content: '今天終於把累積的工作清空了，週末可以好好放鬆一下了。' },
        2025: { mood: 'red', content: '去年今天去攀岩館練習，挑戰了一條難度頗高的路線，差點摔下來。' },
        2024: { mood: 'blue', content: '前年今天整理了硬碟裡的舊照片，感嘆時間過得真快。' }
      }
    }
  };

  const mockMemos = {
    'user_a': {
      '07-14': {
        2025: [
          { time: '10:00', content: '隨筆：買了植鞣牛皮與削邊器，準備做個卡夾。' },
          { time: '15:30', content: '隨筆：皮革打孔的聲音有點大，希望沒吵到鄰居。' }
        ],
        2024: [
          { time: '14:00', content: '隨筆：溫室裡的捕蠅草和瓶子草真的太奇特了。' }
        ]
      },
      '07-15': {
        2025: [
          { time: '09:00', content: '隨筆：早晨出發前整理了野餐籃，帶了法棍跟蘋果氣泡水。' },
          { time: '14:30', content: '隨筆：在草地上睡了個午覺，被風吹醒的感覺真好。' }
        ],
        2024: [
          { time: '16:00', content: '隨筆：雷陣雨來得快去得也快，雙彩虹真的很耀眼。' }
        ]
      },
      '07-16': {
        2025: [
          { time: '14:00', content: '隨筆：煮了熱伯爵紅茶，看了一部法國老電影。' }
        ],
        2024: [
          { time: '22:30', content: '隨筆：晚餐吃了太辣的麻辣鍋，肚子現在熱熱的。' }
        ]
      },
      '07-17': [
        { time: '11:00', content: '隨筆：酵母活力很好，麵團膨脹得很漂亮。' }
      ]
    },
    'user_b': {
      '07-14': {
        2026: [
          { time: '19:30', content: '隨筆：這把全單吉他共鳴真好，指法還要再練練。' }
        ],
        2025: [
          { time: '21:00', content: '隨筆：今晚的天空特別澄澈，甚至看得到幾顆星星。' }
        ]
      },
      '07-15': {
        2025: [
          { time: '15:00', content: '隨筆：點了抹茶磅蛋糕，甜度剛好，很推薦。' }
        ],
        2024: [
          { time: '18:30', content: '隨筆：踩著沙灘，聽著浪花聲，把煩惱都丟進海裡。' }
        ]
      },
      '07-16': {
        2026: [
          { time: '16:30', content: '隨筆：肉桂捲表面的焦糖脆脆的，太罪惡了！' }
        ],
        2025: [
          { time: '19:00', content: '隨筆：微風吹過來很涼爽，拍了三張天空的照片。' }
        ],
        2024: [
          { time: '23:00', content: '隨筆：讀書配熱烏龍茶，很悠閒的深夜。' }
        ]
      }
    }
  };

  // 寫入日記與隨筆
  const usersToSeed = ['user_a', 'user_b'];
  for (const u of usersToSeed) {
    const datesData = mockDiaries[u] || {};
    for (const dStr of testDates) {
      const yearMap = datesData[dStr] || {};
      for (const y of [2024, 2025, 2026]) {
        const diaryObj = yearMap[y];
        const dateKey = `${y}-${dStr}`;
        
        if (diaryObj) {
          await DiaryDB.saveDiary({
            date: dateKey,
            content: diaryObj.content,
            mood: diaryObj.mood,
            timestamp: new Date(`${dateKey}T12:00:00`).toISOString()
          }, u);
        }

        // 寫入隨筆
        const userMemosMap = mockMemos[u] || {};
        const memosList = userMemosMap[dStr];
        let itemsToSave = [];
        if (memosList) {
          if (Array.isArray(memosList)) {
            itemsToSave = memosList;
          } else if (memosList[y]) {
            itemsToSave = memosList[y];
          }
        }
        for (const m of itemsToSave) {
          await DiaryDB.saveMemo({
            date: dateKey,
            time: m.time,
            content: m.content,
            images: [],
            userId: u
          }, u);
        }
      }
    }
  };
  
  console.log('正在為熱力圖生成模擬歷史日記與隨筆數據...');
  const moods = ['yellow', 'green', 'blue', 'red', 'black'];
  
  const diaryTexts = [
    '今天在公園散步，遇見一隻非常親人的橘貓，在腳邊蹭了很久，十分療癒。',
    '早晨煮了一杯完美的熱拿鐵，讀了半章小說，感覺今天是個美好的開始。',
    '今天工作上解決了一個困擾很久的 Bug，下班給自己點了一份雙倍起司披薩！',
    '窗外淅淅瀝瀝下著小雨，聽著雨聲寫程式，特別專注而平靜。',
    '心情有點小沮喪，晚上去跑了五公里，流汗過後感覺心裡的重擔輕了許多。',
    '和家人通了電話，聊聊最近的生活瑣事，簡單的話語卻帶給我滿滿的力量。',
    '今天讀到一句很溫暖的話：「專注當下，時間便不復存在。」感觸很深。',
    '買了一盆新的綠意植栽放在窗台，看著嫩綠的新葉，覺得生活充滿希望。'
  ];

  const memoTexts = [
    '這是一則時光隨筆：今天喝的咖啡豆是耶加雪菲，果酸味明顯，很清爽。',
    '筆記：下週記得要去補貨貓罐頭跟麥片，順便去郵局寄包裹。',
    '隨筆：晚上看到天邊有一抹非常漂亮的粉紫色晚霞，隨手拍了下來。',
    '心得：今天跟團隊成員討論了專案進度，大家幹勁十足，非常期待！'
  ];

  const users = ['user_a', 'user_b'];
  const years = [2024, 2025, 2026];

  for (const userId of users) {
    for (const year of years) {
      // 每年隨機生成 45 到 65 天的日記
      const daysToSeed = 45 + Math.floor(Math.random() * 20);
      for (let i = 0; i < daysToSeed; i++) {
        const month = Math.floor(Math.random() * 12) + 1;
        const maxDay = (month === 2) ? 28 : ([4, 6, 9, 11].includes(month) ? 30 : 31);
        const day = Math.floor(Math.random() * maxDay) + 1;
        
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // 避免覆蓋今天的主日記
        if (dateStr === State.activeDate) continue;

        const mood = moods[Math.floor(Math.random() * moods.length)];
        const diaryText = diaryTexts[Math.floor(Math.random() * diaryTexts.length)];
        
        // 儲存日記
        await DiaryDB.saveDiary({
          date: dateStr,
          content: diaryText,
          mood: mood,
          timestamp: new Date(`${dateStr}T12:00:00`).toISOString()
        }, userId);

        // 40% 機率寫入備忘隨筆
        if (Math.random() > 0.6) {
          const memoText = memoTexts[Math.floor(Math.random() * memoTexts.length)];
          await DiaryDB.saveMemo({
            date: dateStr,
            time: '18:30',
            content: memoText,
            images: [],
            userId: userId
          }, userId);
        }
      }
    }
  }

  localStorage.setItem('diary_mock_populated', 'true');
}

// 2. 初始化渲染 3 年網格，每個年份 365 個點
function getCycleStartYear() {
  const user = getCachedUser();
  if (user && user.startedAt) {
    return Number(user.startedAt.split('-')[0]);
  }
  return Number(localStorage.getItem(`cycle_start_year_${State.currentUser}`) || 2024);
}

function getGardenYearsOrder() {
  const startYear = getCycleStartYear();
  const currentYear = Number(State.activeDate.split('-')[0]);
  if (currentYear === startYear) {
    return [startYear, startYear + 1, startYear + 2];
  } else if (currentYear === startYear + 1) {
    return [startYear + 1, startYear + 2, startYear];
  } else {
    return [startYear + 2, startYear + 1, startYear];
  }
}

async function initGarden() {
  const startYear = getCycleStartYear();
  const years = getGardenYearsOrder();

  // 動態更新頂部子標題 (如 "2024-2026")
  const subtitle = document.getElementById('yearly-range-subtitle');
  if (subtitle) {
    subtitle.textContent = `${startYear}-${startYear + 2}`;
  }

  const container = document.getElementById('garden-grids-container');
  if (container) {
    // Check if grids are already rendered in the correct order to prevent DOM thrashing
    const existingCards = container.querySelectorAll('.garden-year-card');
    let needsRebuild = existingCards.length !== years.length;
    if (!needsRebuild) {
      for (let i = 0; i < years.length; i++) {
        const titleSpan = existingCards[i].querySelector('.section-title');
        if (!titleSpan || Number(titleSpan.textContent) !== years[i]) {
          needsRebuild = true;
          break;
        }
      }
    }

    if (needsRebuild) {
      container.innerHTML = '';
      
      for (const year of years) {
        const section = document.createElement('section');
        section.className = 'card garden-year-card';
        
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'section-title text-accent';
        titleSpan.textContent = year;
        cardHeader.appendChild(titleSpan);
        
        const statsSpan = document.createElement('span');
        statsSpan.className = 'garden-year-stats';
        statsSpan.id = `stats-${year}`;
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        const totalDays = isLeap ? 366 : 365;
        statsSpan.textContent = `0 / ${totalDays} 日`;
        cardHeader.appendChild(statsSpan);
        
        section.appendChild(cardHeader);
        
        const grid = document.createElement('div');
        grid.className = 'garden-grid';
        grid.id = `garden-grid-${year}`;
        
        const dotsFragment = document.createDocumentFragment();
        for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
          const currentDate = new Date(year, 0, 1 + dayOffset);
          const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
          
          const dot = document.createElement('div');
          dot.className = 'garden-dot';
          dot.setAttribute('data-date', dateStr);
          dot.title = dateStr.replace(/-/g, '.');
          dot.addEventListener('click', () => {
            showGardenDetailModal(dateStr);
          });
          dotsFragment.appendChild(dot);
        }
        grid.appendChild(dotsFragment);
        section.appendChild(grid);
        container.appendChild(section);
      }
    }
  }
  
  // 更新各點著色與統計數據
  await updateGardenDotsColor();
  
  // 觸發漸進綻放 bloom 動畫
  triggerGardenBloomAnimation();
}

// 3. 讀取資料庫，將所有天數 of current cycle 的點染上心情顏色，並更新統計
async function updateGardenDotsColor() {
  try {
    const allDiaries = await DiaryDB.getAllDiaries(State.currentUser);
    
    // 轉為 Date string -> Mood map 方便快速比對
    const diaryMap = {};
    allDiaries.forEach(d => {
      diaryMap[d.date] = d.mood;
    });

    const years = getGardenYearsOrder();
    
    years.forEach(year => {
      let writtenCount = 0;
      const dots = document.querySelectorAll(`#garden-grid-${year} .garden-dot`);
      
      dots.forEach(dot => {
        const dateStr = dot.getAttribute('data-date');
        const mood = diaryMap[dateStr];
        
        // 清除先前染上的心情 class
        dot.className = 'garden-dot';
        
        if (mood) {
          dot.classList.add(`mood-${mood}`);
          writtenCount++;
        }
      });
      
      // 更新年份統計字樣
      const statsSpan = document.getElementById(`stats-${year}`);
      if (statsSpan) {
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        const totalDays = isLeap ? 366 : 365;
        statsSpan.textContent = `${writtenCount} / ${totalDays} 日`;
      }
    });
  } catch (err) {
    console.error('更新時光花園顏色失敗:', err);
  }
}

// 4. 漸進綻放 bloom 動畫（延遲逐格出現）
function triggerGardenBloomAnimation() {
  const dots = document.querySelectorAll('.garden-dot');
  
  dots.forEach((dot, index) => {
    // 延遲在 0ms 到 600ms 之間隨機分佈，產生繁花點點盛開的效果
    const delay = Math.random() * 600;
    setTimeout(() => {
      dot.classList.add('bloom');
    }, delay);
  });
}

// 5. 點擊小點，開啟詳細對照彈窗並渲染資料
// 檢查日期是否在本週 (今天為 2026-07-15 往前推 7 天，即 2026-07-09 到 2026-07-15)
function isDateInCurrentWeek(dateStr) {
  const [ty, tm, td] = '2026-07-15'.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  const [dy, dm, dd] = dateStr.split('-').map(Number);
  const dateVal = new Date(dy, dm - 1, dd);
  const diffTime = today - dateVal;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays < 7;
}

// 5. 點擊小點，開啟詳細對照彈窗並渲染資料
async function showGardenDetailModal(dateStr, isCurrentWeekReview = false) {
  const modal = document.getElementById('garden-detail-modal');
  const dateText = document.getElementById('modal-date-text');
  const deleteBtn = document.getElementById('modal-btn-delete-diary');
  const notebookText = document.getElementById('modal-notebook-text');
  const notebookMeta = document.getElementById('modal-notebook-meta');
  
  if (!modal || !dateText || !deleteBtn || !notebookText || !notebookMeta) return;

  // 格式化日期顯示
  dateText.textContent = dateStr.replace(/-/g, '.');
  const dateParts = dateStr.split('-');
  const formattedDate = `${dateParts[0]} 年 ${dateParts[1]} 月 ${dateParts[2]} 日`;
  
  try {
    // 載入該日日記
    const diary = await DiaryDB.getDiary(dateStr, State.currentUser);
    const content = (diary && typeof diary.content === 'string') ? diary.content : '';
    const mood = diary ? diary.mood : 'none';
    
    // 設定心情顯示名稱對照表
    const moodNames = {
      'black': '普通',
      'yellow': '喜悅',
      'green': '平靜',
      'blue': '孤單',
      'red': '波瀾',
      'none': '無紀錄'
    };
    
    // 綁定刪除/編輯日記點擊事件
    if (diary) {
      deleteBtn.classList.remove('hidden');
      
      if (isCurrentWeekReview || isDateInCurrentWeek(dateStr)) {
        // 若本週有日記 -> 刪除字樣改為編輯，點擊可直接編輯日記
        deleteBtn.textContent = '編輯';
        deleteBtn.style.color = '#434343';
        deleteBtn.style.backgroundColor = 'rgba(67, 67, 67, 0.05)';
        
        deleteBtn.onclick = async () => {
          modal.classList.add('hidden');
          await switchToPage('today', dateStr);
        };
      } else {
        // 歷史週或 Yearly 熱力圖點點擊 -> 顯示為「刪除」，紅色樣式
        deleteBtn.textContent = '刪除';
        deleteBtn.style.color = 'var(--color-text-red)';
        deleteBtn.style.backgroundColor = 'rgba(231, 111, 81, 0.05)';
        
        deleteBtn.onclick = async () => {
          if (!confirm(`確定要永久刪除 ${formattedDate} 的日記記錄嗎？\n(注意：刪除日記也會同時刪除隨筆)`)) return;
          
          try {
            // 從資料庫移除
            await DiaryDB.deleteDiary(dateStr, State.currentUser);
            
            // 關閉 Modal
            modal.classList.add('hidden');
            
            // 重新整理 Yearly 網格
            await initGarden();
            
            // 如果被刪除的是今天 (2026-07-15)，立刻清空今日書寫卡片狀態
            if (dateStr === State.activeDate) {
              const textarea = document.getElementById('diary-textarea');
              if (textarea) textarea.value = '';
              
              State.diaryWordCount = 0;
              const wordCountSpan = document.getElementById('diary-word-count');
              if (wordCountSpan) wordCountSpan.textContent = '0 / 50';
              
              updateManuscriptCells('');
              removeManuscriptCursor();
              
              // 恢復預設心情普通 (black)
              State.selectedMood = 'black';
              document.querySelectorAll('.mood-dots-row .mood-dot').forEach(d => {
                if (d.getAttribute('data-mood') === 'black') {
                  d.classList.add('active');
                } else {
                  d.classList.remove('active');
                }
              });
              const container = document.getElementById('manuscript-container-box');
              if (container) {
                container.className = 'manuscript-container mood-black';
              }
            }
            
            // 清理草稿與寫入同步佇列
            localStorage.removeItem(`draft_diary_${State.currentUser}_${dateStr}`);
            localStorage.removeItem(`draft_mood_${State.currentUser}_${dateStr}`);
            SyncManager.addToQueue('delete_diary', { date: dateStr });
            
            alert('日記已成功刪除。');
          } catch (delErr) {
            console.error('刪除日記失敗:', delErr);
            alert('刪除日記失敗，請重試。');
          }
        };
      }
    } else {
      // 若該日無日記，隱藏刪除按鈕
      deleteBtn.classList.add('hidden');
    }
    
    // 渲染橫線筆記本與心情字體/底線顏色
    if (diary && content.trim()) {
      notebookText.textContent = content;
      notebookMeta.textContent = formattedDate;
      
      const colors = MOOD_COLORS[mood] || { text: '#434343', line: 'rgba(67, 67, 67, 0.4)' };
      notebookText.style.setProperty('--mood-color', colors.text);
      notebookText.style.setProperty('--mood-color-line', colors.line);
    } else {
      notebookText.textContent = '今天沒有寫下任何日記字句。';
      notebookMeta.textContent = `${formattedDate} · 今天還沒有寫下任何話。`;
      
      notebookText.style.setProperty('--mood-color', '#c7c7cc');
      notebookText.style.setProperty('--mood-color-line', 'rgba(199, 199, 204, 0.4)');
    }
    
    // 綁定點擊讀取使用者自己隨筆的按鈕
    const userMemoBtn = document.getElementById('btn-user-modal-memo');
    if (userMemoBtn) {
      userMemoBtn.onclick = async () => {
        const reviewMemoDrawer = document.getElementById('review-memo-drawer');
        const reviewMemoTitle = document.getElementById('review-memo-title');
        if (reviewMemoDrawer && reviewMemoTitle) {
          reviewMemoTitle.textContent = '時光隨筆';
          const userMemos = await DiaryDB.getMemosForDate(dateStr, State.currentUser);
          renderReviewMemoTimeline(userMemos);
          reviewMemoDrawer.classList.remove('hidden');
        }
      };
    }
    
    // 載入並渲染伴侶日記 (若已配對且夥伴當天有寫日記)
    const partnerId = PartnerService.getPartnerId(State.currentUser);
    const modalPartnerCard = document.getElementById('modal-partner-notebook-card');
    if (modalPartnerCard) {
      if (partnerId) {
        const partnerDiary = await DiaryDB.getDiary(dateStr, partnerId);
        if (partnerDiary && typeof partnerDiary.content === 'string' && partnerDiary.content.trim()) {
          const partnerText = document.getElementById('modal-partner-notebook-text');
          const partnerMeta = document.getElementById('modal-partner-notebook-meta');
          const partnerMemoBtn = document.getElementById('btn-partner-modal-memo');
          
          if (partnerText && partnerMeta && partnerMemoBtn) {
            partnerText.textContent = partnerDiary.content;
            partnerMeta.textContent = formattedDate;
            
            partnerMemoBtn.onclick = async () => {
              const reviewMemoDrawer = document.getElementById('review-memo-drawer');
              const reviewMemoTitle = document.getElementById('review-memo-title');
              if (reviewMemoDrawer && reviewMemoTitle) {
                const partnerName = await getPartnerName();
                reviewMemoTitle.textContent = `${partnerName}的隨筆`;
                const partnerMemos = await DiaryDB.getMemosForDate(dateStr, partnerId);
                renderReviewMemoTimeline(partnerMemos);
                reviewMemoDrawer.classList.remove('hidden');
              }
            };
            
            const colors = MOOD_COLORS[partnerDiary.mood] || { text: '#434343', line: 'rgba(67, 67, 67, 0.4)' };
            partnerText.style.setProperty('--mood-color', colors.text);
            partnerText.style.setProperty('--mood-color-line', colors.line);
            
            modalPartnerCard.classList.remove('hidden');
          } else {
            modalPartnerCard.classList.add('hidden');
          }
        } else {
          modalPartnerCard.classList.add('hidden');
        }
      } else {
        modalPartnerCard.classList.add('hidden');
      }
    }
    
    // 顯示 Modal
    modal.classList.remove('hidden');
    
    // 重新初始化 Lucide 圖標
    try {
      lucide.createIcons();
    } catch (e) {}
  } catch (err) {
    console.error('載入花園細節彈窗失敗:', err);
  }
}

// 7. 渲染彈窗內部的 memos 隨筆時間軸
function renderReviewMemoTimeline(memos) {
  const timelineList = document.getElementById('review-memo-timeline-list');
  if (!timelineList) return;
  
  timelineList.innerHTML = '';
  
  if (!memos || !memos.length) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-state';
    emptyMsg.textContent = '此日期無登錄隨筆記錄。';
    timelineList.appendChild(emptyMsg);
    return;
  }
  
  const fragment = document.createDocumentFragment();
  memos.forEach(memo => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'item-time';
    timeSpan.textContent = memo.time + ':';
    
    const body = document.createElement('div');
    body.className = 'item-body';
    
    const textNode = document.createElement('div');
    textNode.className = 'item-text';
    textNode.textContent = memo.content;
    body.appendChild(textNode);
    
    // 渲染圖片
    if (memo.images && memo.images.length) {
      const imgGrid = document.createElement('div');
      imgGrid.className = 'timeline-images-grid';
      
      memo.images.forEach(base64 => {
        const wrapper = document.createElement('div');
        wrapper.className = 'timeline-image-wrapper';
        
        const img = document.createElement('img');
        const safeSrc = isSafeImageUri(base64) ? base64 : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        img.src = safeSrc;
        img.loading = 'lazy'; // Lazy-load images
        img.alt = '隨筆相片';
        
        img.addEventListener('click', () => {
          const w = window.open();
          if (w) {
            const body = w.document.body;
            body.style.margin = '0';
            body.style.backgroundColor = '#000';
            body.style.display = 'flex';
            body.style.alignItems = 'center';
            body.style.justifyContent = 'center';
            body.style.height = '100vh';
            
            const largeImg = w.document.createElement('img');
            largeImg.src = safeSrc;
            largeImg.style.maxWidth = '100%';
            largeImg.style.maxHeight = '100vh';
            largeImg.style.display = 'block';
            largeImg.style.margin = 'auto';
            body.appendChild(largeImg);
          }
        });
        
        wrapper.appendChild(img);
        imgGrid.appendChild(wrapper);
      });
      
      body.appendChild(imgGrid);
    }
    
    item.appendChild(timeSpan);
    item.appendChild(body);
    fragment.appendChild(item);
  });
  timelineList.appendChild(fragment);
}

// ==================== Weekly Review Page Implementation ====================

// 1. 初始化週記介面按鈕與載入邏輯
let isWeeklyInitialized = false;
async function initWeeklyReview() {
  if (!isWeeklyInitialized) {
    const btnPrev = document.getElementById('btn-prev-week');
    const btnNext = document.getElementById('btn-next-week');
    
    if (btnPrev && btnNext) {
      btnPrev.addEventListener('click', async () => {
        State.weeklyOffset--;
        await renderWeeklyReview();
      });
      
      btnNext.addEventListener('click', async () => {
        if (State.weeklyOffset < 0) {
          State.weeklyOffset++;
          await renderWeeklyReview();
        }
      });
    }

    // 點擊 WEEKLY 字樣標題跳轉回當週
    const weeklyTitle = document.querySelector('#weekly-page .header-title');
    if (weeklyTitle) {
      weeklyTitle.addEventListener('click', async () => {
        if (State.weeklyOffset !== 0) {
          State.weeklyOffset = 0;
          await renderWeeklyReview();
        }
      });
    }
    isWeeklyInitialized = true;
  }
  
  await renderWeeklyReview();
}

// 2. WeeklyReview 元件：計算日期區間、查詢資料庫並渲染列表
async function renderWeeklyReview() {
  const rangeText = document.getElementById('weekly-range-text');
  const reviewList = document.getElementById('weekly-review-list');
  const btnNext = document.getElementById('btn-next-week');
  
  if (!reviewList) return;
  reviewList.innerHTML = '';
  
  // 計算本週 7 天的日期序列（降冪排列）
  const dates = [];
  const baseDate = new Date(2026, 6, 15); // 模擬今天
  baseDate.setDate(baseDate.getDate() + (State.weeklyOffset * 7));
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  
  // 更新範圍文字 (例如: 7/9 - 7/15)
  if (rangeText && dates.length > 0) {
    const [sY, sM, sD] = dates[6].split('-').map(Number);
    const [eY, eM, eD] = dates[0].split('-').map(Number);
    const startStr = `${sM}/${sD}`;
    const endStr = `${eM}/${eD}`;
    rangeText.textContent = `${startStr} - ${endStr}`;
  }
  
  // 設定後一週按鈕的啟用狀態
  if (btnNext) {
    btnNext.disabled = (State.weeklyOffset === 0);
  }
  
  // 遍歷日期渲染各個日記卡片
  for (const dateStr of dates) {
    const diary = await DiaryDB.getDiary(dateStr, State.currentUser);
    const cardNode = createDiaryReviewCard(dateStr, diary);
    reviewList.appendChild(cardNode);
  }
  
  // 重新渲染 Lucide 圖標
  try {
    lucide.createIcons();
  } catch (e) {}
}

// 3. DiaryReviewCard 元件：產生單日日記展示卡片 DOM
function createDiaryReviewCard(dateStr, diary) {
  const card = document.createElement('div');
  card.className = 'diary-review-card';
  
  // 格式化日期與星期
  const parts = dateStr.split('-');
  const formattedDate = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const weekdayStr = getChineseWeekday(dateStr);
  
  // 判斷是否為今天
  const isTodayStr = (dateStr === '2026-07-15') ? ' · 今天' : '';
  
  // 卡片標頭
  const header = document.createElement('div');
  header.className = 'diary-review-card-header';
  
  const dateLabel = document.createElement('span');
  dateLabel.className = 'diary-review-card-date';
  dateLabel.textContent = `${formattedDate} (${weekdayStr})${isTodayStr}`;
  
  const moodDot = document.createElement('div');
  moodDot.className = 'diary-review-card-mood-dot';
  
  // 心情設定
  const mood = diary ? diary.mood : 'none';
  const moodColor = (mood === 'none') ? '#e5e5ea' : (MOOD_COLORS[mood] ? MOOD_COLORS[mood].text : '#c7c7cc');
  moodDot.style.backgroundColor = moodColor;
  
  header.appendChild(dateLabel);
  header.appendChild(moodDot);
  card.appendChild(header);
  
  // 卡片內容
  if (diary && diary.content.trim()) {
    const body = document.createElement('p');
    body.className = 'diary-review-card-body';
    body.textContent = diary.content;
    
    // 心情顏色套用至字體
    body.style.setProperty('--mood-color', MOOD_COLORS[mood] ? MOOD_COLORS[mood].text : '#434343');
    card.appendChild(body);
  } else {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'diary-review-card-empty';
    emptyMsg.textContent = '今天沒有寫下任何日記字句。';
    card.appendChild(emptyMsg);
  }
  
  // 點擊事件交互處理
  card.addEventListener('click', async () => {
    if (State.weeklyOffset === 0) {
      // 當週點選 Weekly 頁面的日記卡片時
      if (diary && diary.content.trim()) {
        // 若本週有日記 -> 顯示橫線筆記，刪除字樣改為編輯
        await showGardenDetailModal(dateStr, true);
      } else {
        // 若本週無日記 -> 跳轉Today頁面
        await switchToPage('today', dateStr);
      }
    } else {
      // 歷史週：直接跳出橫線筆記本對照彈窗，且不對 Yearly 頁面做任何動作
      await showGardenDetailModal(dateStr, false);
    }
  });
  
  return card;
}

// 4. 三年同日歷史回顧 (renderPreviousYearsReview)
async function renderPreviousYearsReview() {
  const section = document.getElementById('previous-years-review-section');
  const list = document.getElementById('previous-years-list');
  if (!section || !list) return;
  
  list.innerHTML = '';
  const fragment = document.createDocumentFragment();
  
  const [activeYear, activeMonthVal, activeDay] = State.activeDate.split('-').map(Number);
  const activeMonth = activeMonthVal - 1;
  
  // 檢索往年同月同日 (先去年 activeYear-1，後前年 activeYear-2 以利上下排列)
  const prevYears = [activeYear - 1, activeYear - 2];
  let foundAny = false;
  
  for (const year of prevYears) {
    const mmStr = String(activeMonth + 1).padStart(2, '0');
    const ddStr = String(activeDay).padStart(2, '0');
    const targetDateStr = `${year}-${mmStr}-${ddStr}`;
    
    try {
      const diary = await DiaryDB.getDiary(targetDateStr, State.currentUser);
      // 只要當天有日記或是隨筆，都予以呈現
      const memos = await DiaryDB.getMemosForDate(targetDateStr, State.currentUser);
      
      if ((diary && diary.content.trim()) || (memos && memos.length > 0)) {
        foundAny = true;
        
        const card = document.createElement('div');
        card.className = 'card notebook-card';
        card.style.boxShadow = 'none';
        card.style.border = '1px solid var(--color-border)';
        card.style.cursor = 'pointer';
        
        // 點擊卡片跳出該日期的詳細對照彈出視窗
        card.addEventListener('click', (e) => {
          // 如果點擊的是按鈕 (+ 或 刪除)，則由其各自的監聽器處理，不重複開啟詳細彈窗
          if (e.target.closest('button')) return;
          showGardenDetailModal(targetDateStr, false);
        });
        
        // 標頭
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        cardHeader.style.paddingBottom = '8px';
        cardHeader.style.display = 'flex';
        cardHeader.style.justifyContent = 'space-between';
        cardHeader.style.alignItems = 'center';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'section-title';
        titleSpan.style.fontSize = '0.82rem';
        titleSpan.style.color = 'var(--color-text-sub)';
        titleSpan.style.fontWeight = '600';
        
        const wStr = getChineseWeekday(targetDateStr);
        titleSpan.textContent = `${year}.${mmStr}.${ddStr} (${wStr})`;
        cardHeader.appendChild(titleSpan);
        
        // 右上角刪除按鈕 (同 Yearly)
        if (diary) {
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'modal-btn-delete';
          deleteBtn.textContent = '刪除';
          deleteBtn.style.color = 'var(--color-text-red)';
          deleteBtn.style.backgroundColor = 'rgba(231, 111, 81, 0.05)';
          deleteBtn.style.border = 'none';
          deleteBtn.style.borderRadius = 'var(--radius-pill)';
          deleteBtn.style.padding = '2px 10px';
          deleteBtn.style.fontSize = '0.72rem';
          deleteBtn.style.fontWeight = '600';
          deleteBtn.style.cursor = 'pointer';
          
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const formattedDate = `${year} 年 ${mmStr} 月 ${ddStr} 日`;
            if (!confirm(`確定要永久刪除 ${formattedDate} 的日記記錄嗎？\n(注意：刪除日記也會同時刪除隨筆)`)) return;
            
            try {
              await DiaryDB.deleteDiary(targetDateStr, State.currentUser);
              await renderPreviousYearsReview();
              await initGarden();
              
              // 清理草稿與寫入同步佇列
              localStorage.removeItem(`draft_diary_${State.currentUser}_${targetDateStr}`);
              localStorage.removeItem(`draft_mood_${State.currentUser}_${targetDateStr}`);
              SyncManager.addToQueue('delete_diary', { date: targetDateStr });
              
              alert('日記已成功刪除。');
            } catch (delErr) {
              console.error('刪除日記失敗:', delErr);
              alert('刪除日記失敗，請重試。');
            }
          });
          cardHeader.appendChild(deleteBtn);
        }
        
        card.appendChild(cardHeader);
        
        // 橫線日記內容 (若存在)
        if (diary && diary.content.trim()) {
          const linesContainer = document.createElement('div');
          linesContainer.className = 'notebook-lines-container';
          
          const textEl = document.createElement('p');
          textEl.className = 'lined-notebook-diary';
          textEl.style.fontSize = '1.12rem';
          textEl.style.lineHeight = '1.9';
          textEl.textContent = diary.content;
          
          const colors = MOOD_COLORS[diary.mood] || { text: '#434343', line: 'rgba(67, 67, 67, 0.4)' };
          textEl.style.setProperty('--mood-color', colors.text);
          textEl.style.setProperty('--mood-color-line', colors.line);
          
          linesContainer.appendChild(textEl);
          card.appendChild(linesContainer);
        } else if (memos && memos.length > 0) {
          // 只有隨筆而無日記
          const linesContainer = document.createElement('div');
          linesContainer.className = 'notebook-lines-container';
          const textEl = document.createElement('p');
          textEl.className = 'lined-notebook-diary';
          textEl.style.fontSize = '1.12rem';
          textEl.style.lineHeight = '1.9';
          textEl.textContent = '今天沒有寫下任何日記字句。';
          textEl.style.setProperty('--mood-color', '#c7c7cc');
          textEl.style.setProperty('--mood-color-line', 'rgba(199, 199, 204, 0.4)');
          linesContainer.appendChild(textEl);
          card.appendChild(linesContainer);
        }
        
        // 右下角新增 ＋ 按鈕，點擊顯示隨筆 (不論是否有隨筆皆顯示)
        const footer = document.createElement('div');
        footer.style.cssText = 'display: flex; justify-content: flex-end; align-items: center; margin-top: 14px;';
        
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.title = '閱讀隨筆';
        plusBtn.style.cssText = `
          background: none;
          border: 1px solid var(--color-border);
          border-radius: 50%;
          width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.86rem;
          font-weight: 600;
          color: var(--color-text-sub);
          cursor: pointer;
          padding: 0;
          line-height: 1;
          transition: var(--transition-normal);
        `;
        
        plusBtn.addEventListener('mouseenter', () => {
          plusBtn.style.backgroundColor = 'var(--color-border-visible)';
        });
        plusBtn.addEventListener('mouseleave', () => {
          plusBtn.style.backgroundColor = 'transparent';
        });
        
        plusBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const reviewMemoDrawer = document.getElementById('review-memo-drawer');
          const reviewMemoTitle = document.getElementById('review-memo-title');
          if (reviewMemoDrawer && reviewMemoTitle) {
            reviewMemoTitle.textContent = `${year}.${mmStr}.${ddStr} 的隨筆`;
            const userMemos = await DiaryDB.getMemosForDate(targetDateStr, State.currentUser);
            renderReviewMemoTimeline(userMemos);
            reviewMemoDrawer.classList.remove('hidden');
          }
        });
        
        footer.appendChild(plusBtn);
        card.appendChild(footer);
        
        fragment.appendChild(card);
      }
    } catch (e) {
      console.warn(`載入三年同日回顧失敗 (${targetDateStr}):`, e);
    }
  }
  
  list.appendChild(fragment);
  
  if (foundAny) {
    section.style.display = 'block';
  } else {
    section.style.display = 'none';
  }
  
  // 渲染新注入的 Lucide 圖標
  try {
    lucide.createIcons();
  } catch (err) {}
}
// 檢查是否需要顯示備份提醒
async function checkBackupReminder() {
  const banner = document.getElementById('backup-reminder-banner');
  if (!banner) return;
  
  // 檢查手動關閉期限 (24小時內不再提醒)
  const dismissedUntil = localStorage.getItem(`backup_reminder_dismissed_until_${State.currentUser}`);
  if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
    banner.classList.add('hidden');
    return;
  }
  
  const lastBackup = localStorage.getItem(`last_backup_timestamp_${State.currentUser}`);
  if (!lastBackup) {
    banner.classList.remove('hidden');
    return;
  }
  
  const diffTime = Date.now() - Number(lastBackup);
  const diffHours = diffTime / (1000 * 60 * 60);
  
  if (diffHours >= 24) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// 開啟加密備份密碼設定彈窗
async function triggerBackupFlow() {
  activeCryptoAction = 'backup';
  const modal = document.getElementById('passcode-modal');
  const title = document.getElementById('passcode-modal-title');
  const desc = document.getElementById('passcode-modal-description');
  const pinInput = document.getElementById('passcode-input');
  
  if (!modal || !title || !desc || !pinInput) return;
  
  title.textContent = '🔐 設定加密備份密碼';
  desc.textContent = '請設定一個 6 位以上的密碼用來加密您的日記與隨筆。此密碼僅存在於您的記憶中，若遺失將無法復原備份資料。';
  pinInput.value = '';
  modal.classList.remove('hidden');
}

// 開啟還原密碼驗證彈窗
async function triggerRestoreFlow(file) {
  activeCryptoAction = 'restore';
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload.salt || !payload.iv || !payload.ciphertext) {
        alert('⚠️ 無效的備份檔案格式！');
        return;
      }
      activeRestorePayload = payload;
      
      const modal = document.getElementById('passcode-modal');
      const title = document.getElementById('passcode-modal-title');
      const desc = document.getElementById('passcode-modal-description');
      const pinInput = document.getElementById('passcode-input');
      
      if (!modal || !title || !desc || !pinInput) return;
      
      title.textContent = '🔓 輸入備份密碼還原';
      desc.textContent = '偵測到加密備份檔案。請輸入您當初設定的解密密碼以進行還原：';
      pinInput.value = '';
      modal.classList.remove('hidden');
    } catch (err) {
      alert('⚠️ 讀取備份檔案失敗：' + err.message);
    }
  };
  reader.readAsText(file);
}

// === 圓滿檢測與狀態檢查 ===
async function checkThreeYearCompletion() {
  const userId = State.currentUser;
  
  // 如果已暫時忽略過此週期的圓滿提示，則不主動彈出
  if (localStorage.getItem(`completion_modal_dismissed_${userId}`) === 'true') {
    return;
  }

  // 1. 條件一：累計日記篇數 >= 1095
  const completedCount = await DiaryDB.getCompletedDiariesCount(userId);

  // 2. 條件二：註冊/開始日期滿三年 (1095 天)
  const user = getCachedUser();
  const startDateStr = (user && user.startedAt) ? user.startedAt : (localStorage.getItem(`cycle_start_date_${userId}`) || '2024-01-01');
  const [sY, sM, sD] = startDateStr.split('-').map(Number);
  const startDate = new Date(sY, sM - 1, sD);
  const [cY, cM, cD] = State.activeDate.split('-').map(Number);
  const currentDate = new Date(cY, cM - 1, cD);
  const diffTime = currentDate - startDate;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (completedCount >= 1095 || diffDays >= 1095) {
    const modal = document.getElementById('completion-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }
}

// === 封存當前週期並開展新三年日記週期 ===
async function archiveCurrentCycle() {
  const userId = State.currentUser;
  const allDiaries = await DiaryDB.getAllDiaries(userId);
  const allMemos = await DiaryDB.getAllMemos(userId);

  // 計算日記年份區間
  const startYear = getCycleStartYear();
  const dateRange = `${startYear}-${startYear + 2}`;
  const archiveName = `${dateRange} 日記`;

  // 儲存至本地已封存檔案清單
  const archivesKey = `user_archives_${userId}`;
  let archives = [];
  try {
    archives = JSON.parse(localStorage.getItem(archivesKey) || '[]');
  } catch (e) {}

  archives.push({
    id: Date.now(),
    name: archiveName,
    dateRange: dateRange,
    diaries: allDiaries,
    memos: allMemos
  });

  localStorage.setItem(archivesKey, JSON.stringify(archives));

  // 安全清空 IndexedDB 中的 Diaries / Memos 以及 LocalStorage 的今日記錄與伴侶狀態
  await DiaryDB.clearUserData(userId);

  // 設定新週期的開始年份為當前登入日期的年份 (如 2026 年)
  const todayYear = Number(State.activeDate.split('-')[0]);
  localStorage.setItem(`cycle_start_date_${userId}`, State.activeDate);
  localStorage.setItem(`cycle_start_year_${userId}`, String(todayYear));

  // 重置該帳號的新一輪圓滿忽略標籤
  localStorage.removeItem(`completion_modal_dismissed_${userId}`);

  alert(`時光已成功封存為「${archiveName}」！\n已開啟全新的三年日記週期 (${todayYear} - ${todayYear + 2})。`);
  
  window.location.reload();
}

// === 渲染設定彈窗中的封存日記列表 ===
function renderArchivedDiariesList() {
  const container = document.getElementById('archived-diaries-list');
  if (!container) return;

  const userId = State.currentUser;
  const archivesKey = `user_archives_${userId}`;
  let archives = [];
  try {
    archives = JSON.parse(localStorage.getItem(archivesKey) || '[]');
  } catch (e) {}

  if (archives.length === 0) {
    container.textContent = '無已封存的日記。';
    return;
  }

  container.innerHTML = '';
  archives.forEach(arc => {
    const item = document.createElement('div');
    item.className = 'archive-item';
    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 6px; margin-bottom: 8px; background-color: var(--color-bg-main); box-sizing: border-box;';
    
    const label = document.createElement('span');
    label.style.fontWeight = '600';
    label.textContent = arc.name;
    
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-review-memo-trigger';
    exportBtn.style.cssText = 'background: none; border: 1px solid var(--color-border); padding: 2px 10px; border-radius: var(--radius-pill); font-size: 0.72rem; cursor: pointer; color: var(--color-text-sub); transition: var(--transition-normal);';
    exportBtn.textContent = '匯出 PDF';
    
    exportBtn.addEventListener('click', () => {
      const html = generateExportHTMLForArchive(arc);
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('請允許此網頁開啟彈出視窗以完成備份匯出。');
        return;
      }
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();

      // 預留些許時間給瀏覽器渲染
      setTimeout(() => {
        printWindow.print();
      }, 600);
    });

    item.appendChild(label);
    item.appendChild(exportBtn);
    container.appendChild(item);
  });
}

// === 基於已封存日記的 PDF 下載 HTML 生成器 ===
function generateExportHTMLForArchive(archive) {
  const years = archive.dateRange.split('-').map(Number);
  const startYear = years[0];
  const endYear = years[1] || (startYear + 2);
  const yearsArray = [];
  for (let y = startYear; y <= endYear; y++) {
    yearsArray.push(y);
  }

  // 建立 53 週日曆對照結構 (處理閏年 Feb 29 封存支援)
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const hasLeapYear = yearsArray.some(isLeap);
  const genYear = hasLeapYear ? 2024 : 2025; // 2024 is leap year, 2025 is standard
  const totalDays = hasLeapYear ? 366 : 365;

  const datesByWeek = [];
  let currentWeek = [];
  let weekIndex = 1;
  for (let d = 0; d < totalDays; d++) {
    const current = new Date(genYear, 0, 1 + d);
    const mm = current.getMonth() + 1;
    const dd = current.getDate();
    currentWeek.push({ month: mm, day: dd });
    
    if (currentWeek.length === 7 || d === (totalDays - 1)) {
      datesByWeek.push({
        week: weekIndex++,
        dates: currentWeek
      });
      currentWeek = [];
    }
  }

  const moodColors = {
    yellow: '#b0840c',
    green: '#3c6e47',
    blue: '#2c4d75',
    red: '#9c2424',
    black: '#333333'
  };

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  function getChineseDayOfWeek(year, month, day) {
    const d = new Date(year, month - 1, day);
    return weekdays[d.getDay()];
  }

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Archived Diary_${archive.dateRange}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=Outfit:wght@400;700&display=swap');
        body {
          font-family: 'Noto Serif TC', serif;
          color: #434343;
          margin: 40px auto;
          max-width: 800px;
          line-height: 1.6;
          padding: 0 20px;
        }
        h1, h2, h3 {
          font-family: 'Outfit', sans-serif;
          color: #111;
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
          border-bottom: 2px solid #eaeaea;
          padding-bottom: 20px;
        }
        .week-section {
          page-break-before: always;
        }
        .week-section:first-of-type {
          page-break-before: avoid;
        }
        .week-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #AB3B3A;
          border-bottom: 2px solid #AB3B3A;
          padding-bottom: 6px;
          margin-bottom: 20px;
          font-family: 'Outfit', sans-serif;
        }
        .pdf-date-title {
          font-family: 'Outfit', sans-serif;
          font-size: 1.2rem;
          font-weight: 700;
          color: #111;
          margin-top: 24px;
          margin-bottom: 8px;
        }
        .pdf-diary-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 24px;
          table-layout: fixed;
        }
        .pdf-diary-table th, .pdf-diary-table td {
          border: 1px solid #d3d3d3;
          padding: 10px 12px;
          text-align: left;
          vertical-align: top;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .pdf-diary-table th {
          background-color: #f9f9f9;
          font-weight: 700;
          font-size: 0.88rem;
          color: #333;
          width: 33.33%;
        }
        .pdf-diary-table td {
          font-size: 0.88rem;
          line-height: 1.5;
        }
        .pdf-diary-content {
          font-family: 'Noto Serif TC', serif;
          white-space: pre-wrap;
        }
        .pdf-memo-list {
          font-family: monospace;
          font-size: 0.8rem;
          color: #555;
          margin-top: 4px;
        }
        .pdf-memo-item {
          margin-bottom: 6px;
          border-bottom: 1px dashed #eee;
          padding-bottom: 4px;
        }
        .pdf-memo-item:last-child {
          margin-bottom: 0;
          border-bottom: none;
          padding-bottom: 0;
        }
        .pdf-memo-time {
          font-weight: bold;
          color: #999;
          margin-right: 4px;
        }
        .pdf-thumbnail-grid {
          display: flex;
          gap: 6px;
          margin-top: 6px;
          flex-wrap: wrap;
        }
        .pdf-thumbnail-grid.multi-photos {
          flex-direction: row-reverse;
          justify-content: flex-start;
          max-width: 156px; /* Exactly 3 thumbnails * 48px + 2 gaps * 6px */
          margin-left: auto;
        }
        .pdf-thumbnail {
          width: 48px;
          height: 48px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid #ddd;
        }
        @media print {
          body {
            margin: 20px;
            padding: 0;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Archived Diary_${archive.dateRange}</h1>
        <p>封存時間：${new Date(archive.id).toLocaleString()}</p>
      </div>
  `;

  let totalRecords = 0;

  for (const wData of datesByWeek) {
    let weekHtml = '';
    for (const dt of wData.dates) {
      const mmStr = String(dt.month).padStart(2, '0');
      const ddStr = String(dt.day).padStart(2, '0');
      const dateStr = `${mmStr}-${ddStr}`;

      // 檢查此日期三年內是否有任何日記
      let hasAnyDiary = false;
      const dayDiaries = [];
      const dayMemos = [];
      let hasAnyMemo = false;

      for (let idx = 0; idx < yearsArray.length; idx++) {
        const year = yearsArray[idx];
        const fullDateStr = `${year}-${dateStr}`;

        // 在封存日記中搜尋
        const diary = archive.diaries.find(d => {
          const parts = d.date.split('_');
          const dStr = parts[parts.length - 1];
          return dStr === fullDateStr;
        });

        // 在封存隨筆中搜尋
        const memos = archive.memos.filter(m => m.date === fullDateStr);

        dayDiaries.push(diary);
        dayMemos.push(memos);

        if (diary && diary.content && diary.content.trim()) {
          hasAnyDiary = true;
        }
        if (memos && memos.length > 0) {
          hasAnyMemo = true;
        }
      }

      // 若三年都無日記，跳過此表格 (若三年都無日記-->刪除表格)
      if (!hasAnyDiary) continue;

      totalRecords++;

      // 構建這一天（e.g. 1/26）的表格
      let tableHtml = `
        <div class="date-container" style="page-break-inside: avoid;">
          <h3 class="pdf-date-title">${dt.month}/${dt.day}</h3>
          <table class="pdf-diary-table">
            <thead>
              <tr>
      `;

      // 1. 表頭列
      for (let idx = 0; idx < yearsArray.length; idx++) {
        const year = yearsArray[idx];
        const dayOfWeek = getChineseDayOfWeek(year, dt.month, dt.day);
        tableHtml += `<th>${year} (${dayOfWeek})</th>`;
      }
      tableHtml += `
              </tr>
            </thead>
            <tbody>
              <!-- 日記文字列 -->
              <tr>
      `;

      // 2. 日記內容列
      for (let idx = 0; idx < yearsArray.length; idx++) {
        const diary = dayDiaries[idx];
        if (diary && diary.content && diary.content.trim()) {
          const mColor = moodColors[diary.mood] || '#333333';
          tableHtml += `
            <td>
              <div class="pdf-diary-content" style="color: ${mColor}; font-weight: 500;">${escapeHtml(diary.content)}</div>
            </td>
          `;
        } else {
          tableHtml += `<td></td>`;
        }
      }
      tableHtml += `
              </tr>
      `;

      // 3. 隨筆列 (只有當這一天有任何一年的隨筆時才顯示)
      if (hasAnyMemo) {
        tableHtml += `
              <tr>
        `;
        for (let idx = 0; idx < yearsArray.length; idx++) {
          const memos = dayMemos[idx];
          if (memos && memos.length > 0) {
            tableHtml += `<td><div class="pdf-memo-list">`;
            memos.forEach(m => {
              tableHtml += `
                <div class="pdf-memo-item">
                  <span class="pdf-memo-time">${m.time}:</span>${escapeHtml(m.content)}
              `;
              if (m.images && m.images.length > 0) {
                const isMulti = m.images.length > 1;
                tableHtml += `<div class="pdf-thumbnail-grid${isMulti ? ' multi-photos' : ''}">`;
                m.images.forEach(img => {
                  const safeImg = isSafeImageUri(img) ? img : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  tableHtml += `<img src="${safeImg}" class="pdf-thumbnail">`;
                });
                tableHtml += `</div>`;
              }
              tableHtml += `</div>`;
            });
            tableHtml += `</div></td>`;
          } else {
            tableHtml += `<td></td>`;
          }
        }
        tableHtml += `
              </tr>
        `;
      }

      tableHtml += `
            </tbody>
          </table>
        </div>
      `;
      weekHtml += tableHtml;
    }

    if (weekHtml) {
      html += `
        <div class="week-section">
          <div class="week-title">${wData.dates[0].month}/${wData.dates[0].day} - ${wData.dates[wData.dates.length - 1].month}/${wData.dates[wData.dates.length - 1].day}</div>
          ${weekHtml}
        </div>
      `;
    }
  }

  if (totalRecords === 0) {
    html += `
      <div style="text-align: center; margin-top: 100px; color: #888;">
        <p>此封存中沒有任何日記與隨筆記錄。</p>
      </div>
    `;
  }

  html += `
    </body>
    </html>
  `;

  return html;
}

window.State = State;
window.PartnerService = PartnerService;
window.isDateInCurrentWeek = isDateInCurrentWeek;
window.generateExportHTML = generateExportHTML;
window.encryptData = encryptData;
window.decryptData = decryptData;
window.validateDisplayName = validateDisplayName;
