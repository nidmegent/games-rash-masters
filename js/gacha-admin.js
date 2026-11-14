
import { auth, db } from "../firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const $ = id => document.getElementById(id);

const RARITIES = ["N", "R", "SR", "SSR", "UR"];
const COLORS = ["#c0c5d1", "#58a9ff", "#bb83ff", "#ffbd62", "#ff6ee5"];
const DEFAULT_RATES = [50, 30, 13, 6, 1];

let masterCards = [];
let gachaList = [];
let selectedId = null;
let busy = false;

function message(text) {
  $("message").textContent = text;
}

function createRates() {
  const container = $("rates");
  container.replaceChildren();

  RARITIES.forEach((rarity, i) => {
    const row = document.createElement("div");
    row.className = "rate-row";

    const label = document.createElement("strong");
    label.textContent = rarity;
    label.style.color = COLORS[i];

    const track = document.createElement("div");
    track.className = "rate-track";

    const fill = document.createElement("div");
    fill.className = "rate-fill";
    fill.style.background = COLORS[i];
    track.append(fill);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "100";
    input.step = "0.01";
    input.value = DEFAULT_RATES[i];
    input.dataset.rarity = rarity;
    input.addEventListener("input", updateRateTotal);

    row.append(label, track, input);
    container.append(row);
  });

  updateRateTotal();
}

function getRates() {
  const result = {};
  document.querySelectorAll("[data-rarity]").forEach(input => {
    result[input.dataset.rarity] = Number(input.value);
  });
  return result;
}

function updateRateTotal() {
  const rates = getRates();
  const total = Object.values(rates).reduce((a, b) => a + b, 0);

  $("rateTotal").textContent = `合計 ${total.toFixed(2)}% / 100%`;
  $("rateTotal").style.color =
    Math.abs(total - 100) < 0.000001 ? "#54e6ff" : "#ff647c";

  document.querySelectorAll(".rate-row").forEach(row => {
    const input = row.querySelector("input");
    const fill = row.querySelector(".rate-fill");
    fill.style.width = `${Math.max(0, Math.min(100, Number(input.value) || 0))}%`;
  });
}

function renderCardPool(selected = []) {
  const container = $("cardPool");
  container.replaceChildren();

  masterCards.forEach(card => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = card.id;
    checkbox.checked = selected.includes(card.id);

    const name = document.createElement("span");
    name.textContent = ` ${card.name || card.id} (${card.rarity || "N"})`;

    label.append(checkbox, name);
    container.append(label);
  });
}

function getSelectedCards() {
  return [...$("cardPool").querySelectorAll("input:checked")]
    .map(input => input.value);
}

function resetForm() {
  selectedId = null;
  $("gachaForm").reset();
  $("gachaName").value = "";
  $("gachaDescription").value = "";
  $("singleCost").value = 100;
  $("tenCost").value = 1000;
  $("enabled").checked = false;
  $("deleteGacha").disabled = true;

  document.querySelectorAll("[data-rarity]").forEach((input, i) => {
    input.value = DEFAULT_RATES[i];
  });

  renderCardPool();
  updateRateTotal();
}

function editGacha(gacha) {
  selectedId = gacha.id;

  $("gachaName").value = gacha.name || "";
  $("gachaDescription").value = gacha.description || "";
  $("singleCost").value = gacha.singleCost ?? 100;
  $("tenCost").value = gacha.tenCost ?? 1000;
  $("enabled").checked = gacha.enabled === true;
  $("deleteGacha").disabled = false;

  document.querySelectorAll("[data-rarity]").forEach(input => {
    input.value = gacha.rates?.[input.dataset.rarity] ?? 0;
  });

  renderCardPool(gacha.cardPool || []);
  updateRateTotal();
}

function renderGachas() {
  const container = $("gachaList");
  container.replaceChildren();

  if (!gachaList.length) {
    container.textContent = "まだガチャがありません。";
    return;
  }

  gachaList.forEach(gacha => {
    const row = document.createElement("div");
    row.className = "gacha-item";

    const title = document.createElement("span");
    title.textContent =
      `${gacha.name || "UNNAMED"} / ${gacha.enabled ? "公開中" : "停止中"}`;

    const button = document.createElement("button");
    button.textContent = "EDIT";
    button.addEventListener("click", () => editGacha(gacha));

    row.append(title, button);
    container.append(row);
  });
}

async function loadGachas() {
  const snapshot = await getDocs(collection(db, "gachaBanners"));

  gachaList = snapshot.docs.map(item => ({
    ...item.data(),
    id: item.id
  }));

  renderGachas();
}

function validCost(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
}

async function saveGacha(event) {
  event.preventDefault();
  if (busy) return;

  const name = $("gachaName").value.trim();
  const rates = getRates();
  const values = Object.values(rates);
  const total = values.reduce((a, b) => a + b, 0);
  const singleCost = Number($("singleCost").value);
  const tenCost = Number($("tenCost").value);
  const cardPool = getSelectedCards();

  if (!name || name.length > 60) {
    return message("ガチャ名は1〜60文字で入力してください。");
  }

  if (!validCost(singleCost) || !validCost(tenCost)) {
    return message("必要コインは0〜100000000の整数で指定してください。");
  }

  if (values.some(v => !Number.isFinite(v) || v < 0 || v > 100)
      || Math.abs(total - 100) > 0.000001) {
    return message("排出率の合計を100%にしてください。");
  }

  if (!cardPool.length) {
    return message("排出対象カードを1枚以上選択してください。");
  }

  const availableRarities = new Set(
    masterCards.filter(c => cardPool.includes(c.id)).map(c => c.rarity)
  );

  if (RARITIES.some(r => rates[r] > 0 && !availableRarities.has(r))) {
    return message("排出率が0%より大きいレアリティには対象カードが必要です。");
  }

  busy = true;
  $("saveGacha").disabled = true;

  try {
    const id = selectedId || doc(collection(db, "gachaBanners")).id;

    await setDoc(doc(db, "gachaBanners", id), {
      name,
      description: $("gachaDescription").value.trim(),
      singleCost,
      tenCost,
      rates,
      cardPool,
      enabled: $("enabled").checked
    });

    selectedId = id;
    await loadGachas();
    $("deleteGacha").disabled = false;
    message("ガチャ設定を保存しました！");

  } catch (error) {
    console.error(error);
    message("保存に失敗しました。管理者権限とFirestore Rulesを確認してください。");
  } finally {
    busy = false;
    $("saveGacha").disabled = false;
  }
}

async function removeGacha() {
  if (!selectedId || busy) return;
  if (!confirm("このガチャを削除しますか？")) return;

  busy = true;
  $("deleteGacha").disabled = true;

  try {
    await deleteDoc(doc(db, "gachaBanners", selectedId));
    await loadGachas();
    resetForm();
    message("ガチャを削除しました。");
  } catch (error) {
    console.error(error);
    message("削除に失敗しました。");
  } finally {
    busy = false;
    $("deleteGacha").disabled = !selectedId;
  }
}

$("newGacha").addEventListener("click", resetForm);
$("gachaForm").addEventListener("submit", saveGacha);
$("deleteGacha").addEventListener("click", removeGacha);

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("../login.html");
    return;
  }

  try {
    const token = await user.getIdTokenResult(true);

    if (token.claims.admin !== true) {
      $("loading").textContent = "アクセス権限がありません。";
      return;
    }

    const snapshot = await getDocs(collection(db, "cards"));
    masterCards = snapshot.docs.map(item => ({
      ...item.data(),
      id: item.id
    }));

    createRates();
    renderCardPool();
    await loadGachas();

    $("loading").hidden = true;
    $("adminContent").hidden = false;
  } catch (error) {
    console.error(error);
    $("loading").textContent = "管理画面の読み込みに失敗しました。";
  }
});
