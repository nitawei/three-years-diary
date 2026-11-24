/**
 * verify_archive_grid_caret.js
 * Verification Suite for Phase 3-B Archive Grid Caret Positioning
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Mock DOM Node
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, force) => {
        if (force === true) this.classList._classes.add(c);
        else if (force === false) this.classList._classes.delete(c);
        else if (this.classList._classes.has(c)) this.classList._classes.delete(c);
        else this.classList._classes.add(c);
      },
      contains: (c) => this.classList._classes.has(c)
    };
    this.children = [];
    this.style = {
      display: '',
      opacity: '',
      cursor: '',
      cssText: '',
      setProperty: (k, v) => { this.style[k] = v; }
    };
    this.attributes = {};
    this.listeners = {};
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.isFocused = false;
    this.selectionRangeCalls = [];
  }

  set innerHTML(val) {
    this._innerHTML = val;
    if (val === '') {
      this.children = [];
    }
  }
  get innerHTML() {
    return this._innerHTML || '';
  }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }

  appendChild(child) {
    if (child.nodeType === 11) {
      for (const c of child.children) {
        this.children.push(c);
      }
      child.children = [];
    } else {
      this.children.push(child);
    }
    return child;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const type = event.type || event;
    const list = this.listeners[type] || [];
    for (const fn of list) {
      fn(event);
    }
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      let match = true;
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        if (node.id !== id) match = false;
      }
      const classMatch = sel.match(/\.([a-zA-Z0-9_\-]+)/);
      if (classMatch) {
        const cls = classMatch[1];
        const hasClass = (node.classList && node.classList.contains(cls)) ||
                         (node.className && node.className.split(/\s+/).includes(cls));
        if (!hasClass) match = false;
      }
      const attrMatch = sel.match(/\[([a-zA-Z0-9_\-]+)="([^"]+)"\]/);
      if (attrMatch) {
        const k = attrMatch[1];
        const v = attrMatch[2];
        if (!node.getAttribute || String(node.getAttribute(k)) !== v) match = false;
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

  focus() {
    this.isFocused = true;
  }

  blur() {
    this.isFocused = false;
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionRangeCalls.push({ start, end });
  }

  getBoundingClientRect() {
    return this._rect || { left: 100, top: 200, width: 300, height: 200 };
  }
}

// Global DOM environment
const elements = {};
function getOrCreateElement(id, tag = 'div') {
  if (!elements[id]) {
    elements[id] = new MockElement(id, tag);
  }
  return elements[id];
}

const mockLocalStorage = {
  _data: {},
  getItem: (k) => mockLocalStorage._data[k] || null,
  setItem: (k, v) => { mockLocalStorage._data[k] = String(v); },
  removeItem: (k) => { delete mockLocalStorage._data[k]; },
  clear: () => { mockLocalStorage._data = {}; }
};

const docListeners = {};
const mockDocument = {
  getElementById: (id) => getOrCreateElement(id),
  querySelector: (sel) => {
    if (sel.startsWith('#')) {
      const spaceIdx = sel.indexOf(' ');
      if (spaceIdx > 0) {
        const id = sel.slice(1, spaceIdx);
        const root = getOrCreateElement(id);
        const rest = sel.slice(spaceIdx + 1);
        return root ? root.querySelector(rest) : null;
      }
      return getOrCreateElement(sel.substring(1));
    }
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel.startsWith('#')) {
      const spaceIdx = sel.indexOf(' ');
      if (spaceIdx > 0) {
        const id = sel.slice(1, spaceIdx);
        const root = getOrCreateElement(id);
        const rest = sel.slice(spaceIdx + 1);
        return root ? root.querySelectorAll(rest) : [];
      }
    }
    const results = [];
    for (const key of Object.keys(elements)) {
      results.push(...elements[key].querySelectorAll(sel));
    }
    return results;
  },
  createElement: (tag) => new MockElement('el-' + Math.random(), tag),
  createDocumentFragment: () => new MockElement('fragment'),
  body: getOrCreateElement('body', 'body'),
  addEventListener: (type, fn) => {
    if (!docListeners[type]) docListeners[type] = [];
    docListeners[type].push(fn);
  },
  removeEventListener: (type, fn) => {
    if (!docListeners[type]) return;
    docListeners[type] = docListeners[type].filter(f => f !== fn);
  },
  activeElement: null
};

global.localStorage = mockLocalStorage;
global.document = mockDocument;
global.window = {
  localStorage: mockLocalStorage,
  document: mockDocument,
  addEventListener: () => {},
  removeEventListener: () => {},
  showToast: () => {},
  alert: () => {},
  confirm: () => true,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  auth: {
    currentUser: { uid: 'user_a', email: 'test@example.com' },
    getRedirectResult: async () => null,
    onAuthStateChanged: () => {}
  },
  db: null
};
global.navigator = { onLine: true };
global.alert = () => {};
global.confirm = () => true;

// Load sources
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

let passCount = 0;
let failCount = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    failCount++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    failCount++;
  }
}

async function runAll() {
  console.log('\n🧪 Running Phase 3-B Caret Positioning Test Suite...\n');

  const { calculateManuscriptCaretPosition, applyManuscriptCaretPositioning } = window;

  assert(typeof calculateManuscriptCaretPosition === 'function', 'calculateManuscriptCaretPosition must be defined on window');
  assert(typeof applyManuscriptCaretPositioning === 'function', 'applyManuscriptCaretPositioning must be defined on window');

  // ==========================================
  // Section 1: Pure Calculation Geometry Tests
  // ==========================================
  console.log('--- Section 1: Pure Calculation & Geometry Tests ---');
  
  // Standard grid rect: 10 columns x 5 rows
  // Left: 100, Top: 200, Width: 300 (30px/col), Height: 200 (40px/row)
  const rect = { left: 100, top: 200, width: 300, height: 200 };

  it('Top-Left cell (row 0, col 0) calculates to targetIdx 0', () => {
    const res = calculateManuscriptCaretPosition(rect, 105, 205, '');
    assert.strictEqual(res.col, 0);
    assert.strictEqual(res.row, 0);
    assert.strictEqual(res.targetIdx, 0);
  });

  it('Top-Right cell (row 0, col 9) calculates to targetIdx 9', () => {
    // col 9 is x in [100 + 270, 100 + 300) = [370, 400) -> 385
    const res = calculateManuscriptCaretPosition(rect, 385, 210, '');
    assert.strictEqual(res.col, 9);
    assert.strictEqual(res.row, 0);
    assert.strictEqual(res.targetIdx, 9);
  });

  it('Bottom-Left cell (row 4, col 0) calculates to targetIdx 40', () => {
    // row 4 is y in [200 + 160, 200 + 200) = [360, 400) -> 380
    const res = calculateManuscriptCaretPosition(rect, 110, 380, '');
    assert.strictEqual(res.col, 0);
    assert.strictEqual(res.row, 4);
    assert.strictEqual(res.targetIdx, 40);
  });

  it('Bottom-Right cell (row 4, col 9) calculates to targetIdx 49', () => {
    const res = calculateManuscriptCaretPosition(rect, 395, 395, '');
    assert.strictEqual(res.col, 9);
    assert.strictEqual(res.row, 4);
    assert.strictEqual(res.targetIdx, 49);
  });

  it('Middle cell (row 2, col 5) calculates to targetIdx 25', () => {
    // col 5 is x in [100 + 150, 100 + 180) = [250, 280) -> 265
    // row 2 is y in [200 + 80, 200 + 120) = [280, 320) -> 300
    const res = calculateManuscriptCaretPosition(rect, 265, 300, '');
    assert.strictEqual(res.col, 5);
    assert.strictEqual(res.row, 2);
    assert.strictEqual(res.targetIdx, 25);
  });

  it('Strict clamping: Coordinates far above and left clamp to (0, 0, targetIdx: 0)', () => {
    const res = calculateManuscriptCaretPosition(rect, -50, -100, '');
    assert.strictEqual(res.col, 0);
    assert.strictEqual(res.row, 0);
    assert.strictEqual(res.targetIdx, 0);
  });

  it('Strict clamping: Coordinates far below and right clamp to (9, 4, targetIdx: 49)', () => {
    const res = calculateManuscriptCaretPosition(rect, 9999, 8888, '');
    assert.strictEqual(res.col, 9);
    assert.strictEqual(res.row, 4);
    assert.strictEqual(res.targetIdx, 49);
  });

  it('Degenerate rect (width/height 0) returns safe fallback (0, 0, 0, 0)', () => {
    const res = calculateManuscriptCaretPosition({ left: 0, top: 0, width: 0, height: 0 }, 100, 100, 'test');
    assert.strictEqual(res.col, 0);
    assert.strictEqual(res.row, 0);
    assert.strictEqual(res.targetIdx, 0);
    assert.strictEqual(res.newPos, 0);
  });

  // ==========================================
  // Section 2: Text Length & UTF-16 Code Units
  // ==========================================
  console.log('\n--- Section 2: Text Length & Grapheme / Emoji Index Tests ---');

  it('Empty text always places cursor at position 0 even if clicking middle cell', () => {
    const res = calculateManuscriptCaretPosition(rect, 265, 300, '');
    assert.strictEqual(res.targetIdx, 25);
    assert.strictEqual(res.newPos, 0);
  });

  it('Clicking beyond existing text places cursor at the end of text', () => {
    const text = '你好世界'; // 4 graphemes (indices 0..3)
    // Click cell index 8 (row 0, col 8)
    const res = calculateManuscriptCaretPosition(rect, 350, 210, text);
    assert.strictEqual(res.targetIdx, 8);
    assert.strictEqual(res.newPos, text.length); // Clamped to 4
  });

  it('Clicking within existing Chinese text positions cursor accurately', () => {
    const text = '今天天氣真好，心情也很棒！'; // 13 graphemes
    // Click cell index 2 ('天') -> newPos should be 2
    const res = calculateManuscriptCaretPosition(rect, 175, 210, text);
    assert.strictEqual(res.targetIdx, 2);
    assert.strictEqual(res.newPos, 2);
    assert.strictEqual(text.slice(0, res.newPos), '今天');
  });

  it('Surrogate pair emojis (2 code units each) correctly calculate UTF-16 cursor position', () => {
    const text = '🌸🎉🎂🎈🎁'; // 5 emojis, each 2 UTF-16 code units (total length 10)
    // Click cell index 0 ('🌸') -> newPos = 0
    const res0 = calculateManuscriptCaretPosition(rect, 105, 205, text);
    assert.strictEqual(res0.targetIdx, 0);
    assert.strictEqual(res0.newPos, 0);

    // Click cell index 2 ('🎂') -> newPos = '🌸🎉'.length = 4
    const res2 = calculateManuscriptCaretPosition(rect, 175, 205, text);
    assert.strictEqual(res2.targetIdx, 2);
    assert.strictEqual(res2.newPos, 4);
    assert.strictEqual(text.slice(0, res2.newPos), '🌸🎉');

    // Click cell index 4 ('🎁') -> newPos = '🌸🎉🎂🎈'.length = 8
    const res4 = calculateManuscriptCaretPosition(rect, 235, 205, text);
    assert.strictEqual(res4.targetIdx, 4);
    assert.strictEqual(res4.newPos, 8);
    assert.strictEqual(text.slice(0, res4.newPos), '🌸🎉🎂🎈');
  });

  it('Complex ZWJ compound emoji accurately calculates grapheme vs code unit offset', () => {
    // '👨‍👩‍👧‍👦' has length 11 (UTF-16 code units), but counts as 1 grapheme
    const text = '👨‍👩‍👧‍👦很棒'; // 3 graphemes: ['👨‍👩‍👧‍👦', '很', '棒'], total length 13
    assert.strictEqual(text.length, 13);
    assert.strictEqual('👨‍👩‍👧‍👦'.length, 11);
    
    // Click cell index 1 ('很')
    const res1 = calculateManuscriptCaretPosition(rect, 145, 205, text);
    assert.strictEqual(res1.targetIdx, 1);
    assert.strictEqual(res1.newPos, '👨‍👩‍👧‍👦'.length); // 11
    assert.strictEqual(text.slice(0, res1.newPos), '👨‍👩‍👧‍👦');

    // Click cell index 2 ('棒')
    const res2 = calculateManuscriptCaretPosition(rect, 175, 205, text);
    assert.strictEqual(res2.targetIdx, 2);
    assert.strictEqual(res2.newPos, '👨‍👩‍👧‍👦很'.length); // 12
    assert.strictEqual(text.slice(0, res2.newPos), '👨‍👩‍👧‍👦很');
  });

  // ==========================================
  // Section 3: applyManuscriptCaretPositioning
  // ==========================================
  console.log('\n--- Section 3: applyManuscriptCaretPositioning Tests ---');

  it('Focuses textarea and calls setSelectionRange with exact position', () => {
    const grid = new MockElement('test-grid');
    grid._rect = rect;
    for (let i = 0; i < 50; i++) {
      const cell = new MockElement('cell-' + i);
      cell.setAttribute('data-index', i);
      cell.classList.add('manuscript-cell');
      grid.appendChild(cell);
    }

    const textarea = new MockElement('test-textarea', 'textarea');
    textarea.value = '今天的天氣真好'; // 7 chars

    let cursorHighlightCalled = false;
    const highlightCursor = () => { cursorHighlightCalled = true; };

    // Click cell index 3 ('天')
    const result = applyManuscriptCaretPositioning({
      grid,
      textarea,
      clientX: 205, // col 3
      clientY: 210, // row 0
      isComposing: false,
      highlightCursor
    });

    assert.strictEqual(result.targetIdx, 3);
    assert.strictEqual(result.newPos, 3);
    assert.strictEqual(textarea.isFocused, true);
    assert.strictEqual(textarea.selectionStart, 3);
    assert.strictEqual(textarea.selectionEnd, 3);
    assert.strictEqual(cursorHighlightCalled, true);

    // Verify micro-feedback class is-active was applied to cell 3
    const cell3 = grid.querySelector('.manuscript-cell[data-index="3"]');
    assert(cell3 && cell3.classList.contains('is-active'), 'target cell should have is-active class');
  });

  it('IME Safety: does nothing when isComposing is true', () => {
    const grid = new MockElement('test-grid');
    grid._rect = rect;
    const textarea = new MockElement('test-textarea', 'textarea');
    textarea.value = '測試中';

    let cursorHighlightCalled = false;
    const result = applyManuscriptCaretPositioning({
      grid,
      textarea,
      clientX: 205,
      clientY: 210,
      isComposing: true, // During IME composition!
      highlightCursor: () => { cursorHighlightCalled = true; }
    });

    assert.strictEqual(result, null, 'Should return null during composition');
    assert.strictEqual(textarea.isFocused, false);
    assert.strictEqual(textarea.selectionRangeCalls.length, 0);
    assert.strictEqual(cursorHighlightCalled, false);
  });

  // ==========================================
  // Section 4: Archive Edit Drawer Integration
  // ==========================================
  console.log('\n--- Section 4: Archive Edit Drawer Integration Tests ---');

  await itAsync('Opening edit drawer initializes grid, sets content and binds pointerdown/click positioning', async () => {
    const grid = getOrCreateElement('edit-manuscript-grid');
    grid._rect = rect;
    const textarea = getOrCreateElement('edit-diary-textarea', 'textarea');
    const drawer = getOrCreateElement('edit-diary-drawer');
    const wordCount = getOrCreateElement('edit-diary-word-count');

    State.activeCycleStartYear = 2024;
    State.currentUser = 'user_a';

    // Mock DiaryDB.getDiary to return a 10-char diary entry
    DiaryDB.getDiary = async (date) => ({
      content: '記錄過去的這一天！',
      mood: 'yellow'
    });

    // Open edit drawer
    await window.openEditDiaryDrawer('2025-06-15');

    assert.strictEqual(textarea.value, '記錄過去的這一天！');
    assert.strictEqual(grid.children.length, 50, 'Grid should have 50 cells');

    // Verify cell content
    const firstCell = grid.querySelector('.manuscript-cell[data-index="0"]');
    assert(firstCell, 'First cell must exist');
    assert.strictEqual(firstCell.textContent, '記');
    assert(firstCell.classList.contains('has-char'));

    // Simulate clicking cell index 4 ('的') on #edit-manuscript-grid
    // col 4: [220, 250) -> 235, row 0: 210
    grid.dispatchEvent({ type: 'pointerdown', clientX: 235, clientY: 210 });

    assert.strictEqual(textarea.isFocused, true, 'Textarea must be focused after pointerdown on grid');
    assert.strictEqual(textarea.selectionStart, 4, 'Selection start must be 4');
    assert.strictEqual(textarea.selectionEnd, 4, 'Selection end must be 4');

    // Simulate clicking cell index 7 ('一') via textarea pointerdown
    // col 7: [310, 340) -> 325, row 0: 210
    textarea.dispatchEvent({ type: 'pointerdown', clientX: 325, clientY: 210 });

    assert.strictEqual(textarea.selectionStart, 7, 'Selection start must be 7 after clicking textarea');
    assert.strictEqual(textarea.selectionEnd, 7, 'Selection end must be 7');

    // Simulate click event fallback
    textarea.dispatchEvent({ type: 'click', clientX: 325, clientY: 210 });
    assert.strictEqual(textarea.selectionStart, 7, 'Selection start must remain 7 after click event');

    // Verify typing works: append text ('記錄過去的這一天！新增內容' = 13 graphemes)
    textarea.value = '記錄過去的這一天！新增內容';
    textarea.dispatchEvent({ type: 'input', target: textarea });
    assert.strictEqual(wordCount.textContent, '13 / 50');
  });

  // ==========================================
  // Section 5: Today Page Compatibility
  // ==========================================
  console.log('\n--- Section 5: Today Page Compatibility Tests ---');

  it('Today page setupEventListeners binds unified positioning without regressions', () => {
    const mainGrid = getOrCreateElement('manuscript-grid');
    mainGrid._rect = rect;
    for (let i = 0; i < 50; i++) {
      const cell = new MockElement('cell-today-' + i);
      cell.setAttribute('data-index', i);
      cell.classList.add('manuscript-cell');
      mainGrid.appendChild(cell);
    }

    const mainTextarea = getOrCreateElement('diary-textarea', 'textarea');
    mainTextarea.value = '今日隨筆日記測試'; // 8 chars

    // Call setupEventListeners
    window.setupEventListeners();

    // Click cell index 2 ('隨') on mainTextarea
    // col 2: 175, row 0: 210
    mainTextarea.dispatchEvent({ type: 'pointerdown', clientX: 175, clientY: 210 });
    assert.strictEqual(mainTextarea.selectionStart, 2);
    assert.strictEqual(mainTextarea.selectionEnd, 2);
    assert.strictEqual(mainTextarea.isFocused, true);

    // Click grid directly (col 0: 110, row 0: 210)
    mainGrid.dispatchEvent({ type: 'pointerdown', clientX: 110, clientY: 210 });
    assert.strictEqual(mainTextarea.selectionStart, 0);
  });

  // ==========================================
  // Section 6: Phase 3-B.2 Native Mouse Event Interception & Anti-Duplication
  // ==========================================
  console.log('\n--- Section 6: Phase 3-B.2 Native Mouse Event Interception & Anti-Duplication ---');

  it('mousedown calls e.preventDefault() on left-click to stop native textarea hit-testing', () => {
    const testGrid = new MockElement('test-grid-p3b2');
    testGrid._rect = rect;
    const testTextarea = new MockElement('test-textarea-p3b2', 'textarea');
    testTextarea.value = '春眠不覺曉，處處聞啼鳥。'; // 12 chars

    let isComp = false;
    let highlightCalled = 0;
    window.bindManuscriptCaretEvents({
      grid: testGrid,
      textarea: testTextarea,
      getIsComposing: () => isComp,
      highlightCursor: () => { highlightCalled++; }
    });

    let preventDefaultCalled = false;
    const mockMousedownEvent = {
      type: 'mousedown',
      button: 0,
      clientX: 175, // col 2
      clientY: 210, // row 0 -> targetIdx 2 ('不')
      preventDefault: () => { preventDefaultCalled = true; }
    };

    testTextarea.dispatchEvent(mockMousedownEvent);

    assert.strictEqual(preventDefaultCalled, true, 'mousedown MUST call preventDefault to stop native browser selection override');
    assert.strictEqual(testTextarea.isFocused, true, 'Textarea must be focused programmatically');
    assert.strictEqual(testTextarea.selectionStart, 2);
    assert.strictEqual(testTextarea.selectionEnd, 2);
    assert.strictEqual(highlightCalled, 1);
  });

  it('Right-click (button === 2) does NOT call preventDefault and does not trigger positioning', () => {
    const testGrid = new MockElement('test-grid-rclick');
    testGrid._rect = rect;
    const testTextarea = new MockElement('test-textarea-rclick', 'textarea');
    testTextarea.value = '測試右鍵選單功能';

    let preventDefaultCalled = false;
    let highlightCalled = 0;
    window.bindManuscriptCaretEvents({
      grid: testGrid,
      textarea: testTextarea,
      getIsComposing: () => false,
      highlightCursor: () => { highlightCalled++; }
    });

    testTextarea.dispatchEvent({
      type: 'mousedown',
      button: 2,
      clientX: 175,
      clientY: 210,
      preventDefault: () => { preventDefaultCalled = true; }
    });

    assert.strictEqual(preventDefaultCalled, false, 'Right click must NOT call preventDefault');
    assert.strictEqual(highlightCalled, 0, 'Right click must NOT trigger positioning');
  });

  it('Single click gesture (pointerdown -> mousedown -> click) only performs 1 positioning calculation', () => {
    const testGrid = new MockElement('test-grid-seq');
    testGrid._rect = rect;
    const testTextarea = new MockElement('test-textarea-seq', 'textarea');
    testTextarea.value = '單次點擊事件序列去重測試';

    let highlightCalls = 0;
    window.bindManuscriptCaretEvents({
      grid: testGrid,
      textarea: testTextarea,
      getIsComposing: () => false,
      highlightCursor: () => { highlightCalls++; }
    });

    let mousedownPrevented = false;

    // 1. pointerdown fires first
    testTextarea.dispatchEvent({ type: 'pointerdown', clientX: 205, clientY: 210 });
    assert.strictEqual(highlightCalls, 1, 'First pointerdown must position');
    assert.strictEqual(testTextarea.selectionStart, 3);

    // 2. mousedown fires next
    testTextarea.dispatchEvent({
      type: 'mousedown',
      button: 0,
      clientX: 205,
      clientY: 210,
      preventDefault: () => { mousedownPrevented = true; }
    });
    assert.strictEqual(mousedownPrevented, true, 'mousedown must still prevent default');
    assert.strictEqual(highlightCalls, 1, 'mousedown within 300ms must NOT perform duplicate calculation');

    // 3. click fires last
    testTextarea.dispatchEvent({ type: 'click', clientX: 205, clientY: 210 });
    assert.strictEqual(highlightCalls, 1, 'click within 300ms must NOT perform duplicate calculation');
  });

  it('Fallback click positions correctly when pointerdown and mousedown are absent', () => {
    const testGrid = new MockElement('test-grid-fallback');
    testGrid._rect = rect;
    const testTextarea = new MockElement('test-textarea-fallback', 'textarea');
    testTextarea.value = '純點擊事件備援測試';

    let highlightCalls = 0;
    window.bindManuscriptCaretEvents({
      grid: testGrid,
      textarea: testTextarea,
      getIsComposing: () => false,
      highlightCursor: () => { highlightCalls++; }
    });

    testTextarea.dispatchEvent({ type: 'click', clientX: 235, clientY: 210 }); // col 4 -> targetIdx 4
    assert.strictEqual(highlightCalls, 1);
    assert.strictEqual(testTextarea.selectionStart, 4);
    assert.strictEqual(testTextarea.isFocused, true);
  });

  // ==========================================
  // Section 7: Phase 3-B.2 Grid Geometry & Row Height Verification
  // ==========================================
  console.log('\n--- Section 7: Phase 3-B.2 Grid Geometry & Row Height Verification ---');

  it('style.css defines grid-template-rows: repeat(5, 1fr) for .manuscript-grid', () => {
    const cssPath = path.join(__dirname, 'style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const gridMatch = cssContent.match(/\.manuscript-grid\s*\{([^}]+)\}/);
    assert(gridMatch, '.manuscript-grid selector must exist in style.css');
    const block = gridMatch[1];
    assert(block.includes('grid-template-rows: repeat(5, 1fr)'), 'Must include grid-template-rows: repeat(5, 1fr)');
    assert(block.includes('grid-template-columns: repeat(10, 1fr)'), 'Must include grid-template-columns: repeat(10, 1fr)');
  });

  it('All 5 rows (Row 0..4) and all 10 columns (Col 0..9) calculate strictly and symmetrically', () => {
    // 50-char full text: 50 CJK characters
    const fullText = '一二三四五六七八九十壹貳參肆伍陸柒捌玖拾甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥日月星光天地乾坤';
    assert.strictEqual(fullText.length, 50);

    const testRect = { left: 100, top: 200, width: 300, height: 150 };
    // Each col is 30px wide, each row is 30px high

    // Verify key test positions across all 5 rows: Left (col 0), Center (col 5), Right (col 9)
    const testCases = [
      // Row 0
      { clientX: 115, clientY: 215, expRow: 0, expCol: 0, expIdx: 0 },
      { clientX: 265, clientY: 215, expRow: 0, expCol: 5, expIdx: 5 },
      { clientX: 385, clientY: 215, expRow: 0, expCol: 9, expIdx: 9 },
      // Row 1
      { clientX: 115, clientY: 245, expRow: 1, expCol: 0, expIdx: 10 },
      { clientX: 265, clientY: 245, expRow: 1, expCol: 5, expIdx: 15 },
      { clientX: 385, clientY: 245, expRow: 1, expCol: 9, expIdx: 19 },
      // Row 2 (Middle row)
      { clientX: 115, clientY: 275, expRow: 2, expCol: 0, expIdx: 20 },
      { clientX: 265, clientY: 275, expRow: 2, expCol: 5, expIdx: 25 },
      { clientX: 385, clientY: 275, expRow: 2, expCol: 9, expIdx: 29 },
      // Row 3
      { clientX: 115, clientY: 305, expRow: 3, expCol: 0, expIdx: 30 },
      { clientX: 265, clientY: 305, expRow: 3, expCol: 5, expIdx: 35 },
      { clientX: 385, clientY: 305, expRow: 3, expCol: 9, expIdx: 39 },
      // Row 4 (Bottom row)
      { clientX: 115, clientY: 335, expRow: 4, expCol: 0, expIdx: 40 },
      { clientX: 265, clientY: 335, expRow: 4, expCol: 5, expIdx: 45 },
      { clientX: 385, clientY: 335, expRow: 4, expCol: 9, expIdx: 49 },
    ];

    for (const tc of testCases) {
      const res = window.calculateManuscriptCaretPosition(testRect, tc.clientX, tc.clientY, fullText);
      assert.strictEqual(res.row, tc.expRow, `Row mismatch for (${tc.clientX}, ${tc.clientY})`);
      assert.strictEqual(res.col, tc.expCol, `Col mismatch for (${tc.clientX}, ${tc.clientY})`);
      assert.strictEqual(res.targetIdx, tc.expIdx, `targetIdx mismatch for (${tc.clientX}, ${tc.clientY})`);
      assert.strictEqual(res.newPos, tc.expIdx, `newPos mismatch for (${tc.clientX}, ${tc.clientY})`);
    }
  });

  it('Empty text on 50-cell grid safely positions cursor at index 0 for all rows', () => {
    const testRect = { left: 100, top: 200, width: 300, height: 150 };
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 10; c++) {
        const clientX = 100 + c * 30 + 15;
        const clientY = 200 + r * 30 + 15;
        const res = window.calculateManuscriptCaretPosition(testRect, clientX, clientY, '');
        assert.strictEqual(res.targetIdx, r * 10 + c);
        assert.strictEqual(res.newPos, 0, `Empty text must always yield newPos 0 at row ${r}, col ${c}`);
      }
    }
  });

  console.log('\n======================================');
  console.log(`🏁 Verification Finished: ${passCount} passed, ${failCount} failed`);
  console.log('======================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
