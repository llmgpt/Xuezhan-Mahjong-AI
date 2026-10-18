import { describe, expect, it } from "vitest";
import { chooseOpponentAction } from "../../scripts/benchmarkPolicies";
import { applyDecisionAction, type DecisionAction } from "./decision";
import {
  countTiles,
  createGame,
  draw,
  type GameState,
  type Phase,
} from "./game";
import { chooseTeacherAction } from "./teacher";
import { evaluateWin } from "./scoring";
import { suitOf } from "./tiles";
import { playerView } from "./view";
import {
  continueSampledGame,
  type ContinuationPolicy,
} from "./sampledContinuation";

const teacher: ContinuationPolicy = chooseTeacherAction;
const browserPolicy: ContinuationPolicy = (view, phase) =>
  view.seat === 0
    ? chooseTeacherAction(view, phase)
    : chooseOpponentAction(view, phase, "greedy");

function actor(state: GameState, seat = 0): number {
  if (state.phase === "exchange")
    return [0, 1, 2, 3].find((i) => !state.players[i].exchange)!;
  if (state.phase === "choose-missing")
    return [0, 1, 2, 3].find((i) => !state.players[i].missing)!;
  if (state.phase === "respond")
    return (
      state.pending!.eligible.find(
        (i) => i !== seat && !state.pending!.answers[i],
      ) ?? state.pending!.eligible.find((i) => !state.pending!.answers[i])!
    );
  return state.turn;
}

function step(
  state: GameState,
  policy: ContinuationPolicy,
  seat = 0,
): GameState {
  if (state.phase === "draw") return draw(state, state.turn);
  const seatToAct = actor(state, seat);
  const view = playerView(state, seatToAct);
  if (state.phase === "exchange" || state.phase === "choose-missing")
    view.opponents.forEach((other) => {
      other.missing = undefined;
    });
  const action = policy(view, state.phase);
  if (!action) throw new Error("missing fixture action");
  return applyDecisionAction(state, seatToAct, action);
}

function findState(
  seed: number,
  condition: (state: GameState) => boolean,
  policy = teacher,
): GameState {
  let state = createGame(seed);
  for (let i = 0; i < 3000 && state.phase !== "ended"; i++) {
    if (condition(state)) return state;
    state = step(state, policy);
  }
  throw new Error("fixture node not found");
}

function originalFinish(
  state: GameState,
  seat: number,
  first: DecisionAction,
  policy = teacher,
) {
  const initial = state.players.map((p) => p.score);
  const startingTransfers = state.transfers.length;
  let next = applyDecisionAction(state, seat, first);
  let steps = 1;
  while (next.phase !== "ended" && steps < 3000) {
    next = step(next, policy, seat);
    steps++;
  }
  if (next.phase !== "ended") throw new Error("fixture did not finish");
  return {
    scores: next.players.map((p) => p.score),
    scoreDifferences: next.players.map((p, i) => p.score - initial[i]),
    transfers: next.transfers.slice(startingTransfers),
    steps,
    endReason: next.endReason,
  };
}

function knownParticle(state: GameState) {
  return {
    hands: state.players.map((p) => [...p.hand]),
    wall: [...state.wall],
  };
}
const kongNode = () =>
  findState(80004, (state) => state.phase === "discard" && state.turn === 1);

describe("公开采样局面的真实规则续局", () => {
  it("相同粒子下现在暗杠和先打牌分别与真实引擎完整续局一致", () => {
    const state = kongNode();
    const view = playerView(state, 1);
    expect(view.decision?.kind).toBe("self");
    expect(
      view.decision?.kind === "self" && view.decision.concealedKongs,
    ).toContain(25);
    const first = chooseTeacherAction(view, "discard")!;
    for (const action of [
      first,
      { type: "kong", kind: "concealed", tile: 25 } satisfies DecisionAction,
    ]) {
      expect(continueSampledGame(view, knownParticle(state), action)).toEqual(
        originalFinish(state, 1, action),
      );
    }
  }, 30000);

  it("比较的是当前以后净分，不能把原有积分重复当作候选收益", () => {
    const state = findState(
      80000,
      (s) => s.phase === "discard" && s.wins.length > 0,
    );
    const seat = state.turn;
    expect(state.players.some((p) => p.score !== 0)).toBe(true);
    const view = playerView(state, seat);
    const action = chooseTeacherAction(view, "discard")!;
    const value = continueSampledGame(view, knownParticle(state), action);
    expect(value).toEqual(originalFinish(state, seat, action));
    const ledger = [0, 0, 0, 0];
    for (const pay of value.transfers) {
      ledger[pay.from] -= pay.points;
      ledger[pay.to] += pay.points;
    }
    expect(ledger).toEqual(value.scoreDifferences);
  }, 30000);

  it("即使逐种库存守恒，破坏已胡者合法胡型的粒子仍拒绝", () => {
    const state = findState(
      80000,
      (s) => s.phase === "discard" && s.wins.length > 0,
    );
    const win = state.wins[0];
    const particle = knownParticle(state);
    const winner = state.players[win.winner];
    const j = particle.wall.findIndex(
      (item) => suitOf(item) === winner.missing,
    );
    expect(j).toBeGreaterThanOrEqual(0);
    [particle.hands[win.winner][0], particle.wall[j]] = [
      particle.wall[j],
      particle.hands[win.winner][0],
    ];
    const complete = win.selfDraw
      ? particle.hands[win.winner]
      : [...particle.hands[win.winner], win.tile];
    expect(evaluateWin(complete, winner.melds, winner.missing!)).toBeNull();
    const view = playerView(state, state.turn);
    expect(() =>
      continueSampledGame(
        view,
        particle,
        chooseTeacherAction(view, "discard")!,
      ),
    ).toThrow(/赢家|缺门|胡牌/);
  });

  it("墙尽当步保留真实查叫/花猪结算，不用截断0分代替", () => {
    const state = findState(
      80000,
      (s) => s.phase === "discard" && s.turn === 0 && s.wall.length === 0,
      browserPolicy,
    );
    const view = playerView(state, 0);
    const action = browserPolicy(view, "discard")!;
    expect(
      continueSampledGame(view, knownParticle(state), action, {
        policy: browserPolicy,
      }),
    ).toEqual(originalFinish(state, 0, action, browserPolicy));
  }, 30000);

  it("未来策略只接收到各自生成的视图，修改快照不能损坏粒子或原view", () => {
    const state = kongNode();
    const view = playerView(state, 1);
    const particle = knownParticle(state);
    const before = structuredClone({ view, particle });
    let calls = 0;
    const policy: ContinuationPolicy = (input, phase: Phase) => {
      expect(input).not.toHaveProperty("seed");
      expect(input).not.toHaveProperty("wall");
      expect(input.opponents.every((p) => !("hand" in p))).toBe(true);
      const selected = teacher(input, phase);
      input.hand.length = 0;
      input.opponents[0].discards.length = 0;
      input.publicActions!.length = 0;
      calls++;
      return selected;
    };
    const result = continueSampledGame(
      view,
      particle,
      chooseTeacherAction(view, "discard")!,
      { policy },
    );
    expect(calls).toBeGreaterThan(0);
    expect(result.scores.reduce((a, b) => a + b, 0)).toBe(0);
    expect({ view, particle }).toEqual(before);
    expect(countTiles(state)).toBe(108);
  }, 30000);

  it("缺少真实历史或self阶段信息时不伪造摸牌上下文", () => {
    const state = kongNode();
    const view = playerView(state, 1);
    const action = chooseTeacherAction(view, "discard")!;
    const noHistory = structuredClone(view);
    delete noHistory.publicActions;
    expect(() =>
      continueSampledGame(noHistory, knownParticle(state), action),
    ).toThrow(/历史|publicActions/);
    const noDecision = structuredClone(view);
    delete noDecision.decision;
    expect(() =>
      continueSampledGame(noDecision, knownParticle(state), action),
    ).toThrow(/self|摸打|阶段/);
  });

  it("拒绝不符库存、本家手牌或合法动作的粒子，不能静默回退", () => {
    const state = kongNode();
    const view = playerView(state, 1);
    const action = chooseTeacherAction(view, "discard")!;
    const short = knownParticle(state);
    short.wall.pop();
    expect(() => continueSampledGame(view, short, action)).toThrow(
      /库存|牌墙|108/,
    );
    const switched = knownParticle(state);
    [switched.hands[1][0], switched.hands[0][0]] = [
      switched.hands[0][0],
      switched.hands[1][0],
    ];
    expect(() => continueSampledGame(view, switched, action)).toThrow(/本家/);
    expect(() =>
      continueSampledGame(view, knownParticle(state), {
        type: "kong",
        kind: "concealed",
        tile: 0,
      }),
    ).toThrow(/合法|不能/);
  });

  it("达到步数预算仍未结束时明确失败，不将未结算续局当成绩", () => {
    const state = kongNode();
    const view = playerView(state, 1);
    expect(() =>
      continueSampledGame(
        view,
        knownParticle(state),
        chooseTeacherAction(view, "discard")!,
        { maxSteps: 1 },
      ),
    ).toThrow(/步数|上限|结束/);
  });
});
