
"use strict";

// RASH MASTERS - GACHA EFFECTS STEP 4-B
// VISUAL & SOUND PREVIEW ONLY

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

function element(tag, className = "", value) {
  const node = document.createElement(tag);
  node.className = className;

  if (value !== undefined) {
    node.textContent = value;
  }

  return node;
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

  return new URL(
    `../${path}`,
    import.meta.url
  ).href;
}

async function loadPreviewCards(count) {
  // Firestoreから読み取りのみ行う。
  // ガチャ抽選やカード付与は行わない。
  if (!auth.currentUser) {
    return DEMO_CARDS.slice(0, count);
  }

  try {
    const snapshot = await getDocs(
      collection(db, "cards")
    );

    const registered = snapshot.docs
      .map(item => ({
        cardId: item.id,
        ...item.data()
      }))
      .filter(card =>
        RARITIES.includes(card.rarity) &&
        typeof card.name === "string" &&
        card.name.trim().length > 0
      );

    if (!registered.length) {
      return DEMO_CARDS.slice(0, count);
    }

    // 演出確認用にレアリティ順で並べる。
    // 実際のガチャ排出率は使用しない。
    registered.sort((a, b) =>
      RARITIES.indexOf(a.rarity) -
      RARITIES.indexOf(b.rarity)
    );

    if (count === 1) {
      // UR → SSR → その他の優先順で
      // 演出確認用カードを1枚選ぶ。
      const selected = [...registered].sort(
        (a, b) =>
          RARITIES.indexOf(b.rarity) -
          RARITIES.indexOf(a.rarity)
      );

      return [selected[0]];
    }

    const result = [];

    for (let i = 0; i < count; i++) {
      result.push(
        registered[i % registered.length]
      );
    }

    return result;

  } catch (error) {
    console.warn(
      "Preview cards unavailable:",
      error
    );

    return DEMO_CARDS.slice(0, count);
  }
}

function makeCard(card, compact = false) {
  const rarity = RARITIES.includes(card.rarity)
    ? card.rarity
    : "N";

  const article = element(
    "article",
    compact
      ? `summon-result-item summon-rarity-${rarity}`
      : "summon-reveal-card"
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

  const circle = element("div", "summon-circle");

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
      "魔力が集まり、運命のカードが目覚める..."
    )
  );

  playSummonStart();

  timer = setTimeout(
    () => showReveal(0),
    reduceMotion.matches ? 150 : 1700
  );
}

function showReveal(index) {
  if (!active || !cards[index]) return;

  clearStage();
  phase = "reveal";
  makeTopline();

  const card = cards[index];
  const rarity = RARITIES.includes(card.rarity)
    ? card.rarity
    : "N";

  const wrap = element(
    "div",
    `summon-reveal summon-rarity-${rarity}`
  );

  const heading = element(
    "h2",
    "summon-stage-title",
    rarity === "UR"
      ? "LEGENDARY!"
      : rarity === "SSR"
        ? "SUPER RARE!"
        : "CARD REVEAL"
  );

  const rarityText = element(
    "div",
    "summon-rarity",
    rarity
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

  next.addEventListener("click", () => {
    if (index === cards.length - 1) {
      showSummary();
    } else {
      showReveal(index + 1);
    }
  });

  wrap.append(
    heading,
    makeCard(card),
    rarityText,
    progress,
    next
  );

  stage.append(wrap);

  playCardReveal(rarity);
  next.focus();
}

function showSummary() {
  if (!active) return;

  clearStage();
  phase = "summary";
  makeTopline();

  const heading = element(
    "h2",
    "summon-stage-title",
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
    "summon-result-grid"
  );

  cards.forEach(card => {
    grid.append(makeCard(card, true));
  });

  const close = element(
    "button",
    "summon-next-button",
    "プレビューを終了"
  );

  close.type = "button";
  close.addEventListener("click", closePreview);

  stage.append(
    heading,
    message,
    grid,
    close
  );

  playSummarySound();
  close.focus();
}

function closePreview() {
  clearTimer();

  active = false;
  phase = "idle";
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
      throw new Error("プレビューカードがありません。");
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
    alert("演出プレビューを開始できませんでした。");
    previewSingle.disabled = false;
    previewTen.disabled = false;

  } finally {
    loading = false;
  }
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

  if (event.key === "Tab") {
    const focusable = [
      ...overlay.querySelectorAll(
        "button:not([disabled]):not([hidden])"
      )
    ].filter(button => button.getClientRects().length);

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
