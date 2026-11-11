
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
    id: item.id,
    ...item.data()
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
    id: item.id,
    ...item.data()
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
    option.textContent = deck.deckName || "UNNAMED DECK";
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

  const cleanPath = String(path).replace(/^\/+/, "");

  return new URL(cleanPath, import.meta.url).href;
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

// ==============================
// RENDER ALL
// ==============================

function renderAll() {
  renderCollection();
  renderDeckList();
  renderDeckStatus();
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

  const list = $("collectionList");
  list.innerHTML = "";

  if (!filtered.length) {
    list.innerHTML =
      '<p class="empty">該当する所持カードがありません。</p>';
    return;
  }

  filtered.forEach((card) => {
    const quantity = getDeckQuantity(card.id);
    const remaining = card.ownedQuantity - quantity;

    const article = document.createElement("article");
    article.className = "collection-card";

    const image = document.createElement("img");
    image.src = getImageUrl(card.imagePath);
    image.alt = card.name || "CARD";
    image.onerror = () => {
      image.style.visibility = "hidden";
    };

    const info = document.createElement("div");
    info.className = "collection-info";

    const name = document.createElement("strong");
    name.textContent = card.name || "UNNAMED CARD";

    const rarity = document.createElement("small");
    rarity.className = `rarity rarity-${card.rarity || "N"}`;
    rarity.textContent = card.rarity || "N";

    const owned = document.createElement("small");
    owned.textContent = `所持 ${card.ownedQuantity}枚 / 編成 ${quantity}枚`;

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.disabled = quantity <= 0;
    minus.addEventListener("click", () => changeCardQuantity(card.id, -1));

    const count = document.createElement("span");
    count.textContent = quantity;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "＋";
    plus.disabled = remaining <= 0 || getDeckCount() >= 30;
    plus.addEventListener("click", () => changeCardQuantity(card.id, 1));

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

  if (change > 0 && getDeckCount() >= 30) {
    showMessage("デッキは30枚までです。", "error");
    return;
  }

  if (next === 0) {
    deckContents.delete(cardId);
  } else {
    deckContents.set(cardId, next);
  }

  renderAll();
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
    row.className = "deck-card-row";

    const image = document.createElement("img");
    image.src = getImageUrl(card.imagePath);
    image.alt = card.name || "CARD";
    image.onerror = () => {
      image.style.visibility = "hidden";
    };

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
    plus.disabled =
      quantity >= getOwnedQuantity(cardId) || getDeckCount() >= 30;

    plus.addEventListener("click", () =>
      changeCardQuantity(cardId, 1)
    );

    quantityBox.append(minus, count, plus);
    row.append(image, info, quantityBox);

    list.appendChild(row);
  });

  $("deckTotal").textContent = `${getDeckCount()} / 30`;
}

// ==============================
// DECK STATUS
// ==============================

function renderDeckStatus() {
  const total = getDeckCount();
  const name = $("deckName").value.trim();

  $("deckCount").textContent = total;
  $("deckProgress").style.width = `${(total / 30) * 100}%`;

  $("currentDeckTitle").textContent = name || "NEW DECK";

  if (total < 30) {
    $("deckStatusText").textContent =
      `あと${30 - total}枚でデッキ完成！`;
  } else {
    $("deckStatusText").textContent =
      "30枚完成！デッキを保存できます。";
  }

  $("saveDeckButton").disabled =
    isSaving || total !== 30 || !name;
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

  (Array.isArray(deck.cards) ? deck.cards : []).forEach((entry) => {
    const cardId = entry.cardId;
    const quantity = Number(entry.quantity || 0);
    const owned = getOwnedQuantity(cardId);

    if (
      owned > 0 &&
      Number.isSafeInteger(quantity) &&
      quantity > 0
    ) {
      nextContents.set(cardId, Math.min(quantity, owned));
    }
  });

  deckContents = nextContents;

  renderSavedDeckSelect();
  renderAll();

  if (getDeckCount() !== 30) {
    showMessage(
      "所持枚数が変わったため、デッキ内容を調整しました。30枚に戻して保存してください。",
      "error"
    );
  }
});

// ==============================
// DELETE DECK
// ==============================

$("deleteDeckButton").addEventListener("click", async () => {
  if (!selectedDeckId) return;

  const deck = savedDecks.find((item) => item.id === selectedDeckId);

  if (!confirm(`「${deck?.deckName || "このデッキ"}」を削除しますか？`)) {
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
  if (isSaving) return;

  const deckName = $("deckName").value.trim();
  const total = getDeckCount();

  if (!deckName) {
    showMessage("デッキ名を入力してください。", "error");
    return;
  }

  if (total !== 30) {
    showMessage("デッキはちょうど30枚にしてください。", "error");
    return;
  }

  // 保存直前に所持枚数を再確認
  for (const [cardId, quantity] of deckContents.entries()) {
    if (quantity > getOwnedQuantity(cardId)) {
      showMessage("所持枚数を超えているカードがあります。", "error");
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

    showMessage("デッキを保存しました！", "success");

  } catch (error) {
    console.error(error);
    showMessage("デッキの保存に失敗しました。", "error");

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
