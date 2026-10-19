import { afterEach, describe, expect, it } from "vitest";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { IndependentGameResult } from "./independentRunner";
import {
  independentSourceFingerprint,
  parseIndependentConfig,
  independentRuntime,
  runIndependentBenchmark,
} from "./independentBenchmark";

const directories: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "xuezhan-independent-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(tmpdir()) ||
      !basename(path).startsWith("xuezhan-independent-")
    )
      throw new Error("unsafe test cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});
const config = () => ({
  mode: "development" as const,
  seeds: [80000, 80001],
  seats: [0],
  lineups: ["teacher-v1"],
  openings: ["common" as const],
  policies: ["teacher-v1", "candidate-v2"],
  comparisons: [{ candidate: "candidate-v2", baseline: "teacher-v1" }],
  timeoutMs: 1000,
});
const result = (): IndependentGameResult => ({
  scores: [0, 0, 0, 0],
  wins: [],
  steps: 1,
  endReason: "wall",
  income: Array.from({ length: 4 }, () => ({
    selfWin: 0,
    discardWin: 0,
    dealIn: 0,
    paidSelfWin: 0,
    kong: 0,
    flower: 0,
    ready: 0,
  })),
});
const options = () => ({
  runtime: { node: "test-node", python: "test-python" },
  fingerprint: () => ({ source: "a".repeat(64) }),
  play: async () => result(),
});

describe("独立评测v2的可复现持久化", () => {
  it("只在使用BA策略或BA对手时要求并冻结NumPy运行时", () => {
    const withoutNumpy = independentRuntime(config(), (source) => {
      if (source.includes("numpy")) throw new Error("NumPy unavailable");
      return JSON.stringify({ python: "3.13.5" });
    });
    expect(withoutNumpy).toEqual({ node: process.version, python: "3.13.5" });
    for (const configured of [
      { ...config(), policies: ["teacher-v1", "fanfou-ba-composite-v1"] },
      { ...config(), lineups: ["fanfou-ba"] },
    ]) {
      expect(
        independentRuntime(configured, (source) => {
          expect(source).toContain("import numpy");
          return JSON.stringify({ python: "3.13.5", numpy: "2.1.3" });
        }),
      ).toEqual({ node: process.version, python: "3.13.5", numpy: "2.1.3" });
      expect(() =>
        independentRuntime(configured, () => {
          throw new Error("NumPy unavailable");
        }),
      ).toThrow("NumPy unavailable");
      expect(() =>
        independentRuntime(configured, () =>
          JSON.stringify({ python: "3.13.5" }),
        ),
      ).toThrow(/NumPy|numpy|运行时/);
    }
  });

  it("BA原始查表CSV、许可、核心切片和可选依赖均纳入源码冻结", () => {
    const files = independentSourceFingerprint();
    for (const path of [
      "vendor/fanfou-ba/upstream/完整实验2.1/ai-demo/config/HuIndex.csv",
      "vendor/fanfou-ba/upstream/LICENSE",
      "vendor/fanfou-ba/derived/base-class.py",
      "vendor/fanfou-ba/derived/ba-class.py",
      "vendor/fanfou-ba/requirements.txt",
      "vendor/fanfou-ba/.gitattributes",
    ])
      expect(files[path]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("采样或回退诊断与当步公开轨迹关联保存，不把回退隐去", async () => {
    const output = directory();
    await runIndependentBenchmark({ ...config(), seeds: [80000] }, output, {
      ...options(),
      play: async (_spec, observers) => {
        observers.onEvaluation({
          actor: 0,
          report: {
            status: "fallback",
            samples: 0,
            choices: [],
            fallbackReason: "budget",
          },
        });
        return result();
      },
    });
    const saved = JSON.parse(
      readFileSync(join(output, "traces.jsonl"), "utf8").trim().split("\n")[0],
    );
    expect(saved.evaluations).toEqual([
      {
        actor: 0,
        decisionIndex: 0,
        report: {
          status: "fallback",
          samples: 0,
          choices: [],
          fallbackReason: "budget",
        },
      },
    ]);
  });
  it("高级参考的派生源码、审计补丁与来源清单纳入冻结指纹", () => {
    const files = independentSourceFingerprint();
    for (const path of [
      "vendor/ebony72-advanced/UPSTREAM.json",
      "vendor/ebony72-advanced/PUBLIC_ONLY.patch",
      "vendor/ebony72-advanced/derived/ebony72_advanced_public/utils/xzscore.py",
    ])
      expect(files[path]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("指纹覆盖实际vite-node与TypeScript执行配置", () => {
    const files = independentSourceFingerprint();
    for (const path of [
      "vite.config.ts",
      "tsconfig.json",
      "tsconfig.app.json",
      "tsconfig.node.json",
    ])
      expect(files[path]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("开发配置明确列出维度，拒绝重复、未知、无效比较和未经冻结的正式模式", () => {
    expect(parseIndependentConfig(config())).toEqual(config());
    for (const invalid of [
      { ...config(), mode: "formal" },
      { ...config(), seeds: [80000, 80000] },
      { ...config(), policies: ["teacher-v1", "typo"] },
      { ...config(), lineups: ["typo"] },
      {
        ...config(),
        comparisons: [{ candidate: "teacher-v1", baseline: "teacher-v1" }],
      },
      {
        ...config(),
        comparisons: [
          { candidate: "candidate-v2", baseline: "teacher-v1" },
          { baseline: "teacher-v1", candidate: "candidate-v2" },
        ],
      },
      { ...config(), timeoutMs: 0 },
      { ...config(), extra: true },
    ])
      expect(() => parseIndependentConfig(invalid)).toThrow();
  });

  it("只追加完整种子，四家收益可复核，原manifest一致时可续跑而不重演", async () => {
    const output = directory();
    let calls = 0;
    const first = await runIndependentBenchmark(config(), output, {
      ...options(),
      play: async () => {
        calls++;
        return result();
      },
    });
    expect(calls).toBe(4);
    expect(first.complete).toBe(true);
    expect(first.completedSeeds).toBe(2);
    expect(first.summary?.recordCount).toBe(4);
    const lines = readFileSync(join(output, "games.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((row) => row.kind)).toEqual(["manifest", "seed", "seed"]);
    expect(lines[0].version).toBe(2);
    const resumed = await runIndependentBenchmark(config(), output, {
      ...options(),
      play: async () => {
        throw new Error("must not replay");
      },
    });
    expect(resumed).toEqual(first);
  });

  it("源码或运行时变化拒绝续跑，原结果保持不变", async () => {
    const output = directory();
    await runIndependentBenchmark(config(), output, options());
    const original = readFileSync(join(output, "games.jsonl"), "utf8");
    await expect(
      runIndependentBenchmark(config(), output, {
        ...options(),
        fingerprint: () => ({ source: "b".repeat(64) }),
      }),
    ).rejects.toThrow(/不匹配|变化/);
    await expect(
      runIndependentBenchmark(config(), output, {
        ...options(),
        runtime: { node: "other", python: "test-python" },
      }),
    ).rejects.toThrow(/不匹配|变化/);
    expect(readFileSync(join(output, "games.jsonl"), "utf8")).toBe(original);
  });

  it("种子中途失败不产生部分成绩，保存错误供定位，再续跑整个种子", async () => {
    const output = directory();
    let calls = 0;
    await expect(
      runIndependentBenchmark(config(), output, {
        ...options(),
        play: async () => {
          if (++calls === 2) throw new Error("illegal upstream");
          return result();
        },
      }),
    ).rejects.toThrow("illegal upstream");
    expect(
      readFileSync(join(output, "games.jsonl"), "utf8").trim().split("\n"),
    ).toHaveLength(1);
    expect(readFileSync(join(output, "traces.jsonl"), "utf8")).toContain(
      "illegal upstream",
    );
    expect(
      (await runIndependentBenchmark(config(), output, options())).complete,
    ).toBe(true);
  });

  it("运行中变更源码也不会把混合版本种子写成有效成绩", async () => {
    const output = directory();
    let hash = "a".repeat(64);
    await expect(
      runIndependentBenchmark(config(), output, {
        ...options(),
        fingerprint: () => ({ source: hash }),
        play: async () => {
          hash = "b".repeat(64);
          return result();
        },
      }),
    ).rejects.toThrow(/源码.*变化/);
    expect(
      readFileSync(join(output, "games.jsonl"), "utf8").trim().split("\n"),
    ).toHaveLength(1);
  });

  it("现存活进程锁拒绝并发写入", async () => {
    const output = directory();
    writeFileSync(
      join(output, "run.lock"),
      JSON.stringify({ pid: process.pid }),
    );
    await expect(
      runIndependentBenchmark(config(), output, options()),
    ).rejects.toThrow(/进程|锁/);
    expect(JSON.parse(readFileSync(join(output, "run.lock"), "utf8")).pid).toBe(
      process.pid,
    );
  });

  it("截断或不完整的已提交种子直接拒绝，保留原字节用于排查", async () => {
    const output = directory();
    await runIndependentBenchmark(config(), output, options());
    appendFileSync(join(output, "games.jsonl"), '{"kind":');
    const original = readFileSync(join(output, "games.jsonl"), "utf8");
    await expect(
      runIndependentBenchmark(config(), output, options()),
    ).rejects.toThrow(/截断/);
    expect(readFileSync(join(output, "games.jsonl"), "utf8")).toBe(original);
    const other = directory();
    await runIndependentBenchmark(config(), other, options());
    const path = join(other, "games.jsonl");
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const seed = JSON.parse(lines[1]);
    seed.records.pop();
    lines[1] = JSON.stringify(seed);
    writeFileSync(path, lines.join("\n") + "\n");
    await expect(
      runIndependentBenchmark(config(), other, options()),
    ).rejects.toThrow(/缺少|不完整/);
  });
});
