import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDecisionAction } from "../src/game/decision";
import {
  createGame,
  countTiles,
  draw,
  DEFAULT_RULES,
  type GameState,
} from "../src/game/game";
import { playerView } from "../src/game/view";
import {
  ALL_POLICIES,
  DEFAULT_POLICIES,
  OPPONENT_POLICIES,
  chooseAdviceAction,
  chooseOpponentAction,
  choosePolicyAction,
  type BenchmarkPolicy,
  type OpponentPolicy,
  type TeacherPolicies,
} from "./benchmarkPolicies";
import {
  pairedSummary,
  seatClusterSummary,
  type PairedSummary,
} from "./evaluationStats";

export interface BenchmarkConfig {
  count: number;
  startSeed: number;
  seats: number[];
  policies: BenchmarkPolicy[];
  opponents: OpponentPolicy[];
  output?: string;
}
export interface GameResult {
  score: number;
  won: number;
  wall: number;
  dealIn: number;
  changedDiscards: number;
  changedExchanges: number;
}
interface SeatRun {
  opponent: OpponentPolicy;
  seat: number;
  outcomes: Record<string, GameResult>;
}
interface SeedRecord {
  kind: "seed";
  seed: number;
  runs: SeatRun[];
}
export interface Manifest {
  kind: "manifest";
  version: 1;
  config: Omit<BenchmarkConfig, "output">;
  rules: typeof DEFAULT_RULES;
  fingerprint: Record<string, string>;
}
interface PolicySummary {
  meanScore: number;
  winRate: number;
  wallRate: number;
  dealInRate: number;
  changedDiscards: number;
  changedExchanges: number;
}
interface Comparison extends PairedSummary {
  seedCount: number;
  confidenceInterval95NormalApprox: [number, number] | null;
}
interface TeacherComparison extends Comparison {
  direction: `teacher-candidate-minus-${BenchmarkPolicy}`;
}
interface OpponentSummary {
  byPolicy: Record<string, PolicySummary>;
  comparisons: Record<string, Comparison>;
  bySeat: Record<
    number,
    {
      byPolicy: Record<string, PolicySummary>;
      comparisons: Record<string, Comparison>;
    }
  >;
  lookaheadVsEfficiency?: Comparison;
  teacherComparisons?: Record<string, TeacherComparison>;
}
export interface BenchmarkSummary {
  benchmarkVersion: 1;
  rules: typeof DEFAULT_RULES;
  sourceFingerprint: Record<string, string>;
  count: number;
  completedSeeds: number;
  startSeed: number;
  seats: number[];
  policies: BenchmarkPolicy[];
  opponents: OpponentPolicy[];
  comparisonDirection: "advice-minus-candidate";
  uncertainty: string;
  byOpponent: Record<string, OpponentSummary>;
  overall: {
    byPolicy: Record<string, PolicySummary>;
    comparisons: Record<string, Comparison>;
    teacherComparisons?: Record<string, TeacherComparison>;
  };
}
export interface CombinedBenchmarkSummary extends BenchmarkSummary {
  sourceFiles: { name: string; sha256: string; manifest: Manifest }[];
}
interface RunOptions extends TeacherPolicies {
  play?: typeof playBenchmarkGame;
  progress?: (message: string) => void;
  fingerprint?: Record<string, string>;
  detailedProgress?: boolean;
}

function list(raw: string, name: string): string[] {
  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !value) || new Set(values).size !== values.length)
    throw new Error(`${name} 必须为非空、不重复的列表`);
  return values;
}

export function parseBenchmarkConfig(
  env: Record<string, string | undefined>,
): BenchmarkConfig {
  const count = Number(env.EVAL_COUNT ?? 100);
  const startSeed = Number(env.EVAL_START ?? 10000);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(startSeed) ||
    !Number.isSafeInteger(startSeed + count - 1)
  )
    throw new Error(
      "EVAL_COUNT 必须为正整数；EVAL_START 和最后种子必须为安全整数",
    );
  const seats = list(env.EVAL_SEATS ?? "0", "EVAL_SEATS").map(Number);
  if (
    seats.some((seat) => !Number.isInteger(seat) || seat < 0 || seat > 3) ||
    new Set(seats).size !== seats.length
  )
    throw new Error("EVAL_SEATS 必须是不重复的 0～3");
  const policies = list(
    env.EVAL_POLICIES ?? DEFAULT_POLICIES.join(","),
    "EVAL_POLICIES",
  ) as BenchmarkPolicy[];
  if (
    !policies.includes("advice") ||
    policies.some((policy) => !ALL_POLICIES.includes(policy))
  )
    throw new Error("EVAL_POLICIES 必须包含 advice；实验策略须显式启用");
  const opponents = list(
    env.EVAL_OPPONENTS ?? OPPONENT_POLICIES.join(","),
    "EVAL_OPPONENTS",
  ) as OpponentPolicy[];
  if (opponents.some((opponent) => !OPPONENT_POLICIES.includes(opponent)))
    throw new Error("EVAL_OPPONENTS 只支持 greedy、patient");
  if (env.EVAL_OUTPUT !== undefined && !env.EVAL_OUTPUT.trim())
    throw new Error("EVAL_OUTPUT 不能为空");
  return {
    count,
    startSeed,
    seats,
    policies,
    opponents,
    ...(env.EVAL_OUTPUT !== undefined && { output: resolve(env.EVAL_OUTPUT) }),
  };
}

// 外层拥有完整状态以执行规则；每个策略调用只接收 playerView 的公开投影。
export function playBenchmarkGame(
  seed: number,
  seat: number,
  policy: BenchmarkPolicy,
  opponent: OpponentPolicy,
  teachers: TeacherPolicies = {},
): GameResult {
  let state = createGame(seed);
  let randomState = (seed ^ 0x9e3779b9) >>> 0;
  let changedDiscards = 0;
  let changedExchanges = 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  };
  const setupOrder = [seat, ...[0, 1, 2, 3].filter((other) => other !== seat)];
  for (let step = 0; state.phase !== "ended" && step < 3000; step += 1) {
    if (state.phase === "draw") {
      state = draw(state, state.turn);
      continue;
    }
    let actor: number | undefined;
    if (state.phase === "exchange")
      actor = setupOrder.find((other) => !state.players[other].exchange);
    else if (state.phase === "choose-missing")
      actor = setupOrder.find((other) => !state.players[other].missing);
    else if (state.phase === "respond") {
      // 和旧 advanceToHuman 一致：先处理电脑答复，最后处理受评估座位。
      actor =
        state.pending!.eligible.find(
          (other) => other !== seat && !state.pending!.answers[other],
        ) ??
        state.pending!.eligible.find((other) => !state.pending!.answers[other]);
    } else actor = state.turn;
    if (actor === undefined)
      throw new Error(
        `没有待操作座位：${seed}/${seat}/${policy}/${opponent}/${state.phase}`,
      );
    const view = playerView(state, actor);
    const action =
      actor === seat
        ? choosePolicyAction(view, state.phase, policy, random, teachers)
        : chooseOpponentAction(view, state.phase, opponent);
    if (!action)
      throw new Error(
        `策略没有合法选择：${seed}/${seat}/${policy}/${opponent}/${state.phase}`,
      );
    if (actor === seat) {
      const original = chooseAdviceAction(view, state.phase);
      if (
        action.type === "discard" &&
        original?.type === "discard" &&
        action.tile !== original.tile
      )
        changedDiscards += 1;
      if (action.type === "exchange" && original?.type === "exchange") {
        const before = [...original.tiles].sort((a, b) => a - b);
        if (
          [...action.tiles]
            .sort((a, b) => a - b)
            .some((tile, index) => tile !== before[index])
        )
          changedExchanges += 1;
      }
    }
    state = applyDecisionAction(state, actor, action);
  }
  if (state.phase !== "ended")
    throw new Error(`未结束：${seed}/${seat}/${policy}/${opponent}`);
  if (countTiles(state) !== 108)
    throw new Error(`终局牌数不守恒：${seed}/${seat}/${policy}/${opponent}`);
  if (state.players.reduce((sum, player) => sum + player.score, 0) !== 0)
    throw new Error("引擎结算净分不守恒");
  return resultFor(state, seat, changedDiscards, changedExchanges);
}

function resultFor(
  state: GameState,
  seat: number,
  changedDiscards: number,
  changedExchanges: number,
): GameResult {
  return {
    score: state.players[seat].score,
    won: Number(state.wins.some((win) => win.winner === seat)),
    wall: Number(state.endReason === "wall"),
    dealIn: Number(state.wins.some((win) => win.payer === seat)),
    changedDiscards,
    changedExchanges,
  };
}

function sourceFingerprint(): Record<string, string> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const gameFiles = readdirSync(join(root, "src/game"))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => `src/game/${file}`);
  const files = [
    ...gameFiles,
    "docs/RULES_V1.md",
    "package-lock.json",
    "scripts/benchmarkPolicies.ts",
    "scripts/benchmarkRunner.ts",
    "scripts/evaluationStats.ts",
    "scripts/evaluate-advice.ts",
    "scripts/analyze-benchmark.ts",
  ].sort();
  return Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(join(root, file)))
        .digest("hex"),
    ]),
  );
}

function manifestFor(
  config: BenchmarkConfig,
  fingerprint: Record<string, string>,
): Manifest {
  const { count, startSeed, seats, policies, opponents } = config;
  const savedConfig = { count, startSeed, seats, policies, opponents };
  return {
    kind: "manifest",
    version: 1,
    config: savedConfig,
    rules: DEFAULT_RULES,
    fingerprint,
  };
}

function validateRecord(value: unknown, config: BenchmarkConfig): SeedRecord {
  const record = value as SeedRecord;
  if (
    !record ||
    record.kind !== "seed" ||
    !Number.isSafeInteger(record.seed) ||
    record.seed < config.startSeed ||
    record.seed >= config.startSeed + config.count ||
    !Array.isArray(record.runs) ||
    record.runs.length !== config.seats.length * config.opponents.length
  )
    throw new Error("无效 benchmark 种子记录");
  const seen = new Set<string>();
  for (const run of record.runs) {
    const key = `${run.opponent}/${run.seat}`;
    if (
      !config.opponents.includes(run.opponent) ||
      !config.seats.includes(run.seat) ||
      seen.has(key) ||
      !run.outcomes ||
      typeof run.outcomes !== "object" ||
      Object.keys(run.outcomes).sort().join(",") !==
        [...config.policies].sort().join(",")
    )
      throw new Error("种子记录缺少配对座位、对手或策略结果");
    seen.add(key);
    for (const outcome of Object.values(run.outcomes)) {
      if (
        !outcome ||
        !Number.isFinite(outcome.score) ||
        ![outcome.won, outcome.wall, outcome.dealIn].every(
          (value) => value === 0 || value === 1,
        ) ||
        ![outcome.changedDiscards, outcome.changedExchanges].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        )
      )
        throw new Error("种子记录包含无效结果");
    }
  }
  return record;
}

function loadRecords(
  output: string,
  manifest: Manifest,
  progress: (message: string) => void,
): SeedRecord[] {
  if (!existsSync(output)) {
    writeFileSync(output, JSON.stringify(manifest) + "\n", { flag: "wx" });
    return [];
  }
  const content = readFileSync(output, "utf8");
  const lastNewline = content.lastIndexOf("\n");
  if (lastNewline < 0)
    throw new Error("benchmark manifest 缺失或截断；请使用新输出文件");
  const lines = content.slice(0, lastNewline).split("\n");
  let savedManifest: Manifest;
  try {
    savedManifest = JSON.parse(lines.shift()!);
  } catch {
    throw new Error("benchmark manifest 损坏");
  }
  if (JSON.stringify(savedManifest) !== JSON.stringify(manifest))
    throw new Error("benchmark 配置、规则或源码指纹不匹配；请使用新输出文件");
  const seeds = new Set<number>();
  const records = lines.map((line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("完整行中的 benchmark 记录损坏，拒绝续跑");
    }
    const record = validateRecord(parsed, manifest.config);
    if (seeds.has(record.seed)) throw new Error("benchmark 种子记录重复");
    seeds.add(record.seed);
    return record;
  });
  if (!content.endsWith("\n")) {
    writeFileSync(output, content.slice(0, lastNewline + 1));
    progress("恢复：已丢弃末尾没有换行的截断记录，该种子将重跑。");
  }
  return records;
}

function acquireOutputLock(output: string): () => void {
  mkdirSync(dirname(output), { recursive: true });
  const lock = `${output}.lock`;
  if (existsSync(lock)) {
    let pid: number;
    try {
      pid = JSON.parse(readFileSync(lock, "utf8")).pid;
    } catch {
      throw new Error(`输出锁损坏，请检查 ${lock}`);
    }
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error(`输出锁损坏，请检查 ${lock}`);
    try {
      process.kill(pid, 0);
      throw new Error("benchmark 输出文件正在被另一个进程使用");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      rmSync(lock);
    }
  }
  const descriptor = openSync(lock, "wx");
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
  closeSync(descriptor);
  return () => rmSync(lock);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function comparison(summary: PairedSummary, seedCount: number): Comparison {
  return {
    ...summary,
    seedCount,
    confidenceInterval95NormalApprox:
      summary.standardError === null
        ? null
        : [
            summary.meanScoreDifference - 1.96 * summary.standardError,
            summary.meanScoreDifference + 1.96 * summary.standardError,
          ],
  };
}
function policySummary(
  runs: readonly SeatRun[],
  policies: readonly BenchmarkPolicy[],
): Record<string, PolicySummary> {
  return Object.fromEntries(
    policies.map((policy) => {
      const samples = runs.map((run) => run.outcomes[policy]);
      return [
        policy,
        {
          meanScore: mean(samples.map((sample) => sample.score)),
          winRate: mean(samples.map((sample) => sample.won)),
          wallRate: mean(samples.map((sample) => sample.wall)),
          dealInRate: mean(samples.map((sample) => sample.dealIn)),
          changedDiscards: samples.reduce(
            (sum, sample) => sum + sample.changedDiscards,
            0,
          ),
          changedExchanges: samples.reduce(
            (sum, sample) => sum + sample.changedExchanges,
            0,
          ),
        },
      ];
    }),
  );
}
function difference(
  run: SeatRun,
  left: BenchmarkPolicy,
  right: BenchmarkPolicy,
): number {
  return run.outcomes[left].score - run.outcomes[right].score;
}

function summarize(
  records: SeedRecord[],
  config: BenchmarkConfig,
  fingerprint: Record<string, string>,
): BenchmarkSummary {
  const candidates = config.policies.filter((policy) => policy !== "advice");
  const comparisonsFor = (rows: SeatRun[][]) =>
    Object.fromEntries(
      candidates.map((candidate) => [
        candidate,
        comparison(
          seatClusterSummary(
            rows.map((runs) =>
              runs.map((run) => difference(run, "advice", candidate)),
            ),
          ),
          records.length,
        ),
      ]),
    );
  const teacherComparisonsFor = (
    rows: SeatRun[][],
  ): Record<string, TeacherComparison> | undefined => {
    if (!config.policies.includes("teacher-candidate")) return undefined;
    const baselines = (
      ["advice", "efficiency", "teacher-legacy-discard"] as const
    ).filter((baseline) => config.policies.includes(baseline));
    return Object.fromEntries(
      baselines.map((baseline) => [
        baseline,
        {
          ...comparison(
            seatClusterSummary(
              rows.map((runs) =>
                runs.map((run) =>
                  difference(run, "teacher-candidate", baseline),
                ),
              ),
            ),
            records.length,
          ),
          direction: `teacher-candidate-minus-${baseline}` as const,
        },
      ]),
    );
  };
  const byOpponent = Object.fromEntries(
    config.opponents.map((opponent) => {
      const rows = records.map((record) =>
        record.runs.filter((run) => run.opponent === opponent),
      );
      const bySeat = Object.fromEntries(
        config.seats.map((seat) => {
          const runs = rows.map((row) => row.find((run) => run.seat === seat)!);
          return [
            seat,
            {
              byPolicy: policySummary(runs, config.policies),
              comparisons: Object.fromEntries(
                candidates.map((candidate) => [
                  candidate,
                  comparison(
                    pairedSummary(
                      runs.map((run) => difference(run, "advice", candidate)),
                    ),
                    records.length,
                  ),
                ]),
              ),
            },
          ];
        }),
      );
      const lookaheadVsEfficiency =
        config.policies.includes("lookahead") &&
        config.policies.includes("efficiency")
          ? comparison(
              seatClusterSummary(
                rows.map((runs) =>
                  runs.map((run) => difference(run, "lookahead", "efficiency")),
                ),
              ),
              records.length,
            )
          : undefined;
      const teacherComparisons = teacherComparisonsFor(rows);
      return [
        opponent,
        {
          byPolicy: policySummary(rows.flat(), config.policies),
          comparisons: comparisonsFor(rows),
          bySeat,
          ...(lookaheadVsEfficiency && { lookaheadVsEfficiency }),
          ...(teacherComparisons && { teacherComparisons }),
        },
      ];
    }),
  );
  const teacherComparisons = teacherComparisonsFor(
    records.map((record) => record.runs),
  );
  return {
    benchmarkVersion: 1,
    rules: DEFAULT_RULES,
    sourceFingerprint: fingerprint,
    count: config.count,
    completedSeeds: records.length,
    startSeed: config.startSeed,
    seats: config.seats,
    policies: config.policies,
    opponents: config.opponents,
    comparisonDirection: "advice-minus-candidate",
    uncertainty:
      "同种子内座位与对手等权平均，再按种子估计标准误；95%区间为正态近似，小样本仅作调试，不能据此验收。",
    byOpponent,
    overall: {
      byPolicy: policySummary(
        records.flatMap((record) => record.runs),
        config.policies,
      ),
      comparisons: comparisonsFor(records.map((record) => record.runs)),
      ...(teacherComparisons && { teacherComparisons }),
    },
  };
}

export function runBenchmark(
  config: BenchmarkConfig,
  options: RunOptions = {},
): BenchmarkSummary {
  if (
    (config.policies.includes("teacher-candidate") &&
      !options.teacherCandidate) ||
    (config.policies.includes("teacher-legacy-discard") &&
      !options.teacherLegacyDiscard)
  )
    throw new Error("teacher 实验策略必须显式注入对应回调");
  const progress =
    options.progress ??
    ((message: string) => process.stderr.write(`${message}\n`));
  const play = options.play ?? playBenchmarkGame;
  const manifest = manifestFor(
    config,
    options.fingerprint ?? sourceFingerprint(),
  );
  const release = config.output ? acquireOutputLock(config.output) : () => {};
  try {
    const records = config.output
      ? loadRecords(config.output, manifest, progress)
      : [];
    const completed = new Set(records.map((record) => record.seed));
    progress(
      `benchmark：已保存 ${records.length}/${config.count} 个种子，每种子 ${config.seats.length * config.opponents.length * config.policies.length} 局。`,
    );
    for (let index = 0; index < config.count; index += 1) {
      const seed = config.startSeed + index;
      if (completed.has(seed)) continue;
      progress(`seed ${seed} 开始。`);
      const record: SeedRecord = {
        kind: "seed",
        seed,
        runs: config.opponents.flatMap((opponent) =>
          config.seats.map((seat) => {
            const outcomes = Object.fromEntries(
              config.policies.map((policy) => {
                const outcome = play(seed, seat, policy, opponent, options);
                if (options.detailedProgress)
                  progress(
                    `seed ${seed} / ${opponent} / seat ${seat} / ${policy} 完成。`,
                  );
                return [policy, outcome];
              }),
            );
            return { opponent, seat, outcomes };
          }),
        ),
      };
      validateRecord(record, config);
      if (config.output)
        appendFileSync(config.output, JSON.stringify(record) + "\n");
      records.push(record);
      progress(`seed ${seed} 完成；${records.length}/${config.count}`);
    }
    return summarize(
      records.sort((a, b) => a.seed - b.seed),
      config,
      manifest.fingerprint,
    );
  } finally {
    release();
  }
}

function validateSavedManifest(value: unknown): Manifest {
  const manifest = value as Manifest;
  if (
    !manifest ||
    manifest.kind !== "manifest" ||
    manifest.version !== 1 ||
    !manifest.config ||
    !manifest.rules ||
    !manifest.fingerprint ||
    typeof manifest.config !== "object" ||
    Array.isArray(manifest.config) ||
    typeof manifest.rules !== "object" ||
    Array.isArray(manifest.rules) ||
    typeof manifest.fingerprint !== "object" ||
    Array.isArray(manifest.fingerprint) ||
    !Array.isArray(manifest.config.seats) ||
    !Array.isArray(manifest.config.policies) ||
    !Array.isArray(manifest.config.opponents) ||
    Object.keys(manifest.config).sort().join(",") !==
      "count,opponents,policies,seats,startSeed" ||
    !Number.isSafeInteger(manifest.config.count) ||
    !Number.isSafeInteger(manifest.config.startSeed) ||
    manifest.config.seats.some((seat) => typeof seat !== "number") ||
    manifest.config.policies.some((policy) => typeof policy !== "string") ||
    manifest.config.opponents.some(
      (opponent) => typeof opponent !== "string",
    ) ||
    !["clockwise", "counterclockwise", "opposite"].includes(
      manifest.rules.exchangeDirection,
    ) ||
    ![
      manifest.rules.fanCap,
      manifest.rules.selfDrawBonus,
      manifest.rules.flowerPenalty,
    ].every((number) => Number.isSafeInteger(number) && number >= 0) ||
    typeof manifest.rules.checkTenpai !== "boolean" ||
    Object.keys(manifest.fingerprint).length === 0 ||
    Object.values(manifest.fingerprint).some(
      (hash) => typeof hash !== "string" || !hash,
    )
  )
    throw new Error("源文件 benchmark manifest 无效或损坏");
  const config = parseBenchmarkConfig({
    EVAL_COUNT: String(manifest.config.count),
    EVAL_START: String(manifest.config.startSeed),
    EVAL_SEATS: manifest.config.seats.join(","),
    EVAL_POLICIES: manifest.config.policies.join(","),
    EVAL_OPPONENTS: manifest.config.opponents.join(","),
  });
  return { ...manifest, config };
}

function compatibilityKey(manifest: Manifest): string {
  return JSON.stringify({
    version: manifest.version,
    config: {
      seats: manifest.config.seats,
      policies: manifest.config.policies,
      opponents: manifest.config.opponents,
    },
    rules: Object.entries(manifest.rules).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    fingerprint: Object.entries(manifest.fingerprint).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  });
}

// 只读合并已经完整结束的分片；分析可以在后来代码版本上运行，源版本来自manifest。
export function combineBenchmarkFiles(
  paths: readonly string[],
): CombinedBenchmarkSummary {
  if (!paths.length) throw new Error("至少需要一个 benchmark JSONL 文件");
  const seenPaths = new Set<string>();
  const seenSeeds = new Set<number>();
  const chunks = paths
    .map((input) => {
      const path = realpathSync(resolve(input));
      const identity = process.platform === "win32" ? path.toLowerCase() : path;
      if (seenPaths.has(identity)) throw new Error("benchmark 源文件路径重复");
      seenPaths.add(identity);
      const bytes = readFileSync(path);
      const content = bytes.toString("utf8");
      if (!content.endsWith("\n"))
        throw new Error("benchmark 源文件末尾截断或缺少换行，拒绝合并");
      const lines = content.slice(0, -1).split("\n");
      let parsedManifest: unknown;
      try {
        parsedManifest = JSON.parse(lines.shift()!);
      } catch {
        throw new Error("源文件 benchmark manifest 损坏");
      }
      const manifest = validateSavedManifest(parsedManifest);
      const chunkSeeds = new Set<number>();
      const records = lines.map((line) => {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          throw new Error("源文件 benchmark 记录损坏");
        }
        const record = validateRecord(value, manifest.config);
        if (chunkSeeds.has(record.seed) || seenSeeds.has(record.seed))
          throw new Error("benchmark 种子重复或分片重叠");
        chunkSeeds.add(record.seed);
        seenSeeds.add(record.seed);
        return record;
      });
      if (records.length !== manifest.config.count)
        throw new Error("benchmark 分片尚未完成或缺少种子记录");
      return {
        manifest,
        records,
        source: {
          name: basename(path),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          manifest,
        },
      };
    })
    .sort(
      (left, right) =>
        left.manifest.config.startSeed - right.manifest.config.startSeed,
    );
  const first = chunks[0].manifest;
  if (
    chunks.some(
      (chunk) => compatibilityKey(chunk.manifest) !== compatibilityKey(first),
    )
  )
    throw new Error("benchmark 分片代码指纹、规则、座位、策略或对手不匹配");
  const records = chunks
    .flatMap((chunk) => chunk.records)
    .sort((left, right) => left.seed - right.seed);
  const startSeed = records[0].seed;
  if (records.some((record, index) => record.seed !== startSeed + index))
    throw new Error("benchmark 合并种子必须连续，存在缺失种子");
  const config = { ...first.config, startSeed, count: records.length };
  return {
    ...summarize(records, config, first.fingerprint),
    rules: first.rules,
    sourceFiles: chunks.map((chunk) => chunk.source),
  };
}
