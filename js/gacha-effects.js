
"use strict";

// ==========================================
// RASH MASTERS - GACHA EFFECTS STEP 4-C
// PREVIEW ONLY / NO COIN OR CARD WRITES
// ==========================================

import { auth, db } from "./firebase.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import {
  setupGachaSound,
  playSummonStart,
  playCardReveal,
  playSummarySound
} from "./gacha-sound.js";

const $ = id => document.getElementById(id);

const overlay = $("summonOverlay");
const stage = $("summonStage");
const skipButton = $("summonSkip");
const previewSingle = $("previewSingle");
const previewTen = $("previewTen");

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
);

const RARITIES = ["N", "R", "SR", "SSR", "UR"];

const DEMO_CARDS = [
  { name: "DEMO N", rarity: "N" },
  { name: "DEMO R", rarity: "R" },
  { name: "DEMO SR", rarity: "SR" },
  { name: "DEMO SSR", rarity: "SSR" },
  { name: "DEMO UR", rarity: "UR" },
  { name: "DEMO N", rarity: "N" },
  { name: "DEMO R", rarity: "R" },
  { name: "DEMO SR", rarity: "SR" },
  { name: "DEMO SSR", rarity: "SSR" },
  { name: "DEMO UR", rarity: "UR" }
];

let active = false;
let loading = false;
let cards = [];
let phase = "idle";
let timer = null;
let previousFocus = null;
let previousOverflow = "";
let revealed = false;

function element(tag, className = "", value) {
  const node = document.createElement(tag);
  node.className = className;

  if (value !== undefined) {
    node.textContent = value;
  }

  return node;
}

function rarityOf(card) {
  return RARITIES.includes(card?.rarity)
    ? card.rarity
    : "N";
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function safeImageUrl(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(?:N|R|SR|SSR|UR)\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(path)
  ) {
    return "";
  }

  return new URL(`../${path}`, import.meta.url).href;
}

// ------------------------------------------
// プレビュー用カード読み込み
// ------------------------------------------

async function loadPreviewCards(count) {
  if (!auth.currentUser) {
    return DEMO_CARDS.slice(0, count);
  }

  try {
    const snapshot = await getDocs(
      collection(db, "cards")
    );

    const registered = snapshot.docs
      .map(item => ({
        ...item.data(),
        cardId: item.id
      }))
      .filter(card =>
        RARITIES.includes(card.rarity) &&
        typeof card.name === "string" &&
        card.name.trim().length > 0
      );

    if (!registered.length) {
      return DEMO_CARDS.slice(0, count);
    }

    // 演出テストのため高レアリティも確認できる順序。
    // 排出確率に基づく抽選ではありません。
    registered.sort((a, b) =>
      RARITIES.indexOf(a.rarity) -
      RARITIES.indexOf(b.rarity)
    );

    if (count === 1) {
      return [registered[registered.length - 1]];
    }

    // レアリティが偏っていても
    // 登録カードを最大10枚表示する。
    const result = [];

    for (let i = 0; i < count; i++) {
      result.push(
        registered[i % registered.length]
      );
    }

    return result;
  } catch (error) {
    console.warn("Preview card load:", error);
    return DEMO_CARDS.slice(0, count);
  }
}

// ------------------------------------------
// カードの見た目
// ------------------------------------------

function makeCardFace(card, compact = false) {
  const rarity = rarityOf(card);

  const article = element(
    "article",
    compact
      ? `summon-result-item summon-rarity-${rarity}`
      : `summon-reveal-card summon-rarity-${rarity}`
  );

  const imageUrl = safeImageUrl(card.imagePath);

  if (imageUrl) {
    const image = element("img");
    image.src = imageUrl;
    image.alt = card.name || "カード";
    image.loading = "eager";

    image.addEventListener("error", () => {
      image.replaceWith(
        element("div", "placeholder-art", "✦")
      );
    }, { once: true });

    article.append(image);
  } else {
    article.append(
      element("div", "placeholder-art", "✦")
    );
  }

  article.append(
    element("strong", "", card.name || "CARD"),
    element("small", "", rarity)
  );

  return article;
}

function makeFlipCard(card, onReveal) {
  const rarity = rarityOf(card);

  const button = element(
    "button",
    `summon-flip-card summon-rarity-${rarity}`
  );

  button.type = "button";
  button.setAttribute(
    "aria-label",
    "カードをめくって公開"
  );

  const inner = element("span", "summon-flip-inner");

  const back = element("span", "summon-flip-back");
  back.append(
    element("span", "summon-back-symbol", "✦"),
    element("span", "summon-back-label", "RASH MASTERS")
  );

  const front = element("span", "summon-flip-front");
  front.append(makeCardFace(card));

  inner.append(back, front);
  button.append(inner);

  button.addEventListener("click", () => {
    if (revealed || !active) return;

    revealed = true;
    button.classList.add("is-flipped");
    button.disabled = true;

    // 公開直後に音とレアリティ演出を発動
    playCardReveal(rarity);
    onReveal(rarity);
  });

  return button;
}

// ------------------------------------------
// 演出画面
// ------------------------------------------

function clearStage() {
  clearTimer();
  stage.replaceChildren();
}

function makeTopline() {
  const top = element("div", "summon-topline");

  const label = element(
    "span",
    "summon-mode",
    "RASH MASTERS / PREVIEW"
  );

  skipButton.hidden = false;
  top.append(label, skipButton);
  stage.append(top);
}

function showCircle() {
  if (!active) return;

  phase = "circle";
  clearStage();
  makeTopline();

  // 10連では最高レアリティに合わせて魔法陣を変える
  const highest = cards.reduce((best, card) => {
    return RARITIES.indexOf(rarityOf(card)) >
      RARITIES.indexOf(best)
      ? rarityOf(card)
      : best;
  }, "N");

  const circle = element(
    "div",
    `summon-circle summon-circle-${highest}`
  );

  circle.append(
    element("div", "summon-symbol", "✦")
  );

  stage.append(
    circle,
    element(
      "h2",
      "summon-stage-title",
      "SUMMONING"
    ),
    element(
      "p",
      "summon-stage-message",
      "運命のカードが、今目覚める..."
    )
  );

  playSummonStart();

  timer = setTimeout(
    () => showReveal(0),
    reduceMotion.matches ? 100 : 1800
  );
}

function showReveal(index) {
  if (!active || !cards[index]) return;

  clearStage();
  phase = "reveal";
  revealed = false;
  makeTopline();

  const card = cards[index];

  const wrap = element(
    "div",
    "summon-reveal summon-flip-scene"
  );

  const heading = element(
    "h2",
    "summon-stage-title",
    "CARD REVEAL"
  );

  const hint = element(
    "p",
    "summon-stage-message",
    "カードをタップして公開！"
  );

  const progress = element(
    "p",
    "summon-progress",
    `${index + 1} / ${cards.length}`
  );

  const next = element(
    "button",
    "summon-next-button",
    index === cards.length - 1
      ? "結果一覧へ"
      : "次のカードへ"
  );

  next.type = "button";
  next.hidden = true;

  const flash = element("div", "summon-flash");
  flash.setAttribute("aria-hidden", "true");

  const flipCard = makeFlipCard(card, rarity => {
    hint.textContent =
      rarity === "UR"
        ? "LEGENDARY! URカード登場！"
        : rarity === "SSR"
          ? "SUPER RARE! SSRカード登場！"
          : `${rarity}カードが現れた！`;

    heading.textContent =
      rarity === "UR"
        ? "LEGENDARY!"
        : rarity === "SSR"
          ? "SUPER RARE!"
          : "CARD REVEALED";

    wrap.classList.add(
      `summon-revealed-${rarity}`
    );

    if (!reduceMotion.matches &&
        (rarity === "UR" || rarity === "SSR")) {
      flash.classList.remove("flash-active");
      void flash.offsetWidth;
      flash.classList.add("flash-active");
    }

    next.hidden = false;
    next.focus();
  });

  next.addEventListener("click", () => {
    if (!revealed) return;

    if (index === cards.length - 1) {
      showSummary();
    } else {
      showReveal(index + 1);
    }
  });

  wrap.append(
    heading,
    hint,
    flipCard,
    progress,
    next,
    flash
  );

  stage.append(wrap);
  flipCard.focus();
}

function showSummary() {
  if (!active) return;

  clearStage();
  phase = "summary";
  makeTopline();

  const highest = cards.reduce((best, card) => {
    return RARITIES.indexOf(rarityOf(card)) >
      RARITIES.indexOf(best)
      ? rarityOf(card)
      : best;
  }, "N");

  const heading = element(
    "h2",
    `summon-stage-title summon-summary-${highest}`,
    cards.length === 10
      ? "10 SUMMON RESULTS"
      : "SUMMON RESULT"
  );

  const message = element(
    "p",
    "summon-stage-message",
    "演出プレビュー / コイン消費・カード付与なし"
  );

  const grid = element(
    "div",
    `summon-result-grid summon-result-${highest}`
  );

  cards.forEach((card, index) => {
    const item = makeCardFace(card, true);
    item.style.setProperty(
      "--card-order",
      String(index)
    );
    grid.append(item);
  });

  const close = element(
    "button",
    "summon-next-button",
    "プレビューを終了"
  );

  close.type = "button";
  close.addEventListener("click", closePreview);

  stage.append(heading, message, grid, close);

  playSummarySound();
  close.focus();
}

// ------------------------------------------
// 開始・終了・スキップ
// ------------------------------------------

function closePreview() {
  clearTimer();

  active = false;
  phase = "idle";
  revealed = false;
  cards = [];

  skipButton.hidden = true;
  overlay.hidden = true;
  stage.replaceChildren();

  document.body.style.overflow = previousOverflow;

  previewSingle.disabled = false;
  previewTen.disabled = false;

  if (previousFocus?.isConnected) {
    previousFocus.focus();
  }

  previousFocus = null;
}

function skipPreview() {
  if (!active) return;

  if (phase === "summary") {
    closePreview();
  } else {
    showSummary();
  }
}

async function startPreview(count) {
  if (
    active ||
    loading ||
    (count !== 1 && count !== 10)
  ) {
    return;
  }

  loading = true;
  previewSingle.disabled = true;
  previewTen.disabled = true;

  try {
    cards = await loadPreviewCards(count);

    if (!cards.length) {
      throw new Error("カードがありません。");
    }

    previousFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;

    active = true;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    showCircle();
    skipButton.focus();
  } catch (error) {
    console.error("Preview error:", error);
    alert("プレビューを開始できませんでした。");

    previewSingle.disabled = false;
    previewTen.disabled = false;
  } finally {
    loading = false;
  }
}

// ------------------------------------------
// イベント
// ------------------------------------------

previewSingle.addEventListener("click", () => {
  startPreview(1);
});

previewTen.addEventListener("click", () => {
  startPreview(10);
});

skipButton.addEventListener("click", skipPreview);

document.addEventListener("keydown", event => {
  if (!active) return;

  if (event.key === "Escape") {
    event.preventDefault();
    skipPreview();
  }

  if (event.key === "Tab") {
    const focusable = [
      ...overlay.querySelectorAll(
        "button:not([disabled]):not([hidden])"
      )
    ].filter(button =>
      button.getClientRects().length
    );

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (
      event.shiftKey &&
      document.activeElement === first
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === last
    ) {
      event.preventDefault();
      first.focus();
    }
  }
});

overlay.hidden = true;
skipButton.hidden = true;

setupGachaSound();
