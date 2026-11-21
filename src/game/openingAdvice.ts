import { estimateShanten } from "./advice";
import { suitOf, type Suit, type Tile } from "./tiles";

export const SUITS: readonly Suit[] = ["wan", "tiao", "tong"];
export const SUIT_NAMES: Record<Suit, string> = {
  wan: "万",
  tiao: "条",
  tong: "筒",
};

export function meldKindLabel(sequences: number, triplets: number): string {
  if (sequences > 0 && triplets > 0) return "顺子/刻子";
  if (triplets > 0) return "刻子";
  return "顺子";
}

export function isEquivalentExchange(
  a: ExchangeAnalysis,
  b: ExchangeAnalysis,
): boolean {
  return (
    Math.abs(a.score - b.score) < 1e-9 &&
    a.plannedMissing.count === b.plannedMissing.count &&
    a.plannedMissing.retainedShanten === b.plannedMissing.retainedShanten &&
    a.plannedMissing.retainedMelds === b.plannedMissing.retainedMelds &&
    a.outPenalty === b.outPenalty
  );
}

export interface SuitStructure {
  count: number;
  melds: number;
  sequences: number;
  triplets: number;
  pairs: number;
  ryanmen: number;
  weakTaatsu: number;
  shapeScore: number;
}

export interface MissingAnalysis {
  suit: Suit;
  count: number;
  retainedCount: number;
  retainedShanten: number;
  cost: number;
  retainedMelds: number;
  retainedSequences: number;
  retainedTriplets: number;
  retainedEffectiveDraws: number;
  retainedShapeScore: number;
  droppedStructure: SuitStructure;
  dominantRetainedSuit: Suit;
  dominantRetainedCount: number;
  isTiedWithNext: boolean;
}

export interface ExchangeAnalysis {
  suit: Suit;
  tiles: Tile[];
  suitCountBefore: number;
  suitRemainingTiles: Tile[];
  suitRemainingStructure: SuitStructure;
  suitHadPair: boolean;
  suitHadMeld: boolean;
  plannedMissing: MissingAnalysis;
  dominantKeptSuit: Suit;
  dominantKeptCount: number;
  keptTwoSuitCount: number;
  outHasMeld: boolean;
  outHasPair: boolean;
  outPenalty: number;
  score: number;
  isTiedWithNext: boolean;
}

function rankBonus(rank: number): number {
  if (rank >= 3 && rank <= 5) return 2;
  if (rank === 2 || rank === 6) return 1;
  if (rank === 1 || rank === 7) return 0;
  return -1;
}

// 复合牌形加分（如 667、233 这类带对子且紧邻的形状比孤立对子更易成面子）。
function compoundConnectivity(tiles: readonly Tile[]): number {
  const counts = Array<number>(9).fill(0);
  for (const item of tiles) counts[item % 9] += 1;
  let bonus = 0;
  for (let rank = 0; rank < 9; rank += 1) {
    if (counts[rank] >= 2) {
      if (rank > 0 && counts[rank - 1] > 0) {
        bonus += rank >= 2 && rank <= 7 ? 2 : 1;
      }
      if (rank < 8 && counts[rank + 1] > 0) {
        bonus += rank >= 1 && rank <= 6 ? 2 : 1;
      }
    }
  }
  return bonus;
}

/** 拆解单门牌的面子、对子、两面与嵌边搭子结构。 */
export function analyzeSuitStructure(tiles: readonly Tile[]): SuitStructure {
  const counts = Array<number>(9).fill(0);
  for (const item of tiles) counts[item % 9] += 1;

  let best: Omit<SuitStructure, "count"> | undefined;

  function search(
    melds: number,
    sequences: number,
    triplets: number,
    pairs: number,
    ryanmen: number,
    weakTaatsu: number,
    singleBonus: number,
  ): void {
    const first = counts.findIndex((count) => count > 0);
    if (first < 0) {
      const shapeScore =
        melds * 12 + pairs * 6 + ryanmen * 5 + weakTaatsu * 3 + singleBonus;
      if (
        !best ||
        shapeScore > best.shapeScore ||
        (shapeScore === best.shapeScore && melds > best.melds) ||
        (shapeScore === best.shapeScore &&
          melds === best.melds &&
          pairs > best.pairs) ||
        (shapeScore === best.shapeScore &&
          melds === best.melds &&
          pairs === best.pairs &&
          ryanmen > best.ryanmen)
      ) {
        best = {
          melds,
          sequences,
          triplets,
          pairs,
          ryanmen,
          weakTaatsu,
          shapeScore,
        };
      }
      return;
    }

    if (counts[first] >= 3) {
      counts[first] -= 3;
      search(
        melds + 1,
        sequences,
        triplets + 1,
        pairs,
        ryanmen,
        weakTaatsu,
        singleBonus,
      );
      counts[first] += 3;
    }
    if (first <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
      counts[first] -= 1;
      counts[first + 1] -= 1;
      counts[first + 2] -= 1;
      search(
        melds + 1,
        sequences + 1,
        triplets,
        pairs,
        ryanmen,
        weakTaatsu,
        singleBonus,
      );
      counts[first] += 1;
      counts[first + 1] += 1;
      counts[first + 2] += 1;
    }
    if (counts[first] >= 2) {
      counts[first] -= 2;
      search(
        melds,
        sequences,
        triplets,
        pairs + 1,
        ryanmen,
        weakTaatsu,
        singleBonus,
      );
      counts[first] += 2;
    }
    if (first <= 7 && counts[first + 1] > 0) {
      const isRyanmen = first >= 1 && first <= 6;
      counts[first] -= 1;
      counts[first + 1] -= 1;
      search(
        melds,
        sequences,
        triplets,
        pairs,
        ryanmen + (isRyanmen ? 1 : 0),
        weakTaatsu + (isRyanmen ? 0 : 1),
        singleBonus,
      );
      counts[first] += 1;
      counts[first + 1] += 1;
    }
    if (first <= 6 && counts[first + 2] > 0) {
      counts[first] -= 1;
      counts[first + 2] -= 1;
      search(
        melds,
        sequences,
        triplets,
        pairs,
        ryanmen,
        weakTaatsu + 1,
        singleBonus,
      );
      counts[first] += 1;
      counts[first + 2] += 1;
    }
    counts[first] -= 1;
    search(
      melds,
      sequences,
      triplets,
      pairs,
      ryanmen,
      weakTaatsu,
      singleBonus + rankBonus(first),
    );
    counts[first] += 1;
  }

  search(0, 0, 0, 0, 0, 0, 0);
  const extra = compoundConnectivity(tiles);
  return {
    count: tiles.length,
    ...best!,
    shapeScore: best!.shapeScore + extra,
  };
}

function countEffectiveDraws(
  retained: readonly Tile[],
  missing: Suit,
  shanten: number,
  ownHand: readonly Tile[],
): number {
  const ownCounts = Array<number>(27).fill(0);
  for (const item of ownHand) ownCounts[item] += 1;
  let total = 0;
  for (let candidate = 0; candidate < 27; candidate += 1) {
    if (suitOf(candidate) === missing) continue;
    const remaining = 4 - ownCounts[candidate];
    if (remaining <= 0) continue;
    if (estimateShanten([...retained, candidate], 0, missing) < shanten) {
      total += remaining;
    }
  }
  return total;
}

function compareMissing(a: MissingAnalysis, b: MissingAnalysis): number {
  return (
    a.cost - b.cost ||
    a.retainedShanten - b.retainedShanten ||
    a.count - b.count ||
    b.retainedMelds - a.retainedMelds ||
    b.retainedEffectiveDraws - a.retainedEffectiveDraws ||
    b.retainedShapeScore - a.retainedShapeScore
  );
}

/** 评估定缺三门的清缺张数、保留两门向听、现成面子与进张宽度，返回由优到劣的排序。 */
export function analyzeMissingChoices(
  hand: readonly Tile[],
): MissingAnalysis[] {
  const bySuit: Record<Suit, Tile[]> = { wan: [], tiao: [], tong: [] };
  for (const item of hand) bySuit[suitOf(item)].push(item);

  const structures: Record<Suit, SuitStructure> = {
    wan: analyzeSuitStructure(bySuit.wan),
    tiao: analyzeSuitStructure(bySuit.tiao),
    tong: analyzeSuitStructure(bySuit.tong),
  };

  const ranked: MissingAnalysis[] = SUITS.map((suit) => {
    const count = bySuit[suit].length;
    const retained = hand.filter((item) => suitOf(item) !== suit);
    const retainedShanten = estimateShanten(retained, 0, suit);
    const otherSuits = SUITS.filter((other) => other !== suit);
    const retainedMelds =
      structures[otherSuits[0]].melds + structures[otherSuits[1]].melds;
    const retainedSequences =
      structures[otherSuits[0]].sequences + structures[otherSuits[1]].sequences;
    const retainedTriplets =
      structures[otherSuits[0]].triplets + structures[otherSuits[1]].triplets;
    const retainedShapeScore =
      structures[otherSuits[0]].shapeScore +
      structures[otherSuits[1]].shapeScore;
    const retainedEffectiveDraws = countEffectiveDraws(
      retained,
      suit,
      retainedShanten,
      hand,
    );
    const [firstOther, secondOther] = otherSuits;
    const dominantRetainedSuit =
      bySuit[firstOther].length >= bySuit[secondOther].length
        ? firstOther
        : secondOther;
    const dominantRetainedCount = bySuit[dominantRetainedSuit].length;

    return {
      suit,
      count,
      retainedCount: retained.length,
      retainedShanten,
      cost: Math.max(count, retainedShanten),
      retainedMelds,
      retainedSequences,
      retainedTriplets,
      retainedEffectiveDraws,
      retainedShapeScore,
      droppedStructure: structures[suit],
      dominantRetainedSuit,
      dominantRetainedCount,
      isTiedWithNext: false,
    };
  }).sort(
    (a, b) =>
      compareMissing(a, b) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit),
  );

  for (let index = 0; index < ranked.length - 1; index += 1) {
    ranked[index].isTiedWithNext =
      compareMissing(ranked[index], ranked[index + 1]) === 0;
  }
  return ranked;
}

export function chooseMissingSuit(hand: readonly Tile[]): Suit {
  return analyzeMissingChoices(hand)[0].suit;
}

function hasAnyPair(tiles: readonly Tile[]): boolean {
  const counts = Array<number>(9).fill(0);
  for (const item of tiles) {
    const rank = item % 9;
    counts[rank] += 1;
    if (counts[rank] >= 2) return true;
  }
  return false;
}

// 惩罚把完整面子、整对或连张打包送出（仅衡量本家送出的三张本身，不窥探对手）。
function outgoingCohesionPenalty(tiles: readonly Tile[]): {
  penalty: number;
  hasMeld: boolean;
  hasPair: boolean;
} {
  const structure = analyzeSuitStructure(tiles);
  const counts = Array<number>(9).fill(0);
  let middlePenalty = 0;
  for (const item of tiles) {
    const rank = item % 9;
    counts[rank] += 1;
    if (rankBonus(rank) > 0) middlePenalty += 1;
  }
  let pairAdjacent = 0;
  for (let rank = 0; rank < 9; rank += 1) {
    if (counts[rank] === 2) {
      if (
        (rank > 0 && counts[rank - 1] > 0) ||
        (rank < 8 && counts[rank + 1] > 0)
      ) {
        pairAdjacent += 2;
      }
    }
  }
  const penalty =
    structure.melds * 24 +
    structure.pairs * 12 +
    structure.ryanmen * 4 +
    structure.weakTaatsu * 2 +
    pairAdjacent +
    middlePenalty;
  return {
    penalty,
    hasMeld: structure.melds > 0,
    hasPair: structure.pairs > 0 || structure.triplets > 0,
  };
}

function compareTileTuple(a: readonly Tile[], b: readonly Tile[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function compareExchange(a: ExchangeAnalysis, b: ExchangeAnalysis): number {
  if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
  return (
    a.plannedMissing.count - b.plannedMissing.count ||
    a.plannedMissing.retainedShanten - b.plannedMissing.retainedShanten ||
    b.plannedMissing.retainedMelds - a.plannedMissing.retainedMelds ||
    a.outPenalty - b.outPenalty ||
    a.suitCountBefore - b.suitCountBefore ||
    compareTileTuple(a.tiles, b.tiles)
  );
}

/**
 * 结合主门保张、换后定缺清门成本、两门/清一色倾向以及不打包送出对子或成顺，
 * 返回每个可换花色（>=3张）的最佳三张方案，并按综合评估从优到劣排序。
 */
export function analyzeExchangeChoices(
  hand: readonly Tile[],
): ExchangeAnalysis[] {
  const sorted = [...hand].sort((a, b) => a - b);
  const bestBySuit: ExchangeAnalysis[] = [];

  for (const suit of SUITS) {
    const suited = sorted.filter((item) => suitOf(item) === suit);
    if (suited.length < 3) continue;
    const suitStructureBefore = analyzeSuitStructure(suited);
    const suitHadPair = hasAnyPair(suited);
    const suitHadMeld = suitStructureBefore.melds > 0;
    const seen = new Set<string>();
    let bestInSuit: ExchangeAnalysis | undefined;

    for (let first = 0; first < suited.length - 2; first += 1) {
      for (let second = first + 1; second < suited.length - 1; second += 1) {
        for (let third = second + 1; third < suited.length; third += 1) {
          const tiles = [suited[first], suited[second], suited[third]];
          const key = tiles.join(",");
          if (seen.has(key)) continue;
          seen.add(key);

          const after = [...sorted];
          for (const chosen of tiles) {
            after.splice(after.indexOf(chosen), 1);
          }

          const missingPlans = analyzeMissingChoices(after);
          const suitRemainingTiles = after.filter(
            (item) => suitOf(item) === suit,
          );
          const suitRemainingStructure =
            analyzeSuitStructure(suitRemainingTiles);
          const outgoing = outgoingCohesionPenalty(tiles);

          let bestPlanScore = -Infinity;
          let plannedMissing = missingPlans[0];
          for (const plan of missingPlans) {
            const domCount = plan.dominantRetainedCount;
            // 清一色与主门保张倾向：主门达到 8 张以上时重点避免拆主门；6~7 张也适度护主门。
            const flushBonus = domCount >= 8 ? (domCount - 7) * 8 : 0;
            const mainSuitBonus = domCount >= 6 ? (domCount - 5) * 1.5 : 0;
            // 仅在计划定缺当前花色时，给该门留牌记“万一换回同门”的备用结构分，避免重复计分。
            const backupRemCredit =
              plan.suit === suit && suitRemainingTiles.length >= 2
                ? suitRemainingStructure.shapeScore * 0.45
                : 0;
            const planScore =
              -plan.count * 16 -
              plan.retainedShanten * 10 +
              plan.retainedMelds * 5 +
              plan.retainedEffectiveDraws * 0.25 +
              plan.retainedShapeScore * 0.35 +
              flushBonus +
              mainSuitBonus +
              backupRemCredit -
              outgoing.penalty * 0.45;
            if (planScore > bestPlanScore) {
              bestPlanScore = planScore;
              plannedMissing = plan;
            }
          }

          const dominantKeptSuit = plannedMissing.dominantRetainedSuit;
          const dominantKeptCount = plannedMissing.dominantRetainedCount;
          const keptTwoSuitCount = plannedMissing.retainedCount;
          const score = bestPlanScore;

          const candidate: ExchangeAnalysis = {
            suit,
            tiles,
            suitCountBefore: suited.length,
            suitRemainingTiles,
            suitRemainingStructure,
            suitHadPair,
            suitHadMeld,
            plannedMissing,
            dominantKeptSuit,
            dominantKeptCount,
            keptTwoSuitCount,
            outHasMeld: outgoing.hasMeld,
            outHasPair: outgoing.hasPair,
            outPenalty: outgoing.penalty,
            score,
            isTiedWithNext: false,
          };

          if (!bestInSuit || compareExchange(candidate, bestInSuit) < 0) {
            bestInSuit = candidate;
          }
        }
      }
    }

    if (bestInSuit) bestBySuit.push(bestInSuit);
  }

  bestBySuit.sort(compareExchange);
  for (let index = 0; index < bestBySuit.length - 1; index += 1) {
    bestBySuit[index].isTiedWithNext = isEquivalentExchange(
      bestBySuit[index],
      bestBySuit[index + 1],
    );
  }
  return bestBySuit;
}

/** 在合法同门三张中，综合清缺成本、主门与成组保留、两门/清一色倾向选出推荐换牌。 */
export function chooseStructureExchange(hand: readonly Tile[]): Tile[] {
  const choices = analyzeExchangeChoices(hand);
  if (!choices.length) throw new Error("无法选择换三张");
  return choices[0].tiles;
}
