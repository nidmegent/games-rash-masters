
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ==============================
// GAME RULES
// ==============================

const DECK_SIZE = 10;
const MAX_SAME_CARD = 3;

const $ = (id) => document.getElementById(id);

// ==============================
// STATE
// ==============================

let currentUser = null;
let decks = [];
let cardMap = new Map();

let selectedMode = "casual";
let selectedDeck = null;

const STORAGE_KEY = "rashMastersBattlePreparation";

const modeDescriptions = {
  casual: "ランクを気にせず対戦を楽しめるモードです。",
  ranked: "勝敗によってランクポイントが変動するモードです。",
  friend: "6桁のルームコードを使ってフレンドと対戦するモードです。"
};

// ==============================
// IMAGE URL
// ==============================

function safeImage(path) {
  if (typeof path !== "string") {
    return "";
  }

  const cleanPath = path.replace(/^\/+/, "");

  if (
    !/^assets\/cards\/(N|R|SR|SSR|UR)\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(
      cleanPath
    )
  ) {
    return "";
  }

  return new URL(cleanPath, document.baseURI).href;
}

// ==============================
// MESSAGE
// ==============================

function showMessage(message, error = false) {
  $("message").textContent = message;

  $("message").style.color =
    error ? "#ff9baa" : "#f5cb70";
}

// ==============================
// RESET PREPARATION
// ==============================

function resetPreparation() {
  sessionStorage.removeItem(STORAGE_KEY);

  $("readyButton").textContent = "準備完了";
}

// ==============================
// COUNT DECK
// ==============================

function getDeckCounts(deck) {
  const counts = new Map();

  if (!deck || !Array.isArray(deck.cards)) {
    return counts;
  }

  for (const entry of deck.cards) {
    if (
      !entry ||
      typeof entry.cardId !== "string" ||
      !Number.isSafeInteger(entry.quantity) ||
      entry.quantity < 1
    ) {
      continue;
    }

    counts.set(
      entry.cardId,
      (counts.get(entry.cardId) || 0) +
        entry.quantity
    );
  }

  return counts;
}

// ==============================
// EXPAND DECK
// ==============================

function expandDeck(deck) {
  const result = [];
  const counts = getDeckCounts(deck);

  for (const [cardId, quantity] of counts) {
    const card = cardMap.get(cardId);

    if (!card) continue;

    for (let i = 0; i < quantity; i++) {
      result.push(card);
    }
  }

  return result;
}

// ==============================
// VALIDATE DECK
// ==============================

function validateDeck(deck) {
  if (!deck) {
    return "デッキを選択してください。";
  }

  if (!Array.isArray(deck.cards) ||
      deck.cards.length === 0) {
    return "デッキにカードが登録されていません。";
  }

  const counts = new Map();

  for (const entry of deck.cards) {
    if (
      !entry ||
      typeof entry.cardId !== "string" ||
      !entry.cardId.trim() ||
      !Number.isSafeInteger(entry.quantity) ||
      entry.quantity < 1
    ) {
      return "デッキのカード情報が不正です。";
    }

    if (!cardMap.has(entry.cardId)) {
      return "存在しないカードが含まれています。デッキを編集してください。";
    }

    const next =
      (counts.get(entry.cardId) || 0) +
      entry.quantity;

    if (next > MAX_SAME_CARD) {
      return `同じカードは最大${MAX_SAME_CARD}枚までです。`;
    }

    counts.set(entry.cardId, next);
  }

  const total = [...counts.values()].reduce(
    (sum, quantity) => sum + quantity,
    0
  );

  if (
    total !== DECK_SIZE ||
    deck.totalCards !== DECK_SIZE
  ) {
    return (
      `デッキは${DECK_SIZE}枚必要です。` +
      `現在${total}枚です。`
    );
  }

  return "";
}

// ==============================
// RENDER DECK
// ==============================

function renderDeck() {
  const deck =
    decks.find(
      (item) => item.id === $("deckSelect").value
    ) || null;

  selectedDeck = deck;

  $("deckCards").innerHTML = "";

  $("deckName").textContent =
    deck?.deckName || "デッキ未選択";

  const expanded = deck ? expandDeck(deck) : [];

  $("deckCount").textContent = expanded.length;

  if (!deck) {
    $("deckCards").innerHTML =
      '<p class="empty">デッキを選択してください。</p>';

    $("deckStatus").textContent =
      "保存済みデッキを選択してください。";

    $("deckStatus").className = "notice";

    $("readyButton").disabled = true;

    return;
  }

  const counts = getDeckCounts(deck);

  for (const [id, quantity] of counts) {
    const card = cardMap.get(id);

    if (!card) continue;

    const article = document.createElement("article");
    article.className = "mini-card";

    const image = document.createElement("img");
    const src = safeImage(card.imagePath);

    if (src) {
      image.src = src;
    }

    image.alt = card.name || "CARD";

    image.onerror = () => {
      image.remove();
    };

    const info = document.createElement("div");
    info.className = "mini-card-info";

    const name = document.createElement("strong");
    name.textContent =
      card.name || "UNNAMED CARD";

    const small = document.createElement("small");

    const rarity = document.createElement("span");
    rarity.textContent =
      `${card.rarity || "N"} ・ ${card.cardType || "CARD"} `;

    const quantityLabel = document.createElement("span");
    quantityLabel.className = "qty";
    quantityLabel.textContent = `×${quantity}`;

    small.append(rarity, quantityLabel);
    info.append(name, small);
    article.append(image, info);

    $("deckCards").append(article);
  }

  const error = validateDeck(deck);

  $("deckStatus").textContent =
    error ||
    "この10枚デッキは対戦条件を満たしています。";

  $("deckStatus").className =
    error ? "notice bad" : "notice good";

  $("readyButton").disabled = Boolean(error);
}

// ==============================
// LOAD FIREBASE DATA
// ==============================

async function loadData() {
  $("deckStatus").textContent =
    "カード・デッキを読み込んでいます...";

  $("readyButton").disabled = true;

  const [cardSnapshot, deckSnapshot] =
    await Promise.all([
      getDocs(collection(db, "cards")),

      getDocs(
        collection(
          db,
          "users",
          currentUser.uid,
          "decks"
        )
      )
    ]);

  cardMap = new Map(
    cardSnapshot.docs.map((item) => [
      item.id,
      {
        ...item.data(),
        id: item.id
      }
    ])
  );

  decks = deckSnapshot.docs.map((item) => ({
    ...item.data(),
    id: item.id
  }));

  decks.sort((a, b) =>
    String(a.deckName || "").localeCompare(
      String(b.deckName || ""),
      "ja"
    )
  );

  const select = $("deckSelect");

  select.innerHTML =
    '<option value="">保存済みデッキを選択</option>';

  decks.forEach((deck) => {
    const option = document.createElement("option");

    option.value = deck.id;

    const counts = getDeckCounts(deck);

    const total = [...counts.values()].reduce(
      (sum, quantity) => sum + quantity,
      0
    );

    option.textContent =
      `${deck.deckName || "名称未設定"} (${total}/${DECK_SIZE})`;

    select.append(option);
  });

  if (!decks.length) {
    $("deckStatus").textContent =
      "保存済みデッキがありません。先にデッキを作成してください。";

    $("deckStatus").className = "notice bad";

  } else {
    const valid = decks.find(
      (deck) => !validateDeck(deck)
    );

    if (valid) {
      select.value = valid.id;
    }
  }

  renderDeck();
}

// ==============================
// MODE SELECTION
// ==============================

document.querySelectorAll(".mode-card").forEach(
  (button) => {
    button.addEventListener("click", () => {
      if (!modeDescriptions[button.dataset.mode]) {
        return;
      }

      selectedMode = button.dataset.mode;

      document.querySelectorAll(".mode-card").forEach(
        (item) => {
          item.classList.toggle(
            "selected",
            item === button
          );
        }
      );

      $("modeDescription").textContent =
        modeDescriptions[selectedMode];

      resetPreparation();
    });
  }
);

// ==============================
// DECK SELECTION
// ==============================

$("deckSelect").addEventListener("change", () => {
  resetPreparation();
  renderDeck();
});

// ==============================
// READY BUTTON
// ==============================

$("readyButton").addEventListener(
  "click",
  async () => {
    const error = validateDeck(selectedDeck);

    if (error) {
      showMessage(error, true);
      return;
    }

    const preparation = {
      mode: selectedMode,
      deckId: selectedDeck.id,
      deckName: selectedDeck.deckName,
      deckSize: DECK_SIZE,
      preparedAt: new Date().toISOString()
    };

    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(preparation)
    );

    const modeLabel = {
      casual: "カジュアル",
      ranked: "ランク",
      friend: "フレンド"
    }[selectedMode];

    showMessage(
      `${modeLabel}対戦用デッキ「${selectedDeck.deckName}」を確定しました！次工程で対戦ルームに接続します。`
    );

    $("readyButton").textContent = "準備完了 ✓";
  }
);

// ==============================
// AUTH
// ==============================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  currentUser = user;

  resetPreparation();

  try {
    await loadData();
  } catch (error) {
    console.error(error);

    $("deckStatus").textContent =
      "読み込みに失敗しました。Firestore Rulesとネットワークを確認してください。";

    $("deckStatus").className = "notice bad";

    $("readyButton").disabled = true;

    showMessage(
      "デッキ情報を取得できませんでした。",
      true
    );
  }
});
