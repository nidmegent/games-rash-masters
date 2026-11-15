
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
