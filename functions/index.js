
"use strict";

// ========================================
// RASH MASTERS SERVER - STEP 3-E
// ========================================

const { randomInt } = require("node:crypto");

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  initializeApp
} = require("firebase-admin/app");

const {
  getFirestore,
  FieldValue
} = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

// ========================================
// CONFIG
// ========================================

const REGION = "asia-northeast1";
const INITIAL_COINS = 1000;
const MAX_COINS = Number.MAX_SAFE_INTEGER;
const MAX_OWNED = 999999;
const MAX_POOL = 200;
const MAX_COST = 100000000;

const RARITIES = ["N", "R", "SR", "SSR", "UR"];

const RATE_SCALE = 10000;
const RATE_TOTAL = 100 * RATE_SCALE;

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ========================================
// ADMIN INITIAL COIN EXCEPTIONS
// ========================================

// Firebase AuthenticationのUIDを設定する。
// メールアドレスではない。
//
// UID未設定の状態では、既存coins:0の
// adminには自動配布されない。
//
// 配布対象であることを確認済みの
// 2アカウントだけを登録する。
//
// 例:
// const APPROVED_ADMIN_UIDS = new Set([
//   "実際のadmin1のUID",
//   "実際のadmin2のUID"
// ]);

const APPROVED_ADMIN_UIDS = new Set([
  "3DWj2gTWdaej2SoER8MfaGQkF9r1",
  "G0l9PoM8fBT6taa1DLcN32FbMEs1"
]);

// ========================================
// COMMON HELPERS
// ========================================

function requireUid(request) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "ログインが必要です。"
    );
  }

  return uid;
}

function fail(message, code = "failed-precondition") {
  throw new HttpsError(code, message);
}

function validCoins(value) {
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_COINS;
}

function validCost(value) {
  return Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_COST;
}

function hasField(data, key) {
  return Object.prototype.hasOwnProperty.call(
    data,
    key
  );
}

// ========================================
// INITIAL COIN GRANT
// ========================================

exports.initializePlayerCoins = onCall(
  {
    region: REGION,
    enforceAppCheck: false,
    maxInstances: 10
  },
  async request => {
    const uid = requireUid(request);

    const userRef = db.doc(`users/${uid}`);

    const grantRef = db.doc(
      `coinGrantLogs/initial_${uid}`
    );

    try {
      const result = await db.runTransaction(
        async tx => {
          // READ PHASE
          const userSnap = await tx.get(userRef);
          const grantSnap = await tx.get(grantRef);

          if (!userSnap.exists) {
            fail(
              "プレイヤープロフィールがありません。" +
              "ホーム画面でログインしてください。"
            );
          }

          const user = userSnap.data();

          if (user.uid !== uid) {
            fail("プレイヤー情報が不正です。");
          }

          // すでに配布済み
          if (grantSnap.exists) {
            const log = grantSnap.data();

            if (
              log.uid !== uid ||
              log.reason !== "INITIAL_BONUS" ||
              log.amount !== INITIAL_COINS ||
              user.initialCoinsGranted !== true ||
              !validCoins(user.coins)
            ) {
              fail(
                "初期コイン情報に不整合があります。" +
                "運営に確認してください。"
              );
            }

            return {
              success: true,
              granted: false,
              coins: user.coins
            };
          }

          const hasCoins = hasField(
            user,
            "coins"
          );

          const hasFlag = hasField(
            user,
            "initialCoinsGranted"
          );

          // 配布フラグだけ存在する場合も停止
          if (hasFlag) {
            fail(
              "初期配布状態の確認が必要です。"
            );
          }

          // 通常プレイヤー:
          // coinsフィールドがない場合のみ
          // 初期ボーナスを付与
          const normalEligible = !hasCoins;

          // 承認済みadmin:
          // coinsが正確に0で、
          // 配布履歴とフラグがない場合のみ
          // 例外的に付与
          const adminEligible =
            APPROVED_ADMIN_UIDS.has(uid) &&
            hasCoins &&
            user.coins === 0;

          if (
            !normalEligible &&
            !adminEligible
          ) {
            fail(
              "既存のコイン残高があります。" +
              "自動配布せず運営が確認します。"
            );
          }

          // WRITE PHASE
          tx.update(userRef, {
            coins: INITIAL_COINS,
            initialCoinsGranted: true
          });

          tx.create(grantRef, {
            uid,
            amount: INITIAL_COINS,
            reason: "INITIAL_BONUS",
            createdAt: FieldValue.serverTimestamp()
          });

          return {
            success: true,
            granted: true,
            coins: INITIAL_COINS
          };
        }
      );

      return result;

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      console.error(
        "initializePlayerCoins error",
        { uid, error }
      );

      fail(
        "初期コインの処理に失敗しました。",
        "internal"
      );
    }
  }
);

// ========================================
// RATE VALIDATION
// ========================================

function validateRates(rates) {
  if (
    !rates ||
    typeof rates !== "object" ||
    Array.isArray(rates)
  ) {
    fail("排出率の設定がありません。");
  }

  const weights = {};
  let total = 0;

  for (const rarity of RARITIES) {
    const rate = rates[rarity];

    if (
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    ) {
      fail(`${rarity}の排出率が不正です。`);
    }

    const scaled = rate * RATE_SCALE;
    const rounded = Math.round(scaled);

    if (
      Math.abs(scaled - rounded) > 0.000001
    ) {
      fail(
        "排出率は小数第4位までにしてください。"
      );
    }

    weights[rarity] = rounded;
    total += rounded;
  }

  if (total !== RATE_TOTAL) {
    fail("排出率の合計が100%ではありません。");
  }

  return weights;
}

// ========================================
// SECURE RANDOM
// ========================================

function chooseRarity(weights) {
  const value = randomInt(RATE_TOTAL);

  let total = 0;

  for (const rarity of RARITIES) {
    total += weights[rarity];

    if (value < total) {
      return rarity;
    }
  }

  throw new Error("Rarity selection failed");
}

function chooseCards(weights, pools, count) {
  const result = [];

  for (let i = 0; i < count; i++) {
    const rarity = chooseRarity(weights);
    const candidates = pools[rarity];

    if (!candidates?.length) {
      fail(`${rarity}の排出カードがありません。`);
    }

    const card = candidates[
      randomInt(candidates.length)
    ];

    result.push({
      cardId: card.cardId,
      name: card.name,
      rarity: card.rarity
    });
  }

  return result;
}

// ========================================
// GACHA DRAW
// ========================================

exports.drawGacha = onCall(
  {
    region: REGION,
    enforceAppCheck: false,
    maxInstances: 10
  },
  async request => {
    const uid = requireUid(request);

    const input = request.data || {};

    const {
      gachaId,
      count,
      requestId
    } = input;

    if (
      typeof gachaId !== "string" ||
      !ID_PATTERN.test(gachaId)
    ) {
      fail("ガチャIDが不正です。", "invalid-argument");
    }

    if (count !== 1 && count !== 10) {
      fail(
        "抽選回数は1回か10回のみです。",
        "invalid-argument"
      );
    }

    if (
      typeof requestId !== "string" ||
      !UUID_PATTERN.test(requestId)
    ) {
      fail(
        "リクエストIDが不正です。",
        "invalid-argument"
      );
    }

    const userRef = db.doc(`users/${uid}`);

    const gachaRef = db.doc(
      `gachaBanners/${gachaId}`
    );

    const drawRef = db.doc(
      `users/${uid}/gachaDraws/${requestId}`
    );

    try {
      return await db.runTransaction(
        async tx => {

          // ==================================
          // READ: PREVIOUS DRAW
          // ==================================

          const previousSnap = await tx.get(drawRef);

          if (previousSnap.exists) {
            const previous = previousSnap.data();

            if (
              previous.uid !== uid ||
              previous.gachaId !== gachaId ||
              previous.count !== count ||
              !validCost(previous.cost) ||
              !validCoins(previous.remainingCoins) ||
              !Array.isArray(previous.cards) ||
              previous.cards.length !== count
            ) {
              fail(
                "リクエストIDが別の抽選に使用済みです。",
                "already-exists"
              );
            }

            return {
              success: true,
              replayed: true,
              gachaId,
              count,
              cost: previous.cost,
              remainingCoins: previous.remainingCoins,
              cards: previous.cards
            };
          }

          // ==================================
          // READ: USER AND BANNER
          // ==================================

          const userSnap = await tx.get(userRef);
          const gachaSnap = await tx.get(gachaRef);

          if (!userSnap.exists) {
            fail("プレイヤーが見つかりません。");
          }

          if (!gachaSnap.exists) {
            fail("ガチャが見つかりません。", "not-found");
          }

          const user = userSnap.data();
          const gacha = gachaSnap.data();

          if (
            user.initialCoinsGranted !== true ||
            !validCoins(user.coins)
          ) {
            fail("コイン初期化が必要です。");
          }

          if (gacha.enabled !== true) {
            fail("このガチャは公開されていません。");
          }

          const cost = count === 1
            ? gacha.singleCost
            : gacha.tenCost;

          if (!validCost(cost)) {
            fail("ガチャ価格が不正です。");
          }

          if (user.coins < cost) {
            fail("コインが不足しています。");
          }

          const weights = validateRates(gacha.rates);

          const cardIds = gacha.cardPool;

          if (
            !Array.isArray(cardIds) ||
            cardIds.length < 1 ||
            cardIds.length > MAX_POOL ||
            new Set(cardIds).size !== cardIds.length ||
            cardIds.some(
              id => typeof id !== "string" ||
                !ID_PATTERN.test(id)
            )
          ) {
            fail("カードプールが不正です。");
          }

          // ==================================
          // READ: CARD MASTER
          // ==================================

          const cardRefs = cardIds.map(
            id => db.doc(`cards/${id}`)
          );

          
          const cardSnaps = [];
            for (const cardRef of cardRefs) {
            const cardSnap = await tx.get(cardRef);
            cardSnaps.push(cardSnap);
          }


          const pools = Object.fromEntries(
            RARITIES.map(rarity => [
              rarity, []
            ])
          );

          for (const snapshot of cardSnaps) {
            if (!snapshot.exists) {
              fail(
                "削除済みカードが含まれています。"
              );
            }

            const card = snapshot.data();

            if (
              !RARITIES.includes(card.rarity) ||
              typeof card.name !== "string" ||
              card.name.length < 1
            ) {
              fail("カードマスターが不正です。");
            }

            pools[card.rarity].push({
              cardId: snapshot.id,
              name: card.name,
              rarity: card.rarity
            });
          }

          for (const rarity of RARITIES) {
            if (
              weights[rarity] > 0 &&
              pools[rarity].length === 0
            ) {
              fail(
                `${rarity}の排出対象がありません。`
              );
            }
          }

          // ==================================
          // RANDOM DRAW
          // ==================================

          const cards = chooseCards(
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

          // ==================================
          // READ: OWNED CARDS
          // ==================================

          const ownedUpdates = [];

          for (const [cardId, added] of quantities) {
            const ownedRef = db.doc(
              `users/${uid}/ownedCards/${cardId}`
            );

            const ownedSnap = await tx.get(ownedRef);

            const oldQuantity = ownedSnap.exists
              ? ownedSnap.data().quantity
              : 0;

            if (
              !Number.isSafeInteger(oldQuantity) ||
              oldQuantity < 0 ||
              oldQuantity + added > MAX_OWNED
            ) {
              fail(
                "所持カードの枚数が不正、" +
                "または上限に達しています。"
              );
            }

            const card = cards.find(
              item => item.cardId === cardId
            );

            ownedUpdates.push({
              ref: ownedRef,
              cardId,
              cardName: card.name,
              rarity: card.rarity,
              quantity: oldQuantity + added
            });
          }

          const remainingCoins =
            user.coins - cost;

          // ==================================
          // WRITE PHASE
          // ==================================

          tx.update(userRef, {
            coins: remainingCoins
          });

          for (const item of ownedUpdates) {
            tx.set(
              item.ref,
              {
                cardId: item.cardId,
                cardName: item.cardName,
                rarity: item.rarity,
                quantity: item.quantity,
                updatedAt:
                  FieldValue.serverTimestamp()
              },
              { merge: true }
            );
          }

          tx.create(drawRef, {
            uid,
            gachaId,
            count,
            cost,
            remainingCoins,
            cards,
            createdAt:
              FieldValue.serverTimestamp()
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

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      console.error(
        "drawGacha error",
        {
          uid,
          gachaId,
          count,
          error
        }
      );

      fail(
        "ガチャ抽選に失敗しました。",
        "internal"
      );
    }
  }
);
