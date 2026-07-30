// firebase-sync.js - Firebase integration layer for time travel diary vanilla app
(function() {
  console.log('[1095 BUILD]', '1435544');
  const TODAY_DATE_STR = (new Date(Date.now() - new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 10);

  // Clear any existing mock offline sessions on startup to force users to sign in with Google
  try {
    const sessionStr = localStorage.getItem('next_auth_session');
    if (sessionStr) {
      const session = JSON.parse(sessionStr);
      if (session && session.userId && (session.userId === 'user_a' || session.userId === 'user_b' || (session.userId.startsWith('user_') && session.userId !== 'sandbox_test_user_id'))) {
        console.log("[Firebase Auth] Clearing legacy mock session:", session.userId);
        localStorage.removeItem('next_auth_session');
      }
    }
  } catch (e) {
    console.error("Error clearing mock session:", e);
  }

  let partnerUnsubscribe = null;
  let partnerDiariesUnsubscribe = null;
  let partnerMemosUnsubscribe = null;

  // Local memory cache for partner info
  let currentPartnerId = null;
  let currentConnectedAt = null;

  // Handle Redirect Result on Startup (for Safari PWA / mobile redirect login)
  if (window.auth && typeof firebase !== 'undefined') {
    window.auth.getRedirectResult().then(async (result) => {
      if (result && result.user) {
        console.log("[Firebase Auth] Redirect login successful:", result.user.uid);
      }
    }).catch((error) => {
      console.error("[Firebase Auth] Redirect login error:", error);
      alert("重導向登入失敗：" + (error.message || error.code || error));
    });
  }

  // Hook into Auth State Changes
  window.auth.onAuthStateChanged(async (user) => {
    if (user) {
      console.log("[Firebase Auth] User logged in:", user.uid);
      
      // Update session in LocalStorage for compatibility with mock routing guard
      setSessionCompat(user.uid, user.email, 'google');
      
      // Update State variables
      State.currentUser = user.uid;
      
      // Check if user has nickname profile in Firestore
      try {
        const userDoc = await window.db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
          const profile = userDoc.data();
          console.log("[Firebase Auth] User profile found:", profile);
          
          // Save user profile locally to IndexedDB
          await DiaryDB.saveUser({
            id: user.uid,
            displayName: profile.displayName,
            email: user.email,
            provider: 'google',
            createdAt: profile.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: profile.startedAt || TODAY_DATE_STR
          });

          const startYear = new Date(profile.startedAt || TODAY_DATE_STR).getFullYear();
          localStorage.setItem(`cycle_start_year_${user.uid}`, String(startYear));
          localStorage.setItem(`cycle_start_date_${user.uid}`, profile.startedAt || TODAY_DATE_STR);

          // Download all diaries and memos from Firestore for this user
          await syncAllFromFirestore(user.uid);

          // Subscribe to partner info updates
          startPartnerInfoListener(user.uid);
          
          // Process any pending local sync items to Firestore
          if (window.SyncManager) window.SyncManager.processQueue();
          
          // Redirect to today if currently on login/onboarding
          if (window.location.hash === '#login' || window.location.hash === '#onboarding' || window.location.hash === '#splash') {
            window.location.hash = 'today';
          } else {
            // Reload page data
            await window.loadTodayData();
          }
        } else {
          console.log("[Firebase Auth] No user profile found. Redirecting to onboarding...");
          window.location.hash = 'onboarding';
        }
      } catch (err) {
        console.error("[Firebase Auth] Error fetching user profile:", err);
        try {
          const localUser = await DiaryDB.getUser(user.uid);
          if (localUser && localUser.displayName) {
            console.log("[Firebase Auth] Graceful fallback: local user found, redirecting to today");
            if (window.location.hash === '#login' || window.location.hash === '#onboarding' || window.location.hash === '#splash') {
              window.location.hash = 'today';
            } else {
              await window.loadTodayData();
            }
          } else {
            console.log("[Firebase Auth] Graceful fallback: no local user, redirecting to onboarding");
            window.location.hash = 'onboarding';
          }
        } catch (localErr) {
          console.error("[Firebase Auth] Local fallback failed:", localErr);
          window.location.hash = 'onboarding';
        }
      }
    } else {
      console.log("[Firebase Auth] User logged out.");
      clearSessionCompat();
      stopAllListeners();
      
      // Redirect to login if on protected pages
      if (window.location.hash !== '#login' && window.location.hash !== '#splash') {
        window.location.hash = 'login';
      }
    }
  });

  // Set Local Mock Session for Compatibility
  function setSessionCompat(userId, email, provider) {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    const session = {
      userId,
      user: { id: userId, email, provider },
      expires: expires.toISOString()
    };
    localStorage.setItem('next_auth_session', JSON.stringify(session));
  }

  // Clear Local Mock Session
  function clearSessionCompat() {
    localStorage.removeItem('next_auth_session');
  }

  // Stop All Active Listeners
  function stopAllListeners() {
    if (partnerUnsubscribe) { partnerUnsubscribe(); partnerUnsubscribe = null; }
    if (partnerDiariesUnsubscribe) { partnerDiariesUnsubscribe(); partnerDiariesUnsubscribe = null; }
    if (partnerMemosUnsubscribe) { partnerMemosUnsubscribe(); partnerMemosUnsubscribe = null; }
    currentPartnerId = null;
    currentConnectedAt = null;
  }

  // Push all local user diaries from IndexedDB up to Cloud Firestore (Ensure no unsynced local data)
  async function pushLocalDiariesToFirestore(uid) {
    if (!uid || !window.db) return;
    console.log("[Sync Push] Scanning local diaries to upload to Cloud Firestore...");
    try {
      if (window.SyncManager && window.SyncManager.processQueue) {
        await window.SyncManager.processQueue();
      }

      const userDiaries = await DiaryDB.getAllDiaries(uid);
      const mockDiaries = (uid !== 'user_a') ? await DiaryDB.getAllDiaries('user_a') : [];
      const allLocalDiaries = [...userDiaries, ...mockDiaries];

      for (const d of allLocalDiaries) {
        if (d && d.date && d.content && d.content.trim()) {
          console.log(`[Sync Push] Uploading local diary for date ${d.date} to Cloud Firestore...`);
          await window.db.collection('users').doc(uid).collection('diaries').doc(d.date).set({
            date: d.date,
            content: d.content,
            mood: d.mood || 'none',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }
      }
      console.log("[Sync Push] All local diaries uploaded to Cloud Firestore successfully.");
    } catch (err) {
      console.error("[Sync Push] Failed pushing local diaries to Cloud Firestore:", err);
    }
  }

  // Sync All user diaries & memos from Firestore to IndexedDB (One-time on login)
  async function syncAllFromFirestore(uid) {
    console.log("[Sync] Pulling diaries and memos from Firestore...");
    try {
      // 1. First upload any local unsynced diaries to Cloud Firestore
      await pushLocalDiariesToFirestore(uid);

      // 2. Sync diaries
      const diariesSnap = await window.db.collection('users').doc(uid).collection('diaries').get();
      diariesSnap.forEach(async (doc) => {
        const data = doc.data();
        await DiaryDB.saveDiary({
          date: doc.id,
          content: data.content,
          mood: data.mood,
          timestamp: data.updatedAt ? (typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : new Date().toISOString()) : new Date().toISOString()
        }, uid);
      });

      // Sync memos
      const memosSnap = await window.db.collection('users').doc(uid).collection('memos').get();
      memosSnap.forEach(async (doc) => {
        const data = doc.data();
        await DiaryDB.saveMemo({
          id: Number(doc.id) || doc.id,
          date: data.date,
          time: data.time || '00:00',
          content: data.content,
          images: data.images || []
        }, uid);
      });
      console.log("[Sync] User data downloaded successfully.");
    } catch (err) {
      console.error("[Sync] Error syncing from Firestore:", err);
    }
  }

  let partnershipUnsubscribe = null;

  function getPairId(uid1, uid2) {
    if (!uid1 || !uid2) return null;
    return [uid1, uid2].sort().join('_');
  }

  function getSharingStartDate(data) {
    if (data && data.sharingStartDate && typeof data.sharingStartDate === 'string' && data.sharingStartDate.length >= 10) {
      return data.sharingStartDate.slice(0, 10);
    }
    if (data && data.connectedAt) {
      if (typeof data.connectedAt === 'string' && data.connectedAt.length >= 10) {
        return data.connectedAt.slice(0, 10);
      }
    }
    return '2000-01-01';
  }

  function startPartnershipListener(pairId, partnerId, uid) {
    if (partnershipUnsubscribe) partnershipUnsubscribe();

    partnershipUnsubscribe = window.db.collection('partnerships').doc(pairId)
      .onSnapshot(async (docSnap) => {
        if (docSnap.exists && docSnap.data().status === 'active') {
          const data = docSnap.data();
          const sharingStartDate = data.sharingStartDate || TODAY_DATE_STR;
          console.log(`[Partnership Sync] Active pair ${pairId}, sharingStartDate: ${sharingStartDate}`);

          startPartnerDiariesListener(partnerId, sharingStartDate);
          startPartnerMemosListener(partnerId, sharingStartDate);
          if (window.loadTodayData) await window.loadTodayData();
        } else {
          console.log(`[Partnership Sync] Pair ${pairId} status disconnected or document deleted.`);
          currentPartnerId = null;
          currentConnectedAt = null;
          stopPartnerDataListeners();
          if (partnerId) await DiaryDB.clearUserData(partnerId);
          if (window.loadTodayData) await window.loadTodayData();
        }
      }, (err) => {
        console.error("[Partnership Sync] Subscription error:", err);
      });
  }

  // Real-time Partner Info updates listener
  function startPartnerInfoListener(uid) {
    if (partnerUnsubscribe) partnerUnsubscribe();

    partnerUnsubscribe = window.db.collection('users').doc(uid).collection('partner').doc('info')
      .onSnapshot(async (docSnap) => {
        if (docSnap.exists) {
          const data = docSnap.data();
          const partnerId = data.partnerId;
          const connectedAt = data.connectedAt;
          const pairId = data.pairId || getPairId(uid, partnerId);

          if (partnerId !== currentPartnerId) {
            console.log("[Partner] Connected with partner:", partnerId, "pairId:", pairId);
            currentPartnerId = partnerId;
            currentConnectedAt = connectedAt;

            // Sync partner links in localStorage
            const links = JSON.parse(localStorage.getItem('partner_links') || '{}');
            links[uid] = partnerId;
            links[partnerId] = uid;
            localStorage.setItem('partner_links', JSON.stringify(links));

            // Start listening to canonical partnership Single Source of Truth
            if (pairId) {
              startPartnershipListener(pairId, partnerId, uid);
            } else {
              const sharingStartDate = getSharingStartDate(data);
              startPartnerDiariesListener(partnerId, sharingStartDate);
              startPartnerMemosListener(partnerId, sharingStartDate);
            }

            if (window.loadTodayData) await window.loadTodayData();
          }
        } else {
          if (currentPartnerId !== null) {
            console.log("[Partner] Disconnected.");
            const oldPartnerId = currentPartnerId;
            currentPartnerId = null;
            currentConnectedAt = null;

            // Clean partner links in localStorage
            const links = JSON.parse(localStorage.getItem('partner_links') || '{}');
            delete links[uid];
            localStorage.setItem('partner_links', JSON.stringify(links));

            stopPartnerDataListeners();
            if (oldPartnerId) await DiaryDB.clearUserData(oldPartnerId);
            if (window.loadTodayData) await window.loadTodayData();
            if (window.initGarden) await window.initGarden();
          }
        }
      }, (err) => {
        console.error("[Partner] Info subscription failed:", err);
      });
  }

  function startPartnerDiariesListener(partnerId, sharingStartDate) {
    if (partnerDiariesUnsubscribe) partnerDiariesUnsubscribe();

    let isInitialSnapshot = true;

    // Direct Firestore Query Filter for sharingStartDate privacy enforcement
    partnerDiariesUnsubscribe = window.db.collection('users').doc(partnerId).collection('diaries')
      .where('date', '>=', sharingStartDate)
      .onSnapshot(async (snapshot) => {
        try {
          console.log(`[Partner Sync] Listener snapshot received for partner ${partnerId}, docs: ${snapshot.docs.length}, initial: ${isInitialSnapshot}`);

          if (isInitialSnapshot) {
            console.log('[Partner Sync] initial diary snapshot received');
            const activeDocIds = new Set();
            
            // Save all active partner diaries from initial snapshot
            const savePromises = snapshot.docs.map(async (doc) => {
              const dateStr = doc.id;
              const data = doc.data();
              if (data && data.content && data.content.trim()) {
                activeDocIds.add(dateStr);
                let timestampStr = new Date().toISOString();
                if (data.updatedAt) {
                  timestampStr = typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : data.updatedAt;
                }
                console.log('[Partner Sync] partner diary initial save:', dateStr);
                await DiaryDB.saveDiary({
                  date: dateStr,
                  content: data.content,
                  mood: data.mood || 'none',
                  timestamp: timestampStr
                }, partnerId);
              }
            });
            await Promise.all(savePromises);

            // Compare with local IndexedDB cached partner diaries and purge stale/deleted ones
            try {
              const localPartnerDiaries = await DiaryDB.getAllDiaries(partnerId);
              for (const localRecord of localPartnerDiaries) {
                if (!activeDocIds.has(localRecord.date)) {
                  console.log('[Partner Sync] Purging stale local deleted partner diary:', localRecord.date);
                  await DiaryDB.deleteDiary(localRecord.date, partnerId);
                }
              }
            } catch (purgeErr) {
              console.warn('[Partner Sync] Failed to purge stale local diaries:', purgeErr);
            }

            isInitialSnapshot = false;
          } else {
            // Process subsequent docChanges cleanly without stale re-saves
            const changePromises = snapshot.docChanges().map(async (change) => {
              const dateStr = change.doc.id;
              if (change.type === 'removed') {
                console.log('[Partner Sync] partner diary removed:', dateStr);
                await DiaryDB.deleteDiary(dateStr, partnerId);
              } else {
                const data = change.doc.data();
                if (data && data.content && data.content.trim()) {
                  let timestampStr = new Date().toISOString();
                  if (data.updatedAt) {
                    timestampStr = typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : data.updatedAt;
                  }
                  console.log('[Partner Sync] partner diary updated:', dateStr);
                  await DiaryDB.saveDiary({
                    date: dateStr,
                    content: data.content,
                    mood: data.mood || 'none',
                    timestamp: timestampStr
                  }, partnerId);
                } else {
                  await DiaryDB.deleteDiary(dateStr, partnerId);
                }
              }
            });
            await Promise.all(changePromises);
          }

          // Trigger UI updates AFTER all IndexedDB writes are complete
          console.log('[Partner Sync] triggering Today UI refresh');
          if (window.loadTodayData) await window.loadTodayData();
          if (window.initGarden) await window.initGarden();
          if (window.renderWeeklyReview) await window.renderWeeklyReview();
        } catch (err) {
          console.error("[Partner] Diaries sync failed:", err);
        }
      });
  }

  function startPartnerMemosListener(partnerId, sharingStartDate) {
    if (partnerMemosUnsubscribe) partnerMemosUnsubscribe();

    partnerMemosUnsubscribe = window.db.collection('users').doc(partnerId).collection('memos')
      .where('date', '>=', sharingStartDate)
      .onSnapshot(async (snapshot) => {
        try {
          const promises = snapshot.docChanges().map(async (change) => {
            const memoId = change.doc.id;
            const data = change.doc.data();
            if (data && data.date) {
              if (change.type === "removed") {
                await DiaryDB.deleteMemo(Number(memoId) || memoId, partnerId);
              } else {
                await DiaryDB.saveMemo({
                  id: Number(memoId) || memoId,
                  date: data.date,
                  time: data.time || '00:00',
                  content: data.content,
                  images: data.images || []
                }, partnerId);
              }
            }
          });
          await Promise.all(promises);

          // Trigger UI updates AFTER all IndexedDB writes are complete
          if (window.loadTodayData) await window.loadTodayData();
        } catch (err) {
          console.error("[Partner] Memos sync failed:", err);
        }
      });
  }

  function stopPartnerDataListeners() {
    if (partnerDiariesUnsubscribe) { partnerDiariesUnsubscribe(); partnerDiariesUnsubscribe = null; }
    if (partnerMemosUnsubscribe) { partnerMemosUnsubscribe(); partnerMemosUnsubscribe = null; }
  }

  // Override SyncManager queue loop to upload to Firestore
  const originalProcessQueue = window.SyncManager.processQueue;
  window.SyncManager.processQueue = async function() {
    if (!navigator.onLine || !window.auth.currentUser) {
      window.SyncManager.updateStatusUI();
      return;
    }
    const uid = window.auth.currentUser.uid;
    let queue = this.getQueue();
    if (queue.length === 0) {
      this.updateStatusUI();
      return;
    }
    console.log(`[Firebase SyncManager] Syncing ${queue.length} items to Firestore...`);
    while (queue.length > 0) {
      const item = queue[0];
      try {
        if (item.action === 'save_diary') {
          if (item.data && item.data.date && item.data.content) {
            await window.db.collection('users').doc(uid).collection('diaries').doc(item.data.date).set({
              date: item.data.date,
              content: item.data.content,
              mood: item.data.mood || 'none',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
        } else if (item.action === 'delete_diary') {
          if (item.data && item.data.date) {
            await window.db.collection('users').doc(uid).collection('diaries').doc(item.data.date).delete();
          }
        } else if (item.action === 'save_memo') {
          if (item.data && item.data.date && item.data.content) {
            const allMemos = await DiaryDB.getMemosForDate(item.data.date, uid);
            const memoRecord = allMemos.find(m => m.date === item.data.date && m.content === item.data.content);
            const memoId = memoRecord ? String(memoRecord.id) : String(Math.random());
            await window.db.collection('users').doc(uid).collection('memos').doc(memoId).set({
              id: memoId,
              date: item.data.date,
              content: item.data.content,
              time: memoRecord ? memoRecord.time : '00:00',
              images: memoRecord ? memoRecord.images : [],
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
        } else if (item.action === 'delete_memo') {
          if (item.data && item.data.id) {
            await window.db.collection('users').doc(uid).collection('memos').doc(String(item.data.id)).delete();
          }
        }
        queue.shift();
        this.saveQueue(queue);
        this.updateStatusUI();
      } catch (err) {
        console.error('[Firebase SyncManager] Sync item failed, discarding corrupted item to unblock queue:', err, item);
        queue.shift();
        this.saveQueue(queue);
        this.updateStatusUI();
      }
    }
  };

  // Override PartnerService Invite Flow and Linkage Logic
  window.PartnerService = {
    getPartnerId(userId) {
      return currentPartnerId;
    },
    async previewInviteCode(pin) {
      const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
      const realAuthUid = authUser ? authUser.uid : null;

      if (!realAuthUid) {
        alert('請先進行 Google 登入後再進行配對預覽。');
        return { valid: false, error: 'NO_AUTH' };
      }

      const inviteRef = window.db.collection('invitations').doc(pin);
      try {
        const inviteDoc = await inviteRef.get();
        if (!inviteDoc.exists) {
          return { valid: false, error: '邀請碼不存在' };
        }

        const inviteData = inviteDoc.data();
        const inviteOwnerUid = inviteData ? inviteData.ownerUid : null;

        if (inviteOwnerUid === realAuthUid) {
          return { valid: false, error: '不能輸入自己所產生的邀請碼' };
        }

        if (inviteData.status !== 'pending') {
          return { valid: false, error: '此邀請碼已被使用或已失效' };
        }

        let inviterName = '筆友';
        try {
          const userDoc = await window.db.collection('users').doc(inviteOwnerUid).get();
          if (userDoc.exists && userDoc.data().displayName) {
            inviterName = userDoc.data().displayName;
          }
        } catch (_) {}

        return {
          valid: true,
          ownerUid: inviteOwnerUid,
          inviterName: inviterName,
          pin: pin
        };
      } catch (err) {
        console.error('[PARTNER DEBUG] previewInviteCode error:', err);
        return { valid: false, error: err.message || '無法預覽邀請碼' };
      }
    },
    async generateInviteCode(userId) {
      const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
      const realAuthUid = authUser ? authUser.uid : (userId && userId !== 'user_a' && userId !== 'user_b' ? userId : null);
      
      if (!realAuthUid) {
        console.error('[PARTNER AUTH ERROR] No active Firebase Auth session found for generateInviteCode!');
        throw new Error('Must be logged in with Google/Firebase Auth.');
      }

      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const inviteDocPath = `invitations/${pin}`;
      
      console.log('[AUTH DEBUG]', {
        currentAuthUid: realAuthUid,
        currentAuthEmail: authUser ? authUser.email : null,
      });

      console.log('[INVITE CREATE DEBUG]', {
        authUid: realAuthUid,
        ownerUidWritten: realAuthUid,
        pin: pin
      });

      try {
        await window.db.collection('invitations').doc(pin).set({
          invitationId: pin,
          ownerUid: realAuthUid,
          status: 'pending',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[PARTNER DEBUG] generateInviteCode Success for PIN: ${pin} (ownerUid: ${realAuthUid})`);
        return pin;
      } catch (err) {
        console.error(`[PARTNER DEBUG] generateInviteCode Error:
- code: ${err.code}
- message: ${err.message}`, err);
        throw err;
      }
    },
    async acceptInviteCode(userId, pin) {
      const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
      const realAuthUid = authUser ? authUser.uid : (userId && userId !== 'user_a' && userId !== 'user_b' ? userId : null);

      console.log('[PARTNER ACCEPT RUNTIME]', {
        authReady: !!window.auth,
        hasCurrentUser: !!authUser,
        currentAuthUid: authUser ? authUser.uid : null,
        currentAuthEmail: authUser ? authUser.email : null,
      });

      if (!realAuthUid) {
        console.trace('[SELF INVITE BLOCKED no_auth_uid]');
        console.error('[PARTNER AUTH ERROR] No active Firebase Auth session found for acceptInviteCode!');
        alert('請先進行 Google 登入後再進行配對。');
        return false;
      }

      const inviteRef = window.db.collection('invitations').doc(pin);

      try {
        const inviteDoc = await inviteRef.get();
        if (!inviteDoc.exists) {
          console.trace('[SELF INVITE BLOCKED invite_not_found]');
          console.warn(`[PARTNER DEBUG] Invitation ${pin} does not exist.`);
          alert('驗證失敗：邀請碼不存在。');
          return false;
        }
        
        const inviteData = inviteDoc.data();
        const inviteOwnerUid = inviteData ? inviteData.ownerUid : null;
        const sameUserCheck = (inviteOwnerUid === realAuthUid);
        
        console.log('[PARTNER INVITE RUNTIME]', {
          pin,
          invitationOwnerUid: inviteData ? inviteData.ownerUid : null,
          invitationStatus: inviteData ? inviteData.status : null,
          currentAuthUid: authUser ? authUser.uid : null,
          sameUser: !!authUser && authUser.uid === inviteOwnerUid,
        });

        if (sameUserCheck) {
          console.trace('[SELF INVITE BLOCKED same_user]');
          console.warn(`[PARTNER DEBUG] Attempted to accept own invitation code! (${realAuthUid} === ${inviteOwnerUid})`);
          alert('不能輸入自己所產生的邀請碼。');
          return false;
        }

        if (inviteData.status !== 'pending') {
          console.trace('[SELF INVITE BLOCKED status_not_pending]');
          console.warn(`[PARTNER DEBUG] Invitation ${pin} status is ${inviteData.status}, not pending.`);
          alert('此邀請碼已被使用或已失效。');
          return false;
        }

        const connectedAt = new Date().toISOString();
        const batch = window.db.batch();
        const sharingStartDate = TODAY_DATE_STR;
        const pairId = getPairId(inviteOwnerUid, realAuthUid);

        console.log('[PARTNER ACCEPT WRITE DEBUG]', {
          currentAuthUid: realAuthUid,
          invitationOwnerUid: inviteOwnerUid,
          invitationStatus: inviteData.status,
          invitationAcceptedBy: realAuthUid,
          pairId: pairId,
          memberUids: [inviteOwnerUid, realAuthUid].sort(),
          sharingStartDate: sharingStartDate
        });

        // 1. Mark invite as accepted atomically with acceptor metadata
        batch.update(inviteRef, {
          status: 'accepted',
          acceptedBy: realAuthUid,
          acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // 2. Write canonical partnership Single Source of Truth
        if (pairId) {
          const partnershipRef = window.db.collection('partnerships').doc(pairId);
          batch.set(partnershipRef, {
            pairId: pairId,
            memberUids: [inviteOwnerUid, realAuthUid].sort(),
            status: 'active',
            sharingStartDate: sharingStartDate,
            createdAt: connectedAt,
            sourceInvitationId: pin,
            disconnectedAt: null
          });
        }
        
        // 3. Link both users 1-on-1 with pairId and explicit sharingStartDate
        batch.set(window.db.collection('users').doc(realAuthUid).collection('partner').doc('info'), {
          partnerId: inviteOwnerUid,
          pairId: pairId,
          connectedAt: connectedAt,
          sharingStartDate: sharingStartDate
        });

        batch.set(window.db.collection('users').doc(inviteOwnerUid).collection('partner').doc('info'), {
          partnerId: realAuthUid,
          pairId: pairId,
          connectedAt: connectedAt,
          sharingStartDate: sharingStartDate
        });

        console.log(`[PARTNER DEBUG] Committing batch with pairId ${pairId}...`);
        await batch.commit();
        console.log(`[PARTNER DEBUG] Batch committed successfully!`);
        return true;
      } catch (err) {
        console.error(`[PARTNER DEBUG] acceptInviteCode Error caught:
- code: ${err.code}
- message: ${err.message}`, err);
        alert(`配對失敗：[${err.code || 'UNKNOWN_ERROR'}] ${err.message || err}`);
        return false;
      }
    },
    async cancelSharing(userId) {
      const realUid = (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : (userId || State.currentUser);
      if (!realUid || !window.db) {
        console.warn("[PartnerLink] cancelSharing: No active user session found.");
        return false;
      }

      let partnerId = currentPartnerId;
      let pairId = null;

      try {
        const docSnap = await window.db.collection('users').doc(realUid).collection('partner').doc('info').get();
        if (docSnap.exists) {
          partnerId = docSnap.data().partnerId || partnerId;
          pairId = docSnap.data().pairId;
        }
      } catch (fetchErr) {
        console.warn("[PartnerLink] Could not fetch partner info prior to cancel:", fetchErr);
      }

      if (!pairId && partnerId) {
        pairId = getPairId(realUid, partnerId);
      }

      console.log(`[PartnerLink] Cancelling sharing for user ${realUid} (partner: ${partnerId}, pairId: ${pairId})...`);

      // 1. Mark canonical partnership status as disconnected (Atomic Real-time Trigger)
      if (pairId) {
        try {
          await window.db.collection('partnerships').doc(pairId).update({
            status: 'disconnected',
            disconnectedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          console.log("[PartnerLink] Canonical partnership set to disconnected.");
        } catch (pairErr) {
          console.warn("[PartnerLink] Updating partnership status notice:", pairErr);
        }
      }

      // 2. Delete own partner info
      try {
        await window.db.collection('users').doc(realUid).collection('partner').doc('info').delete();
      } catch (ownErr) {}

      // 3. Delete partner's partner info
      if (partnerId) {
        try {
          await window.db.collection('users').doc(partnerId).collection('partner').doc('info').delete();
        } catch (partnerErr) {}
        await DiaryDB.clearUserData(partnerId);
      }

      // 4. Reset local state & listeners
      currentPartnerId = null;
      currentConnectedAt = null;
      stopPartnerDataListeners();
      if (window.loadTodayData) await window.loadTodayData();

      return true;
  };

  // Production Diagnostic Runner
  window.runProductionDiagnostic = async function(pin) {
    const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
    const realAuthUid = authUser ? authUser.uid : null;
    const projectId = window.firebase && window.firebase.app() ? window.firebase.app().options.projectId : null;

    console.log('=== PRODUCTION DIAGNOSTIC START ===');
    console.log('Runtime Project ID:', projectId);
    console.log('Runtime Auth UID:', realAuthUid);

    if (!realAuthUid) {
      console.error('DIAGNOSTIC FAILED: No active Firebase Auth session.');
      return;
    }

    if (!pin) {
      console.error('DIAGNOSTIC FAILED: Please provide a target PIN to test (e.g. runProductionDiagnostic("123456")).');
      return;
    }

    const inviteRef = window.db.collection('invitations').doc(pin);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists) {
      console.error(`DIAGNOSTIC FAILED: Invitation ${pin} does not exist in project ${projectId}.`);
      return;
    }

    const inviteData = inviteDoc.data();
    const inviteOwnerUid = inviteData.ownerUid;
    const pairId = getPairId(inviteOwnerUid, realAuthUid);
    const sharingStartDate = TODAY_DATE_STR;
    const connectedAt = new Date().toISOString();

    console.log('Test Parameters:', { pin, inviteOwnerUid, realAuthUid, pairId, projectId });

    // WRITE #1 TEST: Invitation Update
    console.log('--- TEST WRITE #1: invitations/' + pin + ' (UPDATE) ---');
    try {
      await inviteRef.update({
        status: 'accepted',
        acceptedBy: realAuthUid,
        acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('WRITE #1 (Invitation Update): PASS');
    } catch (err) {
      console.error('WRITE #1 (Invitation Update): FAIL', {
        path: `invitations/${pin}`, operation: 'UPDATE', projectId, authUid: realAuthUid, code: err.code, message: err.message
      });
    }

    // WRITE #2 TEST: Partnership Create
    console.log('--- TEST WRITE #2: partnerships/' + pairId + ' (CREATE) ---');
    try {
      const partnershipRef = window.db.collection('partnerships').doc(pairId);
      await partnershipRef.set({
        pairId: pairId,
        memberUids: [inviteOwnerUid, realAuthUid].sort(),
        status: 'active',
        sharingStartDate: sharingStartDate,
        createdAt: connectedAt,
        sourceInvitationId: pin,
        disconnectedAt: null
      });
      console.log('WRITE #2 (Partnership Create): PASS');
    } catch (err) {
      console.error('WRITE #2 (Partnership Create): FAIL', {
        path: `partnerships/${pairId}`, operation: 'CREATE', projectId, authUid: realAuthUid, code: err.code, message: err.message
      });
    }

    // WRITE #3 TEST: User B partner info
    console.log('--- TEST WRITE #3: users/' + realAuthUid + '/partner/info (SET) ---');
    try {
      const bInfoRef = window.db.collection('users').doc(realAuthUid).collection('partner').doc('info');
      await bInfoRef.set({
        partnerId: inviteOwnerUid, pairId: pairId, connectedAt: connectedAt, sharingStartDate: sharingStartDate
      });
      console.log('WRITE #3 (User B partner/info): PASS');
    } catch (err) {
      console.error('WRITE #3 (User B partner/info): FAIL', {
        path: `users/${realAuthUid}/partner/info`, operation: 'SET', projectId, authUid: realAuthUid, code: err.code, message: err.message
      });
    }

    // WRITE #4 TEST: User A partner info
    console.log('--- TEST WRITE #4: users/' + inviteOwnerUid + '/partner/info (SET) ---');
    try {
      const aInfoRef = window.db.collection('users').doc(inviteOwnerUid).collection('partner').doc('info');
      await aInfoRef.set({
        partnerId: realAuthUid, pairId: pairId, connectedAt: connectedAt, sharingStartDate: sharingStartDate
      });
      console.log('WRITE #4 (User A partner/info): PASS');
    } catch (err) {
      console.error('WRITE #4 (User A partner/info): FAIL', {
        path: `users/${inviteOwnerUid}/partner/info`, operation: 'SET', projectId, authUid: realAuthUid, code: err.code, message: err.message
      });
    }

    console.log('=== PRODUCTION DIAGNOSTIC END ===');
  };

  // Custom stacked lined notebook cards rendering for Weekly Review Page
  window.renderWeeklyReview = async function() {
    const rangeText = document.getElementById('weekly-range-text');
    const reviewList = document.getElementById('weekly-review-list');
    const btnNext = document.getElementById('btn-next-week');
    
    if (!reviewList) return;
    reviewList.innerHTML = '';
    
    // 計算本週 7 天的日期序列（降冪排列）
    const dates = [];
    const [ty, tm, td] = TODAY_DATE_STR.split('-').map(Number);
    const baseDate = new Date(ty, tm - 1, td);
    baseDate.setDate(baseDate.getDate() + (State.weeklyOffset * 7));
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dates.push(`${yyyy}-${mm}-${dd}`);
    }
    
    // 更新範圍文字 (例如: 7/9 - 7/15)
    if (rangeText && dates.length > 0) {
      const [sY, sM, sD] = dates[6].split('-').map(Number);
      const [eY, eM, eD] = dates[0].split('-').map(Number);
      const startStr = `${sM}/${sD}`;
      const endStr = `${eM}/${eD}`;
      rangeText.textContent = `${startStr} - ${endStr}`;
    }
    
    // 設定後一週按鈕的啟用狀態
    if (btnNext) {
      btnNext.disabled = (State.weeklyOffset === 0);
    }
    
    // 遍歷日期渲染各個日記卡片 (週記頁面僅保留自己的日記)
    for (const dateStr of dates) {
      const ownDiary = await DiaryDB.getDiary(dateStr, State.currentUser);
      const ownCard = await createWeeklyReviewCard(dateStr, ownDiary, State.currentUser, '我的日記', true);
      reviewList.appendChild(ownCard);
    }
    
    // 重新渲染 Lucide 圖標
    try {
      lucide.createIcons();
    } catch (e) {}
  };

  async function createWeeklyReviewCard(dateStr, diary, userId, title, isOwner) {
    const card = document.createElement('div');
    card.className = 'diary-review-card';
    
    // 格式化日期與星期
    const parts = dateStr.split('-');
    const formattedDate = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const weekdayStr = getChineseWeekday(dateStr);
    const isTodayStr = (dateStr === TODAY_DATE_STR) ? ' · 今天' : '';
    
    // 卡片標頭
    const header = document.createElement('div');
    header.className = 'diary-review-card-header';
    
    const dateLabel = document.createElement('span');
    dateLabel.className = 'diary-review-card-date';
    dateLabel.textContent = `${formattedDate} (${weekdayStr})${isTodayStr}`;
    
    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.alignItems = 'center';
    rightGroup.style.gap = '8px';
    
    const moodDot = document.createElement('div');
    moodDot.className = 'diary-review-card-mood-dot';
    const mood = diary ? diary.mood : 'none';
    const colors = MOOD_COLORS[mood] || { text: '#434343', line: 'rgba(67, 67, 67, 0.4)' };
    const moodColor = (mood === 'none') ? '#e5e5ea' : colors.text;
    moodDot.style.backgroundColor = moodColor;
    
    // 只有本人的日記，且有日記內容時，才顯示刪除按鈕
    if (isOwner && diary && diary.content && diary.content.trim()) {
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
      `;
      deleteBtn.style.background = 'none';
      deleteBtn.style.border = 'none';
      deleteBtn.style.color = 'var(--color-text-red)';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.padding = '4px';
      deleteBtn.style.display = 'flex';
      deleteBtn.style.alignItems = 'center';
      deleteBtn.style.justifyContent = 'center';
      deleteBtn.style.borderRadius = '50%';
      deleteBtn.style.backgroundColor = 'rgba(231, 111, 81, 0.05)';
      deleteBtn.title = '刪除此日記';
      
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // 阻止卡片點擊事件
        const dateParts = dateStr.split('-');
        const formattedDateText = `${dateParts[0]} 年 ${dateParts[1]} 月 ${dateParts[2]} 日`;
        if (!confirm(`確定要永久刪除 ${formattedDateText} 的日記記錄嗎？\n(注意：刪除日記也會同時刪除隨筆)`)) return;
        
        try {
          await DiaryDB.deleteDiary(dateStr, userId);
          SyncManager.addToQueue('delete_diary', { date: dateStr });
          
          if (dateStr === State.activeDate) {
            const textarea = document.getElementById('diary-textarea');
            if (textarea) textarea.value = '';
            State.diaryWordCount = 0;
            const countSpan = document.getElementById('diary-word-count');
            if (countSpan) countSpan.textContent = '0 / 50';
            if (window.updateManuscriptCells) window.updateManuscriptCells('');
            const mainContainer = document.getElementById('manuscript-container-box');
            if (mainContainer) mainContainer.className = 'manuscript-container mood-black';
          }
          if (window.updateGardenDotsColor) await window.updateGardenDotsColor();
          await window.renderWeeklyReview();
          if (window.checkThreeYearCompletion) await window.checkThreeYearCompletion();
          window.showToast('日記已刪除');
        } catch (err) {
          console.error('刪除失敗:', err);
        }
      });
      rightGroup.appendChild(deleteBtn);
    }
    
    rightGroup.appendChild(moodDot);
    header.appendChild(dateLabel);
    header.appendChild(rightGroup);
    card.appendChild(header);
    
    // 卡片內容
    if (diary && diary.content && diary.content.trim()) {
      const body = document.createElement('p');
      body.className = 'diary-review-card-body';
      body.textContent = diary.content;
      body.style.setProperty('--mood-color', colors.text);
      card.appendChild(body);
    } else {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'diary-review-card-empty';
      emptyMsg.textContent = isOwner ? '今天沒有寫下任何日記字句。' : '今天尚未寫下日記字句。';
      card.appendChild(emptyMsg);
    }
    
    card.addEventListener('click', async () => {
      if (window.showGardenDetailModal) {
        await window.showGardenDetailModal(dateStr);
      }
    });
    
    return card;
  }

  // Developer sandbox mode helper (for browser automation tests)
  window.loginSandboxUser = async function() {
    const mockUid = 'sandbox_test_user_id';
    const mockEmail = 'sandbox@example.com';
    
    setSessionCompat(mockUid, mockEmail, 'google');
    State.currentUser = mockUid;
    
    try {
      const userDoc = await window.db.collection('users').doc(mockUid).get();
      if (userDoc.exists) {
        const profile = userDoc.data();
        await DiaryDB.saveUser({
          id: mockUid,
          displayName: profile.displayName,
          email: mockEmail,
          provider: 'google',
          createdAt: profile.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: profile.startedAt || TODAY_DATE_STR
        });
        const startYear = new Date(profile.startedAt || TODAY_DATE_STR).getFullYear();
        localStorage.setItem(`cycle_start_year_${mockUid}`, String(startYear));
        localStorage.setItem(`cycle_start_date_${mockUid}`, profile.startedAt || TODAY_DATE_STR);
        await syncAllFromFirestore(mockUid);
        startPartnerInfoListener(mockUid);
        window.location.hash = 'today';
      } else {
        window.location.hash = 'onboarding';
      }
    } catch (fsErr) {
      console.error("[Firebase Auth] Firestore check failed for sandbox user:", fsErr);
      window.location.hash = 'onboarding';
    }
  };

  // Re-define / override button handlers dynamically on document DOMContentLoaded or now
  function setupFirebaseButtonOverrides() {
    console.log("[Firebase Sync] Patching button event listeners...");

    // 1. Onboarding Submit Button
    const btnOnboardingSubmit = document.getElementById('btn-onboarding-submit');
    const nameInput = document.getElementById('onboarding-name-input');
    if (btnOnboardingSubmit && nameInput) {
      const newBtn = btnOnboardingSubmit.cloneNode(true);
      btnOnboardingSubmit.parentNode.replaceChild(newBtn, btnOnboardingSubmit);
      
      newBtn.addEventListener('click', async () => {
        const displayName = nameInput.value.trim();
        if (!displayName) {
          alert('請輸入您的暱稱。');
          return;
        }

        const user = window.auth.currentUser || (State.currentUser === 'sandbox_test_user_id' ? { uid: 'sandbox_test_user_id', email: 'sandbox@example.com' } : null);
        if (!user) return;

        const startedAt = State.activeDate;
        const createdAt = new Date().toISOString();

        try {
          // Save to Firestore
          await window.db.collection('users').doc(user.uid).set({
            displayName: displayName,
            createdAt: createdAt,
            startedAt: startedAt
          });

          // Save to local IndexedDB
          await DiaryDB.saveUser({
            id: user.uid,
            displayName: displayName,
            email: user.email,
            provider: 'google',
            createdAt: createdAt,
            updatedAt: new Date().toISOString(),
            startedAt: startedAt
          });

          const startYear = new Date(startedAt).getFullYear();
          localStorage.setItem(`cycle_start_year_${user.uid}`, String(startYear));
          localStorage.setItem(`cycle_start_date_${user.uid}`, startedAt);

          window.location.hash = 'today';
        } catch (err) {
          console.error("Error saving onboarding details:", err);
          alert("設定失敗，請重試。");
        }
      });
    }

    // 2. Partner Generate Code Button
    const btnPartnerGenCode = document.getElementById('btn-partner-gen-code');
    const panelUnlinked = document.getElementById('partner-unlinked-panel');
    const panelInviteGen = document.getElementById('partner-invite-gen-panel');
    const pinBox = document.getElementById('partner-pin-box');
    if (btnPartnerGenCode && panelUnlinked && panelInviteGen && pinBox) {
      const newBtn = btnPartnerGenCode.cloneNode(true);
      btnPartnerGenCode.parentNode.replaceChild(newBtn, btnPartnerGenCode);
      newBtn.addEventListener('click', async () => {
        try {
          const pin = await window.PartnerService.generateInviteCode(State.currentUser);
          pinBox.textContent = `${pin.substring(0, 3)} ${pin.substring(3)}`;
          panelUnlinked.classList.add('hidden');
          panelInviteGen.classList.remove('hidden');
        } catch (e) {
          alert('產生邀請碼失敗，請確認網路連線。');
        }
      });
    }

    // 3. Partner Verify Code Button (Step 1: Preview PIN)
    const btnPartnerVerifyCode = document.getElementById('btn-partner-verify-code');
    const pinInput = document.getElementById('partner-pin-input');
    const panelInviteInput = document.getElementById('partner-invite-input-panel');
    const panelInvitePreview = document.getElementById('partner-invite-preview-panel');
    const inviterNameSpan = document.getElementById('partner-preview-inviter-name');
    const btnConfirmAccept = document.getElementById('btn-partner-confirm-accept');
    const btnPreviewCancel = document.getElementById('btn-partner-preview-cancel');

    let currentPendingPin = null;

    if (btnPartnerVerifyCode && pinInput && panelInviteInput) {
      const newBtn = btnPartnerVerifyCode.cloneNode(true);
      btnPartnerVerifyCode.parentNode.replaceChild(newBtn, btnPartnerVerifyCode);
      newBtn.addEventListener('click', async () => {
        const pin = pinInput.value.trim().replace(/\s/g, '');
        if (pin.length !== 6 || isNaN(pin)) {
          alert('請輸入 6 位數字邀請碼。');
          return;
        }

        try {
          console.log('[PARTNER PREVIEW] Verifying PIN for preview:', pin);
          const previewRes = await window.PartnerService.previewInviteCode(pin);
          if (!previewRes.valid) {
            alert(previewRes.error || '驗證失敗：邀請碼無效');
            return;
          }

          currentPendingPin = pin;
          if (inviterNameSpan) inviterNameSpan.textContent = previewRes.inviterName || '筆友';
          
          panelInviteInput.classList.add('hidden');
          if (panelInvitePreview) panelInvitePreview.classList.remove('hidden');
        } catch (err) {
          alert('預覽時發生錯誤，請稍後重試。');
        }
      });
    }

    // 3.5. Confirm Accept Partner Button (Step 2: Atomic Acceptance Write)
    if (btnConfirmAccept) {
      const newConfirmBtn = btnConfirmAccept.cloneNode(true);
      btnConfirmAccept.parentNode.replaceChild(newConfirmBtn, btnConfirmAccept);
      newConfirmBtn.addEventListener('click', async () => {
        if (!currentPendingPin) {
          alert('請重新輸入邀請碼驗證。');
          return;
        }

        try {
          console.log('[PARTNER ACCEPT] User clicked Confirm Accept for PIN:', currentPendingPin);
          const success = await window.PartnerService.acceptInviteCode(State.currentUser, currentPendingPin);
          if (success) {
            const partnerName = await getPartnerName();
            alert(`聯結成功！現在可以開始查看${partnerName}的今日日記。`);
            pinInput.value = '';
            if (panelInvitePreview) panelInvitePreview.classList.add('hidden');
            await window.loadTodayData();
          }
        } catch (err) {
          console.error('[PARTNER ACCEPT ERROR]', err);
          alert('配對失敗：' + (err.message || err));
        }
      });
    }

    if (btnPreviewCancel) {
      const newCancelBtn = btnPreviewCancel.cloneNode(true);
      btnPreviewCancel.parentNode.replaceChild(newCancelBtn, btnPreviewCancel);
      newCancelBtn.addEventListener('click', () => {
        currentPendingPin = null;
        if (panelInvitePreview) panelInvitePreview.classList.add('hidden');
        if (panelUnlinked) panelUnlinked.classList.remove('hidden');
      });
    }

    // 4. Partner Unlink Button
    const btnPartnerUnlink = document.getElementById('btn-partner-unlink');
    if (btnPartnerUnlink) {
      const newBtn = btnPartnerUnlink.cloneNode(true);
      btnPartnerUnlink.parentNode.replaceChild(newBtn, btnPartnerUnlink);
      newBtn.addEventListener('click', async () => {
        const partnerName = await getPartnerName();
        if (!confirm(`確定要解除與${partnerName}的聯結嗎？\n解除後將立即雙向撤銷今日日記的互看權限。`)) return;

        try {
          const success = await window.PartnerService.cancelSharing(State.currentUser);
          if (success) {
            alert('聯結已成功解除，權限已雙向收回。');
            await window.loadTodayData();
          } else {
            alert('解除聯結失敗。');
          }
        } catch (e) {
          alert('操作失敗，請檢查網路連線。');
        }
      });
    }

    // 5. Delete Account Button (typing delete to confirm + export download blob)
    const btnConfirmExportDelete = document.getElementById('btn-confirm-export-delete');
    const deleteConfirmPassword = document.getElementById('delete-confirm-password');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    if (btnConfirmExportDelete && deleteConfirmPassword && deleteConfirmModal) {
      const newBtn = btnConfirmExportDelete.cloneNode(true);
      btnConfirmExportDelete.parentNode.replaceChild(newBtn, btnConfirmExportDelete);
      newBtn.addEventListener('click', async () => {
        const inputVal = deleteConfirmPassword.value.trim();
        if (inputVal !== 'delete') {
          alert('請輸入 delete 以確認刪除。');
          return;
        }

        try {
          const user = window.auth.currentUser;
          const isSandbox = (State.currentUser === 'sandbox_test_user_id');
          if (!user && !isSandbox) return;

          // 1. Generate export HTML and print to PDF via hidden iframe (avoids popup blockers)
          const html = await window.generateExportHTML(State.currentUser);
          
          const iframe = document.createElement('iframe');
          iframe.style.position = 'fixed';
          iframe.style.width = '0px';
          iframe.style.height = '0px';
          iframe.style.border = 'none';
          document.body.appendChild(iframe);
          
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          doc.open();
          doc.write(html);
          doc.close();
          
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          
          setTimeout(() => {
            if (iframe.parentNode) {
              document.body.removeChild(iframe);
            }
          }, 1000);

          // 2. Unlink partner if connected
          if (currentPartnerId) {
            await window.PartnerService.cancelSharing(State.currentUser);
          }

          // 3. Clear Firestore user document
          if (window.db) {
            await window.db.collection('users').doc(State.currentUser).delete();
          }

          // 4. Delete user auth
          if (user) {
            await user.delete();
          }

          // 5. Clear IndexedDB
          await DiaryDB.deleteUser(State.currentUser);
          
          alert('您的日記資料與帳號已永久刪除。');
          deleteConfirmModal.classList.add('hidden');
          clearSessionCompat();
          stopAllListeners();
          window.location.hash = 'login';
        } catch (err) {
          console.error("Deletion failed:", err);
          alert('刪除失敗，這可能是因為您登入時間已久。請重新登入後再次嘗試。');
        }
      });
    }

    // 6. Logout Button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      const newBtn = btnLogout.cloneNode(true);
      btnLogout.parentNode.replaceChild(newBtn, btnLogout);
      newBtn.addEventListener('click', async () => {
        if (confirm('確定要登出您的時光日記帳號嗎？')) {
          try {
            await window.auth.signOut();
            State.splashDismissed = false;
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal) settingsModal.classList.add('hidden');
            window.location.hash = 'splash';
          } catch (e) {
            console.error("Sign out error:", e);
          }
        }
      });
    }

    // 7. Security text typewriter text override
    const btnSecurityTrigger = document.getElementById('btn-security-trigger');
    const securityInfo = document.getElementById('login-security-info');
    const securityText = document.getElementById('login-security-text');
    let typingTimer = null;
    if (btnSecurityTrigger && securityInfo && securityText) {
      const newBtn = btnSecurityTrigger.cloneNode(true);
      btnSecurityTrigger.parentNode.replaceChild(newBtn, btnSecurityTrigger);
      newBtn.addEventListener('click', () => {
        securityInfo.classList.remove('hidden');
        const fullText = "🛡️ 隱私與安全政策：您的日記資料完全屬於您。寫作內容會以 AES-256 加密存儲於您本地的瀏覽器中；當您登入時，資料會經由安全加密協定，備份至您個人 Google 帳號綁定的私人雲端資料庫。";
        
        if (typingTimer) clearInterval(typingTimer);
        securityText.textContent = "";
        
        let index = 0;
        typingTimer = setInterval(() => {
          if (index < fullText.length) {
            securityText.textContent += fullText.charAt(index);
            index++;
          } else {
            clearInterval(typingTimer);
            typingTimer = null;
          }
        }, 30);
      });
    }
  }

  // Run immediately if document is already loaded, otherwise bind to load event
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(setupFirebaseButtonOverrides, 100);
  } else {
    window.addEventListener('load', () => {
      setTimeout(setupFirebaseButtonOverrides, 100);
    });
  }

  // Export helper globally if needed
  window.getPartnerName = async function() {
    if (!currentPartnerId) return '筆友';
    try {
      const doc = await window.db.collection('users').doc(currentPartnerId).get();
      if (doc.exists) {
        return doc.data().displayName || '筆友';
      }
    } catch (_) {}
    return '筆友';
  };

})();
