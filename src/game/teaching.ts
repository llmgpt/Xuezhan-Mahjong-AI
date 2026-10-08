import { actionKey, recommendActions } from "./actionAdvice";
import { recommendDiscards } from "./advice";
import { chooseBotExchange, chooseBotMissing } from "./bot";
import {
  chooseExchange,
  chooseMissing,
  declareKong,
  discard,
  draw,
  respond,
  winSelf,
  type GameState,
} from "./game";
import type { PlayerAction } from "./session";
import { labelOf, suitOf, type Suit, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

export type TeachingAction =
  | PlayerAction
  | { type: "exchange"; tiles: Tile[] }
  | { type: "missing"; suit: Suit }
  | { type: "draw" };

export interface DecisionChoice {
  action: TeachingAction;
  label: string;
  summary: string;
  reason: string;
  limit: string;
}

export interface DecisionRecord {
  seat: number;
  view: PlayerView;
  actual: DecisionChoice;
  recommended: DecisionChoice;
  alternatives: DecisionChoice[];
  matchesRecommendation: boolean;
  scoreChanges: number[];
  events: string[];
}

export interface AutomaticStep {
  before: GameState;
  after: GameState;
  decision: DecisionRecord;
}

const suitNames: Record<Suit, string> = { wan: "万", tiao: "条", tong: "筒" };
const suits: Suit[] = ["wan", "tiao", "tong"];
const setupLimit =
  "只用本家手牌；开局采用简单且确定性的启发式选择，未搜索交换结果或长期收益。";

function key(action: TeachingAction): string {
  if (action.type === "exchange")
    return `exchange:${[...action.tiles].sort((a, b) => a - b).join(",")}`;
  if (action.type === "missing") return `missing:${action.suit}`;
  if (action.type === "draw") return "draw";
  return actionKey(action);
}

// 策略入口只接收本家视图；完整状态只用于确定下一位行动者与执行合法操作。
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
  if (phase === "draw")
    return [
      {
        action: { type: "draw" },
        label: "摸牌",
        summary: "下一名未胡玩家从牌墙摸一张。",
        reason: "这是规则规定的流程动作，摸牌前不查看下一张牌。",
        limit: "摸牌没有策略备选；实际摸到的牌仅在动作完成后显示。",
      },
    ];
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

export function applyTeachingAction(
  state: GameState,
  seat: number,
  action: TeachingAction,
): GameState {
  switch (action.type) {
    case "exchange":
      return chooseExchange(state, seat, action.tiles);
    case "missing":
      return chooseMissing(state, seat, action.suit);
    case "draw":
      return draw(state, seat);
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

function makeRecord(
  before: GameState,
  after: GameState,
  seat: number,
  action: TeachingAction,
  view: PlayerView,
  choices: DecisionChoice[],
): DecisionRecord {
  const recommended = choices[0];
  if (!recommended) throw new Error("当前没有可记录的决策");
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
  // 决策快照独立于牌桌和后续回放；理由在读取动作结果前已经算出。
  return structuredClone({
    seat,
    view,
    actual,
    recommended,
    alternatives: choices.filter(
      (item) => key(item.action) !== key(recommended.action),
    ),
    matchesRecommendation: key(action) === key(recommended.action),
    scoreChanges: after.players.map(
      (player, index) => player.score - before.players[index].score,
    ),
    events: after.log.slice(before.log.length),
  });
}

export function recordDecision(
  before: GameState,
  after: GameState,
  seat: number,
  action: TeachingAction,
): DecisionRecord {
  const view = playerView(before, seat);
  return makeRecord(
    before,
    after,
    seat,
    action,
    view,
    choicesFor(view, before.phase),
  );
}

export function takeAutomaticStep(state: GameState): AutomaticStep | undefined {
  if (state.phase === "ended") return undefined;
  const seat =
    state.phase === "exchange"
      ? state.players.findIndex((player) => !player.exchange)
      : state.phase === "choose-missing"
        ? state.players.findIndex((player) => !player.missing)
        : state.phase === "respond"
          ? state.pending!.eligible.find(
              (other) => !state.pending!.answers[other],
            )!
          : state.turn;
  const view = playerView(state, seat);
  const choices = choicesFor(view, state.phase);
  if (!choices.length) throw new Error("自动对局没有合法选择");
  const action = choices[0].action;
  const after = applyTeachingAction(state, seat, action);
  return {
    before: state,
    after,
    decision: makeRecord(state, after, seat, action, view, choices),
  };
}

export function summarizeDecisions(records: readonly DecisionRecord[]) {
  const decisions = records.filter(
    (record) => record.actual.action.type !== "draw",
  );
  const deviations = decisions.filter(
    (record) => !record.matchesRecommendation,
  ).length;
  const keyIndices = records.flatMap((record, index) => {
    const action = record.actual.action;
    return !record.matchesRecommendation ||
      action.type === "win" ||
      action.type === "kong" ||
      (action.type === "respond" && action.choice !== "pass") ||
      record.scoreChanges.some((points) => points !== 0)
      ? [index]
      : [];
  });
  return { decisions: decisions.length, deviations, keyIndices };
}
