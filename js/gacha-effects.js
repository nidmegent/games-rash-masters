
"use strict";

// ========================================
// RASH MASTERS GACHA EFFECTS
// STEP 4-A / PREVIEW ONLY
// ========================================

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

// プレビュー用の固定データ。
// 実際の抽選結果ではありません。
const DEMO_CARDS = [
  { name: "DEMO CARD N", rarity: "N" },
  { name: "DEMO CARD R", rarity: "R" },
  { name: "DEMO CARD SR", rarity: "SR" },
  { name: "DEMO CARD SSR", rarity: "SSR" },
  { name: "DEMO CARD UR", rarity: "UR" },
  { name: "DEMO CARD N", rarity: "N" },
  { name: "DEMO CARD R", rarity: "R" },
  { name: "DEMO CARD SR", rarity: "SR" },
  { name: "DEMO CARD SSR", rarity: "SSR" },
  { name: "DEMO CARD UR", rarity: "UR" }
];

let active = false;
let cards = [];
let currentIndex = 0;
let phase = "idle";
let timer = null;
let previousFocus = null;

function el(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function setPreviewButtons(disabled) {
  previewSingle.disabled = disabled;
  previewTen.disabled = disabled;
}

function clearStage() {
  clearTimer();
  stage.replaceChildren();
}

function makeTopline() {
  const top = el("div", "summon-topline");

  const label = el(
    "span",
    "summon-mode",
    "RASH MASTERS / DEMO"
  );

  top.append(label, skipButton);
  stage.append(top);
}

function makeCard(card, compact = false) {
  const rarity = RARITIES.includes(card.rarity)
    ? card.rarity
    : "N";

  const article = el(
    "article",
    compact
      ? `summon-result-item summon-rarity-${rarity}`
      : `summon-reveal-card`
  );

  const placeholder = el(
    "div",
    "placeholder-art",
    "✦"
  );

  const name = el("strong", "", card.name);
  const badge = el("small", "", rarity);

  article.append(placeholder, name, badge);

  return article;
}

function showCircle() {
  if (!active) return;

  phase = "circle";
  clearStage();
  makeTopline();

  const circle = el("div", "summon-circle");
  const symbol = el("div", "summon-symbol", "✦");

  circle.append(symbol);

  const title = el(
    "h2",
    "summon-stage-title",
    "SUMMONING"
  );

  const message = el(
    "p",
    "summon-stage-message",
    "カードの力を呼び覚ませ..."
  );

  stage.append(circle, title, message);

  timer = setTimeout(
    () => showReveal(0),
    reduceMotion.matches ? 150 : 1700
  );
}

function showReveal(index) {
  if (!active) return;

  clearStage();

  currentIndex = index;
  phase = "reveal";

  makeTopline();

  const card = cards[index];
  const rarity = RARITIES.includes(card.rarity)
    ? card.rarity
    : "N";

  const wrap = el(
    "div",
    `summon-reveal summon-rarity-${rarity}`
  );

  const heading = el(
    "h2",
    "summon-stage-title",
    rarity === "UR"
      ? "LEGENDARY!"
      : rarity === "SSR"
        ? "SUPER RARE!"
        : "CARD REVEAL"
  );

  const cardElement = makeCard(card);

  const rarityText = el(
    "div",
    "summon-rarity",
    rarity
  );

  const progress = el(
    "p",
    "summon-progress",
    `${index + 1} / ${cards.length}`
  );

  const next = el(
    "button",
    "summon-next-button",
    index === cards.length - 1
      ? "結果一覧へ"
      : "次のカードへ"
  );

  next.type = "button";

  next.addEventListener("click", () => {
    if (index === cards.length - 1) {
      showSummary();
    } else {
      showReveal(index + 1);
    }
  });

  wrap.append(
    heading,
    cardElement,
    rarityText,
    progress,
    next
  );

  stage.append(wrap);

  next.focus();
}

function showSummary() {
  if (!active) return;

  clearStage();
  phase = "summary";

  makeTopline();

  const heading = el(
    "h2",
    "summon-stage-title",
    cards.length === 10
      ? "10 SUMMON RESULTS"
      : "SUMMON RESULT"
  );

  const message = el(
    "p",
    "summon-stage-message",
    "演出プレビュー / 実際のカード付与はありません"
  );

  const grid = el(
    "div",
    "summon-result-grid"
  );

  cards.forEach(card => {
    grid.append(makeCard(card, true));
  });

  const close = el(
    "button",
    "summon-next-button",
    "プレビューを終了"
  );

  close.type = "button";
  close.addEventListener("click", closePreview);

  stage.append(heading, message, grid, close);
  close.focus();
}

function closePreview() {
  clearTimer();

  active = false;
  phase = "idle";
  cards = [];
  currentIndex = 0;

  overlay.hidden = true;
  stage.replaceChildren();

  setPreviewButtons(false);

  document.body.style.overflow = "";

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

function startPreview(count) {
  if (active || (count !== 1 && count !== 10)) {
    return;
  }

  // 固定サンプル。確率抽選は行わない。
  cards = count === 1
    ? [{ name: "DEMO CARD UR", rarity: "UR" }]
    : DEMO_CARDS.map(card => ({ ...card }));

  currentIndex = 0;
  active = true;

  previousFocus = document.activeElement;

  overlay.hidden = false;
  document.body.style.overflow = "hidden";

  setPreviewButtons(true);
  showCircle();

  skipButton.focus();
}

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

  // モーダル外へTab移動しないようにする
  if (event.key === "Tab") {
    const focusable = [...overlay.querySelectorAll(
      "button:not([disabled])"
    )].filter(button => button.offsetParent !== null);

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

// ブラウザの状態にかかわらず初期表示は閉じる
overlay.hidden = true;
setPreviewButtons(false);
