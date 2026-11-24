/**
 * verify_queue_and_lock.js
 * Comprehensive automated verification test suite for:
 * - Phase A: Queue failure handling, retry/backoff, quarantine, UI sync status in firebase-sync.js
 * - Phase B: Memo submit locking, button disabled state, and quota preservation in app.js
 */

const fs = require('fs');
const path = require('path');

// ==================== Mock DOM & Storage Environment ====================
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, val) {
    this.store[key] = String(val);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

class MockElement {
  constructor(id, tag = 'div') {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c),
      toggle: (c, force) => {
        if (force === true) this.classList._classes.add(c);
        else if (force === false) this.classList._classes.delete(c);
        else if (this.classList._classes.has(c)) this.classList._classes.delete(c);
        else this.classList._classes.add(c);
      }
    };
    this.eventListeners = {};
  }
  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }
  dispatchEvent(event) {
    const list = this.eventListeners[event.type || event] || [];
    for (const fn of list) fn(event);
  }
  scrollIntoView() {}
  focus() {}
  appendChild(child) { return child; }
  removeChild(child) { return child; }
}

const elements = {};
function getOrCreateElement(id, tag = 'div') {
  if (!elements[id]) {
    elements[id] = new MockElement(id, tag);
  }
  return elements[id];
}

// Setup elements
const syncIndicator = getOrCreateElement('sync-status-indicator', 'div');
const submitMemoBtn = getOrCreateElement('btn-submit-memo', 'button');
const cancelMemoBtn = getOrCreateElement('btn-cancel-memo', 'button');
const memoTextarea = getOrCreateElement('memo-textarea', 'textarea');
const memoFormTitle = getOrCreateElement('memo-form-title', 'h3');
const uploadedImagesContainer = getOrCreateElement('uploaded-images-container', 'div');
const airpodsToast = getOrCreateElement('airpods-toast', 'div');
const airpodsToastDot = getOrCreateElement('airpods-toast-dot', 'div');
const airpodsToastText = getOrCreateElement('airpods-toast-text', 'span');

const mockLocalStorage = new LocalStorageMock();

const mockDocument = {
  getElementById: (id) => elements[id] || null,
  querySelector: (sel) => {
    if (sel.startsWith('#')) return elements[sel.substring(1)] || null;
    return null;
  },
  querySelectorAll: () => [],
  createElement: (tag) => new MockElement('mock-el-' + Math.random(), tag),
  body: new MockElement('body', 'body'),
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Global environment
global.localStorage = mockLocalStorage;
global.document = mockDocument;
global.window = {
  localStorage: mockLocalStorage,
  document: mockDocument,
  addEventListener: () => {},
  removeEventListener: () => {},
  showToast: (msg, type) => {},
  alert: (msg) => {},
  confirm: (msg) => true,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  auth: {
    currentUser: { uid: 'test_uid_123', email: 'test@example.com' },
    getRedirectResult: async () => null,
    onAuthStateChanged: () => {}
  },
  db: null
};

global.navigator = {
  onLine: true
};

global.firebase = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP'
    }
  }
};

global.alert = (msg) => {};
global.confirm = (msg) => true;

// ==================== Load Source Files ====================
// 1. Utils
const utilsCode = fs.readFileSync(path.join(__dirname, 'utils.js'), 'utf8');
eval(utilsCode);

// 2. Crypto
const cryptoCode = fs.readFileSync(path.join(__dirname, 'crypto-service.js'), 'utf8');
eval(cryptoCode);

// 3. Export
const exportCode = fs.readFileSync(path.join(__dirname, 'export-service.js'), 'utf8');
eval(exportCode);

// 4. DB
const dbCode = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
eval(dbCode);

// 5. App
const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
eval(appCode);
global.State = window.State;
global.SyncManager = window.SyncManager;
global.handleMemoSubmit = window.handleMemoSubmit;
global.exitEditMode = window.exitEditMode;
global.getIsMemoSubmitting = window.getIsMemoSubmitting;
global.DiaryDB = window.DiaryDB || (typeof DiaryDB !== 'undefined' ? DiaryDB : null);

// 6. Firebase Sync
const firebaseSyncCode = fs.readFileSync(path.join(__dirname, 'firebase-sync.js'), 'utf8');
eval(firebaseSyncCode);

// ==================== Test Runner Harness ====================
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  }
}

async function it(title, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`  Exception in "${title}":`, e.message);
  }
}

// Helper to reset mocks
function resetMocks() {
  mockLocalStorage.clear();
  elements['memo-textarea'].value = '';
  elements['btn-submit-memo'].disabled = false;
  elements['btn-submit-memo'].textContent = 'ADD';
  elements['btn-submit-memo'].classList.remove('is-submitting');
  elements['btn-cancel-memo'].classList.add('hidden');
  elements['sync-status-indicator'].textContent = '';
  navigator.onLine = true;
  window.auth = { currentUser: { uid: 'test_uid_123', email: 'test@example.com' } };
  State.activeDate = '2026-07-15';
  State.currentUser = 'test_uid_123';
  State.editingMemoId = null;
  State.uploadedImages = [];
  if (window.SyncManager) {
    window.SyncManager._isProcessing = false;
    if (window.SyncManager._retryTimeout) {
      clearTimeout(window.SyncManager._retryTimeout);
      window.SyncManager._retryTimeout = null;
    }
  }
}

// Mock Firestore DB builder
function createMockFirestore(options = {}) {
  const store = {
    diaries: {},
    memos: {},
    archives: {}
  };

  return {
    _store: store,
    collection: (colName) => ({
      doc: (docId) => ({
        collection: (subColName) => ({
          doc: (subDocId) => ({
            set: async (payload, opts) => {
              if (options.shouldFail && options.shouldFail(subColName, subDocId, payload)) {
                const err = new Error(options.failMessage || 'Firestore mock network error');
                if (options.failCode) err.code = options.failCode;
                throw err;
              }
              if (!store[subColName]) store[subColName] = {};
              store[subColName][subDocId] = payload;
              return { id: subDocId };
            },
            delete: async () => {
              if (options.shouldFail && options.shouldFail(subColName, subDocId, null)) {
                throw new Error(options.failMessage || 'Firestore delete failure');
              }
              if (store[subColName]) delete store[subColName][subDocId];
              return true;
            }
          })
        }),
        set: async (payload, opts) => {
          return { id: docId };
        }
      })
    })
  };
}

// ==================== Tests Suite ====================
async function runTests() {
  console.log('🧪 Starting Phase A & B Verification Suite...\n');

  // ---------- Phase A: Queue & Error Handling Tests ----------
  console.log('--- Phase A: Queue Failure Handling & Status UI Tests ---');

  await it('Test 1: Normal sync success clears queue and updates UI to 已同步', async () => {
    resetMocks();
    window.db = createMockFirestore();

    window.SyncManager.saveQueue([
      { id: 't1', action: 'save_diary', data: { date: '2026-07-15', content: 'Sunny day', mood: 'yellow' } }
    ]);
    window.SyncManager.updateStatusUI();
    assert(syncIndicator.textContent.includes('待同步 (1)'), 'UI shows pending before sync');

    await window.SyncManager.processQueue();

    const queue = window.SyncManager.getQueue();
    assert(queue.length === 0, 'Queue is empty after successful sync');
    assert(syncIndicator.textContent === '已同步', 'UI shows 已同步 after successful sync');
    assert(window.db._store.diaries['2026-07-15'].content === 'Sunny day', 'Firestore received diary payload');
  });

  await it('Test 2: Transient network error retains task, increments retryCount, and does NOT show 已同步', async () => {
    resetMocks();
    // Simulate network error
    window.db = createMockFirestore({
      shouldFail: () => true,
      failMessage: 'Network unavailable: failed to connect to Firestore host'
    });

    window.SyncManager.saveQueue([
      { id: 't2', action: 'save_diary', data: { date: '2026-07-15', content: 'Transient test', mood: 'blue' } }
    ]);

    await window.SyncManager.processQueue();

    const queue = window.SyncManager.getQueue();
    assert(queue.length === 1, 'Task was NOT shifted from queue on transient error');
    assert(queue[0].retryCount === 1, 'retryCount incremented to 1');
    assert(typeof queue[0].lastAttempt === 'number', 'lastAttempt timestamp was recorded');
    assert(syncIndicator.textContent !== '已同步', 'UI does NOT display 已同步');
    assert(syncIndicator.textContent.includes('待同步 (1)'), 'UI displays 待同步 (1)');

    const failedTasks = window.SyncManager.getFailedTasks();
    assert(failedTasks.length === 0, 'Task is not in failed_sync_tasks yet (only 1 attempt)');
  });

  await it('Test 3: Transient timeout error retains task and recovers when network restores', async () => {
    resetMocks();
    let failFirstTime = true;
    window.db = createMockFirestore({
      shouldFail: () => failFirstTime,
      failMessage: 'Deadline exceeded (timeout)'
    });

    window.SyncManager.saveQueue([
      { id: 't3', action: 'save_diary', data: { date: '2026-07-15', content: 'Recover me', mood: 'green' } }
    ]);

    // First attempt fails
    await window.SyncManager.processQueue();
    let queue = window.SyncManager.getQueue();
    assert(queue.length === 1 && queue[0].retryCount === 1, 'First attempt failed and recorded retry');

    // Network recovers
    failFirstTime = false;
    // Clear scheduled timeout and run directly
    if (window.SyncManager._retryTimeout) {
      clearTimeout(window.SyncManager._retryTimeout);
      window.SyncManager._retryTimeout = null;
    }
    await window.SyncManager.processQueue();

    queue = window.SyncManager.getQueue();
    assert(queue.length === 0, 'Task succeeded on retry and was shifted from queue');
    assert(syncIndicator.textContent === '已同步', 'UI updated to 已同步');
    assert(window.db._store.diaries['2026-07-15'].content === 'Recover me', 'Data written to Firestore on recovery');
  });

  await it('Test 4: Memo payload > 1 MiB permanent error moves to failed_sync_tasks and unblocks queue', async () => {
    resetMocks();
    window.db = createMockFirestore();

    // Mock DiaryDB.getMemosForDate to return a huge payload (> 1 MiB / 1,048,576 bytes)
    const bigString = 'A'.repeat(1050000);
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 101, date: '2026-07-15', time: '12:00', content: bigString, images: [] }
    ];

    window.SyncManager.saveQueue([
      { id: 'huge_memo_task', action: 'save_memo', data: { date: '2026-07-15', content: 'Huge' } }
    ]);

    await window.SyncManager.processQueue();

    // Restore DiaryDB
    DiaryDB.getMemosForDate = origGetMemos;

    const queue = window.SyncManager.getQueue();
    assert(queue.length === 0, 'Main queue shifted the oversized task to prevent permanent deadlock');

    const failedTasks = window.SyncManager.getFailedTasks();
    assert(failedTasks.length === 1, 'Task moved to failed_sync_tasks quarantine');
    assert(failedTasks[0].errorType === 'PAYLOAD_TOO_LARGE', 'errorType is PAYLOAD_TOO_LARGE');
    assert(failedTasks[0].task.id === 'huge_memo_task', 'Full task preserved in failed_sync_tasks');
    assert(typeof failedTasks[0].failedAt === 'string', 'failedAt ISO timestamp is recorded');

    assert(syncIndicator.textContent.includes('同步異常'), 'UI displays 同步異常');
    assert(syncIndicator.textContent !== '已同步', 'UI does NOT display 已同步');
  });

  await it('Test 5: Storage and UI state persist across page refresh simulation', async () => {
    // Rely on previous test's failed_sync_tasks in localStorage
    const savedFailed = mockLocalStorage.getItem('failed_sync_tasks');
    assert(savedFailed !== null && JSON.parse(savedFailed).length === 1, 'failed_sync_tasks persists in localStorage');

    // Simulate page reload: update UI with existing storage
    window.SyncManager.updateStatusUI();
    assert(syncIndicator.textContent.includes('同步異常 (1)'), 'UI reflects 同步異常 (1) after simulated reload');
    assert(syncIndicator.textContent !== '已同步', 'Does NOT show 已同步 when quarantined tasks exist');
  });

  await it('Test 6: Single permanent failure does not drop or block subsequent healthy tasks', async () => {
    resetMocks();
    window.db = createMockFirestore();

    const bigString = 'X'.repeat(1050000);
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 102, date: '2026-07-15', time: '12:00', content: bigString, images: [] }
    ];

    // Queue has Task A (oversized memo) and Task B (healthy diary)
    window.SyncManager.saveQueue([
      { id: 'task_a_huge', action: 'save_memo', data: { date: '2026-07-15', content: 'Oversized' } },
      { id: 'task_b_healthy', action: 'save_diary', data: { date: '2026-07-15', content: 'Healthy diary', mood: 'green' } }
    ]);

    await window.SyncManager.processQueue();
    DiaryDB.getMemosForDate = origGetMemos;

    const queue = window.SyncManager.getQueue();
    assert(queue.length === 0, 'Main queue is now empty (Task A quarantined, Task B completed)');

    const failedTasks = window.SyncManager.getFailedTasks();
    assert(failedTasks.length === 1 && failedTasks[0].task.id === 'task_a_huge', 'Task A safely quarantined');

    assert(window.db._store.diaries['2026-07-15'].content === 'Healthy diary', 'Task B was successfully executed and NOT dropped');
    assert(syncIndicator.textContent.includes('同步異常'), 'UI shows 同步異常 due to quarantined Task A');
  });

  await it('Test 7: delete_memo failure retains task in queue on transient error', async () => {
    resetMocks();
    window.db = createMockFirestore({
      shouldFail: () => true,
      failMessage: 'Firestore delete_memo network error'
    });

    window.SyncManager.saveQueue([
      { id: 'del_memo_1', action: 'delete_memo', data: { id: 999, date: '2026-07-15' } }
    ]);

    await window.SyncManager.processQueue();

    const queue = window.SyncManager.getQueue();
    assert(queue.length === 1, 'delete_memo task is retained in queue');
    assert(queue[0].retryCount === 1, 'delete_memo retryCount incremented');
    assert(syncIndicator.textContent.includes('待同步 (1)'), 'UI shows pending');
  });

  await it('Test 8: Max retries exceeded (5 attempts) moves task to quarantine and unblocks queue', async () => {
    resetMocks();
    window.db = createMockFirestore({
      shouldFail: () => true,
      failMessage: 'Persistent service outage'
    });

    // Start with task already at retryCount 4
    window.SyncManager.saveQueue([
      { id: 'max_retry_task', action: 'save_diary', data: { date: '2026-07-15', content: 'Stuck' }, retryCount: 4 }
    ]);

    await window.SyncManager.processQueue();

    const queue = window.SyncManager.getQueue();
    assert(queue.length === 0, 'Queue unblocked after exceeding max retries');

    const failedTasks = window.SyncManager.getFailedTasks();
    assert(failedTasks.length === 1, 'Task moved to failed_sync_tasks');
    assert(failedTasks[0].errorType === 'MAX_RETRIES_EXCEEDED', 'errorType is MAX_RETRIES_EXCEEDED');
    assert(failedTasks[0].task.retryCount === 5, 'retryCount is 5');
  });

  await it('Test 9: In-flight run lock prevents concurrent re-entrant execution', async () => {
    resetMocks();
    let setCalls = 0;
    window.db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              set: async () => {
                setCalls++;
                await new Promise(r => setTimeout(r, 50));
              }
            })
          })
        })
      })
    };

    window.SyncManager.saveQueue([
      { id: 'concur_1', action: 'save_diary', data: { date: '2026-07-15', content: 'One', mood: 'none' } }
    ]);

    // Launch two processQueue calls concurrently
    const p1 = window.SyncManager.processQueue();
    const p2 = window.SyncManager.processQueue();
    await Promise.all([p1, p2]);

    assert(setCalls === 1, 'In-flight lock ensured Firestore write was only executed once');
  });

  // ---------- Phase B: Memo Submit Locking & Quota Tests ----------
  console.log('\n--- Phase B: Memo Submit Duplicate Protection & Quota Tests ---');

  await it('Test 10: Rapid double-click on #btn-submit-memo executes saveMemo only once', async () => {
    resetMocks();
    memoTextarea.value = 'Rapid double click memo';

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async (memo, uid) => {
      saveMemoCalls++;
      await new Promise(r => setTimeout(r, 50));
      return { id: 1001, ...memo };
    };

    let addToQueueCalls = 0;
    const origAddToQueue = SyncManager.addToQueue;
    SyncManager.addToQueue = function(action, data) {
      if (action === 'save_memo') addToQueueCalls++;
      return origAddToQueue.call(this, action, data);
    };

    // Trigger rapid double submit
    const call1 = handleMemoSubmit();
    const call2 = handleMemoSubmit();
    await Promise.all([call1, call2]);

    DiaryDB.saveMemo = origSaveMemo;
    SyncManager.addToQueue = origAddToQueue;

    assert(saveMemoCalls === 1, 'DiaryDB.saveMemo was called exactly once');
    assert(addToQueueCalls === 1, 'SyncManager.addToQueue was called exactly once');
  });

  await it('Test 11: Button disabled and text changes during submission, then restores in finally', async () => {
    resetMocks();
    memoTextarea.value = 'Locking button state test';

    let checkSubmittingState = false;
    let buttonWasDisabled = false;
    let buttonHadSubmittingClass = false;

    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async (memo, uid) => {
      checkSubmittingState = getIsMemoSubmitting();
      buttonWasDisabled = submitMemoBtn.disabled;
      buttonHadSubmittingClass = submitMemoBtn.classList.contains('is-submitting');
      await new Promise(r => setTimeout(r, 30));
      return { id: 1002, ...memo };
    };

    assert(submitMemoBtn.disabled === false, 'Button is initially enabled');
    assert(submitMemoBtn.textContent === 'ADD', 'Button text is initially ADD');

    await handleMemoSubmit();

    DiaryDB.saveMemo = origSaveMemo;

    assert(checkSubmittingState === true, 'getIsMemoSubmitting() was true during submission');
    assert(buttonWasDisabled === true, 'submitMemoBtn.disabled was true during submission');
    assert(buttonHadSubmittingClass === true, 'submitMemoBtn had is-submitting class during submission');

    assert(getIsMemoSubmitting() === false, 'isMemoSubmitting is reset to false after submission');
    assert(submitMemoBtn.disabled === false, 'submitMemoBtn.disabled restored to false in finally');
    assert(submitMemoBtn.classList.contains('is-submitting') === false, 'is-submitting class removed');
    assert(submitMemoBtn.textContent === 'ADD', 'submitMemoBtn text restored to ADD');
  });

  await it('Test 12: Submission failure unlocks button and resets lock in finally', async () => {
    resetMocks();
    memoTextarea.value = 'Failure unlock test';

    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async () => {
      throw new Error('Simulated database error');
    };

    await handleMemoSubmit();

    DiaryDB.saveMemo = origSaveMemo;

    assert(getIsMemoSubmitting() === false, 'isMemoSubmitting is false after exception');
    assert(submitMemoBtn.disabled === false, 'submitMemoBtn.disabled is false after exception');
    assert(submitMemoBtn.classList.contains('is-submitting') === false, 'is-submitting class removed after exception');
  });

  await it('Test 13: Validation failure returns early and unlocks button', async () => {
    resetMocks();
    memoTextarea.value = ''; // Empty content and no images
    State.uploadedImages = [];

    await handleMemoSubmit();

    assert(getIsMemoSubmitting() === false, 'isMemoSubmitting is false after empty validation failure');
    assert(submitMemoBtn.disabled === false, 'submitMemoBtn.disabled is false after validation failure');
  });

  await it('Test 14: Daily memo capacity exceeded rejects submission and restores edit button state', async () => {
    resetMocks();
    memoTextarea.value = 'Capacity test memo';
    // Provide oversized photo > 850 KiB (e.g. 860 KiB)
    State.uploadedImages = ['data:image/jpeg;base64,' + 'A'.repeat(860 * 1024)];
    State.editingMemoId = 555;
    submitMemoBtn.textContent = 'UPDATE';

    let saveCalled = false;
    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async () => {
      saveCalled = true;
    };

    let queueCalled = false;
    const origAddToQueue = SyncManager.addToQueue;
    SyncManager.addToQueue = () => {
      queueCalled = true;
    };

    await handleMemoSubmit();

    DiaryDB.saveMemo = origSaveMemo;
    SyncManager.addToQueue = origAddToQueue;

    assert(saveCalled === false, 'DiaryDB.saveMemo was NOT called when capacity exceeded');
    assert(queueCalled === false, 'SyncManager.addToQueue was NOT called when capacity exceeded');
    assert(getIsMemoSubmitting() === false, 'isMemoSubmitting is false after capacity check failure');
    assert(submitMemoBtn.disabled === false, 'submitMemoBtn.disabled restored to false');
    assert(submitMemoBtn.textContent === 'UPDATE', 'submitMemoBtn text restored to UPDATE for editing');
  });

  // ---------- Final Summary ----------
  console.log('\n======================================');
  console.log(`🏁 Verification Finished: ${passed} passed, ${failed} failed`);
  console.log('======================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
