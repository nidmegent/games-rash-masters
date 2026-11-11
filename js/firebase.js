
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

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBdYQicyitdp2d7GgbYdy7Sx4-26hLQUpY",
  authDomain: "rash-masters.firebaseapp.com",
  projectId: "rash-masters",
  storageBucket: "rash-masters.firebasestorage.app",
  messagingSenderId: "21821671789",
  appId: "1:21821671789:web:1670f46f7099a67d613264",
  measurementId: "G-VLSKMQB0MF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Authentication
const auth = getAuth(app);

// Google Login
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

// Database
const db = getFirestore(app);

// Storage
const storage = getStorage(app);

export {
  app,
  auth,
  googleProvider,
  db,
  storage
};
