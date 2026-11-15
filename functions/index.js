
"use strict";

const { onCall, HttpsError } = require(
  "firebase-functions/v2/https"
);

const { initializeApp } = require(
  "firebase-admin/app"
);

const { getFirestore, FieldValue } = require(
  "firebase-admin/firestore"
);

initializeApp();

const db = getFirestore();

// ========================================
// RASH MASTERS COIN CONFIG
// ========================================

const INITIAL_COINS = 1000;
const FUNCTION_REGION = "asia-northeast1";

const MAX_SAFE_COINS = Number.MAX_SAFE_INTEGER;

// ========================================
// INITIAL COIN GRANT
// ========================================

exports.initializePlayerCoins = onCall(
  {
    region: FUNCTION_REGION,
    enforceAppCheck: false,
    maxInstances: 10
  },
  async (request) => {

    // ログイン必須
    if (!request.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "ログインが必要です。"
      );
    }

    const uid = request.auth.uid;

    const userRef = db.doc(`users/${uid}`);
    const grantRef = db.doc(
      `coinGrantLogs/initial_${uid}`
    );

    try {
      const result = await db.runTransaction(
        async (transaction) => {

          // トランザクションでは先に全件読み込む
          const userSnapshot =
            await transaction.get(userRef);

          const grantSnapshot =
            await transaction.get(grantRef);

          if (!userSnapshot.exists) {
            throw new HttpsError(
              "failed-precondition",
              "プレイヤープロフィールがありません。" +
              "一度ホーム画面にログインしてください。"
            );
          }

          const userData = userSnapshot.data();

          const hasCoins =
            Object.prototype.hasOwnProperty.call(
              userData,
              "coins"
            );

          const hasGrantFlag =
            Object.prototype.hasOwnProperty.call(
              userData,
              "initialCoinsGranted"
            );

          // ====================================
          // すでに初期配布済み
          // ====================================

          if (grantSnapshot.exists) {

            const log = grantSnapshot.data();

            // 履歴の整合性を確認
            if (
              log.uid !== uid ||
              log.reason !== "INITIAL_BONUS" ||
              log.amount !== INITIAL_COINS ||
              userData.initialCoinsGranted !== true ||
              !Number.isSafeInteger(userData.coins) ||
              userData.coins < 0
            ) {
              throw new HttpsError(
                "failed-precondition",
                "コインデータに不整合があります。" +
                "運営に確認してください。"
              );
            }

            return {
              granted: false,
              coins: userData.coins
            };
          }

          // ====================================
          // 既存データの保護
          // ====================================

          // すでにcoinsが存在する場合は、
          // 過去の残高を上書きしない。
          //
          // 配布フラグだけが存在する場合も、
          // 二重配布の可能性があるため停止する。

          if (hasCoins || hasGrantFlag) {
            throw new HttpsError(
              "failed-precondition",
              "既存のコイン情報が見つかりました。" +
              "自動配布せず、運営による確認が必要です。"
            );
          }

          if (
            !Number.isSafeInteger(INITIAL_COINS) ||
            INITIAL_COINS < 0 ||
            INITIAL_COINS > MAX_SAFE_COINS
          ) {
            throw new HttpsError(
              "internal",
              "初期コイン設定が不正です。"
            );
          }

          // ====================================
          // 初回配布
          // ====================================

          transaction.update(userRef, {
            coins: INITIAL_COINS,
            initialCoinsGranted: true
          });

          transaction.create(grantRef, {
            uid,
            amount: INITIAL_COINS,
            reason: "INITIAL_BONUS",
            createdAt: FieldValue.serverTimestamp()
          });

          return {
            granted: true,
            coins: INITIAL_COINS
          };
        }
      );

      return {
        success: true,
        granted: result.granted,
        coins: result.coins
      };

    } catch (error) {

      if (error instanceof HttpsError) {
        throw error;
      }

      console.error(
        "initializePlayerCoins failed:",
        { uid, error }
      );

      throw new HttpsError(
        "internal",
        "コイン初期化に失敗しました。"
      );
    }
  }
);

// ========================================
// RASH MASTERS GACHA DRAW - STEP 3-C
// ========================================

const { randomInt } = require("node:crypto");

const GACHA_RARITIES = [
  "N", "R", "SR", "SSR", "UR"
];

const MAX_GACHA_POOL = 200;
const MAX_GACHA_COST = 100000000;

// 100% = 1,000,000
// 小数第4位までの確率を扱う
const RATE_SCALE = 10000;
const RATE_TOTAL = 100 * RATE_SCALE;

// ========================================
// VALIDATION
// ========================================

function validGachaCost(value) {
  return Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_GACHA_COST;
}

function validateGachaRates(rates) {
  if (!rates || typeof rates !== "object") {
    throw new HttpsError(
      "failed-precondition",
      "排出率の設定がありません。"
    );
  }

  const weights = {};
  let total = 0;

  for (const rarity of GACHA_RARITIES) {
    const rate = rates[rarity];

    if (
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      throw new HttpsError(
        "failed-precondition",
        `${rarity}の排出率が不正です。`
      );
    }

    const scaled = Math.round(rate * RATE_SCALE);

    if (
      Math.abs(rate * RATE_SCALE - scaled) > 0.000001
    ) {
      throw new HttpsError(
        "failed-precondition",
        "排出率は小数第4位までにしてください。"
      );
    }

    weights[rarity] = scaled;
    total += scaled;
  }

  if (total !== RATE_TOTAL) {
    throw new HttpsError(
      "failed-precondition",
      "排出率の合計が100%ではありません。"
    );
  }

  return weights;
}

// ========================================
// SECURE RANDOM DRAW
// ========================================

function drawRarity(weights) {
  const random = randomInt(RATE_TOTAL);

  let cumulative = 0;

  for (const rarity of GACHA_RARITIES) {
    cumulative += weights[rarity];

    if (random < cumulative) {
      return rarity;
    }
  }

  throw new Error("Rarity draw failed");
}

function drawCards(weights, pools, count) {
  const results = [];

  for (let i = 0; i < count; i++) {
    const rarity = drawRarity(weights);
    const candidates = pools[rarity];

    if (!candidates || candidates.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        `${rarity}の排出カードがありません。`
      );
    }

    const selected = candidates[
      randomInt(candidates.length)
    ];

    results.push({
      cardId: selected.id,
      rarity: selected.rarity,
      name: selected.name
    });
  }

  return results;
}

// ========================================
// CALLABLE GACHA FUNCTION
// ========================================

exports.drawGacha = onCall(
  {
    region: FUNCTION_REGION,
    enforceAppCheck: false,
    maxInstances: 10
  },
  async (request) => {

    // ------------------------------------
    // AUTH
    // ------------------------------------

    if (!request.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "ログインが必要です。"
      );
    }

    const uid = request.auth.uid;
    const input = request.data || {};

    const { gachaId, count, requestId } = input;

    if (
      typeof gachaId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(gachaId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "ガチャIDが不正です。"
      );
    }

    if (count !== 1 && count !== 10) {
      throw new HttpsError(
        "invalid-argument",
        "抽選回数は1回または10回のみです。"
      );
    }

    // クライアントでcrypto.randomUUID()を使う
    if (
      typeof requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(requestId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "リクエストIDが不正です。"
      );
    }

    const userRef = db.doc(`users/${uid}`);
    const gachaRef = db.doc(
      `gachaBanners/${gachaId}`
    );

    // 同一ユーザーの同一リクエストは
    // 必ず同じログIDになる
    const drawRef = db.doc(
      `users/${uid}/gachaDraws/${requestId}`
    );

    try {
      const result = await db.runTransaction(
        async (transaction) => {

          // ==================================
          // READ PHASE
          // ==================================

          const drawSnapshot =
            await transaction.get(drawRef);

          // リトライ時は前回の抽選結果を返す
          if (drawSnapshot.exists) {
            const previous = drawSnapshot.data();

            if (
              previous.uid !== uid ||
              previous.gachaId !== gachaId ||
              previous.count !== count ||
              !Array.isArray(previous.cards) ||
              !Number.isSafeInteger(
                previous.remainingCoins
              )
            ) {
              throw new HttpsError(
                "already-exists",
                "このリクエストIDは別の抽選に使用済みです。"
              );
            }

            return {
              success: true,
              replayed: true,
              gachaId,
              count,
              cost: previous.cost,
              remainingCoins:
                previous.remainingCoins,
              cards: previous.cards
            };
          }

          const userSnapshot =
            await transaction.get(userRef);

          const gachaSnapshot =
            await transaction.get(gachaRef);

          if (!userSnapshot.exists) {
            throw new HttpsError(
              "failed-precondition",
              "プレイヤーデータがありません。"
            );
          }

          if (!gachaSnapshot.exists) {
            throw new HttpsError(
              "not-found",
              "ガチャが見つかりません。"
            );
          }

          const userData = userSnapshot.data();
          const gacha = gachaSnapshot.data();

          if (
            userData.initialCoinsGranted !== true ||
            !Number.isSafeInteger(userData.coins) ||
            userData.coins < 0
          ) {
            throw new HttpsError(
              "failed-precondition",
              "コインの初期化が必要です。"
            );
          }

          if (gacha.enabled !== true) {
            throw new HttpsError(
              "failed-precondition",
              "このガチャは現在公開されていません。"
            );
          }

          const cost = count === 1
            ? gacha.singleCost
            : gacha.tenCost;

          if (!validGachaCost(cost)) {
            throw new HttpsError(
              "failed-precondition",
              "ガチャの価格設定が不正です。"
            );
          }

          if (userData.coins < cost) {
            throw new HttpsError(
              "failed-precondition",
              "コインが不足しています。"
            );
          }

          const weights =
            validateGachaRates(gacha.rates);

          const cardIds = gacha.cardPool;

          if (
            !Array.isArray(cardIds) ||
            cardIds.length < 1 ||
            cardIds.length > MAX_GACHA_POOL ||
            new Set(cardIds).size !== cardIds.length ||
            cardIds.some(id =>
              typeof id !== "string" ||
              !/^[a-zA-Z0-9_-]{1,128}$/.test(id)
            )
          ) {
            throw new HttpsError(
              "failed-precondition",
              "ガチャのカードプールが不正です。"
            );
          }

          // カードマスターをサーバーで取得
          const cardSnapshots = [];

          for (const cardId of cardIds) {
            const snapshot = await transaction.get(
              db.doc(`cards/${cardId}`)
            );
            cardSnapshots.push(snapshot);
          }

          const pools = Object.fromEntries(
            GACHA_RARITIES.map(rarity => [
              rarity, []
            ])
          );

          for (const snapshot of cardSnapshots) {
            if (!snapshot.exists) {
              throw new HttpsError(
                "failed-precondition",
                "排出対象に削除済みカードがあります。"
              );
            }

            const card = snapshot.data();

            if (
              !GACHA_RARITIES.includes(card.rarity)
            ) {
              throw new HttpsError(
                "failed-precondition",
                "カードのレアリティが不正です。"
              );
            }

            pools[card.rarity].push({
              id: snapshot.id,
              rarity: card.rarity,
              name: String(card.name || "")
            });
          }

          for (const rarity of GACHA_RARITIES) {
            if (
              weights[rarity] > 0 &&
              pools[rarity].length === 0
            ) {
              throw new HttpsError(
                "failed-precondition",
                `${rarity}の排出対象がありません。`
              );
            }
          }

          // ==================================
          // DRAW
          // ==================================

          const cards = drawCards(
            weights,
            pools,
            count
          );

          const quantities = new Map();

          for (const card of cards) {
            quantities.set(
              card.cardId,
              (quantities.get(card.cardId) || 0) + 1
            );
          }

          const remainingCoins =
            userData.coins - cost;

          // ==================================
          // WRITE PHASE
          // ==================================

          transaction.update(userRef, {
            coins: remainingCoins
          });

          for (const [cardId, quantity] of quantities) {
            const ownedRef = db.doc(
              `users/${uid}/ownedCards/${cardId}`
            );

            transaction.set(
              ownedRef,
              {
                quantity: FieldValue.increment(
                  quantity
                )
              },
              { merge: true }
            );
          }

          transaction.create(drawRef, {
            uid,
            gachaId,
            count,
            cost,
            remainingCoins,
            cards,
            createdAt: FieldValue.serverTimestamp()
          });

          return {
            success: true,
            replayed: false,
            gachaId,
            count,
            cost,
            remainingCoins,
            cards
          };
        }
      );

      return result;

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      console.error("drawGacha failed:", {
        uid,
        gachaId,
        count,
        error
      });

      throw new HttpsError(
        "internal",
        "ガチャ抽選に失敗しました。"
      );
    }
  }
);
