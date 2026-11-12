
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ========================================
// RASH MASTERS - BATTLE ARENA VER.2
// ========================================

const $ = (id) => document.getElementById(id);

const RULES = {
  deckSize: 10,
  maxCopies: 3,
  maxHp: 10000,
  maxMana: 10,
  maxHand: 7,
  maxField: 5,
  maxSummons: 2,
  turnSeconds: 120
};

let game = null;
let timerId = null;
let selectedAttacker = null;
let busy = false;
let autoEnding = false;
let unitSerial = 0;

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function randomId() {
  unitSerial++;
  return `unit-${unitSerial}`;
}

function numeric(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const n = Number(value);

  return Number.isFinite(n) && n >= 0
    ? n
    : fallback;
}

function cardCost(card) {
  return Math.min(
    RULES.maxMana,
    Math.floor(numeric(
      card.cost ?? card.manaCost ?? card.mana,
      1
    ))
  );
}

function cardAttack(card) {
  return Math.floor(numeric(
    card.atk ?? card.attack ?? card.ATK,
    500
  ));
}

function cardHp(card) {
  return Math.max(
    1,
    Math.floor(numeric(
      card.hp ?? card.health ?? card.HP,
      1000
    ))
  );
}

function cardName(card) {
  return String(card.name || "名称未設定カード");
}

function imageUrl(path) {
  if (typeof path !== "string") return "";

  const clean = path.replace(/^\/+/, "");

  if (
    !/^assets\/cards\/(N|R|SR|SSR|UR)\/[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(clean)
  ) {
    return "";
  }

  return new URL("../" + clean, import.meta.url).href;
}

function shuffle(cards) {
  const result = [...cards];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

function makeUnit(card) {
  return {
    ...card,
    instanceId: randomId(),
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

  game.logs.unshift({
    text,
    type
  });

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
  return document.querySelector(
    `[data-side="${side}"][data-unit-id="${instanceId}"]`
  );
}

async function destructionEffect(element) {
  if (!element) return;

  element.classList.add("destroy-animation");

  await sleep(550);
}

// ========================================
// DECK VALIDATION
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
      !Number.isSafeInteger(entry.quantity) ||
      entry.quantity < 1
    ) {
      throw new Error("デッキのカード情報が不正です。");
    }

    const card = cardMap.get(entry.cardId);

    if (!card) {
      throw new Error("存在しないカードが含まれています。");
    }

    const count =
      (counts.get(entry.cardId) || 0) +
      entry.quantity;

    if (count > RULES.maxCopies) {
      throw new Error("同じカードは最大3枚までです。");
    }

    counts.set(entry.cardId, count);

    for (let i = 0; i < entry.quantity; i++) {
      expanded.push({ ...card });
    }
  }

  if (
    expanded.length !== RULES.deckSize ||
    deck.totalCards !== RULES.deckSize
  ) {
    throw new Error("10枚デッキが必要です。");
  }

  return expanded;
}

// ========================================
// DRAW
// ========================================

function drawCards(side, amount = 1) {
  const fighter = game[side];
  const label = side === "player" ? "あなた" : "CPU";

  for (let i = 0; i < amount; i++) {
    if (fighter.deck.length === 0) {
      addLog(
        `${label}はデッキが空のためドローできませんでした。`
      );
      break;
    }

    const card = fighter.deck.shift();

    if (fighter.hand.length >= RULES.maxHand) {
      addLog(
        `${label}は手札上限7枚のため「${cardName(card)}」を破棄しました。`,
        "destroy"
      );
      continue;
    }

    fighter.hand.push(card);

    if (side === "player") {
      addLog(`「${cardName(card)}」をドローしました。`);
    } else {
      addLog("CPUがカードを1枚ドローしました。");
    }
  }
}

// ========================================
// SUMMON
// ========================================

function canSummon(side, index) {
  if (!game || game.finished) return false;

  const fighter = game[side];
  const card = fighter.hand[index];

  if (!card) return false;

  return (
    fighter.field.length < RULES.maxField &&
    fighter.summons < RULES.maxSummons &&
    fighter.mana >= cardCost(card)
  );
}

function summon(side, handIndex) {
  if (!canSummon(side, handIndex)) {
    return false;
  }

  const fighter = game[side];
  const card = fighter.hand[handIndex];
  const cost = cardCost(card);

  fighter.mana -= cost;
  fighter.summons++;

  // 手札から減るのは召喚したカードだけ
  fighter.hand.splice(handIndex, 1);

  const unit = makeUnit(card);
  fighter.field.push(unit);

  addLog(
    `${side === "player" ? "あなた" : "CPU"}が「${cardName(card)}」を召喚！マナ-${cost}`,
    "summon"
  );

  render();

  const slot = findSlot(side, unit.instanceId);
  summonEffect(slot);

  return true;
}

// ========================================
// ATTACK VALIDATION
// ========================================

function canAttack(side, unit) {
  if (!game || game.finished || !unit) return false;

  return (
    game.active === side &&
    game.phase === "BATTLE" &&
    !unit.attacked &&
    !unit.summonedThisTurn &&
    unit.currentHp > 0
  );
}

function availableAttackers(side) {
  return game[side].field.filter(
    (unit) => canAttack(side, unit)
  );
}

// ========================================
// DAMAGE & COMBAT
// ========================================

function applyHeroDamage(side, amount) {
  if (game.finished) return;

  const damage = Math.max(0, amount);

  game[side].hp = Math.max(
    0,
    game[side].hp - damage
  );

  addLog(
    `${side === "player" ? "あなた" : "CPU"}のHPが${damage}減少！残りHP：${game[side].hp}`,
    "damage"
  );

  if (game[side].hp === 0) {
    finish(
      side === "enemy" ? "VICTORY" : "DEFEAT"
    );
  }
}

async function attackUnit(
  attackerSide,
  attackerId,
  defenderId
) {
  if (!game || game.finished) return false;

  const defenderSide =
    attackerSide === "player" ? "enemy" : "player";

  const attacker = game[attackerSide].field.find(
    (unit) => unit.instanceId === attackerId
  );

  const defender = game[defenderSide].field.find(
    (unit) => unit.instanceId === defenderId
  );

  if (!attacker || !defender) return false;
  if (!canAttack(attackerSide, attacker)) return false;

  attacker.attacked = true;

  const damage = attacker.attackValue;

  addLog(
    `「${cardName(attacker)}」が「${cardName(defender)}」を攻撃！`,
    "damage"
  );

  // Aルール：防御側だけがダメージを受ける
  defender.currentHp = Math.max(
    0,
    defender.currentHp - damage
  );

  addLog(
    `「${cardName(defender)}」に${damage}ダメージ！残りHP：${defender.currentHp}/${defender.maxHp}`,
    "damage"
  );

  // 攻撃側のHPは一切減らさない
  render();

  const targetElement = findSlot(
    defenderSide,
    defender.instanceId
  );

  impactEffect(targetElement);
  floatingDamage(targetElement, damage);
  screenShake();

  await sleep(450);

  if (defender.currentHp <= 0) {
    addLog(
      `「${cardName(defender)}」は「${cardName(attacker)}」から受けた戦闘ダメージでHPが0になり、破壊されました。`,
      "destroy"
    );

    await destructionEffect(
      findSlot(defenderSide, defender.instanceId)
    );

    const index = game[defenderSide].field.findIndex(
      (unit) => unit.instanceId === defender.instanceId
    );

    if (index !== -1) {
      game[defenderSide].field.splice(index, 1);
    }
  }

  render();
  return true;
}

async function attackHero(attackerSide, attackerId) {
  if (!game || game.finished) return false;

  const defenderSide =
    attackerSide === "player" ? "enemy" : "player";

  const attacker = game[attackerSide].field.find(
    (unit) => unit.instanceId === attackerId
  );

  if (!attacker) return false;
  if (!canAttack(attackerSide, attacker)) return false;

  // 相手のモンスターがいる間は直接攻撃不可
  if (game[defenderSide].field.length > 0) {
    return false;
  }

  attacker.attacked = true;

  addLog(
    `「${cardName(attacker)}」が${defenderSide === "enemy" ? "CPU" : "あなた"}に直接攻撃！`,
    "damage"
  );

  const heroElement = document.querySelector(
    defenderSide === "enemy"
      ? ".fighter.enemy"
      : ".fighter.player"
  );

  impactEffect(heroElement);
  floatingDamage(heroElement, attacker.attackValue);
  screenShake();

  // ダメージは必ず攻撃対象のプレイヤーだけ
  applyHeroDamage(
    defenderSide,
    attacker.attackValue
  );

  render();
  await sleep(500);

  return true;
}

// ========================================
// TURN SYSTEM
// ========================================

function startTurn(side) {
  if (!game || game.finished) return;

  game.active = side;
  game.phase = "MAIN";
  game.seconds = RULES.turnSeconds;

  selectedAttacker = null;
  autoEnding = false;

  const fighter = game[side];

  // 初回はマナ1、次回以降に最大マナ+1
  if (fighter.turnsPlayed > 0) {
    fighter.maxMana = Math.min(
      RULES.maxMana,
      fighter.maxMana + 1
    );
  }

  fighter.turnsPlayed++;
  fighter.mana = fighter.maxMana;
  fighter.summons = 0;

  for (const unit of fighter.field) {
    unit.attacked = false;
    unit.summonedThisTurn = false;
  }

  // 2ターン目以降は1枚ドロー
  if (fighter.turnsPlayed > 1) {
    drawCards(side, 1);
  }

  addLog(
    `━━ ${side === "player" ? "あなた" : "CPU"}のターン開始 ━━`,
    "summon"
  );

  setMessage(
    side === "player"
      ? "カードを召喚し、攻撃フェーズへ進もう！"
      : "CPUが行動しています..."
  );

  render();
}

function beginBattlePhase() {
  if (
    !game ||
    game.finished ||
    busy ||
    game.active !== "player" ||
    game.phase !== "MAIN"
  ) {
    return;
  }

  game.phase = "BATTLE";
  selectedAttacker = null;

  addLog("あなたの攻撃フェーズ開始");

  render();

  if (availableAttackers("player").length === 0) {
    setMessage(
      "攻撃できるモンスターがいないため、自動でターンを終了します。"
    );

    scheduleAutoEnd();
  } else {
    setMessage(
      "攻撃するモンスターを選び、攻撃対象をクリック！"
    );
  }
}

function scheduleAutoEnd() {
  if (
    !game ||
    game.finished ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    autoEnding
  ) {
    return;
  }

  if (availableAttackers("player").length > 0) {
    return;
  }

  autoEnding = true;

  setMessage(
    "すべての攻撃が終了！CPUのターンへ移行します..."
  );

  setTimeout(() => {
    if (
      game &&
      !game.finished &&
      game.active === "player" &&
      game.phase === "BATTLE"
    ) {
      endPlayerTurn();
    }
  }, 900);
}

function checkAutoEnd() {
  if (!game || game.finished) return;

  if (
    game.active === "player" &&
    game.phase === "BATTLE" &&
    availableAttackers("player").length === 0
  ) {
    scheduleAutoEnd();
  }
}

async function endPlayerTurn() {
  if (
    !game ||
    game.finished ||
    game.active !== "player" ||
    busy
  ) {
    return;
  }

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

  // CPU召喚
  for (let i = 0; i < RULES.maxSummons; i++) {
    if (game.finished) break;

    const index = game.enemy.hand.findIndex(
      (card) => cardCost(card) <= game.enemy.mana
    );

    if (index === -1) break;

    if (!summon("enemy", index)) break;

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

  // 先に攻撃できるユニットだけを記録
  const attackers = game.enemy.field
    .filter((unit) => !unit.summonedThisTurn)
    .map((unit) => unit.instanceId);

  for (const attackerId of attackers) {
    if (game.finished) break;

    const attacker = game.enemy.field.find(
      (unit) => unit.instanceId === attackerId
    );

    if (!canAttack("enemy", attacker)) continue;

    if (game.player.field.length > 0) {
      const target = game.player.field[0];

      await attackUnit(
        "enemy",
        attackerId,
        target.instanceId
      );
    } else {
      await attackHero("enemy", attackerId);
    }

    await sleep(300);
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

// ========================================
// PLAYER ATTACK
// ========================================

async function handlePlayerAttack(targetId = null) {
  if (
    !game ||
    game.finished ||
    busy ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    !selectedAttacker
  ) {
    return;
  }

  const attackerId = selectedAttacker;

  busy = true;
  selectedAttacker = null;

  let success = false;

  if (targetId) {
    success = await attackUnit(
      "player",
      attackerId,
      targetId
    );
  } else if (game.enemy.field.length === 0) {
    success = await attackHero(
      "player",
      attackerId
    );
  }

  busy = false;

  if (success) {
    checkAutoEnd();
  } else {
    setMessage("攻撃できませんでした。対象を確認してください。");
  }

  render();
}

// ========================================
// RENDER CARDS
// ========================================

function createCardImage(card) {
  const image = document.createElement("img");

  const src = imageUrl(card.imagePath);

  if (src) image.src = src;

  image.alt = cardName(card);

  image.onerror = () => image.remove();

  return image;
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

    const cardBox = document.createElement("div");
    cardBox.className = "field-card";

    cardBox.append(createCardImage(unit));

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
    cardBox.append(name, stats);
    slot.append(cardBox);

    if (side === "player") {
      slot.addEventListener("click", () => {
        if (busy || game.finished) return;

        if (!canAttack("player", unit)) {
          setMessage(
            "このモンスターは攻撃できません。召喚ターン中か、攻撃済みです。"
          );
          return;
        }

        selectedAttacker =
          selectedAttacker === unit.instanceId
            ? null
            : unit.instanceId;

        setMessage(
          selectedAttacker
            ? "攻撃対象を選択！相手の場が空なら敵フィールドをクリック。"
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
      game.finished ||
      busy ||
      game.active !== "player" ||
      game.phase !== "MAIN" ||
      !canSummon("player", index);

    button.addEventListener("click", () => {
      if (
        game.finished ||
        busy ||
        game.active !== "player" ||
        game.phase !== "MAIN"
      ) {
        return;
      }

      if (summon("player", index)) {
        setMessage(
          `「${cardName(card)}」を召喚しました！`
        );
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
    game.finished ||
    busy ||
    game.active !== "player" ||
    game.phase !== "MAIN";

  $("endTurnButton").disabled =
    game.finished ||
    busy ||
    game.active !== "player" ||
    autoEnding;

  renderSlots("enemy");
  renderSlots("player");
  renderHand();
}

// ========================================
// BUTTONS
// ========================================

$("attackButton").addEventListener(
  "click",
  beginBattlePhase
);

$("endTurnButton").addEventListener(
  "click",
  () => endPlayerTurn()
);

// 相手フィールドが空なら直接攻撃
$("enemySlots").addEventListener("click", (event) => {
  if (
    !game ||
    game.finished ||
    busy ||
    !selectedAttacker ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    game.enemy.field.length !== 0
  ) {
    return;
  }

  handlePlayerAttack();
});

// ========================================
// RESULT
// ========================================

function finish(result) {
  if (!game || game.finished) return;

  game.finished = true;
  clearInterval(timerId);

  addLog(
    result === "VICTORY"
      ? "あなたの勝利！CPUのHPが0になりました。"
      : "あなたの敗北。プレイヤーHPが0になりました。",
    "destroy"
  );

  $("resultTitle").textContent = result;

  $("resultDescription").textContent =
    result === "VICTORY"
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
      !game ||
      game.finished ||
      busy ||
      autoEnding ||
      game.active !== "player"
    ) {
      return;
    }

    game.seconds = Math.max(
      0,
      game.seconds - 1
    );

    $("turnTimer").textContent = game.seconds;

    if (game.seconds === 0) {
      addLog(
        "制限時間120秒が経過しました。自動でターン終了します。"
      );

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
      getDoc(
        doc(
          db,
          "users",
          user.uid,
          "decks",
          preparation.deckId
        )
      ),
      getDocs(collection(db, "cards"))
    ]);

  if (!deckSnapshot.exists()) {
    throw new Error("保存済みデッキが見つかりません。");
  }

  const cardMap = new Map(
    cardsSnapshot.docs.map((item) => [
      item.id,
      {
        ...item.data(),
        id: item.id
      }
    ])
  );

  const playerCards = expandSavedDeck(
    deckSnapshot.data(),
    cardMap
  );

  // CPUは試作版として同じカード構成を使用
  const enemyCards = playerCards.map(
    (card) => ({ ...card })
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
      mana: 1,
      maxMana: 1,
      summons: 0,
      turnsPlayed: 0,
      deck: shuffle(playerCards),
      hand: [],
      field: []
    },

    enemy: {
      hp: RULES.maxHp,
      mana: 1,
      maxMana: 1,
      summons: 0,
      turnsPlayed: 0,
      deck: shuffle(enemyCards),
      hand: [],
      field: []
    }
  };

  drawCards("player", 5);
  drawCards("enemy", 5);

  startTurn("player");
  startTimer();

  addLog("RASH MASTERS BATTLE START！", "summon");

  setMessage(
    "バトル開始！手札からカードを召喚しよう！"
  );

  render();
}

// ========================================
// AUTH
// ========================================

onAuthStateChanged(auth, async (user) => {
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
