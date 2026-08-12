/**
 * update-manager.js - PWA Update Manager (Phase 2A Safe Version)
 * Background check for new app version without affecting Firebase, IndexedDB, or Sync.
 */
(function() {
  const CURRENT_APP_VERSION = "1.2.0";

  const UpdateManager = {
    currentVersion: CURRENT_APP_VERSION,
    waitingWorker: null,

    initSWListener() {
      if (!('serviceWorker' in navigator)) return;

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          console.log('[UpdateManager] Service Worker controller changed. Reloading page smoothly...');
          window.location.reload();
        }
      });

      navigator.serviceWorker.getRegistration().then(reg => {
        if (!reg) return;

        if (reg.waiting) {
          this.waitingWorker = reg.waiting;
          console.log('[UpdateManager] Found existing waiting Service Worker.');
          this.checkForUpdate();
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.waitingWorker = newWorker;
              console.log('[UpdateManager] New Service Worker installed and waiting.');
              this.checkForUpdate();
            }
          });
        });
      });
    },

    async checkForUpdate() {
      try {
        // Non-blocking fetch with no-store cache control
        const response = await fetch(`./version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });

        if (!response.ok) return;
        const data = await response.json();
        
        if ((data && data.version && data.version !== CURRENT_APP_VERSION) || this.waitingWorker) {
          console.log(`[UpdateManager] New version detected! Current: ${CURRENT_APP_VERSION}, Server: ${data ? data.version : 'SW waiting'}`);
          this.showUpdateModal();
        } else {
          console.log(`[UpdateManager] App is up to date (${CURRENT_APP_VERSION}).`);
        }
      } catch (err) {
        console.warn('[UpdateManager] Version check failed (silent fallback):', err);
      }
    },

    applyUpdate() {
      if (this.waitingWorker) {
        console.log('[UpdateManager] Sending SKIP_WAITING to waiting Service Worker...');
        this.waitingWorker.postMessage({ action: 'SKIP_WAITING' });
      } else {
        console.log('[UpdateManager] No waiting worker found, reloading directly...');
        window.location.reload();
      }
    },

    showUpdateModal() {
      // Prevent duplicate modals
      if (document.getElementById('pwa-update-modal')) return;

      const modalOverlay = document.createElement('div');
      modalOverlay.id = 'pwa-update-modal';
      modalOverlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif;
        padding: 20px;
        box-sizing: border-box;
      `;

      const modalSheet = document.createElement('div');
      modalSheet.style.cssText = `
        background-color: var(--color-card-bg, #fcfaf2);
        border: 1px solid var(--color-border, #e5e0d8);
        border-radius: 16px;
        padding: 26px 20px 22px 20px;
        max-width: 320px;
        width: 100%;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        box-sizing: border-box;
      `;

      modalSheet.innerHTML = `
        <h3 style="margin: 0 0 6px 0; font-size: 1.18rem; font-weight: 700; color: var(--color-text-main, #2b2b2b); letter-spacing: 0.02em;">1095 Diary 有新版本</h3>
        <div style="display: inline-block; padding: 2px 10px; border-radius: 12px; background-color: rgba(138, 154, 134, 0.15); color: var(--color-mood-green, #61735d); font-size: 0.78rem; font-weight: 700; font-family: 'Outfit', -apple-system, sans-serif; margin-bottom: 16px;">v1.2.0 · Emoji 支援</div>
        <div style="background-color: rgba(0, 0, 0, 0.02); border: 1px dashed var(--color-border, #e5e0d8); border-radius: 12px; padding: 12px 14px; margin-bottom: 20px; text-align: left;">
          <div style="font-size: 0.9rem; font-weight: 700; color: var(--color-text-main, #2b2b2b); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <span>🌱</span><span>現在可以在日記中使用 Emoji 啦！</span>
          </div>
          <p style="margin: 0; font-size: 0.82rem; color: var(--color-text-sub, #666); line-height: 1.5;">
            支援表情符號、膚色修飾、國旗與複合 Emoji。<br>每個 Emoji 都會精準計算為 1 個字，也會完整佔用一格稿紙。
          </p>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
          <button id="btn-update-now" style="width: 100%; padding: 12px; border: none; border-radius: 24px; background-color: var(--color-text-main, #2b2b2b); color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s;">立即更新</button>
          <button id="btn-update-later" style="width: 100%; padding: 8px; border: none; background: none; color: var(--color-text-sub, #666); font-size: 0.88rem; cursor: pointer;">稍後提醒</button>
        </div>
      `;

      modalOverlay.appendChild(modalSheet);
      document.body.appendChild(modalOverlay);

      document.getElementById('btn-update-now').addEventListener('click', () => {
        this.applyUpdate();
      });

      document.getElementById('btn-update-later').addEventListener('click', () => {
        modalOverlay.remove();
      });
    }
  };

  window.UpdateManager = UpdateManager;

  // Initialize Service Worker lifecycle listener and version check
  if (document.readyState === 'complete') {
    setTimeout(() => {
      UpdateManager.initSWListener();
      UpdateManager.checkForUpdate();
    }, 2000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => {
        UpdateManager.initSWListener();
        UpdateManager.checkForUpdate();
      }, 2000);
    });
  }
})();
