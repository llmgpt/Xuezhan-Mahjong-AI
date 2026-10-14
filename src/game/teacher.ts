import { recommendActions, type ActionAdvice } from "./actionAdvice";
import {
  estimateShanten,
  recommendDiscards,
  type DiscardAdvice,
} from "./advice";
import type { DecisionAction, DecisionChoice } from "./decision";
import type { GameState } from "./game";
import { chooseStructureExchange } from "./openingAdvice";
import { waitingTiles } from "./scoring";
import { analyzeScoredDraws } from "./teacherEvaluation";
import { labelOf, suitOf, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface TeacherOptions {
  discardMode?: "teacher" | "legacy" | "efficiency";
}

const suits: Suit[] = ["wan", "tiao", "tong"];
const names: Record<Suit, string> = { wan: "万", tiao: "条", tong: "筒" };
const setupLimit =
  "只用本家手牌的规则策略；换来的三张未知，未搜索对手收牌后的收益。";

function missingChoices(hand: readonly Tile[]) {
  return suits
    .map((suit) => {
      const count = hand.filter((item) => suitOf(item) === suit).length;
      const retained = hand.filter((item) => suitOf(item) !== suit);
      const retainedShanten = estimateShanten(retained, 0, suit);
      return {
        suit,
        count,
        retainedShanten,
        cost: Math.max(count, retainedShanten),
      };
    })
    .sort(
      (a, b) =>
        a.cost - b.cost ||
        a.retainedShanten - b.retainedShanten ||
        a.count - b.count ||
        suits.indexOf(a.suit) - suits.indexOf(b.suit),
    );
}

export function chooseTeacherMissing(hand: readonly Tile[]): Suit {
  return missingChoices(hand)[0].suit;
}

export function recommendTeacherDiscards(
  view: PlayerView,
  options: TeacherOptions = {},
): DiscardAdvice[] {
  const original = recommendDiscards(view);
  if (options.discardMode === "legacy") return original;
  const efficient = [...original].sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.effectiveCount - a.effectiveCount ||
      a.tile - b.tile,
  );
  if (options.discardMode === "efficiency") return efficient;
  if (
    !original.length ||
    view.hand.some((item) => suitOf(item) === view.missing)
  )
    return original;

  // 先保持成牌距离；仅在近听时，比较牌效前三候选的得分加权两摸延续。
  const minimum = efficient[0].shanten;
  const candidates = efficient
    .filter((item) => item.shanten === minimum)
    .slice(0, 3);
  const estimates =
    minimum <= 1
      ? analyzeScoredDraws(
          view,
          candidates.map((item) => item.tile),
        )
      : [];
  const values = new Map(estimates.map((item) => [item.tile, item]));
  const horizon = view.wallRemaining === 1 ? "一摸" : "两摸";
  const callValues = new Map<Tile, number>();
  if (view.wallRemaining === 0 && minimum === 0) {
    for (const item of original.filter((choice) => choice.shanten === 0)) {
      const after = [...view.hand];
      after.splice(after.indexOf(item.tile), 1);
      callValues.set(
        item.tile,
        waitingTiles(after, view.melds, view.missing!).maxPoints,
      );
    }
  }
  const originalOrder = new Map(
    original.map((item, index) => [item.tile, index]),
  );
  const ranked = [...original].sort(
    (a, b) =>
      a.shanten - b.shanten ||
      (callValues.get(b.tile) ?? 0) - (callValues.get(a.tile) ?? 0) ||
      (values.get(b.tile)?.twoDrawValue ?? 0) -
        (values.get(a.tile)?.twoDrawValue ?? 0) ||
      b.effectiveCount - a.effectiveCount ||
      originalOrder.get(a.tile)! - originalOrder.get(b.tile)!,
  );
  return ranked.map((item, index) => {
    const comparison = index === 0 ? ranked[1] : ranked[0];
    const model = values.get(item.tile);
    const otherModel = comparison && values.get(comparison.tile);
    const callValue = callValues.get(item.tile);
    let summary = item.summary;
    if (comparison && index === 0) {
      if (item.shanten < comparison.shanten) {
        summary = `打出后更接近听牌：估算向听 ${item.shanten}，备选${labelOf(comparison.tile)}为 ${comparison.shanten}。`;
      } else if (
        callValue !== undefined &&
        callValue > (callValues.get(comparison.tile) ?? 0)
      ) {
        summary = `牌墙已空，保持听牌并兼顾查叫；理论等待的最高牌型分 ${callValue}，备选${labelOf(comparison.tile)}为 ${callValues.get(comparison.tile) ?? 0}。`;
      } else if (
        model &&
        otherModel &&
        model.twoDrawValue > otherModel.twoDrawValue + 1e-9
      ) {
        summary = `近听时兼顾进张与番型；${horizon}模型自摸收益约 ${model.twoDrawValue.toFixed(2)} 分，备选${labelOf(comparison.tile)}约 ${otherModel.twoDrawValue.toFixed(2)} 分。`;
      } else if (item.effectiveCount > comparison.effectiveCount) {
        summary = `同向听时保留更多有效进张（粗估 ${item.effectiveCount} 张，备选${labelOf(comparison.tile)}为 ${comparison.effectiveCount} 张）。`;
      } else if (
        item.effectiveCount === comparison.effectiveCount &&
        Math.abs((model?.twoDrawValue ?? 0) - (otherModel?.twoDrawValue ?? 0)) <
          1e-9
      ) {
        summary =
          item.potential === comparison.potential &&
          item.risk === comparison.risk
            ? `与${labelOf(comparison.tile)}的当前估算并列，按默认顺序推荐，不表示这张更强。`
            : "主要牌效估算接近，按收益倾向、公开风险提示和固定顺序取舍；备选也可考虑。";
      }
    } else if (comparison) {
      summary = `备选：估算向听 ${item.shanten}，有效进张约 ${item.effectiveCount} 张${model ? `，${horizon}模型自摸收益约 ${model.twoDrawValue.toFixed(2)} 分` : ""}。`;
    }
    return {
      ...item,
      summary,
      reason:
        item.reason +
        (callValue !== undefined
          ? `牌墙已空，按本桌查叫规则比较理论等待的最高封顶牌型分 ${callValue}；即使等待牌已公开出尽，仍按理论等待判断，不预测对手是否听牌或最终查叫人数。`
          : "") +
        (model
          ? `近听时，在同向听、按进张排序的前三张候选中，枚举均匀未知牌模型的${horizon}延续；自摸按本桌番型封顶和未胡对手各付牌型分加 1 计值。本候选一摸模型成胡占比 ${(model.oneDrawWinChance * 100).toFixed(1)}%，${horizon}模型自摸收益约 ${model.twoDrawValue.toFixed(2)} 分。`
          : ""),
      limit:
        item.limit +
        (model
          ? "前瞻数值只比较简化模型；未见牌可能在对手手中，不模拟中间碰杠胡、点炮和海底、杠上花等上下文加番，也不是实战胡牌率或净分预测。"
          : ""),
    };
  });
}

export function recommendTeacherActions(
  view: PlayerView,
  options: TeacherOptions = {},
): ActionAdvice[] {
  return recommendActions(view, (input) =>
    recommendTeacherDiscards(input, options),
  );
}

export function teacherChoices(
  view: PlayerView,
  phase: GameState["phase"],
  options: TeacherOptions = {},
): DecisionChoice[] {
  if (phase === "exchange") {
    const tiles = chooseStructureExchange(view.hand);
    return [
      {
        action: { type: "exchange", tiles },
        label: `换出 ${tiles.map(labelOf).join("、")}`,
        summary: "优先换出较少拆散对子和顺子联系的同门三张。",
        reason:
          "枚举合法同门三张，比较换出前后同张、相邻和隔张联系的损失；同张计 4、相邻计 2、隔张计 1。损失并列时优先张数较少的一门，再按固定牌序选择。",
        limit: setupLimit,
      },
    ];
  }
  if (phase === "choose-missing") {
    const choices = missingChoices(view.hand);
    const counts = suits
      .map(
        (suit) =>
          `${names[suit]} ${view.hand.filter((item) => suitOf(item) === suit).length} 张`,
      )
      .join("、");
    return choices.map(({ suit, count, retainedShanten, cost }) => ({
      action: { type: "missing", suit },
      label: `定缺${names[suit]}`,
      summary: `该门 ${count} 张；结合清缺门成本与其余两门的成组结构取舍。`,
      reason: `三门张数：${counts}。去掉${names[suit]}后保留结构的向听粗估为 ${retainedShanten}，与须清掉的 ${count} 张取较大值 ${cost} 作为开局成本；成本并列时优先保留更完整的结构，再比较张数和固定花色顺序。`,
      limit:
        "只用本家手牌；开局成本是启发式比较，不代表实际听牌所需轮数或长期收益。",
    }));
  }
  if (phase !== "discard" && phase !== "respond") return [];
  const discards = recommendTeacherDiscards(view, options);
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

export function chooseTeacherAction(
  view: PlayerView,
  phase: GameState["phase"],
  options: TeacherOptions = {},
): DecisionAction | undefined {
  return teacherChoices(view, phase, options)[0]?.action;
}
