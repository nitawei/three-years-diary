/**
 * update-manager.js - PWA Update Manager (Safe Version)
 * Background check for new app version without affecting Firebase, IndexedDB, or Sync.
 */
(function() {
  const CURRENT_APP_VERSION = "1.1.0";

  const UpdateManager = {
    currentVersion: CURRENT_APP_VERSION,

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
        
        if (data && data.version && data.version !== CURRENT_APP_VERSION) {
          console.log(`[UpdateManager] New version detected! Current: ${CURRENT_APP_VERSION}, Server: ${data.version}`);
          this.showUpdateModal();
        } else {
          console.log(`[UpdateManager] App is up to date (${CURRENT_APP_VERSION}).`);
        }
      } catch (err) {
        console.warn('[UpdateManager] Version check failed (silent fallback):', err);
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
        padding: 28px 24px;
        max-width: 320px;
        width: 100%;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        box-sizing: border-box;
      `;

      modalSheet.innerHTML = `
        <h3 style="margin: 0 0 10px 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-main, #2b2b2b);">三年日記有新版本</h3>
        <p style="margin: 0 0 24px 0; font-size: 0.92rem; color: var(--color-text-sub, #666); line-height: 1.5;">更新後即可使用最新功能。</p>
        <div style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
          <button id="btn-update-now" style="width: 100%; padding: 12px; border: none; border-radius: 24px; background-color: var(--color-text-main, #2b2b2b); color: #fff; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: opacity 0.2s;">立即更新</button>
          <button id="btn-update-later" style="width: 100%; padding: 10px; border: none; background: none; color: var(--color-text-sub, #666); font-size: 0.88rem; cursor: pointer;">稍後提醒</button>
        </div>
      `;

      modalOverlay.appendChild(modalSheet);
      document.body.appendChild(modalOverlay);

      document.getElementById('btn-update-now').addEventListener('click', () => {
        window.location.reload();
      });

      document.getElementById('btn-update-later').addEventListener('click', () => {
        modalOverlay.remove();
      });
    }
  };

  window.UpdateManager = UpdateManager;

  // Background non-blocking version check after window load
  if (document.readyState === 'complete') {
    setTimeout(() => UpdateManager.checkForUpdate(), 2000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => UpdateManager.checkForUpdate(), 2000);
    });
  }
})();
