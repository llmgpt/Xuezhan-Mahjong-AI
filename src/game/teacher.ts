import { recommendActions, type ActionAdvice } from "./actionAdvice";
import { recommendDiscards, type DiscardAdvice } from "./advice";
import type { DecisionAction, DecisionChoice } from "./decision";
import type { GameState } from "./game";
import {
  analyzeExchangeChoices,
  analyzeMissingChoices,
  chooseMissingSuit,
  meldKindLabel,
  SUIT_NAMES as names,
  SUITS,
  type ExchangeAnalysis,
  type MissingAnalysis,
} from "./openingAdvice";
import { waitingTiles } from "./scoring";
import { analyzeScoredDraws } from "./teacherEvaluation";
import { labelOf, suitOf, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface TeacherOptions {
  discardMode?: "teacher" | "legacy" | "efficiency";
}

const exchangeLimit =
  "仅依据本家手牌作启发式判断；换入的三张未知，未预测对手收牌后的收益。";
const missingLimit =
  "仅依据本家手牌作启发式比较，不代表实际听牌轮数或最终胜率。";

function formatSuitCounts(hand: readonly Tile[]): string {
  return SUITS.map(
    (suit) =>
      `${names[suit]} ${hand.filter((item) => suitOf(item) === suit).length} 张`,
  ).join("、");
}

function keptSuitNames(missing: Suit): string {
  return SUITS.filter((suit) => suit !== missing)
    .map((suit) => names[suit])
    .join("、");
}

function formatExchangePrimary(
  hand: readonly Tile[],
  best: ExchangeAnalysis,
  second?: ExchangeAnalysis,
): { summary: string; reason: string } {
  const countsText = formatSuitCounts(hand);
  const suitName = names[best.suit];
  const tilesText = best.tiles.map(labelOf).join("、");
  const plan = best.plannedMissing;
  const planSuitName = names[plan.suit];
  const keptNames = keptSuitNames(plan.suit);
  const domName = names[best.dominantKeptSuit];
  const meldWord = meldKindLabel(plan.retainedSequences, plan.retainedTriplets);

  let summary: string;
  if (plan.suit === best.suit && plan.count === 0) {
    if (best.dominantKeptCount >= 8) {
      summary = `换出这三张直接清空${suitName}门（余 0 张可定缺），保住 ${best.dominantKeptCount} 张${domName}主门兼顾清一色方向。`;
    } else if (best.dominantKeptCount >= 6) {
      summary = `换出这三张直接清空${suitName}门（余 0 张可定缺），完整保住 ${best.dominantKeptCount} 张${domName}主门。`;
    } else {
      summary = `换出这三张直接清空${suitName}门（余 0 张可定缺），保留${keptNames}两门共 ${best.keptTwoSuitCount} 张。`;
    }
  } else if (plan.suit === best.suit) {
    if (best.dominantKeptCount >= 8) {
      summary = `换后${suitName}门仅余 ${plan.count} 张便于定缺，保住 ${best.dominantKeptCount} 张${domName}主门兼顾清一色方向。`;
    } else if (best.dominantKeptCount >= 6) {
      summary = `换后${suitName}门仅余 ${plan.count} 张便于定缺，完整保住 ${best.dominantKeptCount} 张${domName}主门${plan.retainedMelds > 0 ? `与 ${plan.retainedMelds} 组完整${meldWord}` : ""}。`;
    } else {
      summary = `换后${suitName}门仅余 ${plan.count} 张便于定缺，保留${keptNames}两门共 ${best.keptTwoSuitCount} 张。`;
    }
  } else {
    summary = `拟定缺原本最少的${planSuitName}门（余 ${plan.count} 张），从${suitName}门换出较散的三张，尽量保住主门与已有搭子。`;
  }

  const remText = best.suitRemainingTiles.map(labelOf).join("、");
  const afterStep =
    plan.suit === best.suit
      ? plan.count === 0
        ? `换出 ${tilesText} 后，${suitName}门清空（余 0 张）可直接定缺`
        : `换出 ${tilesText} 后，${suitName}门余 ${plan.count} 张（${remText}）可定缺`
      : plan.count === 0
        ? `${planSuitName}门本就余 0 张可直接定缺；换出 ${tilesText} 后${suitName}门余 ${best.suitRemainingTiles.length} 张`
        : `${planSuitName}门原本最少（余 ${plan.count} 张）便于定缺；换出 ${tilesText} 后${suitName}门余 ${best.suitRemainingTiles.length} 张`;

  const keptParts: string[] = [
    `保留${keptNames}两门共 ${best.keptTwoSuitCount} 张`,
  ];
  if (plan.retainedMelds > 0) {
    keptParts.push(`含 ${plan.retainedMelds} 组完整${meldWord}`);
  }
  let dominantNote = "";
  if (best.dominantKeptCount >= 8) {
    dominantNote = `，其中${domName}门占 ${best.dominantKeptCount} 张兼顾清一色方向`;
  } else if (best.dominantKeptCount >= 6) {
    dominantNote = `，完整保住 ${best.dominantKeptCount} 张${domName}主门`;
  }

  let pairNote = "";
  if (best.suitCountBefore >= 4 && best.suitHadPair && !best.outHasPair) {
    pairNote =
      best.suitRemainingStructure.pairs > 0 ||
      best.suitRemainingStructure.triplets > 0
        ? `，并在${suitName}门内保住对子`
        : "，且避开把对子整对送出";
  } else if (
    best.suitCountBefore >= 4 &&
    best.suitHadMeld &&
    !best.outHasMeld
  ) {
    pairNote = "，且不整组送出完整面子";
  }

  const tieNote =
    best.isTiedWithNext && second
      ? `；与改换${names[second.suit]}门条件相当，任选其一即可`
      : "";

  const reason = `三门张数：${countsText} → ${afterStep}；${keptParts.join("，")}（向听粗估 ${plan.retainedShanten}）${dominantNote}${pairNote}${tieNote}。`;
  return { summary, reason };
}

function formatMissingChoice(
  hand: readonly Tile[],
  item: MissingAnalysis,
  index: number,
  ranked: readonly MissingAnalysis[],
): DecisionChoice {
  const countsText = formatSuitCounts(hand);
  const suitName = names[item.suit];
  const keptNames = keptSuitNames(item.suit);
  const meldWord = meldKindLabel(item.retainedSequences, item.retainedTriplets);
  const meldClause =
    item.retainedMelds > 0
      ? `，含 ${item.retainedMelds} 组完整${meldWord}`
      : "";
  const flushClause =
    item.dominantRetainedCount >= 8
      ? `，且${names[item.dominantRetainedSuit]}门占 ${item.dominantRetainedCount} 张有清一色方向`
      : "";
  const best = ranked[0];
  const second = ranked[1];

  let summary: string;
  let extraContrast = "";

  if (index === 0) {
    if (item.count === 0) {
      summary = `手里已无${suitName}牌，直接定缺${suitName}无需清废牌。`;
    } else if (item.isTiedWithNext && second) {
      summary = `${suitName}门与${names[second.suit]}门均为 ${item.count} 张且牌形相当，定缺哪一门都可以。`;
      extraContrast = `；与定缺${names[second.suit]}条件基本相当，任选其一即可`;
    } else if (second && item.count < second.count) {
      summary = `${suitName}门最少（${item.count} 张），清缺最快，可保留${keptNames}两门共 ${item.retainedCount} 张。`;
    } else if (
      second &&
      item.count === second.count &&
      item.retainedMelds > second.retainedMelds
    ) {
      const otherMeldWord = meldKindLabel(
        second.droppedStructure.sequences,
        second.droppedStructure.triplets,
      );
      summary = `${suitName}与${names[second.suit]}同为 ${item.count} 张，定缺${suitName}可避免拆掉${names[second.suit]}门已有${otherMeldWord}。`;
      extraContrast = `；${names[second.suit]}门虽同样 ${second.count} 张但自带完整${otherMeldWord}，不宜拆掉`;
    } else if (
      second &&
      item.count === second.count &&
      item.retainedShanten < second.retainedShanten
    ) {
      summary = `${suitName}与${names[second.suit]}同为 ${item.count} 张，定缺${suitName}后其余两门更接近听牌。`;
    } else if (second && item.count === second.count) {
      summary = `${suitName}与${names[second.suit]}同为 ${item.count} 张，定缺${suitName}可为其余两门保留更宽进张与更好搭子。`;
      if (item.retainedEffectiveDraws > second.retainedEffectiveDraws) {
        extraContrast = `；比定缺${names[second.suit]}多留约 ${item.retainedEffectiveDraws - second.retainedEffectiveDraws} 张有效进张`;
      }
    } else if (second) {
      summary = `虽比${names[second.suit]}多清 ${item.count - second.count} 张，但保住了${names[second.suit]}门已有成组结构，整体更接近听牌。`;
    } else {
      summary = `定缺${suitName}（${item.count} 张），综合清缺速度与保留两门结构更合适。`;
    }
  } else {
    const bestName = names[best.suit];
    if (index === 1 && best.isTiedWithNext) {
      summary = `与定缺${bestName}条件相当，选这门同样合理。`;
    } else if (
      item.count === best.count &&
      item.retainedMelds < best.retainedMelds
    ) {
      const droppedWord = meldKindLabel(
        item.droppedStructure.sequences,
        item.droppedStructure.triplets,
      );
      summary = `同为 ${item.count} 张，但${suitName}门自带完整${droppedWord}，定缺${suitName}会拆掉现成面子。`;
    } else if (
      item.count === best.count &&
      item.retainedShanten > best.retainedShanten
    ) {
      summary = `同为 ${item.count} 张，但定缺${suitName}后保留两门离听牌更远（向听 ${item.retainedShanten} vs ${best.retainedShanten}）。`;
    } else if (item.count === best.count) {
      summary = `同为 ${item.count} 张，但定缺${suitName}会损失更好的搭子与进张宽度。`;
    } else if (item.count > best.count) {
      summary = `${suitName}门有 ${item.count} 张，比定缺${bestName}多清 ${item.count - best.count} 张，清缺更慢。`;
    } else {
      summary = `虽少清 ${best.count - item.count} 张，但会拆散关键成组结构，保留两门向听变为 ${item.retainedShanten}。`;
    }
  }

  const clearText =
    item.count === 0
      ? `手里已无${suitName}牌，无需清废牌`
      : `须清 ${item.count} 张${suitName}牌`;
  const shantenCompare =
    index > 0 && item.retainedShanten > best.retainedShanten
      ? `；向听高于首选的 ${best.retainedShanten} 向听，离听牌更远`
      : "";
  const reason = `三门张数：${countsText}。${index === 0 ? "" : "若"}定缺${suitName}${clearText}，保留${keptNames}两门共 ${item.retainedCount} 张${meldClause}（向听粗估 ${item.retainedShanten}，当前向听下有效进张约 ${item.retainedEffectiveDraws} 张${shantenCompare}）${flushClause}${extraContrast}。`;

  return {
    action: { type: "missing", suit: item.suit },
    label: `定缺${suitName}`,
    summary,
    reason,
    limit: missingLimit,
  };
}

export function chooseTeacherMissing(hand: readonly Tile[]): Suit {
  return chooseMissingSuit(hand);
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
    const analyzed = analyzeExchangeChoices(view.hand);
    if (!analyzed.length) throw new Error("无法选择换三张");
    const best = analyzed[0];
    const { summary, reason } = formatExchangePrimary(
      view.hand,
      best,
      analyzed[1],
    );
    return [
      {
        action: { type: "exchange", tiles: best.tiles },
        label: `换出 ${best.tiles.map(labelOf).join("、")}`,
        summary,
        reason,
        limit: exchangeLimit,
      },
    ];
  }
  if (phase === "choose-missing") {
    const ranked = analyzeMissingChoices(view.hand);
    return ranked.map((item, index) =>
      formatMissingChoice(view.hand, item, index, ranked),
    );
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
