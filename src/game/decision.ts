import { actionKey } from "./actionAdvice";
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
import { labelOf, type Suit, type Tile } from "./tiles";
import { teacherChoices } from "./teacher";
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
  return teacherChoices(view, phase);
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
  seat = 0,
): DecisionAction | undefined {
  const humanTurn =
    (state.phase === "exchange" && !state.players[seat].exchange) ||
    (state.phase === "choose-missing" && !state.players[seat].missing) ||
    (state.phase === "discard" && state.turn === seat) ||
    (state.phase === "respond" &&
      state.pending!.eligible.includes(seat) &&
      !state.pending!.answers[seat]);
  if (!humanTurn) return undefined;
  return choicesFor(playerView(state, seat), state.phase)[0]?.action;
}
