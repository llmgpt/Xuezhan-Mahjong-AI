import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { DEFAULT_RULES } from "../src/game/game";
import { auditFormalSeedAttempt } from "./formalAudit";
import {
  createFormalJournal,
  inspectFormalJournal,
  type FormalJournalEvent,
} from "./formalJournal";
import {
  independentRuntime,
  independentSourceFingerprint,
  parseIndependentConfig,
  playRegisteredGame,
  runIndependentBenchmark,
  type IndependentConfig,
} from "./independentBenchmark";
import type { IndependentRecord } from "./independentEvaluation";
import type { IndependentDecisionTrace } from "./independentRunner";
import type { RolloutDecision } from "../src/game/rolloutTeacher";

interface JournaledSeedRequest {
  config: IndependentConfig;
  seed: number;
  planHash: string;
  directory: string;
  priorJournals: readonly string[];
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const bytesHash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function exact(actual: unknown, expected: unknown, message: string) {
  if (canonical(actual) !== canonical(expected)) throw new Error(message);
}
async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
async function* jsonLines(path: string) {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
  }
}
function context(request: JournaledSeedRequest) {
  const config = parseIndependentConfig(request.config);
  if (
    !config.seeds.includes(request.seed) ||
    !/^[a-f0-9]{64}$/.test(request.planHash)
  )
    throw new Error("单seed执行身份不符");
  const expectedGames =
    config.seats.length *
    config.lineups.length *
    config.openings.length *
    config.policies.length;
  const identity = {
    planHash: request.planHash,
    seed: request.seed,
    expectedGames,
  };
  const metadata = {
    version: 1,
    planHash: request.planHash,
    seed: request.seed,
    configSha256: digest(config),
    sourceFingerprint: independentSourceFingerprint(),
    runtime: independentRuntime(config),
    rules: DEFAULT_RULES,
  };
  return { config, identity, metadata, directory: resolve(request.directory) };
}
const key = (row: Omit<IndependentRecord, "result">) =>
  JSON.stringify([row.seed, row.seat, row.lineup, row.opening, row.policy]);

/** Audits only saved records. No policy is asked for a replacement decision. */
async function auditEvidence(request: JournaledSeedRequest) {
  const { config, identity, metadata, directory } = context(request);
  const metadataPath = join(directory, "attempt.json");
  const metadataSha256 = bytesHash(metadataPath);
  exact(
    JSON.parse(readFileSync(metadataPath, "utf8")),
    metadata,
    "attempt身份/元数据/源码或运行时不符",
  );
  const audit = await auditFormalSeedAttempt({
    config,
    seed: request.seed,
    directory,
    sourceFingerprint: metadata.sourceFingerprint,
    runtime: metadata.runtime,
    rules: DEFAULT_RULES,
  });
  const journal = await inspectFormalJournal(
    join(directory, "journal.jsonl"),
    identity,
  );
  if (
    journal.terminal === "failure" ||
    journal.completedGames !== identity.expectedGames
  )
    throw new Error("日志存在明示失败或游戏网格不完整");
  const results = new Map(audit.records.map((row) => [key(row), row.result]));
  let index = 0;
  const event = (value: FormalJournalEvent) => {
    if (journal.eventHashes[index++] !== digest(value))
      throw new Error("原始trace与持久化询问/决定前缀不符");
  };
  const tracesPath = join(directory, "traces.jsonl");
  for await (const raw of jsonLines(tracesPath)) {
    const trace = raw as Omit<IndependentRecord, "result"> & {
      decisions: IndependentDecisionTrace[];
      evaluations: {
        actor: number;
        decisionIndex: number;
        report: RolloutDecision;
      }[];
    };
    const spec = {
      seed: trace.seed,
      seat: trace.seat,
      lineup: trace.lineup,
      opening: trace.opening,
      policy: trace.policy,
    };
    event({ kind: "game-start", spec });
    let evaluationIndex = 0;
    for (let i = 0; i < trace.decisions.length; i++) {
      const decision = trace.decisions[i];
      event({
        kind: "attempt",
        actor: decision.actor,
        phase: decision.phase,
        view: decision.view,
      });
      while (
        evaluationIndex < trace.evaluations.length &&
        trace.evaluations[evaluationIndex].decisionIndex === i
      ) {
        const evaluation = trace.evaluations[evaluationIndex++];
        event({
          kind: "evaluation",
          actor: evaluation.actor,
          report: evaluation.report,
        });
      }
      event({ kind: "decision", trace: decision });
    }
    if (evaluationIndex !== trace.evaluations.length)
      throw new Error("估值事件顺序不符");
    const result = results.get(key(spec));
    if (!result) throw new Error("原始trace没有对应成绩");
    event({ kind: "game-complete", result });
  }
  if (
    journal.terminal === "complete" &&
    journal.eventHashes[index++] !== digest({ kind: "seed-complete" })
  )
    throw new Error("日志完成事件不符");
  if (index !== journal.eventHashes.length)
    throw new Error("日志含额外或缺失事件");
  exact(
    independentSourceFingerprint(),
    metadata.sourceFingerprint,
    "审计中执行源码发生变化",
  );
  exact(
    independentRuntime(config),
    metadata.runtime,
    "审计中运行时版本发生变化",
  );
  const after = await Promise.all([
    fileHash(tracesPath),
    fileHash(join(directory, "games.jsonl")),
    fileHash(join(directory, "journal.jsonl")),
  ]);
  if (
    canonical(after) !==
      canonical([audit.tracesSha256, audit.gamesSha256, journal.sha256]) ||
    bytesHash(metadataPath) !== metadataSha256
  )
    throw new Error("核对前缀时原始证据发生变化");
  return {
    version: 1 as const,
    planHash: request.planHash,
    seed: request.seed,
    configSha256: metadata.configSha256,
    metadataSha256,
    gamesSha256: audit.gamesSha256,
    tracesSha256: audit.tracesSha256,
    journalSha256: journal.sha256,
    journalTerminal:
      journal.terminal === "complete"
        ? ("complete" as const)
        : ("game-grid-complete-no-marker" as const),
    gameCount: audit.gameCount,
    decisionCount: audit.decisionCount,
    replayedStates: audit.replayedStates,
  };
}
type Evidence = Awaited<ReturnType<typeof auditEvidence>>;
function checkedReceipt(path: string, evidence: Evidence) {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Evidence & {
    committedAtUtc: string;
  };
  const { committedAtUtc, ...core } = raw;
  if (
    typeof committedAtUtc !== "string" ||
    !committedAtUtc.endsWith("Z") ||
    !Number.isFinite(Date.parse(committedAtUtc))
  )
    throw new Error("收据时间无效");
  exact(core, evidence, "收据与审计后的原始证据不符");
  return raw;
}
function commitReceipt(directory: string, evidence: Evidence) {
  const path = join(directory, "receipt.json");
  if (existsSync(path)) return checkedReceipt(path, evidence);
  const receipt = { ...evidence, committedAtUtc: new Date().toISOString() };
  const temporary = join(directory, `receipt-${randomUUID()}.tmp`);
  const handle = openSync(temporary, "wx");
  try {
    writeFileSync(handle, JSON.stringify(receipt, null, 2) + "\n");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  try {
    try {
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return checkedReceipt(path, evidence);
  } finally {
    unlinkSync(temporary);
  }
}

/** Low-level seed transaction. A sealed formal controller must bind the plan and runtime. */
export async function executeJournaledSeed(request: JournaledSeedRequest) {
  const { config, identity, metadata, directory } = context(request);
  mkdirSync(directory); // Never reuse an attempt directory or overwrite old evidence.
  const handle = openSync(join(directory, "attempt.json"), "wx");
  try {
    writeFileSync(handle, JSON.stringify(metadata, null, 2) + "\n");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  const journal = await createFormalJournal(
    join(directory, "journal.jsonl"),
    identity,
    request.priorJournals,
  );
  try {
    await runIndependentBenchmark(
      { ...config, seeds: [request.seed] },
      directory,
      {
        runtime: metadata.runtime,
        play: async (spec, observers) => {
          journal.record({ kind: "game-start", spec });
          const result = await playRegisteredGame(spec, config, {
            onAttempt: (attempt) => {
              journal.record({ kind: "attempt", ...attempt });
              observers.onAttempt(attempt);
            },
            onDecision: (trace) => {
              journal.record({ kind: "decision", trace });
              observers.onDecision(trace);
            },
            onEvaluation: (evaluation) => {
              journal.record({ kind: "evaluation", ...evaluation });
              observers.onEvaluation(evaluation);
            },
          });
          journal.record({ kind: "game-complete", result });
          return result;
        },
      },
    );
    journal.assertPrefixReproduced();
    const evidence = await auditEvidence(request);
    journal.complete();
    journal.close();
    const finalJournal = await inspectFormalJournal(
      join(directory, "journal.jsonl"),
      identity,
    );
    return commitReceipt(directory, {
      ...evidence,
      journalSha256: finalJournal.sha256,
      journalTerminal: "complete",
    });
  } catch (error) {
    try {
      journal.fail(error instanceof Error ? error.message : String(error));
    } catch {
      /* Preserve the original error if the journal cannot be written. */
    }
    throw error;
  } finally {
    journal.close();
  }
}

/** Adopts a fully committed inner grid after replay; preserves all original raw logs. */
export async function adoptJournaledSeed(request: JournaledSeedRequest) {
  return commitReceipt(
    resolve(request.directory),
    await auditEvidence(request),
  );
}
