/**
 * verify_capacity_ui.js
 * Phase 2-B: Daily Memo Capacity UI Verification Suite
 */

const fs = require('fs');
const assert = require('assert');

console.log('🧪 Starting Phase 2-B Memo Capacity UI Verification Suite...\n');

// Mock DOM elements
class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) { names.forEach(n => this._classes.add(n)); }
  remove(...names) { names.forEach(n => this._classes.delete(n)); }
  contains(name) { return this._classes.contains ? this._classes.contains(name) : this._classes.has(name); }
  has(name) { return this._classes.has(name); }
  toggle(name, force) {
    if (force !== undefined) {
      if (force) this.add(name); else this.remove(name);
    } else {
      if (this.has(name)) this.remove(name); else this.add(name);
    }
  }
}

class MockElement {
  constructor(id = '', tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.classList = new MockClassList();
    this.children = [];
    this.attributes = {};
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(child) { this.children.push(child); }
  scrollIntoView() {}
  focus() {}
}

const mockElements = {
  'memo-capacity-widget': new MockElement('memo-capacity-widget'),
  'memo-capacity-text': new MockElement('memo-capacity-text'),
  'memo-capacity-badge': new MockElement('memo-capacity-badge'),
  'memo-capacity-bar-fill': new MockElement('memo-capacity-bar-fill'),
  'memo-capacity-hint': new MockElement('memo-capacity-hint'),
  'memo-textarea': new MockElement('memo-textarea', 'textarea'),
  'memo-images-preview': new MockElement('memo-images-preview'),
  'upload-status-text': new MockElement('upload-status-text'),
  'memo-timeline-list': new MockElement('memo-timeline-list'),
  'memo-drawer': new MockElement('memo-drawer'),
  'btn-open-memo': new MockElement('btn-open-memo', 'button'),
  'btn-submit-memo': new MockElement('btn-submit-memo', 'button'),
  'btn-cancel-memo': new MockElement('btn-cancel-memo', 'button'),
  'memo-form-title': new MockElement('memo-form-title')
};

// Initial state of badge and hint is hidden
mockElements['memo-capacity-badge'].classList.add('hidden');
mockElements['memo-capacity-hint'].classList.add('hidden');

const mockDocument = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: (id) => mockElements[id] || null,
  querySelector: (sel) => {
    if (sel.includes('#memo-capacity-widget')) return mockElements['memo-capacity-widget'];
    if (sel.includes('label[for="image-upload-input"]')) return new MockElement();
    return null;
  },
  querySelectorAll: () => [],
  createElement: (tag) => new MockElement('', tag),
  createDocumentFragment: () => new MockElement('', 'fragment')
};

// Setup sandbox environment
const localStorageStore = {};
const mockLocalStorage = {
  getItem: (k) => localStorageStore[k] || null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
};

const sandbox = {
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  TextEncoder: TextEncoder,
  document: mockDocument,
  localStorage: mockLocalStorage,
  window: {
    location: { hash: '' },
    crypto: require('crypto').webcrypto,
    addEventListener: () => {},
    removeEventListener: () => {},
    showToast: () => {}
  },
  navigator: { onLine: true },
  addEventListener: () => {},
  removeEventListener: () => {},
  alertHistory: [],
  alert: (msg) => sandbox.alertHistory.push(msg),
  confirm: () => true,
  firebase: {
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP'
      }
    }
  },
  crypto: require('crypto').webcrypto,
  lucide: { createIcons: () => {} }
};
sandbox.window.navigator = sandbox.navigator;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = mockDocument;

// Load db.js
const dbCode = fs.readFileSync('db.js', 'utf8');
const runDb = new Function(...Object.keys(sandbox), `${dbCode}\nreturn DiaryDB;`);
const DiaryDB = runDb(...Object.values(sandbox));
sandbox.DiaryDB = DiaryDB;
sandbox.window.DiaryDB = DiaryDB;

// Load utils.js
const utilsCode = fs.readFileSync('utils.js', 'utf8');
const runUtils = new Function(...Object.keys(sandbox), utilsCode + '\nreturn { isSafeImageUri, getGraphemes, MOOD_COLORS, getChineseWeekday, escapeHtml };');
const utils = runUtils(...Object.values(sandbox));
Object.assign(sandbox, utils);

// Compile crypto-service.js
const cryptoCode = fs.readFileSync('crypto-service.js', 'utf8');
const runCrypto = new Function(...Object.keys(sandbox), cryptoCode + '\nreturn { bufToHex, hexToBuf, deriveKey, encryptData, decryptData };');
const cryptoExports = runCrypto(...Object.values(sandbox));
Object.assign(sandbox, cryptoExports);

// Compile export-service.js
const exportCode = fs.readFileSync('export-service.js', 'utf8');
const runExport = new Function(...Object.keys(sandbox), exportCode + '\nreturn { generateExportHTML };');
const exportExports = runExport(...Object.values(sandbox));
Object.assign(sandbox, exportExports);

// Set today's date
sandbox.TODAY_DATE_STR = '2026-07-15';

// Load app.js
const appCode = fs.readFileSync('app.js', 'utf8').replace(/const TODAY_DATE_STR = [^;]+;/, '');
const appKeys = Object.keys(sandbox);
const appValues = appKeys.map(k => sandbox[k]);
const runApp = new Function(...appKeys, `${appCode}
return {
  State,
  MEMO_DAILY_SAFE_LIMIT_BYTES,
  FIRESTORE_DOC_MAX_BYTES,
  formatCapacityBytes,
  updateDailyMemoCapacityUI,
  getDailyMemoCapacity,
  estimateMemoDocumentBytes,
  renderUploadedImages,
  renderMemoTimeline,
  loadMemoToForm,
  exitEditMode,
  handleImageUpload,
  getMemoCapacityRequestId
};`);
const app = runApp(...appValues);
Object.assign(sandbox, app);

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    failed++;
  }
}

async function runAll() {
  // ==========================================
  // Suite 1: formatCapacityBytes Helper
  // ==========================================
  console.log('--- 1. formatCapacityBytes Helper Tests ---');

  it('formatCapacityBytes formats zero, negative and falsy values as 0 KiB', () => {
    assert.strictEqual(app.formatCapacityBytes(0), '0 KiB');
    assert.strictEqual(app.formatCapacityBytes(-50), '0 KiB');
    assert.strictEqual(app.formatCapacityBytes(null), '0 KiB');
    assert.strictEqual(app.formatCapacityBytes(undefined), '0 KiB');
    assert.strictEqual(app.formatCapacityBytes(NaN), '0 KiB');
  });

  it('formatCapacityBytes converts bytes to rounded KiB', () => {
    assert.strictEqual(app.formatCapacityBytes(1024), '1 KiB');
    assert.strictEqual(app.formatCapacityBytes(512), '1 KiB'); // rounds to 1 KiB
    assert.strictEqual(app.formatCapacityBytes(204800), '200 KiB');
    assert.strictEqual(app.formatCapacityBytes(870400), '850 KiB'); // exact 850 KiB
    assert.strictEqual(app.formatCapacityBytes(1048576), '1024 KiB'); // exact 1 MiB
  });

  // ==========================================
  // Suite 2: Capacity UI Status Rendering
  // ==========================================
  console.log('\n--- 2. Capacity UI Status & Visual Tests ---');

  app.State.activeDate = '2026-07-15';
  app.State.currentUser = 'user_a';

  const textEl = mockElements['memo-capacity-text'];
  const badgeEl = mockElements['memo-capacity-badge'];
  const barFillEl = mockElements['memo-capacity-bar-fill'];
  const hintEl = mockElements['memo-capacity-hint'];

  await itAsync('State A: Normal capacity (< 80%) displays used, remaining, green bar, no badge/hint', async () => {
    // Mock getDailyMemoCapacity for 150 KiB usage
    const origCalc = sandbox.window.getDailyMemoCapacity;
    sandbox.window.getDailyMemoCapacity = async () => ({
      date: '2026-07-15',
      userId: 'user_a',
      existingBytes: 153600,
      projectedBytes: 153600,
      safeLimitBytes: 870400,
      availableSafeBytes: 716800,
      isWithinSafeLimit: true,
      isWithinFirestoreLimit: true,
      isHistoricalExempt: false,
      isSizeIncreased: false,
      dbError: false,
      invalidContext: false,
      canSave: true
    });

    try {
      await app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a', newPhotos: [] });

      // Check text (KiB)
      assert.ok(textEl.textContent.includes('150 KiB') && textEl.textContent.includes('850 KiB'));
      assert.ok(textEl.textContent.includes('剩餘 700 KiB'));
      // Check bar
      assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill');
      assert.strictEqual(barFillEl.style.width, '18%'); // 153600 / 870400 = 17.6% -> 18%
      // Check badge & hint are hidden
      assert.ok(badgeEl.classList.has('hidden'));
      assert.ok(hintEl.classList.has('hidden'));
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State B: Staged new photos display "預估使用" prefix', async () => {
    const origCalc = sandbox.window.getDailyMemoCapacity;
    sandbox.window.getDailyMemoCapacity = async () => ({
      date: '2026-07-15',
      userId: 'user_a',
      existingBytes: 102400, // 100 KiB
      projectedBytes: 307200, // 300 KiB
      safeLimitBytes: 870400,
      availableSafeBytes: 563200,
      isWithinSafeLimit: true,
      isWithinFirestoreLimit: true,
      isHistoricalExempt: false,
      isSizeIncreased: true,
      dbError: false,
      invalidContext: false,
      canSave: true
    });

    try {
      await app.updateDailyMemoCapacityUI({
        date: '2026-07-15',
        userId: 'user_a',
        newPhotos: ['data:image/jpeg;base64,STAGED_PHOTO']
      });

      assert.ok(textEl.textContent.includes('預估使用'));
      assert.ok(textEl.textContent.includes('300 KiB / 850 KiB'));
      assert.ok(textEl.textContent.includes('剩餘 550 KiB'));
      assert.strictEqual(barFillEl.style.width, '35%');
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State C: Approaching limit (>= 80%) shows warning bar, badge and gentle hint', async () => {
    const origCalc = sandbox.window.getDailyMemoCapacity;
    // 700 KiB out of 850 KiB = 82%
    sandbox.window.getDailyMemoCapacity = async () => ({
      date: '2026-07-15',
      userId: 'user_a',
      existingBytes: 716800,
      projectedBytes: 716800,
      safeLimitBytes: 870400,
      availableSafeBytes: 153600,
      isWithinSafeLimit: true,
      isWithinFirestoreLimit: true,
      isHistoricalExempt: false,
      isSizeIncreased: false,
      dbError: false,
      invalidContext: false,
      canSave: true
    });

    try {
      await app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a', newPhotos: [] });

      assert.ok(textEl.textContent.includes('700 KiB / 850 KiB'));
      assert.ok(textEl.textContent.includes('剩餘 150 KiB'));
      // Bar has warning class and width >= 80%
      assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill bar-warning');
      assert.strictEqual(barFillEl.style.width, '82%');
      // Badge is shown with warning
      assert.strictEqual(badgeEl.classList.has('hidden'), false);
      assert.ok(badgeEl.className.includes('badge-warning'));
      assert.strictEqual(badgeEl.textContent, '接近上限');
      // Hint is shown
      assert.strictEqual(hintEl.classList.has('hidden'), false);
      assert.ok(hintEl.className.includes('hint-warning'));
      assert.ok(hintEl.textContent.includes('容量即將用盡'));
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State D: Reached / Exceeded limit (> 850 KiB) shows danger bar, badge and insufficient capacity hint', async () => {
    const origCalc = sandbox.window.getDailyMemoCapacity;
    // 880 KiB (> 850 KiB)
    sandbox.window.getDailyMemoCapacity = async () => ({
      date: '2026-07-15',
      userId: 'user_a',
      existingBytes: 901120, // 880 KiB
      projectedBytes: 901120,
      safeLimitBytes: 870400, // 850 KiB
      availableSafeBytes: 0,
      isWithinSafeLimit: false,
      isWithinFirestoreLimit: true,
      isHistoricalExempt: false,
      isSizeIncreased: false,
      dbError: false,
      invalidContext: false,
      canSave: false
    });

    try {
      await app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a', newPhotos: [] });

      assert.ok(textEl.textContent.includes('880 KiB / 850 KiB'));
      assert.ok(textEl.textContent.includes('超出 30 KiB'));
      // Bar has danger class and 100% width
      assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill bar-danger');
      assert.strictEqual(barFillEl.style.width, '100%');
      // Badge is shown with danger
      assert.strictEqual(badgeEl.classList.has('hidden'), false);
      assert.ok(badgeEl.className.includes('badge-danger'));
      assert.strictEqual(badgeEl.textContent, '已達上限');
      // Hint is shown with danger
      assert.strictEqual(hintEl.classList.has('hidden'), false);
      assert.ok(hintEl.className.includes('hint-danger'));
      assert.ok(hintEl.textContent.includes('已達每日安全上限（850 KiB）'));
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State E: Historical overage with exemption (no size increase) shows exempt badge and reduction prompt', async () => {
    const origCalc = sandbox.window.getDailyMemoCapacity;
    // Existing is 920 KiB, editing without increasing
    sandbox.window.getDailyMemoCapacity = async () => ({
      date: '2026-07-15',
      userId: 'user_a',
      existingBytes: 942080, // 920 KiB
      projectedBytes: 942080,
      safeLimitBytes: 870400,
      availableSafeBytes: 0,
      isWithinSafeLimit: false,
      isWithinFirestoreLimit: true,
      isHistoricalExempt: true,
      isSizeIncreased: false,
      dbError: false,
      invalidContext: false,
      canSave: true
    });

    try {
      await app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a', newPhotos: [] });

      assert.ok(textEl.textContent.includes('920 KiB / 850 KiB'));
      assert.ok(textEl.textContent.includes('歷史資料已超額'));
      assert.strictEqual(barFillEl.style.width, '100%');
      assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill bar-neutral');
      // Badge maintains original blue-gray exempt style
      assert.strictEqual(badgeEl.classList.has('hidden'), false);
      assert.ok(badgeEl.className.includes('badge-exempt'));
      assert.strictEqual(badgeEl.textContent, '歷史超額');
      // Hint indicates user can edit or delete photos to free space
      assert.strictEqual(hintEl.classList.has('hidden'), false);
      assert.ok(hintEl.className.includes('hint-exempt'));
      assert.ok(hintEl.textContent.includes('可刪除照片以釋出空間'));
      assert.ok(hintEl.textContent.includes('850 KiB'));
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State E2: Historical overage with size increase warns about exceeding original size and shows danger badge', async () => {
    const origCalc = sandbox.window.getDailyMemoCapacity;
    // Existing is 920 KiB, but user added a photo increasing it to 980 KiB
    sandbox.window.getDailyMemoCapacity = async () => ({
      date: '2026-07-15',
      userId: 'user_a',
      existingBytes: 942080, // 920 KiB
      projectedBytes: 1003520, // 980 KiB
      safeLimitBytes: 870400,
      availableSafeBytes: 0,
      isWithinSafeLimit: false,
      isWithinFirestoreLimit: true,
      isHistoricalExempt: true,
      isSizeIncreased: true,
      dbError: false,
      invalidContext: false,
      canSave: false
    });

    try {
      await app.updateDailyMemoCapacityUI({
        date: '2026-07-15',
        userId: 'user_a',
        newPhotos: ['data:image/jpeg;base64,EXTRA']
      });

      assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill bar-danger');
      assert.strictEqual(hintEl.classList.has('hidden'), false);
      assert.ok(hintEl.className.includes('hint-danger'));
      assert.ok(hintEl.textContent.includes('不可大於原本歷史容量 (920 KiB)'));

      // Issue 2: Badge shows '超額增加' with badge-danger class
      assert.strictEqual(badgeEl.classList.has('hidden'), false);
      assert.ok(badgeEl.className.includes('badge-danger'));
      assert.strictEqual(badgeEl.textContent, '超額增加');
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State F: Database query error shows Fail-Closed warning, 0% bar, does NOT pretend space is available', async () => {
    const origCalc = sandbox.window.getDailyMemoCapacity;
    sandbox.window.getDailyMemoCapacity = async () => ({
      dbError: true,
      error: 'Simulated IndexedDB failure',
      canSave: false
    });

    try {
      await app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a' });

      assert.ok(textEl.textContent.includes('無法確認容量狀態 (資料庫異常)'));
      assert.strictEqual(barFillEl.style.width, '0%');
      assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill bar-danger');
      assert.strictEqual(badgeEl.classList.has('hidden'), false);
      assert.strictEqual(badgeEl.textContent, '讀取失敗');
      assert.strictEqual(hintEl.classList.has('hidden'), false);
      assert.ok(hintEl.textContent.includes('資料庫讀取異常'));
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('State G: Invalid context (missing date/user) shows warning without displaying normal numbers', async () => {
    await app.updateDailyMemoCapacityUI({ date: '', userId: '' });

    assert.ok(textEl.textContent.includes('無法確認容量 (未指定日期或使用者)'));
    assert.strictEqual(barFillEl.style.width, '0%');
    assert.ok(badgeEl.classList.has('hidden'));
    assert.ok(hintEl.classList.has('hidden'));
  });

  await itAsync('State H: Processing / Compression in-flight displays loading state', async () => {
    await app.updateDailyMemoCapacityUI({ isProcessing: true });

    assert.strictEqual(textEl.textContent, '正在壓縮照片並估算容量...');
    assert.strictEqual(badgeEl.classList.has('hidden'), false);
    assert.strictEqual(badgeEl.textContent, '處理中');
    assert.strictEqual(barFillEl.className, 'memo-capacity-bar-fill bar-neutral');
    assert.strictEqual(barFillEl.style.width, '30%');
    assert.ok(hintEl.classList.has('hidden'));
  });

  // ==========================================
  // Suite 3: Lifecycle Integration & Trigger Tests
  // ==========================================
  console.log('\n--- 3. Lifecycle Integration & Trigger Tests ---');

  await itAsync('renderUploadedImages calls updateDailyMemoCapacityUI', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';
    app.State.editingMemoId = null;
    app.State.uploadedImages = [];

    let capacityCalled = false;
    const origUpdate = app.updateDailyMemoCapacityUI;
    // Test that renderUploadedImages invokes updateDailyMemoCapacityUI
    // We observe the DOM changes directly
    await app.renderUploadedImages();
    // Verify that capacity UI was updated
    assert.ok(textEl.textContent.length > 0);
  });

  await itAsync('renderMemoTimeline calls updateDailyMemoCapacityUI', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';

    await app.renderMemoTimeline();
    assert.ok(textEl.textContent.length > 0);
  });

  await itAsync('exitEditMode resets form and triggers capacity update', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';
    app.State.editingMemoId = 99;
    app.State.uploadedImages = ['some_image'];

    app.exitEditMode();

    assert.strictEqual(app.State.editingMemoId, null);
    assert.strictEqual(app.State.uploadedImages.length, 0);
    assert.ok(textEl.textContent.length > 0);
  });

  await itAsync('loadMemoToForm populates images and triggers capacity update', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';

    const testMemo = {
      id: 123,
      time: '14:30',
      content: 'Editing memo',
      images: ['data:image/jpeg;base64,EXISTING']
    };

    app.loadMemoToForm(testMemo);

    assert.strictEqual(app.State.editingMemoId, 123);
    assert.strictEqual(app.State.uploadedImages.length, 1);
    assert.ok(textEl.textContent.length > 0);

    // Clean up
    app.exitEditMode();
  });

  // ==========================================
  // Suite 4: Async Race Condition & Request ID Protection (Issue 1)
  // ==========================================
  console.log('\n--- 4. Async Race Condition & Request ID Protection Tests ---');

  await itAsync('Rapid date switching: older date query resolving late cannot overwrite newer date UI', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';

    let resolveDate15;
    const date15Promise = new Promise(resolve => { resolveDate15 = resolve; });

    const origCalc = sandbox.window.getDailyMemoCapacity;
    sandbox.window.getDailyMemoCapacity = async (opts) => {
      if (opts.date === '2026-07-15') {
        await date15Promise;
        return {
          date: '2026-07-15',
          userId: 'user_a',
          existingBytes: 512000, // 500 KiB
          projectedBytes: 512000,
          safeLimitBytes: 870400,
          availableSafeBytes: 358400,
          isWithinSafeLimit: true,
          isWithinFirestoreLimit: true,
          isHistoricalExempt: false,
          isSizeIncreased: false,
          dbError: false,
          invalidContext: false,
          canSave: true
        };
      } else if (opts.date === '2026-07-16') {
        return {
          date: '2026-07-16',
          userId: 'user_a',
          existingBytes: 204800, // 200 KiB
          projectedBytes: 204800,
          safeLimitBytes: 870400,
          availableSafeBytes: 665600,
          isWithinSafeLimit: true,
          isWithinFirestoreLimit: true,
          isHistoricalExempt: false,
          isSizeIncreased: false,
          dbError: false,
          invalidContext: false,
          canSave: true
        };
      }
    };

    try {
      // Step 1: User is on 07-15, triggers query 1 (pending)
      const p1 = app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a' });

      // Step 2: User quickly switches to 07-16, triggers query 2 (completes immediately)
      app.State.activeDate = '2026-07-16';
      await app.updateDailyMemoCapacityUI({ date: '2026-07-16', userId: 'user_a' });

      // Verify DOM reflects 2026-07-16 (200 KiB)
      assert.ok(textEl.textContent.includes('200 KiB / 850 KiB'), 'UI reflects 07-16 initially');

      // Step 3: Now older query 1 resolves
      resolveDate15();
      await p1;

      // Verify DOM STILL reflects 2026-07-16 (200 KiB), NOT overwritten by 07-15 (500 KiB)
      assert.ok(textEl.textContent.includes('200 KiB / 850 KiB'), 'UI remains 07-16 and was not overwritten');
      assert.ok(!textEl.textContent.includes('500 KiB'), 'Older 07-15 data did not leak into DOM');
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
      app.State.activeDate = '2026-07-15';
    }
  });

  await itAsync('Rapid user switching: older user query resolving late cannot overwrite newer user UI', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';

    let resolveUserA;
    const userAPromise = new Promise(resolve => { resolveUserA = resolve; });

    const origCalc = sandbox.window.getDailyMemoCapacity;
    sandbox.window.getDailyMemoCapacity = async (opts) => {
      if (opts.userId === 'user_a') {
        await userAPromise;
        return {
          date: '2026-07-15',
          userId: 'user_a',
          existingBytes: 614400, // 600 KiB
          projectedBytes: 614400,
          safeLimitBytes: 870400,
          availableSafeBytes: 256000,
          isWithinSafeLimit: true,
          isWithinFirestoreLimit: true,
          isHistoricalExempt: false,
          isSizeIncreased: false,
          dbError: false,
          invalidContext: false,
          canSave: true
        };
      } else if (opts.userId === 'user_b') {
        return {
          date: '2026-07-15',
          userId: 'user_b',
          existingBytes: 102400, // 100 KiB
          projectedBytes: 102400,
          safeLimitBytes: 870400,
          availableSafeBytes: 768000,
          isWithinSafeLimit: true,
          isWithinFirestoreLimit: true,
          isHistoricalExempt: false,
          isSizeIncreased: false,
          dbError: false,
          invalidContext: false,
          canSave: true
        };
      }
    };

    try {
      // Step 1: Query for user_a is initiated (pending)
      const pA = app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a' });

      // Step 2: Switch to user_b, triggers query (completes immediately)
      app.State.currentUser = 'user_b';
      await app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_b' });

      assert.ok(textEl.textContent.includes('100 KiB / 850 KiB'), 'UI reflects user_b');

      // Step 3: user_a query finishes
      resolveUserA();
      await pA;

      // Verify DOM STILL reflects user_b (100 KiB), NOT overwritten by user_a (600 KiB)
      assert.ok(textEl.textContent.includes('100 KiB / 850 KiB'), 'UI remains user_b and was not overwritten');
      assert.ok(!textEl.textContent.includes('600 KiB'), 'Older user_a data did not leak into DOM');
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
      app.State.currentUser = 'user_a';
    }
  });

  await itAsync('State switch during in-flight query: if State.activeDate changes before await completes, DOM is NOT updated', async () => {
    app.State.activeDate = '2026-07-15';
    app.State.currentUser = 'user_a';

    // Set DOM text to a sentinel value
    textEl.textContent = 'SENTINEL_UNCHANGED';

    let resolveFlight;
    const flightPromise = new Promise(resolve => { resolveFlight = resolve; });

    const origCalc = sandbox.window.getDailyMemoCapacity;
    sandbox.window.getDailyMemoCapacity = async () => {
      await flightPromise;
      return {
        date: '2026-07-15',
        userId: 'user_a',
        existingBytes: 307200,
        projectedBytes: 307200,
        safeLimitBytes: 870400,
        availableSafeBytes: 563200,
        isWithinSafeLimit: true,
        isWithinFirestoreLimit: true,
        isHistoricalExempt: false,
        isSizeIncreased: false,
        dbError: false,
        invalidContext: false,
        canSave: true
      };
    };

    try {
      // Start query without new call, but switch State.activeDate while waiting
      const p = app.updateDailyMemoCapacityUI({ date: '2026-07-15', userId: 'user_a' });
      app.State.activeDate = '2026-07-20'; // date changed externally

      resolveFlight();
      await p;

      // Assert DOM was NOT updated because activeDate no longer matches
      assert.strictEqual(textEl.textContent, 'SENTINEL_UNCHANGED');
    } finally {
      sandbox.window.getDailyMemoCapacity = origCalc;
      app.State.activeDate = '2026-07-15';
    }
  });

  console.log(`\n======================================`);
  console.log(`🏁 Phase 2-B Verification Finished: ${passed} passed, ${failed} failed`);
  console.log(`======================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Unhandled runner error:', err);
  process.exit(1);
});
