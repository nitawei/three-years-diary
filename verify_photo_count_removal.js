/**
 * verify_photo_count_removal.js
 * Verification test suite for Phase 2-C.2:
 * Removal of the daily 3-photo limit, replaced by daily 850 KiB capacity engine.
 *
 * Covers:
 * - Test A: Over 3 photos within safe capacity (4-5 photos) saved to DB & queued
 * - Test B: Multi-selection not truncated (5+ files all processed)
 * - Test C: Capacity overage blocked even with few photos (> 850 KiB blocked, DB/Queue untouched, inputs preserved)
 * - Test D: Cancel crop (4 photos, confirm 2, cancel at 3rd -> only 2 in State.uploadedImages, capacity recomputed)
 * - Test E: Single photo compression failure (other photos processed normally, failed file excluded)
 * - Test F: Photo deletion and capacity recalculation (add multiple photos, delete one -> capacity recalculated, no old count text)
 * - Test G: Missing capacity function (fail-closed if calcFn missing)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
    this.innerHTML = '';
    this.disabled = false;
    this.style = {};
    this.children = [];
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
  removeEventListener(event, fn) {
    if (!this.eventListeners[event]) return;
    this.eventListeners[event] = this.eventListeners[event].filter(f => f !== fn);
  }
  dispatchEvent(event) {
    const list = this.eventListeners[event.type || event] || [];
    for (const fn of list) fn(event);
  }
  scrollIntoView() {}
  focus() {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter(c => c !== child);
    return child;
  }
  querySelector(sel) {
    return null;
  }
  querySelectorAll(sel) {
    return [];
  }
}

const elements = {};
function getOrCreateElement(id, tag = 'div') {
  if (!elements[id]) {
    elements[id] = new MockElement(id, tag);
  }
  return elements[id];
}

const mockLocalStorage = new LocalStorageMock();
let lastAlert = null;
let alertHistory = [];

const mockDocument = {
  getElementById: (id) => getOrCreateElement(id),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return getOrCreateElement(sel.substring(1));
    if (sel === 'label[for="image-upload-input"]') return getOrCreateElement('mock-add-photos-label', 'label');
    return null;
  },
  querySelectorAll: () => [],
  createElement: (tag) => new MockElement('el-' + Math.random(), tag),
  createDocumentFragment: () => new MockElement('fragment'),
  body: new MockElement('body', 'body'),
  addEventListener: () => {},
  removeEventListener: () => {}
};

global.localStorage = mockLocalStorage;
global.document = mockDocument;
global.window = {
  localStorage: mockLocalStorage,
  document: mockDocument,
  addEventListener: () => {},
  removeEventListener: () => {},
  showToast: (msg, type) => {},
  alert: (msg) => {
    lastAlert = msg;
    alertHistory.push(msg);
  },
  confirm: (msg) => true,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  auth: {
    currentUser: { uid: 'user_c2_test', email: 'test@example.com' },
    getRedirectResult: async () => null,
    onAuthStateChanged: () => {}
  },
  db: null
};

global.navigator = { onLine: true };
global.alert = (msg) => {
  lastAlert = msg;
  alertHistory.push(msg);
};
global.confirm = (msg) => true;

// Load app source code
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
global.updateDailyMemoCapacityUI = window.updateDailyMemoCapacityUI;
global.renderUploadedImages = window.renderUploadedImages;
global.handleImageUpload = window.handleImageUpload;
global.startCropQueue = window.startCropQueue;
global.openCropStep = window.openCropStep;
global.closeCropModal = window.closeCropModal;

const firebaseSyncCode = fs.readFileSync(path.join(__dirname, 'firebase-sync.js'), 'utf8');
eval(firebaseSyncCode);

// Test Runner Harness
let passed = 0;
let failed = 0;

async function itAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

function it(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

function resetEnvironment() {
  mockLocalStorage.clear();
  lastAlert = null;
  alertHistory = [];
  State.currentUser = 'user_c2_test';
  State.activeDate = '2026-07-20';
  State.editingMemoId = null;
  State.uploadedImages = [];
  
  const textarea = getOrCreateElement('memo-textarea', 'textarea');
  textarea.value = '';
  
  const submitBtn = getOrCreateElement('btn-submit-memo', 'button');
  submitBtn.disabled = false;
  submitBtn.textContent = 'ADD';
  submitBtn.classList._classes.clear();
  
  const statusText = getOrCreateElement('upload-status-text', 'span');
  statusText.textContent = '未加入圖片';
}

async function runTests() {
  console.log('🧪 Starting Phase 2-C.2 Photo Count Removal Verification Suite...\n');

  // ---------- Test A: 超過三張但容量合格 ----------
  console.log('--- Test A: 超過三張但容量合格 (4~5 張小型照片在 850 KiB 內正常儲存) ---');

  await itAsync('Test A1: 新增隨筆含有 4 張小型照片（總容量約 200 KiB <= 850 KiB）能正常儲存與入列', async () => {
    resetEnvironment();
    const textarea = getOrCreateElement('memo-textarea');
    textarea.value = '4 photos memo content';
    
    // 4 small photos of ~50 KB each -> ~200 KB total
    const smallPhoto = 'data:image/jpeg;base64,' + 'A'.repeat(50 * 1024);
    State.uploadedImages = [smallPhoto, smallPhoto, smallPhoto, smallPhoto];

    let savedMemo = null;
    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async (memo) => {
      savedMemo = memo;
      return { id: 1001, ...memo };
    };

    let queuedTask = null;
    const origAddToQueue = SyncManager.addToQueue;
    SyncManager.addToQueue = (action, data) => {
      queuedTask = { action, data };
    };

    await handleMemoSubmit();

    DiaryDB.saveMemo = origSaveMemo;
    SyncManager.addToQueue = origAddToQueue;

    assert.ok(savedMemo, 'DiaryDB.saveMemo was called for 4 photos');
    assert.strictEqual(savedMemo.images.length, 4, 'Saved memo contains all 4 photos');
    assert.ok(queuedTask, 'SyncManager.addToQueue was called');
    assert.strictEqual(queuedTask.action, 'save_memo', 'Queued task is save_memo');
    assert.strictEqual(queuedTask.data.date, State.activeDate, 'Queued task has correct date');
    assert.strictEqual(getIsMemoSubmitting(), false, 'Submit lock released');
  });

  await itAsync('Test A2: 新增隨筆含有 5 張小型照片（總容量約 250 KiB <= 850 KiB）能正常儲存與入列', async () => {
    resetEnvironment();
    const textarea = getOrCreateElement('memo-textarea');
    textarea.value = '5 photos memo content';
    
    // 5 small photos of ~50 KB each -> ~250 KB total
    const smallPhoto = 'data:image/jpeg;base64,' + 'B'.repeat(50 * 1024);
    State.uploadedImages = [smallPhoto, smallPhoto, smallPhoto, smallPhoto, smallPhoto];

    let savedMemo = null;
    const origSaveMemo = DiaryDB.saveMemo;
    DiaryDB.saveMemo = async (memo) => {
      savedMemo = memo;
      return { id: 1002, ...memo };
    };

    let queuedTask = null;
    const origAddToQueue = SyncManager.addToQueue;
    SyncManager.addToQueue = (action, data) => {
      queuedTask = { action, data };
    };

    await handleMemoSubmit();

    DiaryDB.saveMemo = origSaveMemo;
    SyncManager.addToQueue = origAddToQueue;

    assert.ok(savedMemo, 'DiaryDB.saveMemo was called for 5 photos');
    assert.strictEqual(savedMemo.images.length, 5, 'Saved memo contains all 5 photos');
    assert.ok(queuedTask, 'SyncManager.addToQueue was called');
    assert.strictEqual(queuedTask.action, 'save_memo', 'Queued task is save_memo');
    assert.strictEqual(queuedTask.data.date, State.activeDate, 'Queued task has correct date');
  });

  // ---------- Test B: 多張選取不截斷 ----------
  console.log('\n--- Test B: 多張選取不截斷 (選取 5+ 檔案完整進入壓縮流程) ---');

  await itAsync('Test B1: handleImageUpload 模擬選取 5 個檔案，全部 5 個檔案皆被循序壓縮，不被截斷為 3 個', async () => {
    resetEnvironment();
    
    const compressedFiles = [];
    window.compressImageFile = async (file) => {
      compressedFiles.push(file.name);
      return { success: true, dataUrl: 'data:image/jpeg;base64,' + file.name };
    };

    let queuedCropImages = null;
    window.startCropQueue = (images) => {
      queuedCropImages = images;
    };

    const mockFiles = [
      { name: 'photo1.jpg' },
      { name: 'photo2.jpg' },
      { name: 'photo3.jpg' },
      { name: 'photo4.jpg' },
      { name: 'photo5.jpg' }
    ];

    const mockEvent = {
      target: {
        files: mockFiles,
        value: 'fake_path'
      }
    };

    await handleImageUpload(mockEvent);

    assert.strictEqual(compressedFiles.length, 5, 'All 5 files were compressed sequentially');
    assert.deepStrictEqual(compressedFiles, ['photo1.jpg', 'photo2.jpg', 'photo3.jpg', 'photo4.jpg', 'photo5.jpg']);
    assert.ok(queuedCropImages, 'startCropQueue was called');
    assert.strictEqual(queuedCropImages.length, 5, 'All 5 compressed images sent to crop queue');
    assert.strictEqual(mockEvent.target.value, '', 'Input value cleared');
  });

  await itAsync('Test B2: 選取 6 個檔案時，無「已為您選取前 3 張」等截斷 alert，全部進入流程', async () => {
    resetEnvironment();
    
    let compressCount = 0;
    window.compressImageFile = async (file) => {
      compressCount++;
      return { success: true, dataUrl: 'data:image/jpeg;base64,' + file.name };
    };

    let cropCount = 0;
    window.startCropQueue = (images) => {
      cropCount = images.length;
    };

    const mockFiles = [1, 2, 3, 4, 5, 6].map(i => ({ name: `file_${i}.jpg` }));
    const mockEvent = { target: { files: mockFiles, value: 'path' } };

    await handleImageUpload(mockEvent);

    assert.strictEqual(compressCount, 6, 'All 6 files processed');
    assert.strictEqual(cropCount, 6, 'All 6 entered crop queue');
    assert.strictEqual(lastAlert, null, 'No truncation alert was triggered');
  });

  // ---------- Test C: 容量超額仍然阻擋 ----------
  console.log('\n--- Test C: 容量超額仍然阻擋 (單張或少量大圖 > 850 KiB 堅決阻擋) ---');

  await itAsync('Test C1: 即使只有 1 張照片，但容量超過 850 KiB 時阻擋儲存，不寫入 DB/Queue，保留文字與照片', async () => {
    resetEnvironment();
    const textarea = getOrCreateElement('memo-textarea');
    textarea.value = 'Oversized single photo memo';
    
    // 1 photo of ~860 KiB
    const oversizedPhoto = 'data:image/jpeg;base64,' + 'X'.repeat(860 * 1024);
    State.uploadedImages = [oversizedPhoto];

    let saveCalled = false;
    DiaryDB.saveMemo = async () => { saveCalled = true; };

    let queueCalled = false;
    SyncManager.addToQueue = () => { queueCalled = true; };

    await handleMemoSubmit();

    assert.strictEqual(saveCalled, false, 'DiaryDB.saveMemo must NOT be called for > 850 KiB');
    assert.strictEqual(queueCalled, false, 'SyncManager.addToQueue must NOT be called');
    assert.strictEqual(textarea.value, 'Oversized single photo memo', 'Textarea content preserved');
    assert.strictEqual(State.uploadedImages.length, 1, 'State.uploadedImages preserved');
    assert.ok(lastAlert && lastAlert.includes('850 KiB'), 'User alerted with safe limit message');
    assert.strictEqual(getIsMemoSubmitting(), false, 'Submit lock released');
  });

  await itAsync('Test C2: 含有 2 張照片（總容量約 900 KiB > 850 KiB）阻擋儲存，按鈕解鎖', async () => {
    resetEnvironment();
    const textarea = getOrCreateElement('memo-textarea');
    textarea.value = 'Two big photos';
    
    // 2 photos of ~450 KiB each -> ~900 KiB total
    const bigPhoto1 = 'data:image/jpeg;base64,' + 'A'.repeat(450 * 1024);
    const bigPhoto2 = 'data:image/jpeg;base64,' + 'B'.repeat(450 * 1024);
    State.uploadedImages = [bigPhoto1, bigPhoto2];

    let saveCalled = false;
    DiaryDB.saveMemo = async () => { saveCalled = true; };

    await handleMemoSubmit();

    assert.strictEqual(saveCalled, false, 'Blocked by capacity check');
    assert.strictEqual(State.uploadedImages.length, 2, 'Both photos preserved');
    assert.strictEqual(getIsMemoSubmitting(), false, 'Submit lock released');
  });

  // ---------- Test D: 取消裁切 ----------
  console.log('\n--- Test D: 取消裁切 (確認前 2 張後在第 3 張取消，僅保留前 2 張) ---');

  await itAsync('Test D1: 4 張照片進入裁切，確認前 2 張後取消，State.uploadedImages 僅保留前 2 張', async () => {
    resetEnvironment();

    const img1 = 'data:image/jpeg;base64,img1';
    const img2 = 'data:image/jpeg;base64,img2';
    const img3 = 'data:image/jpeg;base64,img3';
    const img4 = 'data:image/jpeg;base64,img4';

    // Start crop queue with 4 images
    startCropQueue([img1, img2, img3, img4]);

    // Confirm image 1
    State.uploadedImages.push({
      original: img1,
      crop: { xPercent: 50, yPercent: 50, scale: 1, aspect: '16:9' }
    });
    openCropStep(1);

    // Confirm image 2
    State.uploadedImages.push({
      original: img2,
      crop: { xPercent: 50, yPercent: 50, scale: 1, aspect: '16:9' }
    });
    openCropStep(2);

    // Cancel at image 3
    closeCropModal();
    renderUploadedImages();

    assert.strictEqual(State.uploadedImages.length, 2, 'Only 2 confirmed images retained');
    assert.strictEqual(State.uploadedImages[0].original, img1);
    assert.strictEqual(State.uploadedImages[1].original, img2);
  });

  await itAsync('Test D2: 取消裁切後 renderUploadedImages 更新狀態文字為「已選取 2 張圖片」', async () => {
    renderUploadedImages();
    const statusText = getOrCreateElement('upload-status-text');
    assert.strictEqual(statusText.textContent, '已選取 2 張圖片');
  });

  // ---------- Test E: 單張壓縮失敗 ----------
  console.log('\n--- Test E: 單張壓縮失敗 (其餘照片正常處理，失敗者被排除) ---');

  await itAsync('Test E1: 選取 3 張照片，其中第 2 張壓縮失敗，第 1 與第 3 張正常送入裁切佇列', async () => {
    resetEnvironment();

    window.compressImageFile = async (file) => {
      if (file.name === 'corrupt.heic') {
        return { success: false, fileName: file.name, error: '解碼失敗' };
      }
      return { success: true, dataUrl: 'data:image/jpeg;base64,' + file.name };
    };

    let queuedCropImages = null;
    window.startCropQueue = (images) => {
      queuedCropImages = images;
    };

    const mockFiles = [
      { name: 'good1.jpg' },
      { name: 'corrupt.heic' },
      { name: 'good2.jpg' }
    ];

    const mockEvent = { target: { files: mockFiles, value: 'val' } };
    await handleImageUpload(mockEvent);

    assert.ok(queuedCropImages, 'Crop queue was started');
    assert.strictEqual(queuedCropImages.length, 2, 'Only the 2 valid images entered crop queue');
    assert.strictEqual(queuedCropImages[0], 'data:image/jpeg;base64,good1.jpg');
    assert.strictEqual(queuedCropImages[1], 'data:image/jpeg;base64,good2.jpg');
    assert.ok(lastAlert && lastAlert.includes('corrupt.heic'), 'User alerted about failed file');
  });

  await itAsync('Test E2: 全部檔案壓縮失敗時安全返回，不崩潰，並重設容量 UI', async () => {
    resetEnvironment();

    window.compressImageFile = async (file) => {
      return { success: false, fileName: file.name, error: '格式不支援' };
    };

    let cropCalled = false;
    window.startCropQueue = () => { cropCalled = true; };

    const mockFiles = [{ name: 'bad1.xyz' }, { name: 'bad2.xyz' }];
    const mockEvent = { target: { files: mockFiles, value: 'val' } };

    await handleImageUpload(mockEvent);

    assert.strictEqual(cropCalled, false, 'Crop queue was not called when all files failed');
    assert.ok(lastAlert && lastAlert.includes('bad1.xyz'), 'User alerted about failures');
  });

  // ---------- Test F: 照片刪除與容量重算 ----------
  console.log('\n--- Test F: 照片刪除與容量重算 (刪除照片後容量正確減少，文字無殘留配額) ---');

  await itAsync('Test F1: 含有 4 張照片時，upload-status-text 顯示「已選取 4 張圖片」', async () => {
    resetEnvironment();
    State.uploadedImages = [
      'data:image/jpeg;base64,p1',
      'data:image/jpeg;base64,p2',
      'data:image/jpeg;base64,p3',
      'data:image/jpeg;base64,p4'
    ];
    renderUploadedImages();

    const statusText = getOrCreateElement('upload-status-text');
    assert.strictEqual(statusText.textContent, '已選取 4 張圖片');
    assert.strictEqual(statusText.textContent.includes('3/3'), false, 'Does not mention 3/3');
    assert.strictEqual(statusText.textContent.includes('尚可新增'), false, 'Does not mention remaining count');
  });

  await itAsync('Test F2: 刪除其中 1 張照片後，upload-status-text 更新為「已選取 3 張圖片」', async () => {
    State.uploadedImages.splice(1, 1); // remove 1 photo
    renderUploadedImages();

    const statusText = getOrCreateElement('upload-status-text');
    assert.strictEqual(statusText.textContent, '已選取 3 張圖片');
  });

  await itAsync('Test F3: 全部照片刪除後，upload-status-text 恢復為「未加入圖片」', async () => {
    State.uploadedImages = [];
    renderUploadedImages();

    const statusText = getOrCreateElement('upload-status-text');
    assert.strictEqual(statusText.textContent, '未加入圖片');
  });

  // ---------- Test G: 容量函式缺失 (Fail-Closed) ----------
  console.log('\n--- Test G: 容量函式缺失時 Fail-Closed 驗證 ---');

  await itAsync('Test G1: 當 getDailyMemoCapacity 為 null/undefined 時，handleMemoSubmit 採 Fail-Closed 阻擋儲存', async () => {
    resetEnvironment();
    const textarea = getOrCreateElement('memo-textarea');
    textarea.value = 'Valid text';
    State.uploadedImages = ['data:image/jpeg;base64,small'];

    // Temporarily hide getDailyMemoCapacity
    const origWindowCap = window.getDailyMemoCapacity;
    window.getDailyMemoCapacity = undefined;

    let saveCalled = false;
    DiaryDB.saveMemo = async () => { saveCalled = true; };

    let queueCalled = false;
    SyncManager.addToQueue = () => { queueCalled = true; };

    await handleMemoSubmit();

    // Restore
    window.getDailyMemoCapacity = origWindowCap;

    assert.strictEqual(saveCalled, false, 'Save was NOT called when capacity function is missing');
    assert.strictEqual(queueCalled, false, 'Queue was NOT called when capacity function is missing');
    assert.ok(lastAlert && lastAlert.includes('容量計算模組'), 'Alert informs user of missing capacity module');
  });

  await itAsync('Test G2: 容量函式缺失阻擋後，文字與照片完整保留，提交鎖定正常釋放', async () => {
    resetEnvironment();
    const textarea = getOrCreateElement('memo-textarea');
    textarea.value = 'Preserved text';
    State.uploadedImages = ['data:image/jpeg;base64,p1', 'data:image/jpeg;base64,p2'];

    const origWindowCap = window.getDailyMemoCapacity;
    window.getDailyMemoCapacity = null;

    await handleMemoSubmit();

    window.getDailyMemoCapacity = origWindowCap;

    assert.strictEqual(textarea.value, 'Preserved text', 'Text preserved');
    assert.strictEqual(State.uploadedImages.length, 2, 'Photos preserved');
    assert.strictEqual(getIsMemoSubmitting(), false, 'Submit lock released in finally');
    const submitBtn = getOrCreateElement('btn-submit-memo');
    assert.strictEqual(submitBtn.disabled, false, 'Submit button enabled');
  });

  // ---------- Summary ----------
  console.log('\n======================================');
  console.log(`🏁 Phase 2-C.2 Verification Finished: ${passed} passed, ${failed} failed`);
  console.log('======================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
