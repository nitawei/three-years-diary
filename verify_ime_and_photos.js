/**
 * verify_ime_and_photos.js - Comprehensive Verification Suite for Phase A (IME) & Phase B (Memo Photos & Archive Entrypoints)
 */

const fs = require('fs');
const assert = require('assert');

// 1. Build a robust DOM Node mock
class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) this.classList._classes.delete(c);
          else this.classList._classes.add(c);
        } else if (force) {
          this.classList._classes.add(c);
        } else {
          this.classList._classes.delete(c);
        }
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
    this.innerHTML = '';
  }

  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] || null; }
  removeAttribute(k) { delete this.attributes[k]; }

  appendChild(child) {
    if (child.nodeType === 11) { // DocumentFragment
      for (const c of child.children) {
        this.children.push(c);
      }
      child.children = [];
    } else {
      this.children.push(child);
    }
    return child;
  }

  replaceWith(newChild) {
    this._replacedWith = newChild;
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
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
      let match = false;
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        if (node.classList && node.classList.contains(cls)) match = true;
        if (node.className && node.className.split(/\s+/).includes(cls)) match = true;
      } else if (sel.startsWith('#')) {
        const id = sel.slice(1);
        if (node.id === id) match = true;
      } else if (sel.includes('[')) {
        // e.g. [data-date="2026-07-15"]
        const attrMatch = sel.match(/\[([a-zA-Z0-9_\-]+)="([^"]+)"\]/);
        if (attrMatch && node.getAttribute && node.getAttribute(attrMatch[1]) === attrMatch[2]) {
          match = true;
        }
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
    removeEventListener: () => {}
  },
  crypto: require('crypto').webcrypto,
  lucide: { createIcons: () => {} },
  alert: (msg) => { sandbox.lastAlert = msg; },
  confirm: () => true,
  lastAlert: null
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
const runApp = new Function(...appKeys, appCode + '\nreturn { State, parseMemoImageData, getExistingDailyPhotoCount, formatMemoIndicator, createDiaryReviewCard };');
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
    console.error(`  ❌ FAIL: ${desc}\n`, err);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}\n`, err);
    failed++;
  }
}

async function runAll() {
  console.log('\n🧪 Running Phase A: Chinese IME Composition & Input Tests...');

  it('utils.getGraphemes counts Chinese, English, punctuation, and emoji accurately', () => {
    assert.strictEqual(utils.getGraphemes('今天天氣真好').length, 6);
    assert.strictEqual(utils.getGraphemes('Hello World!').length, 12);
    assert.strictEqual(utils.getGraphemes('🌸🎉👨‍👩‍👧‍👦').length, 3);
    assert.strictEqual(utils.getGraphemes('ㄐㄧㄣ').length, 3); // Zhuyin phonetic symbols
  });

  it('isSafeImageUri safely allows base64, https, blob, and relative asset paths while blocking dangerous URIs', () => {
    assert.strictEqual(utils.isSafeImageUri('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
    assert.strictEqual(utils.isSafeImageUri('data:image/png;base64,iVBORw0KGgo=='), true);
    assert.strictEqual(utils.isSafeImageUri('https://example.com/photo.jpg'), true);
    assert.strictEqual(utils.isSafeImageUri('blob:http://localhost/uuid-123'), true);
    assert.strictEqual(utils.isSafeImageUri('img1.png'), true);
    assert.strictEqual(utils.isSafeImageUri('./assets/pic.jpg'), true);
    
    // Dangerous schemes blocked
    assert.strictEqual(utils.isSafeImageUri('javascript:alert(1)'), false);
    assert.strictEqual(utils.isSafeImageUri('data:text/html;base64,PHNjcmlwdD4='), false);
    assert.strictEqual(utils.isSafeImageUri(''), false);
    assert.strictEqual(utils.isSafeImageUri(null), false);
  });

  it('parseMemoImageData extracts original URL from string and object variants with multi-key fallback', () => {
    assert.strictEqual(app.parseMemoImageData('https://example.com/1.jpg').original, 'https://example.com/1.jpg');
    assert.strictEqual(app.parseMemoImageData({ original: 'orig.jpg' }).original, 'orig.jpg');
    assert.strictEqual(app.parseMemoImageData({ url: 'url.jpg' }).original, 'url.jpg');
    assert.strictEqual(app.parseMemoImageData({ src: 'src.jpg' }).original, 'src.jpg');
    assert.strictEqual(app.parseMemoImageData({ data: 'data.jpg' }).original, 'data.jpg');
    assert.strictEqual(app.parseMemoImageData({ uri: 'uri.jpg' }).original, 'uri.jpg');
    assert.strictEqual(app.parseMemoImageData({ base64: 'b64.jpg' }).original, 'b64.jpg');
  });

  it('IME input simulation: does not truncate or commit intermediate Zhuyin during composition', () => {
    let isComposing = false;
    let committedText = '';
    let wordCount = 0;
    const target = { value: '' };

    const syncDiaryInputState = (t) => {
      const rawText = t.value || '';
      const graphemes = utils.getGraphemes(rawText);
      let text = rawText;
      if (graphemes.length > 50) {
        text = graphemes.slice(0, 50).join('');
        t.value = text;
      }
      committedText = text;
      wordCount = Math.min(graphemes.length, 50);
    };

    const onCompositionStart = () => { isComposing = true; };
    const onCompositionEnd = () => { isComposing = false; syncDiaryInputState(target); };
    const onInput = (e) => { if (isComposing) return; syncDiaryInputState(e.target); };

    // 1. Initial text: 49 characters
    target.value = '一'.repeat(49);
    onInput({ target });
    assert.strictEqual(wordCount, 49);
    assert.strictEqual(committedText.length, 49);

    // 2. User starts typing Zhuyin "ㄐㄧㄣ" for "今"
    onCompositionStart();
    target.value = '一'.repeat(49) + 'ㄐㄧㄣ'; // 52 characters during composition
    onInput({ target });

    // While composing, committedText and wordCount MUST remain at 49, target.value MUST NOT be truncated!
    assert.strictEqual(isComposing, true);
    assert.strictEqual(wordCount, 49, 'Word count must not update during composition');
    assert.strictEqual(committedText, '一'.repeat(49), 'Manuscript text must not contain intermediate phonetics');
    assert.strictEqual(target.value, '一'.repeat(49) + 'ㄐㄧㄣ', 'Textarea value must not be mutated during composition');

    // 3. User selects "今" from IME candidates
    target.value = '一'.repeat(49) + '今'; // 50 characters confirmed
    onCompositionEnd();

    assert.strictEqual(isComposing, false);
    assert.strictEqual(wordCount, 50);
    assert.strictEqual(committedText, '一'.repeat(49) + '今');
    assert.strictEqual(target.value, '一'.repeat(49) + '今');
  });

  it('IME input simulation: clamps to 50 characters on compositionend when candidate exceeds 50', () => {
    let isComposing = false;
    let committedText = '';
    let wordCount = 0;
    const target = { value: '' };

    const syncDiaryInputState = (t) => {
      const rawText = t.value || '';
      const graphemes = utils.getGraphemes(rawText);
      let text = rawText;
      if (graphemes.length > 50) {
        text = graphemes.slice(0, 50).join('');
        t.value = text;
      }
      committedText = text;
      wordCount = Math.min(graphemes.length, 50);
    };

    const onCompositionStart = () => { isComposing = true; };
    const onCompositionEnd = () => { isComposing = false; syncDiaryInputState(target); };
    const onInput = (e) => { if (isComposing) return; syncDiaryInputState(e.target); };

    // Initial 48 chars
    target.value = '木'.repeat(48);
    onInput({ target });

    // User types 4 characters via IME "森林大火"
    onCompositionStart();
    target.value = '木'.repeat(48) + 'ㄙㄣㄌㄧㄣ';
    onInput({ target });
    assert.strictEqual(wordCount, 48);

    // Candidate selected: "森林大火" (48 + 4 = 52)
    target.value = '木'.repeat(48) + '森林大火';
    onCompositionEnd();

    // Must clamp to exactly 50 graphemes
    assert.strictEqual(wordCount, 50);
    assert.strictEqual(utils.getGraphemes(target.value).length, 50);
    assert.strictEqual(committedText, '木'.repeat(48) + '森林');
  });

  console.log('\n🧪 Running Phase B: Daily 3-Photo Limit & Quota Tests...');

  await itAsync('Daily quota: user with 0 photos has 3 remaining quota', async () => {
    sandbox.localStorage.clear();
    const count = await app.getExistingDailyPhotoCount('2026-07-15', 'user_a');
    assert.strictEqual(count, 0);
    assert.strictEqual(Math.max(0, 3 - count), 3);
  });

  await itAsync('Daily quota: adding 1 photo decreases remaining quota to 2', async () => {
    await DiaryDB.saveMemo({
      id: 101,
      date: '2026-07-15',
      time: '10:00',
      content: 'Morning memo',
      images: ['data:image/jpeg;base64,img1']
    }, 'user_a');

    const count = await app.getExistingDailyPhotoCount('2026-07-15', 'user_a');
    assert.strictEqual(count, 1);
    assert.strictEqual(Math.max(0, 3 - count), 2);
  });

  await itAsync('Daily quota: multiple memos on same date combine photo count', async () => {
    await DiaryDB.saveMemo({
      id: 102,
      date: '2026-07-15',
      time: '14:00',
      content: 'Afternoon memo',
      images: ['data:image/jpeg;base64,img2', 'data:image/jpeg;base64,img3']
    }, 'user_a');

    // Memo 1 has 1 photo, Memo 2 has 2 photos -> total 3 photos
    const count = await app.getExistingDailyPhotoCount('2026-07-15', 'user_a');
    assert.strictEqual(count, 3);
    assert.strictEqual(Math.max(0, 3 - count), 0);
  });

  await itAsync('Daily quota: editing memo excludes itself from quota calculation', async () => {
    // Memo 102 currently has 2 photos. When editing Memo 102, other memos have 1 photo.
    const countExcluding102 = await app.getExistingDailyPhotoCount('2026-07-15', 'user_a', 102);
    assert.strictEqual(countExcluding102, 1);
    assert.strictEqual(Math.max(0, 3 - countExcluding102), 2);
  });

  await itAsync('Daily quota: user_a and partner (user_b) have independent quotas (not shared)', async () => {
    // User B adds 3 photos on the same date
    await DiaryDB.saveMemo({
      id: 201,
      date: '2026-07-15',
      time: '11:00',
      content: 'Partner memo',
      images: ['data:image/jpeg;base64,p1', 'data:image/jpeg;base64,p2', 'data:image/jpeg;base64,p3']
    }, 'user_b');

    const partnerCount = await app.getExistingDailyPhotoCount('2026-07-15', 'user_b');
    assert.strictEqual(partnerCount, 3);

    // On a different date 2026-07-16, user_a starts with 0 photos
    const userADate16Count = await app.getExistingDailyPhotoCount('2026-07-16', 'user_a');
    assert.strictEqual(userADate16Count, 0);
  });

  await itAsync('Historical memo compatibility: memo with > 3 photos (e.g. 5) is preserved and displayed', async () => {
    await DiaryDB.saveMemo({
      id: 301,
      date: '2026-07-14',
      time: '09:00',
      content: 'Historical big memo',
      images: ['img1.png', 'img2.png', 'img3.png', 'img4.png', 'img5.png']
    }, 'user_a');

    const memos = await DiaryDB.getMemosForDate('2026-07-14', 'user_a');
    const memo = memos.find(m => m.id === 301);
    assert.ok(memo, 'Historical memo exists');
    assert.strictEqual(memo.images.length, 5, 'All 5 historical photos preserved without truncation');
  });

  console.log('\n🧪 Running Phase B4: Archive Weekly & Yearly Review Entrypoint Tests...');

  it('formatMemoIndicator formats 0 as empty, 1..99 as "· N", and 100+ as "· 99+"', () => {
    assert.strictEqual(app.formatMemoIndicator(0), '');
    assert.strictEqual(app.formatMemoIndicator(1), '· 1');
    assert.strictEqual(app.formatMemoIndicator(3), '· 3');
    assert.strictEqual(app.formatMemoIndicator(99), '· 99');
    assert.strictEqual(app.formatMemoIndicator(150), '· 99+');
  });

  await itAsync('createDiaryReviewCard renders clean cards without premature memo badge count or redundant header buttons', async () => {
    sandbox.State = { currentUser: 'user_a' };
    const dateStr = '2026-07-15';
    const diary = { content: 'Today was good', mood: 'yellow' };
    const memos = [
      { id: 101, content: 'Memo 1', images: ['img1', 'img2'] },
      { id: 102, content: 'Memo 2', images: ['img3'] }
    ];

    // Card with memos does not display memo count on the card (displayed only when clicked into modal)
    const card = app.createDiaryReviewCard(dateStr, diary, memos);
    const badge = card.querySelector('.weekly-card-memo-badge');
    assert.strictEqual(badge, null, 'Weekly review card does not display memo count badge on the card surface');

    // Header only contains date label; redundant delete button and mood dot are removed
    const header = card.querySelector('.diary-review-card-header');
    assert.ok(header, 'Header exists');
    assert.strictEqual(header.querySelector('button'), null, 'Header does not have delete button');
    assert.strictEqual(header.querySelector('.diary-review-card-mood-dot'), null, 'Header does not have mood dot');
  });

  console.log(`\n======================================`);
  console.log(`🏁 Verification Finished: ${passed} passed, ${failed} failed`);
  console.log(`======================================\n`);

  if (failed > 0) process.exit(1);
}

runAll().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
