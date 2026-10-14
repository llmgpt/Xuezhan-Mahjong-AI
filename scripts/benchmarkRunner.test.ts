import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  combineBenchmarkFiles,
  parseBenchmarkConfig,
  playBenchmarkGame,
  runBenchmark,
  type GameResult,
} from "./benchmarkRunner";

const temporaryDirectories: string[] = [];
afterEach(() => {
  temporaryDirectories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true }));
});

function outputFile() {
  const directory = mkdtempSync(join(tmpdir(), "xuezhan-benchmark-"));
  temporaryDirectories.push(directory);
  return join(directory, "results.jsonl");
}

const sampleResult = (score: number): GameResult => ({
  score,
  won: Number(score > 0),
  wall: 0,
  dealIn: Number(score < 0),
  changedDiscards: 0,
  changedExchanges: 0,
});

describe("benchmark 配置和配对", () => {
  it("默认只运行原五种策略，实验候选须显式启用", () => {
    expect(parseBenchmarkConfig({}).policies).toEqual([
      "advice",
      "efficiency",
      "lookahead",
      "first",
      "random",
    ]);
  });

  it("允许只选 advice 和候选，不要求效率基线", () => {
    expect(
      parseBenchmarkConfig({ EVAL_POLICIES: "advice,opening-structure" })
        .policies,
    ).toEqual(["advice", "opening-structure"]);
    for (const env of [
      { EVAL_POLICIES: "efficiency" },
      { EVAL_SEATS: "0,0" },
      { EVAL_SEATS: "" },
      { EVAL_OPPONENTS: "greedy,unknown" },
      { EVAL_COUNT: "0" },
      { EVAL_START: "1.5" },
    ])
      expect(() => parseBenchmarkConfig(env)).toThrow();
  });

  it("同种子和座位分别配对，并按种子聚类而非把座位当独立样本", () => {
    const config = parseBenchmarkConfig({
      EVAL_START: "100",
      EVAL_COUNT: "2",
      EVAL_SEATS: "0,1",
      EVAL_POLICIES: "advice,first",
      EVAL_OPPONENTS: "greedy,patient",
    });
    const summary = runBenchmark(config, {
      play: (seed, seat, policy, opponent) =>
        sampleResult(
          (policy === "advice" ? (seed === 100 ? 2 : 6) : 0) +
            seat * 100 +
            (opponent === "patient" ? 20 : 0),
        ),
      progress: () => {},
      fingerprint: { rules: "v1" },
    });
    for (const opponent of ["greedy", "patient"] as const) {
      expect(summary.byOpponent[opponent].comparisons.first).toMatchObject({
        meanScoreDifference: 4,
        standardError: 2,
      });
      expect(
        summary.byOpponent[opponent].lookaheadVsEfficiency,
      ).toBeUndefined();
    }
    expect(summary.comparisonDirection).toBe("advice-minus-candidate");
  });

  it("只跑 lookahead 没有 efficiency 时省略两者对照", () => {
    const summary = runBenchmark(
      parseBenchmarkConfig({
        EVAL_COUNT: "1",
        EVAL_POLICIES: "advice,lookahead",
        EVAL_OPPONENTS: "greedy",
      }),
      {
        play: () => sampleResult(0),
        progress: () => {},
        fingerprint: { rules: "v1" },
      },
    );
    expect(summary.byOpponent.greedy.lookaheadVsEfficiency).toBeUndefined();
  });

  it("整体差值在每个种子内等权合并两类对手，再跨种子计算误差", () => {
    const summary = runBenchmark(
      parseBenchmarkConfig({
        EVAL_START: "100",
        EVAL_COUNT: "2",
        EVAL_SEATS: "0,1,2,3",
        EVAL_POLICIES: "advice,first",
        EVAL_OPPONENTS: "greedy,patient",
      }),
      {
        play: (seed, seat, policy, opponent) =>
          sampleResult(
            seat * 100 +
              (policy === "advice"
                ? opponent === "greedy"
                  ? seed === 100
                    ? 10
                    : 18
                  : -2
                : 0),
          ),
        progress: () => {},
        fingerprint: { rules: "v1" },
      },
    );
    expect(summary.overall.comparisons.first).toMatchObject({
      meanScoreDifference: 6,
      standardError: 2,
      seedCount: 2,
      confidenceInterval95NormalApprox: [2.08, 9.92],
    });
    expect(
      summary.byOpponent.patient.comparisons.first.meanScoreDifference,
    ).toBe(-2);
  });

  it("teacher 候选和消融策略均须显式注入，不能静默退回 advice", () => {
    for (const policy of ["teacher-candidate", "teacher-legacy-discard"]) {
      expect(() =>
        runBenchmark(
          parseBenchmarkConfig({ EVAL_POLICIES: `advice,${policy}` }),
          {
            play: () => sampleResult(0),
            progress: () => {},
            fingerprint: { rules: "v1" },
          },
        ),
      ).toThrow(/注入/);
    }
  });

  it("老师对各基线直接逐局相减，抵消共有种子波动并明确老师减基线方向", () => {
    const summary = runBenchmark(
      parseBenchmarkConfig({
        EVAL_START: "100",
        EVAL_COUNT: "2",
        EVAL_SEATS: "0,1,2,3",
        EVAL_POLICIES:
          "advice,efficiency,teacher-candidate,teacher-legacy-discard",
        EVAL_OPPONENTS: "greedy,patient",
      }),
      {
        play: (seed, seat, policy, opponent) =>
          sampleResult(
            seed * 100 +
              seat * 10 +
              (opponent === "patient" ? 200 : 0) +
              (policy === "teacher-candidate"
                ? seed === 100
                  ? 2
                  : 6
                : policy === "efficiency"
                  ? 1
                  : policy === "teacher-legacy-discard"
                    ? 5
                    : 0),
          ),
        teacherCandidate: () => undefined,
        teacherLegacyDiscard: () => undefined,
        progress: () => {},
        fingerprint: { rules: "v1" },
      },
    );
    const overall = summary.overall.teacherComparisons!;
    expect(overall.advice).toMatchObject({
      direction: "teacher-candidate-minus-advice",
      meanScoreDifference: 4,
      standardError: 2,
      seedCount: 2,
    });
    expect(overall.advice.confidenceInterval95NormalApprox![0]).toBeCloseTo(
      0.08,
    );
    expect(overall.advice.confidenceInterval95NormalApprox![1]).toBeCloseTo(
      7.92,
    );
    expect(overall.efficiency).toMatchObject({
      direction: "teacher-candidate-minus-efficiency",
      meanScoreDifference: 3,
      standardError: 2,
    });
    expect(overall["teacher-legacy-discard"]).toMatchObject({
      direction: "teacher-candidate-minus-teacher-legacy-discard",
      meanScoreDifference: -1,
      standardError: 2,
    });
    for (const opponent of ["greedy", "patient"]) {
      expect(
        summary.byOpponent[opponent].teacherComparisons!.advice
          .meanScoreDifference,
      ).toBe(4);
      expect(
        summary.byOpponent[opponent].teacherComparisons!.advice.standardError,
      ).toBe(2);
    }
  });
});

describe("benchmark 逐种子保存与安全续跑", () => {
  it("中断后仅复用已完整保存的种子，输出与完整运行一致", () => {
    const output = outputFile();
    const config = parseBenchmarkConfig({
      EVAL_START: "20",
      EVAL_COUNT: "3",
      EVAL_SEATS: "0,1",
      EVAL_POLICIES: "advice,first",
      EVAL_OPPONENTS: "greedy",
      EVAL_OUTPUT: output,
    });
    expect(() =>
      runBenchmark(config, {
        play: (seed) => {
          if (seed === 21) throw new Error("interrupted");
          return sampleResult(seed);
        },
        progress: () => {},
        fingerprint: { rules: "v1" },
      }),
    ).toThrow("interrupted");
    expect(readFileSync(output, "utf8").trim().split("\n")).toHaveLength(2);
    const resumedSeeds: number[] = [];
    const result = runBenchmark(config, {
      play: (seed) => {
        resumedSeeds.push(seed);
        return sampleResult(seed);
      },
      progress: () => {},
      fingerprint: { rules: "v1" },
    });
    expect(new Set(resumedSeeds)).toEqual(new Set([21, 22]));
    expect(result.completedSeeds).toBe(3);
    expect(result.byOpponent.greedy.byPolicy.advice.meanScore).toBe(21);
  });

  it("配置或源码指纹变化时拒绝复用，原文件不被改写", () => {
    const output = outputFile();
    const config = parseBenchmarkConfig({
      EVAL_COUNT: "1",
      EVAL_POLICIES: "advice,first",
      EVAL_OUTPUT: output,
    });
    runBenchmark(config, {
      play: () => sampleResult(1),
      progress: () => {},
      fingerprint: { rules: "v1" },
    });
    const original = readFileSync(output, "utf8");
    expect(() =>
      runBenchmark(
        { ...config, seats: [1] },
        {
          play: () => sampleResult(2),
          progress: () => {},
          fingerprint: { rules: "v1" },
        },
      ),
    ).toThrow(/不匹配/);
    expect(() =>
      runBenchmark(config, {
        play: () => sampleResult(2),
        progress: () => {},
        fingerprint: { rules: "v2" },
      }),
    ).toThrow(/不匹配/);
    expect(readFileSync(output, "utf8")).toBe(original);
  });

  it("只丢弃没有换行的最后截断记录，并明确报告恢复", () => {
    const output = outputFile();
    const config = parseBenchmarkConfig({
      EVAL_COUNT: "2",
      EVAL_POLICIES: "advice,first",
      EVAL_OPPONENTS: "greedy",
      EVAL_OUTPUT: output,
    });
    expect(() =>
      runBenchmark(config, {
        play: (seed) => {
          if (seed === config.startSeed + 1) throw new Error("interrupted");
          return sampleResult(1);
        },
        progress: () => {},
        fingerprint: { rules: "v1" },
      }),
    ).toThrow();
    writeFileSync(
      output,
      readFileSync(output, "utf8") + '{"kind":"seed","seed":',
    );
    const messages: string[] = [];
    const summary = runBenchmark(config, {
      play: () => sampleResult(1),
      progress: (message) => messages.push(message),
      fingerprint: { rules: "v1" },
    });
    expect(summary.completedSeeds).toBe(2);
    expect(messages.some((message) => message.includes("截断"))).toBe(true);
    expect(readFileSync(output, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("拒绝完整行中的损坏记录，不把缺少策略结果当作已完成", () => {
    const output = outputFile();
    const config = parseBenchmarkConfig({
      EVAL_COUNT: "1",
      EVAL_POLICIES: "advice,first",
      EVAL_OUTPUT: output,
    });
    runBenchmark(config, {
      play: () => sampleResult(1),
      progress: () => {},
      fingerprint: { rules: "v1" },
    });
    const lines = readFileSync(output, "utf8").trim().split("\n");
    const record = JSON.parse(lines[1]);
    delete record.runs[0].outcomes.first;
    writeFileSync(output, lines[0] + "\n" + JSON.stringify(record) + "\n");
    expect(() =>
      runBenchmark(config, {
        play: () => sampleResult(2),
        progress: () => {},
        fingerprint: { rules: "v1" },
      }),
    ).toThrow(/记录/);
  });

  it("拒绝并发写入同一个输出文件", () => {
    const output = outputFile();
    writeFileSync(`${output}.lock`, JSON.stringify({ pid: process.pid }));
    expect(() =>
      runBenchmark(parseBenchmarkConfig({ EVAL_OUTPUT: output }), {
        play: () => sampleResult(0),
        progress: () => {},
        fingerprint: { rules: "v1" },
      }),
    ).toThrow(/另一个进程/);
    expect(readFileSync(`${output}.lock`, "utf8")).toBe(
      JSON.stringify({ pid: process.pid }),
    );
  });
});

describe("独立四座位引擎的旧策略回归", () => {
  it("greedy 对手下复现重构前已记录的种子和座位结果", () => {
    const summary = runBenchmark(
      parseBenchmarkConfig({
        EVAL_START: "91000",
        EVAL_COUNT: "2",
        EVAL_SEATS: "0,2",
        EVAL_POLICIES: "advice,efficiency,first,random",
        EVAL_OPPONENTS: "greedy",
      }),
      { progress: () => {}, fingerprint: { rules: "v1" } },
    );
    const scores = Object.values(summary.byOpponent.greedy.byPolicy).map(
      (value) => value.meanScore,
    );
    expect(scores).toEqual([-0.5, -1, -0.5, -7]);
    expect(
      summary.byOpponent.greedy.comparisons.random.meanScoreDifference,
    ).toBe(6.5);
  }, 30000);

  it("patient 对手也能独立完成牌局且净分守恒", () => {
    expect(playBenchmarkGame(91000, 1, "advice", "patient").score).toBeTypeOf(
      "number",
    );
  }, 30000);
});

describe("正式 benchmark 分片只读合并", () => {
  const teacherPolicies = {
    teacherCandidate: () => undefined,
    teacherLegacyDiscard: () => undefined,
  };
  function writeChunk(
    start: number,
    count = 2,
    fingerprint = "v1",
    opponents = "greedy,patient",
  ) {
    const output = outputFile();
    runBenchmark(
      parseBenchmarkConfig({
        EVAL_START: String(start),
        EVAL_COUNT: String(count),
        EVAL_SEATS: "0,1,2,3",
        EVAL_POLICIES:
          "advice,efficiency,teacher-candidate,teacher-legacy-discard",
        EVAL_OPPONENTS: opponents,
        EVAL_OUTPUT: output,
      }),
      {
        ...teacherPolicies,
        fingerprint: { rules: fingerprint },
        progress: () => {},
        play: (seed, seat, policy, opponent) =>
          sampleResult(
            seed * 100 +
              seat * 10 +
              (opponent === "patient" ? 200 : 0) +
              (policy === "teacher-candidate"
                ? [-2, 6, 2, 10, 8][seed - 20]
                : policy === "efficiency"
                  ? 1
                  : policy === "teacher-legacy-discard"
                    ? 2
                    : 0),
          ),
      },
    );
    return output;
  }

  it("按所有原始种子重算结果，与单次完整运行等价，而非平均分片标准误", () => {
    const first = writeChunk(20);
    const second = writeChunk(22);
    const wholeFile = writeChunk(20, 4);
    const combined = combineBenchmarkFiles([second, first]);
    const whole = combineBenchmarkFiles([wholeFile]);
    expect(combined.overall).toEqual(whole.overall);
    expect(combined.byOpponent).toEqual(whole.byOpponent);
    expect(combined.count).toBe(4);
    expect(combined.startSeed).toBe(20);
    expect(
      combined.overall.teacherComparisons!.advice.meanScoreDifference,
    ).toBe(4);
    expect(
      combined.overall.teacherComparisons!.advice.standardError,
    ).toBeCloseTo(2.581988897471611);
    expect(combined.sourceFiles).toHaveLength(2);
    expect(combined.sourceFiles[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      combined.sourceFiles.map((source) => source.manifest.config.startSeed),
    ).toEqual([20, 22]);
    expect(readFileSync(first, "utf8").endsWith("\n")).toBe(true);
  });

  it("拒绝重复路径、重叠种子、漏种子及配置或源码不匹配", () => {
    const first = writeChunk(20);
    expect(() => combineBenchmarkFiles([first, first])).toThrow(/重复/);
    expect(() => combineBenchmarkFiles([first, writeChunk(21)])).toThrow(
      /重叠|重复/,
    );
    expect(() => combineBenchmarkFiles([first, writeChunk(23)])).toThrow(
      /连续|缺/,
    );
    expect(() =>
      combineBenchmarkFiles([first, writeChunk(22, 2, "v2")]),
    ).toThrow(/不匹配/);
    expect(() =>
      combineBenchmarkFiles([first, writeChunk(22, 2, "v1", "greedy")]),
    ).toThrow(/不匹配/);
  });

  it("拒绝未完成或截断分片，并且合并过程中不修复、改写源文件", () => {
    const first = writeChunk(20);
    const original = readFileSync(first, "utf8");
    const lines = original.trimEnd().split("\n");
    writeFileSync(first, lines.slice(0, -1).join("\n") + "\n");
    expect(() => combineBenchmarkFiles([first])).toThrow(/完成|缺/);
    writeFileSync(first, original.trimEnd());
    expect(() => combineBenchmarkFiles([first])).toThrow(/截断|换行/);
    expect(readFileSync(first, "utf8")).toBe(original.trimEnd());
    writeFileSync(first, original + "garbage\n");
    expect(() => combineBenchmarkFiles([first])).toThrow(/损坏|记录/);
  });

  it("汇总保留源manifest规则，不因分析工具当前默认规则而改写", () => {
    const source = writeChunk(20);
    const lines = readFileSync(source, "utf8").trimEnd().split("\n");
    const manifest = JSON.parse(lines[0]);
    manifest.rules.fanCap = 2;
    writeFileSync(
      source,
      JSON.stringify(manifest) + "\n" + lines.slice(1).join("\n") + "\n",
    );
    expect(combineBenchmarkFiles([source]).rules.fanCap).toBe(2);
  });
});
