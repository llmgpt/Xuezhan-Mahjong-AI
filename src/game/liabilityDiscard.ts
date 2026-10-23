import type { PlayerView } from "./view";
import { labelOf, suitOf, type Tile } from "./tiles";
import {
  analyzeCandidateDraws,
  candidatePublicCounts,
  candidateWaits,
  estimateCandidateShanten,
  normalDrawBudget,
} from "./candidateEvaluation";
import { discardLiability } from "./publicLiability";
import type { DecisionChoice } from "./decision";

export interface LiabilityCandidate {
  tile: Tile;
  shanten: number;
  effectiveCount: number;
  terminalCallPoints: number;
  attackValue: number;
  expectedPayment: number;
}
type Structure = Pick<
  LiabilityCandidate,
  "tile" | "shanten" | "effectiveCount" | "terminalCallPoints"
>;
function eligible(candidate: Structure, baseline: Structure): boolean {
  return (
    candidate.shanten === baseline.shanten &&
    candidate.effectiveCount >= baseline.effectiveCount &&
    candidate.terminalCallPoints >= baseline.terminalCallPoints
  );
}
export function selectLiabilityCandidate<T extends LiabilityCandidate>(
  candidates: readonly T[],
  baselineTile: Tile,
): T {
  if (
    !candidates.length ||
    new Set(candidates.map((c) => c.tile)).size !== candidates.length ||
    candidates.some(
      (c) =>
        !Number.isInteger(c.tile) ||
        c.tile < 0 ||
        c.tile > 26 ||
        !Number.isInteger(c.shanten) ||
        c.shanten < 0 ||
        !Number.isInteger(c.effectiveCount) ||
        c.effectiveCount < 0 ||
        c.effectiveCount > 108 ||
        ![0, 1, 2, 4, 8].includes(c.terminalCallPoints) ||
        !Number.isFinite(c.attackValue) ||
        c.attackValue < 0 ||
        !Number.isFinite(c.expectedPayment) ||
        c.expectedPayment < 0 ||
        c.expectedPayment > 24,
    )
  )
    throw new Error("无效公开赔付候选");
  const baseline = candidates.find((c) => c.tile === baselineTile);
  if (!baseline) throw new Error("缺少原策略实际弃牌候选");
  let best = baseline;
  for (const candidate of candidates) {
    if (
      eligible(candidate, baseline) &&
      candidate.attackValue - candidate.expectedPayment >
        best.attackValue - best.expectedPayment + 1e-12
    )
      best = candidate;
  }
  return best;
}

export interface LiabilityDiscardDecision {
  kind: "public-liability-discard-v1";
  baselineTile: Tile;
  selectedTile: Tile;
  normalDraws: 0 | 1 | 2;
  structures: (Structure & { eligible: boolean })[];
  candidates: (LiabilityCandidate & {
    liability: ReturnType<typeof discardLiability>;
  })[];
  choice: DecisionChoice;
}

/** Experimental local discard correction; does not claim full future net EV. */
export function evaluateLiabilityDiscard(
  view: PlayerView,
  baselineTile: Tile,
): LiabilityDiscardDecision | undefined {
  if (
    view.decision?.kind !== "self" ||
    view.decision.canWin ||
    !view.missing ||
    view.hand.some((t) => suitOf(t) === view.missing)
  )
    return undefined;
  if (
    !view.hand.includes(baselineTile) ||
    !view.legalDiscards.includes(baselineTile)
  )
    throw new Error("原策略弃牌不合法");
  const seen = candidatePublicCounts(view),
    normalDraws = normalDrawBudget(view);
  const structures = [...new Set(view.legalDiscards)]
    .sort((a, b) => a - b)
    .map((tile) => {
      const after = [...view.hand];
      after.splice(after.indexOf(tile), 1);
      const shanten = estimateCandidateShanten(
        after,
        view.melds,
        view.missing!,
      );
      let effectiveCount = 0;
      for (let drawn = 0; drawn < 27; drawn++) {
        const unseen = 4 - seen[drawn];
        if (
          unseen > 0 &&
          suitOf(drawn) !== view.missing &&
          estimateCandidateShanten(
            [...after, drawn],
            view.melds,
            view.missing!,
          ) < shanten
        )
          effectiveCount += unseen;
      }
      const terminalCallPoints =
        normalDraws === 0 && shanten === 0
          ? candidateWaits(after, view.melds, view.missing!).maxPoints
          : 0;
      return { tile, shanten, effectiveCount, terminalCallPoints };
    });
  const baseline = structures.find((c) => c.tile === baselineTile)!;
  const allowed = structures.filter((c) => eligible(c, baseline));
  const estimates =
    baseline.shanten <= 1 && normalDraws > 0
      ? analyzeCandidateDraws(
          view,
          allowed.map((c) => c.tile),
        )
      : [];
  const attack = new Map(estimates.map((e) => [e.tile, e.value]));
  const candidates = allowed.map((c) => {
    const liability = discardLiability(view, c.tile);
    return {
      ...c,
      attackValue: attack.get(c.tile) ?? 0,
      expectedPayment: liability.expectedPayment,
      liability,
    };
  });
  const selected = selectLiabilityCandidate(candidates, baselineTile);
  const choice: DecisionChoice = {
    action: { type: "discard", tile: selected.tile },
    label: `打出 ${labelOf(selected.tile)}`,
    summary: `保留同向听与有效进张，比较进攻收入和即时点炮暴露。`,
    reason: `原选择${labelOf(baselineTile)}；本候选向听粗估 ${selected.shanten}，有效进张约 ${selected.effectiveCount} 张，均满足原选择的约束。${normalDraws} 摸均匀未知牌模型自摸收入 ${selected.attackValue.toFixed(4)} 分，公开信息模型的本次潜在点炮赔付 ${selected.expectedPayment.toFixed(4)} 分，两者相减 ${(selected.attackValue - selected.expectedPayment).toFixed(4)} 分。${normalDraws === 0 ? `理论查叫最高牌型分 ${selected.terminalCallPoints}，不低于原选择；这不是保证实收。` : ""}`,
    limit:
      "旧模拟对局训练的赔付模型存在分布和校准偏差，尤其可能低估高风险尾部。进攻只看至多两次正常摸牌，较远手牌暂计0；未预测对手是否接受胡、未来碰杠/退出、点胡机会及后续收付。相减仅为本实验的取舍代理，不是完整未来净分或高手结论。",
  };
  return {
    kind: "public-liability-discard-v1",
    baselineTile,
    selectedTile: selected.tile,
    normalDraws,
    structures: structures.map((c) => ({
      ...c,
      eligible: eligible(c, baseline),
    })),
    candidates,
    choice,
  };
}
