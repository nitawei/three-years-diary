/**
 * verify_phase_d_multi_cycle_archive.js
 * Test runner specifically for asserting Phase D Multi-Cycle Archive and New 3-Year Cycle rules.
 * Run with: node verify_phase_d_multi_cycle_archive.js
 */

const fs = require('fs');

// ==================== BROWSER SANDBOX MOCK ENVIRONMENT ====================
const localStorageStore = {};
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
  localStorage: {
    getItem(key) { return localStorageStore[key] || null; },
    setItem(key, value) { localStorageStore[key] = String(value); },
    removeItem(key) { delete localStorageStore[key]; },
    clear() { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
    get length() { return Object.keys(localStorageStore).length; },
    key(index) { return Object.keys(localStorageStore)[index] || null; }
  },
  indexedDB: {
    open() {
      return {
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null
      };
    }
  },
  document: {
    addEventListener: () => {},
    getElementById: (id) => {
      // Mock basic elements needed by app.js functions
      const mockEl = {
        id,
        value: '',
        placeholder: '',
        readOnly: false,
        disabled: false,
        textContent: '',
        innerHTML: '',
        classList: {
          add(cls) { mockEl.classes.add(cls); },
          remove(cls) { mockEl.classes.delete(cls); },
          contains(cls) { return mockEl.classes.has(cls); },
          toggle(cls, force) {
            if (force === undefined) {
              if (mockEl.classes.has(cls)) mockEl.classes.delete(cls);
              else mockEl.classes.add(cls);
            } else if (force) {
              mockEl.classes.add(cls);
            } else {
              mockEl.classes.delete(cls);
            }
          }
        },
        classes: new Set(),
        addEventListener: () => {},
        appendChild: () => {},
        style: { setProperty: () => {}, cssText: '' }
      };
      return mockEl;
    },
    querySelectorAll: () => [],
    querySelector: () => ({
      addEventListener: () => {},
      appendChild: () => {},
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      style: { setProperty: () => {}, cssText: '', display: '' }
    }),
    createElement: () => ({
      appendChild: () => {},
      style: { setProperty: () => {}, cssText: '' },
      classList: { add: () => {}, remove: () => {}, contains: () => false }
    })
  },
  TextEncoder,
  TextDecoder,
  window: {
    location: { hash: '' },
    crypto: require('crypto').webcrypto,
    addEventListener: () => {},
    removeEventListener: () => {},
    showToast: (msg, type) => {
      console.log(`[Toast] ${type}: ${msg}`);
    }
  },
  crypto: require('crypto').webcrypto,
  lucide: {
    createIcons: () => {}
  },
  alert: (msg) => { console.log(`[Alert] ${msg}`); },
  confirm: () => true
};

// Compile utils.js
const utilsCode = fs.readFileSync('utils.js', 'utf8');
const runUtilsInSandbox = (code) => {
  const keys = Object.keys(sandbox);
  const values = Object.values(sandbox);
  const fn = new Function(...keys, code + '\nreturn { MOOD_COLORS, CHINESE_WEEKDAYS, getChineseWeekday, escapeHtml };');
  return fn(...values);
};
const utilsExports = runUtilsInSandbox(utilsCode);
sandbox.MOOD_COLORS = utilsExports.MOOD_COLORS;
sandbox.CHINESE_WEEKDAYS = utilsExports.CHINESE_WEEKDAYS;
sandbox.getChineseWeekday = utilsExports.getChineseWeekday;
sandbox.escapeHtml = utilsExports.escapeHtml;

// Compile crypto-service.js
const cryptoCode = fs.readFileSync('crypto-service.js', 'utf8');
const runCryptoInSandbox = (code) => {
  const keys = Object.keys(sandbox);
  const values = Object.values(sandbox);
  const fn = new Function(...keys, code + '\nreturn { bufToHex, hexToBuf, deriveKey, encryptData, decryptData };');
  return fn(...values);
};
const cryptoExports = runCryptoInSandbox(cryptoCode);
sandbox.bufToHex = cryptoExports.bufToHex;
sandbox.hexToBuf = cryptoExports.hexToBuf;
sandbox.deriveKey = cryptoExports.deriveKey;
sandbox.encryptData = cryptoExports.encryptData;
sandbox.decryptData = cryptoExports.decryptData;

// Compile db.js
const dbCode = fs.readFileSync('db.js', 'utf8');
const runDbInSandbox = (code) => {
  const keys = Object.keys(sandbox);
  const values = Object.values(sandbox);
  const fn = new Function(...keys, code + '\nreturn { DiaryDB, DB_NAME, DB_VERSION };');
  return fn(...values);
};
const dbExports = runDbInSandbox(dbCode);
const DiaryDB = dbExports.DiaryDB;
sandbox.DiaryDB = DiaryDB;
sandbox.window.DiaryDB = DiaryDB;

// We mock TODAY_DATE_STR for control
sandbox.TODAY_DATE_STR = '2028-12-31';

// Compile app.js
const appCode = fs.readFileSync('app.js', 'utf8');
const runAppInSandbox = (code) => {
  const keys = Object.keys(sandbox);
  const values = Object.values(sandbox);
  const cleanCode = code.replace(/const TODAY_DATE_STR = [^;]+;/, '');
  const fn = new Function(...keys, cleanCode + '\nreturn { State, getCycleStartYear, checkThreeYearCompletion, isDateInArchivedCycle, startNewThreeYearCycle };');
  return fn(...values);
};
const appExports = runAppInSandbox(appCode);
const State = appExports.State;
const getCycleStartYear = appExports.getCycleStartYear;
const checkThreeYearCompletion = appExports.checkThreeYearCompletion;
const isDateInArchivedCycle = appExports.isDateInArchivedCycle;
const startNewThreeYearCycle = appExports.startNewThreeYearCycle;

// Enable LocalStorage database fallback in DiaryDB
DiaryDB.useLocalStorage = true;

// ==================== TEST SUITE ====================
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  } else {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  }
}

async function runTests() {
  console.log('🧪 Starting Phase D Multi-Cycle Archive Tests...\n');

  // Test 1: Cycle Start Year Prioritization
  console.log('--- Test 1: getCycleStartYear Priorities ---');
  sandbox.localStorage.clear();
  State.currentUser = 'test_user_id';
  
  // Clean mock user state
  const mockUser = {
    uid: 'test_user_id',
    startedAt: '2025-06-12T00:00:00Z',
    activeCycleStartYear: null
  };
  
  // Priority 5: Fallback to 2024 if startedAt and activeCycleStartYear are both missing
  const startYr5 = getCycleStartYear({ uid: 'test_user_id' });
  assert(startYr5 === 2024, `Priority 5: Expected 2024, got ${startYr5}`);

  // Priority 4: startedAt year
  const startYr4 = getCycleStartYear(mockUser);
  assert(startYr4 === 2025, `Priority 4: Expected 2025, got ${startYr4}`);

  // Priority 3: localStorage.cycle_start_year_${userId}
  sandbox.localStorage.setItem('cycle_start_year_test_user_id', '2026');
  const startYr3 = getCycleStartYear(mockUser);
  assert(startYr3 === 2026, `Priority 3: Expected 2026, got ${startYr3}`);

  // Priority 2: localStorage.active_cycle_start_year_${userId}
  sandbox.localStorage.setItem('active_cycle_start_year_test_user_id', '2027');
  const startYr2 = getCycleStartYear(mockUser);
  assert(startYr2 === 2027, `Priority 2: Expected 2027, got ${startYr2}`);

  // Priority 1: user.activeCycleStartYear
  mockUser.activeCycleStartYear = 2028;
  const startYr1 = getCycleStartYear(mockUser);
  assert(startYr1 === 2028, `Priority 1: Expected 2028, got ${startYr1}`);

  // Test 2: Cycle Completion Logic
  console.log('\n--- Test 2: checkThreeYearCompletion logic ---');
  // With start year 2026, 3-year cycle completes on 2028-12-31
  // Today is set to '2028-12-31'
  sandbox.TODAY_DATE_STR = '2028-12-31';
  State.activeDate = '2028-12-31';
  let completionInfo = await checkThreeYearCompletion(2026);
  assert(completionInfo.completed === true, 'Cycle 2026 completes on exactly 2028-12-31');

  // Today is before end of cycle: 2028-12-30
  sandbox.TODAY_DATE_STR = '2028-12-30';
  State.activeDate = '2028-12-30';
  completionInfo = await checkThreeYearCompletion(2026);
  assert(completionInfo.completed === false, 'Cycle 2026 is not completed on 2028-12-30');

  // Today is after end of cycle: 2029-01-01
  sandbox.TODAY_DATE_STR = '2029-01-01';
  State.activeDate = '2029-01-01';
  completionInfo = await checkThreeYearCompletion(2026);
  assert(completionInfo.completed === true, 'Cycle 2026 remains completed in 2029');

  // Test 3: isDateInArchivedCycle Boundaries
  console.log('\n--- Test 3: isDateInArchivedCycle checks ---');
  // Scenario 3.1: Active Cycle is 2026-2028.
  State.activeCycleStartYear = 2026;
  
  // Date in the future or active cycle is not archived yet
  assert(isDateInArchivedCycle('2026-05-01') === false, '2026-05-01 is not archived (in active cycle)');
  assert(isDateInArchivedCycle('2028-12-31') === false, '2028-12-31 is not archived (in active cycle)');
  assert(isDateInArchivedCycle('2025-01-01') === true, '2025-01-01 is archived (before active cycle start year 2026)');

  // Scenario 3.2: Active Cycle is null (user is in transition / archived cycle 1, has not started cycle 2 yet)
  State.activeCycleStartYear = null;
  // Everything should be treated as archived/read-only in transition state
  assert(isDateInArchivedCycle('2026-05-01') === true, 'In transition state, 2026-05-01 is archived/read-only');
  assert(isDateInArchivedCycle('2028-12-31') === true, 'In transition state, 2028-12-31 is archived/read-only');

  // Test 4: Archive snapshotted DB operations
  console.log('\n--- Test 4: Archive DB store logic ---');
  // Let's create some dummy diaries and memos in database
  const d1 = { date: '2026-01-01', content: 'Diary 1', mood: 'yellow' };
  const d2 = { date: '2027-02-02', content: 'Diary 2', mood: 'green' };
  const m1 = { date: '2026-01-01', time: '12:00', content: 'Memo 1', images: [] };
  
  await DiaryDB.saveDiary(d1, 'user_test');
  await DiaryDB.saveDiary(d2, 'user_test');
  await DiaryDB.saveMemo(m1, 'user_test');

  // Query and generate snapshot format
  const allDiaries = await DiaryDB.getAllDiaries('user_test');
  const allMemos = await DiaryDB.getAllMemos('user_test');
  
  assert(allDiaries.length === 2, '2 diaries stored in DB');
  assert(allMemos.length === 1, '1 memo stored in DB');

  const archiveObj = {
    id: `archive_user_test_2026_2028`,
    userId: 'user_test',
    cycleStartYear: 2026,
    cycleEndYear: 2028,
    archivedAt: new Date().toISOString(),
    diaries: allDiaries,
    memos: allMemos
  };

  await DiaryDB.saveArchive(archiveObj, 'user_test');
  const archives = await DiaryDB.getAllArchives('user_test');
  assert(archives.length === 1, 'Archive snapshot successfully stored in IndexedDB/LocalStorage');
  assert(archives[0].cycleStartYear === 2026, 'Archive snapshot start year matches 2026');
  assert(archives[0].diaries.length === 2, 'Archive snapshot contains all diaries');
  assert(archives[0].memos.length === 1, 'Archive snapshot contains all memos');

  // Test 5: Starting a new 3-year cycle
  console.log('\n--- Test 5: startNewThreeYearCycle ---');
  State.currentUser = 'user_test';
  State.activeCycleStartYear = null;
  
  // Set current user object in state
  State.currentUserObj = {
    uid: 'user_test',
    startedAt: '2026-01-01T00:00:00Z',
    activeCycleStartYear: null
  };

  // Trigger starting a new cycle in 2029
  // (Start new cycle will update activeCycleStartYear to 2029)
  await startNewThreeYearCycle(2029);
  
  assert(State.activeCycleStartYear === 2029, 'Active cycle start year successfully updated to 2029');
  assert(isDateInArchivedCycle('2029-01-01') === false, 'New cycle date 2029-01-01 is editable now');
  assert(isDateInArchivedCycle('2028-12-31') === true, 'Previous cycle date 2028-12-31 is now locked/archived');

  console.log('\n======================================');
  console.log(`🧪 Results: ${passedTests} passed, ${failedTests} failed.`);
  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
