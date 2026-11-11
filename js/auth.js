
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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ========================================
// SUPER ADMIN
// ========================================

const SUPER_ADMINS = [
  "lgs.esportsgames@gmail.com",
  "galleria0302@gmail.com"
];

function isSuperAdmin(user) {
  return !!user?.email &&
    SUPER_ADMINS.includes(user.email.toLowerCase());
}

// ========================================
// プレイヤー情報をFirestoreに保存
// ========================================

async function ensureUserProfile(user) {
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  const profileData = {
    uid: user.uid,
    email: user.email || "",
    displayName: user.displayName || "PLAYER",
    lastLoginAt: serverTimestamp()
  };

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      ...profileData,
      createdAt: serverTimestamp(),
      coins: 0,
      role: "player"
    });
  } else {
    await setDoc(userRef, profileData, {
      merge: true
    });
  }
}

// ========================================
// エラーメッセージ
// ========================================

function getErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use":
      "このメールアドレスは既に登録されています。",
    "auth/invalid-email":
      "メールアドレスの形式が正しくありません。",
    "auth/weak-password":
      "パスワードは6文字以上にしてください。",
    "auth/user-not-found":
      "アカウントが見つかりません。",
    "auth/wrong-password":
      "パスワードが正しくありません。",
    "auth/invalid-credential":
      "メールアドレスまたはパスワードが正しくありません。",
    "auth/invalid-login-credentials":
      "メールアドレスまたはパスワードが正しくありません。",
    "auth/popup-closed-by-user":
      "ログインがキャンセルされました。",
    "auth/popup-blocked":
      "ポップアップがブロックされました。",
    "permission-denied":
      "データベースへのアクセスが拒否されました。Firestore Rulesを確認してください。"
  };

  return messages[error.code] ||
    "エラーが発生しました。もう一度お試しください。";
}

function showMessage(message, type = "error") {
  const element = document.getElementById("message");

  if (!element) return;

  element.textContent = message;
  element.className = "message " + type;
  element.style.display = "block";
}

// ========================================
// メールアドレス登録
// ========================================

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

    const button = registerForm.querySelector(
      "button[type=submit]"
    );

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

// ========================================
// メールアドレスログイン
// ========================================

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const button = loginForm.querySelector(
      "button[type=submit]"
    );

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

// ========================================
// Googleログイン
// ========================================

const googleButton = document.getElementById("googleLogin");

if (googleButton) {
  googleButton.addEventListener("click", async () => {
    googleButton.disabled = true;

    try {
      const result = await signInWithPopup(
        auth,
        googleProvider
      );

      await ensureUserProfile(result.user);

      location.href = "home.html";

    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error));

      googleButton.disabled = false;
    }
  });
}

// ========================================
// ログアウト
// ========================================

const logoutButton = document.getElementById("logout");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await signOut(auth);
      location.href = "index.html";
    } catch (error) {
      console.error(error);
      showMessage(getErrorMessage(error));
    }
  });
}

// ========================================
// ログイン状態の確認
// ========================================

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

      const nameElement =
        document.getElementById("playerName");

      if (nameElement) {
        nameElement.textContent =
          user.displayName || user.email || "PLAYER";
      }

      const emailElement =
        document.getElementById("playerEmail");

      if (emailElement) {
        emailElement.textContent = user.email || "";
      }

      const roleElement =
        document.getElementById("playerRole");

      if (roleElement) {
        roleElement.textContent =
          isSuperAdmin(user) ? "SUPER ADMIN" : "PLAYER";
      }

    } catch (error) {
      console.error("ユーザー情報取得エラー:", error);
      showMessage(getErrorMessage(error));
    }
  }

  if (isAuthPage && user) {
    location.href = "home.html";
  }
});
