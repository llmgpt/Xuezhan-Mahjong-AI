import { describe, expect, it } from "vitest";
import type {
  IncomeBreakdown,
  IndependentGameResult,
} from "./independentRunner";
import {
  summarizeIndependentEvaluation,
  type ExpectedEvaluation,
  type IndependentEvaluationRecord,
} from "./independentEvaluation";

function emptyIncome(): IncomeBreakdown {
  return {
    selfWin: 0,
    discardWin: 0,
    dealIn: 0,
    paidSelfWin: 0,
    kong: 0,
    flower: 0,
    ready: 0,
  };
}

function resultFor(
  seat: number,
  attack: number,
  kong = 0,
  penalty = 0,
): IndependentGameResult {
  const income = Array.from({ length: 4 }, emptyIncome);
  const other = (seat + 1) % 4;
  income[seat].selfWin = attack;
  income[other].paidSelfWin = -attack;
  income[seat].kong = kong;
  income[other].kong = -kong;
  income[seat].ready = penalty;
  income[other].ready = -penalty;
  return {
    scores: income.map((row) =>
      Object.values(row).reduce((sum, x) => sum + x, 0),
    ),
    income,
    wins: [],
    steps: 100,
    endReason: "wall",
  };
}

const expected: ExpectedEvaluation = {
  seeds: [100, 101],
  seats: [0, 1, 2, 3],
  lineups: ["a", "b"],
  openings: ["common", "composite"],
  policies: ["candidate", "baseline"],
};
const comparisons = [{ candidate: "candidate", baseline: "baseline" }];

function completeRecords(): IndependentEvaluationRecord[] {
  return expected.seeds.flatMap((seed) =>
    expected.seats.flatMap((seat) =>
      expected.lineups.flatMap((lineup) =>
        expected.openings.flatMap((opening) =>
          expected.policies.map((policy) => {
            const base = seed * 100 + seat * 10 + (lineup === "a" ? 200 : 0);
            const delta =
              (lineup === "a" ? (seed === 100 ? 10 : 18) : -2) +
              (opening === "composite" ? 4 : 0);
            return {
              seed,
              seat,
              lineup,
              opening,
              policy,
              result:
                policy === "candidate"
                  ? resultFor(seat, base + delta + 2, -1, -1)
                  : resultFor(seat, base),
            };
          }),
        ),
      ),
    ),
  );
}

describe("独立benchmark完整组合和配对统计", () => {
  it("同种子先合并座位、对手和开局，再以种子计算误差", () => {
    const summary = summarizeIndependentEvaluation(
      completeRecords(),
      expected,
      comparisons,
    );
    expect(summary.version).toBe(2);
    expect(summary.overall.comparisons[0]).toMatchObject({
      candidate: "candidate",
      baseline: "baseline",
      meanScoreDifference: 8,
      standardError: 2,
      seedCount: 2,
      pairedGames: 32,
      betterSeedFraction: 1,
      confidenceInterval95NormalApprox: [4.08, 11.92],
      incomeDifference: {
        attack: 10,
        kong: -1,
        penalty: -1,
      },
    });
    expect(summary.overall.byPolicy.candidate.games).toBe(32);
    expect(summary.overall).not.toHaveProperty("pass");
    expect(summary).not.toHaveProperty("pass");
  });

  it("分别保留开局、对手及交叉分组，不用整体平均掩盖负收益", () => {
    const summary = summarizeIndependentEvaluation(
      completeRecords(),
      expected,
      comparisons,
    );
    expect(summary.byOpening.common!.comparisons[0]).toMatchObject({
      meanScoreDifference: 6,
      standardError: 2,
      pairedGames: 16,
    });
    expect(summary.byOpening.composite!.comparisons[0]).toMatchObject({
      meanScoreDifference: 10,
      standardError: 2,
    });
    expect(summary.byLineup.a.comparisons[0]).toMatchObject({
      meanScoreDifference: 16,
      standardError: 4,
    });
    expect(summary.byOpening.common!.byLineup.b.comparisons[0]).toMatchObject({
      meanScoreDifference: -2,
      standardError: 0,
    });
    expect(
      summary.byOpening.composite!.byLineup.b.comparisons[0],
    ).toMatchObject({ meanScoreDifference: 2, standardError: 0 });
  });

  it("保留各策略逐项收益，分解差值之和等于配对净分差", () => {
    const summary = summarizeIndependentEvaluation(
      completeRecords(),
      expected,
      comparisons,
    );
    const delta = summary.overall.comparisons[0].incomeDifference;
    expect(delta.attack + delta.kong + delta.penalty).toBe(8);
    expect(delta.detail).toMatchObject({ selfWin: 10, kong: -1, ready: -1 });
    const policy = summary.overall.byPolicy.candidate;
    expect(
      policy.income.attack + policy.income.kong + policy.income.penalty,
    ).toBe(policy.meanScore);
  });

  it("输入行顺序不影响配对，且不会修改传入的结果或维度", () => {
    const rows = completeRecords();
    const saved = structuredClone({ rows, expected });
    const before = summarizeIndependentEvaluation(rows, expected, comparisons);
    const after = summarizeIndependentEvaluation(
      [...rows].reverse(),
      expected,
      comparisons,
    );
    expect(after).toEqual(before);
    expect({ rows, expected }).toEqual(saved);
  });

  it("允许上层完整配置携带mode等额外元数据，只读取声明的五个维度", () => {
    const config = { ...expected, mode: "development", comparisons };
    expect(
      summarizeIndependentEvaluation(completeRecords(), config, comparisons)
        .recordCount,
    ).toBe(64);
  });

  it("拒绝缺失、重复和额外组合，不容许不完整配对进入统计", () => {
    const rows = completeRecords();
    expect(() =>
      summarizeIndependentEvaluation(rows.slice(0, -1), expected, comparisons),
    ).toThrow(/缺失|缺少|完整/);
    expect(() =>
      summarizeIndependentEvaluation(
        [...rows.slice(0, -1), rows[0]],
        expected,
        comparisons,
      ),
    ).toThrow(/重复/);
    for (const extra of [
      { seed: 102 },
      { seat: 4 },
      { lineup: "other" },
      { opening: "other" },
      { policy: "other" },
    ]) {
      const changed = structuredClone(rows);
      Object.assign(changed[0], extra);
      expect(() =>
        summarizeIndependentEvaluation(changed, expected, comparisons),
      ).toThrow(/额外|预期|无效/);
    }
  });

  it("拒绝零和被破坏、收益漏项、非有限值和分类资金不守恒", () => {
    const rows = completeRecords();
    for (const corrupt of [
      (result: IndependentGameResult) => {
        result.scores[0] += 1;
      },
      (result: IndependentGameResult) => {
        result.income[0].selfWin += 1;
      },
      (result: IndependentGameResult) => {
        result.income[0].ready = NaN;
      },
      (result: IndependentGameResult) => {
        result.income[0].ready += 1;
        result.income[0].kong -= 1;
      },
    ]) {
      const changed = structuredClone(rows);
      corrupt(changed[0].result);
      expect(() =>
        summarizeIndependentEvaluation(changed, expected, comparisons),
      ).toThrow(/收益|零和|净分|守恒/);
    }
  });

  it("预期维度必须非空且唯一，比较项必须属于已声明策略", () => {
    const rows = completeRecords();
    for (const changed of [
      { ...expected, seeds: [] },
      { ...expected, seeds: [100, 100] },
      { ...expected, seats: [0, 0] },
      { ...expected, lineups: ["a", "a"] },
      { ...expected, openings: ["common", "common"] as const },
      { ...expected, policies: ["candidate", "candidate"] },
    ])
      expect(() =>
        summarizeIndependentEvaluation(rows, changed, comparisons),
      ).toThrow(/预期|重复|非空/);
    expect(() =>
      summarizeIndependentEvaluation(rows, expected, [
        { candidate: "missing", baseline: "baseline" },
      ]),
    ).toThrow(/比较|策略/);
    expect(() =>
      summarizeIndependentEvaluation(rows, expected, [
        { candidate: "candidate", baseline: "candidate" },
      ]),
    ).toThrow(/比较|策略/);
  });

  it("只有一个独立种子时不报告可估计的标准误或区间", () => {
    const single: ExpectedEvaluation = {
      seeds: [100],
      seats: [0],
      lineups: ["a"],
      openings: ["common"],
      policies: ["candidate", "baseline"],
    };
    const rows = completeRecords().filter(
      (row) =>
        row.seed === 100 &&
        row.seat === 0 &&
        row.lineup === "a" &&
        row.opening === "common",
    );
    const summary = summarizeIndependentEvaluation(rows, single, comparisons);
    expect(summary.overall.comparisons[0]).toMatchObject({
      seedCount: 1,
      standardError: null,
      confidenceInterval95NormalApprox: null,
    });
  });
});
