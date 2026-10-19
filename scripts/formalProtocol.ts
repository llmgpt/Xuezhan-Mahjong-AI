import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_RULES } from "../src/game/game";
import {
  parseIndependentConfig,
  type IndependentConfig,
} from "./independentBenchmark";
import { resolveLineup } from "./independentPolicies";
import {
  summarizeIndependentEvaluation,
  type IndependentRecord,
} from "./independentEvaluation";

export interface FormalCriterion {
  id: string;
  kind: "improvement" | "guardrail";
  candidate: string;
  baseline: string;
  lineups: string[];
  openings: ("common" | "composite")[];
  minimumDifference: number;
}

export interface FormalScientificPlan {
  version: 1;
  purpose: "formal";
  innerEngineMode: "development";
  planId: string;
  declaredAtUtc: string;
  sampleSize: number;
  config: Omit<IndependentConfig, "seeds">;
  lineupVectors: Record<string, readonly string[]>;
  rules: typeof DEFAULT_RULES;
  sourceFingerprint: Record<string, string>;
  runtime: { node: string; python: string; numpy?: string };
  statistics: {
    method: "seed-cluster-normal";
    weighting: "equal-within-seed-over-selected-grid";
    familyWiseAlpha: number;
    criticalValue: number;
  };
  criteria: FormalCriterion[];
  failurePolicy: "abort-on-invalid-action-dependency-worker-timeout-or-source-change";
  recoveryPolicy: "new-attempt-with-identical-prefix-only";
}

interface SeedReservation {
  planId: string;
  planHash: string;
  seeds: number[];
  consumedAtUtc: string;
}

interface SeedUsageLedger {
  version: 1;
  knownUsedRanges: [number, number][];
  imports: { source: string; sha256: string }[];
  reservations: SeedReservation[];
}

const FAMILIES: Record<string, string> = {
  "ebony-initial": "ebony72",
  "ebony-advanced": "ebony72",
  "fanfou-ba": "xingdream",
  "teacher-v1": "internal",
};
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isSeed = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 0xffffffff;
const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const isUtc = (value: unknown): value is string =>
  typeof value === "string" &&
  value.endsWith("Z") &&
  Number.isFinite(Date.parse(value));
const isRelative = (path: string) =>
  path.length > 0 &&
  !/[\\:]/.test(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}

function fields(
  value: unknown,
  required: string[],
  name: string,
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new Error(`${name}含缺失或未知字段`);
}

function uniqueList(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length
  );
}

function externalFamilies(lineups: string[]): number {
  return new Set(
    lineups
      .map((name) => FAMILIES[name])
      .filter((family) => family && family !== "internal"),
  ).size;
}

// The polynomial normal-tail approximation has absolute error < 7.5e-8.
// Add that error bound: supplied critical values must be conservative even at
// the approximation boundary. This does not claim finite-sample normality.
function normalTailUpper(z: number): number {
  const t = 1 / (1 + 0.2316419 * z);
  const polynomial =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return (
    (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) * polynomial + 7.5e-8
  );
}

/** Schema/scientific-contract validation only; the runner must verify bytes. */
export function parseFormalScientificPlan(raw: unknown): FormalScientificPlan {
  fields(
    raw,
    [
      "version",
      "purpose",
      "innerEngineMode",
      "planId",
      "declaredAtUtc",
      "sampleSize",
      "config",
      "lineupVectors",
      "rules",
      "sourceFingerprint",
      "runtime",
      "statistics",
      "criteria",
      "failurePolicy",
      "recoveryPolicy",
    ],
    "正式科学计划",
  );
  const value = raw as unknown as FormalScientificPlan;
  if (
    value.version !== 1 ||
    value.purpose !== "formal" ||
    value.innerEngineMode !== "development" ||
    !isId(value.planId) ||
    !isUtc(value.declaredAtUtc) ||
    !Number.isSafeInteger(value.sampleSize) ||
    value.sampleSize < 30 ||
    value.sampleSize > 10000
  )
    throw new Error("无效正式计划身份、日期或预定样本数；正态近似至少30个seed");
  fields(
    value.config,
    [
      "mode",
      "seats",
      "lineups",
      "openings",
      "policies",
      "comparisons",
      "timeoutMs",
    ],
    "正式内层配置",
  );
  parseIndependentConfig({ ...value.config, seeds: [0] });
  if (
    canonical([...value.config.seats].sort()) !== canonical([0, 1, 2, 3]) ||
    canonical([...value.config.openings].sort()) !==
      canonical(["common", "composite"]) ||
    externalFamilies(value.config.lineups) < 2
  )
    throw new Error("正式网格需要四座位、两类开局和至少两个外部独立来源");
  fields(value.lineupVectors, value.config.lineups, "冻结阵容映射");
  for (const name of value.config.lineups)
    if (canonical(value.lineupVectors[name]) !== canonical(resolveLineup(name)))
      throw new Error("冻结阵容与实际注册映射不一致");
  if (canonical(value.rules) !== canonical(DEFAULT_RULES))
    throw new Error("当前实际引擎只支持冻结DEFAULT_RULES规则");
  fields(
    value.sourceFingerprint,
    [],
    "源码闭包",
    Object.keys(value.sourceFingerprint ?? {}),
  );
  for (const [path, hash] of Object.entries(value.sourceFingerprint))
    if (!isRelative(path) || !isDigest(hash))
      throw new Error("源码闭包路径或摘要无效");
  for (const path of [
    "src/game/game.ts",
    "scripts/formalAudit.ts",
    "scripts/formalProtocol.ts",
    "scripts/independentPolicies.ts",
    "scripts/independentBenchmark.ts",
    "docs/RULES_V1.md",
  ])
    if (!Object.hasOwn(value.sourceFingerprint, path))
      throw new Error(`源码闭包缺少${path}`);
  fields(value.runtime, ["node", "python"], "运行时", ["numpy"]);
  if (
    typeof value.runtime.node !== "string" ||
    !value.runtime.node ||
    typeof value.runtime.python !== "string" ||
    !value.runtime.python ||
    (value.runtime.numpy !== undefined &&
      (typeof value.runtime.numpy !== "string" || !value.runtime.numpy))
  )
    throw new Error("无效运行时版本");
  if (
    [
      ...value.config.policies,
      ...Object.values(value.lineupVectors).flat(),
    ].includes("fanfou-ba-composite-v1") &&
    value.runtime.numpy !== "2.1.3"
  )
    throw new Error("BA正式运行时必须固定NumPy2.1.3");
  fields(
    value.statistics,
    ["method", "weighting", "familyWiseAlpha", "criticalValue"],
    "统计方法",
  );
  const stats = value.statistics;
  if (
    stats.method !== "seed-cluster-normal" ||
    stats.weighting !== "equal-within-seed-over-selected-grid" ||
    !Number.isFinite(stats.familyWiseAlpha) ||
    stats.familyWiseAlpha <= 0 ||
    stats.familyWiseAlpha >= 0.5 ||
    !Number.isFinite(stats.criticalValue) ||
    stats.criticalValue < 1 ||
    stats.criticalValue > 8
  )
    throw new Error("无效预定统计方法或临界值");
  if (
    !Array.isArray(value.criteria) ||
    !value.criteria.length ||
    value.criteria.length > 32
  )
    throw new Error("必须预先填写全部正式通过条件");
  const ids = new Set<string>();
  let improvements = 0;
  for (const criterion of value.criteria) {
    fields(
      criterion,
      [
        "id",
        "kind",
        "candidate",
        "baseline",
        "lineups",
        "openings",
        "minimumDifference",
      ],
      "正式通过条件",
    );
    if (
      !isId(criterion.id) ||
      ids.has(criterion.id) ||
      !["improvement", "guardrail"].includes(criterion.kind) ||
      !value.config.comparisons.some(
        (pair) =>
          pair.candidate === criterion.candidate &&
          pair.baseline === criterion.baseline,
      ) ||
      !uniqueList(criterion.lineups) ||
      criterion.lineups.some(
        (name) =>
          typeof name !== "string" || !value.config.lineups.includes(name),
      ) ||
      !uniqueList(criterion.openings) ||
      criterion.openings.some(
        (name) => !value.config.openings.includes(name),
      ) ||
      !Number.isFinite(criterion.minimumDifference)
    )
      throw new Error("无效、重复或未冻结的通过条件");
    ids.add(criterion.id);
    if (criterion.kind === "improvement") {
      if (
        criterion.baseline !== "teacher-v1" ||
        criterion.minimumDifference < 0
      )
        throw new Error("提升条件必须相对现老师且阈值非负");
      if (externalFamilies(criterion.lineups) < 2)
        throw new Error("主提升条件必须覆盖两个独立外部来源");
      improvements++;
    }
  }
  if (!improvements) throw new Error("缺少相对当前老师的improvement提升条件");
  if (
    2 * value.criteria.length * normalTailUpper(stats.criticalValue) >
    stats.familyWiseAlpha
  )
    throw new Error("临界值未覆盖全部通过条件的Bonferroni双侧正态近似校正");
  if (
    value.failurePolicy !==
      "abort-on-invalid-action-dependency-worker-timeout-or-source-change" ||
    value.recoveryPolicy !== "new-attempt-with-identical-prefix-only"
  )
    throw new Error("正式失败与恢复合同必须明确冻结");
  return structuredClone(value);
}

export function formalPlanHash(raw: unknown): string {
  return digest(canonical(parseFormalScientificPlan(raw)));
}

/** Statistics only. Raw audit, execution and complete-run gates are separate. */
export function summarizeFormalStatistics(
  rawPlan: unknown,
  seeds: readonly number[],
  records: readonly IndependentRecord[],
) {
  const plan = parseFormalScientificPlan(rawPlan);
  if (
    !uniqueList(seeds) ||
    seeds.length !== plan.sampleSize ||
    !seeds.every(isSeed)
  )
    throw new Error("正式统计种子与预定样本数不符");
  const expected = { ...plan.config, seeds };
  const summary = summarizeIndependentEvaluation(
    records,
    expected,
    plan.config.comparisons,
  );
  const criteria = plan.criteria.map((criterion) => {
    const selected = records.filter(
      (row) =>
        criterion.lineups.includes(row.lineup) &&
        criterion.openings.includes(row.opening),
    );
    const compared = summarizeIndependentEvaluation(
      selected,
      { ...expected, lineups: criterion.lineups, openings: criterion.openings },
      [{ candidate: criterion.candidate, baseline: criterion.baseline }],
    ).overall.comparisons[0];
    if (compared.standardError === null)
      throw new Error("正式统计缺少种子聚类标准误");
    const interval: [number, number] = [
      compared.meanScoreDifference -
        plan.statistics.criticalValue * compared.standardError,
      compared.meanScoreDifference +
        plan.statistics.criticalValue * compared.standardError,
    ];
    return {
      ...structuredClone(criterion),
      seedCount: compared.seedCount,
      pairedGames: compared.pairedGames,
      meanScoreDifference: compared.meanScoreDifference,
      standardError: compared.standardError,
      interval,
      conditionMet: interval[0] > criterion.minimumDifference,
    };
  });
  return {
    summary,
    statistics: structuredClone(plan.statistics),
    criteria,
    allStatisticalConditionsMet: criteria.every(
      (criterion) => criterion.conditionMet,
    ),
    limitation:
      "Statistical conditions alone do not establish complete execution, raw-log validity or expert strength.",
  };
}

function parseLedger(raw: unknown): SeedUsageLedger {
  fields(
    raw,
    ["version", "knownUsedRanges", "imports", "reservations"],
    "种子账本",
  );
  const ledger = raw as unknown as SeedUsageLedger;
  if (
    ledger.version !== 1 ||
    !Array.isArray(ledger.knownUsedRanges) ||
    !Array.isArray(ledger.imports) ||
    !ledger.imports.length ||
    !Array.isArray(ledger.reservations)
  )
    throw new Error("种子账本尚未有效导入历史");
  let previousEnd = -1;
  for (const range of ledger.knownUsedRanges) {
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !isSeed(range[0]) ||
      !isSeed(range[1]) ||
      range[0] > range[1] ||
      range[0] <= previousEnd
    )
      throw new Error("种子账本历史范围无效或重叠");
    previousEnd = range[1];
  }
  for (const entry of ledger.imports) {
    fields(entry, ["source", "sha256"], "账本历史来源");
    if (
      typeof entry.source !== "string" ||
      !isRelative(entry.source) ||
      !isDigest(entry.sha256)
    )
      throw new Error("账本历史来源无效");
  }
  const ids = new Set<string>();
  const seeds = new Set<number>();
  for (const reservation of ledger.reservations) {
    fields(
      reservation,
      ["planId", "planHash", "seeds", "consumedAtUtc"],
      "种子预约",
    );
    if (
      !isId(reservation.planId) ||
      ids.has(reservation.planId) ||
      !isDigest(reservation.planHash) ||
      !isUtc(reservation.consumedAtUtc) ||
      !uniqueList(reservation.seeds) ||
      !reservation.seeds.every(isSeed)
    )
      throw new Error("种子账本预约无效");
    ids.add(reservation.planId);
    for (const seed of reservation.seeds) {
      if (
        seeds.has(seed) ||
        ledger.knownUsedRanges.some(
          ([first, last]) => seed >= first && seed <= last,
        )
      )
        throw new Error("种子账本消费记录重叠");
      seeds.add(seed);
    }
  }
  return ledger;
}

function lockLedger(path: string): () => void {
  const lockPath = path + ".lock";
  let handle: number;
  try {
    handle = openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: number;
    };
    if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0)
      throw new Error("种子账本锁损坏");
    try {
      process.kill(owner.pid!, 0);
      throw new Error("种子账本正被存活进程占用");
    } catch (state) {
      if ((state as NodeJS.ErrnoException).code !== "ESRCH") throw state;
    }
    unlinkSync(lockPath);
    handle = openSync(lockPath, "wx");
  }
  try {
    writeFileSync(handle, JSON.stringify({ pid: process.pid }));
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  return () => unlinkSync(lockPath);
}

/** Consumes the entire reservation durably before any policy execution. */
export function reserveFormalSeeds(
  path: string,
  rawPlan: unknown,
  requested: readonly number[],
): { reservation: SeedReservation; ledgerSha256: string; reused: boolean } {
  const plan = parseFormalScientificPlan(rawPlan);
  const planHash = formalPlanHash(plan);
  if (
    !uniqueList(requested) ||
    requested.length !== plan.sampleSize ||
    !requested.every(isSeed)
  )
    throw new Error("正式种子必须唯一且等于预定样本数");
  const target = resolve(path);
  const unlock = lockLedger(target);
  try {
    const original = readFileSync(target, "utf8");
    const ledger = parseLedger(JSON.parse(original));
    const previous = ledger.reservations.find(
      (entry) => entry.planId === plan.planId,
    );
    if (previous) {
      if (
        previous.planHash !== planHash ||
        canonical(previous.seeds) !== canonical(requested)
      )
        throw new Error("正式计划或种子变化，不能冒充原协议续跑");
      return {
        reservation: structuredClone(previous),
        ledgerSha256: digest(original),
        reused: true,
      };
    }
    const consumed = new Set(
      ledger.reservations.flatMap((entry) => entry.seeds),
    );
    if (
      requested.some(
        (seed) =>
          consumed.has(seed) ||
          ledger.knownUsedRanges.some(
            ([first, last]) => seed >= first && seed <= last,
          ),
      )
    )
      throw new Error("正式种子已用或已被另一协议预约消费");
    const reservation: SeedReservation = {
      planId: plan.planId,
      planHash,
      seeds: [...requested],
      consumedAtUtc: new Date().toISOString(),
    };
    ledger.reservations.push(reservation);
    const content = JSON.stringify(ledger, null, 2) + "\n";
    const temporary = target + `.${process.pid}.${randomUUID()}.tmp`;
    const handle = openSync(temporary, "wx");
    try {
      writeFileSync(handle, content);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temporary, target);
    return {
      reservation: structuredClone(reservation),
      ledgerSha256: digest(content),
      reused: false,
    };
  } finally {
    unlock();
  }
}
