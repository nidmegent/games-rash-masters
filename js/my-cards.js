
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const cardGrid = document.getElementById("cardGrid");
const loading = document.getElementById("loading");
const emptyMessage = document.getElementById("emptyMessage");
const searchInput = document.getElementById("searchInput");
const rarityFilter = document.getElementById("rarityFilter");
const resultCount = document.getElementById("resultCount");

const totalCardsEl = document.getElementById("totalCards");
const ownedKindsEl = document.getElementById("ownedKinds");
const ownedTotalEl = document.getElementById("ownedTotal");

const modal = document.getElementById("cardModal");
const modalContent = document.getElementById("modalContent");

let currentUser = null;
let allCards = [];
let ownedCards = {};
let currentMode = "all";

function imageUrl(path) {
  if (!path) return "";
  return new URL("../" + path.replace(/^\/+/, ""), import.meta.url).href;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function getQuantity(cardId) {
  return Math.max(0, Number(ownedCards[cardId]?.quantity || 0));
}

function updateStats() {
  const entries = Object.values(ownedCards);
  const ownedEntries = entries.filter(item => Number(item.quantity) > 0);

  totalCardsEl.textContent = allCards.length;
  ownedKindsEl.textContent = ownedEntries.length;
  ownedTotalEl.textContent = ownedEntries.reduce(
    (sum, item) => sum + Number(item.quantity || 0), 0
  );
}

async function loadData() {
  if (!currentUser) return;

  loading.classList.remove("hidden");
  cardGrid.innerHTML = "";
  emptyMessage.classList.add("hidden");

  try {
    const [cardsSnapshot, ownedSnapshot] = await Promise.all([
      getDocs(collection(db, "cards")),
      getDocs(collection(db, "users", currentUser.uid, "ownedCards"))
    ]);

    allCards = cardsSnapshot.docs.map(document => ({
      id: document.id,
      ...document.data()
    }));

    ownedCards = {};

    ownedSnapshot.docs.forEach(document => {
      ownedCards[document.id] = document.data();
    });

    allCards.sort((a, b) => {
      const order = ["UR", "SSR", "SR", "R", "N"];
      return order.indexOf(a.rarity) - order.indexOf(b.rarity);
    });

    updateStats();
    renderCards();

  } catch (error) {
    console.error("カード読み込みエラー:", error);
    cardGrid.innerHTML = "";
    emptyMessage.textContent =
      "カードデータを読み込めませんでした。Firestore Rulesを確認してください。";
    emptyMessage.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
  }
}

function renderCards() {
  const keyword = searchInput.value.trim().toLowerCase();
  const rarity = rarityFilter.value;

  let filtered = allCards.filter(card => {
    const matchesName = String(card.name || "")
      .toLowerCase().includes(keyword);

    const matchesRarity =
      rarity === "ALL" || card.rarity === rarity;

    const quantity = getQuantity(card.id);
    const matchesMode =
      currentMode === "all" || quantity > 0;

    return matchesName && matchesRarity && matchesMode;
  });

  resultCount.textContent = `${filtered.length} CARDS`;
  cardGrid.innerHTML = "";

  if (filtered.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }

  emptyMessage.classList.add("hidden");

  filtered.forEach(card => {
    const quantity = getQuantity(card.id);
    const item = document.createElement("article");
    item.className = "card-item";

    const path = imageUrl(card.imagePath);

    item.innerHTML = `
      <div class="card-image-area">
        ${
          path
            ? `<img class="card-image"
                src="${escapeHTML(path)}"
                alt="${escapeHTML(card.name)}"
                loading="lazy">`
            : `<div class="image-fallback">NO IMAGE</div>`
        }
      </div>
      <span class="rarity rarity-${escapeHTML(card.rarity)}">
        ${escapeHTML(card.rarity)}
      </span>
      <div class="card-name">${escapeHTML(card.name)}</div>
      <div class="card-count">
        所持数：${quantity}
      </div>
    `;

    const image = item.querySelector("img");

    if (image) {
      image.addEventListener("error", () => {
        const fallback = document.createElement("div");
        fallback.className = "image-fallback";
        fallback.textContent = "IMAGE ERROR";
        image.replaceWith(fallback);
      });
    }

    item.addEventListener("click", () => showDetail(card));
    cardGrid.appendChild(item);
  });
}

function showDetail(card) {
  const quantity = getQuantity(card.id);
  const path = imageUrl(card.imagePath);

  modalContent.innerHTML = `
    ${path
      ? `<img class="modal-image" src="${escapeHTML(path)}"
           alt="${escapeHTML(card.name)}">`
      : `<div class="image-fallback">NO IMAGE</div>`
    }

    <span class="rarity rarity-${escapeHTML(card.rarity)}">
      ${escapeHTML(card.rarity)}
    </span>

    <h2 class="modal-name">${escapeHTML(card.name)}</h2>

    <div class="modal-stats">
      <div class="modal-stat">
        <small>ATTACK</small>
        <strong>${Number(card.attack || 0)}</strong>
      </div>
      <div class="modal-stat">
        <small>HP</small>
        <strong>${Number(card.hp || 0)}</strong>
      </div>
      <div class="modal-stat">
        <small>OWNED</small>
        <strong>${quantity}</strong>
      </div>
    </div>

    <p class="modal-description">
      ${escapeHTML(card.description || "説明はありません。")}
    </p>

    <p class="modal-description">
      CARD TYPE：${escapeHTML(card.cardType || "未設定")}
    </p>
  `;

  modal.showModal();
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.classList.remove("active");
    });

    button.classList.add("active");
    currentMode = button.dataset.mode;
    renderCards();
  });
});

searchInput.addEventListener("input", renderCards);
rarityFilter.addEventListener("change", renderCards);

document.getElementById("reloadButton").addEventListener("click", loadData);

document.getElementById("closeModal").addEventListener("click", () => {
  modal.close();
});

modal.addEventListener("click", event => {
  if (event.target === modal) modal.close();
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  currentUser = user;
  await loadData();
});
