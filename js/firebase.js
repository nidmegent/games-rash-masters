
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-storage.js";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js";

// ========================================
// FIREBASE CONFIG
// ========================================

const firebaseConfig = {
  apiKey: "AIzaSyBdYQicyitdp2d7GgbYdy7Sx4-26hLQUpY",
  authDomain: "rash-masters.firebaseapp.com",
  projectId: "rash-masters",
  storageBucket: "rash-masters.firebasestorage.app",
  messagingSenderId: "21821671789",
  appId: "1:21821671789:web:1670f46f7099a67d613264",
  measurementId: "G-VLSKMQB0MF"
};

// ========================================
// INITIALIZE FIREBASE
// ========================================

const app = initializeApp(firebaseConfig);

// ========================================
// APP CHECK
// ========================================

// Google Cloudで作成したサイトキーに置き換える
const RECAPTCHA_ENTERPRISE_SITE_KEY =
  "6Leh7iAuAAAAAIwiaBzbemI5_Q2_7snsuR_B3dXz";

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(
    RECAPTCHA_ENTERPRISE_SITE_KEY
  ),
  isTokenAutoRefreshEnabled: true
});

// ========================================
// AUTHENTICATION
// ========================================

const auth = getAuth(app);

// Google Login
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

// ========================================
// FIRESTORE
// ========================================

const db = getFirestore(app);

// ========================================
// STORAGE
// ========================================

const storage = getStorage(app);

// ========================================
// EXPORT
// ========================================

export {
  app,
  appCheck,
  auth,
  googleProvider,
  db,
  storage
};
