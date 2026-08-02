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
      if (window.State) window.State.currentUser = user.uid;
      else if (typeof State !== 'undefined') State.currentUser = user.uid;
      
      // Check and ensure user profile and publicProfile in Firestore
      try {
        const userRef = window.db.collection('users').doc(user.uid);
        let userDoc = await userRef.get();
        const autoName = user.displayName || (user.email ? user.email.split('@')[0] : '筆友');
        
        if (!userDoc.exists) {
          console.log("[Firebase Auth] Initializing missing user profile for Google user:", autoName);
          await userRef.set({
            displayName: autoName,
            createdAt: new Date().toISOString(),
            startedAt: TODAY_DATE_STR
          }, { merge: true });
          userDoc = await userRef.get();
        }

        const profile = userDoc.exists ? userDoc.data() : {};
        const displayName = (profile.displayName && profile.displayName.trim()) ? profile.displayName.trim() : autoName;

        // Ensure publicProfile/info exists (Migration for existing users & initialization for new users)
        const pubRef = userRef.collection('publicProfile').doc('info');
        let pubDoc = await pubRef.get();
        if (!pubDoc.exists) {
          console.log("[Firebase Auth] Creating/migrating publicProfile for user:", displayName);
          await pubRef.set({
            displayName: displayName,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } else {
          // If publicProfile exists, do NOT overwrite with Google Auth displayName!
          const pubData = pubDoc.data();
          if (pubData && pubData.displayName && pubData.displayName.trim()) {
            profile.displayName = pubData.displayName.trim();
          }
        }

        const finalDisplayName = (profile.displayName && profile.displayName.trim()) ? profile.displayName.trim() : displayName;
        console.log("[Firebase Auth] User profile & publicProfile active:", finalDisplayName);
        
        // Save user profile locally to IndexedDB
        await DiaryDB.saveUser({
          id: user.uid,
          displayName: finalDisplayName,
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
        
        // Redirect to today if currently on login/onboarding/splash
        if (window.location.hash === '#login' || window.location.hash === '#onboarding' || window.location.hash === '#splash' || !window.location.hash) {
          window.location.hash = 'today';
        }
        if (window.handleRouting) await window.handleRouting();
      } catch (err) {
        console.error("[Firebase Auth] Error fetching user profile:", err);
        try {
          const fallbackName = user.displayName || (user.email ? user.email.split('@')[0] : '筆友');
          await DiaryDB.saveUser({
            id: user.uid,
            displayName: fallbackName,
            email: user.email,
            provider: 'google',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            startedAt: TODAY_DATE_STR
          });
          console.log("[Firebase Auth] Graceful fallback applied for Google user, redirecting to today");
          if (window.location.hash === '#login' || window.location.hash === '#onboarding' || window.location.hash === '#splash' || !window.location.hash) {
            window.location.hash = 'today';
          }
          if (window.handleRouting) await window.handleRouting();
        } catch (localErr) {
          console.error("[Firebase Auth] Local fallback failed:", localErr);
          window.location.hash = 'today';
          if (window.handleRouting) await window.handleRouting();
        }
      }
    } else {
      console.log("[Firebase Auth] User logged out.");
      clearSessionCompat();
      stopAllListeners();
      if (window.State) window.State.currentUser = 'guest'; // GUEST = 'guest'
      else if (typeof State !== 'undefined') State.currentUser = 'guest';
      
      // Redirect to login if on protected pages
      if (window.location.hash !== '#login' && window.location.hash !== '#splash') {
        window.location.hash = 'login';
      }
      if (window.handleRouting) await window.handleRouting();
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

      // Sync memos with precise reconciliation per daily document
      const memosSnap = await window.db.collection('users').doc(uid).collection('memos').get();
      for (const doc of memosSnap.docs) {
        const dateStr = doc.id;
        const data = doc.data() || {};
        
        // CRITICAL: Only process Phase 2 daily documents (where data.items is an Array)
        // Ignore Phase 1 legacy documents (where data.items is undefined) to prevent resurrection of deleted memos
        if (!Array.isArray(data.items)) {
          console.log(`[Sync Reconciliation] Skipping legacy/non-daily memo document ${doc.id}`);
          continue;
        }

        const remoteItems = data.items;

        // 1. Fetch existing local memos for this date
        const localMemos = await DiaryDB.getMemosForDate(dateStr, uid);
        const remoteIds = new Set(remoteItems.map(item => String(item.id)));

        // 2. Reconciliation: Remove stale/orphan local records (or phantom records with dateStr ID / undefined content)
        for (const localMemo of localMemos) {
          const localIdStr = String(localMemo.id);
          if (!remoteIds.has(localIdStr) || localIdStr === dateStr || localMemo.content === undefined) {
            console.log(`[Sync Reconciliation] Deleting stale/phantom local memo ${localMemo.id} for date ${dateStr}`);
            await DiaryDB.deleteMemo(localMemo.id, localMemo.userId || uid);
          }
        }

        // 3. Upsert remote items into IndexedDB
        for (const item of remoteItems) {
          if (item && (item.id !== undefined && item.id !== null)) {
            await DiaryDB.saveMemo({
              id: item.id,
              date: dateStr,
              time: item.time || '00:00',
              content: item.content || '',
              images: item.images || []
            }, uid);
          }
        }
      }
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
        console.error("[FIRESTORE LISTENER ERROR ORIGIN]", {
          timestamp: new Date().toISOString(),
          listenerName: "startPartnershipListener",
          path: `partnerships/${pairId}`,
          operation: "onSnapshot",
          uid: (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null,
          errorCode: err ? err.code : 'UNKNOWN',
          errorMessage: err ? err.message : 'UNKNOWN',
          stack: new Error().stack
        });
        console.error("[Partnership Sync] Subscription error:", err);
      });
  }

  let currentPairId = null;
  let currentSharingStartDate = null;
  let activeListenersPartnerId = null;
  let partnerDiariesState = 'IDLE'; // IDLE, VERIFYING, CONNECTING, ACTIVE, TERMINATED
  let partnerMemosState = 'IDLE';   // IDLE, VERIFYING, CONNECTING, ACTIVE, TERMINATED

  // Helper Function: Server-Verified Partnership Activation Gate
  async function verifyServerPartnershipActive(pairId, currentUid, partnerId) {
    console.log('[PARTNER VERIFY START]', {
      timestamp: new Date().toISOString(),
      pairId,
      currentUid,
      partnerId
    });
    try {
      let docSnap = null;
      try {
        docSnap = await window.db.collection('partnerships').doc(pairId).get({ source: 'server' });
      } catch (serverErr) {
        console.warn("[PARTNER VERIFY] Server source read fallback to default get:", serverErr);
        docSnap = await window.db.collection('partnerships').doc(pairId).get();
      }

      if (docSnap && docSnap.exists) {
        const data = docSnap.data();
        const isStatusActive = data && data.status === 'active';
        const hasMember = data && Array.isArray(data.memberUids) && data.memberUids.includes(currentUid);
        const hasSharingStartDate = data && !!data.sharingStartDate;

        if (isStatusActive && hasMember && hasSharingStartDate) {
          console.log('[PARTNER VERIFY SUCCESS]', {
            timestamp: new Date().toISOString(),
            pairId,
            status: data.status,
            sharingStartDate: data.sharingStartDate,
            fromCache: docSnap.metadata ? docSnap.metadata.fromCache : false
          });
          return { success: true, data };
        }
      }
      console.warn('[PARTNER VERIFY FAILED]', {
        timestamp: new Date().toISOString(),
        pairId,
        exists: docSnap ? docSnap.exists : false
      });
      return { success: false };
    } catch (err) {
      console.error('[PARTNER VERIFY FAILED]', {
        timestamp: new Date().toISOString(),
        pairId,
        error: err ? err.message : 'UNKNOWN'
      });
      return { success: false };
    }
  }

  // Real-time Partner Info & Single Source of Truth Listener
  function startPartnerInfoListener(uid) {
    if (partnerUnsubscribe) partnerUnsubscribe();

    partnerUnsubscribe = window.db.collection('partnerships')
      .where('memberUids', 'array-contains', uid)
      .onSnapshot({ includeMetadataChanges: true }, async (querySnap) => {
        const isServerConfirmed = !querySnap.metadata.hasPendingWrites;
        console.log("[PARTNER SNAPSHOT GATE]", {
          timestamp: new Date().toISOString(),
          docsCount: querySnap.docs.length,
          metadata: {
            fromCache: querySnap.metadata.fromCache,
            hasPendingWrites: querySnap.metadata.hasPendingWrites
          },
          isServerConfirmed: !querySnap.metadata.hasPendingWrites,
          currentUid: (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null,
          listenerStateBeforeCreate: {
            partnerDiariesState,
            hasDiaryUnsubscribe: !!partnerDiariesUnsubscribe,
            activeListenersPartnerId
          }
        });
        const activeDoc = querySnap.docs.find(doc => doc.data().status === 'active');
        if (activeDoc) {
          const data = activeDoc.data();
          const pairId = activeDoc.id;
          const partnerId = data.memberUids.find(id => id !== uid);
          const sharingStartDate = data.sharingStartDate || TODAY_DATE_STR;

          if (partnerId) {
            currentPartnerId = partnerId;
            currentPairId = pairId;
            currentConnectedAt = data.createdAt;
            currentSharingStartDate = sharingStartDate;

            console.log('[T2: PARTNER STATE INITIALIZED]', {
              timestamp: new Date().toISOString(),
              currentPartnerId: partnerId,
              currentPairId: pairId,
              sharingStartDate: sharingStartDate
            });

            // Sync partner links in localStorage
            const links = JSON.parse(localStorage.getItem('partner_links') || '{}');
            links[uid] = partnerId;
            links[partnerId] = uid;
            localStorage.setItem('partner_links', JSON.stringify(links));

            // CRITICAL: Ensure child data listeners are ACTIVE once partnership is Server-Confirmed & Server-Verified
            if (isServerConfirmed) {
              const needsDiariesRecreate = !partnerDiariesUnsubscribe || partnerDiariesState === 'TERMINATED' || partnerDiariesState === 'IDLE' || activeListenersPartnerId !== partnerId;
              const needsMemosRecreate = !partnerMemosUnsubscribe || partnerMemosState === 'TERMINATED' || partnerMemosState === 'IDLE' || activeListenersPartnerId !== partnerId;

              const isDiariesLocked = partnerDiariesState === 'VERIFYING' || partnerDiariesState === 'CONNECTING';
              const isMemosLocked = partnerMemosState === 'VERIFYING' || partnerMemosState === 'CONNECTING';

              if ((needsDiariesRecreate && !isDiariesLocked) || (needsMemosRecreate && !isMemosLocked)) {
                if (needsDiariesRecreate && !isDiariesLocked) partnerDiariesState = 'VERIFYING';
                if (needsMemosRecreate && !isMemosLocked) partnerMemosState = 'VERIFYING';

                console.log("[DIARY LISTENER TRIGGER SOURCE]", {
                  timestamp: new Date().toISOString(),
                  reason: { needsDiariesRecreate, needsMemosRecreate, isServerConfirmed },
                  partnerId,
                  currentPartnerId,
                  currentPairId
                });

                // Server-Verified Activation Flow
                verifyServerPartnershipActive(pairId, uid, partnerId).then(async (verification) => {
                  if (verification.success) {
                    activeListenersPartnerId = partnerId;

                    if (needsDiariesRecreate) {
                      partnerDiariesState = 'CONNECTING';
                      console.log('[DIARY LISTENER ACTIVATED]', { timestamp: new Date().toISOString(), partnerId });
                      startPartnerDiariesListener(partnerId, sharingStartDate);
                    }
                    if (needsMemosRecreate) {
                      partnerMemosState = 'CONNECTING';
                      startPartnerMemosListener(partnerId, sharingStartDate);
                    }
                    if (!partnerPublicProfileUnsubscribe) startPartnerPublicProfileListener(partnerId);

                    if (window.loadTodayData) await window.loadTodayData();
                  } else {
                    console.warn('[PARTNER VERIFY FAILED] Child listener activation aborted until next server snapshot.');
                    if (needsDiariesRecreate) partnerDiariesState = 'TERMINATED';
                    if (needsMemosRecreate) partnerMemosState = 'TERMINATED';
                  }
                }).catch(err => {
                  console.error('[PARTNER VERIFY ERROR]', err);
                  if (needsDiariesRecreate) partnerDiariesState = 'TERMINATED';
                  if (needsMemosRecreate) partnerMemosState = 'TERMINATED';
                });
              }
            }
          }
        } else {
          if (currentPartnerId !== null || activeListenersPartnerId !== null) {
            console.log("[Partnership Listener] Disconnected or no active partnership.");
            const oldPartnerId = currentPartnerId || activeListenersPartnerId;
            currentPartnerId = null;
            currentPairId = null;
            currentConnectedAt = null;
            currentSharingStartDate = null;

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
        console.error("[FIRESTORE LISTENER ERROR ORIGIN]", {
          timestamp: new Date().toISOString(),
          listenerName: "startPartnerInfoListener",
          path: "partnerships",
          operation: "onSnapshot",
          uid: (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null,
          errorCode: err ? err.code : 'UNKNOWN',
          errorMessage: err ? err.message : 'UNKNOWN',
          stack: new Error().stack
        });
        console.error("[Partnership Sync] Subscription error:", err);
      });
  }

  // PATH A — Partner Today: Single Document Realtime Listener (users/{partnerId}/diaries/{TODAY_DATE_STR})
  async function startPartnerDiariesListener(partnerId, sharingStartDate) {
    console.log("[DIARY LISTENER CREATE TRACE]", {
      timestamp: new Date().toISOString(),
      partnerId,
      stack: new Error().stack
    });
    const listenerId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
    const currentUser = (window.auth && window.auth.currentUser) ? window.auth.currentUser : null;
    let tokenDetails = null;
    if (currentUser && typeof currentUser.getIdTokenResult === 'function') {
      try {
        const tokenResult = await currentUser.getIdTokenResult();
        tokenDetails = {
          tokenUid: currentUser.uid,
          authTime: tokenResult.authTime,
          issuedAtTime: tokenResult.issuedAtTime,
          expirationTime: tokenResult.expirationTime
        };
      } catch (e) {
        tokenDetails = { error: e.message };
      }
    }

    console.log('[AUTH TOKEN & LISTENER CREATE]', {
      listenerId,
      timestamp: new Date().toISOString(),
      currentUid: currentUser ? currentUser.uid : null,
      tokenDetails,
      currentPartnerId,
      currentPairId,
      partnerId
    });

    // Perform immediate pre-listener single .get() check
    let preListenerGetResult = null;
    try {
      const getSnap = await window.db.collection("users").doc(partnerId).collection("diaries").doc(TODAY_DATE_STR).get();
      preListenerGetResult = {
        success: true,
        exists: getSnap.exists,
        fromCache: getSnap.metadata.fromCache,
        errorCode: null
      };
    } catch (err) {
      preListenerGetResult = {
        success: false,
        errorCode: err ? err.code : 'unknown'
      };
    }

    console.log('[IMMEDIATE PRE-LISTENER GET TEST]', {
      listenerId,
      timestamp: new Date().toISOString(),
      currentUid: currentUser ? currentUser.uid : null,
      currentPairId,
      partnerId,
      preListenerGetResult
    });

    console.log('[WATCH TARGET CREATE AUDIT]', {
      listenerId,
      authUid: currentUser ? currentUser.uid : null,
      path: `users/${partnerId}/diaries/${TODAY_DATE_STR}`,
      persistenceEnabled: false,
      timestamp: new Date().toISOString()
    });

    if (partnerDiariesUnsubscribe) {
      partnerDiariesUnsubscribe();
      partnerDiariesUnsubscribe = null;
    }
    partnerDiariesState = 'ACTIVE';

    partnerDiariesUnsubscribe = window.db.collection('users').doc(partnerId).collection('diaries').doc(TODAY_DATE_STR)
      .onSnapshot(async (docSnap) => {
        partnerDiariesState = 'ACTIVE';
        console.log('[WATCH TARGET SUCCESS AUDIT]', {
          listenerId,
          fromCache: docSnap.metadata.fromCache,
          hasPendingWrites: docSnap.metadata.hasPendingWrites,
          readTime: new Date().toISOString()
        });
        console.log('[DIARY SUCCESS]', { listenerId, timestamp: new Date().toISOString(), unsubscribeCurrentValue: !!partnerDiariesUnsubscribe });
        try {
          if (docSnap.exists) {
            const data = docSnap.data();
            if (data && data.content && data.content.trim()) {
              let timestampStr = new Date().toISOString();
              if (data.updatedAt) {
                timestampStr = typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : data.updatedAt;
              }
              console.log('[Partner Today Sync] Realtime document update received for date:', TODAY_DATE_STR);
              await DiaryDB.saveDiary({
                date: TODAY_DATE_STR,
                content: data.content,
                mood: data.mood || 'none',
                timestamp: timestampStr
              }, partnerId);
            } else {
              console.log('[Partner Today Sync] Document is empty for date:', TODAY_DATE_STR);
              await DiaryDB.deleteDiary(TODAY_DATE_STR, partnerId);
            }
          } else {
            console.log('[Partner Today Sync] Document does not exist for date:', TODAY_DATE_STR);
            await DiaryDB.deleteDiary(TODAY_DATE_STR, partnerId);
          }
          if (window.loadTodayData) await window.loadTodayData();
        } catch (err) {
          console.error('[Partner Today Sync] Error updating local cache:', err);
        }
      }, (err) => {
        const errUser = (window.auth && window.auth.currentUser) ? window.auth.currentUser : null;
        const calculatedPairId = getPairId(errUser ? errUser.uid : '', partnerId);
        console.log('[WATCH TARGET ERROR AUDIT]', {
          listenerId,
          errorCode: err ? err.code : 'UNKNOWN',
          timestamp: new Date().toISOString(),
          activeTargetState: partnerDiariesState,
          networkState: navigator.onLine ? 'online' : 'offline'
        });
        console.log('[PAIR ID RESOLUTION AT ERROR]', {
          authUid: errUser ? errUser.uid : null,
          partnerId: partnerId,
          calculatedPairId: calculatedPairId,
          clientPairId: currentPairId,
          timestamp: new Date().toISOString()
        });
        console.error("[FIRESTORE LISTENER ERROR ORIGIN]", {
          timestamp: new Date().toISOString(),
          listenerName: "startPartnerDiariesListener",
          path: `users/${partnerId}/diaries/${TODAY_DATE_STR}`,
          operation: "onSnapshot",
          uid: errUser ? errUser.uid : null,
          errorCode: err ? err.code : 'UNKNOWN',
          errorMessage: err ? err.message : 'UNKNOWN',
          stack: new Error().stack
        });
        console.warn("[Partner Today Sync] Subscription notice (listener terminated):", err);
        console.log('[DIARY ERROR AUTH AUDIT]', {
          listenerId,
          timestamp: new Date().toISOString(),
          currentUid: errUser ? errUser.uid : null,
          errorCode: err ? err.code : null,
          pairId: currentPairId,
          currentPartnerInfo: { partnerId, currentPartnerId, activeListenersPartnerId },
          unsubscribeCurrentValue: !!partnerDiariesUnsubscribe
        });
        partnerDiariesUnsubscribe = null;
        partnerDiariesState = 'TERMINATED';
      });
  }

  function startPartnerMemosListener(partnerId, sharingStartDate) {
    if (partnerMemosUnsubscribe) {
      partnerMemosUnsubscribe();
      partnerMemosUnsubscribe = null;
    }
    partnerMemosState = 'ACTIVE';

    const todayDate = TODAY_DATE_STR;
    partnerMemosUnsubscribe = window.db.collection('users').doc(partnerId).collection('memos').doc(todayDate)
      .onSnapshot(async (docSnap) => {
        partnerMemosState = 'ACTIVE';
        try {
          if (docSnap.exists) {
            const data = docSnap.data();
            const items = (data && Array.isArray(data.items)) ? data.items : [];
            await DiaryDB.deleteMemosForDate(todayDate, partnerId);
            if (items.length > 0) {
              const normalizedItems = items.map(item => ({
                ...item,
                date: todayDate
              }));
              await DiaryDB.saveMemos(normalizedItems, partnerId);
            }
            console.log(`[Partner Memos Today] Realtime update for date ${todayDate}: ${items.length} items synced`);
          } else {
            await DiaryDB.deleteMemosForDate(todayDate, partnerId);
          }
          if (window.loadTodayData) await window.loadTodayData();
        } catch (err) {
          console.error('[Partner Memos Today] Error saving partner memos to local DB:', err);
        }
      }, (err) => {
        console.error("[FIRESTORE LISTENER ERROR ORIGIN]", {
          timestamp: new Date().toISOString(),
          listenerName: "startPartnerMemosListener",
          path: `users/${partnerId}/memos/${todayDate}`,
          operation: "onSnapshot",
          uid: (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null,
          errorCode: err ? err.code : 'UNKNOWN',
          errorMessage: err ? err.message : 'UNKNOWN',
          stack: new Error().stack
        });
        console.warn("[Partner Memos Today] Subscription notice (listener terminated):", err);
        partnerMemosUnsubscribe = null;
        partnerMemosState = 'TERMINATED';
      });
  }

  function startPartnerPublicProfileListener(partnerId) {
    if (partnerPublicProfileUnsubscribe) partnerPublicProfileUnsubscribe();
    if (!partnerId || partnerId === 'user_a' || partnerId === 'user_b' || !window.db) return;

    console.log("[Partner Profile Sync] Subscribing to publicProfile for partner:", partnerId);
    partnerPublicProfileUnsubscribe = window.db.collection('users').doc(partnerId)
      .collection('publicProfile').doc('info')
      .onSnapshot(async (doc) => {
        let partnerName = '筆友';
        if (doc.exists) {
          const data = doc.data();
          if (data && data.displayName && data.displayName.trim()) {
            partnerName = data.displayName.trim();
          }
        }
        console.log("[Partner Profile Sync] Realtime partner displayName update received:", partnerName);
        
        await DiaryDB.saveUser({
          id: partnerId,
          displayName: partnerName,
          updatedAt: new Date().toISOString()
        });

        if (window.updatePartnerDisplayNamesInUI) {
          window.updatePartnerDisplayNamesInUI(partnerName);
        }
        if (window.loadTodayData) await window.loadTodayData();
      }, (err) => {
        console.error("[FIRESTORE LISTENER ERROR ORIGIN]", {
          timestamp: new Date().toISOString(),
          listenerName: "startPartnerPublicProfileListener",
          path: `users/${partnerId}/publicProfile/info`,
          operation: "onSnapshot",
          uid: (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null,
          errorCode: err ? err.code : 'UNKNOWN',
          errorMessage: err ? err.message : 'UNKNOWN',
          stack: new Error().stack
        });
        console.warn("[Partner Profile Sync] Public profile listener notice:", err);
      });
  }

  function stopPartnerDataListeners() {
    console.log('[STOP LISTENER]', { timestamp: new Date().toISOString() });
    activeListenersPartnerId = null;
    partnerDiariesState = 'STOPPED';
    partnerMemosState = 'STOPPED';
    if (partnerDiariesUnsubscribe) { partnerDiariesUnsubscribe(); partnerDiariesUnsubscribe = null; }
    if (partnerMemosUnsubscribe) { partnerMemosUnsubscribe(); partnerMemosUnsubscribe = null; }
    if (partnerPublicProfileUnsubscribe) { partnerPublicProfileUnsubscribe(); partnerPublicProfileUnsubscribe = null; }
  }

  // PATH B — Partner History: Firestore Source of Truth -> Update IndexedDB Cache -> Offline Fallback
  window.getPartnerDiaryByDate = async function(partnerId, date, sharingStartDate) {
    if (!partnerId || !date || !sharingStartDate) return null;

    // Privacy guard: deny client read request if date < sharingStartDate
    if (date < sharingStartDate) {
      console.log(`[Partner History] Date ${date} is prior to sharingStartDate ${sharingStartDate}. Access DENIED.`);
      return null;
    }

    // 1. Try Firestore get() FIRST as Source of Truth
    try {
      console.log(`[Partner History] Fetching latest single document from Firestore for ${date}...`);
      const docSnap = await window.db.collection('users').doc(partnerId).collection('diaries').doc(date).get();
      if (docSnap.exists) {
        const data = docSnap.data();
        if (data && data.content && data.content.trim()) {
          let timestampStr = new Date().toISOString();
          if (data.updatedAt) {
            timestampStr = typeof data.updatedAt.toDate === 'function' ? data.updatedAt.toDate().toISOString() : data.updatedAt;
          }
          const record = {
            date: date,
            content: data.content,
            mood: data.mood || 'none',
            timestamp: timestampStr
          };
          // Save / update latest data in IndexedDB cache
          await DiaryDB.saveDiary(record, partnerId);
          return record;
        } else {
          // Document has empty content -> delete local cache
          await DiaryDB.deleteDiary(date, partnerId);
          return null;
        }
      } else {
        // Document does not exist in Firestore -> delete local cache
        await DiaryDB.deleteDiary(date, partnerId);
        return null;
      }
    } catch (err) {
      console.warn(`[Partner History] Firestore get() failed / offline for ${date}, falling back to IndexedDB cache:`, err);
    }

    // 2. Fallback to IndexedDB cache ONLY if Firestore read fails or device is offline
    try {
      const cached = await DiaryDB.getDiary(date, partnerId);
      if (cached && cached.content) {
        console.log(`[Partner History] Serving offline cached partner diary for ${date}`);
        return cached;
      }
    } catch (_) {}

    return null;
  };

  window.getPartnerMemosByDate = async function(partnerId, date, sharingStartDate) {
    if (!partnerId || !date) return [];
    if (sharingStartDate && date < sharingStartDate) {
      console.warn(`[Partner Memo History] Date ${date} is before sharingStartDate ${sharingStartDate}, blocking access.`);
      return [];
    }

    // 1. Priority 1: Firestore get() (Source of Truth)
    if (navigator.onLine && window.auth && window.auth.currentUser) {
      try {
        console.log(`[Partner Memo History] Fetching latest single document from Firestore for date ${date}...`);
        const docSnap = await window.db.collection('users').doc(partnerId).collection('memos').doc(date).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          const items = (data && Array.isArray(data.items)) ? data.items : [];
          await DiaryDB.deleteMemosForDate(date, partnerId);
          for (const item of items) {
            await DiaryDB.saveMemo(item, partnerId);
          }
          return items;
        } else {
          await DiaryDB.deleteMemosForDate(date, partnerId);
          return [];
        }
      } catch (err) {
        console.warn(`[Partner Memo History] Firestore get() failed for ${date}, falling back to IndexedDB:`, err);
      }
    }

    // 2. Priority 2: Fallback to IndexedDB cache
    try {
      const cached = await DiaryDB.getMemosForDate(date, partnerId);
      return cached || [];
    } catch (_) {
      return [];
    }
  };

  function startPartnerMemosListener(partnerId, sharingStartDate) {
    if (partnerMemosUnsubscribe) partnerMemosUnsubscribe();

    const todayDate = TODAY_DATE_STR;
    if (sharingStartDate && todayDate < sharingStartDate) {
      console.log("[Partner Memos Today] Today is before sharingStartDate, skipping listener.");
      return;
    }

    partnerMemosUnsubscribe = window.db.collection('users').doc(partnerId).collection('memos').doc(todayDate)
      .onSnapshot(async (docSnap) => {
        try {
          if (docSnap.exists) {
            const data = docSnap.data();
            const items = (data && Array.isArray(data.items)) ? data.items : [];
            await DiaryDB.deleteMemosForDate(todayDate, partnerId);
            for (const item of items) {
              await DiaryDB.saveMemo(item, partnerId);
            }
          } else {
            await DiaryDB.deleteMemosForDate(todayDate, partnerId);
          }
          if (window.loadTodayData) await window.loadTodayData();
        } catch (err) {
          console.warn("[Partner Memos Today] Realtime sync error:", err);
        }
      }, (err) => {
        console.warn("[Partner Memos Today] Subscription notice:", err);
      });
  }

  let partnerPublicProfileUnsubscribe = null;

  function startPartnerPublicProfileListener(partnerId) {
    if (partnerPublicProfileUnsubscribe) partnerPublicProfileUnsubscribe();
    if (!partnerId || partnerId === 'user_a' || partnerId === 'user_b' || !window.db) return;

    console.log("[Partner Profile Sync] Subscribing to publicProfile for partner:", partnerId);
    partnerPublicProfileUnsubscribe = window.db.collection('users').doc(partnerId)
      .collection('publicProfile').doc('info')
      .onSnapshot(async (doc) => {
        let partnerName = '筆友';
        if (doc.exists) {
          const data = doc.data();
          if (data && data.displayName && data.displayName.trim()) {
            partnerName = data.displayName.trim();
          }
        }
        console.log("[Partner Profile Sync] Realtime partner displayName update received:", partnerName);
        
        await DiaryDB.saveUser({
          id: partnerId,
          displayName: partnerName,
          updatedAt: new Date().toISOString()
        });

        if (window.updatePartnerDisplayNamesInUI) {
          window.updatePartnerDisplayNamesInUI(partnerName);
        }
      }, (err) => {
        console.warn("[Partner Profile Sync] Public profile listener notice:", err);
        if (window.updatePartnerDisplayNamesInUI) {
          window.updatePartnerDisplayNamesInUI('筆友');
        }
      });
  }

  function stopPartnerDataListeners() {
    if (partnerDiariesUnsubscribe) { partnerDiariesUnsubscribe(); partnerDiariesUnsubscribe = null; }
    if (partnerMemosUnsubscribe) { partnerMemosUnsubscribe(); partnerMemosUnsubscribe = null; }
    if (partnerPublicProfileUnsubscribe) { partnerPublicProfileUnsubscribe(); partnerPublicProfileUnsubscribe = null; }
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
          const isValidIntent = item.data && item.data.source === 'user_action' && item.data.confirmed === true;
          if (isValidIntent && item.data.date) {
            console.log(`[Firebase SyncManager] VALIDATION PASSED: Executing Firestore delete for date: ${item.data.date}`);
            try {
              await window.db.collection('users').doc(uid).collection('diaries').doc(item.data.date).delete();
              console.log(`[Firebase SyncManager] CLOUD DELETE SUCCESS for date: ${item.data.date}`);
            } catch (delErr) {
              console.error(`[Firebase SyncManager] CLOUD DELETE FAILURE for date: ${item.data.date}`, delErr);
              throw delErr;
            }
          } else {
            console.warn('[Firebase SyncManager] DISCARDING unconfirmed delete_diary task without touching Cloud Firestore:', item);
          }
        } else if (item.action === 'save_memo' || item.action === 'delete_memo') {
          if (item.data && item.data.date) {
            const date = item.data.date;
            const allMemos = await DiaryDB.getMemosForDate(date, uid);
            const memoItems = allMemos.map(m => ({
              id: m.id,
              date: m.date,
              time: m.time || '00:00',
              content: m.content || '',
              images: m.images || []
            }));
            await window.db.collection('users').doc(uid).collection('memos').doc(date).set({
              date: date,
              items: memoItems,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
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

  // Ensure owner's local today's Diary and Memos are flushed and verified in Cloud Firestore BEFORE creating PIN
  async function ensurePreInviteCloudSync(uid) {
    if (!uid || !window.db) return;
    console.log("[PARTNER INVITE] Pre-invite cloud sync START for uid:", uid);

    // 1. Process any pending queue items first
    if (window.SyncManager && window.SyncManager.processQueue) {
      await window.SyncManager.processQueue();
    }

    // 2. Ensure today's local diary is uploaded to Cloud Firestore
    const todayDiary = await DiaryDB.getDiary(TODAY_DATE_STR, uid);
    if (todayDiary && todayDiary.content && todayDiary.content.trim()) {
      console.log("[PARTNER INVITE] Syncing today's local Diary to Cloud Firestore...");
      await window.db.collection('users').doc(uid).collection('diaries').doc(TODAY_DATE_STR).set({
        date: TODAY_DATE_STR,
        content: todayDiary.content,
        mood: todayDiary.mood || 'none',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      console.log("[PARTNER INVITE] Diary sync COMPLETE");
    }

    // 3. Ensure today's local memos are uploaded to Cloud Firestore
    const todayMemos = await DiaryDB.getMemosForDate(TODAY_DATE_STR, uid);
    const memoItems = todayMemos.map(m => ({
      id: m.id,
      date: TODAY_DATE_STR,
      time: m.time || '00:00',
      content: m.content || '',
      images: m.images || []
    }));
    console.log(`[PARTNER INVITE] Syncing today's local Memos (${memoItems.length} items) to Cloud Firestore...`);
    await window.db.collection('users').doc(uid).collection('memos').doc(TODAY_DATE_STR).set({
      date: TODAY_DATE_STR,
      items: memoItems,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log("[PARTNER INVITE] Memo sync COMPLETE");

    // 4. Verify today's Cloud Firestore documents exist / are queryable
    const diaryDoc = await window.db.collection('users').doc(uid).collection('diaries').doc(TODAY_DATE_STR).get();
    const memoDoc = await window.db.collection('users').doc(uid).collection('memos').doc(TODAY_DATE_STR).get();
    console.log("[PARTNER INVITE] Firestore verification COMPLETE", {
      diaryExists: diaryDoc.exists,
      memoExists: memoDoc.exists
    });

    console.log("[PARTNER INVITE] Pre-invite cloud sync SUCCESS");
    return true;
  }

  // Override PartnerService Invite Flow and Linkage Logic
  const FirebasePartnerService = {
    getPartnerId(userId) {
      return currentPartnerId;
    },
    getSharingStartDate(userId) {
      return currentSharingStartDate || TODAY_DATE_STR;
    },
    async previewInviteCode(pin) {
      const authUser = window.auth && window.auth.currentUser ? window.auth.currentUser : null;
      const realAuthUid = authUser ? authUser.uid : (State.currentUser && State.currentUser !== 'user_a' && State.currentUser !== 'user_b' ? State.currentUser : null);

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
          const pubDoc = await window.db.collection('users').doc(inviteOwnerUid).collection('publicProfile').doc('info').get();
          if (pubDoc.exists && pubDoc.data().displayName && pubDoc.data().displayName.trim()) {
            inviterName = pubDoc.data().displayName.trim();
          }
        } catch (err) {
          console.warn('[PARTNER PREVIEW] Could not fetch publicProfile for owner:', inviteOwnerUid, err);
        }

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

      // CRITICAL PRE-INVITE SYNC: Flush and verify owner's today's Diary & Memo to Cloud Firestore BEFORE creating PIN
      try {
        await ensurePreInviteCloudSync(realAuthUid);
      } catch (syncErr) {
        console.error('[PARTNER INVITE] Pre-invite cloud sync FAILED:', syncErr);
        alert('產生邀請碼失敗：無法將今日資料同步至雲端，請檢查網路連線後重試。');
        throw syncErr;
      }

      // Ensure owner's publicProfile/info exists before generating invite code
      try {
        const pubRef = window.db.collection('users').doc(realAuthUid).collection('publicProfile').doc('info');
        const pubDoc = await pubRef.get();
        if (!pubDoc.exists) {
          const userDoc = await window.db.collection('users').doc(realAuthUid).get();
          const ownerName = (userDoc.exists && userDoc.data().displayName) ? userDoc.data().displayName.trim() : (authUser ? (authUser.displayName || (authUser.email ? authUser.email.split('@')[0] : '筆友')) : '筆友');
          await pubRef.set({
            displayName: ownerName,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      } catch (err) {
        console.warn('[INVITE CREATE] Ensure publicProfile notice:', err);
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
        let ownerDisplayName = '筆友';
        try {
          const uDoc = await window.db.collection('users').doc(realAuthUid).get();
          if (uDoc.exists && uDoc.data().displayName) {
            ownerDisplayName = uDoc.data().displayName;
          }
        } catch (_) {}

        const now = new Date();
        const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour expiration

        await window.db.collection('invitations').doc(pin).set({
          invitationId: pin,
          ownerUid: realAuthUid,
          ownerDisplayName: ownerDisplayName,
          status: 'pending',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          expiresAt: firebase.firestore.Timestamp.fromDate(expires)
        });
        console.log(`[PARTNER INVITE] PIN READY: ${pin} (ownerUid: ${realAuthUid})`);
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

        const partnershipRef = window.db.collection('partnerships').doc(pairId);

        // Atomic write: Server evaluates create vs update automatically based on document presence & firestore.rules
        batch.set(partnershipRef, {
          pairId: pairId,
          memberUids: [inviteOwnerUid, realAuthUid].sort(),
          status: 'active',
          sharingStartDate: sharingStartDate,
          createdAt: connectedAt,
          sourceInvitationId: pin,
          disconnectedAt: null
        });

        // Mark invite as accepted atomically with acceptor metadata
        batch.update(inviteRef, {
          status: 'accepted',
          acceptedBy: realAuthUid,
          acceptedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log('[REAL ACCEPT BATCH]', {
          projectId: window.firebase?.app()?.options?.projectId,
          authUid: realAuthUid,
          invitationPath: `invitations/${pin}`,
          invitationOwnerUid: inviteOwnerUid,
          invitationStatusBefore: inviteData.status,
          partnershipPath: `partnerships/${pairId}`,
          pairId: pairId,
          memberUids: [inviteOwnerUid, realAuthUid].sort(),
          sourceInvitationId: pin,
          partnershipStatus: 'active',
          sharingStartDate: sharingStartDate
        });

        console.log('[BATCH WRITE OPERATION AUDIT]', {
          timestamp: new Date().toISOString(),
          partnershipOperation: 'server_decided_create_or_update',
          invitationOperation: 'update',
          pin: pin,
          pairId: pairId,
          partnershipPath: `partnerships/${pairId}`,
          invitationPath: `invitations/${pin}`,
          authUid: realAuthUid
        });

        console.log('[REAL ACCEPT BATCH] COMMIT START');

        await batch.commit();

        console.log('[T0: BATCH COMMIT SUCCESS]', { timestamp: new Date().toISOString() });
        console.log('[REAL ACCEPT BATCH] COMMIT SUCCESS');
        console.log(`[PARTNER DEBUG] Batch committed successfully!`);
        return true;
      } catch (err) {
        console.error('[REAL ACCEPT BATCH] COMMIT FAIL', {
          code: err ? err.code : 'UNKNOWN',
          message: err ? err.message : 'UNKNOWN'
        });
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

    }
  };
  window.FirebasePartnerService = FirebasePartnerService;
  window.PartnerService = FirebasePartnerService;

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
    if (!State.currentUser) {
      console.log("[Auth State] Skipping renderWeeklyReview because Auth is initializing (State.currentUser is null)");
      return;
    }
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
          SyncManager.addToQueue('delete_diary', { date: dateStr, source: 'user_action', confirmed: true });
          
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
      btnOnboardingSubmit.addEventListener('click', async () => {
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

    // Partner button event handlers are unified cleanly in app.js as Single Source of Truth

    // 5. Delete Account Button (typing delete to confirm + export download blob)
    const btnConfirmExportDelete = document.getElementById('btn-confirm-export-delete');
    const deleteConfirmPassword = document.getElementById('delete-confirm-password');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    if (btnConfirmExportDelete && deleteConfirmPassword && deleteConfirmModal) {
      btnConfirmExportDelete.addEventListener('click', async () => {
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
      btnLogout.addEventListener('click', async () => {
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
      btnSecurityTrigger.addEventListener('click', () => {
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

  // Helper cleanup completed
})();
