
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
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ========================================
// CLOUDFLARE WORKER CONFIG
// ========================================

const GACHA_API_URL =
  "https://rash-masters-gacha.lgs-esportsgames.workers.dev";

// ========================================
// RASH MASTERS GACHA CONFIG
// ========================================

// Cloud Functionsの本番デプロイと
// セキュリティテストが完了するまでfalse。
const GACHA_BACKEND_ENABLED = false;

// ========================================
// CLOUDFLARE WORKER API
// ========================================

// Firebaseログイン情報を使ってWorkerに接続
async function callGachaApi(path, body = {}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("ログインが必要です。");
  }

  const idToken = await user.getIdToken();

  const response = await fetch(
    `${GACHA_API_URL}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify(body),
      cache: "no-store"
    }
  );

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error || "api_request_failed"
    );

    error.status = response.status;
    error.code = result.error;

    throw error;
  }

  return result;
}

// 初回1,000コイン付与
async function initializePlayerCoins() {
  return {
    data: await callGachaApi("/coins/initialize")
  };
}

// ガチャ抽選
async function drawGacha(body) {
  return {
    data: await callGachaApi("/gacha/draw", body)
  };
}

// 抽選結果の確認
async function getGachaResult(requestId) {
  return {
    data: await callGachaApi(
      "/gacha/result",
      { requestId }
    )
  };
}

const $ = id => document.getElementById(id);

const RARITIES = [
  "N", "R", "SR", "SSR", "UR"
];

let banners = [];
let cardMap = new Map();
let currentBanner = null;

// ガチャ詳細の読み込み順序を管理
let detailGeneration = 0;

let loading = false;
let loadingGeneration = -1;
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

  // ログイン中のユーザーを確認
  const uid = auth.currentUser?.uid;

  // ブラウザに保存された未確認抽選を確認
  let hasPendingDraw = pendingDraw !== null;

  if (uid) {
    const savedDraw = loadPendingDraw(uid);

    if (savedDraw) {
      hasPendingDraw = true;
    }
  }

  // 抽選可能な状態か判定
  const ready =
  GACHA_BACKEND_ENABLED &&
  coinInitializationConfirmed &&
  coinsInitialized &&
  !drawing &&
  !hasPendingDraw &&
  !!uid &&
  !!banner &&
  coinBalance !== null;

  // 1連ガチャ
  $("singleButton").disabled = !(
    ready &&
    Number.isSafeInteger(singleCost) &&
    singleCost >= 0 &&
    coinBalance >= singleCost
  );

  // 10連ガチャ
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

// Workerから初期化成功の応答を受け取った
coinInitializationConfirmed = true;

// ガチャボタンの状態を更新
updateDrawButtons();

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
if (drawing) return;

// 同じログイン状態での重複読み込みだけ防止
if (loading && loadingGeneration === authGeneration) {
  return;
}

const generation = authGeneration;

// 現在のログイン状態で読み込みを開始したことを記録
loading = true;
loadingGeneration = generation;

  showStatus("開催中のガチャを読み込み中...");

  try {
    const q = query(
      collection(db, "gachaBanners"),
      where("enabled", "==", true)
    );

const snapshot = await getDocs(q);

// 読み込み中にログイン状態が変わった場合は中止
if (generation !== authGeneration) {
  return;
}

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
  // 古いログイン状態のエラーは画面に表示しない
  if (generation !== authGeneration) {
    return;
  }

  console.error("Gacha load error:", error);

  showStatus(
    "ガチャを読み込めませんでした：" +
    error.message,
    true
  );
} finally {
  // 自分が開始した読み込みの場合だけ状態を解除
  if (loadingGeneration === generation) {
    loading = false;
    loadingGeneration = -1;
  }
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

  // ガチャ詳細の読み込みを開始したログイン状態を記録
  const generation = authGeneration;

  // 今回の詳細読み込み専用の番号を記録
  const detailRequest = ++detailGeneration;

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

// ログイン状態が変わっていたら中止
if (generation !== authGeneration) {
  return;
}

// 新しい詳細読み込みが始まっていたら古い結果を破棄
if (detailRequest !== detailGeneration) {
  return;
}

// 別のガチャが選択されていた場合も中止
if (currentBanner?.id !== id) {
  return;
}

    cardMap = loadedCards;
    renderCardPool(banner);

} catch (error) {
  // ログインが切り替わっていたら中止
  if (generation !== authGeneration) {
    return;
  }

  // 新しい詳細読み込みが始まっていたら中止
  if (detailRequest !== detailGeneration) {
    return;
  }

  // 別のガチャが選択されていた場合も中止
  if (currentBanner?.id !== id) {
    return;
  }

  console.error("Card pool error:", error);

  $("cardPool").textContent =
    "カード情報の取得に失敗しました。";
}

// ログイン状態が変わっていたらスクロールしない
if (generation !== authGeneration) {
  return;
}

// 新しい詳細読み込みが始まっていたらスクロールしない
if (detailRequest !== detailGeneration) {
  return;
}

// 別のガチャが選択されていた場合もスクロールしない
if (currentBanner?.id !== id) {
  return;
}

$("detailArea").scrollIntoView({
  behavior: "smooth",
  block: "start"
});
}

function closeDetails() {
  if (drawing) return;

  // 進行中のガチャ詳細読み込みを無効化
  detailGeneration++;

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

// ========================================
// PENDING GACHA DRAW STORAGE
// ========================================

let pendingDraw = null;

let coinInitializationConfirmed = false;

// アカウントごとに保存先を分離
function pendingDrawKey(uid) {
  return `rash-masters:pending-gacha:${uid}`;
}

// 未確認の抽選情報を保存
function savePendingDraw(uid, draw) {
  localStorage.setItem(
    pendingDrawKey(uid),
    JSON.stringify(draw)
  );

  pendingDraw = draw;
}

// 保存済みの抽選情報を読み込む
function loadPendingDraw(uid) {
  try {
    const raw = localStorage.getItem(
      pendingDrawKey(uid)
    );

    if (!raw) return null;

    const draw = JSON.parse(raw);

    if (
      !draw ||
      typeof draw.gachaId !== "string" ||
      ![1, 10].includes(draw.count) ||
      typeof draw.requestId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(draw.requestId)
    ) {
      throw new Error("Invalid pending draw");
    }

    return draw;
  } catch (error) {
    console.error(
      "Pending draw load error:",
      error
    );

    // 不正な保存データは勝手に削除しない
    return { invalid: true };
  }
}

// ========================================
// RESTORE PENDING GACHA DRAW
// ========================================

// ページ更新後に未確認の抽選情報を復元
function restorePendingDraw(uid) {
  const savedDraw = loadPendingDraw(uid);

  if (!savedDraw) {
    pendingDraw = null;
    return false;
  }

  if (savedDraw.invalid) {
    pendingDraw = null;

    console.warn(
      "保存された抽選情報を確認できません。"
    );

    return true;
  }

  pendingDraw = savedDraw;

  console.log(
    "未確認のガチャ抽選を復元しました:",
    pendingDraw.requestId
  );

  return true;
}

// ========================================
// CHECK PENDING GACHA RESULT
// ========================================

async function checkPendingGachaResult(uid) {
  const draw = loadPendingDraw(uid);

  if (!draw || draw.invalid) {
    return false;
  }

  try {
const response = await getGachaResult(draw.requestId);

// 通信中にログインが切り替わっていたら
// 古いプレイヤーの結果を処理しない
if (auth.currentUser?.uid !== uid) {
  return false;
}

const result = response.data;

    // Workerから返された結果の形式を確認
if (
  result?.found === true &&
  (
    result.success !== true ||
    !Array.isArray(result.cards) ||
    result.requestId !== draw.requestId ||
    result.gachaId !== draw.gachaId ||
    result.count !== draw.count ||
    result.cards.length !== draw.count ||
    !result.cards.every(
    card =>
    card &&
    typeof card.cardId === "string" &&
    card.cardId.length > 0 ) ||
    !Number.isSafeInteger(result.cost) ||
    result.cost < 0 ||
    !Number.isSafeInteger(result.remainingCoins) ||
    result.remainingCoins < 0 )
) {
  console.error(
    "復元した抽選結果の形式が不正です。",
    result
  );

  // 安全のため抽選IDを保持する
  return false;
}

    if (!result.found) {
      console.warn(
        "抽選結果はまだ確認できません:",
        draw.requestId
      );

      // 未確認なので保存データは残す
      return false;
    }

    // ログインユーザーが途中で変わっていないか確認
    if (auth.currentUser?.uid !== uid) {
      return false;
    }

    // 抽選結果を表示
await showDrawResult(result);

// 表示中にログインユーザーが変わっていないか再確認
if (auth.currentUser?.uid !== uid) {
  return false;
}

// 結果を正常に確認できたので削除
clearPendingDraw(uid);

// 復元した抽選結果の残高を反映
if (Number.isSafeInteger(result.remainingCoins)) {
  coinBalance = result.remainingCoins;
  updateCoinDisplay();
}

// 未確認抽選が解消されたのでボタンを更新
updateDrawButtons();

    console.log(
      "未確認のガチャ抽選結果を復元しました。"
    );

    return true;

} catch (error) {
  // ログインが切り替わっていたら
  // 古いプレイヤーのエラーを処理しない
  if (auth.currentUser?.uid !== uid) {
    return false;
  }

  console.error("抽選結果の確認に失敗しました:", error);
  return false;
}
  
}

// 抽選結果を確認できた場合だけ削除
function clearPendingDraw(uid) {
  localStorage.removeItem(
    pendingDrawKey(uid)
  );

  pendingDraw = null;
}

async function performDraw(count) {
  if (!GACHA_BACKEND_ENABLED) {
    showStatus(
      "現在はプレビュー版です。抽選はできません。",
      true
    );
    return;
  }

  if (drawing || !currentBanner) return;

  const user = auth.currentUser;

  if (!user) {
    showStatus("ログインが必要です。", true);
    return;
  }

  const uid = user.uid;

  // 保存済みの未確認抽選もチェック
  const savedDraw = loadPendingDraw(uid);

  if (pendingDraw || savedDraw) {
    showStatus(
      "未確認のガチャ抽選があります。" +
      "結果の確認が完了するまで新しい抽選はできません。",
      true
    );
    return;
  }

  // Workerの初期化成功とFirestoreの残高を確認
if (
  !coinInitializationConfirmed ||
  !coinsInitialized ||
  coinBalance === null
) {
  showStatus(
    "コインの初期化が完了していません。" +
    "しばらく待ってから再度お試しください。",
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

  const requestId = crypto.randomUUID();

  // 抽選前にIDを保存
  try {
    savePendingDraw(uid, {
      gachaId,
      count,
      requestId
    });
  } catch (error) {
    console.error("Pending draw save error:", error);

    showStatus(
      "抽選情報を保存できませんでした。",
      true
    );
    return;
  }

  drawing = true;
  updateDrawButtons();

  showStatus(`${count}回召喚を処理しています...`);

  try {
    const response = await drawGacha({
      gachaId,
      count,
      requestId
    });

    const result = response.data;

    if (
  result?.success !== true ||
  result.requestId !== requestId ||
  result.gachaId !== gachaId ||
  result.count !== count ||
  !Array.isArray(result.cards) ||
  result.cards.length !== count ||
  !result.cards.every(
  card =>
    card &&
    typeof card.cardId === "string" &&
    card.cardId.length > 0
  ) ||
  !Number.isSafeInteger(result.cost) ||
  result.cost < 0 ||
  result.cost !== cost ||
  !Number.isSafeInteger(result.remainingCoins) ||
  result.remainingCoins < 0
      
) {
  throw new Error(
    "サーバーからの抽選結果が不正です。"
  );
}

    // ログインユーザーが変わっていないか確認
    if (auth.currentUser?.uid !== uid) {
      return;
    }

    // 結果を表示
await showDrawResult(result);

// 表示中にログインユーザーが変わっていないか確認
if (auth.currentUser?.uid !== uid) {
  return;
}

// 結果の表示まで成功した場合のみ削除
clearPendingDraw(uid);

    if (Number.isSafeInteger(result.remainingCoins)) {
      coinBalance = result.remainingCoins;
      updateCoinDisplay();
    }

    showStatus(`${count}回召喚が完了しました！`);

  } catch (error) {
    // ログインが切り替わっていたら
    // 古いプレイヤーのエラー処理を中止
    if (auth.currentUser?.uid !== uid) {
      return;
    }

    console.error("Gacha draw error:", error);

    showStatus(
      "抽選結果を確認しています..."
    );

    // 同じrequestIdで結果を問い合わせる
    const recovered = await checkPendingGachaResult(uid);

    if (auth.currentUser?.uid !== uid) {
      return;
    }

    if (recovered) {
      showStatus(
        "抽選結果を復元しました！"
      );
    } else {
      showStatus(
        "抽選結果を確認できませんでした。" +
        "抽選IDは保存されています。" +
        "新しい抽選は行わず、後ほど再確認してください。",
        true
      );
    }

  } finally {
    // 同じプレイヤーの処理だった場合だけ
    // 抽選中状態とボタン表示を更新する
    if (auth.currentUser?.uid === uid) {
      drawing = false;
      updateDrawButtons();
    }
  }
}

// ========================================
// DRAW RESULT DISPLAY
// ========================================

async function showDrawResult(result) {
  // 結果表示を開始したログイン状態を記録
  const generation = authGeneration;
  const area = $("resultArea");
  const container = $("resultCards");

  // 結果表示を開始する前にログイン状態を確認
  if (!auth.currentUser) {
    return;
  }

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

  // カード情報の取得中にログイン状態が変わっていたら中止
  if (generation !== authGeneration) {
    return;
  }

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

// ログイン状態が変わったらプレイヤー情報をリセット
coinBalance = null;
coinsInitialized = false;
coinInitializationConfirmed = false;

// 前のプレイヤーの抽選中状態を引き継がない
drawing = false;

// 前のプレイヤーのガチャ情報をリセット
pendingDraw = null;
currentBanner = null;
cardMap = new Map();
banners = [];

// 前のログイン状態で開始した詳細読み込みを無効化
detailGeneration++;

$("detailArea").hidden = true;
$("resultArea").hidden = true;

// 前のプレイヤーが開いていたガチャの情報を消去
$("detailName").textContent = "";
$("detailDescription").textContent = "";

// 前のプレイヤーの排出対象カード一覧を消去
$("cardPool").replaceChildren();
$("poolCount").textContent = "";

// 前のガチャの排出確率表示も消去
$("rateList").replaceChildren();

// 前のガチャの価格表示もリセット
$("singlePrice").textContent = "--- COINS";
$("tenPrice").textContent = "--- COINS";

// ガチャ詳細の内部要素は削除しない
// 新しいガチャを開いたときに表示内容を更新する

// 前のプレイヤーの抽選結果カードも消去
$("resultCards").replaceChildren();

// 前のプレイヤーの抽選結果テキストも消去
$("resultTitle").textContent = "";
$("resultMessage").textContent = "";

$("gachaList").replaceChildren();

// コイン表示とボタンを更新
updateCoinDisplay();
updateDrawButtons();

// 前のプレイヤーのステータスメッセージを消去
showStatus("");

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

  // ========================================
  // RESTORE PENDING DRAW
  // ========================================

  // ログイン直後に未確認の抽選IDを復元
  const hasPendingDraw = restorePendingDraw(user.uid);

  // 復元した状態をボタンに反映
  updateDrawButtons();

  // ========================================
  // WATCH PLAYER COINS
  // ========================================

  // Firestoreからコイン残高を監視
  watchPlayerCoins(user, generation);

  // ========================================
  // INITIALIZE PLAYER COINS
  // ========================================

  if (GACHA_BACKEND_ENABLED) {
    await ensureInitialCoins(generation);
  }

  if (generation !== authGeneration) return;

  // ========================================
  // LOAD GACHA DATA
  // ========================================

  // ガチャ一覧とカード情報を読み込む
  await loadGachas();

  if (generation !== authGeneration) return;

  // ========================================
  // CHECK PENDING GACHA RESULT
  // ========================================

  // ガチャ情報の読み込み後に抽選結果を確認
  if (hasPendingDraw && GACHA_BACKEND_ENABLED) {
    const pendingUid = user.uid;

    const recovered = await checkPendingGachaResult(
      pendingUid
    );

    if (generation !== authGeneration) return;

    if (!recovered) {
      console.warn(
        "抽選結果を確認できませんでした。" +
        "未確認の抽選IDは保持します。"
      );

      showStatus(
        "未確認のガチャ抽選があります。" +
        "結果を確認できるまで新しい抽選はできません。",
        true
      );
    }
  }

  // ========================================
  // FINAL BUTTON UPDATE
  // ========================================

  updateDrawButtons();
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
