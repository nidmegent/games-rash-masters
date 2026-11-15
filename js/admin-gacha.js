
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ========================================
// ADMIN CONFIG
// ========================================

const SUPER_ADMINS = [
  "lgs.esportsgames@gmail.com",
  "galleria0302@gmail.com"
];

const RARITIES = ["N", "R", "SR", "SSR", "UR"];

const DEFAULT_RATES = {
  N: 50,
  R: 30,
  SR: 13,
  SSR: 6,
  UR: 1
};

const $ = id => document.getElementById(id);

let currentUser = null;
let cards = [];
let gachas = [];
let selectedCards = new Set();
let editingId = null;
let saving = false;

function isSuperAdmin(user) {
  return Boolean(
    user &&
    user.emailVerified === true &&
    SUPER_ADMINS.includes(
      (user.email || "").toLowerCase()
    )
  );
}

function showMessage(text, type = "success") {
  const element = $("message");
  element.textContent = text;
  element.className = `message ${type}`;
}

function showAccessDenied() {
  $("authLoading").textContent =
    "ACCESS DENIED：このページは運営専用です。";
}

function validCost(value) {
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100000000;
}

// ========================================
// RARITY SETTINGS
// ========================================

function createRateInputs() {
  const container = $("rateInputs");
  container.replaceChildren();

  RARITIES.forEach(rarity => {
    const row = document.createElement("div");
    row.className = "rate-item";

    const title = document.createElement("strong");
    title.textContent = rarity;

    const track = document.createElement("div");
    track.className = "rate-bar";

    const fill = document.createElement("div");
    fill.className = "rate-fill";
    track.append(fill);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "0.01";
    input.value = DEFAULT_RATES[rarity];
    input.dataset.rarity = rarity;

    input.addEventListener("input", updateRateTotal);

    row.append(title, track, input);
    container.append(row);
  });

  updateRateTotal();
}

function getRates() {
  const rates = {};

  document.querySelectorAll("[data-rarity]").forEach(input => {
    rates[input.dataset.rarity] = Number(input.value);
  });

  return rates;
}

function setRates(rates) {
  document.querySelectorAll("[data-rarity]").forEach(input => {
    const rarity = input.dataset.rarity;
    input.value = rates?.[rarity] ?? 0;
  });

  updateRateTotal();
}

function updateRateTotal() {
  const rates = getRates();

  const total = Object.values(rates)
    .reduce((sum, value) => sum + value, 0);

  $("rateTotal").textContent =
    `TOTAL：${total.toFixed(2)}% / 100%`;

  $("rateTotal").style.color =
    Math.abs(total - 100) < 0.000001
      ? "#4de8ff"
      : "#ff6483";

  document.querySelectorAll(".rate-item").forEach(row => {
    const input = row.querySelector("input");
    const fill = row.querySelector(".rate-fill");

    const value = Number(input.value) || 0;
    fill.style.width =
      `${Math.max(0, Math.min(100, value))}%`;
  });
}

// ========================================
// CARD POOL
// ========================================

function getCardImageUrl(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(?:N|R|SR|SSR|UR)\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(path)
  ) {
    return "";
  }

  return new URL(`../${path}`, import.meta.url).href;
}

function updateSelectedCount() {
  $("selectedCount").textContent =
    `選択中：${selectedCards.size}枚`;
}

function renderCardPool() {
  const container = $("cardPool");
  const keyword = $("cardSearch").value.trim().toLowerCase();

  container.replaceChildren();

  const filtered = cards.filter(card =>
    String(card.name || "").toLowerCase().includes(keyword)
  );

  if (!filtered.length) {
    container.textContent = "該当するカードがありません。";
    updateSelectedCount();
    return;
  }

  filtered.forEach(card => {
    const label = document.createElement("label");
    label.className = "pool-card";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedCards.has(card.id);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedCards.add(card.id);
      } else {
        selectedCards.delete(card.id);
      }

      updateSelectedCount();
    });

    const imageUrl = getCardImageUrl(card.imagePath);

    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      label.append(checkbox, image);
    } else {
      label.append(checkbox);
    }

    const name = document.createElement("span");
    name.textContent =
      `${card.name || card.id} [${card.rarity || "N"}]`;

    label.append(name);
    container.append(label);
  });

  updateSelectedCount();
}

async function loadCards() {
  const snapshot = await getDocs(collection(db, "cards"));

  cards = snapshot.docs.map(item => ({
    ...item.data(),
    id: item.id
  }));

  cards.sort((a, b) =>
    String(a.name || "").localeCompare(
      String(b.name || ""), "ja"
    )
  );

  renderCardPool();
}

// ========================================
// GACHA LIST
// ========================================

async function loadGachas() {
  const container = $("gachaList");
  container.textContent = "読み込み中...";

  const snapshot = await getDocs(
    collection(db, "gachaBanners")
  );

  gachas = snapshot.docs.map(item => ({
    ...item.data(),
    id: item.id
  }));

  gachas.sort((a, b) =>
    String(a.name || "").localeCompare(
      String(b.name || ""), "ja"
    )
  );

  $("gachaCount").textContent = gachas.length;
  renderGachas();
}

function renderGachas() {
  const container = $("gachaList");
  container.replaceChildren();

  if (!gachas.length) {
    container.textContent = "まだガチャが登録されていません。";
    return;
  }

  gachas.forEach(gacha => {
    const row = document.createElement("div");
    row.className = "gacha-row";

    const info = document.createElement("div");

    const name = document.createElement("strong");
    name.textContent = gacha.name || "名称未設定";

    const status = document.createElement("small");
    status.textContent =
      `${gacha.enabled ? "● 公開中" : "○ 停止中"} / ` +
      `${gacha.singleCost ?? 0} コイン`;

    info.append(name, status);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "編集";

    button.addEventListener("click", () => {
      editGacha(gacha.id);
    });

    row.append(info, button);
    container.append(row);
  });
}

// ========================================
// EDIT / RESET
// ========================================

function editGacha(id) {
  const gacha = gachas.find(item => item.id === id);
  if (!gacha) return;

  editingId = id;

  $("gachaName").value = gacha.name || "";
  $("gachaDescription").value = gacha.description || "";
  $("singleCost").value = gacha.singleCost ?? 100;
  $("tenCost").value = gacha.tenCost ?? 1000;
  $("enabled").checked = gacha.enabled === true;

  setRates(gacha.rates || DEFAULT_RATES);

  const validIds = new Set(cards.map(card => card.id));
  selectedCards = new Set(
    (gacha.cardPool || []).filter(id => validIds.has(id))
  );

  $("cardSearch").value = "";
  renderCardPool();

  $("formTitle").textContent = "ガチャ情報を編集";
  $("saveButton").textContent = "変更を保存";
  $("cancelButton").hidden = false;
  $("deleteButton").disabled = false;

  document.querySelector(".editor-panel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function resetForm() {
  editingId = null;
  selectedCards.clear();

  $("gachaForm").reset();
  $("gachaName").value = "";
  $("gachaDescription").value = "";
  $("singleCost").value = 100;
  $("tenCost").value = 1000;
  $("enabled").checked = false;
  $("cardSearch").value = "";

  setRates(DEFAULT_RATES);
  renderCardPool();

  $("formTitle").textContent = "新しいガチャを登録";
  $("saveButton").textContent = "＋ ガチャを登録";
  $("cancelButton").hidden = true;
  $("deleteButton").disabled = true;
}

// ========================================
// SAVE
// ========================================

async function saveGacha(event) {
  event.preventDefault();

  if (saving || !isSuperAdmin(currentUser)) {
    showMessage("保存権限がありません。", "error");
    return;
  }

  const name = $("gachaName").value.trim();
  const rates = getRates();
  const rateValues = Object.values(rates);

  const total = rateValues.reduce(
    (sum, value) => sum + value, 0
  );

  const singleCost = Number($("singleCost").value);
  const tenCost = Number($("tenCost").value);

  if (!name || name.length > 60) {
    showMessage("ガチャ名を入力してください。", "error");
    return;
  }

  if (!validCost(singleCost) || !validCost(tenCost)) {
    showMessage("コイン数は0〜100000000の整数で指定してください。", "error");
    return;
  }

  if (
    rateValues.some(value =>
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) ||
    Math.abs(total - 100) > 0.000001
  ) {
    showMessage("排出率の合計を100%にしてください。", "error");
    return;
  }

  if (selectedCards.size === 0) {
    showMessage("排出対象カードを選択してください。", "error");
    return;
  }

  const selected = cards.filter(card =>
    selectedCards.has(card.id)
  );

  const availableRarities = new Set(
    selected.map(card => card.rarity)
  );

  const missing = RARITIES.filter(
    rarity =>
      rates[rarity] > 0 &&
      !availableRarities.has(rarity)
  );

  if (missing.length) {
    showMessage(
      `${missing.join("、")} の排出対象カードがありません。`,
      "error"
    );
    return;
  }

  saving = true;
  $("saveButton").disabled = true;

  try {
    const isNew = !editingId;

    const id = editingId ||
      doc(collection(db, "gachaBanners")).id;

    const data = {
      name,
      description: $("gachaDescription").value.trim(),
      singleCost,
      tenCost,
      rates,
      cardPool: [...selectedCards],
      enabled: $("enabled").checked,
      updatedAt: serverTimestamp()
    };

    if (isNew) {
      data.createdAt = serverTimestamp();
    }

    await setDoc(
      doc(db, "gachaBanners", id),
      data,
      { merge: !isNew }
    );

    await loadGachas();
    resetForm();

    showMessage(
      isNew
        ? "ガチャを登録しました！"
        : "ガチャ設定を更新しました！"
    );

  } catch (error) {
    console.error("Gacha save error:", error);
    showMessage(
      "保存に失敗しました：" + error.message,
      "error"
    );
  } finally {
    saving = false;
    $("saveButton").disabled = false;
  }
}

// ========================================
// DELETE
// ========================================

async function removeGacha() {
  if (!editingId || saving || !isSuperAdmin(currentUser)) {
    return;
  }

  const gacha = gachas.find(item => item.id === editingId);
  if (!gacha) return;

  const confirmed = confirm(
    `「${gacha.name}」を削除しますか？\nこの操作は取り消せません。`
  );

  if (!confirmed) return;

  saving = true;
  $("deleteButton").disabled = true;

  try {
    await deleteDoc(
      doc(db, "gachaBanners", editingId)
    );

    await loadGachas();
    resetForm();
    showMessage("ガチャを削除しました。");

  } catch (error) {
    console.error("Gacha delete error:", error);
    showMessage(
      "削除に失敗しました：" + error.message,
      "error"
    );
  } finally {
    saving = false;
    $("deleteButton").disabled = !editingId;
  }
}

// ========================================
// EVENTS
// ========================================

$("gachaForm").addEventListener("submit", saveGacha);
$("deleteButton").addEventListener("click", removeGacha);
$("cancelButton").addEventListener("click", resetForm);
$("refreshButton").addEventListener("click", async () => {
  try {
    await loadGachas();
    showMessage("ガチャ一覧を更新しました。");
  } catch (error) {
    showMessage("更新に失敗しました：" + error.message, "error");
  }
});

$("cardSearch").addEventListener("input", renderCardPool);

$("selectAllCards").addEventListener("click", () => {
  const keyword = $("cardSearch").value.trim().toLowerCase();

  cards.forEach(card => {
    if (String(card.name || "").toLowerCase().includes(keyword)) {
      selectedCards.add(card.id);
    }
  });

  renderCardPool();
});

$("clearCards").addEventListener("click", () => {
  selectedCards.clear();
  renderCardPool();
});

$("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    location.replace("../login.html");
  } catch (error) {
    showMessage("ログアウトに失敗しました。", "error");
  }
});

// ========================================
// AUTH
// ========================================

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  currentUser = user;

  if (!isSuperAdmin(user)) {
    showAccessDenied();
    return;
  }

  $("adminEmail").textContent = user.email || "";

  try {
    createRateInputs();
    await loadCards();
    await loadGachas();

    $("authLoading").hidden = true;
    $("adminContent").hidden = false;

  } catch (error) {
    console.error("Gacha initialization error:", error);
    $("authLoading").textContent =
      "管理画面の読み込みに失敗しました：" + error.message;
  }
});


/* ========================================
   COIN MANAGEMENT
   運営専用コイン付与
======================================== */

const COIN_GRANT_API =
  "https://rash-masters-gacha.lgs-esportsgames.workers.dev/admin/coins/grant";

let coinGrantSending = false;
let pendingCoinGrant = null;

const coinGrantForm = $("coinGrantForm");
const coinGrantButton = $("coinGrantButton");
const coinGrantMessage = $("coinGrantMessage");

function showCoinGrantMessage(message, isError = false) {
  coinGrantMessage.textContent = message;
  coinGrantMessage.style.color =
    isError ? "#ff6483" : "#4de8ff";
}

function clearPendingCoinGrant() {
  pendingCoinGrant = null;
  coinGrantForm.reset();
  $("coinAmount").value = "100";
}

coinGrantForm.addEventListener("input", () => {
  // 入力内容を変更したら、新しい付与操作として扱う
  pendingCoinGrant = null;
  showCoinGrantMessage("");
});

coinGrantForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (coinGrantSending) return;

  if (!currentUser || !isSuperAdmin(currentUser)) {
    showCoinGrantMessage(
      "運営権限がありません。",
      true
    );
    return;
  }

  const targetUid = $("coinTargetUid").value.trim();
  const amount = Number($("coinAmount").value);
  const reason = $("coinReason").value.trim();

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetUid)) {
    showCoinGrantMessage(
      "正しいプレイヤーUIDを入力してください。",
      true
    );
    return;
  }

  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 100000
  ) {
    showCoinGrantMessage(
      "付与数は1〜100000の整数で指定してください。",
      true
    );
    return;
  }

  if (!reason || reason.length > 200) {
    showCoinGrantMessage(
      "付与理由を1〜200文字で入力してください。",
      true
    );
    return;
  }

  const payload = {
    targetUid,
    amount,
    reason
  };

  // 通信エラー後は同じrequestIdを再利用する
  if (
    !pendingCoinGrant ||
    pendingCoinGrant.targetUid !== targetUid ||
    pendingCoinGrant.amount !== amount ||
    pendingCoinGrant.reason !== reason
  ) {
    pendingCoinGrant = {
      ...payload,
      requestId: crypto.randomUUID()
    };
  }

  const requestId = pendingCoinGrant.requestId;

  const confirmed = confirm(
    "以下の内容でコインを付与しますか？\n\n" +
    `付与先UID：${targetUid}\n` +
    `付与数：${amount}コイン\n` +
    `理由：${reason}`
  );

  if (!confirmed) return;

  coinGrantSending = true;
  coinGrantButton.disabled = true;
  coinGrantButton.textContent = "付与処理中...";

  showCoinGrantMessage("サーバーに送信しています...");

  try {
    const token = await currentUser.getIdToken();

    const response = await fetch(COIN_GRANT_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(pendingCoinGrant)
    });

    const result = await response.json();

    if (!response.ok || result.success !== true) {
      if (response.status === 403) {
        throw new Error(
          "このアカウントにはWorker側の付与権限がありません。"
        );
      }

      if (result.error === "user_not_found") {
        throw new Error(
          "指定したプレイヤーが見つかりません。"
        );
      }

      if (result.error === "invalid_grant_request") {
        throw new Error(
          "付与内容が正しくありません。"
        );
      }

      throw new Error(
        `付与結果を確認してください：${result.error || response.status}`
      );
    }

    const replayed = result.replayed === true;

    const message =
      (replayed
        ? "以前の付与結果を確認しました。"
        : "コインを付与しました！") +
      ` 付与数：${result.amount} / ` +
      `付与時の残高：${result.remainingCoins}`;

    clearPendingCoinGrant();
    showCoinGrantMessage(message);

  } catch (error) {
    console.error("Coin grant error:", error);

    showCoinGrantMessage(
      error.message +
      " 通信エラーの場合は、Firestoreの付与履歴を確認してください。",
      true
    );

  } finally {
    coinGrantSending = false;
    coinGrantButton.disabled = false;
    coinGrantButton.textContent = "🪙 コインを付与する";
  }
});
