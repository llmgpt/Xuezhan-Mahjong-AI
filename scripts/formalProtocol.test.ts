import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULT_RULES } from "../src/game/game";
import { resolveLineup } from "./independentPolicies";
import {
  formalPlanHash,
  parseFormalScientificPlan,
  reserveFormalSeeds,
  summarizeFormalStatistics,
} from "./formalProtocol";
import type { IndependentRecord } from "./independentEvaluation";

// Synthetic parser/ledger inputs only: none of these seeds is executed or
// represented as fresh for the real project.
function plan() {
  const lineups = ["ebony-advanced", "fanfou-ba"];
  const criterion = {
    id: "overall",
    kind: "improvement",
    candidate: "candidate-advanced-discard-v5",
    baseline: "teacher-v1",
    lineups,
    openings: ["common", "composite"],
    minimumDifference: 0,
  };
  return {
    version: 1,
    purpose: "formal",
    innerEngineMode: "development",
    planId: "synthetic-plan",
    declaredAtUtc: "2026-10-19T00:00:00.000Z",
    sampleSize: 40,
    config: {
      mode: "development",
      seats: [0, 1, 2, 3],
      lineups,
      openings: ["common", "composite"],
      policies: ["teacher-v1", "candidate-advanced-discard-v5"],
      comparisons: [
        { candidate: "candidate-advanced-discard-v5", baseline: "teacher-v1" },
      ],
      timeoutMs: 60000,
    },
    lineupVectors: Object.fromEntries(
      lineups.map((name) => [name, resolveLineup(name)]),
    ),
    rules: structuredClone(DEFAULT_RULES),
    sourceFingerprint: Object.fromEntries(
      [
        "src/game/game.ts",
        "scripts/formalAudit.ts",
        "scripts/formalProtocol.ts",
        "scripts/independentPolicies.ts",
        "scripts/independentBenchmark.ts",
        "docs/RULES_V1.md",
        "vendor/ebony72-advanced/UPSTREAM.json",
        "vendor/fanfou-ba/UPSTREAM.json",
      ].map((name) => [name, "a".repeat(64)]),
    ),
    runtime: { node: "v22.22.1", python: "3.13.5", numpy: "2.1.3" },
    statistics: {
      method: "seed-cluster-normal",
      weighting: "equal-within-seed-over-selected-grid",
      familyWiseAlpha: 0.05,
      criticalValue: 2.4,
    },
    criteria: [
      criterion,
      {
        ...criterion,
        id: "advanced",
        kind: "guardrail",
        lineups: ["ebony-advanced"],
      },
      { ...criterion, id: "ba", kind: "guardrail", lineups: ["fanfou-ba"] },
    ],
    failurePolicy:
      "abort-on-invalid-action-dependency-worker-timeout-or-source-change",
    recoveryPolicy: "new-attempt-with-identical-prefix-only",
  };
}

const directories: string[] = [];
function ledger(data = {}) {
  const directory = mkdtempSync(join(tmpdir(), "xuezhan-formal-ledger-"));
  directories.push(directory);
  const path = join(directory, "seed-usage.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      knownUsedRanges: [[60000, 60039]],
      imports: [{ source: "synthetic-history.json", sha256: "b".repeat(64) }],
      reservations: [],
      ...data,
    }) + "\n",
  );
  return path;
}
const seeds = () => Array.from({ length: 40 }, (_, index) => 100 + index);

afterEach(() => {
  for (const path of directories.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(tmpdir()) ||
      !basename(path).startsWith("xuezhan-formal-ledger-")
    )
      throw new Error("unsafe ledger test cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("正式科学配置与种子消费登记", () => {
  it("实际牌桌电脑可作产品环境条件，不算新的独立外部来源", () => {
    const configured = plan();
    configured.config.lineups = [...configured.config.lineups, "ui-bots"];
    configured.lineupVectors["ui-bots"] = resolveLineup("ui-bots");
    expect(parseFormalScientificPlan(configured).config.lineups).toContain(
      "ui-bots",
    );
    const oneAuthor = plan();
    oneAuthor.config.lineups = ["ebony-advanced", "ui-bots"];
    oneAuthor.lineupVectors = Object.fromEntries(
      oneAuthor.config.lineups.map((name) => [name, resolveLineup(name)]),
    );
    expect(() => parseFormalScientificPlan(oneAuthor)).toThrow(/独立|来源/);
  });

  it("统计先在seed内合成，使用全部预定门槛且不把统计通过称作整体验收", () => {
    const parsed = parseFormalScientificPlan(plan());
    const records: IndependentRecord[] = [];
    for (const seed of seeds())
      for (const seat of parsed.config.seats)
        for (const lineup of parsed.config.lineups)
          for (const opening of parsed.config.openings)
            for (const policy of parsed.config.policies) {
              const points = policy === "teacher-v1" ? 0 : seed < 120 ? 3 : 1;
              const payer = (seat + 1) % 4;
              const scores = [0, 0, 0, 0];
              scores[seat] = points;
              scores[payer] = -points;
              const income = Array.from({ length: 4 }, () => ({
                selfWin: 0,
                discardWin: 0,
                dealIn: 0,
                paidSelfWin: 0,
                kong: 0,
                flower: 0,
                ready: 0,
              }));
              income[seat].selfWin = points;
              income[payer].paidSelfWin = -points;
              records.push({
                seed,
                seat,
                lineup,
                opening,
                policy,
                result: {
                  scores,
                  income,
                  wins: [],
                  steps: 1,
                  endReason: "wall",
                },
              });
            }
    const result = summarizeFormalStatistics(parsed, seeds(), records);
    expect(result.allStatisticalConditionsMet).toBe(true);
    expect(result.criteria).toHaveLength(3);
    for (const criterion of result.criteria) {
      expect(criterion.meanScoreDifference).toBe(2);
      expect(criterion.standardError).toBeCloseTo(Math.sqrt(1 / 39), 12);
      expect(criterion.interval[0]).toBeCloseTo(
        2 - 2.4 * Math.sqrt(1 / 39),
        12,
      );
    }
    const stricter = plan();
    stricter.criteria[1].minimumDifference = 1.9;
    expect(
      summarizeFormalStatistics(
        parseFormalScientificPlan(stricter),
        seeds(),
        records,
      ).allStatisticalConditionsMet,
    ).toBe(false);
    expect(() =>
      summarizeFormalStatistics(parsed, seeds().slice(1), records),
    ).toThrow(/样本|种子/);
    expect(() =>
      summarizeFormalStatistics(parsed, seeds(), records.slice(1)),
    ).toThrow(/组合|缺少/);
  });

  it("要求明确统计和规则配置，复制结果并按规范内容固定hash", () => {
    const raw = plan();
    const parsed = parseFormalScientificPlan(raw);
    expect(parsed).toEqual(raw);
    raw.criteria[0].minimumDifference = 999;
    expect(parsed.criteria[0].minimumDifference).toBe(0);
    const reversed = Object.fromEntries(Object.entries(parsed).reverse());
    expect(formalPlanHash(reversed)).toBe(formalPlanHash(parsed));
  });

  it("拒绝未填通过条件、低样本、漏座位和把同作者阵容冒充两独立来源", () => {
    const missingCriteria = { ...plan(), criteria: [] };
    const lowSample = { ...plan(), sampleSize: 8 };
    const missingSeat = plan();
    missingSeat.config.seats = [0, 1, 2];
    const oneAuthor = plan();
    oneAuthor.config.lineups = ["ebony-initial", "ebony-advanced"];
    oneAuthor.lineupVectors = Object.fromEntries(
      oneAuthor.config.lineups.map((name) => [name, resolveLineup(name)]),
    );
    const noWholeOpening = plan();
    noWholeOpening.config.openings = ["common"];
    for (const raw of [
      missingCriteria,
      lowSample,
      missingSeat,
      oneAuthor,
      noWholeOpening,
    ])
      expect(() => parseFormalScientificPlan(raw)).toThrow();
  });

  it("主通过条件不能只检内部对手或非劣而声称相对老师提升", () => {
    const noImprovement = plan();
    noImprovement.criteria = noImprovement.criteria.map((criterion) => ({
      ...criterion,
      kind: "guardrail",
    }));
    expect(() => parseFormalScientificPlan(noImprovement)).toThrow(
      /提升|improvement/,
    );
    const oneSource = plan();
    oneSource.criteria[0].lineups = ["ebony-advanced"];
    expect(() => parseFormalScientificPlan(oneSource)).toThrow(/独立|来源/);
    const negative = plan();
    negative.criteria[0].minimumDifference = -1;
    expect(() => parseFormalScientificPlan(negative)).toThrow(/提升|非负/);
  });

  it("所有通过条件共同计入预定Bonferroni正态近似区间", () => {
    const uncorrected = plan();
    uncorrected.statistics.criticalValue = 1.96;
    expect(() => parseFormalScientificPlan(uncorrected)).toThrow(
      /Bonferroni|临界/,
    );
    expect(parseFormalScientificPlan(plan()).statistics.criticalValue).toBe(
      2.4,
    );
    const unknown = plan();
    unknown.statistics.method = "choose-after-seeing-results";
    expect(() => parseFormalScientificPlan(unknown)).toThrow(/统计/);
  });

  it("拒绝未冻结字段、伪造阵容、规则和不含必需源码的数据闭包", () => {
    const badVector = plan();
    badVector.lineupVectors["fanfou-ba"] = resolveLineup("teacher-v1");
    const badSource = plan();
    delete badSource.sourceFingerprint["scripts/formalAudit.ts"];
    const traversal = plan();
    traversal.sourceFingerprint["../outside"] = "a".repeat(64);
    const badRule = { ...plan(), rules: { ...DEFAULT_RULES, hidden: true } };
    for (const raw of [
      { ...plan(), seed: 100 },
      badVector,
      badSource,
      traversal,
      badRule,
    ])
      expect(() => parseFormalScientificPlan(raw)).toThrow();
    const missingNumpy = plan();
    Reflect.deleteProperty(missingNumpy.runtime, "numpy");
    expect(() => parseFormalScientificPlan(missingNumpy)).toThrow(
      /NumPy|numpy/,
    );
  });

  it("原子消费全部预约种子，完全相同的恢复不再次写入", () => {
    const path = ledger();
    const parsed = parseFormalScientificPlan(plan());
    const first = reserveFormalSeeds(path, parsed, seeds());
    const before = readFileSync(path, "utf8");
    expect(first.reused).toBe(false);
    expect(first.reservation.seeds).toEqual(seeds());
    expect(JSON.parse(before).reservations).toHaveLength(1);
    expect(existsSync(path + ".lock")).toBe(false);
    const resumed = reserveFormalSeeds(path, parsed, seeds());
    expect(resumed.reused).toBe(true);
    expect(resumed.ledgerSha256).toBe(first.ledgerSha256);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("历史已用、另一协议已预约或改变原计划的种子均拒绝且保持原文件", () => {
    const path = ledger({ knownUsedRanges: [[100, 139]] });
    const parsed = parseFormalScientificPlan(plan());
    const before = readFileSync(path, "utf8");
    expect(() => reserveFormalSeeds(path, parsed, seeds())).toThrow(
      /已用|消费/,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
    const otherPath = ledger();
    reserveFormalSeeds(otherPath, parsed, seeds());
    const reserved = readFileSync(otherPath, "utf8");
    const changed = plan();
    changed.planId = "synthetic-other";
    expect(() =>
      reserveFormalSeeds(
        otherPath,
        parseFormalScientificPlan(changed),
        seeds(),
      ),
    ).toThrow(/预约|消费/);
    const changedSameId = plan();
    changedSameId.criteria[0].minimumDifference = 0.1;
    expect(() =>
      reserveFormalSeeds(
        otherPath,
        parseFormalScientificPlan(changedSameId),
        seeds(),
      ),
    ).toThrow(/计划|协议/);
    expect(() =>
      reserveFormalSeeds(otherPath, parsed, seeds().reverse()),
    ).toThrow(/种子|计划|协议/);
    expect(readFileSync(otherPath, "utf8")).toBe(reserved);
  });

  it("未初始化、已占用或损坏账本不能当作空白fresh登记", () => {
    const path = ledger();
    const parsed = parseFormalScientificPlan(plan());
    expect(() =>
      reserveFormalSeeds(path + ".missing", parsed, seeds()),
    ).toThrow(/账本|ENOENT/);
    writeFileSync(path + ".lock", JSON.stringify({ pid: process.pid }));
    expect(() => reserveFormalSeeds(path, parsed, seeds())).toThrow(/占用|锁/);
    const broken = ledger({
      knownUsedRanges: [
        [100, 139],
        [130, 150],
      ],
    });
    const before = readFileSync(broken, "utf8");
    expect(() => reserveFormalSeeds(broken, parsed, seeds())).toThrow(
      /账本|重叠/,
    );
    expect(readFileSync(broken, "utf8")).toBe(before);
  });
});
