import { afterEach, describe, expect, it, vi } from "vitest";
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
import {
  createFormalController,
  type FormalControllerServices,
} from "./formalController";
import { createFormalJournal } from "./formalJournal";
import { formalPlanHash, parseFormalScientificPlan } from "./formalProtocol";
import { resolveLineup } from "./independentPolicies";
import type { IndependentRecord } from "./independentEvaluation";

const renameFault = vi.hoisted(() => ({
  remaining: 0,
  onBlocked: undefined as (() => void) | undefined,
}));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    renameSync: (...args: Parameters<typeof real.renameSync>) => {
      if (renameFault.remaining > 0) {
        renameFault.remaining--;
        renameFault.onBlocked?.();
        throw Object.assign(
          new Error("synthetic Windows file sharing denial"),
          { code: "EPERM" },
        );
      }
      return real.renameSync(...args);
    },
  };
});

// Synthetic controller transactions only: fake execution/audit services never play a seed.
// The real journaledSeed and capsule integrations are verified separately.
const directories: string[] = [];
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x !== null && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : x,
  );
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const fileHash = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xuezhan-formal-controller-"));
  directories.push(root);
  const lineups = ["ebony-advanced", "fanfou-ba"],
    criterion = {
      id: "overall",
      kind: "improvement",
      candidate: "candidate-advanced-discard-v5",
      baseline: "teacher-v1",
      lineups,
      openings: ["common", "composite"],
      minimumDifference: 0,
    };
  const plan = parseFormalScientificPlan({
    version: 1,
    purpose: "formal",
    innerEngineMode: "development",
    planId: "synthetic-controller",
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
      timeoutMs: 1000,
    },
    lineupVectors: Object.fromEntries(
      lineups.map((name) => [name, resolveLineup(name)]),
    ),
    rules: DEFAULT_RULES,
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
      ].map((p) => [p, "a".repeat(64)]),
    ),
    runtime: { node: process.version, python: "3.13.5", numpy: "2.1.3" },
    statistics: {
      method: "seed-cluster-normal",
      weighting: "equal-within-seed-over-selected-grid",
      familyWiseAlpha: 0.05,
      criticalValue: 2.4,
    },
    criteria: [
      criterion,
      { ...criterion, id: "a", kind: "guardrail", lineups: [lineups[0]] },
      { ...criterion, id: "f", kind: "guardrail", lineups: [lineups[1]] },
    ],
    failurePolicy:
      "abort-on-invalid-action-dependency-worker-timeout-or-source-change",
    recoveryPolicy: "new-attempt-with-identical-prefix-only",
  });
  writeFileSync(
    join(root, "history.json"),
    "synthetic prior-history evidence\n",
  );
  const ledgerPath = join(root, "ledger.json");
  writeFileSync(
    ledgerPath,
    JSON.stringify({
      version: 1,
      knownUsedRanges: [[60000, 60039]],
      imports: [
        {
          source: "history.json",
          sha256: fileHash(join(root, "history.json")),
        },
      ],
      reservations: [],
    }) + "\n",
  );
  const seeds = Array.from({ length: 40 }, (_, i) => 100 + i);
  let executions = 0,
    adoptions = 0;
  const services: FormalControllerServices = {
    verifyCapsule: async () => ({ plan, sealSha256: "b".repeat(64) }),
    execute: async (request) => {
      executions++;
      await writeSyntheticAttempt(request, plan);
      return JSON.parse(
        readFileSync(join(request.directory, "receipt.json"), "utf8"),
      );
    },
    adopt: async (request) => {
      adoptions++;
      const p = join(request.directory, "receipt.json");
      if (!existsSync(p))
        writeFileSync(
          p,
          JSON.stringify(
            await syntheticReceipt(
              request.directory,
              request.seed,
              request.planHash,
              digest(request.config),
            ),
          ) + "\n",
        );
      return JSON.parse(readFileSync(p, "utf8"));
    },
  };
  const controller = createFormalController(
    { directory: root, entryPath: join(root, "scripts/evaluate-formal.mjs") },
    services,
  );
  return {
    root,
    plan,
    seeds,
    ledgerPath,
    services,
    controller,
    counts: () => ({ executions, adoptions }),
  };
}
type SeedRequest = Parameters<FormalControllerServices["execute"]>[0];
async function syntheticReceipt(
  directory: string,
  seed: number,
  planHash: string,
  configSha256: string,
) {
  const rows = JSON.parse(
    readFileSync(join(directory, "games.jsonl"), "utf8")
      .trimEnd()
      .split("\n")[1],
  ).records;
  return {
    version: 1 as const,
    seed,
    planHash,
    configSha256,
    metadataSha256: fileHash(join(directory, "attempt.json")),
    gamesSha256: fileHash(join(directory, "games.jsonl")),
    tracesSha256: fileHash(join(directory, "traces.jsonl")),
    journalSha256: fileHash(join(directory, "journal.jsonl")),
    journalTerminal: "complete" as const,
    gameCount: rows.length,
    decisionCount: rows.length,
    replayedStates: rows.length * 3,
    committedAtUtc: new Date().toISOString(),
  };
}
async function writeSyntheticAttempt(
  request: SeedRequest,
  plan: ReturnType<typeof parseFormalScientificPlan>,
) {
  mkdirSync(request.directory);
  const config = request.config;
  const records: IndependentRecord[] = [];
  for (const seat of config.seats)
    for (const lineup of config.lineups)
      for (const opening of config.openings)
        for (const policy of config.policies) {
          const scores = [0, 0, 0, 0];
          if (policy !== "teacher-v1")
            for (let i = 0; i < 4; i++) scores[i] = i === seat ? 3 : -1;
          records.push({
            seed: request.seed,
            seat,
            lineup,
            opening,
            policy,
            result: {
              scores,
              wins: [],
              steps: 2,
              endReason: "wall",
              income: scores.map((kong) => ({
                selfWin: 0,
                discardWin: 0,
                dealIn: 0,
                paidSelfWin: 0,
                kong,
                flower: 0,
                ready: 0,
              })),
            },
          });
        }
  writeFileSync(
    join(request.directory, "attempt.json"),
    JSON.stringify({
      version: 1,
      planHash: request.planHash,
      seed: request.seed,
      configSha256: digest(config),
      sourceFingerprint: plan.sourceFingerprint,
      runtime: plan.runtime,
      rules: DEFAULT_RULES,
    }) + "\n",
  );
  writeFileSync(
    join(request.directory, "games.jsonl"),
    JSON.stringify({ kind: "synthetic-manifest" }) +
      "\n" +
      JSON.stringify({ kind: "seed", seed: request.seed, records }) +
      "\n",
  );
  writeFileSync(
    join(request.directory, "traces.jsonl"),
    JSON.stringify({
      kind: "game",
      seed: request.seed,
      note: "synthetic mocked audit evidence",
    }) + "\n",
  );
  const j = await createFormalJournal(
    join(request.directory, "journal.jsonl"),
    {
      planHash: request.planHash,
      seed: request.seed,
      expectedGames: records.length,
    },
    request.priorJournals,
  );
  try {
    for (const { result, ...spec } of records) {
      j.record({ kind: "game-start", spec });
      j.record({ kind: "game-complete", result });
    }
    j.complete();
  } finally {
    j.close();
  }
  writeFileSync(
    join(request.directory, "receipt.json"),
    JSON.stringify(
      await syntheticReceipt(
        request.directory,
        request.seed,
        request.planHash,
        digest(config),
      ),
    ) + "\n",
  );
}
afterEach(() => {
  renameFault.remaining = 0;
  renameFault.onBlocked = undefined;
  for (const path of directories.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(tmpdir()) ||
      !basename(path).startsWith("xuezhan-formal-controller-")
    )
      throw new Error("Unsafe controller cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});

describe("正式外层控制器的整组消费、attempt与最终门禁", () => {
  it("Windows短暂占用只重试同一登记写入，落盘前不能执行策略", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 8,
    });
    renameFault.remaining = 2;
    renameFault.onBlocked = () => expect(f.counts().executions).toBe(0);
    await f.controller.runShard(1);
    expect(f.counts().executions).toBe(5);
    expect(renameFault.remaining).toBe(0);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(false);
  });
  it("登记持续写入失败仍终止整组，不能先跑策略或消费替代seed", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 8,
    });
    renameFault.remaining = 100;
    await expect(f.controller.runShard(1)).rejects.toThrow(/sharing denial/);
    expect(f.counts().executions).toBe(0);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(true);
    expect(existsSync(join(f.root, "final-report.json"))).toBe(false);
  });
  it("末次capsule异步检查期间原始证据变化不能写正式完整报告", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 1,
    });
    await f.controller.runShard(1);
    const verify = f.services.verifyCapsule;
    let checks = 0;
    f.services.verifyCapsule = async () => {
      const capsule = await verify();
      if (++checks === 2) {
        // Synthetic external edit while final runtime verification is in flight;
        // neither this fixture nor the injected auditor executes any strategy.
        const traces = join(
          f.root,
          "results",
          String(f.seeds[0]),
          "attempt-0001",
          "traces.jsonl",
        );
        writeFileSync(
          traces,
          readFileSync(traces, "utf8") +
            JSON.stringify({
              kind: "failure",
              message: "synthetic late evidence mutation",
            }) +
            "\n",
        );
      }
      return capsule;
    };
    await expect(f.controller.finalize()).rejects.toThrow(/哈希|证据|日志/);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(true);
    expect(existsSync(join(f.root, "final-report.json"))).toBe(false);
  }, 30000);
  it("删除最后一次attempt目录不能伪装成从未执行，旧完成标记也不能掩盖", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 8,
    });
    await f.controller.runShard(1);
    const path = resolve(f.root, "results", "100", "attempt-0001");
    if (
      !path.startsWith(resolve(f.root) + "\\") ||
      basename(path) !== "attempt-0001"
    )
      throw new Error("Unsafe synthetic attempt deletion");
    rmSync(path, { recursive: true });
    const before = f.counts().executions;
    await expect(f.controller.runShard(1)).rejects.toThrow(/登记|缺失/);
    expect(f.counts().executions).toBe(before);
  }, 30000);
  it("未知分片参数不改变已冻结实验，也不留下策略失败标记", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 4,
    });
    await expect(f.controller.runShard(99)).rejects.toThrow(/未知|分片/);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(false);
  });

  it("最后一个seed的运行后封存身份变化也必须终止，不能仅检查旧对象", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 8,
    });
    const execute = f.services.execute,
      verify = f.services.verifyCapsule;
    let changed = false;
    f.services.execute = async (request) => {
      const receipt = await execute(request);
      if (request.seed === 132) changed = true;
      return receipt;
    };
    f.services.verifyCapsule = async () => ({
      ...(await verify()),
      ...(changed ? { sealSha256: "e".repeat(64) } : {}),
    });
    await expect(f.controller.runShard(1)).rejects.toThrow(/manifest|身份/);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(true);
    expect(existsSync(join(f.root, "shard-1.complete.json"))).toBe(false);
  }, 30000);

  it("最终审计失败必须保留终止记录，修回旧收据也不能偷偷重试", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 1,
    });
    await f.controller.runShard(1);
    const p = join(f.root, "results", "100", "attempt-0001", "receipt.json"),
      before = readFileSync(p, "utf8"),
      value = JSON.parse(before);
    writeFileSync(
      p,
      JSON.stringify({ ...value, gamesSha256: "e".repeat(64) }) + "\n",
    );
    await expect(f.controller.finalize()).rejects.toThrow(/哈希|收据/);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(true);
    writeFileSync(p, before);
    await expect(f.controller.finalize()).rejects.toThrow(/终止|失败/);
  }, 30000);
  it("封存前不放种子，整组预约先于任何执行且精确分片", async () => {
    const f = await fixture();
    const run = await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 4,
    });
    expect(f.counts().executions).toBe(0);
    expect(run.shards).toHaveLength(4);
    expect(run.shards[0].seeds).toEqual(f.seeds.filter((_, i) => i % 4 === 0));
    expect(
      JSON.parse(readFileSync(f.ledgerPath, "utf8")).reservations[0].seeds,
    ).toEqual(f.seeds);
    expect(existsSync(join(f.root, "run-commit.json"))).toBe(true);
  });

  it("缺种子不能输出通过；全部合成网格齐全才计算既定条件并保留原收据", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 2,
    });
    await f.controller.runShard(1);
    expect((await f.controller.finalize()).complete).toBe(false);
    expect(existsSync(join(f.root, "final-report.json"))).toBe(false);
    await f.controller.runShard(2);
    const final = await f.controller.finalize();
    expect(final.complete).toBe(true);
    if (!final.complete) throw new Error("Expected synthetic complete report");
    expect(final.executionAndStatisticalConditionsMet).toBe(true);
    expect(final.expertStrengthEstablished).toBe(false);
    expect(final.gameCount).toBe(1280);
    const before = readFileSync(join(f.root, "final-report.json"), "utf8");
    await f.controller.finalize();
    expect(readFileSync(join(f.root, "final-report.json"), "utf8")).toBe(
      before,
    );
  }, 30000);

  it("明示最后worker失败使整次运行终止，不能挑别的seed补齐", async () => {
    const f = await fixture();
    const controller = createFormalController(
      {
        directory: f.root,
        entryPath: join(f.root, "scripts/evaluate-formal.mjs"),
      },
      {
        ...f.services,
        execute: async () => {
          throw new Error("last worker failed");
        },
      },
    );
    await controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 2,
    });
    await expect(controller.runShard(1)).rejects.toThrow(/last worker/);
    expect(existsSync(join(f.root, "fatal.json"))).toBe(true);
    await expect(f.controller.runShard(2)).rejects.toThrow(/终止|失败/);
    await expect(f.controller.finalize()).rejects.toThrow(/终止|失败/);
    expect(f.counts().executions).toBe(0);
  });

  it("账本预约被删后只读拒绝续跑，不会重建；改变分片或历史来源也拒绝", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 2,
    });
    const raw = JSON.parse(readFileSync(f.ledgerPath, "utf8"));
    raw.reservations = [];
    writeFileSync(f.ledgerPath, JSON.stringify(raw) + "\n");
    const before = readFileSync(f.ledgerPath, "utf8");
    await expect(f.controller.runShard(1)).rejects.toThrow(/预约|消费/);
    expect(readFileSync(f.ledgerPath, "utf8")).toBe(before);
    const g = await fixture();
    await g.controller.reserve({
      ledgerPath: g.ledgerPath,
      projectRoot: g.root,
      seeds: g.seeds,
      shards: 2,
    });
    await expect(
      g.controller.reserve({
        ledgerPath: g.ledgerPath,
        projectRoot: g.root,
        seeds: g.seeds,
        shards: 4,
      }),
    ).rejects.toThrow(/分片|manifest/);
    writeFileSync(join(g.root, "history.json"), "changed history");
    await expect(g.controller.runShard(1)).rejects.toThrow(/历史/);
  });

  it("既存完整attempt仅审计接纳，无需再次执行策略", async () => {
    const f = await fixture();
    await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 4,
    });
    await f.controller.runShard(1);
    const before = f.counts().executions;
    await f.controller.runShard(1);
    expect(f.counts().executions).toBe(before);
    expect(f.counts().adoptions).toBeGreaterThan(0);
  }, 30000);

  it("任何先前失败attempt、分片清单改写或缺失权威绑定都不能恢复", async () => {
    const f = await fixture();
    const run = await f.controller.reserve({
      ledgerPath: f.ledgerPath,
      projectRoot: f.root,
      seeds: f.seeds,
      shards: 4,
    });
    const dir = join(f.root, "results", String(f.seeds[0]), "attempt-0001");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "attempt.json"),
      JSON.stringify({
        version: 1,
        planHash: formalPlanHash(f.plan),
        seed: f.seeds[0],
        configSha256: digest({ ...f.plan.config, seeds: f.seeds }),
        sourceFingerprint: f.plan.sourceFingerprint,
        runtime: f.plan.runtime,
        rules: DEFAULT_RULES,
      }) + "\n",
    );
    const j = await createFormalJournal(
      join(dir, "journal.jsonl"),
      { planHash: formalPlanHash(f.plan), seed: f.seeds[0], expectedGames: 32 },
      [],
    );
    j.fail("strategy timeout");
    j.close();
    const registrationPath = join(
      f.root,
      "registrations",
      `${f.seeds[0]}.json`,
    );
    const registration = JSON.parse(readFileSync(registrationPath, "utf8"));
    registration.attempts = ["attempt-0001"];
    writeFileSync(registrationPath, JSON.stringify(registration) + "\n");
    await expect(f.controller.runShard(run.shards[0].id)).rejects.toThrow(
      /失败|failure/,
    );
    expect(f.counts().executions).toBe(0);
    const g = await fixture();
    await g.controller.reserve({
      ledgerPath: g.ledgerPath,
      projectRoot: g.root,
      seeds: g.seeds,
      shards: 4,
    });
    const runPath = join(g.root, "run.json"),
      changed = JSON.parse(readFileSync(runPath, "utf8"));
    changed.shards[0].seeds.reverse();
    writeFileSync(runPath, JSON.stringify(changed) + "\n");
    await expect(g.controller.runShard(1)).rejects.toThrow(
      /manifest|绑定|分片/,
    );
  });
});
