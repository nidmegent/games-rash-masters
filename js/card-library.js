
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let allCards = [];

const cardGrid = $("cardGrid");

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function imageURL(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(?:N|R|SR|SSR|UR)\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(path)
  ) return "";

  return new URL(path, document.baseURI).href;
}

function renderCards() {
  const keyword = $("searchInput").value.trim().toLowerCase();
  const selectedRarity = $("rarityFilter").value;
  const selectedType = $("typeFilter").value;

  const filtered = allCards.filter((card) => {
    const matchesName = String(card.name || "")
      .toLowerCase().includes(keyword);

    const matchesRarity = !selectedRarity ||
      card.rarity === selectedRarity;

    const matchesType = !selectedType ||
      card.cardType === selectedType;

    return matchesName && matchesRarity && matchesType;
  });

  $("visibleCards").textContent = filtered.length;

  if (!filtered.length) {
    cardGrid.innerHTML = `
      <div class="empty-state">
        該当するカードがありません。
      </div>
    `;
    return;
  }

  cardGrid.innerHTML = filtered.map((card) => {
    const url = imageURL(card.imagePath);

    return `
      <article class="game-card" data-id="${escapeHTML(card.id)}">
        <div class="game-card-image">
          ${
            url
              ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(card.name)}" loading="lazy">`
              : `<div class="empty-state">NO IMAGE</div>`
          }
        </div>

        <div class="game-card-name">${escapeHTML(card.name)}</div>

        <div class="game-card-meta">
          <span class="rarity rarity-${escapeHTML(card.rarity)}">
            ${escapeHTML(card.rarity)}
          </span>
          <span>${escapeHTML(card.cardType || "ATTACK")}</span>
        </div>

        <div class="card-stats">
          <span>ATK ${Number(card.attack) || 0}</span>
          <span>HP ${Number(card.hp) || 0}</span>
        </div>
      </article>
    `;
  }).join("");
}

function openCard(card) {
  const url = imageURL(card.imagePath);

  $("modalBody").innerHTML = `
    <div class="modal-detail">
      ${
        url
          ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(card.name)}">`
          : `<div class="empty-state">NO IMAGE</div>`
      }

      <div>
        <span class="rarity rarity-${escapeHTML(card.rarity)}">
          ${escapeHTML(card.rarity)}
        </span>

        <h2>${escapeHTML(card.name)}</h2>

        <div class="modal-stat">
          ATK ${Number(card.attack) || 0}
          / HP ${Number(card.hp) || 0}
        </div>

        <p>${escapeHTML(card.description || "説明はありません。")}</p>

        <p>TYPE：${escapeHTML(card.cardType || "ATTACK")}</p>
      </div>
    </div>
  `;

  $("cardModal").classList.remove("hidden");
}

function closeModal() {
  $("cardModal").classList.add("hidden");
}

async function loadCards() {
  cardGrid.innerHTML = '<div class="loading">カードを読み込んでいます...</div>';

  try {
    const snapshot = await getDocs(collection(db, "cards"));

    allCards = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    allCards.sort((a, b) => {
      const order = ["UR", "SSR", "SR", "R", "N"];
      return order.indexOf(a.rarity) - order.indexOf(b.rarity);
    });

    $("totalCards").textContent = allCards.length;

    renderCards();

  } catch (error) {
    console.error(error);

    cardGrid.innerHTML = `
      <div class="empty-state">
        カードの読み込みに失敗しました。<br>
        ページを更新するか、管理者にお問い合わせください。
      </div>
    `;
  }
}

cardGrid.addEventListener("click", (event) => {
  const cardElement = event.target.closest(".game-card");
  if (!cardElement) return;

  const card = allCards.find((item) => item.id === cardElement.dataset.id);
  if (card) openCard(card);
});

$("searchInput").addEventListener("input", renderCards);
$("rarityFilter").addEventListener("change", renderCards);
$("typeFilter").addEventListener("change", renderCards);
$("refreshButton").addEventListener("click", loadCards);

$("closeModal").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", closeModal);

$("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  location.replace("login.html");
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  loadCards();
});
