import { publicCounts } from "./advice";
import { evaluateWin, type Meld } from "./scoring";
import { suitOf, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface ScoredDrawEstimate {
  tile: Tile;
  drawsConsidered: number;
  winningDraws: number;
  oneDrawWinChance: number;
  oneDrawValue: number;
  twoDrawWinChance: number;
  twoDrawValue: number;
}

interface ScoredWait {
  tile: Tile;
  points: number;
}

const waitCache = new Map<string, readonly ScoredWait[]>();
const WAIT_CACHE_LIMIT = 4000;

function scoredWaits(
  hand: readonly Tile[],
  melds: readonly Meld[],
  missing: Suit,
  meldKey: string,
): readonly ScoredWait[] {
  const key = `${missing}:${meldKey}:${[...hand].sort((a, b) => a - b).join(",")}`;
  const known = waitCache.get(key);
  if (known) return known;

  const waits: ScoredWait[] = [];
  for (let drawn = 0; drawn < 27; drawn += 1) {
    if (suitOf(drawn) === missing) continue;
    const result = evaluateWin([...hand, drawn], melds, missing);
    if (result) waits.push({ tile: drawn, points: result.points });
  }
  if (waitCache.size >= WAIT_CACHE_LIMIT)
    waitCache.delete(waitCache.keys().next().value!);
  waitCache.set(key, waits);
  return waits;
}

// 所有未见牌均匀抽取，不预测对手暗牌、碰杠、点炮或轮转造成的抢先胡牌。
// value 是本桌自摸收入的模型加权值：未胡对手每家支付 points + 1。
// 使用默认三番封顶，不预测未来杠上花/海底等上下文加番；chance 也不是校准过的实战概率。
// 第一摸成胡立即停止，否则选第二摸收益最高的合法弃牌延续。
export function analyzeScoredDraws(
  view: PlayerView,
  candidates: readonly Tile[],
): ScoredDrawEstimate[] {
  if (
    !view.missing ||
    view.wallRemaining < 1 ||
    view.hand.some((tile) => suitOf(tile) === view.missing)
  )
    return [];

  const missing = view.missing;
  const unseen = publicCounts(view).map((count) => Math.max(0, 4 - count));
  const drawsConsidered = unseen.reduce((sum, copies) => sum + copies, 0);
  if (!drawsConsidered) return [];
  const payers = view.opponents.filter((opponent) => !opponent.won).length;
  const meldKey = view.melds
    .map((meld) => `${meld.type}:${meld.tile}`)
    .sort()
    .join(";");

  return [...new Set(candidates)]
    .filter(
      (tile) => view.legalDiscards.includes(tile) && view.hand.includes(tile),
    )
    .map((tile) => {
      const after = [...view.hand];
      after.splice(after.indexOf(tile), 1);
      const firstWaits = scoredWaits(after, view.melds, missing, meldKey);
      const firstPoints = new Map(
        firstWaits.map((wait) => [wait.tile, wait.points]),
      );
      let winningDraws = 0;
      let firstWeightedValue = 0;
      for (const wait of firstWaits) {
        winningDraws += unseen[wait.tile];
        firstWeightedValue += unseen[wait.tile] * payers * (wait.points + 1);
      }
      const oneDrawWinChance = winningDraws / drawsConsidered;
      const oneDrawValue = firstWeightedValue / drawsConsidered;
      if (view.wallRemaining === 1 || drawsConsidered === 1) {
        return {
          tile,
          drawsConsidered,
          winningDraws,
          oneDrawWinChance,
          oneDrawValue,
          twoDrawWinChance: oneDrawWinChance,
          twoDrawValue: oneDrawValue,
        };
      }

      let winningDrawPairs = 0;
      let weightedPairValue = 0;
      unseen.forEach((copies, drawn) => {
        if (!copies) return;
        const winPoints = firstPoints.get(drawn);
        if (winPoints !== undefined) {
          winningDrawPairs += copies * (drawsConsidered - 1);
          weightedPairValue +=
            copies * (drawsConsidered - 1) * payers * (winPoints + 1);
          return;
        }

        const future = [...after, drawn];
        const legal =
          suitOf(drawn) === missing ? [drawn] : [...new Set(future)];
        let bestSecondValue = 0;
        let bestSecondWinning = 0;
        for (const discard of legal) {
          const remainder = [...future];
          remainder.splice(remainder.indexOf(discard), 1);
          const waits = scoredWaits(remainder, view.melds, missing, meldKey);
          let secondWinning = 0;
          let secondValue = 0;
          for (const wait of waits) {
            const remaining = unseen[wait.tile] - Number(wait.tile === drawn);
            secondWinning += remaining;
            secondValue += remaining * payers * (wait.points + 1);
          }
          if (
            secondValue > bestSecondValue ||
            (secondValue === bestSecondValue &&
              secondWinning > bestSecondWinning)
          ) {
            bestSecondValue = secondValue;
            bestSecondWinning = secondWinning;
          }
        }
        winningDrawPairs += copies * bestSecondWinning;
        weightedPairValue += copies * bestSecondValue;
      });

      const drawPairs = drawsConsidered * (drawsConsidered - 1);
      return {
        tile,
        drawsConsidered,
        winningDraws,
        oneDrawWinChance,
        oneDrawValue,
        twoDrawWinChance: winningDrawPairs / drawPairs,
        twoDrawValue: weightedPairValue / drawPairs,
      };
    });
}
