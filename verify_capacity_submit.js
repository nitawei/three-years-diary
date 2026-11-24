/**
 * 1095 Diary — Phase 2-C.1 Verification Suite
 * 驗證 handleMemoSubmit 儲存入口之容量安全檢查
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Starting Phase 2-C.1 handleMemoSubmit Capacity Check Verification Suite...\n');

// Mock localStorage
const localStorageStore = {};
const mockLocalStorage = {
  getItem: (key) => (key in localStorageStore ? localStorageStore[key] : null),
  setItem: (key, val) => { localStorageStore[key] = String(val); },
  removeItem: (key) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
};

// Mock DOM elements
const mockElements = {};
function createMockElement(id, tagName = 'div') {
  const el = {
    id,
    tagName: tagName.toUpperCase(),
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    disabled: false,
    classList: {
      _classes: new Set(),
      add: function(c) { this._classes.add(c); el.className = Array.from(this._classes).join(' '); },
      remove: function(c) { this._classes.delete(c); el.className = Array.from(this._classes).join(' '); },
      contains: function(c) { return this._classes.has(c); },
      has: function(c) { return this._classes.has(c); }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollIntoView: () => {},
    focus: () => {},
    appendChild: (child) => child,
    removeChild: (child) => child,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  mockElements[id] = el;
  return el;
}

const mockDocument = {
  getElementById: (id) => mockElements[id] || createMockElement(id),
  createElement: (tag) => createMockElement('el_' + Math.random(), tag),
  createDocumentFragment: () => ({ appendChild: () => {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Set up UI elements used by handleMemoSubmit and capacity UI
const submitMemoBtn = createMockElement('btn-submit-memo', 'button');
submitMemoBtn.textContent = 'ADD';
const cancelMemoBtn = createMockElement('btn-cancel-memo', 'button');
const memoTextarea = createMockElement('memo-textarea', 'textarea');
const memoFormTitle = createMockElement('memo-form-title', 'div');
const memoImagesPreview = createMockElement('memo-images-preview', 'div');
const memoTimelineList = createMockElement('memo-timeline-list', 'div');
const memoCapacityWidget = createMockElement('memo-capacity-widget', 'div');
const memoCapacityText = createMockElement('memo-capacity-text', 'span');
const memoCapacityBadge = createMockElement('memo-capacity-badge', 'span');
const memoCapacityBarFill = createMockElement('memo-capacity-bar-fill', 'div');
const memoCapacityHint = createMockElement('memo-capacity-hint', 'div');

let lastAlert = null;
let alertCallCount = 0;

global.localStorage = mockLocalStorage;
global.document = mockDocument;
global.window = {
  localStorage: mockLocalStorage,
  document: mockDocument,
  addEventListener: () => {},
  removeEventListener: () => {},
  showToast: (msg, type) => {},
  alert: (msg) => { lastAlert = msg; alertCallCount++; },
  confirm: () => true,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  crypto: require('crypto').webcrypto,
  lucide: { createIcons: () => {} }
};
global.navigator = { onLine: true };
global.firebase = {
  firestore: {
    FieldValue: {
      serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP'
    }
  }
};
global.alert = (msg) => { lastAlert = msg; alertCallCount++; };
global.confirm = () => true;

// Load source files
const utilsCode = fs.readFileSync(path.join(__dirname, 'utils.js'), 'utf8');
eval(utilsCode);

const cryptoCode = fs.readFileSync(path.join(__dirname, 'crypto-service.js'), 'utf8');
eval(cryptoCode);

const exportCode = fs.readFileSync(path.join(__dirname, 'export-service.js'), 'utf8');
eval(exportCode);

const dbCode = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
eval(dbCode);
global.DiaryDB = window.DiaryDB;

const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
eval(appCode);

global.State = window.State;
global.SyncManager = window.SyncManager;
global.handleMemoSubmit = window.handleMemoSubmit;
global.exitEditMode = window.exitEditMode;
global.getIsMemoSubmitting = window.getIsMemoSubmitting;
global.getDailyMemoCapacity = window.getDailyMemoCapacity;
global.formatCapacityBytes = window.formatCapacityBytes;
global.isDateInArchivedCycle = window.isDateInArchivedCycle || (() => false);

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

function resetEnv() {
  lastAlert = null;
  alertCallCount = 0;
  mockLocalStorage.clear();
  State.activeDate = '2026-07-15';
  State.currentUser = 'user_a';
  State.editingMemoId = null;
  State.uploadedImages = [];
  memoTextarea.value = '';
  submitMemoBtn.disabled = false;
  submitMemoBtn.textContent = 'ADD';
  submitMemoBtn.classList.remove('is-submitting');
}

async function runTests() {
  console.log('--- 1. Create Memo (新增隨筆) 容量檢查測試 ---');

  await itAsync('Case 1: 新增 Memo，容量未超過 850 KiB：正常儲存寫入 IndexedDB 與 Sync Queue', async () => {
    resetEnv();
    memoTextarea.value = 'Normal memo text within capacity';
    State.uploadedImages = ['data:image/jpeg;base64,SMALL_IMAGE_1'];

    let saveMemoCalls = 0;
    let savedMemoPayload = null;
    let addToQueueCalls = 0;

    const origSaveMemo = DiaryDB.saveMemo;
    const origAddToQueue = SyncManager.addToQueue;
    DiaryDB.saveMemo = async (memo, uid) => {
      saveMemoCalls++;
      savedMemoPayload = memo;
      return 101;
    };
    SyncManager.addToQueue = (action, data) => {
      if (action === 'save_memo') addToQueueCalls++;
      return origAddToQueue.call(SyncManager, action, data);
    };

    try {
      await handleMemoSubmit();

      assert.strictEqual(saveMemoCalls, 1, 'DiaryDB.saveMemo 應被呼叫 1 次');
      assert.strictEqual(addToQueueCalls, 1, 'SyncManager.addToQueue 應被呼叫 1 次');
      assert.strictEqual(savedMemoPayload.content, 'Normal memo text within capacity');
      assert.strictEqual(getIsMemoSubmitting(), false, '提交鎖應已釋放');
      assert.strictEqual(submitMemoBtn.disabled, false, '按鈕應已啟用');
      assert.strictEqual(submitMemoBtn.textContent, 'ADD');
      assert.strictEqual(memoTextarea.value, '', '成功儲存後輸入框應清空');
      assert.strictEqual(State.uploadedImages.length, 0, '成功儲存後照片暫存應清空');
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      SyncManager.addToQueue = origAddToQueue;
    }
  });

  await itAsync('Case 2: 新增 Memo，容量超過 850 KiB：阻擋儲存，不寫入 IndexedDB，不加入 Sync Queue', async () => {
    resetEnv();
    memoTextarea.value = 'Huge memo text exceeding safe limit';
    // Simulate oversized photo (~860 KiB)
    State.uploadedImages = ['data:image/jpeg;base64,' + 'A'.repeat(880000)];

    let saveMemoCalls = 0;
    let addToQueueCalls = 0;

    const origSaveMemo = DiaryDB.saveMemo;
    const origAddToQueue = SyncManager.addToQueue;
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };
    SyncManager.addToQueue = (action, data) => {
      if (action === 'save_memo') addToQueueCalls++;
      return origAddToQueue.call(SyncManager, action, data);
    };

    try {
      await handleMemoSubmit();

      assert.strictEqual(saveMemoCalls, 0, '容量超額時 DiaryDB.saveMemo 絕不可被呼叫');
      assert.strictEqual(addToQueueCalls, 0, '容量超額時 SyncManager.addToQueue 絕不可被呼叫');
      assert.ok(lastAlert && lastAlert.includes('850 KiB'), '應向使用者顯示 850 KiB 超額提示');
      // 驗證使用者輸入保留
      assert.strictEqual(memoTextarea.value, 'Huge memo text exceeding safe limit', '文字內容應保留供使用者修改');
      assert.strictEqual(State.uploadedImages.length, 1, '照片暫存應保留');
      // 驗證提交鎖正常釋放
      assert.strictEqual(getIsMemoSubmitting(), false, '提交鎖應已解除');
      assert.strictEqual(submitMemoBtn.disabled, false, '按鈕應恢復可點擊狀態');
      assert.strictEqual(submitMemoBtn.textContent, 'ADD');
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      SyncManager.addToQueue = origAddToQueue;
    }
  });

  console.log('\n--- 2. Edit Memo (編輯隨筆) 容量檢查測試 ---');

  await itAsync('Case 3: 編輯 Memo，容量未超過上限：正常更新原 Memo', async () => {
    resetEnv();
    State.editingMemoId = 202;
    submitMemoBtn.textContent = 'UPDATE';
    memoTextarea.value = 'Updated memo text within capacity';
    State.uploadedImages = ['data:image/jpeg;base64,NEW_PHOTO'];

    let saveMemoCalls = 0;
    let savedMemoPayload = null;
    let addToQueueCalls = 0;

    const origSaveMemo = DiaryDB.saveMemo;
    const origAddToQueue = SyncManager.addToQueue;
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 202, date: '2026-07-15', time: '10:00', content: 'Old memo', images: [] }
    ];
    DiaryDB.saveMemo = async (memo) => {
      saveMemoCalls++;
      savedMemoPayload = memo;
      return memo.id;
    };
    SyncManager.addToQueue = (action, data) => {
      if (action === 'save_memo') addToQueueCalls++;
      return origAddToQueue.call(SyncManager, action, data);
    };

    try {
      await handleMemoSubmit();

      assert.strictEqual(saveMemoCalls, 1, 'DiaryDB.saveMemo 應被呼叫 1 次');
      assert.strictEqual(savedMemoPayload.id, 202, '應維持原 Memo ID');
      assert.strictEqual(savedMemoPayload.time, '10:00', '應維持原發布時間戳');
      assert.strictEqual(addToQueueCalls, 1, 'SyncManager.addToQueue 應被呼叫 1 次');
      assert.strictEqual(getIsMemoSubmitting(), false);
      assert.strictEqual(submitMemoBtn.disabled, false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      SyncManager.addToQueue = origAddToQueue;
      DiaryDB.getMemosForDate = origGetMemos;
    }
  });

  await itAsync('Case 4: 編輯 Memo，容量增加並超過安全上限：阻擋儲存，原資料保持不變', async () => {
    resetEnv();
    State.editingMemoId = 303;
    submitMemoBtn.textContent = 'UPDATE';
    memoTextarea.value = 'Editing to huge size';
    State.uploadedImages = ['data:image/jpeg;base64,' + 'B'.repeat(880000)];

    let saveMemoCalls = 0;
    let addToQueueCalls = 0;

    const origSaveMemo = DiaryDB.saveMemo;
    const origAddToQueue = SyncManager.addToQueue;
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 303, date: '2026-07-15', time: '11:00', content: 'Small orig', images: ['small_img'] }
    ];
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };
    SyncManager.addToQueue = (action, data) => {
      if (action === 'save_memo') addToQueueCalls++;
      return origAddToQueue.call(SyncManager, action, data);
    };

    try {
      await handleMemoSubmit();

      assert.strictEqual(saveMemoCalls, 0, '編輯超額時不得呼叫 saveMemo');
      assert.strictEqual(addToQueueCalls, 0, '編輯超額時不得加入 SyncQueue');
      assert.ok(lastAlert && lastAlert.includes('850 KiB'));
      // 驗證編輯表單狀態維持
      assert.strictEqual(State.editingMemoId, 303, '應維持在編輯狀態');
      assert.strictEqual(memoTextarea.value, 'Editing to huge size', '文字保留');
      assert.strictEqual(State.uploadedImages.length, 1, '照片保留');
      assert.strictEqual(submitMemoBtn.disabled, false, '按鈕恢復');
      assert.strictEqual(submitMemoBtn.textContent, 'UPDATE', '按鈕文字應維持 UPDATE');
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      SyncManager.addToQueue = origAddToQueue;
      DiaryDB.getMemosForDate = origGetMemos;
    }
  });

  console.log('\n--- 3. 歷史超額豁免與邊界測試 ---');

  await itAsync('Case 5: 歷史超額資料縮減容量：允許儲存', async () => {
    resetEnv();
    State.editingMemoId = 404;
    submitMemoBtn.textContent = 'UPDATE';
    memoTextarea.value = 'Reduced content';
    // Original had ~900 KiB, updated has ~870 KiB (reduced)
    State.uploadedImages = ['data:image/jpeg;base64,' + 'C'.repeat(870000)];

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 404, date: '2026-07-15', time: '09:00', content: 'Huge original', images: ['data:image/jpeg;base64,' + 'C'.repeat(920000)] }
    ];
    DiaryDB.saveMemo = async () => { saveMemoCalls++; return 404; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 1, '歷史超額且縮減容量應允許儲存');
      assert.strictEqual(getIsMemoSubmitting(), false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      DiaryDB.getMemosForDate = origGetMemos;
    }
  });

  await itAsync('Case 6: 歷史超額資料不增加容量：允許儲存', async () => {
    resetEnv();
    State.editingMemoId = 405;
    submitMemoBtn.textContent = 'UPDATE';
    memoTextarea.value = 'Identical size content';
    State.uploadedImages = ['data:image/jpeg;base64,' + 'D'.repeat(890000)];

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 405, date: '2026-07-15', time: '09:00', content: 'Identical size content', images: ['data:image/jpeg;base64,' + 'D'.repeat(890000)] }
    ];
    DiaryDB.saveMemo = async () => { saveMemoCalls++; return 405; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 1, '歷史超額且容量不變應允許儲存');
      assert.strictEqual(getIsMemoSubmitting(), false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      DiaryDB.getMemosForDate = origGetMemos;
    }
  });

  await itAsync('Case 7: 歷史超額資料增加容量：阻擋儲存並提示原歷史容量', async () => {
    resetEnv();
    State.editingMemoId = 406;
    submitMemoBtn.textContent = 'UPDATE';
    memoTextarea.value = 'Increased content';
    // Original had ~890 KiB, updated has ~950 KiB (increased)
    State.uploadedImages = ['data:image/jpeg;base64,' + 'E'.repeat(950000)];

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    const origGetMemos = DiaryDB.getMemosForDate;
    DiaryDB.getMemosForDate = async () => [
      { id: 406, date: '2026-07-15', time: '09:00', content: 'Original', images: ['data:image/jpeg;base64,' + 'E'.repeat(890000)] }
    ];
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 0, '歷史超額且容量增加必須阻擋儲存');
      assert.ok(lastAlert && lastAlert.includes('不可大於原本歷史容量'), '應提示修改後不可大於原歷史容量');
      assert.strictEqual(getIsMemoSubmitting(), false);
      assert.strictEqual(submitMemoBtn.disabled, false);
      assert.strictEqual(submitMemoBtn.textContent, 'UPDATE');
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      DiaryDB.getMemosForDate = origGetMemos;
    }
  });

  await itAsync('Case 8: 預估容量超過 1 MiB：一律強制阻擋儲存', async () => {
    resetEnv();
    memoTextarea.value = 'Exceeds 1 MiB';
    State.uploadedImages = ['data:image/jpeg;base64,' + 'F'.repeat(1060000)];

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 0, '超過 1 MiB 必須被阻擋');
      assert.ok(lastAlert && lastAlert.includes('Firestore 單文件硬限制 (1 MiB)'), '應提示超過 1 MiB 硬限制');
      assert.strictEqual(getIsMemoSubmitting(), false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
    }
  });

  console.log('\n--- 4. 例外與 Fail-Closed 異常處理測試 ---');

  await itAsync('Case 9: DB 查詢失敗：Fail-Closed 立即中止儲存', async () => {
    resetEnv();
    memoTextarea.value = 'DB query error test';
    State.uploadedImages = [];

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    const origGetMemos = DiaryDB.getMemosForDate;
    // Mock getMemosForDate throwing inside getDailyMemoCapacity
    DiaryDB.getMemosForDate = async () => { throw new Error('Simulated IndexedDB failure'); };
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 0, 'DB 查詢異常時必須 Fail-Closed 阻擋寫入');
      assert.ok(lastAlert && lastAlert.includes('資料庫讀取異常'), '應提示資料庫異常');
      assert.strictEqual(getIsMemoSubmitting(), false);
      assert.strictEqual(submitMemoBtn.disabled, false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      DiaryDB.getMemosForDate = origGetMemos;
    }
  });

  await itAsync('Case 10: 無效 UID 或日期 (invalidContext)：Fail-Closed 立即中止儲存', async () => {
    resetEnv();
    memoTextarea.value = 'Invalid context test';

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    const origCalc = window.getDailyMemoCapacity;
    window.getDailyMemoCapacity = async () => ({
      invalidContext: true,
      canSave: false
    });
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 0, '無效上下文時不得寫入');
      assert.ok(lastAlert && lastAlert.includes('未指定日期/使用者'), '應提示未指定日期/使用者');
      assert.strictEqual(getIsMemoSubmitting(), false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      window.getDailyMemoCapacity = origCalc;
    }
  });

  await itAsync('Case 11: 容量檢查發生例外 throw：中止儲存，不吞掉例外放行', async () => {
    resetEnv();
    memoTextarea.value = 'Capacity check throw test';

    let saveMemoCalls = 0;
    const origSaveMemo = DiaryDB.saveMemo;
    const origCalc = window.getDailyMemoCapacity;
    window.getDailyMemoCapacity = async () => {
      throw new Error('Unexpected capacity engine error');
    };
    DiaryDB.saveMemo = async () => { saveMemoCalls++; };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 0, '容量驗證 throw 時絕不得繼續執行儲存');
      assert.ok(lastAlert && lastAlert.includes('容量驗證失敗'), '應提示容量驗證失敗');
      assert.strictEqual(getIsMemoSubmitting(), false);
      assert.strictEqual(submitMemoBtn.disabled, false);
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
      window.getDailyMemoCapacity = origCalc;
    }
  });

  console.log('\n--- 5. 互動體驗與二次提交測試 ---');

  await itAsync('Case 12: 阻擋後文字及照片仍保留，提交鎖正常釋放', async () => {
    resetEnv();
    const testContent = 'Keep my text intact after block!';
    const testPhoto = 'data:image/jpeg;base64,' + 'X'.repeat(880000);
    memoTextarea.value = testContent;
    State.uploadedImages = [testPhoto];

    await handleMemoSubmit();

    // 驗證內容完整無損
    assert.strictEqual(memoTextarea.value, testContent, '輸入框文字不應被清空');
    assert.strictEqual(State.uploadedImages.length, 1, '照片暫存不應被清空');
    assert.strictEqual(State.uploadedImages[0], testPhoto);
    // 驗證鎖定與按鈕已恢復
    assert.strictEqual(getIsMemoSubmitting(), false, '提交鎖已釋放');
    assert.strictEqual(submitMemoBtn.disabled, false, '按鈕已可點擊');
  });

  await itAsync('Case 13: 容量阻擋後使用者刪減內容，再次提交可以成功', async () => {
    resetEnv();
    // Step 1: 第一次提交超額
    memoTextarea.value = 'First oversized attempt';
    State.uploadedImages = ['data:image/jpeg;base64,' + 'Y'.repeat(880000)];

    let saveMemoCalls = 0;
    let savedPayload = null;
    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async (memo) => {
      saveMemoCalls++;
      savedPayload = memo;
      return 888;
    };

    try {
      await handleMemoSubmit();
      assert.strictEqual(saveMemoCalls, 0, '第 1 次超額應被阻擋');
      assert.strictEqual(getIsMemoSubmitting(), false, '第 1 次阻擋後解鎖');

      // Step 2: 使用者將照片刪減為合規尺寸
      State.uploadedImages = ['data:image/jpeg;base64,SMALL_RECOVERED_PHOTO'];
      memoTextarea.value = 'Second compliant attempt';

      // Step 3: 第二次提交
      await handleMemoSubmit();

      assert.strictEqual(saveMemoCalls, 1, '第 2 次修改後應成功儲存');
      assert.strictEqual(savedPayload.content, 'Second compliant attempt');
      assert.strictEqual(savedPayload.images[0], 'data:image/jpeg;base64,SMALL_RECOVERED_PHOTO');
      assert.strictEqual(getIsMemoSubmitting(), false, '第 2 次成功後解鎖');
      assert.strictEqual(memoTextarea.value, '', '成功後輸入框正常清空');
      assert.strictEqual(State.uploadedImages.length, 0, '成功後照片暫存清空');
    } finally {
      DiaryDB.saveMemo = origSaveMemo;
    }
  });

  console.log(`\n======================================`);
  console.log(`🏁 Phase 2-C.1 Verification Finished: ${passed} passed, ${failed} failed`);
  console.log(`======================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled runner error:', err);
  process.exit(1);
});
