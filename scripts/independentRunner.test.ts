import { describe, expect, it } from "vitest";
import type { DecisionAction } from "../src/game/decision";
import type { Phase } from "../src/game/game";
import { chooseTeacherAction } from "../src/game/teacher";
import type { PlayerView } from "../src/game/view";
import { chooseAdviceAction, chooseOpponentAction } from "./benchmarkPolicies";
import { playBenchmarkGame } from "./benchmarkRunner";
import {
  playIndependentGame,
  summarizeTransfers,
  type IndependentDecisionTrace,
  type Policy,
} from "./independentRunner";

const greedy: Policy = (view, phase) =>
  chooseOpponentAction(view, phase, "greedy");
const opponents = [greedy, greedy, greedy, greedy] as const;

describe("独立异步整局执行", () => {
  it("等待异步策略并保留旧调度的固定种子四座位结果", async () => {
    for (const seat of [0, 1, 2, 3]) {
      const expected = playBenchmarkGame(91000, seat, "advice", "greedy");
      const policy: Policy = async (view, phase) => {
        await Promise.resolve();
        return chooseAdviceAction(view, phase);
      };
      const result = await playIndependentGame(91000, seat, policy, opponents);
      expect(result.scores[seat]).toBe(expected.score);
      expect(Number(result.wins.some((win) => win.winner === seat))).toBe(
        expected.won,
      );
      expect(result.scores.reduce((sum, score) => sum + score, 0)).toBe(0);
      expect(result.steps).toBeGreaterThan(0);
      for (const [actor, categories] of result.income.entries())
        expect(
          Object.values(categories).reduce((sum, value) => sum + value, 0),
        ).toBe(result.scores[actor]);
    }
  }, 30000);

  it("统一合理开局不调用各策略的原开局，定缺对其他座位保持隐藏", async () => {
    const openingSeats: number[] = [];
    const opening: Policy = (view, phase) => {
      expect(["exchange", "choose-missing"]).toContain(phase);
      expect(view.opponents.every((other) => other.missing === undefined)).toBe(
        true,
      );
      openingSeats.push(view.seat);
      return chooseTeacherAction(view, phase);
    };
    const afterOpening: Policy = (view, phase) => {
      expect(["discard", "respond"]).toContain(phase);
      return greedy(view, phase);
    };
    const result = await playIndependentGame(
      91000,
      2,
      afterOpening,
      [afterOpening, afterOpening, afterOpening, afterOpening],
      { openingPolicy: opening },
    );
    expect(openingSeats).toEqual([2, 0, 1, 3, 2, 0, 1, 3]);
    expect(result.scores).toHaveLength(4);
  }, 30000);

  it("相同共同开局在不同受评座位下产生相同庄家行牌起点", async () => {
    const starts: PlayerView[] = [];
    for (const seat of [0, 2]) {
      await playIndependentGame(91000, seat, greedy, opponents, {
        openingPolicy: chooseTeacherAction,
        onDecision: (row) => {
          if (
            row.actor === 0 &&
            row.phase === "discard" &&
            starts.length <= seat / 2
          )
            starts.push(row.view);
        },
      });
    }
    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual(starts[1]);
  }, 30000);

  it("策略和trace只收到当时公开视图，trace修改不能影响正在执行的动作", async () => {
    const traces: IndependentDecisionTrace[] = [];
    const privateChecks: Policy = (view, phase) => {
      expect(view).not.toHaveProperty("seed");
      expect(view).not.toHaveProperty("wall");
      expect(view.opponents.every((other) => !("hand" in other))).toBe(true);
      return greedy(view, phase);
    };
    const result = await playIndependentGame(
      91000,
      0,
      privateChecks,
      opponents,
      {
        onDecision: (row) => {
          traces.push(structuredClone(row));
          row.view.hand.length = 0;
          for (const tile of row.view.publicTiles ?? []) tile.tile = 26;
          if (row.action.type === "exchange") row.action.tiles.length = 0;
        },
      },
    );
    expect(traces.length).toBeGreaterThan(8);
    for (const trace of traces) {
      expect(Object.keys(trace).sort()).toEqual([
        "action",
        "actor",
        "phase",
        "step",
        "view",
      ]);
      expect(trace.view.hand.length).toBeGreaterThan(0);
    }
    expect(result.scores).toHaveLength(4);
  }, 30000);

  it("拒绝空动作、非法动作及异步错误，不回退为其他策略", async () => {
    await expect(
      playIndependentGame(91000, 0, () => undefined, opponents),
    ).rejects.toThrow(/没有.*动作|空.*动作|没有.*选择/);
    await expect(
      playIndependentGame(
        91000,
        0,
        () => ({ type: "discard", tile: 0 }),
        opponents,
      ),
    ).rejects.toThrow(/不能|非法/);
    await expect(
      playIndependentGame(
        91000,
        0,
        async () => {
          throw new Error("worker failed");
        },
        opponents,
      ),
    ).rejects.toThrow("worker failed");
  });

  it("拒绝缺失对手映射及无效受评座位", async () => {
    await expect(
      playIndependentGame(91000, 4, greedy, opponents),
    ).rejects.toThrow(/座位/);
    await expect(playIndependentGame(91000, 0, greedy, {})).rejects.toThrow(
      /对手|策略/,
    );
  });
});

describe("按结构化转账解释净收益", () => {
  it("区分胡牌收入、点炮、被自摸、杠与流局结算并守恒", () => {
    const income = summarizeTransfers(
      [
        { from: 1, to: 0, points: 3, reason: "self-win" },
        { from: 2, to: 0, points: 3, reason: "self-win" },
        { from: 3, to: 0, points: 3, reason: "self-win" },
        { from: 2, to: 1, points: 4, reason: "discard-win" },
        { from: 3, to: 1, points: 2, reason: "direct-kong" },
        { from: 3, to: 2, points: 2, reason: "concealed-kong" },
        { from: 1, to: 2, points: 1, reason: "added-kong" },
        { from: 3, to: 1, points: 8, reason: "flower" },
        { from: 3, to: 2, points: 4, reason: "ready" },
      ],
      [9, 10, 0, -19],
    );
    expect(income[0].selfWin).toBe(9);
    expect(income[1]).toMatchObject({
      paidSelfWin: -3,
      discardWin: 4,
      kong: 1,
      flower: 8,
    });
    expect(income[2]).toMatchObject({
      paidSelfWin: -3,
      dealIn: -4,
      kong: 3,
      ready: 4,
    });
    expect(income[3]).toMatchObject({
      paidSelfWin: -3,
      kong: -4,
      flower: -8,
      ready: -4,
    });
  });

  it("转账与终局净分不符时拒绝声称已解释收益", () => {
    expect(() => summarizeTransfers([], [1, -1, 0, 0])).toThrow(
      /净分|收益|转账/,
    );
  });
});

// Compile-time contract: callers may supply plain synchronous policies.
const synchronousPolicy: (
  view: PlayerView,
  phase: Phase,
) => DecisionAction | undefined = chooseAdviceAction;
void synchronousPolicy;
