import type { DecisionChoice } from "../game/decision";
import type { GameState } from "../game/game";
import {
  analyzeExchangeChoices,
  isEquivalentExchange,
  keptSuitsPhrase,
  meldKindLabel,
  SUIT_NAMES as suitNames,
  type ExchangeAnalysis,
} from "../game/openingAdvice";
import { teacherChoices } from "../game/teacher";
import { labelOf, type Tile } from "../game/tiles";
import type { PlayerView } from "../game/view";

function formatAlternativeExchange(
  hand: readonly Tile[],
  alt: ExchangeAnalysis,
  primary: ExchangeAnalysis,
): DecisionChoice {
  const altSuitName = suitNames[alt.suit];
  const altTilesText = alt.tiles.map(labelOf).join("、");
  const altRemText = alt.suitRemainingTiles.map(labelOf).join("、");
  const altPlan = alt.plannedMissing;
  const altPlanName = suitNames[altPlan.suit];
  const primaryPlan = primary.plannedMissing;
  const afterHand = [...hand];
  for (const outTile of alt.tiles) {
    const idx = afterHand.indexOf(outTile);
    if (idx >= 0) afterHand.splice(idx, 1);
  }
  const keptNames = keptSuitsPhrase(afterHand, altPlan.suit);
  const altMeldWord = meldKindLabel(
    altPlan.retainedSequences,
    altPlan.retainedTriplets,
  );

  let summary: string;
  if (isEquivalentExchange(alt, primary)) {
    summary = `该门与首选条件相当：换后${altPlanName}门同样余 ${altPlan.count} 张可定缺，换哪一门都可以。`;
  } else if (altPlan.count > primaryPlan.count) {
    if (alt.suitCountBefore >= 6 && alt.suit === primary.dominantKeptSuit) {
      summary = `会拆弱 ${alt.suitCountBefore} 张${altSuitName}主门，换后最少门仍余 ${altPlan.count} 张废牌要清。`;
    } else if (
      altPlan.suit !== alt.suit &&
      alt.suitRemainingStructure.pairs > 0
    ) {
      summary = `该门内可保住对子，但换后最少门余 ${altPlan.count} 张，比首选多清 ${altPlan.count - primaryPlan.count} 张缺门牌。`;
    } else if (altPlan.retainedMelds < primaryPlan.retainedMelds) {
      summary = `换后最少门余 ${altPlan.count} 张（多清 ${altPlan.count - primaryPlan.count} 张），且会拆散已有完整面子。`;
    } else {
      summary = `换后最少门余 ${altPlan.count} 张，比首选多清 ${altPlan.count - primaryPlan.count} 张缺门牌。`;
    }
  } else if (altPlan.count < primaryPlan.count) {
    const fewerNote = `虽可少清 ${primaryPlan.count - altPlan.count} 张（${altPlanName}门余 ${altPlan.count} 张）`;
    if (
      primary.dominantKeptCount >= 8 &&
      alt.dominantKeptCount < primary.dominantKeptCount
    ) {
      summary = `${fewerNote}，但会拆散 ${primary.dominantKeptCount} 张${suitNames[primary.dominantKeptSuit]}主门，削弱清一色方向。`;
    } else if (altPlan.retainedMelds < primaryPlan.retainedMelds) {
      summary = `${fewerNote}，但会拆散已有成组面子（完整面子从 ${primaryPlan.retainedMelds} 组减为 ${altPlan.retainedMelds} 组）。`;
    } else if (altPlan.retainedShanten > primaryPlan.retainedShanten) {
      summary = `${fewerNote}，但保留两门离听牌更远（向听 ${altPlan.retainedShanten} vs ${primaryPlan.retainedShanten}）。`;
    } else {
      summary = `${fewerNote}，但整体搭子与进张不如首选。`;
    }
  } else if (altPlan.retainedMelds < primaryPlan.retainedMelds) {
    summary = `换后同样余 ${altPlan.count} 张可定缺，但会拆散已有成组面子（完整面子从 ${primaryPlan.retainedMelds} 组减为 ${altPlan.retainedMelds} 组）。`;
  } else if (altPlan.retainedShanten > primaryPlan.retainedShanten) {
    summary = `换后同样余 ${altPlan.count} 张可定缺，但保留两门离听牌更远（向听 ${altPlan.retainedShanten} vs ${primaryPlan.retainedShanten}）。`;
  } else if (
    primary.dominantKeptCount >= 8 &&
    alt.dominantKeptCount < primary.dominantKeptCount
  ) {
    summary = `会拆散 ${primary.dominantKeptCount} 张${suitNames[primary.dominantKeptSuit]}主门，削弱清一色方向。`;
  } else {
    summary = `该门内的另一组换牌思路：换后${altPlanName}门余 ${altPlan.count} 张可定缺，整体结构略逊于首选。`;
  }

  const afterPart =
    alt.suitRemainingTiles.length === 0
      ? `${altSuitName}门清空（余 0 张）`
      : `${altSuitName}门余 ${alt.suitRemainingTiles.length} 张（${altRemText}）`;
  const planPart =
    altPlan.suit === alt.suit
      ? `后续可定缺${altPlanName}（余 ${altPlan.count} 张）`
      : `后续拟定缺${altPlanName}（余 ${altPlan.count} 张）`;
  const meldPart =
    altPlan.retainedMelds > 0
      ? `、含 ${altPlan.retainedMelds} 组完整${altMeldWord}`
      : "";
  let extraNote = "";
  if (alt.suitCountBefore >= 6 && alt.suit === primary.dominantKeptSuit) {
    extraNote = `，拆弱了 ${alt.suitCountBefore} 张${altSuitName}主门`;
  } else if (alt.suitCountBefore >= 4 && alt.suitHadPair && !alt.outHasPair) {
    extraNote =
      altPlan.suit !== alt.suit &&
      (alt.suitRemainingStructure.pairs > 0 ||
        alt.suitRemainingStructure.triplets > 0)
        ? `；该门内留住了对子`
        : `；换牌避开了整对送出`;
  } else if (alt.outHasMeld) {
    extraNote = `；且整组送出了完整面子`;
  }

  const reason = `若改换${altSuitName}门：换出 ${altTilesText} 后，${afterPart}，${planPart}；保留${keptNames}共 ${alt.keptTwoSuitCount} 张${meldPart}（向听粗估 ${altPlan.retainedShanten}）${extraNote}。`;

  return {
    action: { type: "exchange", tiles: alt.tiles },
    label: `换出 ${altTilesText}`,
    summary,
    reason,
    limit:
      "仅展示该门内较顺手的一组供对照，不是并列推荐或长期收益排名；同门其他三张组合也可合法换出。",
  };
}

// 仅扩充开局教学展示；实际推荐与托管选择仍由老师策略决定。
export function setupAdvice(
  view: PlayerView,
  phase: GameState["phase"],
): DecisionChoice[] {
  if (phase !== "exchange" && phase !== "choose-missing") return [];
  const choices = teacherChoices(view, phase);
  if (phase === "choose-missing") return choices;

  const first = choices[0];
  if (!first || first.action.type !== "exchange") return choices;

  const analyzed = analyzeExchangeChoices(view.hand);
  const primary = analyzed[0];
  if (!primary || analyzed.length <= 1) return choices;

  const alternatives = analyzed
    .slice(1)
    .map((alt) => formatAlternativeExchange(view.hand, alt, primary));
  return [first, ...alternatives];
}
