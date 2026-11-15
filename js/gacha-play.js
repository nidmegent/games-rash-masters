
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

const RARITIES = ["N", "R", "SR", "SSR", "UR"];

let banners = [];
let cardMap = new Map();
let currentBanner = null;
let loading = false;

function showStatus(text, error = false) {
  const el = $("statusMessage");
  el.textContent = text;
  el.classList.toggle("error", error);
  el.hidden = !text;
}

function getCardImageUrl(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(?:N|R|SR|SSR|UR)\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(path)
  ) {
    return "";
  }

  return new URL(`../${path}`, import.meta.url).href;
}

function formatCoins(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.max(0, n).toLocaleString("ja-JP")
    : "0";
}

// ========================================
// LOAD PUBLIC GACHAS
// ========================================

async function loadGachas() {
  if (loading) return;
  loading = true;

  showStatus("開催中のガチャを読み込み中...");

  try {
    // enabled == true のガチャだけを取得
    const q = query(
      collection(db, "gachaBanners"),
      where("enabled", "==", true)
    );

    const snapshot = await getDocs(q);

    banners = snapshot.docs.map(item => ({
      ...item.data(),
      id: item.id
    }));

    banners.sort((a, b) =>
      String(a.name || "").localeCompare(
        String(b.name || ""), "ja"
      )
    );

    renderGachas();
    showStatus("");

    // 編集中のガチャが非公開になった場合は閉じる
    if (currentBanner) {
      const stillPublic = banners.find(
        b => b.id === currentBanner.id
      );

      if (stillPublic) {
        await openGacha(stillPublic.id);
      } else {
        closeDetails();
      }
    }

  } catch (error) {
    console.error("Gacha load error:", error);
    showStatus(
      "ガチャを読み込めませんでした：" + error.message,
      true
    );
  } finally {
    loading = false;
  }
}

// ========================================
// RENDER BANNERS
// ========================================

function renderGachas() {
  const container = $("gachaList");
  container.replaceChildren();

  if (!banners.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      "現在公開されているガチャはありません。";
    container.append(empty);
    return;
  }

  banners.forEach(banner => {
    const article = document.createElement("article");
    article.className = "gacha-card";

    const art = document.createElement("div");
    art.className = "gacha-art";
    art.textContent = "✦";

    const info = document.createElement("div");
    info.className = "gacha-info";

    const title = document.createElement("h3");
    title.textContent = banner.name || "名称未設定";

    const description = document.createElement("p");
    description.textContent =
      banner.description || "新たなカードを召喚しよう！";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "ガチャ詳細を見る";

    button.addEventListener("click", () => {
      openGacha(banner.id);
    });

    info.append(title, description, button);
    article.append(art, info);
    container.append(article);
  });
}

// ========================================
// LOAD CARD MASTER
// ========================================

async function loadCardPool(banner) {
  const ids = Array.isArray(banner.cardPool)
    ? banner.cardPool.filter(id => typeof id === "string")
    : [];

  const uniqueIds = [...new Set(ids)];

  // 対象カードだけを取得
  const results = await Promise.all(
    uniqueIds.map(async id => {
      try {
        const snapshot = await getDoc(doc(db, "cards", id));

        if (!snapshot.exists()) return null;

        return {
          id: snapshot.id,
          ...snapshot.data()
        };
      } catch (error) {
        console.warn("Card load failed:", id, error);
        return null;
      }
    })
  );

  cardMap = new Map(
    results.filter(Boolean).map(card => [card.id, card])
  );
}

// ========================================
// OPEN GACHA DETAILS
// ========================================

async function openGacha(id) {
  const banner = banners.find(item => item.id === id);
  if (!banner) return;

  currentBanner = banner;

  $("detailName").textContent =
    banner.name || "ガチャ詳細";

  $("detailDescription").textContent =
    banner.description || "";

  $("singlePrice").textContent =
    `${formatCoins(banner.singleCost)} COINS`;

  $("tenPrice").textContent =
    `${formatCoins(banner.tenCost)} COINS`;

  renderRates(banner.rates || {});

  $("detailArea").hidden = false;
  $("cardPool").textContent = "カードを読み込み中...";

  try {
    await loadCardPool(banner);

    // 別のガチャが選ばれた場合は古い結果を表示しない
    if (currentBanner?.id !== id) return;

    renderCardPool(banner);

  } catch (error) {
    console.error("Card pool error:", error);
    $("cardPool").textContent =
      "カード情報の取得に失敗しました。";
  }

  $("detailArea").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function closeDetails() {
  currentBanner = null;
  $("detailArea").hidden = true;
  cardMap.clear();
}

// ========================================
// RARITY RATES
// ========================================

function renderRates(rates) {
  const container = $("rateList");
  container.replaceChildren();

  RARITIES.forEach(rarity => {
    const value = Number(rates[rarity]) || 0;
    const percent = Math.max(0, Math.min(100, value));

    const row = document.createElement("div");
    row.className = "rate-row";

    const name = document.createElement("span");
    name.textContent = rarity;

    const track = document.createElement("div");
    track.className = "rate-track";

    const fill = document.createElement("div");
    fill.className = "rate-fill";
    fill.style.width = `${percent}%`;
    track.append(fill);

    const rate = document.createElement("span");
    rate.className = "rate-value";
    rate.textContent = `${value}%`;

    row.append(name, track, rate);
    container.append(row);
  });
}

// ========================================
// CARD POOL DISPLAY
// ========================================

function renderCardPool(banner) {
  const container = $("cardPool");
  container.replaceChildren();

  const ids = Array.isArray(banner.cardPool)
    ? [...new Set(banner.cardPool)]
    : [];

  const cards = ids
    .map(id => cardMap.get(id))
    .filter(Boolean);

  $("poolCount").textContent =
    `${cards.length} CARDS`;

  if (!cards.length) {
    container.textContent =
      "表示できる排出対象カードがありません。";
    return;
  }

  cards.forEach(card => {
    const article = document.createElement("div");
    article.className = "pool-card";

    const imageUrl = getCardImageUrl(card.imagePath);

    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = card.name || "カード";
      image.loading = "lazy";
      article.append(image);
    }

    const name = document.createElement("strong");
    name.textContent = card.name || "名称未設定";

    const rarity = document.createElement("small");
    rarity.textContent = card.rarity || "N";

    article.append(name, rarity);
    container.append(article);
  });
}

// ========================================
// EVENTS
// ========================================

$("refreshButton").addEventListener("click", loadGachas);
$("closeDetail").addEventListener("click", closeDetails);

// STEP 3まで抽選ボタンは無効化
$("singleButton").disabled = true;
$("tenButton").disabled = true;

// ========================================
// AUTH
// ========================================

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  $("playerName").textContent =
    user.displayName || user.email || "PLAYER";

  // コインの保存形式が未確定なので数値を捏造しない
  $("coinBalance").textContent = "未連携";

  $("playerArea").hidden = false;
  $("gachaArea").hidden = false;

  await loadGachas();
});
