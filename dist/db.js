/**
 * db.js - 三年日記 Hybrid 儲存管理器 (IndexedDB + LocalStorage + 記憶體虛擬快取 三重安全機制)
 */

const DB_NAME = 'ThreeYearDiaryDB';
const DB_VERSION = 7;

class DiaryDB {
  static useLocalStorage = false;
  
  // 記憶體虛擬快取：當瀏覽器完全阻擋 IndexedDB 與 LocalStorage 時的最終防線
  static memoryDiaries = {};
  static memoryMemos = [];
  static memoryUsers = {};

  static open() {
    return new Promise((resolve, reject) => {
      if (this.useLocalStorage) {
        return reject(new Error('IndexedDB disabled, using LocalStorage fallback.'));
      }

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onblocked = () => {
          console.warn('[IndexedDB Upgrade Blocked] Please close other tabs of this app.');
        };

        request.onerror = () => {
          console.warn('IndexedDB open failed, switching to LocalStorage.', request.error);
          this.useLocalStorage = true;
          reject(request.error);
        };

        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            console.warn('[IndexedDB Versionchange] Database version changed, closing stale connection.');
            db.close();
          };
          resolve(db);
        };

        request.onupgradeneeded = (e) => {
          const db = request.result;
          const oldVersion = e.oldVersion;
          const transaction = e.target.transaction;

          // 1. 日記 Store：以日期為 Key (YYYY-MM-DD)
          if (!db.objectStoreNames.contains('diaries')) {
            db.createObjectStore('diaries', { keyPath: 'date' });
          }

          // 2. 使用者 Store：以 id 為 Key
          if (!db.objectStoreNames.contains('users')) {
            db.createObjectStore('users', { keyPath: 'id' });
          }

          // 4. 封存 Store：以 id 為 Key
          if (!db.objectStoreNames.contains('archives')) {
            db.createObjectStore('archives', { keyPath: 'id' });
          }

          // 3. 備忘錄 Store v2 升級 (二元複合主鍵 ['userId', 'id'])
          if (oldVersion < 6) {
            let v2Store;
            if (!db.objectStoreNames.contains('memos_v2')) {
              v2Store = db.createObjectStore('memos_v2', { keyPath: ['userId', 'id'] });
              v2Store.createIndex('date', 'date', { unique: false });
              v2Store.createIndex('userId_date', ['userId', 'date'], { unique: false });
            } else {
              v2Store = transaction.objectStore('memos_v2');
            }

            let quarantineStore;
            if (!db.objectStoreNames.contains('memos_quarantine')) {
              quarantineStore = db.createObjectStore('memos_quarantine', { keyPath: 'quarantine_id', autoIncrement: true });
            } else {
              quarantineStore = transaction.objectStore('memos_quarantine');
            }

            // 搬移舊 memos store 中的紀錄
            if (db.objectStoreNames.contains('memos')) {
              const oldStore = transaction.objectStore('memos');
              const cursorReq = oldStore.openCursor();

              cursorReq.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                  const record = cursor.value;

                  // 嚴格判定：100% 具備非空 userId 且 date 為合規 YYYY-MM-DD
                  const hasValidUserId = record && record.userId && typeof record.userId === 'string' && record.userId.trim() !== '';
                  const hasValidDate = record && record.date && typeof record.date === 'string' && record.date.match(/^\d{4}-\d{2}-\d{2}$/);

                  if (hasValidUserId && hasValidDate) {
                    const numId = Number(record.id);
                    const validId = (!isNaN(numId) && String(numId) === String(record.id)) ? numId : (record.id || Date.now());
                    v2Store.put({
                      id: validId,
                      userId: record.userId.trim(),
                      date: record.date.trim(),
                      time: record.time || '00:00',
                      content: record.content || '',
                      images: Array.isArray(record.images) ? record.images : []
                    });
                  } else {
                    console.warn('[DB Migration Quarantine] Isolating record with missing identity/date:', record);
                    quarantineStore.put({
                      migrationVersion: 6,
                      originalStore: 'memos',
                      originalKey: record ? record.id : null,
                      reason: (!hasValidUserId ? 'MISSING_USER_ID' : 'MISSING_DATE'),
                      quarantinedAt: new Date().toISOString(),
                      originalRecord: record || null
                    });
                  }
                  cursor.continue();
                } else {
                  console.log('[DB Migration] All old memo records migrated. Deleting legacy memos store.');
                  db.deleteObjectStore('memos');
                }
              };
            }
          }
        };
      } catch (err) {
        console.warn('IndexedDB not supported or blocked, switching to LocalStorage.', err);
        this.useLocalStorage = true;
        reject(err);
      }
    });
  }

  // ==================== 多角色 Key 轉換 Helper ====================
  static _getKey(date, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required");
    if (userId === 'user_a' || userId === 'guest') return date;
    return `${userId}_${date}`;
  }

  static _mapRecordBack(record, originalDate) {
    if (!record) return null;
    return { ...record, date: originalDate };
  }

  // ==================== 日記 (Diaries) CRUD ====================
  static async getDiary(date, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for getDiary");
    const key = this._getKey(date, userId);
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('diaries', 'readonly');
        const store = transaction.objectStore('diaries');
        const request = store.get(key);

        request.onsuccess = () => resolve(this._mapRecordBack(request.result, date));
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('getDiary IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const diaries = JSON.parse(localStorage.getItem('diary_diaries') || '{}');
        return this._mapRecordBack(diaries[key], date);
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        return this._mapRecordBack(this.memoryDiaries[key], date);
      }
    }
  }

  static async getAllDiaries(userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for getAllDiaries");
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('diaries', 'readonly');
        const store = transaction.objectStore('diaries');
        const request = store.getAll();

        request.onsuccess = () => {
          const records = request.result || [];
          const filtered = records
            .filter(r => {
              if (userId === 'user_a' || userId === 'guest') {
                return !r.date.includes('_');
              } else {
                return r.date.startsWith(`${userId}_`);
              }
            })
            .map(r => {
              const originalDate = (userId === 'user_a' || userId === 'guest') ? r.date : r.date.substring(userId.length + 1);
              return { ...r, date: originalDate };
            });
          resolve(filtered);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('getAllDiaries IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const diaries = JSON.parse(localStorage.getItem('diary_diaries') || '{}');
        const records = Object.values(diaries);
        return records
          .filter(r => {
            if (userId === 'user_a' || userId === 'guest') {
              return !r.date.includes('_');
            } else {
              return r.date.startsWith(`${userId}_`);
            }
          })
          .map(r => {
            const originalDate = (userId === 'user_a' || userId === 'guest') ? r.date : r.date.substring(userId.length + 1);
            return { ...r, date: originalDate };
          });
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        const records = Object.values(this.memoryDiaries);
        return records
          .filter(r => {
            if (userId === 'user_a' || userId === 'guest') {
              return !r.date.includes('_');
            } else {
              return r.date.startsWith(`${userId}_`);
            }
          })
          .map(r => {
            const originalDate = (userId === 'user_a' || userId === 'guest') ? r.date : r.date.substring(userId.length + 1);
            return { ...r, date: originalDate };
          });
      }
    }
  }

  static async saveDiary(diary, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for saveDiary");
    if (await this.isDateInArchivedCycle(diary.date, userId)) {
      throw new Error("[ReadOnlyCycleError] Cannot modify archived cycle entries: " + diary.date);
    }
    // 檢查並設定 startedAt 啟動三年旅程
    try {
      const user = await this.getUser(userId);
      if (user && !user.startedAt) {
        user.startedAt = diary.date;
        user.updatedAt = new Date().toISOString();
        await this.saveUser(user);
        
        // 初始化第一個三年週期區間
        const startYear = new Date(diary.date).getFullYear();
        localStorage.setItem(`cycle_start_date_${userId}`, diary.date);
        localStorage.setItem(`cycle_start_year_${userId}`, String(startYear));
      }
    } catch (e) {
      console.warn("Failed to update user startedAt in saveDiary:", e);
    }

    const key = this._getKey(diary.date, userId);
    const record = { ...diary, date: key };
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('diaries', 'readwrite');
        const store = transaction.objectStore('diaries');
        const request = store.put(record);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('saveDiary IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const diaries = JSON.parse(localStorage.getItem('diary_diaries') || '{}');
        diaries[key] = record;
        localStorage.setItem('diary_diaries', JSON.stringify(diaries));
        return diary.date;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        this.memoryDiaries[key] = record;
        return diary.date;
      }
    }
  }

  static async deleteMemosForDate(date, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for deleteMemosForDate");
    if (await this.isDateInArchivedCycle(date, userId)) {
      throw new Error("[ReadOnlyCycleError] Cannot modify archived cycle entries: " + date);
    }
    try {
      const db = await this.open();
      const memos = await this.getMemosForDate(date, userId);
      if (memos.length === 0) return true;

      const transaction = db.transaction('memos_v2', 'readwrite');
      const store = transaction.objectStore('memos_v2');
      
      await Promise.all(memos.map(memo => {
        return new Promise((resolve, reject) => {
          const numId = Number(memo.id);
          const validKey = (!isNaN(numId) && String(numId) === String(memo.id)) ? numId : memo.id;
          const req = store.delete([userId, validKey]);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      }));
      return true;
    } catch (err) {
      console.warn('deleteMemosForDate IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        let memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        memos = memos.filter(m => !(m.date === date && m.userId === userId));
        localStorage.setItem('diary_memos', JSON.stringify(memos));
        return true;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        this.memoryMemos = this.memoryMemos.filter(m => !(m.date === date && m.userId === userId));
        return true;
      }
    }
  }

  static async deleteDiary(date, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for deleteDiary");
    if (await this.isDateInArchivedCycle(date, userId)) {
      throw new Error("[ReadOnlyCycleError] Cannot modify archived cycle entries: " + date);
    }
    // 刪除日記的同時也刪除隨筆
    await this.deleteMemosForDate(date, userId);

    const key = this._getKey(date, userId);
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('diaries', 'readwrite');
        const store = transaction.objectStore('diaries');
        const request = store.delete(key);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('deleteDiary IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const diaries = JSON.parse(localStorage.getItem('diary_diaries') || '{}');
        delete diaries[key];
        localStorage.setItem('diary_diaries', JSON.stringify(diaries));
        return true;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        delete this.memoryDiaries[key];
        return true;
      }
    }
  }

  // ==================== 備忘錄 (Memos) CRUD ====================
  static async getMemosForDate(date, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for getMemosForDate");
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos_v2', 'readonly');
        const store = transaction.objectStore('memos_v2');
        const index = store.index('userId_date');
        const request = index.getAll([userId, date]);

        request.onsuccess = () => {
          let results = request.result || [];
          results.sort((a, b) => b.id - a.id);
          resolve(results);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('getMemosForDate IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        const filtered = memos.filter(m => m.date === date && m.userId === userId);
        filtered.sort((a, b) => b.id - a.id);
        return filtered;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        const filtered = this.memoryMemos.filter(m => m.date === date && m.userId === userId);
        filtered.sort((a, b) => b.id - a.id);
        return filtered;
      }
    }
  }

  static async saveMemo(memo, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for saveMemo");
    if (memo && memo.date && await this.isDateInArchivedCycle(memo.date, userId)) {
      throw new Error("[ReadOnlyCycleError] Cannot modify archived cycle entries: " + memo.date);
    }
    const validUserId = memo.userId || userId;
    let validId = memo.id;
    if (validId === undefined || validId === null || validId === '') {
      validId = Date.now();
    } else {
      const numId = Number(validId);
      if (!isNaN(numId) && String(numId) === String(validId)) validId = numId;
    }
    const record = { ...memo, id: validId, userId: validUserId };
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos_v2', 'readwrite');
        const store = transaction.objectStore('memos_v2');
        const request = store.put(record);

        transaction.oncomplete = () => resolve(record.id);
        transaction.onerror = () => reject(transaction.error || request.error);
      });
    } catch (err) {
      console.warn('saveMemo IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        if (record.id) {
          const idx = memos.findIndex(m => String(m.id) === String(record.id) && m.userId === record.userId);
          if (idx !== -1) memos[idx] = record;
          else memos.push(record);
        } else {
          record.id = Date.now();
          memos.push(record);
        }
        localStorage.setItem('diary_memos', JSON.stringify(memos));
        return record.id;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        if (record.id) {
          const idx = this.memoryMemos.findIndex(m => String(m.id) === String(record.id) && m.userId === record.userId);
          if (idx !== -1) this.memoryMemos[idx] = record;
          else this.memoryMemos.push(record);
        } else {
          record.id = Date.now();
          this.memoryMemos.push(record);
        }
        return record.id;
      }
    }
  }

  static async saveMemos(memosArray, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for saveMemos");
    for (const memo of memosArray) {
      if (memo && memo.date && await this.isDateInArchivedCycle(memo.date, userId)) {
        throw new Error("[ReadOnlyCycleError] Cannot modify archived cycle entries: " + memo.date);
      }
    }
    if (!Array.isArray(memosArray) || memosArray.length === 0) return true;
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos_v2', 'readwrite');
        const store = transaction.objectStore('memos_v2');
        for (const memo of memosArray) {
          const validUserId = memo.userId || userId;
          let validId = memo.id;
          if (validId === undefined || validId === null || validId === '') {
            validId = Date.now();
          } else {
            const numId = Number(validId);
            if (!isNaN(numId) && String(numId) === String(validId)) validId = numId;
          }
          store.put({ ...memo, id: validId, userId: validUserId });
        }
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (err) {
      for (const memo of memosArray) {
        await this.saveMemo(memo, userId);
      }
      return true;
    }
  }

  static async deleteMemo(id, userId) {
    if (id === undefined || id === null) return true;
    if (!userId) throw new Error("[DiaryDB] userId is required for deleteMemo");
    const memo = await this.getMemo(id, userId);
    if (memo && memo.date && await this.isDateInArchivedCycle(memo.date, userId)) {
      throw new Error("[ReadOnlyCycleError] Cannot modify archived cycle entries: " + memo.date);
    }
    const numId = Number(id);
    const validId = (!isNaN(numId) && String(numId) === String(id)) ? numId : id;
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos_v2', 'readwrite');
        const store = transaction.objectStore('memos_v2');
        const request = store.delete([userId, validId]);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('deleteMemo IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        let memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        memos = memos.filter(m => !(String(m.id) === String(id) && m.userId === userId));
        localStorage.setItem('diary_memos', JSON.stringify(memos));
        return true;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        this.memoryMemos = this.memoryMemos.filter(m => !(String(m.id) === String(id) && m.userId === userId));
        return true;
      }
    }
  }

  static async clearUserData(userId = 'user_a') {
    // 1. 清除 LocalStorage 中該使用者的對應鍵值及 Hybrid 儲存內容
    try {
      const isUserB = userId === 'user_b';
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        
        if (isUserB && key.startsWith('user_b_')) {
          keysToRemove.push(key);
        } else if (!isUserB && !key.startsWith('user_b_') && (key.match(/^\d{4}-\d{2}-\d{2}$/) || key.startsWith('memos_') || key === 'partner_links' || key === 'partner_invite_codes')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      // 清除 LocalStorage 中的 diary_diaries 內容
      const diariesStr = localStorage.getItem('diary_diaries');
      if (diariesStr) {
        const diaries = JSON.parse(diariesStr);
        const newDiaries = {};
        Object.keys(diaries).forEach(k => {
          const isUserBKey = k.startsWith('user_b_');
          if (isUserB && !isUserBKey) {
            newDiaries[k] = diaries[k]; // 保留 User A 的日記
          } else if (!isUserB && isUserBKey) {
            newDiaries[k] = diaries[k]; // 保留 User B 的日記
          }
        });
        localStorage.setItem('diary_diaries', JSON.stringify(newDiaries));
      }

      // 清除 LocalStorage 中的 diary_memos 內容
      const memosStr = localStorage.getItem('diary_memos');
      if (memosStr) {
        const memos = JSON.parse(memosStr);
        const newMemos = memos.filter(m => {
          const memoUser = m.userId || 'user_a';
          return memoUser !== userId;
        });
        localStorage.setItem('diary_memos', JSON.stringify(newMemos));
      }

      // 3. 清除記憶體快取內容 (Memory Fallback Cache)
      Object.keys(this.memoryDiaries).forEach(k => {
        const isUserBKey = k.startsWith('user_b_');
        if (isUserB && isUserBKey) {
          delete this.memoryDiaries[k];
        } else if (!isUserB && !isUserBKey) {
          delete this.memoryDiaries[k];
        }
      });

      this.memoryMemos = this.memoryMemos.filter(m => {
        const memoUser = m.userId || 'user_a';
        return memoUser !== userId;
      });
    } catch (lsErr) {
      console.warn('LocalStorage clear block ignored:', lsErr);
    }

    // 2. 清除 IndexedDB
    try {
      const db = await this.open();
      const storesToClear = ['diaries'];
      if (db.objectStoreNames.contains('memos_v2')) storesToClear.push('memos_v2');
      else if (db.objectStoreNames.contains('memos')) storesToClear.push('memos');

      const transaction = db.transaction(storesToClear, 'readwrite');
      const diaryStore = transaction.objectStore('diaries');
      const memoStore = storesToClear.includes('memos_v2') ? transaction.objectStore('memos_v2') : (storesToClear.includes('memos') ? transaction.objectStore('memos') : null);
      
      // 清除日記 Store
      await new Promise((resolve, reject) => {
        const request = diaryStore.openKeyCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const key = cursor.primaryKey;
            const isUserBKey = typeof key === 'string' && key.startsWith('user_b_');
            if (userId === 'user_b' && isUserBKey) {
              diaryStore.delete(key);
            } else if (userId === 'user_a' && !isUserBKey) {
              diaryStore.delete(key);
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });

      // 清除隨筆 Store
      if (memoStore) {
        await new Promise((resolve, reject) => {
          const request = memoStore.openCursor();
          request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const memo = cursor.value;
              const memoUser = memo ? (memo.userId || 'user_a') : '';
              if (memoUser === userId) {
                memoStore.delete(cursor.primaryKey);
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          request.onerror = () => reject(request.error);
        });
      }
    } catch (dbErr) {
      console.warn('IndexedDB clear userData fallback to LocalStorage/memory:', dbErr);
    }
  }

  static async clearCycleData(userId, startYear, endYear) {
    if (!userId) throw new Error("[DiaryDB] userId is required for clearCycleData");
    
    // 1. LocalStorage
    try {
      const isUserB = userId === 'user_b';
      const diariesStr = localStorage.getItem('diary_diaries');
      if (diariesStr) {
        const diaries = JSON.parse(diariesStr);
        const newDiaries = {};
        Object.keys(diaries).forEach(k => {
          const isUserBKey = k.startsWith('user_b_');
          if ((isUserB && isUserBKey) || (!isUserB && !isUserBKey)) {
            const datePart = isUserBKey ? k.replace('user_b_', '') : k;
            const y = Number(datePart.split('-')[0]);
            if (y < startYear || y > endYear) {
              newDiaries[k] = diaries[k];
            }
          } else {
            newDiaries[k] = diaries[k];
          }
        });
        localStorage.setItem('diary_diaries', JSON.stringify(newDiaries));
      }

      const memosStr = localStorage.getItem('diary_memos');
      if (memosStr) {
        const memos = JSON.parse(memosStr);
        const newMemos = memos.filter(m => {
          const memoUser = m.userId || 'user_a';
          if (memoUser === userId) {
            const y = Number(m.date.split('-')[0]);
            return y < startYear || y > endYear;
          }
          return true;
        });
        localStorage.setItem('diary_memos', JSON.stringify(newMemos));
      }
    } catch (lsErr) {
      console.warn('LocalStorage clearCycleData fallback:', lsErr);
    }

    // 2. Memory caches
    try {
      const isUserB = userId === 'user_b';
      Object.keys(this.memoryDiaries).forEach(k => {
        const isUserBKey = k.startsWith('user_b_');
        if ((isUserB && isUserBKey) || (!isUserB && !isUserBKey)) {
          const datePart = isUserBKey ? k.replace('user_b_', '') : k;
          const y = Number(datePart.split('-')[0]);
          if (y >= startYear && y <= endYear) {
            delete this.memoryDiaries[k];
          }
        }
      });

      this.memoryMemos = this.memoryMemos.filter(m => {
        const memoUser = m.userId || 'user_a';
        if (memoUser === userId) {
          const y = Number(m.date.split('-')[0]);
          return y < startYear || y > endYear;
        }
        return true;
      });
    } catch (memErr) {
      console.warn('Memory Cache clearCycleData fallback:', memErr);
    }

    // 3. IndexedDB
    try {
      const db = await this.open();
      const storesToClear = ['diaries'];
      if (db.objectStoreNames.contains('memos_v2')) storesToClear.push('memos_v2');
      else if (db.objectStoreNames.contains('memos')) storesToClear.push('memos');

      const transaction = db.transaction(storesToClear, 'readwrite');
      const diaryStore = transaction.objectStore('diaries');
      const memoStore = storesToClear.includes('memos_v2') ? transaction.objectStore('memos_v2') : (storesToClear.includes('memos') ? transaction.objectStore('memos') : null);

      await new Promise((resolve, reject) => {
        const request = diaryStore.openKeyCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const key = cursor.primaryKey;
            const isUserBKey = typeof key === 'string' && key.startsWith('user_b_');
            if ((userId === 'user_b' && isUserBKey) || (userId === 'user_a' && !isUserBKey)) {
              const datePart = isUserBKey ? key.replace('user_b_', '') : key;
              const y = Number(datePart.split('-')[0]);
              if (y >= startYear && y <= endYear) {
                diaryStore.delete(key);
              }
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });

      if (memoStore) {
        await new Promise((resolve, reject) => {
          const request = memoStore.openCursor();
          request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const memo = cursor.value;
              const memoUser = memo ? (memo.userId || 'user_a') : '';
              if (memoUser === userId) {
                const y = Number(memo.date.split('-')[0]);
                if (y >= startYear && y <= endYear) {
                  memoStore.delete(cursor.primaryKey);
                }
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          request.onerror = () => reject(request.error);
        });
      }
    } catch (dbErr) {
      console.warn('IndexedDB clearCycleData error:', dbErr);
    }
  }

  static async getCompletedDiariesCount(userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for getCompletedDiariesCount");
    const all = await this.getAllDiaries(userId);
    let count = 0;
    all.forEach(d => {
      if (d && d.content && d.content.trim()) {
        count++;
      }
    });
    return count;
  }

  static async getAllMemos(userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for getAllMemos");
    try {
      const db = await this.open();
      const storeName = db.objectStoreNames.contains('memos_v2') ? 'memos_v2' : 'memos';
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      
      return await new Promise((resolve, reject) => {
        const memos = [];
        const request = store.openCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const memo = cursor.value;
            if (memo && memo.userId === userId) {
              memos.push(memo);
            }
            cursor.continue();
          } else {
            resolve(memos);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('getAllMemos failed, falling back to LocalStorage:', err);
      let memos = [];
      try {
        memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
      } catch (lsErr) {}
      return memos.filter(m => m.userId === userId);
    }
  }

  // ==================== 使用者 (Users) CRUD ====================
  static async getUser(userId) {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('users', 'readonly');
        const store = transaction.objectStore('users');
        const request = store.get(userId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('getUser IndexedDB failed, trying LocalStorage:', err);
      try {
        const userStr = localStorage.getItem(`user_profile_${userId}`);
        return userStr ? JSON.parse(userStr) : null;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        return this.memoryUsers[userId] || null;
      }
    }
  }

  static async saveUser(user) {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('users', 'readwrite');
        const store = transaction.objectStore('users');
        const request = store.put(user);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('saveUser IndexedDB failed, trying LocalStorage:', err);
      try {
        localStorage.setItem(`user_profile_${user.id}`, JSON.stringify(user));
        return user.id;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        this.memoryUsers[user.id] = user;
        return user.id;
      }
    }
  }

  static async deleteUser(userId) {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('users', 'readwrite');
        const store = transaction.objectStore('users');
        const request = store.delete(userId);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('deleteUser IndexedDB failed, trying LocalStorage:', err);
      try {
        localStorage.removeItem(`user_profile_${userId}`);
        return true;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        delete this.memoryUsers[userId];
        return true;
      }
    }
  }

  static async getMemo(id, userId) {
    if (!userId) throw new Error("[DiaryDB] userId is required for getMemo");
    const numId = Number(id);
    const validId = (!isNaN(numId) && String(numId) === String(id)) ? numId : id;
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos_v2', 'readonly');
        const store = transaction.objectStore('memos_v2');
        const request = store.get([userId, validId]);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      try {
        const memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        return memos.find(m => String(m.id) === String(id) && m.userId === userId) || null;
      } catch (lsErr) {
        return this.memoryMemos.find(m => String(m.id) === String(id) && m.userId === userId) || null;
      }
    }
  }

  static async isDateInArchivedCycle(dateStr, userId) {
    if (!userId) return false;
    const user = await this.getUser(userId);
    let activeCycleStartYear;
    if (user && user.activeCycleStartYear) {
      activeCycleStartYear = Number(user.activeCycleStartYear);
    } else {
      const activeYear = localStorage.getItem(`active_cycle_start_year_${userId}`);
      if (activeYear) {
        activeCycleStartYear = Number(activeYear);
      } else {
        const startYear = localStorage.getItem(`cycle_start_year_${userId}`);
        if (startYear) {
          activeCycleStartYear = Number(startYear);
        } else {
          if (user && user.startedAt) {
            activeCycleStartYear = Number(user.startedAt.split('-')[0]);
          } else {
            activeCycleStartYear = 2024;
          }
        }
      }
    }
    const year = Number(dateStr.split('-')[0]);
    return year < activeCycleStartYear;
  }

  static async saveArchive(archive, userId) {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('archives', 'readwrite');
        const store = transaction.objectStore('archives');
        const request = store.put(archive);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('saveArchive IndexedDB failed, trying LocalStorage:', err);
      try {
        const archives = JSON.parse(localStorage.getItem('diary_archives') || '[]');
        const idx = archives.findIndex(a => a.id === archive.id);
        if (idx !== -1) {
          archives[idx] = archive;
        } else {
          archives.push(archive);
        }
        localStorage.setItem('diary_archives', JSON.stringify(archives));
        return archive.id;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        if (!this.memoryArchives) this.memoryArchives = [];
        const idx = this.memoryArchives.findIndex(a => a.id === archive.id);
        if (idx !== -1) {
          this.memoryArchives[idx] = archive;
        } else {
          this.memoryArchives.push(archive);
        }
        return archive.id;
      }
    }
  }

  static async getAllArchives(userId) {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('archives', 'readonly');
        const store = transaction.objectStore('archives');
        const request = store.getAll();
        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.filter(a => a.userId === userId));
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('getAllArchives IndexedDB failed, trying LocalStorage:', err);
      try {
        const archives = JSON.parse(localStorage.getItem('diary_archives') || '[]');
        return archives.filter(a => a.userId === userId);
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        if (!this.memoryArchives) this.memoryArchives = [];
        return this.memoryArchives.filter(a => a.userId === userId);
      }
    }
  }
}

window.DiaryDB = DiaryDB;
