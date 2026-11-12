
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

// ==============================
// CONFIG
// ==============================

const $ = (id) => document.getElementById(id);

const DECK_SIZE = 10;
const MAX_COPIES = 3;
const MAX_HP = 10000;
const MAX_MANA = 10;
const MAX_HAND = 7;
const MAX_FIELD = 5;
const MAX_SUMMONS = 2;
const TURN_SECONDS = 120;

let game = null;
let timerId = null;
let busy = false;
let selectedAttacker = -1;

// ==============================
// HELPERS
// ==============================

function numberValue(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getCost(card) {
  return Math.min(
    MAX_MANA,
    Math.floor(numberValue(
      card.cost ?? card.manaCost ?? card.mana,
      1
    ))
  );
}

function getAttack(card) {
  return Math.floor(numberValue(
    card.atk ?? card.attack ?? card.ATK,
    500
  ));
}

function getHealth(card) {
  return Math.max(1, Math.floor(numberValue(
    card.hp ?? card.health ?? card.HP,
    1000
  )));
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
    currentHp: getHealth(card),
    maxHp: getHealth(card),
    atkValue: getAttack(card),
    attacked: false,
    summonedThisTurn: true
  };
}

function addLog(message) {
  if (!game) return;

  game.logs.unshift(message);
  game.logs = game.logs.slice(0, 40);

  $("battleLog").replaceChildren();

  for (const line of game.logs) {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.textContent = line;
    $("battleLog").append(div);
  }
}

function message(text) {
  $("battleMessage").textContent = text;
}

// ==============================
// VALIDATE SAVED DECK
// ==============================

function expandSavedDeck(deck, cardMap) {
  if (!deck || !Array.isArray(deck.cards)) {
    throw new Error("保存済みデッキが見つかりません。");
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
      throw new Error("登録されていないカードがあります。");
    }

    const total = (counts.get(entry.cardId) || 0) +
      entry.quantity;

    if (total > MAX_COPIES) {
      throw new Error("同じカードは最大3枚までです。");
    }

    counts.set(entry.cardId, total);

    for (let i = 0; i < entry.quantity; i++) {
      expanded.push({ ...card });
    }
  }

  if (
    expanded.length !== DECK_SIZE ||
    deck.totalCards !== DECK_SIZE
  ) {
    throw new Error("デッキは10枚ちょうど必要です。");
  }

  return expanded;
}

// ==============================
// DRAW
// ==============================

function draw(side, amount = 1) {
  const player = game[side];

  for (let i = 0; i < amount; i++) {
    if (!player.deck.length) {
      addLog(
        `${side === "player" ? "あなた" : "CPU"}のデッキは空です。`
      );
      break;
    }

    const card = player.deck.shift();

    if (player.hand.length >= MAX_HAND) {
      addLog("手札上限のためカードを破棄しました。");
      continue;
    }

    player.hand.push(card);
  }
}

// ==============================
// SUMMON
// ==============================

function summon(side, handIndex) {
  const player = game[side];
  const card = player.hand[handIndex];

  if (!card) return false;
  if (player.field.length >= MAX_FIELD) return false;
  if (player.summons >= MAX_SUMMONS) return false;

  const cost = getCost(card);

  if (cost > player.mana) return false;

  player.mana -= cost;
  player.summons++;

  player.hand.splice(handIndex, 1);
  player.field.push(makeUnit(card));

  addLog(
    `${side === "player" ? "あなた" : "CPU"}が「${card.name || "カード"}」を召喚！`
  );

  return true;
}

// ==============================
// DAMAGE
// ==============================

function damageHero(side, amount) {
  game[side].hp = Math.max(
    0,
    game[side].hp - Math.max(0, amount)
  );

  if (game[side].hp <= 0) {
    finish(side === "enemy" ? "VICTORY" : "DEFEAT");
  }
}

function attackUnit(attackerSide, attackerIndex, targetIndex) {
  const defenderSide =
    attackerSide === "player" ? "enemy" : "player";

  const attacker = game[attackerSide].field[attackerIndex];
  const defender = game[defenderSide].field[targetIndex];

  if (!attacker || !defender) return;

  if (attacker.attacked || attacker.summonedThisTurn) {
    return;
  }

  attacker.attacked = true;

  defender.currentHp -= attacker.atkValue;
  attacker.currentHp -= defender.atkValue;

  addLog(
    `「${attacker.name}」が「${defender.name}」に攻撃！`
  );

  if (defender.currentHp <= 0) {
    addLog(`「${defender.name}」が倒れた！`);
    game[defenderSide].field.splice(targetIndex, 1);
  }

  if (attacker.currentHp <= 0) {
    addLog(`「${attacker.name}」が倒れた！`);
    game[attackerSide].field.splice(attackerIndex, 1);
  }
}

function attackHero(attackerSide, attackerIndex) {
  const defenderSide =
    attackerSide === "player" ? "enemy" : "player";

  const attacker = game[attackerSide].field[attackerIndex];

  if (!attacker || attacker.attacked ||
      attacker.summonedThisTurn) {
    return;
  }

  if (game[defenderSide].field.length > 0) {
    return;
  }

  attacker.attacked = true;

  addLog(
    `「${attacker.name}」がプレイヤーに${attacker.atkValue}ダメージ！`
  );

  damageHero(defenderSide, attacker.atkValue);
}

// ==============================
// TURN
// ==============================

function startTurn(side) {
  if (game.finished) return;

  game.active = side;
  game.phase = "MAIN";
  game.seconds = TURN_SECONDS;

  const player = game[side];

  player.maxMana = Math.min(
    MAX_MANA,
    player.maxMana + (game.turn === 1 ? 0 : 1)
  );

  player.mana = player.maxMana;
  player.summons = 0;

  for (const unit of player.field) {
    unit.attacked = false;
    unit.summonedThisTurn = false;
  }

  if (game.turn > 1) {
    draw(side);
  }

  addLog(
    `${side === "player" ? "あなた" : "CPU"}のターン開始`
  );

  render();
}

function endPlayerTurn() {
  if (!game || game.finished ||
      game.active !== "player" || busy) {
    return;
  }

  selectedAttacker = -1;
  busy = true;

  game.turn++;
  startTurn("enemy");

  setTimeout(cpuTurn, 650);
}

function cpuTurn() {
  if (!game || game.finished) return;

  game.phase = "MAIN";

  // CPUが召喚可能なカードを選ぶ
  for (let attempt = 0; attempt < MAX_SUMMONS; attempt++) {
    const index = game.enemy.hand.findIndex(
      (card) => getCost(card) <= game.enemy.mana
    );

    if (index < 0) break;
    if (!summon("enemy", index)) break;
  }

  game.phase = "BATTLE";

  // 召喚したターン以外のモンスターが攻撃
  const attackers = [...game.enemy.field];

  for (const unit of attackers) {
    if (game.finished) break;

    const index = game.enemy.field.indexOf(unit);

    if (index < 0 || unit.attacked ||
        unit.summonedThisTurn) {
      continue;
    }

    if (game.player.field.length > 0) {
      attackUnit("enemy", index, 0);
    } else {
      attackHero("enemy", index);
    }
  }

  if (!game.finished) {
    game.turn++;
    busy = false;
    startTurn("player");
  }

  render();
}

// ==============================
// RESULT
// ==============================

function finish(result) {
  if (game.finished) return;

  game.finished = true;
  clearInterval(timerId);

  $("resultTitle").textContent = result;

  $("resultDescription").textContent =
    result === "VICTORY"
      ? "CPUとの対戦に勝利しました！"
      : "CPUとの対戦に敗北しました。";

  $("resultOverlay").classList.remove("hidden");

  render();
}

// ==============================
// RENDER
// ==============================

function createCardImage(card) {
  const img = document.createElement("img");
  const src = imageUrl(card.imagePath);

  if (src) {
    img.src = src;
  }

  img.alt = card.name || "CARD";
  img.onerror = () => img.remove();

  return img;
}

function renderSlots(side) {
  const container = $(
    side === "player" ? "playerSlots" : "enemySlots"
  );

  container.replaceChildren();

  for (let i = 0; i < MAX_FIELD; i++) {
    const unit = game[side].field[i];

    const slot = document.createElement("div");
    slot.className = "slot";

    if (!unit) {
      slot.classList.add("empty");

      if (
        side === "enemy" &&
        selectedAttacker >= 0 &&
        game.phase === "BATTLE"
      ) {
        slot.classList.add("targetable");
      }

      container.append(slot);
      continue;
    }

    if (unit.attacked || unit.summonedThisTurn) {
      slot.classList.add("exhausted");
    }

    if (side === "player" &&
        selectedAttacker === i) {
      slot.classList.add("selected");
    }

    if (side === "enemy" &&
        selectedAttacker >= 0) {
      slot.classList.add("targetable");
    }

    const cardBox = document.createElement("div");
    cardBox.className = "field-card";

    cardBox.append(createCardImage(unit));

    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = unit.name || "CARD";

    const stats = document.createElement("div");
    stats.className = "stats";
    stats.textContent =
      `ATK ${unit.atkValue} / HP ${Math.max(0, unit.currentHp)}`;

    cardBox.append(name, stats);
    slot.append(cardBox);

    if (side === "player") {
      slot.addEventListener("click", () => {
        if (
          game.finished ||
          game.active !== "player" ||
          game.phase !== "BATTLE"
        ) {
          return;
        }

        if (unit.attacked || unit.summonedThisTurn) {
          message("このモンスターはまだ攻撃できません。");
          return;
        }

        selectedAttacker =
          selectedAttacker === i ? -1 : i;

        message(
          selectedAttacker >= 0
            ? "攻撃対象を選択してください。"
            : "攻撃選択を解除しました。"
        );

        render();
      });
    } else {
      slot.addEventListener("click", () => {
        if (
          game.finished ||
          game.active !== "player" ||
          game.phase !== "BATTLE" ||
          selectedAttacker < 0
        ) {
          return;
        }

        attackUnit("player", selectedAttacker, i);
        selectedAttacker = -1;
        render();
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
    name.textContent = card.name || "CARD";

    const cost = document.createElement("small");
    cost.textContent = `COST ${getCost(card)}`;

    button.append(name, cost);

    button.disabled =
      game.finished ||
      busy ||
      game.active !== "player" ||
      game.phase !== "MAIN" ||
      game.player.summons >= MAX_SUMMONS ||
      game.player.field.length >= MAX_FIELD ||
      getCost(card) > game.player.mana;

    button.addEventListener("click", () => {
      if (summon("player", index)) {
        message(`「${card.name}」を召喚しました！`);
        render();
      }
    });

    container.append(button);
  });
}

function render() {
  if (!game) return;

  $("playerHp").textContent = game.player.hp;
  $("enemyHp").textContent = game.enemy.hp;

  $("playerHpBar").style.width =
    `${game.player.hp / MAX_HP * 100}%`;

  $("enemyHpBar").style.width =
    `${game.enemy.hp / MAX_HP * 100}%`;

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
    `${game.player.hand.length} / ${MAX_HAND}`;

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
    game.active !== "player";

  renderSlots("enemy");
  renderSlots("player");
  renderHand();
}

// ==============================
// BUTTONS
// ==============================

$("attackButton").addEventListener("click", () => {
  if (
    !game ||
    game.finished ||
    game.active !== "player" ||
    game.phase !== "MAIN" ||
    busy
  ) {
    return;
  }

  game.phase = "BATTLE";
  message("攻撃するモンスターを選択してください。");

  render();
});

$("endTurnButton").addEventListener("click", endPlayerTurn);

// 相手の場が空なら直接攻撃
$("enemySlots").addEventListener("click", (event) => {
  if (
    !game ||
    game.finished ||
    game.active !== "player" ||
    game.phase !== "BATTLE" ||
    selectedAttacker < 0 ||
    game.enemy.field.length > 0
  ) {
    return;
  }

  attackHero("player", selectedAttacker);
  selectedAttacker = -1;
  render();
});

// ==============================
// TIMER
// ==============================

function startTimer() {
  clearInterval(timerId);

  timerId = setInterval(() => {
    if (!game || game.finished || busy) return;
    if (game.active !== "player") return;

    game.seconds = Math.max(0, game.seconds - 1);
    $("turnTimer").textContent = game.seconds;

    if (game.seconds === 0) {
      message("制限時間になりました。ターンを終了します。");
      endPlayerTurn();
    }
  }, 1000);
}

// ==============================
// START GAME
// ==============================

async function initialize(user) {
  const raw = sessionStorage.getItem(
    "rashMastersBattlePreparation"
  );

  if (!raw) {
    throw new Error(
      "対戦準備がありません。先にデッキを確定してください。"
    );
  }

  let preparation;

  try {
    preparation = JSON.parse(raw);
  } catch {
    throw new Error("対戦準備データが不正です。");
  }

  if (!preparation.deckId) {
    throw new Error("デッキが選択されていません。");
  }

  if (preparation.mode !== "casual") {
    throw new Error(
      "CPU試作版はカジュアルモードのみ対応しています。"
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

  // 試作版CPUは同じカードプールを使用
  const enemyCards = playerCards.map((card) => ({
    ...card
  }));

  game = {
    turn: 1,
    active: "player",
    phase: "MAIN",
    seconds: TURN_SECONDS,
    finished: false,
    logs: [],
    player: {
      hp: MAX_HP,
      mana: 1,
      maxMana: 1,
      summons: 0,
      deck: shuffle(playerCards),
      hand: [],
      field: []
    },
    enemy: {
      hp: MAX_HP,
      mana: 1,
      maxMana: 1,
      summons: 0,
      deck: shuffle(enemyCards),
      hand: [],
      field: []
    }
  };

  draw("player", 5);
  draw("enemy", 5);

  startTurn("player");
  startTimer();

  message("CPU対戦開始！手札からカードを召喚しよう。");
}

// ==============================
// AUTH
// ==============================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  try {
    await initialize(user);
  } catch (error) {
    console.error(error);

    message(error.message);

    $("battleLog").textContent =
      "対戦を開始できませんでした。battle.htmlで準備を完了してください。";
  }
});
