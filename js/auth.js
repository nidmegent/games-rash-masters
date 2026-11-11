
import {
  auth,
  googleProvider,
  db
} from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ==============================
// エラーメッセージ
// ==============================

function getErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "このメールアドレスは既に登録されています。",
    "auth/invalid-email": "メールアドレスの形式が正しくありません。",
    "auth/weak-password": "パスワードは6文字以上にしてください。",
    "auth/user-not-found": "アカウントが見つかりません。",
    "auth/wrong-password": "パスワードが正しくありません。",
    "auth/invalid-credential": "メールアドレスまたはパスワードが正しくありません。",
    "auth/popup-closed-by-user": "ログインがキャンセルされました。",
    "auth/popup-blocked": "ポップアップがブロックされました。"
  };

  return messages[error.code] || "エラーが発生しました。もう一度お試しください。";
}

// ==============================
// メッセージ表示
// ==============================

function showMessage(message, type = "error") {
  const element = document.getElementById("message");

  if (!element) return;

  element.textContent = message;
  element.className = "message " + type;
  element.style.display = "block";
}

// ==============================
// プレイヤープロフィール作成・更新
// ==============================

const profilePromises = new Map();

async function ensureUserProfile(user) {
  if (!user) return;

  if (profilePromises.has(user.uid)) {
    return profilePromises.get(user.uid);
  }

  const task = (async () => {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    const playerName = user.displayName || user.email || "PLAYER";

    if (!snapshot.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email || "",
        displayName: playerName,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      });
    } else {
      const oldData = snapshot.data();

      const updates = {
        lastLoginAt: serverTimestamp()
      };

      if (oldData.displayName !== playerName) {
        updates.displayName = playerName;
      }

      await updateDoc(userRef, updates);
    }
  })();

  profilePromises.set(user.uid, task);

  try {
    await task;
  } catch (error) {
    profilePromises.delete(user.uid);
    throw error;
  }
}

// ==============================
// メールアドレス登録
// ==============================

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!name) {
      showMessage("プレイヤー名を入力してください。");
      return;
    }

    if (password.length < 6) {
      showMessage("パスワードは6文字以上にしてください。");
      return;
    }

    const button = registerForm.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "CREATING ACCOUNT...";

    try {
      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(result.user, {
        displayName: name
      });

      await ensureUserProfile(result.user);

      location.href = "home.html";

    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error));
      button.disabled = false;
      button.textContent = "CREATE ACCOUNT";
    }
  });
}

// ==============================
// メールアドレスログイン
// ==============================

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const button = loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "LOGGING IN...";

    try {
      const result = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      await ensureUserProfile(result.user);

      location.href = "home.html";

    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error));
      button.disabled = false;
      button.textContent = "LOGIN";
    }
  });
}

// ==============================
// Googleログイン
// ==============================

const googleButton = document.getElementById("googleLogin");

if (googleButton) {
  googleButton.addEventListener("click", async () => {
    googleButton.disabled = true;

    try {
      const result = await signInWithPopup(auth, googleProvider);

      await ensureUserProfile(result.user);

      location.href = "home.html";

    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error));
      googleButton.disabled = false;
    }
  });
}

// ==============================
// ログアウト
// ==============================

const logoutButton = document.getElementById("logout");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "index.html";
  });
}

// ==============================
// ログイン状態の確認
// ==============================

const currentPage = location.pathname;

onAuthStateChanged(auth, async (user) => {

  const isHomePage =
    currentPage.endsWith("/home.html") ||
    currentPage === "/home.html";

  const isAuthPage =
    currentPage.endsWith("/login.html") ||
    currentPage.endsWith("/register.html");

  if (isHomePage) {
    if (!user) {
      location.href = "login.html";
      return;
    }

    try {
      await ensureUserProfile(user);
    } catch (error) {
      console.error("プロフィールの保存に失敗しました:", error);
      showMessage("プレイヤー情報の読み込みに失敗しました。再読み込みしてください。");
      return;
    }

    const nameElement = document.getElementById("playerName");

    if (nameElement) {
      nameElement.textContent =
        user.displayName || user.email || "PLAYER";
    }

    const emailElement = document.getElementById("playerEmail");

    if (emailElement) {
      emailElement.textContent = user.email || "";
    }
  }

  if (isAuthPage && user) {
    location.href = "home.html";
  }
});
