import { seatClusterSummary, type PairedSummary } from "./evaluationStats";
import type {
  IncomeBreakdown,
  IndependentGameResult,
} from "./independentRunner";

export type IndependentOpening = "common" | "composite";

export interface IndependentRecord {
  seed: number;
  seat: number;
  lineup: string;
  opening: IndependentOpening;
  policy: string;
  result: IndependentGameResult;
}

export interface IndependentExpected {
  seeds: readonly number[];
  seats: readonly number[];
  lineups: readonly string[];
  openings: readonly IndependentOpening[];
  policies: readonly string[];
}

export interface IndependentComparison {
  candidate: string;
  baseline: string;
}

export type IndependentEvaluationRecord = IndependentRecord;
export type ExpectedEvaluation = IndependentExpected;

export interface GroupedIncome {
  attack: number;
  kong: number;
  penalty: number;
  detail: IncomeBreakdown;
}

interface IndependentPolicySummary {
  games: number;
  meanScore: number;
  winRate: number;
  dealInRate: number;
  income: GroupedIncome;
}

export interface IndependentComparisonSummary
  extends IndependentComparison, PairedSummary {
  seedCount: number;
  pairedGames: number;
  confidenceInterval95NormalApprox: [number, number] | null;
  incomeDifference: GroupedIncome;
}

export interface IndependentGroupSummary {
  byPolicy: Record<string, IndependentPolicySummary>;
  comparisons: IndependentComparisonSummary[];
}

export interface IndependentEvaluationSummary {
  version: 2;
  recordCount: number;
  uncertainty: string;
  overall: IndependentGroupSummary;
  byOpening: Partial<
    Record<
      IndependentOpening,
      IndependentGroupSummary & {
        byLineup: Record<string, IndependentGroupSummary>;
      }
    >
  >;
  byLineup: Record<string, IndependentGroupSummary>;
}

const incomeKeys = [
  "selfWin",
  "discardWin",
  "dealIn",
  "paidSelfWin",
  "kong",
  "flower",
  "ready",
] as const;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupedIncome(rows: readonly IncomeBreakdown[]): GroupedIncome {
  const detail = Object.fromEntries(
    incomeKeys.map((key) => [key, mean(rows.map((row) => row[key]))]),
  ) as unknown as IncomeBreakdown;
  return {
    attack:
      detail.selfWin + detail.discardWin + detail.dealIn + detail.paidSelfWin,
    kong: detail.kong,
    penalty: detail.flower + detail.ready,
    detail,
  };
}

function validateExpected(
  expected: IndependentExpected,
  comparisons: readonly IndependentComparison[],
): void {
  for (const values of [
    expected.seeds,
    expected.seats,
    expected.lineups,
    expected.openings,
    expected.policies,
  ])
    if (
      !Array.isArray(values) ||
      !values.length ||
      new Set(values).size !== values.length
    )
      throw new Error("预期维度必须非空且不能重复");
  if (
    expected.seeds.some((seed) => !Number.isSafeInteger(seed)) ||
    expected.seats.some(
      (seat) => !Number.isInteger(seat) || seat < 0 || seat > 3,
    ) ||
    [...expected.lineups, ...expected.policies].some(
      (id) => typeof id !== "string" || !id.trim(),
    ) ||
    expected.openings.some(
      (opening) => opening !== "common" && opening !== "composite",
    )
  )
    throw new Error("无效预期维度");
  if (
    !comparisons.length ||
    new Set(
      comparisons.map((item) =>
        JSON.stringify([item.candidate, item.baseline]),
      ),
    ).size !== comparisons.length
  )
    throw new Error("比较项必须非空且不能重复");
  for (const item of comparisons)
    if (
      !expected.policies.includes(item.candidate) ||
      !expected.policies.includes(item.baseline) ||
      item.candidate === item.baseline
    )
      throw new Error("比较项必须指定两个不同的预期策略");
}

function validateResult(result: IndependentGameResult): void {
  if (
    !result ||
    !Array.isArray(result.scores) ||
    result.scores.length !== 4 ||
    !result.scores.every(Number.isFinite) ||
    result.scores.reduce((sum, value) => sum + value, 0) !== 0
  )
    throw new Error("终局净分必须为四家零和");
  if (!Array.isArray(result.income) || result.income.length !== 4)
    throw new Error("缺少四家收益分类");
  for (let seat = 0; seat < 4; seat += 1) {
    const income = result.income[seat];
    if (
      !income ||
      Object.keys(income).sort().join(",") !==
        [...incomeKeys].sort().join(",") ||
      incomeKeys.some((key) => !Number.isFinite(income[key])) ||
      incomeKeys.reduce((sum, key) => sum + income[key], 0) !==
        result.scores[seat] ||
      income.selfWin < 0 ||
      income.discardWin < 0 ||
      income.dealIn > 0 ||
      income.paidSelfWin > 0
    )
      throw new Error("收益分类无效或与终局净分不符");
  }
  const total = (keys: readonly (keyof IncomeBreakdown)[]) =>
    result.income.reduce(
      (sum, row) =>
        sum + keys.reduce((subtotal, key) => subtotal + row[key], 0),
      0,
    );
  for (const keys of [
    ["selfWin", "paidSelfWin"],
    ["discardWin", "dealIn"],
    ["kong"],
    ["flower"],
    ["ready"],
  ] as const)
    if (total(keys) !== 0) throw new Error("收益分类资金不守恒");
  if (
    !Array.isArray(result.wins) ||
    result.wins.some(
      (win) =>
        !win ||
        !Number.isInteger(win.winner) ||
        win.winner < 0 ||
        win.winner > 3 ||
        (win.payer !== null &&
          (!Number.isInteger(win.payer) || win.payer < 0 || win.payer > 3)),
    ) ||
    !Number.isSafeInteger(result.steps) ||
    result.steps < 1 ||
    !["wall", "three-wins"].includes(result.endReason ?? "")
  )
    throw new Error("无效终局收益记录");
}

function recordKey(
  row: Pick<
    IndependentRecord,
    "seed" | "seat" | "lineup" | "opening" | "policy"
  >,
): string {
  return JSON.stringify([
    row.seed,
    row.seat,
    row.lineup,
    row.opening,
    row.policy,
  ]);
}

export function summarizeIndependentEvaluation(
  records: readonly IndependentRecord[],
  expected: IndependentExpected,
  comparisons: readonly IndependentComparison[],
): IndependentEvaluationSummary {
  validateExpected(expected, comparisons);
  const index = new Map<string, IndependentRecord>();
  for (const row of records) {
    if (
      !row ||
      !expected.seeds.includes(row.seed) ||
      !expected.seats.includes(row.seat) ||
      !expected.lineups.includes(row.lineup) ||
      !expected.openings.includes(row.opening) ||
      !expected.policies.includes(row.policy)
    )
      throw new Error("发现额外或无效的预期外组合");
    const key = recordKey(row);
    if (index.has(key)) throw new Error("独立评估组合重复");
    validateResult(row.result);
    index.set(key, row);
  }
  const ordered = expected.seeds.flatMap((seed) =>
    expected.seats.flatMap((seat) =>
      expected.lineups.flatMap((lineup) =>
        expected.openings.flatMap((opening) =>
          expected.policies.map((policy) => {
            const row = index.get(
              recordKey({ seed, seat, lineup, opening, policy }),
            );
            if (!row) throw new Error("独立评估缺失组合，不能统计不完整配对");
            return row;
          }),
        ),
      ),
    ),
  );

  const summarize = (
    rows: readonly IndependentRecord[],
  ): IndependentGroupSummary => ({
    byPolicy: Object.fromEntries(
      expected.policies.map((policy) => {
        const samples = rows.filter((row) => row.policy === policy);
        return [
          policy,
          {
            games: samples.length,
            meanScore: mean(samples.map((row) => row.result.scores[row.seat])),
            winRate: mean(
              samples.map((row) =>
                Number(row.result.wins.some((win) => win.winner === row.seat)),
              ),
            ),
            dealInRate: mean(
              samples.map((row) =>
                Number(row.result.wins.some((win) => win.payer === row.seat)),
              ),
            ),
            income: groupedIncome(
              samples.map((row) => row.result.income[row.seat]),
            ),
          },
        ];
      }),
    ),
    comparisons: comparisons.map(({ candidate, baseline }) => {
      const left = rows.filter((row) => row.policy === candidate);
      const right = (row: IndependentRecord) =>
        index.get(recordKey({ ...row, policy: baseline }))!;
      const stats = seatClusterSummary(
        expected.seeds.map((seed) =>
          left
            .filter((row) => row.seed === seed)
            .map(
              (row) =>
                row.result.scores[row.seat] -
                right(row).result.scores[row.seat],
            ),
        ),
      );
      return {
        candidate,
        baseline,
        ...stats,
        seedCount: expected.seeds.length,
        pairedGames: left.length,
        confidenceInterval95NormalApprox:
          stats.standardError === null
            ? null
            : [
                stats.meanScoreDifference - 1.96 * stats.standardError,
                stats.meanScoreDifference + 1.96 * stats.standardError,
              ],
        incomeDifference: groupedIncome(
          left.map(
            (row) =>
              Object.fromEntries(
                incomeKeys.map((key) => [
                  key,
                  row.result.income[row.seat][key] -
                    right(row).result.income[row.seat][key],
                ]),
              ) as unknown as IncomeBreakdown,
          ),
        ),
      };
    }),
  });

  const byLineup = (rows: readonly IndependentRecord[]) =>
    Object.fromEntries(
      expected.lineups.map((lineup) => [
        lineup,
        summarize(rows.filter((row) => row.lineup === lineup)),
      ]),
    );
  return {
    version: 2,
    recordCount: ordered.length,
    uncertainty:
      "同种子内指定座位、阵容和开局等权平均，再按种子估计标准误及95%正态近似区间。共享初始牌墙不保证动作分歧后各家摸牌相同，也不保证降噪；小样本只作诊断，各开局分层单独解释，不自动判定通过。",
    overall: summarize(ordered),
    byOpening: Object.fromEntries(
      expected.openings.map((opening) => {
        const rows = ordered.filter((row) => row.opening === opening);
        return [opening, { ...summarize(rows), byLineup: byLineup(rows) }];
      }),
    ),
    byLineup: byLineup(ordered),
  };
}
