import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let decks = [];
let cardMap = new Map();
let selectedMode = "casual";
let selectedDeck = null;

const modeDescriptions = {
  casual: "ランクを気にせず対戦を楽しめるモードです。",
  ranked: "勝敗によってランクポイントが変動するモードです。",
  friend: "6桁のルームコードを使ってフレンドと対戦するモードです。"
};

// 画像URL
function safeImage(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(N|R|SR|SSR|UR)\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(path)
  ) {
    return "";
  }

  return new URL(path, document.baseURI).href;
}

// メッセージ表示
function showMessage(message, error = false) {
  $("message").textContent = message;
  $("message").style.color = error ? "#ff9baa" : "#f5cb70";
}

// デッキ展開
function expandDeck(deck) {
  const result = [];

  (Array.isArray(deck.cards) ? deck.cards : []).forEach((entry) => {
    const card = cardMap.get(entry.cardId);
    const quantity = Number(entry.quantity || 0);

    if (
      !card ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 3
    ) {
      return;
    }

    for (let i = 0; i < quantity; i++) {
      result.push(card);
    }
  });

  return result;
}

// デッキ検証
function validateDeck(deck) {
  if (!deck) {
    return "デッキを選択してください。";
  }

  const entries = Array.isArray(deck.cards) ? deck.cards : [];

  if (!entries.length) {
    return "デッキにカードが登録されていません。";
  }

  if (entries.some((entry) => !cardMap.has(entry.cardId))) {
    return "存在しないカードが含まれています。デッキを編集してください。";
  }

  if (
    entries.some((entry) =>
      !Number.isInteger(Number(entry.quantity)) ||
      Number(entry.quantity) < 1 ||
      Number(entry.quantity) > 3
    )
  ) {
    return "同じカードは最大3枚までです。";
  }

  const expanded = expandDeck(deck);

  if (expanded.length !== 30 || Number(deck.totalCards) !== 30) {
    return `デッキは30枚必要です（現在${expanded.length}枚）。`;
  }

  return "";
}

// デッキ表示
function renderDeck() {
  const deck =
    decks.find((item) => item.id === $("deckSelect").value) || null;

  selectedDeck = deck;

  $("deckCards").innerHTML = "";
  $("deckName").textContent = deck?.deckName || "デッキ未選択";

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

  const counts = new Map();

  expanded.forEach((card) => {
    counts.set(card.id, (counts.get(card.id) || 0) + 1);
  });

  [...counts.entries()].forEach(([id, quantity]) => {
    const card = cardMap.get(id);

    const article = document.createElement("article");
    article.className = "mini-card";

    const image = document.createElement("img");
    const src = safeImage(card.imagePath);

    if (src) {
      image.src = src;
    }

    image.alt = card.name || "CARD";
    image.onerror = () => image.remove();

    const info = document.createElement("div");
    info.className = "mini-card-info";

    const name = document.createElement("strong");
    name.textContent = card.name || "UNNAMED CARD";

    const small = document.createElement("small");

    small.innerHTML =
      `${card.rarity || "N"} ・ ${card.cardType || "CARD"} ` +
      `<span class="qty">×${quantity}</span>`;

    info.append(name, small);
    article.append(image, info);

    $("deckCards").append(article);
  });

  const error = validateDeck(deck);

  $("deckStatus").textContent =
    error || "このデッキは対戦条件を満たしています。";

  $("deckStatus").className =
    error ? "notice bad" : "notice good";

  $("readyButton").disabled = Boolean(error);
}

// Firebaseからデータ読み込み
async function loadData() {
  $("deckStatus").textContent =
    "カード・デッキを読み込んでいます...";

  const [cardSnapshot, deckSnapshot] = await Promise.all([
    getDocs(collection(db, "cards")),

    getDocs(
      collection(db, "users", currentUser.uid, "decks")
    )
  ]);

  cardMap = new Map(
    cardSnapshot.docs.map((item) => [
      item.id,
      {
        id: item.id,
        ...item.data()
      }
    ])
  );

  decks = deckSnapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
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
    option.textContent = deck.deckName || "名称未設定";

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

// モード選択
document.querySelectorAll(".mode-card").forEach((button) => {
  button.addEventListener("click", () => {
    selectedMode = button.dataset.mode;

    document.querySelectorAll(".mode-card").forEach((item) => {
      item.classList.toggle("selected", item === button);
    });

    $("modeDescription").textContent =
      modeDescriptions[selectedMode];
  });
});

// デッキ変更
$("deckSelect").addEventListener("change", renderDeck);

// 準備完了
$("readyButton").addEventListener("click", () => {
  const error = validateDeck(selectedDeck);

  if (error) {
    showMessage(error, true);
    return;
  }

  const preparation = {
    mode: selectedMode,
    deckId: selectedDeck.id,
    deckName: selectedDeck.deckName,
    preparedAt: new Date().toISOString()
  };

  sessionStorage.setItem(
    "rashMastersBattlePreparation",
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
});

// ログイン確認
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  currentUser = user;

  try {
    await loadData();

  } catch (error) {
    console.error(error);

    $("deckStatus").textContent =
      "読み込みに失敗しました。Firestore Rulesとネットワークを確認してください。";

    $("deckStatus").className = "notice bad";

    showMessage(
      "デッキ情報を取得できませんでした。",
      true
    );
  }
});
