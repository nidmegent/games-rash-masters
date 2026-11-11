
import {
  auth,
  googleProvider
} from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

// Error messages
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

function showMessage(message, type = "error") {
  const element = document.getElementById("message");

  if (!element) return;

  element.textContent = message;
  element.className = "message " + type;
  element.style.display = "block";
}

// Email Registration
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

      location.href = "home.html";

    } catch (error) {
      showMessage(getErrorMessage(error));
      button.disabled = false;
      button.textContent = "CREATE ACCOUNT";
    }
  });
}

// Email Login
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
      await signInWithEmailAndPassword(auth, email, password);

      location.href = "home.html";

    } catch (error) {
      showMessage(getErrorMessage(error));
      button.disabled = false;
      button.textContent = "LOGIN";
    }
  });
}

// Google Login
const googleButton = document.getElementById("googleLogin");

if (googleButton) {
  googleButton.addEventListener("click", async () => {
    googleButton.disabled = true;

    try {
      await signInWithPopup(auth, googleProvider);
      location.href = "home.html";

    } catch (error) {
      showMessage(getErrorMessage(error));
      googleButton.disabled = false;
    }
  });
}

// Logout
const logoutButton = document.getElementById("logout");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "index.html";
  });
}

// Auth state
const currentPage = location.pathname;

onAuthStateChanged(auth, (user) => {

  if (
    currentPage.endsWith("/home.html") ||
    currentPage === "/home.html"
  ) {
    if (!user) {
      location.href = "login.html";
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

  if (
    currentPage.endsWith("/login.html") ||
    currentPage.endsWith("/register.html")
  ) {
    if (user) {
      location.href = "home.html";
    }
  }
});
