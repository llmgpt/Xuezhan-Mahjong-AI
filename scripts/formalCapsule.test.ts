import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULT_RULES } from "../src/game/game";
import { resolveLineup } from "./independentPolicies";
import { sealFormalCapsule, verifyFormalCapsule } from "./formalCapsule";
import type { FormalRuntime } from "./formalRuntime";

// Synthetic filesystem/runtime contract fixtures only; no real holdout or policy is executed.
const directories: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xuezhan-formal-capsule-"));
  directories.push(root);
  const paths = [
    "src/game/game.ts",
    "scripts/formalAudit.ts",
    "scripts/formalProtocol.ts",
    "scripts/independentPolicies.ts",
    "scripts/independentBenchmark.ts",
    "docs/RULES_V1.md",
    "vendor/ebony72-advanced/UPSTREAM.json",
    "vendor/fanfou-ba/UPSTREAM.json",
    "scripts/evaluate-formal.ts",
  ];
  const sourceFingerprint = Object.fromEntries(
    paths.map((path) => {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      const content = "synthetic fixture: " + path;
      writeFileSync(target, content);
      return [path, sha(content)];
    }),
  );
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
  const plan = {
    version: 1,
    purpose: "formal",
    innerEngineMode: "development",
    planId: "synthetic-capsule",
    declaredAtUtc: "2026-10-19T00:00:00.000Z",
    sampleSize: 40,
    config: {
      mode: "development",
      seats: [0, 1, 2, 3],
      lineups,
      openings: ["common", "composite"],
      policies: ["teacher-v1", "candidate-advanced-discard-v5"],
      comparisons: [
        { candidate: criterion.candidate, baseline: criterion.baseline },
      ],
      timeoutMs: 60000,
    },
    lineupVectors: Object.fromEntries(
      lineups.map((name) => [name, resolveLineup(name)]),
    ),
    rules: DEFAULT_RULES,
    sourceFingerprint,
    runtime: { node: process.version, python: "3.13.5", numpy: "2.1.3" },
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
        lineups: [lineups[0]],
      },
      { ...criterion, id: "ba", kind: "guardrail", lineups: [lineups[1]] },
    ],
    failurePolicy:
      "abort-on-invalid-action-dependency-worker-timeout-or-source-change",
    recoveryPolicy: "new-attempt-with-identical-prefix-only",
  };
  const entryPath = join(root, "scripts/evaluate-formal.mjs");
  writeFileSync(entryPath, "synthetic compiled artifact");
  const build = {
    version: 1,
    entry: "scripts/evaluate-formal.mjs",
    sourceFingerprint,
    inputs: {
      "scripts/evaluate-formal.ts":
        sourceFingerprint["scripts/evaluate-formal.ts"],
    },
    bundleSha256: sha("synthetic compiled artifact"),
    compiler: { name: "esbuild", version: "synthetic" },
  };
  writeFileSync(join(root, "science.json"), JSON.stringify(plan) + "\n");
  writeFileSync(join(root, "build.json"), JSON.stringify(build) + "\n");
  const runtime = {
    versions: plan.runtime,
    node: { sha256: "a".repeat(64), execArgv: [] },
    python: { sha256: "b".repeat(64) },
    loadedModules: { "python-base/fixture.py": "c".repeat(64) },
    numpy: { files: { "numpy/fixture.py": "d".repeat(64) } },
    environment: { PYTHONHASHSEED: "0" },
  } as unknown as FormalRuntime;
  const services = {
    sourceFingerprint: () => structuredClone(sourceFingerprint),
    captureRuntime: async () => structuredClone(runtime),
  };
  return {
    root,
    entryPath,
    plan,
    build,
    runtime,
    services,
    options: { directory: root, entryPath },
  };
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(tmpdir()) ||
      !basename(path).startsWith("xuezhan-formal-capsule-")
    )
      throw new Error("Unsafe capsule test cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("正式冻结capsule的源码、构建与运行时门禁", () => {
  it("科学配置无种子时封存真实文件哈希，续跑只读检查全部闭包", async () => {
    const f = fixture();
    const seal = await sealFormalCapsule(f.options, f.services);
    expect(seal.runtime).toEqual(f.runtime);
    expect(seal.planHash).toMatch(/^[a-f0-9]{64}$/);
    const before = readFileSync(join(f.root, "seal.json"), "utf8");
    expect(
      (await verifyFormalCapsule(f.options, f.services)).plan.sourceFingerprint,
    ).toEqual(f.plan.sourceFingerprint);
    expect(readFileSync(join(f.root, "seal.json"), "utf8")).toBe(before);
    expect(existsSync(join(f.root, "run.json"))).toBe(false);
  });

  it("不能覆盖既存封存记录", async () => {
    const f = fixture();
    await sealFormalCapsule(f.options, f.services);
    const path = join(f.root, "seal.json"),
      before = readFileSync(path, "utf8");
    await expect(sealFormalCapsule(f.options, f.services)).rejects.toThrow(
      /已存在|覆盖/,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("源码文件改动即使版本号和伪装指纹查询不变仍拒绝", async () => {
    const f = fixture();
    await sealFormalCapsule(f.options, f.services);
    writeFileSync(join(f.root, "src/game/game.ts"), "changed engine");
    await expect(verifyFormalCapsule(f.options, f.services)).rejects.toThrow(
      /源码|指纹/,
    );
  });

  it("编译产物字节或build清单变化不能沿用原seal", async () => {
    for (const what of ["bundle", "manifest"]) {
      const f = fixture();
      await sealFormalCapsule(f.options, f.services);
      if (what === "bundle") writeFileSync(f.entryPath, "other compiled bytes");
      else
        writeFileSync(
          join(f.root, "build.json"),
          JSON.stringify({
            ...f.build,
            compiler: { name: "esbuild", version: "other" },
          }) + "\n",
        );
      await expect(verifyFormalCapsule(f.options, f.services)).rejects.toThrow(
        /构建|产物|封存/,
      );
    }
  });

  it("可执行文件、依赖文件或Node启动标记变化都拒绝，不能只核版本", async () => {
    for (const change of ["python", "dependency", "flags"]) {
      const f = fixture();
      await sealFormalCapsule(f.options, f.services);
      const runtime = structuredClone(f.runtime);
      if (change === "python") runtime.python.sha256 = "e".repeat(64);
      else if (change === "dependency")
        runtime.numpy!.files["numpy/fixture.py"] = "f".repeat(64);
      else runtime.node.execArgv = ["--conditions=changed"];
      await expect(
        verifyFormalCapsule(f.options, {
          ...f.services,
          captureRuntime: async () => runtime,
        }),
      ).rejects.toThrow(/运行时/);
    }
  });

  it("采集运行时期间源码变化，不写可用seal", async () => {
    const f = fixture();
    await expect(
      sealFormalCapsule(f.options, {
        ...f.services,
        captureRuntime: async () => {
          writeFileSync(
            join(f.root, "src/game/game.ts"),
            "changed during capture",
          );
          return f.runtime;
        },
      }),
    ).rejects.toThrow(/源码|指纹/);
    expect(existsSync(join(f.root, "seal.json"))).toBe(false);
  });

  it("构建输入必须属于冻结源，路径不能越界或含未知字段", async () => {
    for (const patch of [
      { inputs: { "../outside.ts": "a".repeat(64) } },
      { inputs: { "scripts/unfrozen.ts": "a".repeat(64) } },
      { hidden: true },
    ]) {
      const f = fixture();
      writeFileSync(
        join(f.root, "build.json"),
        JSON.stringify({ ...f.build, ...patch }) + "\n",
      );
      await expect(sealFormalCapsule(f.options, f.services)).rejects.toThrow(
        /构建|输入|字段/,
      );
      expect(existsSync(join(f.root, "seal.json"))).toBe(false);
    }
  });

  it("新增执行源码、错误入口路径或科学文件变化不能冒充原capsule", async () => {
    const f = fixture();
    await sealFormalCapsule(f.options, f.services);
    await expect(
      verifyFormalCapsule(f.options, {
        ...f.services,
        sourceFingerprint: () => ({
          ...f.plan.sourceFingerprint,
          "scripts/new.ts": "a".repeat(64),
        }),
      }),
    ).rejects.toThrow(/源码|指纹/);
    await expect(
      verifyFormalCapsule(
        { ...f.options, entryPath: join(f.root, "other.mjs") },
        f.services,
      ),
    ).rejects.toThrow(/入口/);
    writeFileSync(
      join(f.root, "science.json"),
      JSON.stringify({ ...f.plan, planId: "other-science" }) + "\n",
    );
    await expect(verifyFormalCapsule(f.options, f.services)).rejects.toThrow(
      /科学|封存|计划/,
    );
  });
});
