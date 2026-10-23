import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RULES, type Phase } from "../src/game/game";
import type { RolloutDecision } from "../src/game/rolloutTeacher";
import type { LiabilityDiscardDecision } from "../src/game/liabilityDiscard";
import { chooseTeacherAction } from "../src/game/teacher";
import type { PlayerView } from "../src/game/view";
import {
  summarizeIndependentEvaluation,
  type IndependentComparison,
  type IndependentExpected,
  type IndependentRecord,
} from "./independentEvaluation";
import {
  createPolicySession,
  INDEPENDENT_POLICY_IDS,
  resolveLineup,
} from "./independentPolicies";
import {
  playIndependentGame,
  type IndependentDecisionTrace,
  type IndependentGameResult,
  type Policy,
} from "./independentRunner";

export interface IndependentConfig extends IndependentExpected {
  mode: "development";
  comparisons: IndependentComparison[];
  timeoutMs: number;
}
interface Runtime {
  node: string;
  python: string;
  numpy?: string;
}
type GameSpec = Omit<IndependentRecord, "result">;
interface Attempt {
  actor: number;
  phase: Phase;
  view: PlayerView;
}
interface Observers {
  onDecision: (trace: IndependentDecisionTrace) => void;
  onAttempt: (attempt: Attempt) => void;
  onEvaluation: (event: { actor: number; report: RolloutDecision }) => void;
  onLiabilityEvaluation: (event: {
    actor: number;
    report: LiabilityDiscardDecision;
  }) => void;
}
interface RunOptions {
  runtime?: Runtime;
  fingerprint?: () => Record<string, string>;
  play?: (
    spec: GameSpec,
    observers: Observers,
  ) => Promise<IndependentGameResult>;
  progress?: (message: string) => void;
}

const root = fileURLToPath(new URL("..", import.meta.url));
function list(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length
  );
}

export function parseIndependentConfig(raw: unknown): IndependentConfig {
  if (!raw || typeof raw !== "object")
    throw new Error("独立评测需要显式JSON配置");
  const value = raw as IndependentConfig;
  const fields = [
    "mode",
    "seeds",
    "seats",
    "lineups",
    "openings",
    "policies",
    "comparisons",
    "timeoutMs",
  ];
  if (
    Object.keys(value).some((key) => !fields.includes(key)) ||
    value.mode !== "development" ||
    !list(value.seeds) ||
    value.seeds.some(
      (seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff,
    ) ||
    !list(value.seats) ||
    value.seats.some(
      (seat) => !Number.isInteger(seat) || seat < 0 || seat > 3,
    ) ||
    !list(value.openings) ||
    value.openings.some(
      (opening) => opening !== "common" && opening !== "composite",
    ) ||
    !list(value.policies) ||
    value.policies.some(
      (id) =>
        !INDEPENDENT_POLICY_IDS.includes(
          id as (typeof INDEPENDENT_POLICY_IDS)[number],
        ),
    ) ||
    !list(value.lineups) ||
    value.lineups.some((id) => typeof id !== "string") ||
    !Array.isArray(value.comparisons) ||
    !value.comparisons.length ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs <= 0
  )
    throw new Error(
      "无效开发配置；正式评估需另行冻结协议，当前CLI不接受formal模式",
    );
  for (const id of value.lineups) resolveLineup(id);
  const pairs = new Set<string>();
  for (const comparison of value.comparisons) {
    if (
      !comparison ||
      Object.keys(comparison).sort().join(",") !== "baseline,candidate" ||
      !value.policies.includes(comparison.candidate) ||
      !value.policies.includes(comparison.baseline) ||
      comparison.candidate === comparison.baseline ||
      pairs.has(JSON.stringify([comparison.candidate, comparison.baseline]))
    )
      throw new Error("无效或重复策略比较项");
    pairs.add(JSON.stringify([comparison.candidate, comparison.baseline]));
  }
  return structuredClone({
    mode: value.mode,
    seeds: value.seeds,
    seats: value.seats,
    lineups: value.lineups,
    openings: value.openings,
    policies: value.policies,
    comparisons: value.comparisons.map((item) => ({
      candidate: item.candidate,
      baseline: item.baseline,
    })),
    timeoutMs: value.timeoutMs,
  });
}

export function independentSourceFingerprint(): Record<string, string> {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__pycache__") visit(path);
      } else if (
        (/\.(ts|py|json|md|patch|csv|txt)$/.test(entry.name) &&
          !/\.test\.ts$/.test(entry.name) &&
          !/^test_/.test(entry.name)) ||
        entry.name === ".gitattributes" ||
        entry.name === "LICENSE"
      )
        files.push(path);
    }
  };
  for (const directory of [
    "src/game",
    "scripts",
    "vendor/ebony72-mahjong",
    "vendor/ebony72-advanced",
    "vendor/fanfou-ba",
  ])
    visit(join(root, directory));
  for (const path of [
    "package.json",
    "package-lock.json",
    "docs/RULES_V1.md",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.app.json",
    "tsconfig.node.json",
  ])
    files.push(join(root, path));
  return Object.fromEntries(
    [...new Set(files)]
      .sort()
      .map((path) => [
        relative(root, path).replaceAll("\\", "/"),
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      ]),
  );
}

export function independentRuntime(
  config: Pick<IndependentConfig, "policies" | "lineups">,
  queryPython: (source: string) => string = (source) =>
    execFileSync(process.env.STRENGTH_PYTHON ?? "python", ["-c", source], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    }),
): Runtime {
  const numpy =
    config.policies.includes("fanfou-ba-composite-v1") ||
    config.lineups.some((name) =>
      resolveLineup(name).includes("fanfou-ba-composite-v1"),
    );
  const source = [
    "import json, platform",
    ...(numpy ? ["import numpy"] : []),
    `print(json.dumps({'python': platform.python_version()${numpy ? ", 'numpy': numpy.__version__" : ""}}))`,
  ].join("\n");
  const versions = JSON.parse(queryPython(source)) as {
    python?: unknown;
    numpy?: unknown;
  };
  if (typeof versions?.python !== "string" || !versions.python.trim())
    throw new Error("缺少有效Python运行时版本");
  if (numpy && (typeof versions.numpy !== "string" || !versions.numpy.trim()))
    throw new Error("BA参考需要有效NumPy运行时版本");
  return {
    node: process.version,
    python: versions.python.trim(),
    ...(numpy ? { numpy: (versions.numpy as string).trim() } : {}),
  };
}

function lockOutput(output: string): () => void {
  mkdirSync(output, { recursive: true });
  const path = join(output, "run.lock");
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, "utf8")) as { pid?: number };
    if (!Number.isSafeInteger(saved.pid) || saved.pid! <= 0)
      throw new Error("评测锁损坏");
    try {
      process.kill(saved.pid!, 0);
      throw new Error("评测输出正被存活进程占用");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    rmSync(path);
  }
  const handle = openSync(path, "wx");
  try {
    writeFileSync(handle, JSON.stringify({ pid: process.pid }));
  } finally {
    closeSync(handle);
  }
  return () => rmSync(path);
}

export async function playRegisteredGame(
  spec: GameSpec,
  config: IndependentConfig,
  observers: Observers,
): Promise<IndependentGameResult> {
  const lineup = resolveLineup(spec.lineup);
  const sessions = [0, 1, 2, 3].map((actor) =>
    createPolicySession(actor === spec.seat ? spec.policy : lineup[actor], {
      timeoutMs: config.timeoutMs,
      onEvaluation: (report) => {
        if (report.status !== "not-applicable")
          observers.onEvaluation({ actor, report });
      },
      onLiabilityEvaluation: (report) =>
        observers.onLiabilityEvaluation({ actor, report }),
    }),
  );
  const policies = Object.fromEntries(
    sessions.map((session, actor) => [
      actor,
      (async (view, phase) => {
        observers.onAttempt({ actor, phase, view: structuredClone(view) });
        return session.choose(view, phase);
      }) satisfies Policy,
    ]),
  );
  try {
    const result = await playIndependentGame(
      spec.seed,
      spec.seat,
      policies[spec.seat],
      policies,
      {
        openingPolicy:
          spec.opening === "common"
            ? (view, phase) => {
                observers.onAttempt({
                  actor: view.seat,
                  phase,
                  view: structuredClone(view),
                });
                return chooseTeacherAction(view, phase);
              }
            : undefined,
        onDecision: observers.onDecision,
      },
    );
    // Drain every child normally before a seed is eligible to be committed.
    // The finally block below is only abort cleanup on errors.
    await Promise.all(
      sessions.map((session, actor) =>
        session.finish().catch((error) => {
          throw new Error(
            `${actor}号外部会话收尾失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      ),
    );
    return result;
  } finally {
    await Promise.allSettled(sessions.map((session) => session.close()));
  }
}

export async function runIndependentBenchmark(
  raw: unknown,
  outputDirectory: string,
  options: RunOptions = {},
) {
  const config = parseIndependentConfig(raw);
  const output = resolve(outputDirectory);
  const fingerprint = options.fingerprint ?? independentSourceFingerprint;
  const frozen = fingerprint();
  const manifest = {
    kind: "manifest",
    version: 2,
    config,
    rules: DEFAULT_RULES,
    fingerprint: frozen,
    runtime: options.runtime ?? independentRuntime(config),
    protocol: "public-view-v2/independent-jsonl-v2",
    opening: {
      common: "teacher-v1 exchange and missing for all seats",
      composite:
        "each policy; both ebony references share teacher-v1 exchange only",
    },
    pairing:
      "same initial seed, then trajectories and draw recipients may diverge; seed-cluster statistics",
  };
  const unlock = lockOutput(output);
  try {
    const path = join(output, "games.jsonl");
    let records: IndependentRecord[] = [];
    const completed = new Set<number>();
    if (!existsSync(path))
      writeFileSync(path, JSON.stringify(manifest) + "\n", { flag: "wx" });
    else {
      const content = readFileSync(path, "utf8");
      if (!content.endsWith("\n"))
        throw new Error("评测记录截断，保留原文件并检查");
      const lines = content.trimEnd().split("\n");
      if (
        JSON.stringify(JSON.parse(lines.shift()!)) !== JSON.stringify(manifest)
      )
        throw new Error("配置、规则、源码或运行时不匹配，拒绝续跑");
      for (const line of lines) {
        const saved = JSON.parse(line) as {
          kind: string;
          seed: number;
          records: IndependentRecord[];
        };
        if (
          saved.kind !== "seed" ||
          !config.seeds.includes(saved.seed) ||
          completed.has(saved.seed) ||
          !Array.isArray(saved.records)
        )
          throw new Error("种子记录无效或重复");
        summarizeIndependentEvaluation(
          saved.records,
          { ...config, seeds: [saved.seed] },
          config.comparisons,
        );
        completed.add(saved.seed);
        records.push(...saved.records);
      }
    }
    const assertUnchanged = () => {
      if (JSON.stringify(fingerprint()) !== JSON.stringify(frozen))
        throw new Error("评测中源码发生变化，该种子不写入有效结果");
    };
    const writeSummary = () => {
      const seeds = config.seeds.filter((seed) => completed.has(seed));
      const saved = {
        version: 2,
        mode: config.mode,
        complete: seeds.length === config.seeds.length,
        completedSeeds: seeds.length,
        totalSeeds: config.seeds.length,
        manifest,
        summary: seeds.length
          ? summarizeIndependentEvaluation(
              records,
              { ...config, seeds },
              config.comparisons,
            )
          : null,
      };
      const temporary = join(output, `summary-${process.pid}.tmp`);
      writeFileSync(temporary, JSON.stringify(saved, null, 2) + "\n");
      renameSync(temporary, join(output, "summary.json"));
      return saved;
    };
    for (const seed of config.seeds) {
      if (completed.has(seed)) continue;
      assertUnchanged();
      const seedRecords: IndependentRecord[] = [];
      for (const seat of config.seats)
        for (const lineup of config.lineups)
          for (const opening of config.openings)
            for (const policy of config.policies) {
              const spec = { seed, seat, lineup, opening, policy };
              const decisions: IndependentDecisionTrace[] = [];
              const evaluations: {
                actor: number;
                decisionIndex: number;
                report: RolloutDecision | LiabilityDiscardDecision;
              }[] = [];
              let pending: Attempt | undefined;
              const observers: Observers = {
                onDecision: (trace) => {
                  decisions.push(structuredClone(trace));
                },
                onAttempt: (attempt) => {
                  pending = structuredClone(attempt);
                },
                onEvaluation: (event) => {
                  evaluations.push({
                    ...structuredClone(event),
                    decisionIndex: decisions.length,
                  });
                },
                onLiabilityEvaluation: (event) => {
                  evaluations.push({
                    ...structuredClone(event),
                    decisionIndex: decisions.length,
                  });
                },
              };
              try {
                const result = await (
                  options.play ??
                  ((request, events) =>
                    playRegisteredGame(request, config, events))
                )(spec, observers);
                appendFileSync(
                  join(output, "traces.jsonl"),
                  JSON.stringify({
                    kind: "game",
                    ...spec,
                    decisions,
                    evaluations,
                  }) + "\n",
                );
                seedRecords.push({ ...spec, result });
              } catch (error) {
                appendFileSync(
                  join(output, "traces.jsonl"),
                  JSON.stringify({
                    kind: "failure",
                    ...spec,
                    pending,
                    decisions,
                    evaluations,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }) + "\n",
                );
                throw error;
              }
            }
      summarizeIndependentEvaluation(
        seedRecords,
        { ...config, seeds: [seed] },
        config.comparisons,
      );
      assertUnchanged();
      appendFileSync(
        path,
        JSON.stringify({ kind: "seed", seed, records: seedRecords }) + "\n",
      );
      records = records.concat(seedRecords);
      completed.add(seed);
      writeSummary();
      options.progress?.(
        `完成开发种子 ${seed}；${completed.size}/${config.seeds.length}`,
      );
    }
    assertUnchanged();
    return writeSummary();
  } finally {
    unlock();
  }
}
