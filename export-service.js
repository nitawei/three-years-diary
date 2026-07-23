/**
 * export-service.js - 三年日記 HTML/PDF 匯出服務
 */

async function generateExportHTML(userId) {
  const startYear = getCycleStartYear();
  const years = [startYear, startYear + 1, startYear + 2];
  
  // 建立 53 週日曆對照結構 (處理閏年 Feb 29 封存支援)
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const hasLeapYear = years.some(isLeap);
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
      <title>Archived Diary_${startYear}-${startYear + 2}</title>
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
        <h1>Archived Diary_${startYear}-${startYear + 2}</h1>
        <p>備份對象：${userId === State.currentUser ? `我 (${userId === 'user_a' ? 'User A' : 'User B'})` : `筆友 (${userId === 'user_a' ? 'User A' : 'User B'})`} · 備份時間：${new Date().toLocaleString()}</p>
      </div>
  `;

  let totalRecords = 0;

  for (const wData of datesByWeek) {
    let weekHtml = '';
    for (const dt of wData.dates) {
      const mmStr = String(dt.month).padStart(2, '0');
      const ddStr = String(dt.day).padStart(2, '0');

      // 檢查此日期三年內是否有任何日記
      let hasAnyDiary = false;
      const dayDiaries = [];
      const dayMemos = [];
      let hasAnyMemo = false;

      for (let idx = 0; idx < 3; idx++) {
        const year = years[idx];
        const dateStr = `${year}-${mmStr}-${ddStr}`;
        const diary = await DiaryDB.getDiary(dateStr, userId);
        const memos = await DiaryDB.getMemosForDate(dateStr, userId);

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
      for (let idx = 0; idx < 3; idx++) {
        const year = years[idx];
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
      for (let idx = 0; idx < 3; idx++) {
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
        for (let idx = 0; idx < 3; idx++) {
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
        <p>目前沒有任何日記與隨筆記錄可以匯出。</p>
      </div>
    `;
  }

  html += `
    </body>
    </html>
  `;

  return html;
}

// Expose globally
window.generateExportHTML = generateExportHTML;
