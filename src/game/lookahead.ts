import { publicCounts } from "./advice";
import { isWinningHand } from "./rules";
import { waitingTiles } from "./scoring";
import { suitOf, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface NextDrawEstimate {
  tile: Tile;
  drawsConsidered: number;
  winningDraws: number;
  twoDrawWinChance: number;
}

// 仅枚举行动时尚未见到的牌。未见牌也可能在对手暗牌中，
// 因此结果是均匀未知牌模型下的两摸牌效估计，不是实际牌墙概率。
export function analyzeNextDraw(
  view: PlayerView,
  candidates: readonly Tile[],
): NextDrawEstimate[] {
  if (
    !view.missing ||
    view.wallRemaining < 2 ||
    view.hand.some((tile) => suitOf(tile) === view.missing)
  )
    return [];

  const seen = publicCounts(view);
  const unseen = seen.map((count) => Math.max(0, 4 - count));
  const drawsConsidered = unseen.reduce((sum, count) => sum + count, 0);
  if (!drawsConsidered) return [];

  return [...new Set(candidates)]
    .filter(
      (tile) => view.legalDiscards.includes(tile) && view.hand.includes(tile),
    )
    .map((tile) => {
      const after = [...view.hand];
      after.splice(after.indexOf(tile), 1);
      let winningDraws = 0;
      let winningDrawPairs = 0;
      const waitingCache = new Map<string, Tile[]>();

      unseen.forEach((copies, drawn) => {
        if (!copies) return;
        const future = [...after, drawn as Tile];
        if (isWinningHand(future, view.missing!, view.melds.length)) {
          winningDraws += copies;
          winningDrawPairs += copies * Math.max(0, drawsConsidered - 1);
        } else {
          const legal =
            suitOf(drawn as Tile) === view.missing
              ? [drawn as Tile]
              : [...new Set(future)];
          let bestSecondWinning = 0;
          for (const discard of legal) {
            const remainder = [...future];
            remainder.splice(remainder.indexOf(discard), 1);
            const key = [...remainder].sort((a, b) => a - b).join(",");
            let waits = waitingCache.get(key);
            if (!waits) {
              waits = waitingTiles(remainder, view.melds, view.missing!).tiles;
              waitingCache.set(key, waits);
            }
            const secondWinning = waits.reduce(
              (sum, wait) => sum + unseen[wait] - Number(wait === drawn),
              0,
            );
            bestSecondWinning = Math.max(bestSecondWinning, secondWinning);
          }
          winningDrawPairs += copies * bestSecondWinning;
        }
      });

      return {
        tile,
        drawsConsidered,
        winningDraws,
        twoDrawWinChance:
          drawsConsidered > 1
            ? winningDrawPairs / (drawsConsidered * (drawsConsidered - 1))
            : winningDraws / drawsConsidered,
      };
    });
}
