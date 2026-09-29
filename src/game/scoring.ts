import { isWinningHand } from "./rules";
import { suitOf, type Suit, type Tile } from "./tiles";

export interface Meld {
  type: "pung" | "kong";
  tile: Tile;
  from: number | null;
  kongKind?: "direct" | "concealed" | "added";
}

export interface WinContext {
  kongFlower?: boolean;
  kongShot?: boolean;
  robKong?: boolean;
  seaBottom?: boolean;
}

export interface WinEvaluation {
  fan: number;
  points: number;
  patterns: string[];
}

function allTriplets(counts: readonly number[]): boolean {
  for (let pair = 0; pair < 27; pair += 1) {
    if (counts[pair] < 2) continue;
    if (
      counts.every(
        (count, index) => (index === pair ? count - 2 : count) % 3 === 0,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function evaluateWin(
  concealed: readonly Tile[],
  melds: readonly Meld[],
  missing: Suit,
  context: WinContext = {},
  fanCap = 3,
): WinEvaluation | null {
  if (!isWinningHand(concealed, missing, melds.length)) return null;
  const counts = Array<number>(27).fill(0);
  for (const item of concealed) counts[item] += 1;
  for (const meld of melds) counts[meld.tile] += meld.type === "kong" ? 4 : 3;
  if (counts.some((count) => count > 4)) return null;

  const sevenPairs =
    melds.length === 0 && counts.every((count) => count % 2 === 0);
  const tripletShape = allTriplets(
    Array.from(
      { length: 27 },
      (_, index) => concealed.filter((item) => item === index).length,
    ),
  );
  const patterns: string[] = [];
  let fan = 0;
  if (sevenPairs) {
    patterns.push("七对");
    fan += 2;
  } else if (tripletShape) {
    patterns.push("对对胡");
    fan += 1;
  } else {
    patterns.push("平胡");
  }
  const usedSuits = new Set<number>();
  counts.forEach((count, index) => {
    if (count) usedSuits.add(Math.floor(index / 9));
  });
  if (usedSuits.size === 1) {
    patterns.push("清一色");
    fan += 2;
  }
  const roots = counts.filter((count) => count === 4).length;
  if (roots) {
    patterns.push(roots === 1 ? "根" : `根×${roots}`);
    fan += roots;
  }
  const extras: { key: keyof WinContext; name: string }[] = [
    { key: "kongFlower", name: "杠上花" },
    { key: "kongShot", name: "杠后炮" },
    { key: "robKong", name: "抢杠胡" },
    { key: "seaBottom", name: "海底胡" },
  ];
  for (const extra of extras) {
    if (context[extra.key]) {
      patterns.push(extra.name);
      fan += 1;
    }
  }
  return { fan, points: 2 ** Math.min(fan, fanCap), patterns };
}

export function waitingTiles(
  hand: readonly Tile[],
  melds: readonly Meld[],
  missing: Suit,
  fanCap = 3,
): { tiles: Tile[]; maxPoints: number } {
  const tiles: Tile[] = [];
  let maxPoints = 0;
  for (let candidate = 0; candidate < 27; candidate += 1) {
    if (suitOf(candidate) === missing) continue;
    const evaluation = evaluateWin(
      [...hand, candidate],
      melds,
      missing,
      {},
      fanCap,
    );
    if (evaluation) {
      tiles.push(candidate);
      maxPoints = Math.max(maxPoints, evaluation.points);
    }
  }
  return { tiles, maxPoints };
}
