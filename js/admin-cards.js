
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// ========================================
// RASH MASTERS ADMIN CONFIG
// ========================================

const SUPER_ADMINS = [
  "lgs.esportsgames@gmail.com",
  "galleria0302@gmail.com"
];

const COLLECTION_NAME = "cards";

let cards = [];
let currentUser = null;
let editing = false;

// ========================================
// DOM
// ========================================

const $ = (id) => document.getElementById(id);

const cardForm = $("cardForm");
const cardList = $("cardList");
const message = $("message");

const cardName = $("cardName");
const rarity = $("rarity");
const cardType = $("cardType");
const attack = $("attack");
const hp = $("hp");
const description = $("description");
const imagePath = $("imagePath");
const editingId = $("editingId");

const saveButton = $("saveButton");
const cancelButton = $("cancelButton");
const imagePreview = $("imagePreview");
const previewStatus = $("previewStatus");

// ========================================
// SECURITY
// ========================================

function isSuperAdmin(user) {
  return Boolean(
    user &&
    user.email &&
    SUPER_ADMINS.includes(user.email.toLowerCase())
  );
}

function showAccessDenied() {
  document.body.innerHTML = `
    <main style="
      min-height:100vh;
      display:grid;
      place-items:center;
      background:#090914;
      color:white;
      font-family:sans-serif;
      text-align:center;
      padding:24px;
    ">
      <div>
        <div style="font-size:55px;color:#ff6483;">✕</div>
        <h1>ACCESS DENIED</h1>
        <p style="color:#aaa7bd;">
          このページはSUPER ADMIN専用です。
        </p>
        <a href="../login.html" style="color:#b68aff;">
          ログイン画面へ戻る
        </a>
      </div>
    </main>
  `;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  currentUser = user;

  if (!isSuperAdmin(user)) {
    showAccessDenied();
    return;
  }

  $("adminEmail").textContent = user.email || "";

  await loadCards();
});

// ========================================
// MESSAGE
// ========================================

let messageTimer;

function showMessage(text, type = "success") {
  clearTimeout(messageTimer);

  message.textContent = text;
  message.className = `message ${type}`;

  messageTimer = setTimeout(() => {
    message.className = "message";
    message.textContent = "";
  }, 5000);
}

// ========================================
// IMAGE PATH
// ========================================

function getImageUrl(path) {
  if (
    typeof path !== "string" ||
    !/^assets\/cards\/(?:N|R|SR|SSR|UR)\/[a-zA-Z0-9_\-.]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(path)
  ) {
    return "";
  }

  return new URL(`../${path}`, import.meta.url).href;
}

function updateImagePreview() {
  const path = imagePath.value.trim();
  const url = getImageUrl(path);

  if (!url) {
    imagePreview.innerHTML = "<span>画像プレビュー</span>";
    previewStatus.textContent = path
      ? "画像パスを確認してください"
      : "画像パスを入力すると表示されます";
    return;
  }

  imagePreview.innerHTML = "";

  const img = document.createElement("img");
  img.alt = "カード画像プレビュー";
  img.src = url;

  img.onload = () => {
    previewStatus.textContent = "画像を読み込みました";
  };

  img.onerror = () => {
    imagePreview.innerHTML = "<span>画像を読み込めません</span>";
    previewStatus.textContent = "ファイルの場所・名前を確認してください";
  };

  imagePreview.appendChild(img);
}

// ========================================
// CARD DATA
// ========================================

async function loadCards() {
  cardList.innerHTML = '<div class="loading">読み込み中...</div>';

  try {
    const snapshot = await getDocs(collection(db, COLLECTION_NAME));

    cards = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    cards.sort((a, b) => {
      const dateA = a.createdAt?.toMillis?.() || 0;
      const dateB = b.createdAt?.toMillis?.() || 0;
      return dateB - dateA;
    });

    $("cardCount").textContent = cards.length;

    renderCards();

  } catch (error) {
    console.error("Card load error:", error);

    cardList.innerHTML = `
      <div class="empty-state">
        カードデータを読み込めませんでした。<br>
        Firestoreの設定や通信状態を確認してください。
      </div>
    `;

    showMessage(
      "カードデータの取得に失敗しました：" + error.message,
      "error"
    );
  }
}

// ========================================
// HTML ESCAPE
// ========================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

// ========================================
// CARD LIST
// ========================================

function renderCards() {
  const keyword = $("searchInput").value.trim().toLowerCase();
  const selectedRarity = $("filterRarity").value;

  const filtered = cards.filter((card) => {
    const name = String(card.name || "").toLowerCase();

    const matchesName = name.includes(keyword);
    const matchesRarity = !selectedRarity ||
      card.rarity === selectedRarity;

    return matchesName && matchesRarity;
  });

  if (filtered.length === 0) {
    cardList.innerHTML = `
      <div class="empty-state">
        該当するカードがありません。
      </div>
    `;
    return;
  }

  cardList.innerHTML = filtered.map((card) => {
    const url = getImageUrl(card.imagePath);

    return `
      <article class="registered-card">

        ${
          url
            ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(card.name)}" loading="lazy">`
            : `<div class="registered-card-placeholder">NO IMAGE</div>`
        }

        <div class="card-info">
          <strong>${escapeHTML(card.name)}</strong>

          <div>
            <span class="rarity rarity-${escapeHTML(card.rarity)}">
              ${escapeHTML(card.rarity)}
            </span>
            <small>
              ATK ${Number(card.attack) || 0}
              / HP ${Number(card.hp) || 0}
            </small>
          </div>

          <small>
            ${escapeHTML(card.cardType || "ATTACK")}
          </small>
        </div>

        <div class="card-actions">
          <button type="button" data-action="edit" data-id="${escapeHTML(card.id)}">
            編集
          </button>
          <button
            type="button"
            class="delete-button"
            data-action="delete"
            data-id="${escapeHTML(card.id)}"
          >
            削除
          </button>
        </div>

      </article>
    `;
  }).join("");
}

// ========================================
// CARD SAVE
// ========================================

cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isSuperAdmin(currentUser)) {
    showMessage("管理者権限がありません。", "error");
    return;
  }

  const name = cardName.value.trim();
  const image = imagePath.value.trim();
  const imageUrl = getImageUrl(image);

  const attackValue = Number(attack.value);
  const hpValue = Number(hp.value);

  if (!name) {
    showMessage("カード名を入力してください。", "error");
    return;
  }

  if (!imageUrl) {
    showMessage(
      "画像パスが正しくありません。assets/cards/から始まる画像を指定してください。",
      "error"
    );
    return;
  }

  if (
    !Number.isInteger(attackValue) ||
    !Number.isInteger(hpValue) ||
    attackValue < 0 ||
    hpValue < 0 ||
    attackValue > 99999 ||
    hpValue > 99999
  ) {
    showMessage("攻撃力とHPは0～99999の整数で入力してください。", "error");
    return;
  }

  
  // スキルデータを取得・検証
  let skillData;

  try {
    skillData = getSkillData();
  } catch (error) {
    showMessage(error.message, "error");
    return;
  }

  const data = {
    name,
    rarity: rarity.value,
    cardType: cardType.value,
    attack: attackValue,
    hp: hpValue,
    description: description.value.trim(),
    imagePath: image,

    // スキル情報
    skillTrigger: skillData.skillTrigger,
    skillEffect: skillData.skillEffect,
    skillValue: skillData.skillValue,

    updatedAt: serverTimestamp()
  };


  if (!["N", "R", "SR", "SSR", "UR"].includes(data.rarity)) {
    showMessage("レアリティが正しくありません。", "error");
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "保存中...";

  try {
    if (editing && editingId.value) {
      await updateDoc(
        doc(db, COLLECTION_NAME, editingId.value),
        data
      );

      showMessage("カード情報を更新しました！");
    } else {
      await addDoc(
        collection(db, COLLECTION_NAME),
        {
          ...data,
          createdAt: serverTimestamp()
        }
      );

      showMessage("新しいカードを登録しました！");
    }

    resetForm();
    await loadCards();

  } catch (error) {
    console.error("Card save error:", error);

    showMessage(
      "保存に失敗しました：" + error.message,
      "error"
    );

  } finally {
    saveButton.disabled = false;
    saveButton.textContent = editing
      ? "変更を保存"
      : "＋ カードを登録";
  }
});

// ========================================
// EDIT CARD
// ========================================

function editCard(id) {
  const card = cards.find((item) => item.id === id);

  if (!card) return;

  editing = true;

  editingId.value = card.id;
  cardName.value = card.name || "";
  rarity.value = card.rarity || "N";
  cardType.value = card.cardType || "ATTACK";
  attack.value = card.attack ?? 100;
  hp.value = card.hp ?? 100;
  description.value = card.description || "";
  imagePath.value = card.imagePath || "";

  $("formTitle").textContent = "カード情報を編集";
  saveButton.textContent = "変更を保存";
  cancelButton.classList.remove("hidden");


  // カード画像を更新
  updateImagePreview();

  // 保存済みスキルを編集フォームに反映
  loadSkillData(card);


  document.querySelector(".editor-panel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

// ========================================
// DELETE CARD
// ========================================

async function removeCard(id) {
  if (!isSuperAdmin(currentUser)) {
    showMessage("管理者権限がありません。", "error");
    return;
  }

  const card = cards.find((item) => item.id === id);

  if (!card) return;

  const confirmed = confirm(
    `「${card.name}」を削除しますか？\nこの操作は取り消せません。`
  );

  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));

    if (editingId.value === id) {
      resetForm();
    }

    showMessage("カードを削除しました。");
    await loadCards();

  } catch (error) {
    console.error("Card delete error:", error);

    showMessage(
      "削除に失敗しました：" + error.message,
      "error"
    );
  }
}

// ========================================
// FORM RESET
// ========================================

function resetForm() {
  editing = false;

  cardForm.reset();

  editingId.value = "";
  rarity.value = "N";
  cardType.value = "ATTACK";
  attack.value = 100;
  hp.value = 100;

  $("formTitle").textContent = "新しいカードを登録";
  saveButton.textContent = "＋ カードを登録";

  cancelButton.classList.add("hidden");

  
  updateImagePreview();

  // スキル設定を初期化
  resetSkillData();
}


// ========================================
// EVENTS
// ========================================

cardList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const id = button.dataset.id;

  if (button.dataset.action === "edit") {
    editCard(id);
  }

  if (button.dataset.action === "delete") {
    removeCard(id);
  }
});

imagePath.addEventListener("input", updateImagePreview);

$("searchInput").addEventListener("input", renderCards);
$("filterRarity").addEventListener("change", renderCards);

$("refreshButton").addEventListener("click", loadCards);

cancelButton.addEventListener("click", resetForm);

$("logoutButton").addEventListener("click", async () => {
  try {
    await signOut(auth);
    location.replace("../login.html");
  } catch (error) {
    showMessage("ログアウトに失敗しました。", "error");
  }
});


// ========================================
// RASH MASTERS SKILL EDITOR VER.1
// ========================================

const skillTriggerInput =
  document.getElementById("skillTrigger");

const skillEffectInput =
  document.getElementById("skillEffect");

const skillValueInput =
  document.getElementById("skillValue");

const skillPreview =
  document.getElementById("skillPreview");

const SKILL_EFFECTS = {
  NONE: "効果なし",
  DAMAGE: "相手モンスターにダメージ",
  HEAL: "自身のカードHP回復",
  ATK_UP: "攻撃力アップ",
  SHIELD: "受けるダメージ軽減",
  DRAW: "カードをドロー"
};

const SKILL_TRIGGERS = {
  NONE: "なし",
  ON_SUMMON: "召喚時",
  ON_ATTACK: "攻撃時",
  PASSIVE: "常時",
  ON_DESTROY: "破壊時"
};

function updateSkillEditor() {
  const trigger = skillTriggerInput.value;
  const enabled = trigger !== "NONE";

  skillEffectInput.disabled = !enabled;
  skillValueInput.disabled = !enabled;

  if (!enabled) {
    skillEffectInput.value = "NONE";
    skillValueInput.value = "0";
  }

  // 発動タイミングと効果の組み合わせを制限
  for (const option of skillEffectInput.options) {
    const effect = option.value;

    let allowed = true;

    if (trigger === "PASSIVE") {
      allowed = ["NONE", "ATK_UP", "SHIELD"].includes(effect);
    } else if (trigger === "ON_ATTACK") {
      allowed = ["NONE", "DAMAGE", "HEAL", "ATK_UP"].includes(effect);
    } else if (trigger === "ON_DESTROY") {
  allowed = ["NONE", "DAMAGE", "DRAW"].includes(effect);
    } else if (trigger === "ON_SUMMON") {
      allowed = ["NONE", "DAMAGE", "HEAL", "ATK_UP", "DRAW"].includes(effect);
    }

    option.disabled = !allowed;
  }

  if (skillEffectInput.selectedOptions[0]?.disabled) {
    skillEffectInput.value = "NONE";
  }

  const effect = skillEffectInput.value;
  const value = Number(skillValueInput.value) || 0;

  if (!enabled || effect === "NONE") {
    skillPreview.textContent =
      "このカードにはスキルが設定されていません。";
    return;
  }

  const unit = effect === "DRAW" ? "枚" : "";

  skillPreview.textContent =
    `【${SKILL_TRIGGERS[trigger]}】` +
    `${SKILL_EFFECTS[effect]}：${value}${unit}`;
}

function getSkillData() {
  const trigger = skillTriggerInput.value;
  const effect = skillEffectInput.value;
  const value = Number(skillValueInput.value);

  if (trigger === "NONE") {
    return {
      skillTrigger: "NONE",
      skillEffect: "NONE",
      skillValue: 0
    };
  }

  if (effect === "NONE") {
    throw new Error("スキル効果を選択してください。");
  }

  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 99999
  ) {
    throw new Error("スキル効果量は1～99999の整数で入力してください。");
  }

  if (skillEffectInput.selectedOptions[0]?.disabled) {
    throw new Error("この発動タイミングでは使用できない効果です。");
  }

  return {
    skillTrigger: trigger,
    skillEffect: effect,
    skillValue: value
  };
}

function loadSkillData(card) {
  skillTriggerInput.value =
    card.skillTrigger || "NONE";

  skillEffectInput.value =
    card.skillEffect || "NONE";

  skillValueInput.value =
    card.skillValue ?? 0;

  updateSkillEditor();
}

function resetSkillData() {
  loadSkillData({});
}

skillTriggerInput.addEventListener(
  "change",
  updateSkillEditor
);

skillEffectInput.addEventListener(
  "change",
  updateSkillEditor
);

skillValueInput.addEventListener(
  "input",
  updateSkillEditor
);

updateSkillEditor();
