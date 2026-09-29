import { suitOf, type Suit, type Tile } from "./tiles";

export function isWinningHand(
  hand: readonly Tile[],
  missing: Suit,
  exposedMelds = 0,
): boolean {
  if (!Number.isInteger(exposedMelds) || exposedMelds < 0 || exposedMelds > 4)
    return false;
  if (hand.length !== 14 - 3 * exposedMelds) return false;
  const counts = Array<number>(27).fill(0);
  for (const item of hand) {
    if (
      !Number.isInteger(item) ||
      item < 0 ||
      item >= 27 ||
      suitOf(item) === missing
    )
      return false;
    counts[item] += 1;
    if (counts[item] > 4) return false;
  }
  if (exposedMelds === 0 && counts.every((count) => count % 2 === 0))
    return true;

  function meldsRemain(): boolean {
    const first = counts.findIndex((count) => count > 0);
    if (first === -1) return true;
    if (counts[first] >= 3) {
      counts[first] -= 3;
      if (meldsRemain()) return true;
      counts[first] += 3;
    }
    if (first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
      counts[first] -= 1;
      counts[first + 1] -= 1;
      counts[first + 2] -= 1;
      if (meldsRemain()) return true;
      counts[first] += 1;
      counts[first + 1] += 1;
      counts[first + 2] += 1;
    }
    return false;
  }

  for (let pair = 0; pair < 27; pair += 1) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    if (meldsRemain()) return true;
    counts[pair] += 2;
  }
  return false;
}

export function isBloodBattleOver(
  won: readonly boolean[],
  wallRemaining: number,
  pendingResponse: boolean,
): boolean {
  return (
    won.filter(Boolean).length >= 3 || (wallRemaining === 0 && !pendingResponse)
  );
}
