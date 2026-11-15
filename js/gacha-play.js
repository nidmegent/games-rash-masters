
import { auth, db, app } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js";

// ========================================
// RASH MASTERS GACHA CONFIG
// ========================================

// Cloud Functionsの本番デプロイと
// セキュリティテストが完了するまでfalse。
const GACHA_BACKEND_ENABLED = false;

const FUNCTION_REGION = "asia-northeast1";

const functions = getFunctions(
  app,
  FUNCTION_REGION
);

const initializePlayerCoins = httpsCallable(
  functions,
  "initializePlayerCoins"
);

const drawGacha = httpsCallable(
  functions,
  "drawGacha"
);

const $ = id => document.getElementById(id);

const RARITIES = [
  "N", "R", "SR", "SSR", "UR"
];

let banners = [];
let cardMap = new Map();
let currentBanner = null;

let loading = false;
let drawing = false;
let coinBalance = null;
let coinsInitialized = false;

let unsubscribeUser = null;
let authGeneration = 0;

// ========================================
// STATUS
// ========================================

function showStatus(text, error = false) {
  const el = $("statusMessage");

  el.textContent = text;
  el.classList.toggle("error", error);
  el.hidden = !text;
}

function formatCoins(value) {
  return Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString("ja-JP")
    : "---";
}

function getCardImageUrl(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(?:N|R|SR|SSR|UR)\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(path)
  ) {
    return "";
  }

  return new URL(
    `../${path}`,
    import.meta.url
  ).href;
}

// ========================================
// COIN DISPLAY
// ========================================

function updateCoinDisplay() {
  $("coinBalance").textContent =
    coinBalance === null
      ? "未付与"
      : formatCoins(coinBalance);
}

function updateDrawButtons() {
  const banner = currentBanner;

  const singleCost = banner?.singleCost;
  const tenCost = banner?.tenCost;

  const ready =
    GACHA_BACKEND_ENABLED &&
    coinsInitialized &&
    !drawing &&
    !!banner &&
    coinBalance !== null;

  $("singleButton").disabled = !(
    ready &&
    Number.isSafeInteger(singleCost) &&
    singleCost >= 0 &&
    coinBalance >= singleCost
  );

  $("tenButton").disabled = !(
    ready &&
    Number.isSafeInteger(tenCost) &&
    tenCost >= 0 &&
    coinBalance >= tenCost
  );
}

// ========================================
// PLAYER DATA
// ========================================

function watchPlayerCoins(user, generation) {
  if (unsubscribeUser) {
    unsubscribeUser();
    unsubscribeUser = null;
  }

  const userRef = doc(db, "users", user.uid);

  unsubscribeUser = onSnapshot(
    userRef,
    snapshot => {
      if (generation !== authGeneration) return;

      if (!snapshot.exists()) {
        coinBalance = null;
        coinsInitialized = false;
      } else {
        const data = snapshot.data();

        coinBalance =
          Number.isSafeInteger(data.coins) &&
          data.coins >= 0
            ? data.coins
            : null;

        coinsInitialized =
          data.initialCoinsGranted === true &&
          coinBalance !== null;
      }

      updateCoinDisplay();
      updateDrawButtons();
    },
    error => {
      if (generation !== authGeneration) return;

      console.error("Coin listener error:", error);

      coinBalance = null;
      coinsInitialized = false;

      updateCoinDisplay();
      updateDrawButtons();

      showStatus(
        "コイン情報を取得できませんでした。",
        true
      );
    }
  );
}

// ========================================
// INITIAL COIN GRANT
// ========================================

async function ensureInitialCoins(generation) {
  if (!GACHA_BACKEND_ENABLED) {
    return;
  }

  try {
    const response = await initializePlayerCoins();

    if (generation !== authGeneration) return;

    const result = response.data;

    if (!result?.success) {
      throw new Error("初期化に失敗しました。");
    }

    if (result.granted) {
      showStatus(
        "初回ログインボーナスとして" +
        "1,000コインを受け取りました！"
      );
    }

  } catch (error) {
    if (generation !== authGeneration) return;

    console.error("Coin initialization error:", error);

    showStatus(
      "コイン初期化に失敗しました：" +
      (error.message || "不明なエラー"),
      true
    );
  }
}

// ========================================
// LOAD PUBLIC GACHAS
// ========================================

async function loadGachas() {
  if (loading || drawing) return;

  loading = true;

  showStatus("開催中のガチャを読み込み中...");

  try {
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
        String(b.name || ""),
        "ja"
      )
    );

    renderGachas();
    showStatus("");

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
      "ガチャを読み込めませんでした：" +
      error.message,
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
    title.textContent =
      banner.name || "名称未設定";

    const description = document.createElement("p");
    description.textContent =
      banner.description ||
      "新たなカードを召喚しよう！";

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
    ? banner.cardPool.filter(
        id => typeof id === "string"
      )
    : [];

  const uniqueIds = [...new Set(ids)];

  const results = await Promise.all(
    uniqueIds.map(async id => {
      try {
        const snapshot = await getDoc(
          doc(db, "cards", id)
        );

        if (!snapshot.exists()) return null;

        return {
          id: snapshot.id,
          ...snapshot.data()
        };

      } catch (error) {
        console.warn(
          "Card load failed:",
          id,
          error
        );

        return null;
      }
    })
  );

  return new Map(
    results
      .filter(Boolean)
      .map(card => [card.id, card])
  );
}

// ========================================
// OPEN GACHA DETAILS
// ========================================

async function openGacha(id) {
  if (drawing) return;

  const banner = banners.find(
    item => item.id === id
  );

  if (!banner) return;

  currentBanner = banner;
  cardMap = new Map();

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
  $("cardPool").textContent =
    "カードを読み込み中...";

  updateDrawButtons();

  try {
    const loadedCards = await loadCardPool(banner);

    if (currentBanner?.id !== id) return;

    cardMap = loadedCards;
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
  if (drawing) return;

  currentBanner = null;
  cardMap.clear();

  $("detailArea").hidden = true;

  updateDrawButtons();
}

// ========================================
// RARITY RATES
// ========================================

function renderRates(rates) {
  const container = $("rateList");

  container.replaceChildren();

  RARITIES.forEach(rarity => {
    const value = Number(rates[rarity]) || 0;

    const percent = Math.max(
      0,
      Math.min(100, value)
    );

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

    const imageUrl = getCardImageUrl(
      card.imagePath
    );

    if (imageUrl) {
      const image = document.createElement("img");

      image.src = imageUrl;
      image.alt = card.name || "カード";
      image.loading = "lazy";

      article.append(image);
    }

    const name = document.createElement("strong");
    name.textContent =
      card.name || "名称未設定";

    const rarity = document.createElement("small");
    rarity.textContent =
      card.rarity || "N";

    article.append(name, rarity);
    container.append(article);
  });
}

// ========================================
// GACHA DRAW
// ========================================

// 通信失敗時に別のIDで再抽選しないよう、
// 未確認のリクエストを保持する。
let pendingDraw = null;

async function performDraw(count) {
  if (!GACHA_BACKEND_ENABLED) {
    showStatus(
      "現在はプレビュー版です。抽選はできません。",
      true
    );
    return;
  }

  if (drawing || !currentBanner) return;

  if (!coinsInitialized || coinBalance === null) {
    showStatus(
      "コインの初期化が完了していません。",
      true
    );
    return;
  }

  const gachaId = currentBanner.id;
  const cost = count === 1
    ? currentBanner.singleCost
    : currentBanner.tenCost;

  if (
    !Number.isSafeInteger(cost) ||
    cost < 0 ||
    coinBalance < cost
  ) {
    showStatus(
      "コインが不足しているか、価格が不正です。",
      true
    );
    return;
  }

  // 未確認の抽選がある場合は、
  // 別の抽選を開始させない。
  if (pendingDraw) {
    showStatus(
      "結果未確認の抽選があります。" +
      "画面を更新せず、運営に確認してください。",
      true
    );
    return;
  }

  const requestId = crypto.randomUUID();

  pendingDraw = {
    gachaId,
    count,
    requestId
  };

  drawing = true;
  updateDrawButtons();

  showStatus(
    `${count}回召喚を処理しています...`
  );

  try {
    const response = await drawGacha({
      gachaId,
      count,
      requestId
    });

    const result = response.data;

    if (
      !result?.success ||
      !Array.isArray(result.cards)
    ) {
      throw new Error(
        "サーバーからの抽選結果が不正です。"
      );
    }

    // 成功した抽選は再送しない
    pendingDraw = null;

    if (
      Number.isSafeInteger(result.remainingCoins)
    ) {
      coinBalance = result.remainingCoins;
      updateCoinDisplay();
    }

    await showDrawResult(result);

    showStatus(
      `${count}回召喚が完了しました！`
    );

  } catch (error) {
    console.error("Gacha draw error:", error);

    // 通信エラーの場合、サーバー側で
    // 抽選が成功している可能性がある。
    // pendingDrawは保持して二重抽選を防ぐ。
    showStatus(
      "抽選結果を確認できませんでした。" +
      "再度召喚せず、運営に確認してください。" +
      "詳細：" + (error.message || "通信エラー"),
      true
    );

  } finally {
    drawing = false;
    updateDrawButtons();
  }
}

// ========================================
// DRAW RESULT DISPLAY
// ========================================

async function showDrawResult(result) {
  const area = $("resultArea");
  const container = $("resultCards");

  container.replaceChildren();

  $("resultTitle").textContent =
    result.count === 10
      ? "10連召喚結果"
      : "召喚結果";

  $("resultMessage").textContent =
    `${result.cost}コイン消費 / ` +
    `残高 ${formatCoins(result.remainingCoins)} コイン`;

  // 抽選結果に含まれるカードIDを
  // マスターと照合して画像を表示
  const ids = [
    ...new Set(
      result.cards.map(card => card.cardId)
    )
  ];

  const resultCardMap = new Map();

  await Promise.all(
    ids.map(async id => {
      try {
        const snapshot = await getDoc(
          doc(db, "cards", id)
        );

        if (snapshot.exists()) {
          resultCardMap.set(
            id,
            snapshot.data()
          );
        }
      } catch (error) {
        console.warn(
          "Result card load failed:",
          id,
          error
        );
      }
    })
  );

  result.cards.forEach(card => {
    const master = resultCardMap.get(
      card.cardId
    );

    const article = document.createElement("div");
    article.className = "pool-card";

    const imageUrl = getCardImageUrl(
      master?.imagePath
    );

    if (imageUrl) {
      const image = document.createElement("img");

      image.src = imageUrl;
      image.alt = card.name || "カード";
      image.loading = "lazy";

      article.append(image);
    }

    const name = document.createElement("strong");
    name.textContent =
      card.name || master?.name || "名称未設定";

    const rarity = document.createElement("small");
    rarity.textContent =
      card.rarity || master?.rarity || "N";

    article.append(name, rarity);
    container.append(article);
  });

  area.hidden = false;

  area.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// ========================================
// EVENTS
// ========================================

$("refreshButton").addEventListener(
  "click",
  loadGachas
);

$("closeDetail").addEventListener(
  "click",
  closeDetails
);

$("closeResult").addEventListener(
  "click",
  () => {
    $("resultArea").hidden = true;
  }
);

$("singleButton").addEventListener(
  "click",
  () => performDraw(1)
);

$("tenButton").addEventListener(
  "click",
  () => performDraw(10)
);

// ========================================
// AUTH
// ========================================

onAuthStateChanged(auth, async user => {
  const generation = ++authGeneration;

  if (unsubscribeUser) {
    unsubscribeUser();
    unsubscribeUser = null;
  }

  coinBalance = null;
  coinsInitialized = false;

  updateCoinDisplay();
  updateDrawButtons();

  if (!user) {
    location.replace("login.html");
    return;
  }

  $("playerName").textContent =
    user.displayName ||
    user.email ||
    "PLAYER";

  $("playerArea").hidden = false;
  $("gachaArea").hidden = false;

  // Firestoreから残高を監視
  watchPlayerCoins(user, generation);

  // デプロイ済みの場合のみ初期コインを付与
  if (GACHA_BACKEND_ENABLED) {
    await ensureInitialCoins(generation);
  }

  if (generation !== authGeneration) return;

  await loadGachas();
});

// ========================================
// INITIAL STATE
// ========================================

$("singleButton").disabled = true;
$("tenButton").disabled = true;

if (GACHA_BACKEND_ENABLED) {
  $("modeLabel").textContent = "GACHA MODE";

  $("previewNote").textContent =
    "抽選結果はサーバー側で確定されます。";
} else {
  $("modeLabel").textContent = "PREVIEW MODE";

  $("previewNote").textContent =
    "※ 現在はプレビュー版です。" +
    "抽選・コイン消費・カード付与は実行されません。";
}
