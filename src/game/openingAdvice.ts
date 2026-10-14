import { suitOf, type Tile } from "./tiles";

// 只衡量同门牌的局部联系；分数不是向听数或交换后的胜率。
function connectionScore(tiles: readonly Tile[]): number {
  const counts = Array<number>(9).fill(0);
  for (const value of tiles) counts[value % 9] += 1;
  let score = 0;
  for (let rank = 0; rank < 9; rank += 1) {
    score += (counts[rank] * (counts[rank] - 1) * 4) / 2;
    if (rank < 8) score += counts[rank] * counts[rank + 1] * 2;
    if (rank < 7) score += counts[rank] * counts[rank + 2];
  }
  return score;
}

/** 在合法同门三张中，选择最少拆散对子、邻张和隔张联系的组合。 */
export function chooseStructureExchange(hand: readonly Tile[]): Tile[] {
  const sorted = [...hand].sort((a, b) => a - b);
  let best: { loss: number; suitCount: number; tiles: Tile[] } | undefined;
  for (const suit of ["wan", "tiao", "tong"] as const) {
    const suited = sorted.filter((item) => suitOf(item) === suit);
    if (suited.length < 3) continue;
    const before = connectionScore(suited);
    for (let first = 0; first < suited.length - 2; first += 1) {
      for (let second = first + 1; second < suited.length - 1; second += 1) {
        for (let third = second + 1; third < suited.length; third += 1) {
          const tiles = [suited[first], suited[second], suited[third]];
          const remaining = suited.filter(
            (_, index) =>
              index !== first && index !== second && index !== third,
          );
          const loss = before - connectionScore(remaining);
          const better =
            !best ||
            loss < best.loss ||
            (loss === best.loss && suited.length < best.suitCount) ||
            (loss === best.loss &&
              suited.length === best.suitCount &&
              (tiles[0] < best.tiles[0] ||
                (tiles[0] === best.tiles[0] && tiles[1] < best.tiles[1]) ||
                (tiles[0] === best.tiles[0] &&
                  tiles[1] === best.tiles[1] &&
                  tiles[2] < best.tiles[2])));
          if (better) best = { loss, suitCount: suited.length, tiles };
        }
      }
    }
  }
  if (!best) throw new Error("无法选择换三张");
  return best.tiles;
}
