import { estimateShanten, publicCounts } from "./advice";
import { evaluateWin, waitingTiles, type Meld } from "./scoring";
import { analyzeScoredDraws } from "./teacherEvaluation";
import { suitOf, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface CandidateDrawEstimate {
  tile: Tile;
  normalDraws: 0 | 1 | 2;
  winChance: number;
  value: number;
}

export function candidatePublicCounts(view: PlayerView): number[] {
  const counts = publicCounts(view);
  for (const exposed of view.publicTiles ?? []) {
    if (exposed.kind === "self-win" && exposed.seat !== view.seat)
      counts[exposed.tile] += 1;
  }
  return counts;
}

const waitCache = new Map<string, ReturnType<typeof waitingTiles>>();
const shantenCache = new Map<string, number>();
const CACHE_LIMIT = 8000;

function keyFor(hand: readonly Tile[], melds: readonly Meld[], missing: Suit) {
  const meldKey = melds
    .map((meld) => `${meld.type}:${meld.tile}`)
    .sort()
    .join(";");
  return `${missing}:${meldKey}:${[...hand].sort((a, b) => a - b).join(",")}`;
}

// 这里只检查本家持牌的四张上限，不剔除已公开出尽的牌；V1查叫按理论等待。
export function candidateWaits(
  hand: readonly Tile[],
  melds: readonly Meld[],
  missing: Suit,
): ReturnType<typeof waitingTiles> {
  const key = keyFor(hand, melds, missing);
  const known = waitCache.get(key);
  if (known) return known;
  const waits = waitingTiles(hand, melds, missing);
  if (waitCache.size >= CACHE_LIMIT)
    waitCache.delete(waitCache.keys().next().value!);
  waitCache.set(key, waits);
  return waits;
}

// 精确纠正的是“0向听却无合法等待”；大于0的距离仍沿用原结构粗估。
export function estimateCandidateShanten(
  hand: readonly Tile[],
  melds: readonly Meld[],
  missing: Suit,
): number {
  const structural = estimateShanten(hand, melds.length, missing);
  if (
    structural > 0 ||
    (hand.length !== 13 - 3 * melds.length &&
      hand.length !== 14 - 3 * melds.length)
  )
    return structural;
  const key = keyFor(hand, melds, missing);
  const known = shantenCache.get(key);
  if (known !== undefined) return known;

  let corrected = 1;
  if (hand.length === 13 - 3 * melds.length) {
    corrected = candidateWaits(hand, melds, missing).tiles.length ? 0 : 1;
  } else if (evaluateWin(hand, melds, missing)) {
    corrected = -1;
  } else {
    const legal = hand.filter((tile) => suitOf(tile) === missing);
    for (const chosen of new Set(legal.length ? legal : hand)) {
      const after = [...hand];
      after.splice(after.indexOf(chosen), 1);
      if (candidateWaits(after, melds, missing).tiles.length) {
        corrected = 0;
        break;
      }
    }
  }
  if (shantenCache.size >= CACHE_LIMIT)
    shantenCache.delete(shantenCache.keys().next().value!);
  shantenCache.set(key, corrected);
  return corrected;
}

// 当前弃牌之后，假设没有碰杠、玩家退出或改序；不是所有合法后续的精确上限。
export function normalDrawBudget(view: PlayerView): 0 | 1 | 2 {
  const livePlayers =
    1 + view.opponents.filter((opponent) => !opponent.won).length;
  return Math.max(
    0,
    Math.min(2, Math.floor(view.wallRemaining / livePlayers)),
  ) as 0 | 1 | 2;
}

function modelView(view: PlayerView): PlayerView {
  const exposed = (view.publicTiles ?? []).filter(
    (entry) => entry.kind === "self-win" && entry.seat !== view.seat,
  );
  if (!exposed.length) return view;
  // 评分器只用该数组计可见张数。这些胡张仍是手牌，投影不写回真实弃牌。
  return {
    ...view,
    opponents: view.opponents.map((opponent) => ({
      ...opponent,
      discards: [
        ...opponent.discards,
        ...exposed
          .filter((entry) => entry.seat === opponent.seat)
          .map((entry) => entry.tile),
      ],
    })),
  };
}

export function analyzeCandidateDraws(
  view: PlayerView,
  candidates: readonly Tile[],
): CandidateDrawEstimate[] {
  if (!view.missing || view.hand.some((tile) => suitOf(tile) === view.missing))
    return [];
  const normalDraws = normalDrawBudget(view);
  if (!normalDraws) {
    return [...new Set(candidates)]
      .filter(
        (tile) => view.legalDiscards.includes(tile) && view.hand.includes(tile),
      )
      .map((tile) => ({ tile, normalDraws, winChance: 0, value: 0 }));
  }
  return analyzeScoredDraws(
    { ...modelView(view), wallRemaining: normalDraws },
    candidates,
  ).map((estimate) => ({
    tile: estimate.tile,
    normalDraws,
    winChance:
      normalDraws === 1 ? estimate.oneDrawWinChance : estimate.twoDrawWinChance,
    value: normalDraws === 1 ? estimate.oneDrawValue : estimate.twoDrawValue,
  }));
}
