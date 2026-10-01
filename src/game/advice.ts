import { isWinningHand } from "./rules";
import { labelOf, suitOf, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface DiscardAdvice {
  tile: Tile;
  shanten: number;
  effectiveCount: number;
  effectiveTiles: Tile[];
  potential: string;
  risk: number;
  summary: string;
  reason: string;
  limit: string;
}

const shantenCache = new Map<string, number>();

// 标准型以面子、搭子、雀头穷举估算；七对单独比较。负一表示已胡。
export function estimateShanten(
  hand: readonly Tile[],
  exposedMelds: number,
  missing: Suit,
): number {
  const key = `${exposedMelds}:${missing}:${[...hand].sort((a, b) => a - b).join(",")}`;
  const cached = shantenCache.get(key);
  if (cached !== undefined) return cached;
  if (
    hand.length === 14 - 3 * exposedMelds &&
    isWinningHand(hand, missing, exposedMelds)
  )
    return -1;

  const missingCount = hand.filter((item) => suitOf(item) === missing).length;
  const counts = Array<number>(27).fill(0);
  for (const item of hand) if (suitOf(item) !== missing) counts[item] += 1;
  const memo = new Map<string, number>();

  function search(melds: number, taatsu: number, head: number): number {
    const first = counts.findIndex((count) => count > 0);
    if (first < 0) {
      const totalMelds = exposedMelds + melds;
      return 8 - 2 * totalMelds - Math.min(taatsu, 4 - totalMelds) - head;
    }
    const stateKey = `${counts.join("")}:${melds}:${taatsu}:${head}`;
    const known = memo.get(stateKey);
    if (known !== undefined) return known;
    let best = Infinity;
    const tryGroup = (
      items: number[],
      nextMelds = melds,
      nextTaatsu = taatsu,
      nextHead = head,
    ) => {
      items.forEach((item) => (counts[item] -= 1));
      best = Math.min(best, search(nextMelds, nextTaatsu, nextHead));
      items.forEach((item) => (counts[item] += 1));
    };
    if (exposedMelds + melds < 4) {
      if (counts[first] >= 3) tryGroup([first, first, first], melds + 1);
      if (first % 9 <= 6 && counts[first + 1] && counts[first + 2]) {
        tryGroup([first, first + 1, first + 2], melds + 1);
      }
    }
    if (!head && counts[first] >= 2) tryGroup([first, first], melds, taatsu, 1);
    if (taatsu < 4 - exposedMelds - melds) {
      if (counts[first] >= 2) tryGroup([first, first], melds, taatsu + 1);
      if (first % 9 <= 7 && counts[first + 1])
        tryGroup([first, first + 1], melds, taatsu + 1);
      if (first % 9 <= 6 && counts[first + 2])
        tryGroup([first, first + 2], melds, taatsu + 1);
    }
    tryGroup([first]);
    memo.set(stateKey, best);
    return best;
  }

  const standard = search(0, 0, 0);
  const pairs = counts.reduce((sum, count) => sum + Math.floor(count / 2), 0);
  const sevenPairs = exposedMelds === 0 ? 6 - Math.min(6, pairs) : Infinity;
  const result = Math.max(missingCount, Math.min(standard, sevenPairs));
  if (shantenCache.size > 5000) shantenCache.clear();
  shantenCache.set(key, result);
  return result;
}

export function publicCounts(view: PlayerView): number[] {
  const counts = Array<number>(27).fill(0);
  for (const item of [...view.hand, ...view.ownDiscards]) counts[item] += 1;
  for (const meld of view.melds)
    counts[meld.tile] += meld.type === "kong" ? 4 : 3;
  for (const opponent of view.opponents) {
    for (const item of opponent.discards) counts[item] += 1;
    for (const meld of opponent.melds)
      counts[meld.tile] += meld.type === "kong" ? 4 : 3;
  }
  return counts;
}

function potentialReturn(
  hand: readonly Tile[],
  exposedMelds: number,
  missing: Suit,
): { value: number; text: string } {
  const retained = hand.filter((item) => suitOf(item) !== missing);
  const suits = new Set(retained.map(suitOf));
  if (suits.size === 1 && retained.length >= 8)
    return { value: 2, text: "有清一色潜力" };
  const counts = Array<number>(27).fill(0);
  retained.forEach((item) => (counts[item] += 1));
  if (exposedMelds === 0 && counts.filter((count) => count >= 2).length >= 5) {
    return { value: 2, text: "有七对潜力" };
  }
  if (counts.filter((count) => count >= 3).length + exposedMelds >= 3) {
    return { value: 1, text: "有对对胡潜力" };
  }
  return { value: 0, text: "以基础牌型为主" };
}

export function recommendDiscards(view: PlayerView): DiscardAdvice[] {
  if (!view.missing || view.legalDiscards.length === 0) return [];
  const seen = publicCounts(view);
  const advice = view.legalDiscards.map((chosen) => {
    const after = [...view.hand];
    after.splice(after.indexOf(chosen), 1);
    const shanten = estimateShanten(after, view.melds.length, view.missing!);
    const effectiveTiles: Tile[] = [];
    let effectiveCount = 0;
    for (let candidate = 0; candidate < 27; candidate += 1) {
      const unseen = Math.max(0, 4 - seen[candidate]);
      if (!unseen || suitOf(candidate) === view.missing) continue;
      if (
        estimateShanten(
          [...after, candidate],
          view.melds.length,
          view.missing!,
        ) < shanten
      ) {
        effectiveTiles.push(candidate);
        effectiveCount += unseen;
      }
    }
    const potential = potentialReturn(after, view.melds.length, view.missing!);
    const active = view.opponents.filter(
      (opponent) => !opponent.won && opponent.missing !== suitOf(chosen),
    );
    const risk =
      active.length *
      (4 -
        Math.min(
          3,
          seen[chosen] - after.filter((item) => item === chosen).length,
        ));
    const missingAfter = after.filter(
      (item) => suitOf(item) === view.missing,
    ).length;
    const efficiency =
      missingAfter > 0
        ? `缺门未清，还需打出 ${missingAfter} 张缺门牌；向听暂缓报告，有效进张粗估 ${effectiveCount} 张`
        : `估算向听 ${shanten}，有效进张约 ${effectiveCount} 张`;
    return {
      tile: chosen,
      shanten,
      effectiveCount,
      effectiveTiles,
      potential: potential.text,
      risk,
      reason: `${efficiency}；收益倾向：${potential.text}；风险提示：${active.length} 名未胡对手没有定缺这门牌，公开牌无法保证安全。`,
      limit: "未考虑对手暗牌、未来摸牌顺序和精确放铳概率；建议来自启发式计算。",
      potentialValue: potential.value,
    };
  });
  advice.sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.effectiveCount - a.effectiveCount ||
      b.potentialValue - a.potentialValue ||
      a.risk - b.risk ||
      a.tile - b.tile,
  );
  const missingInHand = view.hand.some((item) => suitOf(item) === view.missing);
  const missingName = { wan: "万", tiao: "条", tong: "筒" }[view.missing];
  const required = missingInHand
    ? `你定缺${missingName}，必须先打完${missingName}牌才能胡。`
    : "";
  return advice.map((item, index) => {
    const comparison = index === 0 ? advice[1] : advice[0];
    let summary: string;
    if (!comparison) {
      summary = "当前只有这一种合法出牌，选择受规则限制。";
    } else if (
      item.shanten === comparison.shanten &&
      item.effectiveCount === comparison.effectiveCount &&
      item.potentialValue === comparison.potentialValue &&
      item.risk === comparison.risk
    ) {
      summary =
        index === 0
          ? `与${labelOf(comparison.tile)}的当前估算并列，按默认顺序推荐，不表示这张更强。`
          : `与推荐的${labelOf(comparison.tile)}当前估算并列，同样可作备选。`;
    } else if (index !== 0) {
      summary = missingInHand
        ? "这是另一种清缺门的合法选择，仍需继续打完缺门牌。"
        : `可作备选：打出后估算向听 ${item.shanten}，有效进张约 ${item.effectiveCount} 张。`;
    } else if (item.shanten < comparison.shanten) {
      summary = `打出后更接近听牌：估算向听 ${item.shanten}，备选${labelOf(comparison.tile)}为 ${comparison.shanten}。`;
    } else if (item.effectiveCount > comparison.effectiveCount) {
      summary = `同样接近听牌时，这张保留更多进张（粗估 ${item.effectiveCount} 张，备选${labelOf(comparison.tile)}为 ${comparison.effectiveCount} 张）。`;
    } else if (item.potentialValue > comparison.potentialValue) {
      summary = `效率估算相近，优先保留收益潜力：${item.potential}。`;
    } else {
      summary = "效率与收益估算接近，公开信息下的风险提示较低；仍可能点炮。";
    }
    return {
      tile: item.tile,
      shanten: item.shanten,
      effectiveCount: item.effectiveCount,
      effectiveTiles: item.effectiveTiles,
      potential: item.potential,
      risk: item.risk,
      summary: required + summary,
      reason: item.reason,
      limit: item.limit,
    };
  });
}
