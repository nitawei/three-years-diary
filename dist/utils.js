/**
 * utils.js - 三年日記共用常數與輔助工具函式
 */

const MOOD_COLORS = {
  'black': { text: '#434343', line: 'rgba(67, 67, 67, 0.4)' },
  'yellow': { text: 'var(--color-mood-yellow)', line: 'rgba(233, 196, 106, 0.5)' },
  'green': { text: 'var(--color-mood-green)', line: 'rgba(138, 154, 134, 0.5)' },
  'blue': { text: 'var(--color-mood-blue)', line: 'rgba(82, 130, 201, 0.5)' },
  'red': { text: 'var(--color-mood-red)', line: 'rgba(231, 111, 81, 0.5)' }
};

const CHINESE_WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

function getChineseWeekday(dateString) {
  const dObj = new Date(dateString);
  return CHINESE_WEEKDAYS[dObj.getDay()];
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isSafeImageUri(uri) {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (/^data:image\/(png|jpeg|jpg|gif|webp|heic|heif);base64,/i.test(trimmed)) {
    return true;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }
  return false;
}

/**
 * 分割字串為使用者感知字元 (Grapheme Clusters) 陣列
 * 支援 Emoji、Skin-tone 修飾、ZWJ 複合 Emoji、變體選擇器與國旗
 */
function getGraphemes(text) {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), s => s.segment);
  }
  // Fallback 相容舊環境
  return Array.from(text);
}

/**
 * 依 Grapheme 截斷字串至指定最大數量 (預設 50 字)
 */
function truncateGraphemes(text, maxCount = 50) {
  if (!text) return '';
  const graphemes = getGraphemes(text);
  if (graphemes.length <= maxCount) return text;
  return graphemes.slice(0, maxCount).join('');
}

// Expose to window for modular accessibility
window.MOOD_COLORS = MOOD_COLORS;
window.CHINESE_WEEKDAYS = CHINESE_WEEKDAYS;
window.getChineseWeekday = getChineseWeekday;
window.escapeHtml = escapeHtml;
window.isSafeImageUri = isSafeImageUri;
window.getGraphemes = getGraphemes;
window.truncateGraphemes = truncateGraphemes;
