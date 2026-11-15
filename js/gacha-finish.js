
"use strict";

// ==========================================
// RASH MASTERS - STEP 4-D
// GACHA VISUAL FINISH
// Preview only / No Firestore writes
// ==========================================

const overlay = document.getElementById("summonOverlay");
const stage = document.getElementById("summonStage");

const RARITY_ORDER = ["N", "R", "SR", "SSR", "UR"];

const RARITY_TITLES = {
  SSR: {
    title: "SUPER RARE",
    subtitle: "黄金の輝きを放つカードが降臨！"
  },
  UR: {
    title: "ULTRA RARE",
    subtitle: "伝説の輝きが、今ここに！"
  }
};

let lastReveal = null;
let lastSummary = null;
let particleTimer = null;

function create(tag, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function clearParticles() {
  if (particleTimer !== null) {
    clearTimeout(particleTimer);
    particleTimer = null;
  }

  stage?.querySelectorAll(".finish-particles")
    .forEach(node => node.remove());
}

function makeParticles(rarity) {
  if (!stage) return;

  clearParticles();

  if (window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches) {
    return;
  }

  const layer = create("div", "finish-particles");
  layer.setAttribute("aria-hidden", "true");

  const count = rarity === "UR" ? 34 : 22;

  for (let i = 0; i < count; i++) {
    const particle = create(
      "span",
      `finish-particle finish-particle-${rarity}`
    );

    // パーティクルの位置・動きだけをランダム化
    particle.style.setProperty(
      "--x",
      `${Math.random() * 100}%`
    );

    particle.style.setProperty(
      "--y",
      `${Math.random() * 100}%`
    );

    particle.style.setProperty(
      "--dx",
      `${(Math.random() - 0.5) * 160}px`
    );

    particle.style.setProperty(
      "--dy",
      `${-40 - Math.random() * 170}px`
    );

    particle.style.setProperty(
      "--delay",
      `${Math.random() * 0.65}s`
    );

    particle.style.setProperty(
      "--duration",
      `${1.2 + Math.random() * 1.2}s`
    );

    layer.append(particle);
  }

  stage.append(layer);

  particleTimer = setTimeout(() => {
    layer.remove();
    particleTimer = null;
  }, 3400);
}

function enhanceReveal(reveal) {
  if (lastReveal === reveal) return;
  lastReveal = reveal;

  const rarity = reveal.classList.contains(
    "summon-revealed-UR"
  )
    ? "UR"
    : reveal.classList.contains(
        "summon-revealed-SSR"
      )
      ? "SSR"
      : null;

  if (!rarity) return;

  if (reveal.querySelector(".finish-rarity-banner")) {
    return;
  }

  const config = RARITY_TITLES[rarity];

  const banner = create(
    "div",
    `finish-rarity-banner finish-banner-${rarity}`
  );

  const title = create(
    "strong",
    "finish-rarity-title",
    config.title
  );

  const subtitle = create(
    "span",
    "finish-rarity-subtitle",
    config.subtitle
  );

  banner.append(title, subtitle);

  const heading = reveal.querySelector(
    ".summon-stage-title"
  );

  if (heading) {
    heading.insertAdjacentElement("afterend", banner);
  } else {
    reveal.prepend(banner);
  }

  makeParticles(rarity);
}

function rarityFromCard(item) {
  for (const rarity of [...RARITY_ORDER].reverse()) {
    if (item.classList.contains(
      `summon-rarity-${rarity}`
    )) {
      return rarity;
    }
  }

  return "N";
}

function enhanceSummary(grid) {
  if (lastSummary === grid) return;
  lastSummary = grid;

  if (stage.querySelector(".finish-summary-info")) {
    return;
  }

  const items = [
    ...grid.querySelectorAll(".summon-result-item")
  ];

  if (!items.length) return;

  const counts = {
    N: 0,
    R: 0,
    SR: 0,
    SSR: 0,
    UR: 0
  };

  items.forEach(item => {
    const rarity = rarityFromCard(item);
    counts[rarity]++;
  });

  const highest = [...RARITY_ORDER]
    .reverse()
    .find(rarity => counts[rarity] > 0) || "N";

  const info = create(
    "div",
    `finish-summary-info finish-summary-${highest}`
  );

  const heading = create(
    "div",
    "finish-summary-heading"
  );

  heading.append(
    create(
      "span",
      "finish-summary-label",
      "HIGHEST RARITY"
    ),
    create(
      "strong",
      "finish-summary-highest",
      highest
    )
  );

  const stats = create(
    "div",
    "finish-summary-stats"
  );

  const urStat = create(
    "div",
    "finish-stat finish-stat-UR"
  );

  urStat.append(
    create("span", "", "UR"),
    create("strong", "", `${counts.UR}枚`)
  );

  const ssrStat = create(
    "div",
    "finish-stat finish-stat-SSR"
  );

  ssrStat.append(
    create("span", "", "SSR"),
    create("strong", "", `${counts.SSR}枚`)
  );

  const totalStat = create(
    "div",
    "finish-stat"
  );

  totalStat.append(
    create("span", "", "TOTAL"),
    create("strong", "", `${items.length}枚`)
  );

  stats.append(urStat, ssrStat, totalStat);
  info.append(heading, stats);

  grid.insertAdjacentElement("beforebegin", info);

  // レアカードを視覚的に強調
  items.forEach(item => {
    const rarity = rarityFromCard(item);

    if (rarity === "UR" || rarity === "SSR") {
      const badge = create(
        "span",
        `finish-card-badge finish-card-badge-${rarity}`,
        rarity === "UR" ? "LEGENDARY" : "SUPER RARE"
      );

      item.append(badge);
      item.classList.add("finish-special-card");
    }
  });
}

function inspectStage() {
  if (!overlay || !stage || overlay.hidden) {
    lastReveal = null;
    lastSummary = null;
    clearParticles();
    return;
  }

  const reveal = stage.querySelector(
    ".summon-revealed-UR, .summon-revealed-SSR"
  );

  if (reveal) {
    enhanceReveal(reveal);
  }

  const grid = stage.querySelector(
    ".summon-result-grid"
  );

  if (grid) {
    enhanceSummary(grid);
  }
}

// 既存のSTEP 4-Cコードを変更せず、
// DOMの変化を監視して装飾を追加する。
if (overlay && stage) {
  const observer = new MutationObserver(inspectStage);

  observer.observe(stage, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  observer.observe(overlay, {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  inspectStage();
}
