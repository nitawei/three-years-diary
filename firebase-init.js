// Clear Service Workers & Cache to prevent caching of outdated local files
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for(let registration of registrations) {
      registration.unregister();
      console.log("[Service Worker] Unregistered active worker to bypass cache.");
    }
  });
}
if ('caches' in window) {
  caches.keys().then(function(names) {
    for (let name of names) {
      caches.delete(name);
      console.log("[Cache] Deleted cache bucket:", name);
    }
  });
}

// Initialize Firebase for Vanilla JS
const firebaseConfig = {
  apiKey: "AIzaSyCnKfBTJZsYEFsSlaTGjP-UMlgY05B17d0",
  authDomain: "diary-1095.firebaseapp.com",
  projectId: "diary-1095",
  storageBucket: "diary-1095.firebasestorage.app",
  messagingSenderId: "726429843784",
  appId: "1:726429843784:web:2fd5954f17cdf1281ab37d",
  measurementId: "G-J59C570QS8"
};

if (typeof firebase !== 'undefined') {
  // Initialize Firebase App
  firebase.initializeApp(firebaseConfig);
  window.auth = firebase.auth();
  window.db = firebase.firestore();
  console.log("[Firebase Init] Compatibility SDK initialized successfully.");
} else {
  console.warn("[Firebase Init] Firebase SDK failed to load. Using offline mock fallback.");
  window.auth = {
    onAuthStateChanged: function(callback) {
      console.log("[Firebase Init Mock] onAuthStateChanged registered.");
    },
    signInWithPopup: function() {
      return Promise.reject(new Error("⚠️ Firebase SDK 載入失敗（請檢查網路連線或是否阻擋了 gstatic.com CDN 資源，或請勿使用本地 file:// 協定雙擊開啟網頁，須以 http://localhost 伺服器方式開啟）"));
    },
    signInWithRedirect: function() {
      return Promise.reject(new Error("⚠️ Firebase SDK 載入失敗（請檢查網路連線）"));
    },
    signOut: function() {
      return Promise.resolve();
    }
  };
  window.db = null;
}
