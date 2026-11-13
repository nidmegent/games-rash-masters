
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ========================================
// RASH MASTERS - ARENA VER.2.1
// ========================================

const $ = id => document.getElementById(id);

const RULES = {
  deckSize: 10,
  maxCopies: 3,
  initialHand: 5,
  maxHp: 3000,
  maxMana: 10,
  maxHand: 7,
  maxField: 3,
  maxSummons: 2,
  maxAttacks: 1,
  turnSeconds: 120
};

let game = null;
let timerId = null;
let selectedAttacker = null;
let busy = false;
let autoEnding = false;
let unitSerial = 0;
let turnToken = 0;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function numeric(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cardCost(card) {
  return Math.min(RULES.maxMana, Math.floor(numeric(
    card.cost ?? card.manaCost ?? card.mana, 1
  )));
}

function cardAttack(card) {
  return Math.floor(numeric(
    card.atk ?? card.attack ?? card.ATK, 500
  ));
}

function cardHp(card) {
  return Math.max(1, Math.floor(numeric(
    card.hp ?? card.health ?? card.HP, 1000
  )));
}

function cardName(card) {
  return String(card.name || "名称未設定カード");
}

function imageUrl(path) {
  if (typeof path !== "string") return "";
  const clean = path.replace(/^\/+/, "");

  if (!/^assets\/cards\/(N|R|SR|SSR|UR)\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(clean)) {
    return "";
  }

  return new URL("../" + clean, import.meta.url).href;
}

function shuffle(cards) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makeUnit(card) {
  return {
    ...card,
    instanceId: `unit-${++unitSerial}`,
    currentHp: cardHp(card),
    maxHp: cardHp(card),
    attackValue: cardAttack(card),
    attacked: false,
    summonedThisTurn: true
  };
}

function setMessage(text) {
  $("battleMessage").textContent = text;
}

// ========================================
// LOG
// ========================================

function addLog(text, type = "normal") {
  if (!game) return;
  game.logs.unshift({ text, type });
  game.logs = game.logs.slice(0, 60);
  renderLog();
}

function renderLog() {
  const container = $("battleLog");
  container.replaceChildren();
  if (!game) return;

  for (const item of game.logs) {
    const div = document.createElement("div");
    div.className = `log-entry ${item.type}`;
    div.textContent = item.text;
    container.append(div);
  }
}

// ========================================
// EFFECTS
// ========================================

function elementCenter(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function floatingDamage(element, amount) {
  const point = elementCenter(element);
  if (!point) return;

  const label = document.createElement("div");
  label.className = "float-damage";
  label.textContent = `-${amount}`;
  label.style.left = `${point.x}px`;
  label.style.top = `${point.y}px`;

  $("effectLayer").append(label);
  setTimeout(() => label.remove(), 900);
}

function impactEffect(element) {
  const point = elementCenter(element);
  if (!point) return;

  const ring = document.createElement("div");
  ring.className = "impact-ring";
  ring.style.left = `${point.x}px`;
  ring.style.top = `${point.y}px`;

  $("effectLayer").append(ring);

  element.classList.remove("attack-flash");
  void element.offsetWidth;
  element.classList.add("attack-flash");

  setTimeout(() => {
    ring.remove();
    element.classList.remove("attack-flash");
  }, 600);
}

function summonEffect(element) {
  if (!element) return;

  const ring = document.createElement("div");
  ring.className = "summon-ring";
  element.append(ring);

  setTimeout(() => ring.remove(), 700);
}

function screenShake() {
  const element = $("battleColumn");
  element.classList.remove("screen-shake");
  void element.offsetWidth;
  element.classList.add("screen-shake");

  setTimeout(() => {
    element.classList.remove("screen-shake");
  }, 400);
}

function findSlot(side, instanceId) {
  return [...document.querySelectorAll(
    `[data-side="${side}"][data-unit-id]`
  )].find(el => el.dataset.unitId === instanceId) || null;
}

// ========================================
// DECK
// ========================================

function expandSavedDeck(deck, cardMap) {
  if (!deck || !Array.isArray(deck.cards)) {
    throw new Error("デッキ情報がありません。");
  }

  const counts = new Map();
  const expanded = [];

  for (const entry of deck.cards) {
    if (
      !entry ||
      typeof entry.cardId !== "string" ||
      !Number.isSafeInteger(Number(entry.quantity)) ||
      Number(entry.quantity) < 1
    ) {
      throw new Error("デッキのカード情報が不正です。");
    }

    const card = cardMap.get(entry.cardId);
    if (!card) {
      throw new Error("存在しないカードが含まれています。");
    }

    const quantity = Number(entry.quantity);
    const total = (counts.get(entry.cardId) || 0) + quantity;

    if (total > RULES.maxCopies) {
      throw new Error("同じカードは最大3枚までです。");
    }

    counts.set(entry.cardId, total);

    for (let i = 0; i < quantity; i++) {
      expanded.push({ ...card });
    }
  }

  if (
    expanded.length !== RULES.deckSize ||
    Number(deck.totalCards) !== RULES.deckSize
  ) {
    throw new Error("10枚デッキが必要です。");
  }

  return expanded;
}

// ========================================
// DRAW / SUMMON
// ========================================

function drawCards(side, amount = 1) {
  const fighter = game[side];
  const label = side === "player" ? "あなた" : "CPU";

  for (let i = 0; i < amount; i++) {
    if (!fighter.deck.length) {
      addLog(`${label}はデッキ切れでドローできません。`);
      break;
    }

    const card = fighter.deck.shift();

    if (fighter.hand.length >= RULES.maxHand) {
      addLog(
        `${label}は手札上限のため「${cardName(card)}」を破棄しました。`,
        "destroy"
      );
      continue;
    }

    fighter.hand.push(card);

    addLog(
      side === "player"
        ? `「${cardName(card)}」をドロー！`
        : "CPUがカードを1枚ドローしました。"
    );
  }
}

function canSummon(side, index) {
  if (!game || game.finished) return false;

  const fighter = game[side];
  const card = fighter.hand[index];
  if (!card) return false;

  return (
    game.active === side &&
    game.phase === "MAIN" &&
    fighter.field.length < RULES.maxField &&
    fighter.summons < RULES.maxSummons &&
    fighter.mana >= cardCost(card)
  );
}

function summon(side, index) {
  if (!canSummon(side, index)) return false;

  const fighter = game[side];
  const card = fighter.hand[index];
  const cost = cardCost(card);

  fighter.mana -= cost;
  fighter.summons++;
  fighter.hand.splice(index, 1);

  const unit = makeUnit(card);
  fighter.field.push(unit);

  addLog(
    `${side === "player" ? "あなた" : "CPU"}が「${cardName(card)}」を召喚！マナ-${cost}`,
    "summon"
  );

  render();
  summonEffect(findSlot(side, unit.instanceId));
  return true;
}

// ========================================
// ATTACK - ONE ATTACK PER TURN
// ========================================

function canAttack(side, unit) {
  if (!game || game.finished || !unit) return false;

  return (
    game.active === side &&
    game.phase === "BATTLE" &&
    game[side].attacksUsed < RULES.maxAttacks &&
    !unit.attacked &&
    !unit.summonedThisTurn &&
    unit.currentHp > 0
  );
}

function availableAttackers(side) {
  return game[side].field.filter(unit => canAttack(side, unit));
}

function applyHeroDamage(side, amount) {
  if (game.finished) return;

  const damage = Math.max(0, amount);
  game[side].hp = Math.max(0, game[side].hp - damage);

  addLog(
    `${side === "player" ? "あなた" : "CPU"}に${damage}ダメージ！残りHP：${game[side].hp}`,
    "damage"
  );

  if (game[side].hp === 0) {
    finish(side === "enemy" ? "VICTORY" : "DEFEAT");
  }
}

async function attackUnit(attackerSide, attackerId, defenderId) {
  if (!game || game.finished) return false;

  const defenderSide =
    attackerSide === "player" ? "enemy" : "player";

  const attacker = game[attackerSide].field.find(
    u => u.instanceId === attackerId
  );

  const defender = game[defenderSide].field.find(
    u => u.instanceId === defenderId
  );

  if (!attacker || !defender || !canAttack(attackerSide, attacker)) {
    return false;
  }

  // 全体の攻撃権をここで消費
  game[attackerSide].attacksUsed++;
  attacker.attacked = true;

  const damage = attacker.attackValue;

  // 攻撃側は反撃ダメージを受けない
  defender.currentHp = Math.max(0, defender.currentHp - damage);

  addLog(
    `「${cardName(attacker)}」が「${cardName(defender)}」を攻撃！`,
    "damage"
  );

  addLog(
    `「${cardName(defender)}」に${damage}ダメージ。残りHP：${defender.currentHp}/${defender.maxHp}`,
    "damage"
  );

  render();

  const target = findSlot(defenderSide, defenderId);
  impactEffect(target);
  floatingDamage(target, damage);
  screenShake();

  await sleep(450);

  if (defender.currentHp <= 0) {
    addLog(
      `「${cardName(defender)}」は「${cardName(attacker)}」の攻撃でHPが0になり、破壊されました。`,
      "destroy"
    );

    const element = findSlot(defenderSide, defenderId);
    if (element) element.classList.add("destroy-animation");

    await sleep(550);

    const index = game[defenderSide].field.findIndex(
      u => u.instanceId === defenderId
    );

    if (index !== -1) game[defenderSide].field.splice(index, 1);
  }

  render();
  return true;
}

async function attackHero(attackerSide, attackerId) {
  if (!game || game.finished) return false;

  const defenderSide =
    attackerSide === "player" ? "enemy" : "player";

  const attacker = game[attackerSide].field.find(
    u => u.instanceId === attackerId
  );

  if (!attacker || !canAttack(attackerSide, attacker)) {
    return false;
  }

  if (game[defenderSide].field.length > 0) return false;

  // 直接攻撃でも全体の攻撃権を消費
  game[attackerSide].attacksUsed++;
  attacker.attacked = true;

  addLog(
    `「${cardName(attacker)}」が${defenderSide === "enemy" ? "CPU" : "あなた"}に直接攻撃！`,
    "damage"
  );

  const hero = document.querySelector(
    defenderSide === "enemy" ? ".fighter.enemy" : ".fighter.player"
  );

  impactEffect(hero);
  floatingDamage(hero, attacker.attackValue);
  screenShake();

  applyHeroDamage(defenderSide, attacker.attackValue);
  render();

  await sleep(500);
  return true;
}

// ========================================
// TURN MANAGEMENT
// ========================================

function startTurn(side) {
  if (!game || game.finished) return;

  turnToken++;
  game.active = side;
  game.phase = "MAIN";
  game.seconds = RULES.turnSeconds;

  selectedAttacker = null;
  autoEnding = false;

  const fighter = game[side];

  if (fighter.turnsPlayed > 0) {
    fighter.maxMana = Math.min(
      RULES.maxMana, fighter.maxMana + 1
    );
  }

  fighter.turnsPlayed++;
  fighter.mana = fighter.maxMana;
  fighter.summons = 0;

  // 毎ターン、全体攻撃権を1回にリセット
  fighter.attacksUsed = 0;

  for (const unit of fighter.field) {
    unit.attacked = false;
    unit.summonedThisTurn = false;
  }

  if (fighter.turnsPlayed > 1) drawCards(side);

  addLog(
    `━━ ${side === "player" ? "あなた" : "CPU"}のターン開始 ━━`,
    "summon"
  );

  setMessage(
    side === "player"
      ? "カードを召喚して、攻撃フェーズへ進もう！"
      : "CPUが行動しています..."
  );

  render();
}

function beginBattlePhase() {
  if (
    !game || game.finished || busy ||
    game.active !== "player" ||
    game.phase !== "MAIN"
  ) return;

  game.phase = "BATTLE";
  selectedAttacker = null;

  addLog("あなたの攻撃フェーズ開始");
  render();

  if (!availableAttackers("player").length) {
    setMessage("攻撃可能なモンスターがいないため、自動でターン終了します。");
    scheduleAutoEnd();
  } else {
    setMessage("攻撃するモンスターを1体選んでください！");
  }
}

function scheduleAutoEnd() {
  if (
    !game || game.finished ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    autoEnding || busy
  ) return;

  if (availableAttackers("player").length > 0) return;

  autoEnding = true;
  const token = turnToken;

  setMessage("攻撃終了！自動でCPUのターンへ移行します...");

  setTimeout(() => {
    if (
      game && !game.finished &&
      game.active === "player" &&
      game.phase === "BATTLE" &&
      turnToken === token &&
      !busy
    ) {
      endPlayerTurn();
    }
  }, 900);
}

async function endPlayerTurn() {
  if (
    !game || game.finished || busy ||
    game.active !== "player"
  ) return;

  busy = true;
  autoEnding = false;
  selectedAttacker = null;

  addLog("あなたのターン終了");

  startTurn("enemy");
  await sleep(650);
  await cpuTurn();
}

async function cpuTurn() {
  if (!game || game.finished) {
    busy = false;
    return;
  }

  // CPUも1ターン最大2体召喚
  for (let i = 0; i < RULES.maxSummons; i++) {
    if (game.finished) break;

    const index = game.enemy.hand.findIndex(
      card => cardCost(card) <= game.enemy.mana
    );

    if (index < 0 || !summon("enemy", index)) break;
    await sleep(500);
  }

  if (game.finished) {
    busy = false;
    return;
  }

  game.phase = "BATTLE";
  addLog("CPUの攻撃フェーズ開始");
  render();

  await sleep(450);

  // CPUも場全体で1回だけ攻撃
  const attacker = game.enemy.field.find(
    unit => canAttack("enemy", unit)
  );

  if (attacker) {
    if (game.player.field.length > 0) {
      await attackUnit(
        "enemy",
        attacker.instanceId,
        game.player.field[0].instanceId
      );
    } else {
      await attackHero("enemy", attacker.instanceId);
    }
  } else {
    addLog("CPUには攻撃可能なモンスターがいません。");
  }

  if (!game.finished) {
    addLog("CPUのターン終了");
    game.turn++;
    busy = false;
    startTurn("player");
  } else {
    busy = false;
  }

  render();
}

async function handlePlayerAttack(targetId = null) {
  if (
    !game || game.finished || busy ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    !selectedAttacker
  ) return;

  const attackerId = selectedAttacker;
  selectedAttacker = null;
  busy = true;

  let success = false;

  try {
    if (targetId) {
      success = await attackUnit(
        "player", attackerId, targetId
      );
    } else if (game.enemy.field.length === 0) {
      success = await attackHero("player", attackerId);
    }
  } finally {
    busy = false;
  }

  if (success) {
    scheduleAutoEnd();
  } else {
    setMessage("攻撃できませんでした。対象を確認してください。");
  }

  render();
}

// ========================================
// RENDER
// ========================================

function createCardImage(card) {
  const img = document.createElement("img");
  const src = imageUrl(card.imagePath);

  if (src) img.src = src;
  img.alt = cardName(card);
  img.onerror = () => img.remove();

  return img;
}

function renderSlots(side) {
  const container = $(
    side === "player" ? "playerSlots" : "enemySlots"
  );

  container.replaceChildren();

  for (let i = 0; i < RULES.maxField; i++) {
    const unit = game[side].field[i];
    const slot = document.createElement("div");
    slot.className = "slot";

    if (!unit) {
      slot.classList.add("empty");
      container.append(slot);
      continue;
    }

    slot.dataset.side = side;
    slot.dataset.unitId = unit.instanceId;

    if (unit.attacked || unit.summonedThisTurn) {
      slot.classList.add("exhausted");
    }

    if (
      side === "player" &&
      canAttack("player", unit) &&
      !busy
    ) {
      slot.classList.add("can-attack");
    }

    if (
      side === "player" &&
      selectedAttacker === unit.instanceId
    ) {
      slot.classList.add("selected");
    }

    if (
      side === "enemy" &&
      selectedAttacker &&
      !busy
    ) {
      slot.classList.add("targetable");
    }

    const box = document.createElement("div");
    box.className = "field-card";
    box.append(createCardImage(unit));

    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = cardName(unit);

    const stats = document.createElement("div");
    stats.className = "stats";

    const atk = document.createElement("span");
    atk.textContent = `⚔${unit.attackValue}`;

    const hp = document.createElement("span");
    hp.textContent = `♥${unit.currentHp}`;

    stats.append(atk, hp);
    box.append(name, stats);
    slot.append(box);

    if (side === "player") {
      slot.addEventListener("click", () => {
        if (busy || game.finished) return;

        if (!canAttack("player", unit)) {
          setMessage(
            "攻撃できません。召喚ターン中・攻撃済み・攻撃権使用済みのいずれかです。"
          );
          return;
        }

        selectedAttacker =
          selectedAttacker === unit.instanceId
            ? null
            : unit.instanceId;

        setMessage(
          selectedAttacker
            ? "攻撃対象を選択！相手の場が空なら敵フィールドをタップ。"
            : "攻撃選択を解除しました。"
        );

        render();
      });
    } else {
      slot.addEventListener("click", () => {
        if (!selectedAttacker || busy) return;
        handlePlayerAttack(unit.instanceId);
      });
    }

    container.append(slot);
  }
}

function renderHand() {
  const container = $("playerHand");
  container.replaceChildren();

  game.player.hand.forEach((card, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hand-card";

    button.append(createCardImage(card));

    const name = document.createElement("strong");
    name.textContent = cardName(card);

    const cost = document.createElement("small");
    cost.textContent =
      `MANA ${cardCost(card)} / ATK ${cardAttack(card)}`;

    button.append(name, cost);

    button.disabled =
      game.finished || busy ||
      game.active !== "player" ||
      game.phase !== "MAIN" ||
      !canSummon("player", index);

    button.addEventListener("click", () => {
      if (
        !game || game.finished || busy ||
        game.active !== "player" ||
        game.phase !== "MAIN"
      ) return;

      if (summon("player", index)) {
        setMessage(`「${cardName(card)}」を召喚しました！`);
      }
    });

    container.append(button);
  });
}

function render() {
  if (!game) return;

  $("playerHp").textContent =
    game.player.hp.toLocaleString("ja-JP");

  $("enemyHp").textContent =
    game.enemy.hp.toLocaleString("ja-JP");

  $("playerHpBar").style.width =
    `${game.player.hp / RULES.maxHp * 100}%`;

  $("enemyHpBar").style.width =
    `${game.enemy.hp / RULES.maxHp * 100}%`;

  $("playerMana").textContent = game.player.mana;
  $("playerMaxMana").textContent = game.player.maxMana;
  $("enemyMana").textContent = game.enemy.mana;

  $("playerDeckCount").textContent =
    game.player.deck.length;

  $("enemyDeckCount").textContent =
    game.enemy.deck.length;

  $("enemyHandCount").textContent =
    game.enemy.hand.length;

  $("handCount").textContent =
    `${game.player.hand.length} / ${RULES.maxHand}`;

  $("summonCount").textContent =
    game.player.summons;

  $("turnNumber").textContent = game.turn;
  $("phaseName").textContent = game.phase;

  $("activePlayer").textContent =
    game.active === "player" ? "YOU" : "CPU";

  $("turnTimer").textContent = game.seconds;

  $("attackButton").disabled =
    game.finished || busy ||
    game.active !== "player" ||
    game.phase !== "MAIN";

  $("endTurnButton").disabled =
    game.finished || busy || autoEnding ||
    game.active !== "player";

  $("surrenderButton").disabled =
  game.finished;

  renderSlots("enemy");
  renderSlots("player");
  renderHand();
}

// ========================================
// BUTTONS
// ========================================

$("attackButton").addEventListener(
  "click", beginBattlePhase
);

$("endTurnButton").addEventListener(
  "click", () => endPlayerTurn()
);

$("enemySlots").addEventListener("click", () => {
  if (
    !game || game.finished || busy ||
    !selectedAttacker ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    game.enemy.field.length !== 0
  ) return;

  handlePlayerAttack();
});


// ========================================
// SURRENDER SYSTEM - VER.2.2
// ========================================

let surrenderOpen = false;

function closeSurrender() {
  surrenderOpen = false;
  $("surrenderOverlay").classList.add("hidden");
}

$("surrenderButton").addEventListener("click", () => {
  if (!game || game.finished || surrenderOpen) return;

  surrenderOpen = true;
  $("surrenderOverlay").classList.remove("hidden");
  $("cancelSurrender").focus();
});

$("cancelSurrender").addEventListener("click", () => {
  closeSurrender();
});

$("confirmSurrender").addEventListener("click", () => {
  if (!surrenderOpen || !game || game.finished) return;

  closeSurrender();

  addLog(
    "あなたは降参しました。バトルは敗北となります。",
    "destroy"
  );

  finish("SURRENDER");
});

// Escapeキーでキャンセル
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && surrenderOpen) {
    closeSurrender();
  }
});


// ========================================
// RESULT
// ========================================


function finish(result) {
  if (!game || game.finished) return;

  game.finished = true;
  busy = false;
  autoEnding = false;
  selectedAttacker = null;

  clearInterval(timerId);
  closeSurrender();

  const surrendered = result === "SURRENDER";
  const victory = result === "VICTORY";

  if (!surrendered) {
    addLog(
      victory
        ? "あなたの勝利！CPUのHPが0になりました。"
        : "あなたの敗北。プレイヤーHPが0になりました。",
      "destroy"
    );
  }

  $("resultTitle").textContent =
    victory ? "VICTORY" : "DEFEAT";

  $("resultDescription").textContent =
    surrendered
      ? "降参により敗北しました。"
      : victory
        ? "CPUとの戦いに勝利しました！"
        : "CPUとの戦いに敗北しました。";

  $("resultOverlay").classList.remove("hidden");

  render();
}


// ========================================
// TIMER
// ========================================

function startTimer() {
  clearInterval(timerId);

  timerId = setInterval(() => {
    if (
      !game || game.finished || busy ||
      autoEnding || game.active !== "player"
    ) return;

    game.seconds = Math.max(0, game.seconds - 1);
    $("turnTimer").textContent = game.seconds;

    if (game.seconds === 0) {
      addLog("制限時間120秒が経過したためターン終了。");
      endPlayerTurn();
    }
  }, 1000);
}

// ========================================
// INITIALIZE
// ========================================

async function initialize(user) {
  const raw = sessionStorage.getItem(
    "rashMastersBattlePreparation"
  );

  if (!raw) {
    throw new Error(
      "対戦準備がありません。battle.htmlから開始してください。"
    );
  }

  let preparation;

  try {
    preparation = JSON.parse(raw);
  } catch {
    throw new Error("対戦準備データが不正です。");
  }

  if (
    !preparation ||
    typeof preparation.deckId !== "string" ||
    !preparation.deckId
  ) {
    throw new Error("使用デッキが選択されていません。");
  }

  if (preparation.mode !== "casual") {
    throw new Error(
      "CPU試作版はカジュアル対戦のみ対応しています。"
    );
  }

  const [deckSnapshot, cardsSnapshot] =
    await Promise.all([
      getDoc(doc(
        db, "users", user.uid,
        "decks", preparation.deckId
      )),
      getDocs(collection(db, "cards"))
    ]);

  if (!deckSnapshot.exists()) {
    throw new Error("保存済みデッキが見つかりません。");
  }

  const cardMap = new Map(
    cardsSnapshot.docs.map(item => [
      item.id,
      { ...item.data(), id: item.id }
    ])
  );

  const playerCards = expandSavedDeck(
    deckSnapshot.data(), cardMap
  );

  const enemyCards = playerCards.map(
    card => ({ ...card })
  );

  game = {
    turn: 1,
    active: "player",
    phase: "MAIN",
    seconds: RULES.turnSeconds,
    finished: false,
    logs: [],

    player: {
      hp: RULES.maxHp,
      mana: 2,
      maxMana: 2,
      summons: 0,
      attacksUsed: 0,
      turnsPlayed: 0,
      deck: shuffle(playerCards),
      hand: [],
      field: []
    },

    enemy: {
      hp: RULES.maxHp,
      mana: 2,
      maxMana: 2,
      summons: 0,
      attacksUsed: 0,
      turnsPlayed: 0,
      deck: shuffle(enemyCards),
      hand: [],
      field: []
    }
  };

  // 初期手札は双方3枚
  drawCards("player", RULES.initialHand);
  drawCards("enemy", RULES.initialHand);

  startTurn("player");
  startTimer();

  addLog("RASH MASTERS BATTLE START！", "summon");

  setMessage("バトル開始！初期手札5枚から戦おう！");
  render();
}

// ========================================
// AUTH
// ========================================

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  try {
    await initialize(user);
  } catch (error) {
    console.error(error);
    setMessage(
      error.message || "バトル開始に失敗しました。"
    );

    $("battleLog").textContent =
      "対戦準備画面に戻り、デッキを選択し直してください。";
  }
});
