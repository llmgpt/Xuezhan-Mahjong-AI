import { recommendActions } from "./actionAdvice";
import {
  estimateShanten,
  recommendDiscards,
  type DiscardAdvice,
} from "./advice";
import {
  analyzeCandidateDraws,
  candidatePublicCounts,
  candidateWaits,
  estimateCandidateShanten,
  normalDrawBudget,
} from "./candidateEvaluation";
import type { DecisionAction, DecisionChoice } from "./decision";
import type { GameState } from "./game";
import { evaluateWin, waitingTiles } from "./scoring";
import {
  recommendTeacherDiscards,
  teacherChoices,
  type TeacherOptions,
} from "./teacher";
import { analyzeScoredDraws } from "./teacherEvaluation";
import { labelOf, suitOf, type Tile } from "./tiles";
import type { PlayerView } from "./view";

interface TerminalProof {
  tile: Tile;
  minimumRonPayment: number;
}

export interface StrongOptions extends TeacherOptions {
  correctLegalWaits?: boolean;
  adjustDrawBudget?: boolean;
}

function candidateDiscards(
  view: PlayerView,
  options: StrongOptions,
): DiscardAdvice[] {
  if (
    (options.correctLegalWaits === false &&
      options.adjustDrawBudget === false) ||
    options.discardMode === "efficiency" ||
    options.discardMode === "legacy" ||
    !view.missing ||
    view.hand.some((tile) => suitOf(tile) === view.missing)
  )
    return recommendTeacherDiscards(view, options);

  const original = recommendDiscards(view);
  const seen = candidatePublicCounts(view);
  const structural = new Map(original.map((item) => [item.tile, item.shanten]));
  const estimate = (hand: readonly Tile[]) =>
    options.correctLegalWaits === false
      ? estimateShanten(hand, view.melds.length, view.missing!)
      : estimateCandidateShanten(hand, view.melds, view.missing!);
  const corrected = original.map((item) => {
    const after = [...view.hand];
    after.splice(after.indexOf(item.tile), 1);
    const shanten = estimate(after);
    const effectiveTiles: Tile[] = [];
    let effectiveCount = 0;
    for (let drawn = 0; drawn < 27; drawn += 1) {
      const unseen = Math.max(0, 4 - seen[drawn]);
      if (!unseen || suitOf(drawn) === view.missing) continue;
      if (estimate([...after, drawn]) < shanten) {
        effectiveTiles.push(drawn);
        effectiveCount += unseen;
      }
    }
    return { ...item, shanten, effectiveTiles, effectiveCount };
  });
  if (!corrected.length) return [];
  const efficient = [...corrected].sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.effectiveCount - a.effectiveCount ||
      a.tile - b.tile,
  );
  const minimum = efficient[0].shanten;
  const candidates = efficient
    .filter((item) => item.shanten === minimum)
    .slice(0, 3)
    .map((item) => item.tile);
  const normalDraws =
    options.adjustDrawBudget === false
      ? Math.min(2, view.wallRemaining)
      : normalDrawBudget(view);
  const budgetLabel =
    options.adjustDrawBudget === false ? "原墙余截断模型" : "正常轮转模型";
  const estimates =
    minimum > 1
      ? []
      : options.adjustDrawBudget === false
        ? analyzeScoredDraws(view, candidates).map((item) => ({
            tile: item.tile,
            value: item.twoDrawValue,
          }))
        : analyzeCandidateDraws(view, candidates);
  const values = new Map(estimates.map((item) => [item.tile, item.value]));
  const callValues = new Map<Tile, number>();
  if (minimum === 0 && normalDraws === 0) {
    for (const item of corrected.filter((item) => item.shanten === 0)) {
      const after = [...view.hand];
      after.splice(after.indexOf(item.tile), 1);
      callValues.set(
        item.tile,
        candidateWaits(after, view.melds, view.missing).maxPoints,
      );
    }
  }
  const oldOrder = new Map(original.map((item, index) => [item.tile, index]));
  const ranked = corrected.sort(
    (a, b) =>
      a.shanten - b.shanten ||
      (callValues.get(b.tile) ?? 0) - (callValues.get(a.tile) ?? 0) ||
      (values.get(b.tile) ?? 0) - (values.get(a.tile) ?? 0) ||
      b.effectiveCount - a.effectiveCount ||
      oldOrder.get(a.tile)! - oldOrder.get(b.tile)!,
  );
  return ranked.map((item, index) => {
    const correction =
      structural.get(item.tile) === 0 && item.shanten > 0
        ? "原结构估计为0，但没有任何合法等待，按至少一向听处理，不能等待本家已持四张的第五张。"
        : "";
    const callValue = callValues.get(item.tile);
    const modelValue = values.get(item.tile);
    const callReason =
      callValue === undefined
        ? ""
        : `${budgetLabel}的本家摸牌预算为0，优先保留听牌并比较理论查叫最高牌型分 ${callValue}。这是残局取舍的启发式，不预测对手最终是否听牌或查叫收付人数。`;
    const modelReason =
      modelValue === undefined || normalDraws === 0
        ? ""
        : `在同向听的牌效前三候选中，比较 ${normalDraws} 摸均匀未知牌模型的自摸收入 ${modelValue.toFixed(2)} 分。`;
    const comparison = index === 0 ? ranked[1] : ranked[0];
    let summary = `向听粗估 ${item.shanten}，合法有效进张约 ${item.effectiveCount} 张。`;
    if (index === 0 && callValue !== undefined) {
      summary = `${budgetLabel}暂不计本家摸牌，保持听牌并比较理论查叫牌型分 ${callValue}。`;
    } else if (
      index === 0 &&
      modelValue !== undefined &&
      modelValue > (values.get(comparison?.tile) ?? 0) + 1e-9
    ) {
      summary = `近听按 ${normalDraws} 摸${budgetLabel}比较计分收入，本候选约 ${modelValue.toFixed(2)} 分。`;
    } else if (correction) {
      summary = "没有合法等待，当前不算听牌，仍需调整手牌。";
    }
    const risk = item.reason.slice(item.reason.indexOf("风险提示"));
    const validation =
      options.correctLegalWaits === false
        ? "原结构估计的向听"
        : "合法等待校验后的向听粗估";
    return {
      ...item,
      summary,
      reason: `${validation} ${item.shanten}，有效进张约 ${item.effectiveCount} 张；收益倾向：${item.potential}；${risk}${correction}${callReason}${modelReason}`,
      limit: `${item.limit}${options.correctLegalWaits === false ? "未启用合法听牌纠错；" : "只有合法听牌校验是规则事实；"}距离和收益仍是简化模型。正常轮转预算未模拟碰杠跳转、对手胡后退出、点炮或海底和杠上花等加番，实际摸牌机会可能改变，不是实战胡牌率或净分预测。`,
    };
  });
}

// 这个窄约束只处理公开信息已唯一确定的暗牌，不抽样猜牌。
// 墙尽、三家各四副露加一张手牌，且108张中的三个未知副本全同牌。
function proveTerminalSingleWait(view: PlayerView): TerminalProof | undefined {
  if (
    view.wallRemaining !== 0 ||
    !view.missing ||
    view.hand.some((tile) => suitOf(tile) === view.missing) ||
    view.hand.length !== 14 - 3 * view.melds.length ||
    view.opponents.length !== 3 ||
    view.opponents.some(
      (opponent) =>
        opponent.won ||
        !opponent.missing ||
        opponent.handCount !== 1 ||
        opponent.melds.length !== 4 ||
        opponent.melds.some((meld) => suitOf(meld.tile) === opponent.missing),
    )
  )
    return undefined;

  const counts = candidatePublicCounts(view);
  if (counts.some((count) => count < 0 || count > 4)) return undefined;
  const unseen = counts.map((count) => 4 - count);
  if (unseen.reduce((sum, count) => sum + count, 0) !== 3) return undefined;
  const hidden = unseen.findIndex((count) => count === 3);
  if (hidden < 0) return undefined;

  let minimumRonPayment = 0;
  for (const opponent of view.opponents) {
    const win = evaluateWin(
      [hidden, hidden],
      opponent.melds,
      opponent.missing!,
    );
    if (!win) return undefined;
    minimumRonPayment += win.points;
  }
  return { tile: hidden, minimumRonPayment };
}

export function recommendStrongDiscards(
  view: PlayerView,
  options: StrongOptions = {},
): DiscardAdvice[] {
  const original = candidateDiscards(view, options);
  const proof = proveTerminalSingleWait(view);
  if (!proof || original[0]?.tile !== proof.tile) return original;

  const safeReady = original.filter((item) => {
    if (item.tile === proof.tile) return false;
    const after = [...view.hand];
    after.splice(after.indexOf(item.tile), 1);
    return waitingTiles(after, view.melds, view.missing!).tiles.length > 0;
  });
  if (!safeReady.length) return original;

  const safeTiles = new Set(safeReady.map((item) => item.tile));
  const deduction = `公开牌数守恒：未见牌只剩 3 张${labelOf(proof.tile)}，三家各四副露且各余一张手牌，所以三家均单吊${labelOf(proof.tile)}。三家认胡时，本家按基础番型至少付 ${proof.minimumRonPayment} 分，上下文加番只会增加或保持该支出。`;
  return [
    ...safeReady,
    ...original.filter((item) => !safeTiles.has(item.tile)),
  ].map((item) => {
    if (safeTiles.has(item.tile)) {
      return {
        ...item,
        summary: `改打${labelOf(item.tile)}保留听牌，墙尽结算本家净分 0 分；${labelOf(proof.tile)}可被三家同时胡。`,
        reason: `${deduction}打${labelOf(item.tile)}无人可胡或碰杠，本家仍听牌，四家均非花猪且听牌，流局没有查叫支付，本次收尾净分为 0 分。${item.reason}`,
        limit: `${item.limit}这里只对墙尽且剩余暗牌可由公开信息唯一确定的局面作确定判断，不估计普通牌面的放铳概率。`,
      };
    }
    if (item.tile === proof.tile) {
      return {
        ...item,
        summary: `${labelOf(proof.tile)}可被三家同时胡，认胡后至少付 ${proof.minimumRonPayment} 分；有保持听牌且收尾净分为 0 分的替代。`,
        reason: `${deduction}${item.reason}`,
      };
    }
    return item;
  });
}

export function strongChoices(
  view: PlayerView,
  phase: GameState["phase"],
  options: StrongOptions = {},
): DecisionChoice[] {
  if (phase !== "discard" && phase !== "respond")
    return teacherChoices(view, phase, options);
  const discards = recommendStrongDiscards(view, options);
  const actions = recommendActions(view, () => discards);
  return [
    ...actions,
    ...discards
      .filter(
        (item) =>
          !actions.some(
            (other) =>
              other.action.type === "discard" &&
              other.action.tile === item.tile,
          ),
      )
      .map((item): DecisionChoice => ({
        action: { type: "discard", tile: item.tile },
        label: `打出 ${labelOf(item.tile)}`,
        summary: item.summary,
        reason: item.reason,
        limit: item.limit,
      })),
  ];
}

export function chooseStrongAction(
  view: PlayerView,
  phase: GameState["phase"],
  options: StrongOptions = {},
): DecisionAction | undefined {
  return strongChoices(view, phase, options)[0]?.action;
}
