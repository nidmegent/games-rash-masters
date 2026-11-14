
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
  initialHand: 3,
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


/* ========================================
   RASH MASTERS SKILL EFFECTS VER.1
======================================== */


function showSkillEffect(side, unitId, type, amount = 0) {
  const target = findSlot(side, unitId);
  const layer = $("effectLayer");

  if (!target || !layer) return;

  const point = elementCenter(target);
  if (!point) return;

  const effects = {
    HEAL: ["skill-heal", `+${amount} HP`],
    ATK_UP: ["skill-atk", `+${amount} ATK`],
    SHIELD: ["skill-shield", `🛡 ${amount} 軽減`],
    DAMAGE: ["skill-damage", `-${amount}`],
    DRAW: ["skill-draw", `DRAW +${amount}`]
  };

  const effect = effects[type];
  if (!effect) return;

  const overlay = document.createElement("div");
  overlay.className = `skill-vfx ${effect[0]}`;

  overlay.style.position = "fixed";
  overlay.style.left = `${point.x}px`;
  overlay.style.top = `${point.y}px`;
  overlay.style.width = `${target.offsetWidth}px`;
  overlay.style.height = `${target.offsetHeight}px`;
  overlay.style.transform = "translate(-50%, -50%)";
  overlay.style.pointerEvents = "none";

  const text = document.createElement("span");
  text.className = "skill-vfx-text";
  text.textContent = effect[1];

  overlay.append(text);
  layer.append(overlay);

  setTimeout(() => overlay.remove(), 1100);
}

function screenShake() {

  const fields = document.querySelectorAll(
    ".enemy-field, .player-field"
  );

  fields.forEach(element => {
    element.classList.remove("screen-shake");

    // アニメーションを再実行
    void element.offsetWidth;

    element.classList.add("screen-shake");

    setTimeout(() => {
      element.classList.remove("screen-shake");
    }, 400);
  });
}


function findSlot(side, instanceId) {
  return [...document.querySelectorAll(
    `[data-side="${side}"][data-unit-id]`
  )].find(el => el.dataset.unitId === instanceId) || null;
}


 // ========================================
 // CARD SKILLS VER.1
 // ========================================

const SKILL_ALLOWED = {
  ON_SUMMON: ["DAMAGE", "HEAL", "ATK_UP", "DRAW"],
  ON_ATTACK: ["DAMAGE", "HEAL", "ATK_UP"],
  PASSIVE: ["ATK_UP", "SHIELD"],
  ON_DESTROY: ["DAMAGE", "DRAW"]
};

function skillOf(card) {
  const trigger = String(card.skillTrigger || "NONE");
  const effect = String(card.skillEffect || "NONE");
  const value = Number(card.skillValue);

  if (
    !SKILL_ALLOWED[trigger]?.includes(effect) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 99999
  ) {
    return null;
  }

  return { trigger, effect, value };
}

function otherSide(side) {
  return side === "player" ? "enemy" : "player";
}

function effectiveAttack(unit) {
  const skill = skillOf(unit);

  const passive =
    skill?.trigger === "PASSIVE" &&
    skill.effect === "ATK_UP"
      ? skill.value
      : 0;

  return Math.max(
    0,
    unit.attackValue +
    passive +
    (unit.skillAttackBonus || 0)
  );
}


function dealUnitDamage(side, target, amount, source) {
  const skill = skillOf(target);

  const shield =
    skill?.trigger === "PASSIVE" &&
    skill.effect === "SHIELD"
      ? skill.value
      : 0;

  const reduced = Math.min(shield, amount);
  const damage = Math.max(0, amount - shield);

  target.currentHp = Math.max(
    0,
    target.currentHp - damage
  );

if (reduced > 0) {
  // 攻撃力強化・自己回復と同じスキルカットイン
  showSkillCutin(side, target, {
    trigger: "PASSIVE",
    effect: "SHIELD",
    value: reduced
  });

  // 防衛したカード上に軽減数値を表示
  showSkillEffect(
    side,
    target.instanceId,
    "SHIELD",
    reduced
  );

  playBattleSound("shield");
}

  addLog(
    `✦ ${source} →「${cardName(target)}」に${damage}ダメージ` +
    (reduced > 0 ? `（軽減${reduced}）` : ""),
    "damage"
  );

  return damage;
}

// 破壊時能力はフィールドから除外したあと発動
function removeDestroyedUnits() {
  let count = 0;

  while (!game.finished && count++ < 12) {
    let found = false;

    for (const side of ["player", "enemy"]) {
      const fighter = game[side];

      const index = fighter.field.findIndex(
        unit => unit.currentHp <= 0
      );

      if (index < 0) continue;

      found = true;

      const [unit] = fighter.field.splice(index, 1);

      addLog(
        `「${cardName(unit)}」が破壊されました。`,
        "destroy"
      );

      activateSkill(side, unit, "ON_DESTROY");
      break;
    }

    if (!found) break;
  }
}

function activateSkill(side, unit, trigger) {
  if (!game || game.finished) return;

  const skill = skillOf(unit);

  if (!skill || skill.trigger !== trigger) return;

  const { effect, value } = skill;
  showSkillCutin(side, unit, skill);
  const opponent = otherSide(side);

  const label =
    `${side === "player" ? "あなた" : "CPU"}の` +
    `「${cardName(unit)}」`;

  if (trigger === "PASSIVE") return;

  // スキルダメージ
  if (effect === "DAMAGE") {
    const target = game[opponent].field[0];

    if (!target) {
      addLog(`✦ ${label}のスキル：対象モンスターなし`);
      return;
    }

    const damage = dealUnitDamage(
      opponent,
      target,
      value,
      `${label}のスキル`
    );

    showSkillEffect(
      opponent,
      target.instanceId,
      "DAMAGE",
      damage
    );

  // 自分自身のカードHP回復
  } else if (effect === "HEAL") {
    if (unit.currentHp <= 0) return;

    const before = unit.currentHp;

    unit.currentHp = Math.min(
      unit.maxHp,
      before + value
    );

    const healed = unit.currentHp - before;

    addLog(
      `✦ ${label}の自己回復！ ` +
      `HP ${before} → ${unit.currentHp}/${unit.maxHp}`,
      "summon"
    );

    if (healed > 0) {
      showSkillEffect(
        side,
        unit.instanceId,
        "HEAL",
        healed
      );
    }

  // 攻撃力アップ
  } else if (effect === "ATK_UP") {
    unit.skillAttackBonus =
      (unit.skillAttackBonus || 0) + value;

    addLog(
      `✦ ${label}の攻撃力 +${value}！`,
      "summon"
    );

    showSkillEffect(
      side,
      unit.instanceId,
      "ATK_UP",
      value
    );

  // ドロー
  } else if (effect === "DRAW") {
    addLog(
      `✦ ${label}のドロースキル！`,
      "summon"
    );

    const before = game[side].hand.length;

    drawCards(
      side,
      Math.min(value, RULES.maxHand)
    );

    const drawn = game[side].hand.length - before;

    showSkillEffect(
      side,
      unit.instanceId,
      "DRAW",
      drawn
    );
  }
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
    `${side === "player" ? "あなた" : "CPU"}が` +
    `「${cardName(card)}」を召喚！マナ-${cost}`,
    "summon"
  );

  // スキル処理のため、先にカードを描画
  render();

  activateSkill(side, unit, "ON_SUMMON");

  const passiveSkill = skillOf(unit);

  if (
    passiveSkill?.trigger === "PASSIVE" &&
    passiveSkill.effect === "ATK_UP"
  ) {
    showSkillEffect(
      side,
      unit.instanceId,
      "ATK_UP",
      passiveSkill.value
    );
  }

  removeDestroyedUnits();

  // 最終描画後に召喚エフェクトを出す
  render();

  if (fighter.field.includes(unit)) {
    showRaritySummon(side, unit);
  }

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
  if (!game || game.finished) return;

  const damage = Math.max(0, amount);

  // プレイヤー本体のHPを減らす
  game[side].hp = Math.max(
    0,
    game[side].hp - damage
  );

  addLog(
    `${side === "player" ? "あなた" : "CPU"}に` +
    `${damage}ダメージ！残りHP：${game[side].hp}`,
    "damage"
  );

  // HPが0になったら勝敗を決定
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

  playBattleSound("attack");

  // 攻撃時スキルを発動
  activateSkill(attackerSide, attacker, "ON_ATTACK");

  // スキルで対象が破壊された場合は先に処理
  if (defender.currentHp <= 0) {
    removeDestroyedUnits();
    render();
    return true;
  }

  // 常時強化・攻撃時強化・防御スキルを反映
  const damage = dealUnitDamage(
    defenderSide,
    defender,
    effectiveAttack(attacker),
    cardName(attacker)
  );

  // 攻撃時の強化は今回限り
  if (skillOf(attacker)?.trigger === "ON_ATTACK") {
    attacker.skillAttackBonus = 0;
  }


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

    
    // 破壊時スキルと連鎖破壊を処理
    removeDestroyedUnits();

  }

  
  removeDestroyedUnits();
  render();
  return true;
}


/* ========================================
   RASH MASTERS - FINAL ATTACK
======================================== */

async function playFinalAttack(attacker) {
  const overlay = document.createElement("div");
  overlay.className = "final-attack-overlay";

  const flash = document.createElement("div");
  flash.className = "final-attack-flash";

  const title = document.createElement("div");
  title.className = "final-attack-title";
  title.textContent = "FINAL ATTACK";

  const card = document.createElement("div");
  card.className = "final-attack-card";

  const image = createCardImage(attacker);
  image.className = "final-attack-image";

  const name = document.createElement("div");
  name.className = "final-attack-name";
  name.textContent = cardName(attacker);

  const damage = document.createElement("div");
  damage.className = "final-attack-damage";
  damage.textContent =
    `${effectiveAttack(attacker).toLocaleString("ja-JP")} DAMAGE`;

  card.append(image, name);
  overlay.append(flash, title, card, damage);
  document.body.append(overlay);

  try {
    // カード登場
    await sleep(900);

    // 攻撃開始
    card.classList.add("final-attack-charge");
    await sleep(550);

    // 画面全体に衝撃
    overlay.classList.add("final-attack-impact");
    await sleep(550);

    // 演出終了
    overlay.classList.add("final-attack-out");
    await sleep(350);
  } finally {
    overlay.remove();
  }
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

  if (game[defenderSide].field.length > 0) {
    return false;
  }

  // 攻撃権を消費
  game[attackerSide].attacksUsed++;
  attacker.attacked = true;

  addLog(
    `「${cardName(attacker)}」が` +
    `${defenderSide === "enemy" ? "CPU" : "あなた"}に直接攻撃！`,
    "damage"
  );

  // 攻撃時スキル
  activateSkill(attackerSide, attacker, "ON_ATTACK");
  removeDestroyedUnits();

  if (game.finished) {
    render();
    return true;
  }

  // 最終攻撃力
  const damage = effectiveAttack(attacker);

  // 一時的な攻撃力強化を解除
  if (skillOf(attacker)?.trigger === "ON_ATTACK") {
    attacker.skillAttackBonus = 0;
  }

  // HPが0になる攻撃かどうか
  const isFinalAttack =
    damage > 0 &&
    game[defenderSide].hp <= damage;

  // フィニッシュ攻撃演出
  if (isFinalAttack) {
    await playFinalAttack(attacker);
  }

  const hero = document.querySelector(
    defenderSide === "enemy"
      ? ".fighter.enemy"
      : ".fighter.player"
  );

  if (hero) {
    impactEffect(hero);
    floatingDamage(hero, damage);
  }

  screenShake();

  // ここでHPを減らして勝敗確定
  applyHeroDamage(defenderSide, damage);

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
    atk.textContent = `⚔${effectiveAttack(unit)}`;

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

    
const unavailable =
  game.finished || busy ||
  game.active !== "player" ||
  game.phase !== "MAIN" ||
  !canSummon("player", index);

button.disabled = false;
button.classList.toggle("unavailable", unavailable);
button.setAttribute("aria-disabled", String(unavailable));


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

  playBattleSound(victory ? "victory" : "defeat");

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

  const resultOverlay = $("resultOverlay");

resultOverlay.classList.remove(
  "result-victory",
  "result-defeat"
);

resultOverlay.classList.add(
  victory ? "result-victory" : "result-defeat"
);
  
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


/* ========================================
   RASH MASTERS - VISUAL UPDATE 2.3
   Summon / Skill / Card Detail
======================================== */

function cardRarity(card) {
  const path = String(card.imagePath || "");
  const match = path.match(/assets\/cards\/(UR|SSR|SR|R|N)\//i);
  const raw = String(card.rarity || match?.[1] || "N").toUpperCase();
  return ["N", "R", "SR", "SSR", "UR"].includes(raw)
    ? raw : "N";
}

const SKILL_NAMES = {
  DAMAGE: "スキルダメージ",
  HEAL: "自己回復",
  ATK_UP: "攻撃力強化",
  DRAW: "カードドロー",
  SHIELD: "防衛・ダメージ軽減"
};

const TRIGGER_NAMES = {
  ON_SUMMON: "召喚時",
  ON_ATTACK: "攻撃時",
  PASSIVE: "常時発動",
  ON_DESTROY: "破壊時"
};


function showRaritySummon(side, unit) {
  const target = findSlot(side, unit.instanceId);
  const layer = $("effectLayer");
  if (!target || !layer) return;

  const point = elementCenter(target);
  if (!point) return;

  const rarity = cardRarity(unit);

  const effect = document.createElement("div");
  effect.className =
    `rarity-summon rarity-${rarity.toLowerCase()}`;

  effect.style.left = `${point.x}px`;
  effect.style.top = `${point.y}px`;

  const label = document.createElement("span");
  label.textContent = `${rarity} SUMMON`;

  effect.append(label);
  layer.append(effect);

  playBattleSound("summon");
  setTimeout(() => effect.remove(), 1100);
}


function showSkillCutin(side, unit, skill) {
  if (!skill) return;

  const field = document.querySelector(
    side === "player" ? ".player-field" : ".enemy-field"
  );

  if (!field) return;

  const rect = field.getBoundingClientRect();

  const layer = document.createElement("div");
  layer.className = `skill-cutin skill-cutin-${side}`;

  layer.style.position = "fixed";
  layer.style.left = `${rect.left + rect.width / 2}px`;
  layer.style.top = `${rect.top + rect.height / 2}px`;

  const image = createCardImage(unit);
  image.className = "skill-cutin-image";

  const info = document.createElement("div");
  info.className = "skill-cutin-info";

  const trigger = document.createElement("small");
  trigger.textContent =
    TRIGGER_NAMES[skill.trigger] || "SKILL";

  const title = document.createElement("strong");
  title.textContent =
    SKILL_NAMES[skill.effect] || skill.effect;

  const name = document.createElement("span");
  name.textContent = cardName(unit);

  info.append(trigger, title, name);
  layer.append(image, info);

  $("effectLayer").append(layer);

  playBattleSound(
    skill.effect === "HEAL" ? "heal" :
    skill.effect === "SHIELD" ? "shield" : "skill"
  );

  setTimeout(() => layer.remove(), 950);
}


// カード詳細画面
let cardDetailOpen = false;

function closeCardDetail() {
  document.getElementById("cardDetailOverlay")?.remove();
  cardDetailOpen = false;
}

function openCardDetail(card) {
  if (!card) return;

  closeCardDetail();
  cardDetailOpen = true;

  const overlay = document.createElement("div");
  overlay.id = "cardDetailOverlay";
  overlay.className = "card-detail-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "カード詳細");

  const panel = document.createElement("div");
  panel.className = "card-detail-panel";

  const close = document.createElement("button");
  close.className = "card-detail-close";
  close.type = "button";
  close.textContent = "×";
  close.addEventListener("click", closeCardDetail);

  const rarity = document.createElement("div");
  rarity.className =
    `card-detail-rarity rarity-text-${cardRarity(card).toLowerCase()}`;
  rarity.textContent = cardRarity(card);

  const image = createCardImage(card);
  image.className = "card-detail-image";

  const name = document.createElement("h2");
  name.textContent = cardName(card);

  const stats = document.createElement("div");
  stats.className = "card-detail-stats";

  const atk = card.instanceId
    ? effectiveAttack(card)
    : cardAttack(card);

  const hp = card.instanceId
    ? `${card.currentHp} / ${card.maxHp}`
    : String(cardHp(card));

  stats.textContent =
    `MANA ${cardCost(card)}  |  ATK ${atk}  |  HP ${hp}`;

  const skill = skillOf(card);
  const skillText = document.createElement("div");
  skillText.className = "card-detail-skill";

  skillText.textContent = skill
    ? `${TRIGGER_NAMES[skill.trigger]}：` +
      `${SKILL_NAMES[skill.effect]} +${skill.value}`
    : "スキルなし";

  const description = document.createElement("p");
  description.className = "card-detail-description";
  description.textContent = String(
    card.description || card.flavorText || ""
  );

  panel.append(
    close, rarity, image, name,
    stats, skillText, description
  );

  overlay.append(panel);
  document.body.append(overlay);

  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeCardDetail();
  });

  close.focus();
}

// 長押し・右クリックによる詳細表示
let detailPressTimer = null;
let detailPressStart = null;
let suppressCardClick = false;

function getInspectCard(element) {
  const hand = element.closest(".hand-card");
  if (hand) {
    const index = [...$("playerHand").children].indexOf(hand);
    return game?.player.hand[index] || null;
  }

  const slot = element.closest(".slot[data-unit-id]");
  if (!slot) return null;

  const side = slot.dataset.side;
  return game?.[side]?.field.find(
    unit => unit.instanceId === slot.dataset.unitId
  ) || null;
}

function clearDetailPress() {
  clearTimeout(detailPressTimer);
  detailPressTimer = null;
  detailPressStart = null;
}

document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".hand-card, .slot[data-unit-id]")) {
    return;
  }

  if (event.button !== 0) return;

  const card = getInspectCard(event.target);
  if (!card) return;

  clearDetailPress();
  detailPressStart = { x: event.clientX, y: event.clientY };

  detailPressTimer = setTimeout(() => {
    suppressCardClick = true;
    openCardDetail(card);
    clearDetailPress();
  }, 550);
}, true);

document.addEventListener("pointermove", event => {
  if (!detailPressStart) return;

  const distance = Math.hypot(
    event.clientX - detailPressStart.x,
    event.clientY - detailPressStart.y
  );

  if (distance > 12) clearDetailPress();
}, true);

document.addEventListener("pointerup", clearDetailPress, true);
document.addEventListener("pointercancel", clearDetailPress, true);

document.addEventListener("click", event => {
  if (!suppressCardClick) return;

  if (event.target.closest(".hand-card, .slot")) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  suppressCardClick = false;
}, true);

document.addEventListener("contextmenu", event => {
  const card = getInspectCard(event.target);
  if (!card) return;

  event.preventDefault();
  clearDetailPress();
  openCardDetail(card);
}, true);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && cardDetailOpen) {
    closeCardDetail();
  }
});


/* ========================================
   RASH MASTERS - BATTLE SOUND
======================================== */

let battleAudioContext = null;
let battleSoundEnabled = false;
let battleSoundVolume = 0.35;

function initBattleAudio() {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return null;

  if (!battleAudioContext) {
    battleAudioContext = new AudioContextClass();
  }

  if (battleAudioContext.state === "suspended") {
    battleAudioContext.resume().catch(() => {});
  }

  return battleAudioContext;
}

function playBattleTone(
  frequency,
  duration = 0.15,
  type = "sine",
  volume = 0.25,
  delay = 0
) {
  if (!battleSoundEnabled) return;

  const ctx = battleAudioContext;
  if (!ctx || ctx.state !== "running") return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  const start = ctx.currentTime + delay;
  const end = start + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(
    Math.max(1, frequency), start
  );

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, volume * battleSoundVolume),
    start + 0.015
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001, end
  );

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function playBattleSound(type) {
  if (!battleSoundEnabled) return;

  switch (type) {
    case "summon":
      playBattleTone(330, .18, "triangle", .4);
      playBattleTone(495, .2, "triangle", .4, .1);
      playBattleTone(660, .3, "sine", .35, .2);
      break;

    case "attack":
      playBattleTone(170, .16, "sawtooth", .45);
      playBattleTone(85, .22, "triangle", .5, .07);
      break;

    case "heal":
      playBattleTone(523, .22, "sine", .35);
      playBattleTone(784, .3, "sine", .3, .12);
      break;

    case "shield":
      playBattleTone(420, .12, "triangle", .35);
      playBattleTone(300, .2, "sine", .35, .08);
      break;

    case "skill":
      playBattleTone(450, .12, "square", .2);
      playBattleTone(675, .2, "sine", .3, .1);
      break;

    case "victory":
      [523, 659, 784, 1047].forEach((freq, i) => {
        playBattleTone(freq, .4, "triangle", .4, i * .17);
      });
      break;

    case "defeat":
      [392, 311, 220].forEach((freq, i) => {
        playBattleTone(freq, .45, "sine", .4, i * .23);
      });
      break;
  }
}

// サウンド操作パネル
function setupBattleSoundControls() {
  if (document.getElementById("battleSoundControls")) return;

  const panel = document.createElement("div");
  panel.id = "battleSoundControls";
  panel.className = "battle-sound-controls";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "🔇 SOUND OFF";
  button.setAttribute("aria-pressed", "false");

  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "35";
  volume.setAttribute("aria-label", "効果音の音量");

  button.addEventListener("click", () => {
    battleSoundEnabled = !battleSoundEnabled;

    if (battleSoundEnabled) {
      initBattleAudio();
    }

    button.textContent =
      battleSoundEnabled ? "🔊 SOUND ON" : "🔇 SOUND OFF";

    button.setAttribute(
      "aria-pressed",
      String(battleSoundEnabled)
    );

    if (battleSoundEnabled) {
      playBattleSound("summon");
    }
  });

  volume.addEventListener("input", () => {
    battleSoundVolume = Number(volume.value) / 100;
  });

  panel.append(button, volume);
  document.body.append(panel);
}

setupBattleSoundControls();


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
