
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ==============================
// DECK RULES
// ==============================

const DECK_SIZE = 10;
const MAX_SAME_CARD = 3;


function numeric(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cardCost(card) {
  return Math.min(10, Math.floor(
    numeric(card.cost ?? card.manaCost ?? card.mana, 1)
  ));
}

function cardAttack(card) {
  return Math.floor(
    numeric(card.atk ?? card.attack ?? card.ATK, 500)
  );
}

function cardHp(card) {
  return Math.max(1, Math.floor(
    numeric(card.hp ?? card.health ?? card.HP, 1000)
  ));
}


// ==============================
// STATE
// ==============================

const $ = (id) => document.getElementById(id);

let currentUser = null;
let masterCards = [];
let ownedCards = [];
let savedDecks = [];

let deckContents = new Map();
let selectedDeckId = null;
let activeRarity = "ALL";
let isSaving = false;

// ==============================
// AUTH
// ==============================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  currentUser = user;

  try {
    await loadCollection();
    await loadSavedDecks();
    renderAll();
  } catch (error) {
    console.error(error);
    showMessage(
      "データの読み込みに失敗しました。Firestore Rulesを確認してください。",
      "error"
    );
  }
});

// ==============================
// COLLECTION
// ==============================

async function loadCollection() {
  const [masterSnapshot, ownedSnapshot] = await Promise.all([
    getDocs(collection(db, "cards")),
    getDocs(collection(db, "users", currentUser.uid, "ownedCards"))
  ]);

  const ownedMap = new Map();

  ownedSnapshot.forEach((item) => {
    const data = item.data();
    const quantity = Number(data.quantity || 0);

    if (Number.isSafeInteger(quantity) && quantity > 0) {
      ownedMap.set(item.id, quantity);
    }
  });

  masterCards = masterSnapshot.docs.map((item) => ({
    ...item.data(),
    id: item.id
  }));

  ownedCards = masterCards
    .filter((card) => ownedMap.has(card.id))
    .map((card) => ({
      ...card,
      ownedQuantity: ownedMap.get(card.id)
    }));

  ownedCards.sort((a, b) => {
    const order = ["UR", "SSR", "SR", "R", "N"];
    const ai = order.indexOf(a.rarity);
    const bi = order.indexOf(b.rarity);

    if (ai !== bi) return ai - bi;

    return String(a.name || "").localeCompare(
      String(b.name || ""),
      "ja"
    );
  });
}

// ==============================
// SAVED DECKS
// ==============================

async function loadSavedDecks() {
  const snapshot = await getDocs(
    collection(db, "users", currentUser.uid, "decks")
  );

  savedDecks = snapshot.docs.map((item) => ({
    ...item.data(),
    id: item.id
  }));

  savedDecks.sort((a, b) =>
    String(a.deckName || "").localeCompare(
      String(b.deckName || ""),
      "ja"
    )
  );

  renderSavedDeckSelect();
}

function renderSavedDeckSelect() {
  const select = $("savedDeckSelect");
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "保存済みデッキを選択";
  select.appendChild(placeholder);

  savedDecks.forEach((deck) => {
    const option = document.createElement("option");
    option.value = deck.id;

    const total = Array.isArray(deck.cards)
      ? deck.cards.reduce(
          (sum, entry) => sum + Number(entry.quantity || 0),
          0
        )
      : 0;

    option.textContent =
      `${deck.deckName || "UNNAMED DECK"} (${total}/${DECK_SIZE})`;

    select.appendChild(option);
  });

  select.value = selectedDeckId || "";
  $("deleteDeckButton").disabled = !selectedDeckId;
}

// ==============================
// IMAGE URL
// ==============================

function getImageUrl(path) {
  if (!path) return "";

  const value = String(path).trim();

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const cleanPath = value.replace(/^\/+/, "");

  return new URL("../" + cleanPath, import.meta.url).href;
}

// ==============================
// DECK COUNT
// ==============================

function getDeckCount() {
  let total = 0;

  deckContents.forEach((quantity) => {
    total += quantity;
  });

  return total;
}

function getDeckQuantity(cardId) {
  return deckContents.get(cardId) || 0;
}

function getOwnedQuantity(cardId) {
  const card = ownedCards.find((item) => item.id === cardId);
  return card ? card.ownedQuantity : 0;
}

function canAddCard(cardId) {
  return (
    getDeckCount() < DECK_SIZE &&
    getDeckQuantity(cardId) < MAX_SAME_CARD &&
    getDeckQuantity(cardId) < getOwnedQuantity(cardId)
  );
}

// ==============================
// RENDER ALL
// ==============================

function renderAll() {
  renderCollection();
  renderDeckList();
  renderDeckStatus();
  renderDeckRaritySummary();
  renderDeckManaAnalysis();
}

// ==============================
// COLLECTION RENDER
// ==============================

function renderCollection() {
  const keyword = $("cardSearch").value.trim().toLowerCase();

  const filtered = ownedCards.filter((card) => {
  const name = String(card.name || "").toLowerCase();

  const matchesName = name.includes(keyword);
  const matchesRarity =
    activeRarity === "ALL" || card.rarity === activeRarity;

  return matchesName && matchesRarity;
});

const sortType = $("cardSort").value;
const rarityOrder = ["UR", "SSR", "SR", "R", "N"];

const numberValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};


filtered.sort((a, b) => {
  switch (sortType) {
    case "cost-asc":
      return cardCost(a) - cardCost(b);

    case "cost-desc":
      return cardCost(b) - cardCost(a);

    case "attack-desc":
      return cardAttack(b) - cardAttack(a);

    case "hp-desc":
      return cardHp(b) - cardHp(a);

    default:
      return rarityOrder.indexOf(a.rarity) -
             rarityOrder.indexOf(b.rarity);
  }
});
  
  const list = $("collectionList");
  list.innerHTML = "";

  if (!filtered.length) {
    list.innerHTML =
      '<p class="empty">該当する所持カードがありません。</p>';
    return;
  }

  filtered.forEach((card) => {
    const quantity = getDeckQuantity(card.id);

const article = document.createElement("article");

article.dataset.cardId = card.id;
article.className = "collection-card";

const cardRarityClass = String(card.rarity || "N").toUpperCase();
article.classList.add(`card-glow-${cardRarityClass}`);

    const image = document.createElement("img");
    image.src = getImageUrl(card.imagePath);
    image.alt = card.name || "CARD";
    image.onerror = () => {
      image.style.visibility = "hidden";
    };

    // カード画像をタップ・右クリックで詳細表示
image.style.cursor = "pointer";

image.addEventListener("click", () => {
  openCardDetail(card);
});

image.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openCardDetail(card);
});

    const info = document.createElement("div");
    info.className = "collection-info";

    const name = document.createElement("strong");
    name.textContent = card.name || "UNNAMED CARD";

    const rarity = document.createElement("small");
    rarity.className = `rarity rarity-${card.rarity || "N"}`;
    rarity.textContent = card.rarity || "N";

    const owned = document.createElement("small");
    owned.textContent =
      `所持 ${card.ownedQuantity}枚 / 編成 ${quantity}枚`;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.disabled = quantity <= 0;
    minus.addEventListener("click", () =>
      changeCardQuantity(card.id, -1)
    );

    const count = document.createElement("span");
    count.textContent = quantity;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "＋";
    plus.disabled = !canAddCard(card.id);
    plus.addEventListener("click", () =>
      changeCardQuantity(card.id, 1)
    );

    actions.append(minus, count, plus);
    info.append(name, rarity, owned, actions);
    article.append(image, info);

    list.appendChild(article);
  });
}

// ==============================
// ADD / REMOVE CARD
// ==============================

function changeCardQuantity(cardId, change) {
  const current = getDeckQuantity(cardId);
  const next = current + change;

  if (next < 0) return;

  if (next > getOwnedQuantity(cardId)) {
    showMessage("所持枚数を超えて編成できません。", "error");
    return;
  }

  if (next > MAX_SAME_CARD) {
    showMessage(
      `同じカードは最大${MAX_SAME_CARD}枚までです。`,
      "error"
    );
    return;
  }

  if (change > 0 && getDeckCount() >= DECK_SIZE) {
    showMessage(
      `デッキは${DECK_SIZE}枚までです。`,
      "error"
    );
    return;
  }

  if (next === 0) {
    deckContents.delete(cardId);
  } else {
    deckContents.set(cardId, next);
  }

  
renderAll();
animateChangedCard(cardId, change);

}

// ==============================
// DECK LIST
// ==============================

function renderDeckList() {
  const list = $("deckList");
  list.innerHTML = "";

  const entries = [...deckContents.entries()]
    .map(([cardId, quantity]) => ({
      card: ownedCards.find((item) => item.id === cardId),
      cardId,
      quantity
    }))
    .filter((entry) => entry.card);

  if (!entries.length) {
    list.innerHTML =
      '<p class="empty">まだカードが選択されていません。</p>';
  }

  entries.forEach(({ card, cardId, quantity }) => {
    
const row = document.createElement("div");
row.dataset.cardId = cardId;
row.className = "deck-card-row";

const cardRarityClass = String(card.rarity || "N").toUpperCase();
row.classList.add(`card-glow-${cardRarityClass}`);

    const image = document.createElement("img");
    image.src = getImageUrl(card.imagePath);
    image.alt = card.name || "CARD";
    image.onerror = () => {
      image.style.visibility = "hidden";
    };

    // カード画像をタップ・右クリックで詳細表示
image.style.cursor = "pointer";

image.addEventListener("click", () => {
  openCardDetail(card);
});

image.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openCardDetail(card);
});

    const info = document.createElement("div");
    info.className = "deck-card-info";

    const name = document.createElement("strong");
    name.textContent = card.name || "UNNAMED CARD";

    const rarity = document.createElement("small");
    rarity.textContent = card.rarity || "N";

    info.append(name, rarity);

    const quantityBox = document.createElement("div");
    quantityBox.className = "deck-card-quantity";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.addEventListener("click", () =>
      changeCardQuantity(cardId, -1)
    );

    const count = document.createElement("span");
    count.textContent = quantity;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "＋";
    plus.disabled = !canAddCard(cardId);
    plus.addEventListener("click", () =>
      changeCardQuantity(cardId, 1)
    );

    quantityBox.append(minus, count, plus);
    row.append(image, info, quantityBox);

    list.appendChild(row);
  });

  $("deckTotal").textContent =
    `${getDeckCount()} / ${DECK_SIZE}`;
}

// ==============================
// DECK STATUS
// ==============================

function renderDeckStatus() {
  const total = getDeckCount();
  const name = $("deckName").value.trim();

  $("deckCount").textContent = total;

  $("deckProgress").style.width =
    `${Math.min((total / DECK_SIZE) * 100, 100)}%`;

  $("currentDeckTitle").textContent = name || "NEW DECK";

  if (total < DECK_SIZE) {
    $("deckStatusText").textContent =
      `あと${DECK_SIZE - total}枚でデッキ完成！`;
  } else if (total === DECK_SIZE) {
    $("deckStatusText").textContent =
      `${DECK_SIZE}枚完成！デッキを保存できます。`;
  } else {
    $("deckStatusText").textContent =
      `${total - DECK_SIZE}枚減らしてください。`;
  }

  $("saveDeckButton").disabled =
    isSaving || total !== DECK_SIZE || !name ||
    [...deckContents.entries()].some(
      ([cardId, quantity]) =>
        quantity > MAX_SAME_CARD ||
        quantity > getOwnedQuantity(cardId)
    );
    
// デッキ完成時の発光演出
const isComplete = total === DECK_SIZE;

$("deckProgress").classList.toggle(
  "deck-progress-complete",
  isComplete
);

document.querySelector(".deck-status")?.classList.toggle(
  "deck-status-complete",
  isComplete
);
}

// ==============================
// NEW DECK
// ==============================

$("newDeckButton").addEventListener("click", () => {
  selectedDeckId = null;
  deckContents = new Map();

  $("deckName").value = "";

  renderSavedDeckSelect();
  renderAll();

  showMessage("新しいデッキを作成します。", "success");
});

// ==============================
// LOAD DECK
// ==============================

$("savedDeckSelect").addEventListener("change", () => {
  const deckId = $("savedDeckSelect").value;

  if (!deckId) {
    selectedDeckId = null;
    deckContents = new Map();
    $("deckName").value = "";
    renderSavedDeckSelect();
    renderAll();
    return;
  }

  const deck = savedDecks.find((item) => item.id === deckId);
  if (!deck) return;

  selectedDeckId = deckId;
  $("deckName").value = deck.deckName || "";

  const nextContents = new Map();
  let adjusted = false;

  (Array.isArray(deck.cards) ? deck.cards : []).forEach((entry) => {
    const cardId = entry.cardId;
    const quantity = Number(entry.quantity || 0);
    const owned = getOwnedQuantity(cardId);

    if (
      owned > 0 &&
      Number.isSafeInteger(quantity) &&
      quantity > 0
    ) {
      const usable = Math.min(quantity, owned);

      nextContents.set(
        cardId,
        (nextContents.get(cardId) || 0) + usable
      );

      if (usable !== quantity) adjusted = true;
    } else {
      adjusted = true;
    }
  });

  deckContents = nextContents;

  renderSavedDeckSelect();
  renderAll();

  if (getDeckCount() > DECK_SIZE) {
    showMessage(
      `旧ルールのデッキです。${DECK_SIZE}枚に減らして保存してください。`,
      "error"
    );
  } else if (
    getDeckCount() !== DECK_SIZE ||
    adjusted ||
    [...deckContents.values()].some(
      (quantity) => quantity > MAX_SAME_CARD
    )
  ) {
    showMessage(
      `デッキ内容を確認し、${DECK_SIZE}枚・同じカード最大${MAX_SAME_CARD}枚に調整してください。`,
      "error"
    );
  } else {
    showMessage("デッキを読み込みました。", "success");
  }
});

// ==============================
// DELETE DECK
// ==============================

$("deleteDeckButton").addEventListener("click", async () => {
  if (!selectedDeckId) return;

  const deck = savedDecks.find(
    (item) => item.id === selectedDeckId
  );

  if (!confirm(
    `「${deck?.deckName || "このデッキ"}」を削除しますか？`
  )) {
    return;
  }

  try {
    await deleteDoc(
      doc(db, "users", currentUser.uid, "decks", selectedDeckId)
    );

    savedDecks = savedDecks.filter(
      (item) => item.id !== selectedDeckId
    );

    selectedDeckId = null;
    deckContents = new Map();
    $("deckName").value = "";

    renderSavedDeckSelect();
    renderAll();

    showMessage("デッキを削除しました。", "success");

  } catch (error) {
    console.error(error);
    showMessage("デッキの削除に失敗しました。", "error");
  }
});

// ==============================
// SAVE DECK
// ==============================

$("saveDeckButton").addEventListener("click", saveDeck);

async function saveDeck() {
  if (isSaving || !currentUser) return;

  const deckName = $("deckName").value.trim();
  const total = getDeckCount();

  if (!deckName) {
    showMessage("デッキ名を入力してください。", "error");
    return;
  }

  if (deckName.length > 30) {
    showMessage("デッキ名は30文字以内にしてください。", "error");
    return;
  }

  if (total !== DECK_SIZE) {
    showMessage(
      `デッキはちょうど${DECK_SIZE}枚にしてください。`,
      "error"
    );
    return;
  }

  for (const [cardId, quantity] of deckContents.entries()) {
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_SAME_CARD
    ) {
      showMessage(
        `同じカードは最大${MAX_SAME_CARD}枚までです。`,
        "error"
      );
      return;
    }

    if (quantity > getOwnedQuantity(cardId)) {
      showMessage(
        "所持枚数を超えているカードがあります。",
        "error"
      );
      return;
    }
  }

  const cardsData = [...deckContents.entries()].map(
    ([cardId, quantity]) => ({
      cardId,
      quantity
    })
  );

  const deckId = selectedDeckId || doc(
    collection(db, "users", currentUser.uid, "decks")
  ).id;

  isSaving = true;
  renderDeckStatus();

  try {
    const deckRef = doc(
      db,
      "users",
      currentUser.uid,
      "decks",
      deckId
    );

    const existingDeck = savedDecks.find(
      (item) => item.id === deckId
    );

    const deckData = {
      deckName,
      cards: cardsData,
      totalCards: total,
      updatedAt: serverTimestamp()
    };

    if (!existingDeck) {
      deckData.createdAt = serverTimestamp();
    }

    await setDoc(deckRef, deckData, { merge: true });

    selectedDeckId = deckId;

    await loadSavedDecks();

    $("savedDeckSelect").value = deckId;

    showMessage("10枚デッキを保存しました！", "success");

  } catch (error) {
    console.error(error);
    showMessage(
      "デッキの保存に失敗しました。Firestore Rulesを確認してください。",
      "error"
    );

  } finally {
    isSaving = false;
    renderAll();
  }
}

// ==============================
// SEARCH
// ==============================

$("cardSearch").addEventListener("input", renderCollection);

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeRarity = button.dataset.rarity;

    document.querySelectorAll(".filter-button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });

    renderCollection();
  });
});

$("deckName").addEventListener("input", renderDeckStatus);

// ==============================
// MESSAGE
// ==============================

let messageTimer;

function showMessage(message, type = "success") {
  const element = $("message");

  element.textContent = message;
  element.className = `message ${type}`;
  element.classList.remove("hidden");

  clearTimeout(messageTimer);

  messageTimer = setTimeout(() => {
    element.classList.add("hidden");
  }, 3500);
}

// カード並び替え
$("cardSort").addEventListener("change", renderCollection);

// ==============================
// CARD DETAIL
// ==============================

function openCardDetail(card) {
  const modal = $("cardDetailModal");

  $("detailCardImage").src = getImageUrl(card.imagePath);
  $("detailCardImage").alt = card.name || "CARD";

  $("detailCardName").textContent = card.name || "UNNAMED CARD";
  $("detailCardRarity").textContent = card.rarity || "N";

  // カードデータのステータス
  $("detailCardCost").textContent = cardCost(card);
  $("detailCardAttack").textContent = cardAttack(card);
  $("detailCardHp").textContent = cardHp(card);


  // スキル説明
  $("detailCardSkill").textContent =
    card.skillDescription ||
    card.description ||
    "スキル情報なし";

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeCardDetail() {
  $("cardDetailModal").classList.add("hidden");
  document.body.style.overflow = "";
}

// 閉じるボタン
$("cardDetailClose").addEventListener("click", closeCardDetail);

// 背景クリックで閉じる
$("cardDetailModal").addEventListener("click", (event) => {
  if (event.target === $("cardDetailModal")) {
    closeCardDetail();
  }
});

// ESCキーで閉じる
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCardDetail();
  }
});


// ==============================
// DECK RARITY SUMMARY
// ==============================

function renderDeckRaritySummary() {
  const container = $("deckRaritySummary");
  if (!container) return;

  const rarities = ["UR", "SSR", "SR", "R", "N"];

  const colors = {
    UR: "#ff6ee5",
    SSR: "#ffbd62",
    SR: "#bb83ff",
    R: "#58a9ff",
    N: "#c0c5d1"
  };

  const counts = Object.fromEntries(
    rarities.map(rarity => [rarity, 0])
  );

  deckContents.forEach((quantity, cardId) => {
    const card = ownedCards.find(item => item.id === cardId);
    if (card && Object.hasOwn(counts, card.rarity)) {
      counts[card.rarity] += quantity;
    }
  });

  container.innerHTML = "";

  rarities.forEach(rarity => {
    const count = counts[rarity];
    const percent = Math.min((count / DECK_SIZE) * 100, 100);

    const row = document.createElement("div");
    row.className = "rarity-summary-item";

    const label = document.createElement("span");
    label.textContent = rarity;
    label.style.color = colors[rarity];

    const track = document.createElement("div");
    track.className = "rarity-summary-track";

    const fill = document.createElement("div");
    fill.className = "rarity-summary-fill";
    fill.style.width = `${percent}%`;
    fill.style.background = colors[rarity];

    const value = document.createElement("span");
    value.className = "rarity-summary-count";
    value.textContent = `${count}枚`;

    track.appendChild(fill);
    row.append(label, track, value);
    container.appendChild(row);
  });
}


// ==============================
// DECK MANA ANALYSIS
// ==============================

function renderDeckManaAnalysis() {
  const container = $("deckManaDistribution");
  const average = $("deckAverageCost");
  if (!container || !average) return;

  const groups = [
    { label: "LOW 0-3", min: 0, max: 3, color: "#54e6ff" },
    { label: "MID 4-6", min: 4, max: 6, color: "#a58bff" },
    { label: "HIGH 7-10", min: 7, max: 10, color: "#ffb45c" }
  ];

  const counts = [0, 0, 0];
  let totalCards = 0;
  let totalCost = 0;

  for (const [cardId, quantity] of deckContents.entries()) {
    const card = masterCards.find(item => item.id === cardId);
    if (!card) continue;

    const cost = cardCost(card);
    totalCards += quantity;
    totalCost += cost * quantity;

    const index = groups.findIndex(
      group => cost >= group.min && cost <= group.max
    );

    if (index >= 0) counts[index] += quantity;
  }

  average.textContent = totalCards
    ? (totalCost / totalCards).toFixed(1)
    : "0.0";

  container.replaceChildren();

  groups.forEach((group, index) => {
    const row = document.createElement("div");
    row.className = "mana-analysis-row";

    const label = document.createElement("span");
    label.textContent = group.label;

    const track = document.createElement("div");
    track.className = "mana-analysis-track";

    const fill = document.createElement("div");
    fill.className = "mana-analysis-fill";
    fill.style.width =
      `${Math.min(counts[index] / DECK_SIZE * 100, 100)}%`;
    fill.style.background = group.color;

    const count = document.createElement("span");
    count.textContent = `${counts[index]}枚`;

    track.append(fill);
    row.append(label, track, count);
    container.append(row);
  });
}


// ========================================
// DECK CARD CHANGE ANIMATION
// ========================================

function animateChangedCard(cardId, change) {
  const cardElements = document.querySelectorAll(
    ".collection-card, .deck-card-row"
  );

  cardElements.forEach(element => {
    if (element.dataset.cardId !== cardId) return;

    const animationClass =
      change > 0 ? "card-added" : "card-removed";

    element.classList.remove("card-added", "card-removed");

    // アニメーションを再実行
    void element.offsetWidth;

    element.classList.add(animationClass);

    element.addEventListener("animationend", () => {
      element.classList.remove(animationClass);
    }, { once: true });
  });
}
