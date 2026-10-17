import type { DecisionChoice } from "../game/decision";
import type { GameState } from "../game/game";
import { chooseStructureExchange } from "../game/openingAdvice";
import { teacherChoices } from "../game/teacher";
import { labelOf, suitOf, type Suit } from "../game/tiles";
import type { PlayerView } from "../game/view";

const suits: Suit[] = ["wan", "tiao", "tong"];
const suitNames: Record<Suit, string> = { wan: "万", tiao: "条", tong: "筒" };

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
  const recommendedSuit = suitOf(first.action.tiles[0]);
  const alternatives: DecisionChoice[] = [];
  for (const suit of suits) {
    if (suit === recommendedSuit) continue;
    const suited = view.hand.filter((tile) => suitOf(tile) === suit);
    if (suited.length < 3) continue;
    const tiles = chooseStructureExchange(suited);
    alternatives.push({
      action: { type: "exchange", tiles },
      label: `换出 ${tiles.map(labelOf).join("、")}`,
      summary: "该门内的规则候选，供比较另一门的换牌思路。",
      reason: `只在${suitNames[suit]}门手牌中运行同一结构保留算法，选出一组同门三张；该门的其他组合未逐项展示。`,
      limit:
        "只用本家手牌；不是并列推荐或长期收益排名，只列部分合法组合；其他手内同门三张组合也可合法换出。",
    });
  }
  return [first, ...alternatives];
}
