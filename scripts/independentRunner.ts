import { applyDecisionAction, type DecisionAction } from "../src/game/decision";
import {
  countTiles,
  createGame,
  draw,
  type GameState,
  type Phase,
  type ScoreTransfer,
  type WinRecord,
} from "../src/game/game";
import { playerView, type PlayerView } from "../src/game/view";

export type Policy = (
  view: PlayerView,
  phase: Phase,
) => DecisionAction | undefined | Promise<DecisionAction | undefined>;

export interface IndependentDecisionTrace {
  actor: number;
  phase: Phase;
  step: number;
  view: PlayerView;
  action: DecisionAction;
}

interface IndependentOptions {
  openingPolicy?: Policy;
  onDecision?: (trace: IndependentDecisionTrace) => void | Promise<void>;
}

export type IndependentTransfer = ScoreTransfer;

// 所有分类使用带符号净额；收入为正，支出为负。
export interface IncomeBreakdown {
  selfWin: number;
  discardWin: number;
  dealIn: number;
  paidSelfWin: number;
  kong: number;
  flower: number;
  ready: number;
}

export interface IndependentGameResult {
  scores: number[];
  wins: WinRecord[];
  steps: number;
  income: IncomeBreakdown[];
  endReason: GameState["endReason"];
}

export function summarizeTransfers(
  transfers: readonly IndependentTransfer[],
  scores: readonly number[],
): IncomeBreakdown[] {
  if (scores.length !== 4 || scores.some((score) => !Number.isFinite(score)))
    throw new Error("收益统计需要四家有效终局净分");
  const income = scores.map((): IncomeBreakdown => ({
    selfWin: 0,
    discardWin: 0,
    dealIn: 0,
    paidSelfWin: 0,
    kong: 0,
    flower: 0,
    ready: 0,
  }));
  for (const transfer of transfers) {
    if (
      ![transfer.from, transfer.to].every(
        (seat) => Number.isInteger(seat) && seat >= 0 && seat < 4,
      ) ||
      transfer.from === transfer.to ||
      !Number.isFinite(transfer.points) ||
      transfer.points < 0
    )
      throw new Error("无效收益转账");
    const payer = income[transfer.from];
    const receiver = income[transfer.to];
    if (transfer.reason === "self-win") {
      payer.paidSelfWin -= transfer.points;
      receiver.selfWin += transfer.points;
    } else if (transfer.reason === "discard-win") {
      payer.dealIn -= transfer.points;
      receiver.discardWin += transfer.points;
    } else {
      const category =
        transfer.reason === "flower"
          ? "flower"
          : transfer.reason === "ready"
            ? "ready"
            : transfer.reason === "direct-kong" ||
                transfer.reason === "concealed-kong" ||
                transfer.reason === "added-kong"
              ? "kong"
              : undefined;
      if (!category) throw new Error("未知收益转账原因");
      payer[category] -= transfer.points;
      receiver[category] += transfer.points;
    }
  }
  for (let seat = 0; seat < 4; seat += 1) {
    const total = Object.values(income[seat]).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (total !== scores[seat])
      throw new Error(`${seat} 号收益分类与终局净分不符`);
  }
  return income;
}

function assertState(state: GameState): void {
  if (countTiles(state) !== 108) throw new Error("独立评测牌数不守恒");
  if (state.players.reduce((sum, player) => sum + player.score, 0) !== 0)
    throw new Error("独立评测净分不守恒");
}

function nextActor(state: GameState, seat: number): number | undefined {
  const setupOrder = [seat, ...[0, 1, 2, 3].filter((other) => other !== seat)];
  if (state.phase === "exchange")
    return setupOrder.find((other) => !state.players[other].exchange);
  if (state.phase === "choose-missing")
    return setupOrder.find((other) => !state.players[other].missing);
  if (state.phase === "respond")
    return (
      state.pending!.eligible.find(
        (other) => other !== seat && !state.pending!.answers[other],
      ) ??
      state.pending!.eligible.find((other) => !state.pending!.answers[other])
    );
  return state.turn;
}

export async function playIndependentGame(
  seed: number,
  seat: number,
  policy: Policy,
  opponentPolicies: Readonly<Record<number, Policy>>,
  options: IndependentOptions = {},
): Promise<IndependentGameResult> {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3)
    throw new Error("无效受评座位");
  if (
    [0, 1, 2, 3].some((other) => typeof opponentPolicies[other] !== "function")
  )
    throw new Error("必须提供固定四座位的对手策略映射");
  let state = createGame(seed);
  let steps = 0;
  assertState(state);
  while (state.phase !== "ended" && steps < 3000) {
    if (state.phase === "draw") {
      state = draw(state, state.turn);
      assertState(state);
      steps += 1;
      continue;
    }
    const actor = nextActor(state, seat);
    if (actor === undefined) throw new Error("没有待操作座位");
    const phase = state.phase;
    const view = playerView(state, actor);
    const opening = phase === "exchange" || phase === "choose-missing";
    // 定缺为同时选择，不能让后调用的策略看到其他人已提交的选择。
    if (opening)
      view.opponents = view.opponents.map((other) => ({
        ...other,
        missing: undefined,
      }));
    const beforeDecision = options.onDecision && structuredClone(view);
    const choose =
      opening && options.openingPolicy
        ? options.openingPolicy
        : actor === seat
          ? policy
          : opponentPolicies[actor];
    const action = await choose(view, phase);
    if (!action) throw new Error(`${actor} 号策略没有选择动作`);
    const selected = structuredClone(action);
    const next = applyDecisionAction(state, actor, selected);
    if (!next) throw new Error(`${actor} 号策略选择非法动作`);
    assertState(next);
    if (options.onDecision)
      await options.onDecision({
        actor,
        phase,
        step: steps,
        view: beforeDecision!,
        action: structuredClone(selected),
      });
    state = next;
    steps += 1;
  }
  if (state.phase !== "ended")
    throw new Error("独立评测牌局未在步骤上限内结束");
  const scores = state.players.map((player) => player.score);
  return {
    scores,
    wins: structuredClone(state.wins),
    steps,
    income: summarizeTransfers(state.transfers, scores),
    endReason: state.endReason,
  };
}
