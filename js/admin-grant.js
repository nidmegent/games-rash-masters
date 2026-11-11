
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs,
  doc,
  getDoc,
  runTransaction,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ==============================
// SUPER ADMIN
// ==============================

const ADMIN_EMAILS = [
  "lgs.esportsgames@gmail.com",
  "galleria0302@gmail.com"
];

let currentUser = null;
let players = [];
let cards = [];
let selectedPlayer = null;
let selectedCard = null;

const $ = (id) => document.getElementById(id);

// ==============================
// 初期化・認証
// ==============================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "../login.html";
    return;
  }

  if (!ADMIN_EMAILS.includes((user.email || "").toLowerCase())) {
    alert("このページはSUPER ADMIN専用です。");
    location.href = "../home.html";
    return;
  }

  currentUser = user;

  try {
    await loadPlayers();
    await loadCards();
    await loadHistory();
    updateGrantButton();
  } catch (error) {
    console.error(error);
    showMessage("データの読み込みに失敗しました。Firestore Rulesを確認してください。", "error");
  }
});

// ==============================
// プレイヤー取得
// ==============================

async function loadPlayers() {
  const snapshot = await getDocs(collection(db, "users"));

  players = snapshot.docs.map((item) => ({
    uid: item.id,
    ...item.data()
  }));

  players.sort((a, b) =>
    String(a.displayName || "").localeCompare(
      String(b.displayName || ""),
      "ja"
    )
  );

  renderPlayers();
}

function renderPlayers() {
  const keyword = $("playerSearch").value.trim().toLowerCase();

  const filtered = players.filter((player) => {
    const name = String(player.displayName || "").toLowerCase();
    const email = String(player.email || "").toLowerCase();

    return name.includes(keyword) || email.includes(keyword);
  });

  const list = $("playerList");
  list.innerHTML = "";

  if (!filtered.length) {
    list.innerHTML = '<p class="empty">プレイヤーが見つかりません。</p>';
    return;
  }

  filtered.forEach((player) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-item";

    const icon = document.createElement("span");
    icon.className = "player-icon";
    icon.textContent = String(player.displayName || "P").charAt(0);

    const info = document.createElement("span");

    const name = document.createElement("strong");
    name.textContent = player.displayName || "PLAYER";

    const email = document.createElement("small");
    email.textContent = player.email || player.uid;

    info.append(name, email);
    button.append(icon, info);

    button.addEventListener("click", () => selectPlayer(player));

    list.appendChild(button);
  });
}

function selectPlayer(player) {
  selectedPlayer = player;

  $("selectedPlayerName").textContent =
    player.displayName || "PLAYER";

  $("selectedPlayerEmail").textContent =
    player.email || player.uid;

  $("selectedPlayer").classList.remove("hidden");
  $("playerList").classList.add("hidden");
  $("playerSearch").classList.add("hidden");

  updateGrantButton();
}

// ==============================
// カード取得
// ==============================

async function loadCards() {
  const snapshot = await getDocs(collection(db, "cards"));

  cards = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));

  cards.sort((a, b) => {
    const rarityOrder = ["UR", "SSR", "SR", "R", "N"];
    const aIndex = rarityOrder.indexOf(a.rarity);
    const bIndex = rarityOrder.indexOf(b.rarity);

    if (aIndex !== bIndex) return aIndex - bIndex;

    return String(a.name || "").localeCompare(
      String(b.name || ""),
      "ja"
    );
  });

  renderCards();
}

function getImageUrl(path) {
  if (!path) return "";

  const cleanPath = String(path).replace(/^\/+/, "");

  return new URL(`../${cleanPath}`, import.meta.url).href;
}

function renderCards() {
  const keyword = $("cardSearch").value.trim().toLowerCase();

  const filtered = cards.filter((card) =>
    String(card.name || "").toLowerCase().includes(keyword)
  );

  const list = $("cardList");
  list.innerHTML = "";

  if (!filtered.length) {
    list.innerHTML = '<p class="empty">カードが見つかりません。</p>';
    return;
  }

  filtered.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card-item";

    const image = document.createElement("img");
    image.src = getImageUrl(card.imagePath);
    image.alt = card.name || "CARD";
    image.onerror = () => {
      image.style.visibility = "hidden";
    };

    const info = document.createElement("span");
    info.className = "card-info";

    const name = document.createElement("strong");
    name.textContent = card.name || "UNNAMED CARD";

    const rarity = document.createElement("small");
    rarity.className = `rarity rarity-${card.rarity || "N"}`;
    rarity.textContent = card.rarity || "N";

    info.append(name, rarity);
    button.append(image, info);

    button.addEventListener("click", () => selectCard(card));

    list.appendChild(button);
  });
}

function selectCard(card) {
  selectedCard = card;

  $("selectedCardName").textContent =
    card.name || "UNNAMED CARD";

  $("selectedCardRarity").textContent =
    card.rarity || "N";

  $("selectedCardImage").src =
    getImageUrl(card.imagePath);

  $("selectedCard").classList.remove("hidden");
  $("cardList").classList.add("hidden");
  $("cardSearch").classList.add("hidden");

  updateGrantButton();
}

// ==============================
// 選択解除
// ==============================

$("clearPlayer").addEventListener("click", () => {
  selectedPlayer = null;

  $("selectedPlayer").classList.add("hidden");
  $("playerList").classList.remove("hidden");
  $("playerSearch").classList.remove("hidden");

  updateGrantButton();
});

$("clearCard").addEventListener("click", () => {
  selectedCard = null;

  $("selectedCard").classList.add("hidden");
  $("cardList").classList.remove("hidden");
  $("cardSearch").classList.remove("hidden");

  updateGrantButton();
});

// ==============================
// 検索
// ==============================

$("playerSearch").addEventListener("input", renderPlayers);
$("cardSearch").addEventListener("input", renderCards);

// ==============================
// 付与ボタン制御
// ==============================

function updateGrantButton() {
  $("grantButton").disabled =
    !selectedPlayer || !selectedCard;
}

// ==============================
// カード付与
// ==============================

$("grantButton").addEventListener("click", grantCard);

async function grantCard() {
  if (!selectedPlayer || !selectedCard) return;

  const quantity = Number($("quantity").value);
  const memo = $("grantMemo").value.trim();

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    showMessage("付与枚数は1〜999の整数で入力してください。", "error");
    return;
  }

  const confirmed = confirm(
    `${selectedPlayer.displayName || "PLAYER"} に\n` +
    `${selectedCard.name} を ${quantity}枚付与します。\n\n` +
    "この操作を実行しますか？"
  );

  if (!confirmed) return;

  const button = $("grantButton");
  button.disabled = true;
  button.textContent = "GRANTING...";

  try {
    const ownedCardRef = doc(
      db,
      "users",
      selectedPlayer.uid,
      "ownedCards",
      selectedCard.id
    );

    const logRef = doc(collection(db, "grantLogs"));

    await runTransaction(db, async (transaction) => {
      const ownedSnapshot = await transaction.get(ownedCardRef);

      const oldQuantity = ownedSnapshot.exists()
        ? Number(ownedSnapshot.data().quantity || 0)
        : 0;

      if (
        !Number.isSafeInteger(oldQuantity) ||
        oldQuantity < 0 ||
        oldQuantity + quantity > 999999
      ) {
        throw new Error("所持枚数が不正、または上限を超えています。");
      }

      transaction.set(ownedCardRef, {
        cardId: selectedCard.id,
        cardName: selectedCard.name || "",
        rarity: selectedCard.rarity || "N",
        quantity: oldQuantity + quantity,
        updatedAt: serverTimestamp()
      }, { merge: true });

      transaction.set(logRef, {
        userId: selectedPlayer.uid,
        playerName: selectedPlayer.displayName || "PLAYER",
        playerEmail: selectedPlayer.email || "",
        cardId: selectedCard.id,
        cardName: selectedCard.name || "",
        rarity: selectedCard.rarity || "N",
        quantity,
        previousQuantity: oldQuantity,
        newQuantity: oldQuantity + quantity,
        memo,
        grantedBy: currentUser.uid,
        grantedByEmail: currentUser.email || "",
        grantedAt: serverTimestamp()
      });
    });

    showMessage(
      `${selectedPlayer.displayName || "PLAYER"} に「${selectedCard.name}」を${quantity}枚付与しました！`,
      "success"
    );

    $("quantity").value = "1";
    $("grantMemo").value = "";

    await loadHistory();

  } catch (error) {
    console.error("CARD GRANT ERROR:", error);
    showMessage(
      error.message || "カード付与に失敗しました。",
      "error"
    );
  } finally {
    button.textContent = "✦ GRANT CARD";
    updateGrantButton();
  }
}

// ==============================
// 付与履歴
// ==============================

async function loadHistory() {
  const historyRef = query(
    collection(db, "grantLogs"),
    orderBy("grantedAt", "desc"),
    limit(30)
  );

  const snapshot = await getDocs(historyRef);

  const list = $("historyList");
  list.innerHTML = "";

  if (snapshot.empty) {
    list.innerHTML = '<p class="empty">まだ付与履歴はありません。</p>';
    return;
  }

  snapshot.forEach((item) => {
    const data = item.data();

    const row = document.createElement("div");
    row.className = "history-item";

    const player = document.createElement("div");
    const playerName = document.createElement("strong");
    playerName.textContent = data.playerName || "PLAYER";

    const playerEmail = document.createElement("small");
    playerEmail.textContent = data.playerEmail || "";

    player.append(playerName, playerEmail);

    const card = document.createElement("div");
    const cardName = document.createElement("strong");
    cardName.textContent = data.cardName || "CARD";

    const cardRarity = document.createElement("small");
    cardRarity.textContent =
      `${data.rarity || "N"} / ${formatDate(data.grantedAt)}`;

    card.append(cardName, cardRarity);

    const quantity = document.createElement("div");
    quantity.className = "history-quantity";
    quantity.textContent = `+${data.quantity || 0}`;

    row.append(player, card, quantity);

    if (data.memo) {
      const memo = document.createElement("small");
      memo.textContent = `MEMO: ${data.memo}`;
      memo.style.gridColumn = "1 / -1";
      row.appendChild(memo);
    }

    list.appendChild(row);
  });
}

function formatDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "日時不明";
  }

  return timestamp.toDate().toLocaleString("ja-JP");
}

// ==============================
// メッセージ
// ==============================

function showMessage(message, type = "error") {
  const element = $("message");

  element.textContent = message;
  element.className = `message ${type}`;
  element.classList.remove("hidden");
}

// ==============================
// ログアウト
// ==============================

$("logout").addEventListener("click", async () => {
  await signOut(auth);
  location.href = "../index.html";
});
