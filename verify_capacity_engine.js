/**
 * verify_capacity_engine.js
 * 
 * Comprehensive test suite for Phase 2-A:
 * - Constants verification (MEMO_DAILY_SAFE_LIMIT_BYTES, FIRESTORE_DOC_MAX_BYTES, etc.)
 * - estimateMemoDocumentBytes UTF-8 exact byte calculation
 * - getDailyMemoCapacity per-user isolation, editing memo exclusion, historical exemption
 * - compressImageFile aspect-ratio scaling, sequential execution, HEIC decode error rejection
 * - handleImageUpload integration and memory safety
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Mock DOM environment
class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c),
      toggle: (c) => {
        if (this.classList._classes.has(c)) {
          this.classList._classes.delete(c);
          return false;
        } else {
          this.classList._classes.add(c);
          return true;
        }
      }
    };
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this._listeners = {};
    this.dataset = {};
    this.width = 0;
    this.height = 0;
    this._lastDraw = null;
    this._mockDataUrlLength = 0;
    this._lastQuality = null;
  }

  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== fn);
  }

  dispatchEvent(evt) {
    const list = this._listeners[evt.type] || [];
    for (const fn of list) {
      fn(evt);
    }
  }

  appendChild(child) {
    if (child.nodeType === 11) {
      for (const c of child.children) {
        c.parentElement = this;
        this.children.push(c);
      }
      child.children = [];
      return child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (this.id === id) return this;
      for (const c of this.children) {
        const found = c.querySelector(sel);
        if (found) return found;
      }
    } else if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (this.classList.contains(cls)) return this;
      for (const c of this.children) {
        const found = c.querySelector(sel);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      let match = false;
      if (sel.startsWith('.')) {
        match = node.classList && node.classList.contains(sel.slice(1));
      } else if (sel.startsWith('#')) {
        match = node.id === sel.slice(1);
      }
      if (match) results.push(node);
      for (const c of (node.children || [])) {
        check(c);
      }
    };
    for (const c of this.children) {
      check(c);
    }
    return results;
  }

  getContext(type) {
    if (type === '2d') {
      return {
        drawImage: (img, sx, sy, sw, sh) => {
          this._lastDraw = { img, sx, sy, sw, sh };
        }
      };
    }
    return null;
  }

  toDataURL(mime = 'image/jpeg', quality = 0.75) {
    this._lastQuality = quality;
    if (this._mockDataUrlGenerator) {
      return this._mockDataUrlGenerator(mime, quality);
    }
    const len = this._mockDataUrlLength || (quality < 0.70 ? 220000 : 310000);
    return 'data:' + mime + ';base64,' + 'B'.repeat(len);
  }

  focus() {}
  blur() {}
  scrollIntoView() {}
}

class MockDocumentFragment extends MockElement {
  constructor() {
    super('#document-fragment');
    this.nodeType = 11;
  }
}

class MockImage {
  constructor() {
    this.width = MockImage.defaultWidth || 1000;
    this.height = MockImage.defaultHeight || 1000;
    this._src = '';
    this.onload = null;
    this.onerror = null;
  }
  get src() { return this._src; }
  set src(val) {
    this._src = val;
    if (val === '') return;
    const shouldFail = MockImage.shouldFailOnce || (typeof MockImage.failCondition === 'function' ? MockImage.failCondition(val) : false);
    if (MockImage.shouldFailOnce) {
      MockImage.shouldFailOnce = false;
    }
    setTimeout(() => {
      if (shouldFail) {
        if (typeof this.onerror === 'function') this.onerror(new Error('Image decode error'));
      } else {
        if (typeof this.onload === 'function') this.onload();
      }
    }, 1);
  }
}
MockImage.defaultWidth = 1000;
MockImage.defaultHeight = 1000;
MockImage.shouldFailOnce = false;
MockImage.failCondition = null;

class MockFileReader {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  readAsDataURL(file) {
    setTimeout(() => {
      if (file && file._readError) {
        if (typeof this.onerror === 'function') this.onerror(new Error('FileReader disk error'));
      } else {
        const dummy = (file && file._content) ? file._content : 'data:image/jpeg;base64,' + 'A'.repeat(5000);
        if (typeof this.onload === 'function') {
          this.onload({ target: { result: dummy } });
        }
      }
    }, 1);
  }
}

// 2. Set up sandbox
const localStorageStore = {};
const elementsById = {};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Math,
  String,
  Number,
  Object,
  Array,
  JSON,
  Promise,
  Error,
  TypeError,
  Intl,
  TextEncoder: global.TextEncoder,
  unescape,
  encodeURIComponent,
  FileReader: MockFileReader,
  Image: MockImage,
  localStorage: {
    getItem: (k) => localStorageStore[k] || null,
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
  },
  document: {
    addEventListener: () => {},
    createElement: (tag) => new MockElement(tag),
    createDocumentFragment: () => new MockDocumentFragment(),
    getElementById: (id) => {
      if (!elementsById[id]) {
        elementsById[id] = new MockElement('div', id);
      }
      return elementsById[id];
    },
    querySelector: (sel) => {
      if (sel.startsWith('#')) {
        return sandbox.document.getElementById(sel.slice(1));
      }
      return null;
    },
    querySelectorAll: () => []
  },
  window: {
    location: { hash: '' },
    crypto: require('crypto').webcrypto,
    addEventListener: () => {},
    removeEventListener: () => {},
    showToast: (msg, type) => {}
  },
  navigator: { onLine: true },
  firebase: {
    firestore: {
      FieldValue: {
        serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP'
      }
    }
  },
  crypto: require('crypto').webcrypto,
  lucide: { createIcons: () => {} },
  alert: (msg) => { sandbox.lastAlert = msg; sandbox.alertHistory.push(msg); },
  confirm: () => true,
  lastAlert: null,
  alertHistory: []
};

const mockFirestoreStore = {
  diaries: {},
  memos: {},
  archives: {},
  invitations: {},
  users: {}
};
sandbox.mockFirestoreStore = mockFirestoreStore;
sandbox.onFirestoreSet = null;

sandbox.window.navigator = sandbox.navigator;
sandbox.window.firebase = sandbox.firebase;
sandbox.window.auth = {
  currentUser: { uid: 'test_uid_123', email: 'test@example.com' },
  getRedirectResult: async () => null,
  onAuthStateChanged: () => {}
};
sandbox.window.db = {
  collection: (colName) => ({
    doc: (docId) => ({
      collection: (subColName) => ({
        doc: (subDocId) => ({
          get: async () => ({
            exists: !!(mockFirestoreStore[subColName] && mockFirestoreStore[subColName][subDocId]),
            data: () => mockFirestoreStore[subColName] ? mockFirestoreStore[subColName][subDocId] : null
          }),
          set: async (data, opts) => {
            if (sandbox.onFirestoreSet) sandbox.onFirestoreSet(subColName, subDocId, data);
            if (!mockFirestoreStore[subColName]) mockFirestoreStore[subColName] = {};
            mockFirestoreStore[subColName][subDocId] = data;
            return { id: subDocId };
          },
          delete: async () => {
            if (mockFirestoreStore[subColName]) delete mockFirestoreStore[subColName][subDocId];
            return true;
          }
        })
      }),
      get: async () => ({
        exists: !!(mockFirestoreStore[colName] && mockFirestoreStore[colName][docId]),
        data: () => mockFirestoreStore[colName] ? mockFirestoreStore[colName][docId] : null
      }),
      set: async (data, opts) => {
        if (sandbox.onFirestoreSet) sandbox.onFirestoreSet(colName, docId, data);
        if (!mockFirestoreStore[colName]) mockFirestoreStore[colName] = {};
        mockFirestoreStore[colName][docId] = data;
        return { id: docId };
      }
    })
  })
};

// Compile utils.js
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

// Compile db.js
const dbCode = fs.readFileSync('db.js', 'utf8');
const runDb = new Function(...Object.keys(sandbox), dbCode + '\nreturn { DiaryDB };');
const { DiaryDB } = runDb(...Object.values(sandbox));
sandbox.DiaryDB = DiaryDB;
sandbox.TODAY_DATE_STR = '2026-07-15';

// Compile app.js
const appCode = fs.readFileSync('app.js', 'utf8').replace(/const TODAY_DATE_STR = [^;]+;/, '');
const appKeys = Object.keys(sandbox).filter(k => k !== 'SyncManager');
const appValues = appKeys.map(k => sandbox[k]);
const runApp = new Function(...appKeys, appCode + `
return {
  State,
  parseMemoImageData,
  getExistingDailyPhotoCount,
  formatMemoIndicator,
  createDiaryReviewCard,
  MEMO_DAILY_SAFE_LIMIT_BYTES,
  FIRESTORE_DOC_MAX_BYTES,
  MEMO_IMAGE_MAX_DIMENSION,
  MEMO_IMAGE_PRIMARY_QUALITY,
  MEMO_IMAGE_SECONDARY_QUALITY,
  MEMO_IMAGE_SECONDARY_THRESHOLD,
  estimateMemoDocumentBytes,
  getDailyMemoCapacity,
  compressImageFile,
  handleImageUpload,
  startCropQueue
};`);
const app = runApp(...appValues);
Object.assign(sandbox, app);

// Mirror app exports onto sandbox.window
sandbox.window.MEMO_DAILY_SAFE_LIMIT_BYTES = app.MEMO_DAILY_SAFE_LIMIT_BYTES;
sandbox.window.FIRESTORE_DOC_MAX_BYTES = app.FIRESTORE_DOC_MAX_BYTES;
sandbox.window.estimateMemoDocumentBytes = app.estimateMemoDocumentBytes;
sandbox.window.getDailyMemoCapacity = app.getDailyMemoCapacity;
sandbox.window.compressImageFile = app.compressImageFile;
sandbox.window.State = app.State;

// Compile firebase-sync.js
const syncCode = fs.readFileSync('firebase-sync.js', 'utf8').replace(/const TODAY_DATE_STR = [^;]+;/, '');
const syncKeys = Object.keys(sandbox);
const syncValues = syncKeys.map(k => sandbox[k]);
const runSync = new Function(...syncKeys, syncCode);
runSync(...syncValues);

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL: ${desc}\n`, err);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL: ${desc}\n`, err);
    failed++;
  }
}

async function runAllTests() {
  console.log('🧪 Starting Phase 2-A Capacity Engine & Image Compression Verification...\n');

  // ==========================================
  // Suite 1: Capacity & Image Constants
  // ==========================================
  console.log('--- 1. Capacity & Image Constants ---');

  it('MEMO_DAILY_SAFE_LIMIT_BYTES is exactly 870400 (850 KiB)', () => {
    assert.strictEqual(app.MEMO_DAILY_SAFE_LIMIT_BYTES, 870400);
    assert.strictEqual(app.MEMO_DAILY_SAFE_LIMIT_BYTES, 850 * 1024);
  });

  it('FIRESTORE_DOC_MAX_BYTES is exactly 1048576 (1 MiB)', () => {
    assert.strictEqual(app.FIRESTORE_DOC_MAX_BYTES, 1048576);
    assert.strictEqual(app.FIRESTORE_DOC_MAX_BYTES, 1024 * 1024);
  });

  it('Safe limit provides 178 KiB margin below Firestore physical limit', () => {
    const margin = app.FIRESTORE_DOC_MAX_BYTES - app.MEMO_DAILY_SAFE_LIMIT_BYTES;
    assert.strictEqual(margin, 178176);
    assert.strictEqual(margin / 1024, 174); // 174 KiB
  });

  it('MEMO_IMAGE_MAX_DIMENSION is 1280px', () => {
    assert.strictEqual(app.MEMO_IMAGE_MAX_DIMENSION, 1280);
  });

  it('MEMO_IMAGE_PRIMARY_QUALITY is 0.75 and SECONDARY is 0.60', () => {
    assert.strictEqual(app.MEMO_IMAGE_PRIMARY_QUALITY, 0.75);
    assert.strictEqual(app.MEMO_IMAGE_SECONDARY_QUALITY, 0.60);
  });

  it('MEMO_IMAGE_SECONDARY_THRESHOLD is 280000 characters', () => {
    assert.strictEqual(app.MEMO_IMAGE_SECONDARY_THRESHOLD, 280000);
  });

  // ==========================================
  // Suite 2: estimateMemoDocumentBytes
  // ==========================================
  console.log('\n--- 2. estimateMemoDocumentBytes ---');

  it('Returns non-zero envelope size for empty memo items', () => {
    const emptyBytes = app.estimateMemoDocumentBytes('2026-07-15', []);
    assert.ok(emptyBytes > 50 && emptyBytes < 100, `Expected ~60-80 bytes, got ${emptyBytes}`);
  });

  it('Calculates exact UTF-8 byte count for Chinese characters (3 bytes/char)', () => {
    const asciiItem = [{ id: 1, date: '2026-07-15', time: '10:00', content: 'a', images: [] }];
    const chineseItem = [{ id: 1, date: '2026-07-15', time: '10:00', content: '中', images: [] }];
    const asciiBytes = app.estimateMemoDocumentBytes('2026-07-15', asciiItem);
    const chineseBytes = app.estimateMemoDocumentBytes('2026-07-15', chineseItem);
    // '中' in UTF-8 is 3 bytes (0xE4 0xB8 0xAD); 'a' is 1 byte (0x61). Difference should be exactly 2 bytes.
    assert.strictEqual(chineseBytes - asciiBytes, 2);
  });

  it('Accurately accounts for large Base64 images in memo payload', () => {
    const dummyImage = 'data:image/jpeg;base64,' + 'X'.repeat(50000);
    const memo = [{ id: 1, date: '2026-07-15', time: '12:00', content: 'Photo memo', images: [dummyImage] }];
    const totalBytes = app.estimateMemoDocumentBytes('2026-07-15', memo);
    assert.ok(totalBytes > 50000 && totalBytes < 50500, `Expected ~50100 bytes, got ${totalBytes}`);
  });

  it('Handles null/undefined arguments gracefully without throwing', () => {
    const bytes1 = app.estimateMemoDocumentBytes(null, null);
    const bytes2 = app.estimateMemoDocumentBytes(undefined, undefined);
    assert.ok(bytes1 > 0);
    assert.ok(bytes2 > 0);
  });

  // ==========================================
  // Suite 3: getDailyMemoCapacity Core Logic
  // ==========================================
  console.log('\n--- 3. getDailyMemoCapacity Core Logic ---');

  await itAsync('User A and User B have independent capacities on the same date', async () => {
    const date = '2026-07-20';
    // Clean DB
    sandbox.localStorage.clear();
    
    // User A has 1 memo with 200KB image
    const userAImage = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
    await DiaryDB.saveMemo({ date, time: '10:00', content: 'User A memo', images: [userAImage] }, 'user_a');

    // Query capacity for User A
    const capA = await app.getDailyMemoCapacity({ date, userId: 'user_a' });
    // Query capacity for User B
    const capB = await app.getDailyMemoCapacity({ date, userId: 'user_b' });

    assert.ok(capA.existingBytes > 200000, `User A should have > 200KB, got ${capA.existingBytes}`);
    assert.strictEqual(capA.existingPhotoCount, 1);

    assert.ok(capB.existingBytes < 200, `User B should have empty envelope (< 200B), got ${capB.existingBytes}`);
    assert.strictEqual(capB.existingPhotoCount, 0);
  });

  await itAsync('Aggregates multiple memos for the same user on the same date', async () => {
    const date = '2026-07-21';
    sandbox.localStorage.clear();

    const img1 = 'data:image/jpeg;base64,' + 'M'.repeat(100000);
    const img2 = 'data:image/jpeg;base64,' + 'N'.repeat(150000);
    await DiaryDB.saveMemo({ id: 1, date, time: '09:00', content: 'Memo 1', images: [img1] }, 'user_a');
    await DiaryDB.saveMemo({ id: 2, date, time: '14:00', content: 'Memo 2', images: [img2] }, 'user_a');

    const cap = await app.getDailyMemoCapacity({ date, userId: 'user_a' });
    assert.ok(cap.existingBytes > 250000, `Aggregated bytes should be > 250KB, got ${cap.existingBytes}`);
    assert.strictEqual(cap.existingPhotoCount, 2);
  });

  await itAsync('Cross-date independence for the same user', async () => {
    const date1 = '2026-07-22';
    const date2 = '2026-07-23';
    sandbox.localStorage.clear();

    const img = 'data:image/jpeg;base64,' + 'D'.repeat(300000);
    await DiaryDB.saveMemo({ date: date1, time: '09:00', content: 'Day 1', images: [img] }, 'user_a');

    const capDay1 = await app.getDailyMemoCapacity({ date: date1, userId: 'user_a' });
    const capDay2 = await app.getDailyMemoCapacity({ date: date2, userId: 'user_a' });

    assert.ok(capDay1.existingBytes > 300000);
    assert.ok(capDay2.existingBytes < 200);
  });

  await itAsync('Editing memo exclusion: avoids double-counting the memo being edited', async () => {
    const date = '2026-07-24';
    sandbox.localStorage.clear();

    const oldImg = 'data:image/jpeg;base64,' + 'O'.repeat(200000);
    const saved = await DiaryDB.saveMemo({ date, time: '10:00', content: 'Original', images: [oldImg] }, 'user_a');
    const memoId = (typeof saved === 'object' && saved !== null) ? saved.id : saved;

    // Simulate editing memoId: new image has 250KB
    const newImg = 'data:image/jpeg;base64,' + 'P'.repeat(250000);
    const cap = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      editingMemoId: memoId,
      newPhotos: [newImg],
      newText: 'Updated content'
    });

    // otherBytes should be empty envelope (~70 bytes) since memoId was excluded
    assert.ok(cap.otherBytes < 200, `otherBytes should exclude editing memo, got ${cap.otherBytes}`);
    assert.strictEqual(cap.otherPhotoCount, 0);

    // projectedBytes should be ~250KB + envelope, NOT 200KB + 250KB = 450KB!
    assert.ok(cap.projectedBytes > 250000 && cap.projectedBytes < 260000, `projectedBytes should be ~250KB, got ${cap.projectedBytes}`);
    assert.ok(cap.deltaBytes > 45000 && cap.deltaBytes < 55000, `deltaBytes should be ~50KB, got ${cap.deltaBytes}`);
    assert.strictEqual(cap.projectedPhotoCount, 1);
  });

  await itAsync('Size reduction: deleting images releases capacity correctly', async () => {
    const date = '2026-07-25';
    sandbox.localStorage.clear();

    const oldImg1 = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
    const oldImg2 = 'data:image/jpeg;base64,' + 'B'.repeat(200000);
    const saved = await DiaryDB.saveMemo({ date, time: '10:00', content: 'Two photos', images: [oldImg1, oldImg2] }, 'user_a');
    const memoId = (typeof saved === 'object' && saved !== null) ? saved.id : saved;

    // Edit memo, removing one photo
    const cap = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      editingMemoId: memoId,
      newPhotos: [oldImg1],
      newText: 'One photo now'
    });

    assert.ok(cap.deltaBytes < -190000, `deltaBytes should be negative (~ -200KB), got ${cap.deltaBytes}`);
    assert.strictEqual(cap.isSizeDecreased, true);
    assert.strictEqual(cap.isSizeIncreased, false);
    assert.strictEqual(cap.canSave, true);
    assert.strictEqual(cap.projectedPhotoCount, 1);
  });

  await itAsync('Safe limit enforcement: allows <= 870400 bytes, blocks > 870400 bytes for new memos', async () => {
    const date = '2026-07-26';
    sandbox.localStorage.clear();

    // 1. Within safe limit (~500 KB)
    const validImg = 'data:image/jpeg;base64,' + 'V'.repeat(500000);
    const capValid = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      newPhotos: [validImg],
      newText: 'Valid size memo'
    });
    assert.strictEqual(capValid.isWithinSafeLimit, true);
    assert.strictEqual(capValid.isWithinFirestoreLimit, true);
    assert.strictEqual(capValid.canSave, true);

    // 2. Exceeding safe limit (880 KB > 850 KiB)
    const tooLargeImg = 'data:image/jpeg;base64,' + 'T'.repeat(880000);
    const capLarge = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      newPhotos: [tooLargeImg],
      newText: 'Too large memo'
    });
    assert.strictEqual(capLarge.isWithinSafeLimit, false);
    assert.strictEqual(capLarge.isWithinFirestoreLimit, true);
    assert.strictEqual(capLarge.canSave, false);
  });

  await itAsync('Historical exemption: allows editing existing > 850 KiB document if size does not increase', async () => {
    const date = '2026-07-27';
    sandbox.localStorage.clear();

    // Setup historical memo that exceeds 870400 (e.g. 900 KB)
    const histImg = 'data:image/jpeg;base64,' + 'H'.repeat(900000);
    const saved = await DiaryDB.saveMemo({ date, time: '10:00', content: 'Historical big memo', images: [histImg] }, 'user_a');
    const memoId = (typeof saved === 'object' && saved !== null) ? saved.id : saved;

    // Case A: User fixes typo, keeps same image, size decreases or stays same
    const capEditSame = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      editingMemoId: memoId,
      newPhotos: [histImg],
      newText: 'Historical fixed'
    });
    assert.strictEqual(capEditSame.isHistoricalExempt, true);
    assert.strictEqual(capEditSame.isSizeIncreased, false);
    assert.strictEqual(capEditSame.isWithinFirestoreLimit, true);
    assert.strictEqual(capEditSame.canSave, true); // ALLOWED under historical exemption

    // Case B: User tries to ADD more content to the historical big memo (size increases)
    const extraImg = 'data:image/jpeg;base64,' + 'E'.repeat(30000);
    const capEditIncrease = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      editingMemoId: memoId,
      newPhotos: [histImg, extraImg],
      newText: 'Historical added photo'
    });
    assert.strictEqual(capEditIncrease.isHistoricalExempt, true);
    assert.strictEqual(capEditIncrease.isSizeIncreased, true);
    assert.strictEqual(capEditIncrease.canSave, false); // BLOCKED because size increased beyond safe limit
  });

  await itAsync('Hard physical limit: blocks any document exceeding 1 MiB (1048576 bytes)', async () => {
    const date = '2026-07-28';
    sandbox.localStorage.clear();

    const giantImg = 'data:image/jpeg;base64,' + 'G'.repeat(1060000);
    const capGiant = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      newPhotos: [giantImg],
      newText: 'Over 1 MiB'
    });
    assert.strictEqual(capGiant.isWithinSafeLimit, false);
    assert.strictEqual(capGiant.isWithinFirestoreLimit, false);
    assert.strictEqual(capGiant.canSave, false);
  });

  await itAsync('Supports positional arguments signature interchangeably', async () => {
    const date = '2026-07-29';
    sandbox.localStorage.clear();

    const img = 'data:image/jpeg;base64,' + 'X'.repeat(50000);
    const capPositional = await app.getDailyMemoCapacity(date, 'user_a', null, [img], 'Positional text');
    const capObject = await app.getDailyMemoCapacity({
      date,
      userId: 'user_a',
      editingMemoId: null,
      newPhotos: [img],
      newText: 'Positional text'
    });

    assert.strictEqual(capPositional.projectedBytes, capObject.projectedBytes);
    assert.strictEqual(capPositional.canSave, capObject.canSave);
    assert.strictEqual(capPositional.projectedPhotoCount, 1);
  });

  await itAsync('Fail-closed on DB error: returns canSave === false and dbError === true when getMemosForDate fails', async () => {
    const origGet = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => {
      throw new Error('Simulated IndexedDB transaction abort');
    };

    try {
      const cap = await app.getDailyMemoCapacity({ date: '2026-07-29', userId: 'user_a' });
      assert.strictEqual(cap.canSave, false);
      assert.strictEqual(cap.dbError, true);
      assert.strictEqual(cap.isWithinSafeLimit, false);
      assert.ok(cap.error && cap.error.includes('Simulated IndexedDB'));
    } finally {
      DiaryDB.getMemosForDate = origGet;
    }
  });

  await itAsync('Fail-closed on missing context: returns canSave === false when UID is missing', async () => {
    const origUser = app.State.currentUser;
    app.State.currentUser = null;
    try {
      const cap = await app.getDailyMemoCapacity({ date: '2026-07-29', userId: null });
      assert.strictEqual(cap.canSave, false);
      assert.strictEqual(cap.invalidContext, true);
      assert.strictEqual(cap.isWithinSafeLimit, false);
    } finally {
      app.State.currentUser = origUser;
    }
  });

  await itAsync('Fail-closed on missing context: returns canSave === false when date is missing', async () => {
    const origDate = app.State.activeDate;
    app.State.activeDate = null;
    try {
      const cap = await app.getDailyMemoCapacity({ date: null, userId: 'user_a' });
      assert.strictEqual(cap.canSave, false);
      assert.strictEqual(cap.invalidContext, true);
      assert.strictEqual(cap.isWithinSafeLimit, false);
    } finally {
      app.State.activeDate = origDate;
    }
  });

  await itAsync('Historical exemption cannot bypass DB error or invalid context', async () => {
    const origGet = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => {
      throw new Error('Database disconnected');
    };

    try {
      const cap = await app.getDailyMemoCapacity({
        date: '2026-07-29',
        userId: 'user_a',
        editingMemoId: 101,
        newText: 'Attempted edit during DB outage'
      });
      assert.strictEqual(cap.canSave, false);
      assert.strictEqual(cap.dbError, true);
      assert.strictEqual(cap.isHistoricalExempt, false);
    } finally {
      DiaryDB.getMemosForDate = origGet;
    }
  });

  // ==========================================
  // Suite 4: compressImageFile Engine
  // ==========================================
  console.log('\n--- 4. compressImageFile Engine ---');

  await itAsync('Downscales landscape image (> 1280px) preserving aspect ratio', async () => {
    MockImage.defaultWidth = 2560;
    MockImage.defaultHeight = 1440; // 16:9

    const mockFile = { name: 'landscape.jpg' };
    const res = await app.compressImageFile(mockFile);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.fileName, 'landscape.jpg');
    assert.strictEqual(res.width, 1280);
    assert.strictEqual(res.height, 720); // 1440 * 1280 / 2560 = 720
  });

  await itAsync('Downscales portrait image (> 1280px) preserving aspect ratio', async () => {
    MockImage.defaultWidth = 1440;
    MockImage.defaultHeight = 2560; // 9:16

    const mockFile = { name: 'portrait.jpg' };
    const res = await app.compressImageFile(mockFile);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.fileName, 'portrait.jpg');
    assert.strictEqual(res.width, 720);
    assert.strictEqual(res.height, 1280); // 1440 * 1280 / 2560 = 720
  });

  await itAsync('Preserves dimensions if both width and height are <= 1280px', async () => {
    MockImage.defaultWidth = 800;
    MockImage.defaultHeight = 600;

    const mockFile = { name: 'small.jpg' };
    const res = await app.compressImageFile(mockFile);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.width, 800);
    assert.strictEqual(res.height, 600);
  });

  await itAsync('Triggers secondary compression (quality 0.60) when Base64 > 280,000 chars', async () => {
    MockImage.defaultWidth = 1280;
    MockImage.defaultHeight = 1280;

    // Configure MockElement to record quality
    let qualitiesUsed = [];
    MockElement.prototype._mockDataUrlGenerator = function(mime, q) {
      qualitiesUsed.push(q);
      if (q === 0.75) {
        return 'data:image/jpeg;base64,' + 'X'.repeat(300000); // Exceeds 280,000
      }
      return 'data:image/jpeg;base64,' + 'Y'.repeat(220000); // Compressed with 0.60
    };

    const mockFile = { name: 'photo.jpg' };
    const res = await app.compressImageFile(mockFile);

    MockElement.prototype._mockDataUrlGenerator = null; // restore

    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(qualitiesUsed, [0.75, 0.60]);
    assert.strictEqual(res.size, 220023); // 23 bytes prefix + 220,000 chars
  });

  await itAsync('HEIC / decode failure: safely rejects without returning raw data URL', async () => {
    MockImage.shouldFailOnce = true;

    const rawData = 'data:image/heic;base64,RAW_UNCOMPRESSED_HEIC_BINARY_10MB';
    const mockFile = { name: 'unsupported.heic', _content: rawData };
    const res = await app.compressImageFile(mockFile);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.fileName, 'unsupported.heic');
    assert.ok(res.error.includes('解碼失敗') || res.error.includes('格式不支援'));
    assert.strictEqual(res.dataUrl, undefined); // STRICTLY NO RAW DATA URL
  });

  await itAsync('FileReader error: safely returns success: false', async () => {
    const mockFile = { name: 'corrupted.jpg', _readError: true };
    const res = await app.compressImageFile(mockFile);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.fileName, 'corrupted.jpg');
    assert.strictEqual(res.error, '檔案讀取失敗');
  });

  await itAsync('Invalid file argument: returns success: false without throwing exception', async () => {
    const res1 = await app.compressImageFile(null);
    const res2 = await app.compressImageFile('not-a-file');

    assert.strictEqual(res1.success, false);
    assert.strictEqual(res2.success, false);
  });

  // ==========================================
  // Suite 5: handleImageUpload Flow & Memory Protection
  // ==========================================
  console.log('\n--- 5. handleImageUpload Flow & Memory Protection ---');

  await itAsync('Sequential compression: processes multiple files one by one', async () => {
    app.State.activeDate = '2026-07-30';
    app.State.currentUser = 'user_a';
    app.State.editingMemoId = null;
    app.State.uploadedImages = [];
    sandbox.State = app.State;
    sandbox.localStorage.clear();

    let startedCount = 0;
    let maxConcurrent = 0;
    let activeWorkers = 0;

    // Track concurrency in compressImageFile
    const originalCompress = app.compressImageFile;
    const testCompress = async function(file, options) {
      startedCount++;
      activeWorkers++;
      if (activeWorkers > maxConcurrent) maxConcurrent = activeWorkers;
      
      // Simulate async processing delay
      await new Promise(r => setTimeout(r, 10));
      
      activeWorkers--;
      return originalCompress(file, options);
    };
    app.compressImageFile = testCompress;
    sandbox.window.compressImageFile = testCompress;

    let cropQueueImages = null;
    const testCropQueue = function(imgs) {
      cropQueueImages = imgs;
    };
    app.startCropQueue = testCropQueue;
    sandbox.window.startCropQueue = testCropQueue;

    const mockFiles = [
      { name: 'file1.jpg' },
      { name: 'file2.jpg' },
      { name: 'file3.jpg' }
    ];

    const mockEvent = {
      target: {
        files: mockFiles,
        value: 'dummy'
      }
    };

    try {
      await app.handleImageUpload(mockEvent);

      assert.strictEqual(startedCount, 3);
      assert.strictEqual(maxConcurrent, 1, 'Max concurrent image decodings must be strictly 1 (sequential)');
      assert.ok(Array.isArray(cropQueueImages));
      assert.strictEqual(cropQueueImages.length, 3);
      assert.strictEqual(mockEvent.target.value, '');
    } finally {
      app.compressImageFile = originalCompress;
      sandbox.window.compressImageFile = originalCompress;
    }
  });

  await itAsync('Error isolation: skips failed file, alerts user, and sends valid files to crop queue', async () => {
    app.State.activeDate = '2026-07-31';
    app.State.currentUser = 'user_a';
    app.State.editingMemoId = null;
    app.State.uploadedImages = [];
    sandbox.State = app.State;
    sandbox.alertHistory = [];
    sandbox.localStorage.clear();

    // Make file2 fail decode
    MockImage.failCondition = (src) => src.includes('FAIL_ME');

    let cropQueueImages = null;
    const testCropQueue = function(imgs) {
      cropQueueImages = imgs;
    };
    app.startCropQueue = testCropQueue;
    sandbox.window.startCropQueue = testCropQueue;

    const mockFiles = [
      { name: 'good1.jpg', _content: 'data:image/jpeg;base64,GOOD1' },
      { name: 'bad2.heic', _content: 'data:image/heic;base64,FAIL_ME' },
      { name: 'good3.jpg', _content: 'data:image/jpeg;base64,GOOD3' }
    ];

    const mockEvent = {
      target: {
        files: mockFiles,
        value: 'dummy'
      }
    };

    try {
      await app.handleImageUpload(mockEvent);

      // Check alert was shown mentioning bad2.heic
      const alertMsg = sandbox.alertHistory.find(msg => msg.includes('bad2.heic'));
      assert.ok(alertMsg, 'Alert should notify user about bad2.heic');

      // Check startCropQueue only received good1 and good3
      assert.ok(Array.isArray(cropQueueImages));
      assert.strictEqual(cropQueueImages.length, 2);
    } finally {
      MockImage.failCondition = null; // restore
    }
  });

  await itAsync('All files fail: does not trigger startCropQueue with empty/invalid images', async () => {
    app.State.activeDate = '2026-08-01';
    app.State.currentUser = 'user_a';
    app.State.editingMemoId = null;
    app.State.uploadedImages = [];
    sandbox.State = app.State;
    sandbox.alertHistory = [];
    sandbox.localStorage.clear();

    MockImage.failCondition = () => true; // all fail

    let cropQueueCalled = false;
    const testCropQueue = function() {
      cropQueueCalled = true;
    };
    app.startCropQueue = testCropQueue;
    sandbox.window.startCropQueue = testCropQueue;

    const mockFiles = [
      { name: 'bad1.heic' },
      { name: 'bad2.heic' }
    ];

    const mockEvent = {
      target: {
        files: mockFiles,
        value: 'dummy'
      }
    };

    try {
      await app.handleImageUpload(mockEvent);

      assert.strictEqual(cropQueueCalled, false, 'startCropQueue must not be called when all images fail');
      assert.ok(sandbox.alertHistory.some(m => m.includes('bad1.heic') && m.includes('bad2.heic')));
    } finally {
      MockImage.failCondition = null; // restore
    }
  });

  // ==========================================
  // Suite 6: Firestore Sync & Pre-Invite Capacity Hardening
  // ==========================================
  console.log('\n--- 6. Firestore Sync & Pre-Invite Capacity Hardening ---');

  it('Traditional Chinese content uses exact UTF-8 bytes (3 bytes/char)', () => {
    const textChinese = '這是一篇繁體中文隨筆測試內容'; // 14 Chinese chars
    assert.strictEqual(textChinese.length, 14);

    const items = [{ id: 1, date: '2026-07-15', time: '10:00', content: textChinese, images: [] }];
    const bytes = sandbox.window.estimateDocumentPayloadBytes('2026-07-15', items);

    const emptyEnvelope = sandbox.window.estimateDocumentPayloadBytes('2026-07-15', [{ id: 1, date: '2026-07-15', time: '10:00', content: '', images: [] }]);
    assert.strictEqual(bytes - emptyEnvelope, 42); // 14 chars * 3 bytes/char = exactly 42 bytes
  });

  it('Payload size estimation includes outer document fields { date, items, updatedAt }', () => {
    const dateStr = '2026-07-15';
    const totalBytes = sandbox.window.estimateDocumentPayloadBytes(dateStr, []);
    // Outer structure: {"date":"2026-07-15","items":[],"updatedAt":"..."}
    assert.ok(totalBytes >= 60 && totalBytes <= 85);
  });

  await itAsync('save_memo does NOT execute .set() when payload exceeds sync threshold (1 MiB)', async () => {
    sandbox.localStorage.clear();
    sandbox.mockFirestoreStore.memos = {};
    let setCalled = false;
    sandbox.onFirestoreSet = (col, docId, data) => {
      if (col === 'memos') setCalled = true;
    };

    // Prepare a memo in DiaryDB that exceeds 1 MiB (1,048,576 bytes)
    const giantImg = 'data:image/jpeg;base64,' + 'X'.repeat(1050000);
    await DiaryDB.saveMemo({ id: 999, date: '2026-07-15', time: '12:00', content: 'Giant', images: [giantImg] }, 'test_uid_123');

    // Add save_memo task to SyncManager queue
    sandbox.window.SyncManager.saveQueue([{
      id: 'task_huge_memo',
      action: 'save_memo',
      data: { date: '2026-07-15' },
      retryCount: 0
    }]);

    await sandbox.window.SyncManager.processQueue();

    // Verify .set() was NEVER executed
    assert.strictEqual(setCalled, false, 'Firestore .set() must NOT be called when payload exceeds 1 MiB');

    // Verify task was quarantined in failed_sync_tasks with FirestorePayloadSizeLimit
    const failedTasks = sandbox.window.SyncManager.getFailedTasks();
    assert.ok(failedTasks.length > 0);
    assert.strictEqual(failedTasks[0].errorType, 'PAYLOAD_TOO_LARGE');

    sandbox.onFirestoreSet = null;
  });

  await itAsync('ensurePreInviteCloudSync rejects and aborts .set() when today memos exceed 850 KiB', async () => {
    sandbox.localStorage.clear();
    sandbox.mockFirestoreStore.memos = {};
    let memoSetCalled = false;
    sandbox.onFirestoreSet = (col, docId, data) => {
      if (col === 'memos') memoSetCalled = true;
    };

    // Add memos to TODAY_DATE_STR totaling 880 KB (> 850 KiB / 870400 bytes)
    const bigImg = 'data:image/jpeg;base64,' + 'B'.repeat(880000);
    await DiaryDB.saveMemo({ id: 1001, date: sandbox.TODAY_DATE_STR, time: '10:00', content: 'Over 850K', images: [bigImg] }, 'test_uid_123');

    let threwExpected = false;
    try {
      await sandbox.window.ensurePreInviteCloudSync('test_uid_123');
    } catch (err) {
      threwExpected = true;
      assert.strictEqual(err.name, 'MemoCapacityLimitExceeded');
    }

    assert.strictEqual(threwExpected, true, 'ensurePreInviteCloudSync must throw when payload exceeds 850 KiB');
    assert.strictEqual(memoSetCalled, false, 'Firestore memos .set() must NOT be called when capacity exceeded');

    sandbox.onFirestoreSet = null;
  });

  await itAsync('ensurePreInviteCloudSync failure causes generateInviteCode to abort without creating invite PIN', async () => {
    sandbox.localStorage.clear();
    sandbox.alertHistory = [];
    sandbox.mockFirestoreStore.invitations = {};

    // Put oversized memo
    const bigImg = 'data:image/jpeg;base64,' + 'I'.repeat(880000);
    await DiaryDB.saveMemo({ id: 1002, date: sandbox.TODAY_DATE_STR, time: '10:00', content: 'Invite test', images: [bigImg] }, 'test_uid_123');

    let inviteThrew = false;
    try {
      await sandbox.window.FirebasePartnerService.generateInviteCode('test_uid_123');
    } catch (err) {
      inviteThrew = true;
    }

    assert.strictEqual(inviteThrew, true, 'generateInviteCode must reject when pre-invite sync fails');
    // Ensure alert notified user
    assert.ok(sandbox.alertHistory.some(m => m.includes('超出') || m.includes('容量') || m.includes('失敗')));
    // Ensure no invitation PIN document was created in Firestore
    assert.strictEqual(Object.keys(sandbox.mockFirestoreStore.invitations).length, 0, 'No invite PIN should be created in Firestore');
  });

  await itAsync('Local memos in DiaryDB are fully preserved when sync fails', async () => {
    // Check that the memo still exists in DiaryDB despite sync failure
    const localMemos = await DiaryDB.getMemosForDate(sandbox.TODAY_DATE_STR, 'test_uid_123');
    assert.ok(localMemos.length > 0, 'Local memos must NOT be deleted or cleared upon sync failure');
    const memo = localMemos.find(m => m.id === 1002);
    assert.ok(memo, 'Memo 1002 must still be present in local database');
    assert.strictEqual(memo.content, 'Invite test');
  });

  console.log(`\n======================================`);
  console.log(`🏁 Verification Finished: ${passed} passed, ${failed} failed`);
  console.log(`======================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
