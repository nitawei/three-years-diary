/**
 * db.js - 三年日記 Hybrid 儲存管理器 (IndexedDB + LocalStorage + 記憶體虛擬快取 三重安全機制)
 */

const DB_NAME = 'ThreeYearDiaryDB';
const DB_VERSION = 5;

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

        request.onerror = () => {
          console.warn('IndexedDB open failed, switching to LocalStorage.', request.error);
          this.useLocalStorage = true;
          reject(request.error);
        };

        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (e) => {
          const db = request.result;

          // 1. 日記 Store：以日期為 Key (YYYY-MM-DD)
          if (!db.objectStoreNames.contains('diaries')) {
            db.createObjectStore('diaries', { keyPath: 'date' });
          }

          // 2. 備忘錄 Store：自動生成自增 ID，建立 date 索引方便查詢單日所有隨筆
          if (!db.objectStoreNames.contains('memos')) {
            const memoStore = db.createObjectStore('memos', { keyPath: 'id', autoIncrement: true });
            memoStore.createIndex('date', 'date', { unique: false });
          }

          // 3. 使用者 Store：以 id 為 Key
          if (!db.objectStoreNames.contains('users')) {
            db.createObjectStore('users', { keyPath: 'id' });
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
  static _getKey(date, userId = 'user_a') {
    if (!userId || userId === 'user_a') return date;
    return `${userId}_${date}`;
  }

  static _mapRecordBack(record, originalDate) {
    if (!record) return null;
    return { ...record, date: originalDate };
  }

  // ==================== 日記 (Diaries) CRUD ====================
  static async getDiary(date, userId = 'user_a') {
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

  static async getAllDiaries(userId = 'user_a') {
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
              if (userId === 'user_a') {
                return !r.date.includes('_');
              } else {
                return r.date.startsWith(`${userId}_`);
              }
            })
            .map(r => {
              const originalDate = userId === 'user_a' ? r.date : r.date.substring(userId.length + 1);
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
            if (userId === 'user_a') {
              return !r.date.includes('_');
            } else {
              return r.date.startsWith(`${userId}_`);
            }
          })
          .map(r => {
            const originalDate = userId === 'user_a' ? r.date : r.date.substring(userId.length + 1);
            return { ...r, date: originalDate };
          });
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        const records = Object.values(this.memoryDiaries);
        return records
          .filter(r => {
            if (userId === 'user_a') {
              return !r.date.includes('_');
            } else {
              return r.date.startsWith(`${userId}_`);
            }
          })
          .map(r => {
            const originalDate = userId === 'user_a' ? r.date : r.date.substring(userId.length + 1);
            return { ...r, date: originalDate };
          });
      }
    }
  }

  static async saveDiary(diary, userId = 'user_a') {
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

  static async deleteMemosForDate(date, userId = 'user_a') {
    try {
      const db = await this.open();
      const memos = await this.getMemosForDate(date, userId);
      if (memos.length === 0) return true;

      const transaction = db.transaction('memos', 'readwrite');
      const store = transaction.objectStore('memos');
      
      await Promise.all(memos.map(memo => {
        return new Promise((resolve, reject) => {
          const req = store.delete(Number(memo.id));
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
        memos = memos.filter(m => !(m.date === date && (m.userId || 'user_a') === userId));
        localStorage.setItem('diary_memos', JSON.stringify(memos));
        return true;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        this.memoryMemos = this.memoryMemos.filter(m => !(m.date === date && (m.userId || 'user_a') === userId));
        return true;
      }
    }
  }

  static async deleteDiary(date, userId = 'user_a') {
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
  static async getMemosForDate(date, userId = 'user_a') {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos', 'readonly');
        const store = transaction.objectStore('memos');
        const index = store.index('date');
        const request = index.getAll(date);

        request.onsuccess = () => {
          let results = request.result || [];
          results = results.filter(m => (m.userId || 'user_a') === userId);
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
        const filtered = memos.filter(m => m.date === date && (m.userId || 'user_a') === userId);
        filtered.sort((a, b) => b.id - a.id);
        return filtered;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        const filtered = this.memoryMemos.filter(m => m.date === date && (m.userId || 'user_a') === userId);
        filtered.sort((a, b) => b.id - a.id);
        return filtered;
      }
    }
  }

  static async saveMemo(memo, userId = 'user_a') {
    const record = { ...memo, userId: memo.userId || userId || 'user_a' };
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos', 'readwrite');
        const store = transaction.objectStore('memos');
        const request = store.put(record);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('saveMemo IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        const memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        if (record.id) {
          // 更新 (Edit)
          const idx = memos.findIndex(m => m.id === record.id);
          if (idx !== -1) {
            memos[idx] = record;
          }
        } else {
          // 新增 (Create)
          const nextId = memos.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1;
          record.id = nextId;
          memos.push(record);
        }
        localStorage.setItem('diary_memos', JSON.stringify(memos));
        return record.id;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        if (record.id) {
          // 更新 (Edit)
          const idx = this.memoryMemos.findIndex(m => m.id === record.id);
          if (idx !== -1) {
            this.memoryMemos[idx] = record;
          }
        } else {
          // 新增 (Create)
          const nextId = this.memoryMemos.reduce((max, m) => Math.max(max, m.id || 0), 0) + 1;
          record.id = nextId;
          this.memoryMemos.push(record);
        }
        return record.id;
      }
    }
  }

  static async deleteMemo(id) {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('memos', 'readwrite');
        const store = transaction.objectStore('memos');
        const request = store.delete(Number(id));

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.warn('deleteMemo IndexedDB failed, trying LocalStorage:', err);
      this.useLocalStorage = true;
      try {
        let memos = JSON.parse(localStorage.getItem('diary_memos') || '[]');
        memos = memos.filter(m => m.id !== Number(id));
        localStorage.setItem('diary_memos', JSON.stringify(memos));
        return true;
      } catch (lsErr) {
        console.warn('LocalStorage blocked, using memory fallback:', lsErr);
        this.memoryMemos = this.memoryMemos.filter(m => m.id !== Number(id));
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
      const transaction = db.transaction(['diaries', 'memos'], 'readwrite');
      const diaryStore = transaction.objectStore('diaries');
      const memoStore = transaction.objectStore('memos');
      
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
      await new Promise((resolve, reject) => {
        const request = memoStore.openCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const memo = cursor.value;
            const memoUser = memo.userId || 'user_a';
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
    } catch (dbErr) {
      console.warn('IndexedDB clear userData fallback to LocalStorage/memory:', dbErr);
    }
  }

  static async getCompletedDiariesCount(userId = 'user_a') {
    const all = await this.getAllDiaries(userId);
    let count = 0;
    all.forEach(d => {
      if (d && d.content && d.content.trim()) {
        count++;
      }
    });
    return count;
  }

  static async getAllMemos(userId = 'user_a') {
    try {
      const db = await this.open();
      const transaction = db.transaction('memos', 'readonly');
      const store = transaction.objectStore('memos');
      
      return await new Promise((resolve, reject) => {
        const memos = [];
        const request = store.openCursor();
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const memo = cursor.value;
            const memoUser = memo.userId || 'user_a';
            if (memoUser === userId) {
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
      return memos.filter(m => (m.userId || 'user_a') === userId);
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
}

window.DiaryDB = DiaryDB;
