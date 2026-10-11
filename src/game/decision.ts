import { actionKey, recommendActions } from "./actionAdvice";
import { recommendDiscards } from "./advice";
import { chooseBotExchange, chooseBotMissing } from "./bot";
import {
  chooseExchange,
  chooseMissing,
  declareKong,
  discard,
  respond,
  winSelf,
  type GameState,
} from "./game";
import type { PlayerAction } from "./session";
import { labelOf, suitOf, type Suit, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

export type DecisionAction =
  | PlayerAction
  | { type: "exchange"; tiles: Tile[] }
  | { type: "missing"; suit: Suit };

export interface DecisionChoice {
  action: DecisionAction;
  label: string;
  summary: string;
  reason: string;
  limit: string;
}

export interface DecisionExplanation {
  view: Pick<PlayerView, "missing">;
  actual: DecisionChoice;
  recommended: DecisionChoice;
  matchesRecommendation: boolean;
}

const suitNames: Record<Suit, string> = { wan: "万", tiao: "条", tong: "筒" };
const suits: Suit[] = ["wan", "tiao", "tong"];
const setupLimit =
  "只用本家手牌；开局采用简单且确定性的启发式选择，未搜索交换结果或长期收益。";

function key(action: DecisionAction): string {
  if (action.type === "exchange")
    return `exchange:${[...action.tiles].sort((a, b) => a - b).join(",")}`;
  if (action.type === "missing") return `missing:${action.suit}`;
  return actionKey(action);
}

// 建议策略只接收本家视图；完整状态仅用于判断是否轮到本家并执行合法操作。
function choicesFor(
  view: PlayerView,
  phase: GameState["phase"],
): DecisionChoice[] {
  if (phase === "exchange") {
    const tiles = chooseBotExchange(view.hand);
    return [
      {
        action: { type: "exchange", tiles },
        label: `换出 ${tiles.map(labelOf).join("、")}`,
        summary: "选择同一门的三张牌，四家提交后同时交换。",
        reason:
          "按万、条、筒顺序选择第一门足够三张的花色，再取该门手牌中的前三张；这是开局基线策略，未比较拆搭子的损失。",
        limit: setupLimit,
      },
    ];
  }
  if (phase === "choose-missing") {
    const preferred = chooseBotMissing(view.hand);
    return [preferred, ...suits.filter((suit) => suit !== preferred)].map(
      (suit) => {
        const count = view.hand.filter((tile) => suitOf(tile) === suit).length;
        return {
          action: { type: "missing", suit },
          label: `定缺${suitNames[suit]}`,
          summary: `当前${suitNames[suit]}牌 ${count} 张；优先选择张数最少的一门。`,
          reason: `三门张数：${suits.map((item) => `${suitNames[item]} ${view.hand.filter((tile) => suitOf(tile) === item).length} 张`).join("、")}。定缺后该门须先打完；张数相同按万、条、筒顺序选择，未比较搭子质量。`,
          limit: setupLimit,
        };
      },
    );
  }
  const actions = recommendActions(view);
  const discards = recommendDiscards(view).map((item): DecisionChoice => ({
    action: { type: "discard", tile: item.tile },
    label: `打出 ${labelOf(item.tile)}`,
    summary: item.summary,
    reason: item.reason,
    limit: item.limit,
  }));
  return [
    ...actions,
    ...discards.filter(
      (item) =>
        !actions.some((other) => key(other.action) === key(item.action)),
    ),
  ];
}

export function applyDecisionAction(
  state: GameState,
  seat: number,
  action: DecisionAction,
): GameState {
  switch (action.type) {
    case "exchange":
      return chooseExchange(state, seat, action.tiles);
    case "missing":
      return chooseMissing(state, seat, action.suit);
    case "discard":
      return discard(state, seat, action.tile);
    case "win":
      return winSelf(state, seat);
    case "kong":
      return declareKong(state, seat, action.kind, action.tile);
    case "respond":
      return respond(state, seat, action.choice);
  }
}

export function describeDecision(
  state: GameState,
  seat: number,
  action: DecisionAction,
): DecisionExplanation {
  const view = playerView(state, seat);
  const choices = choicesFor(view, state.phase);
  const recommended = choices[0];
  if (!recommended) throw new Error("当前没有可解释的决策");
  let actual = choices.find((item) => key(item.action) === key(action));
  if (!actual && action.type === "exchange")
    actual = {
      action,
      label: `换出 ${action.tiles.map(labelOf).join("、")}`,
      summary: "玩家选择同一门的三张牌。",
      reason: "规则要求三张同花色手牌；系统没有评价该组合的长期收益。",
      limit: setupLimit,
    };
  if (!actual) throw new Error("无法解析这项选择");
  return {
    view: { missing: view.missing },
    actual,
    recommended,
    matchesRecommendation: key(action) === key(recommended.action),
  };
}

export function chooseAutoplayAction(
  state: GameState,
): DecisionAction | undefined {
  const humanTurn =
    (state.phase === "exchange" && !state.players[0].exchange) ||
    (state.phase === "choose-missing" && !state.players[0].missing) ||
    (state.phase === "discard" && state.turn === 0) ||
    (state.phase === "respond" &&
      state.pending!.eligible.includes(0) &&
      !state.pending!.answers[0]);
  if (!humanTurn) return undefined;
  return choicesFor(playerView(state, 0), state.phase)[0]?.action;
}
