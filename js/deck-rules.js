
export const DECK_SIZE = 10;
export const MAX_SAME_CARD = 3;

/**
 * cards の形式:
 * [
 *   { cardId: "card001", count: 3 },
 *   { cardId: "card002", count: 2 }
 * ]
 */
export function validateDeck(cards) {
  if (!Array.isArray(cards)) {
    return { valid: false, message: "デッキデータが不正です。" };
  }

  const counts = new Map();

  for (const item of cards) {
    if (
      !item ||
      typeof item.cardId !== "string" ||
      !item.cardId.trim() ||
      !Number.isInteger(item.count) ||
      item.count < 1
    ) {
      return { valid: false, message: "カード情報が不正です。" };
    }

    counts.set(
      item.cardId,
      (counts.get(item.cardId) || 0) + item.count
    );
  }

  const total = [...counts.values()].reduce(
    (sum, count) => sum + count,
    0
  );

  if (total !== DECK_SIZE) {
    return {
      valid: false,
      message: `デッキは${DECK_SIZE}枚ちょうどにしてください。現在${total}枚です。`
    };
  }

  if ([...counts.values()].some(count => count > MAX_SAME_CARD)) {
    return {
      valid: false,
      message: `同じカードは最大${MAX_SAME_CARD}枚までです。`
    };
  }

  return { valid: true, message: "使用可能なデッキです。" };
}
