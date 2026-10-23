import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DEFAULT_RULES } from "../src/game/game";
import type { RolloutDecision } from "../src/game/rolloutTeacher";
import { chooseTeacherAction } from "../src/game/teacher";
import {
  evaluateLiabilityDiscard,
  type LiabilityDiscardDecision,
} from "../src/game/liabilityDiscard";
import { suitOf } from "../src/game/tiles";
import {
  parseIndependentConfig,
  type IndependentConfig,
} from "./independentBenchmark";
import {
  summarizeIndependentEvaluation,
  type IndependentRecord,
} from "./independentEvaluation";
import {
  playIndependentGame,
  type IndependentDecisionTrace,
  type IndependentGameResult,
  type Policy,
} from "./independentRunner";

interface FormalSeedAuditOptions {
  config: IndependentConfig;
  seed: number;
  directory: string;
  sourceFingerprint: Record<string, string>;
  runtime: { node: string; python: string; numpy?: string };
  rules: typeof DEFAULT_RULES;
}

export interface FormalSeedAudit {
  seed: number;
  records: IndependentRecord[];
  gamesSha256: string;
  tracesSha256: string;
  gameCount: number;
  decisionCount: number;
  replayedStates: number;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

function exact(actual: unknown, expected: unknown, message: string): void {
  if (canonical(actual) !== canonical(expected)) throw new Error(message);
}

function fields(
  value: unknown,
  keys: string[],
  name: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    throw new Error(`${name} schema含缺失或未知字段`);
}

async function hashJsonl(path: string): Promise<string> {
  const digest = createHash("sha256");
  let size = 0;
  let lastByte: number | undefined;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    digest.update(bytes);
    size += bytes.length;
    lastByte = bytes.at(-1);
  }
  if (!size || lastByte !== 10)
    throw new Error(`JSONL日志为空或截断，缺少末尾换行：${path}`);
  return digest.digest("hex");
}

async function* jsonLines(path: string): AsyncGenerator<unknown> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let number = 0;
  try {
    for await (const line of lines) {
      number++;
      if (!line.trim()) throw new Error(`JSONL日志包含空行：${number}`);
      try {
        yield JSON.parse(line);
      } catch (error) {
        throw new Error(
          `JSONL日志第${number}行无效：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

function recordKey(
  row: Pick<
    IndependentRecord,
    "seed" | "seat" | "lineup" | "opening" | "policy"
  >,
): string {
  return canonical([row.seed, row.seat, row.lineup, row.opening, row.policy]);
}

function validateAction(value: unknown): void {
  if (!value || typeof value !== "object" || !("type" in value))
    throw new Error("动作schema缺少类型");
  const keys = {
    exchange: ["type", "tiles"],
    missing: ["type", "suit"],
    discard: ["type", "tile"],
    win: ["type"],
    kong: ["type", "kind", "tile"],
    respond: ["type", "choice"],
  };
  if (typeof value.type !== "string" || !Object.hasOwn(keys, value.type))
    throw new Error("未知动作schema");
  fields(value, keys[value.type as keyof typeof keys], "action");
}

function validateEvaluations(
  raw: unknown,
  decisions: IndependentDecisionTrace[],
  record: Pick<IndependentRecord, "policy" | "seat">,
): void {
  if (!Array.isArray(raw)) throw new Error("trace缺少评估数组");
  const seen = new Set<number>();
  const liabilitySeen = new Set<number>();
  for (const value of raw) {
    fields(value, ["actor", "decisionIndex", "report"], "evaluation");
    const index = value.decisionIndex;
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= decisions.length ||
      value.actor !== decisions[index].actor ||
      seen.has(index)
    )
      throw new Error("评估附录不对应唯一的实际决定");
    seen.add(index);
    const report = value.report as RolloutDecision;
    if (report && typeof report === "object" && "kind" in report) {
      if (
        report.kind !== "public-liability-discard-v1" ||
        record.policy !== "candidate-advanced-liability-v11" ||
        value.actor !== record.seat ||
        decisions[index].phase !== "discard"
      )
        throw new Error("赔付模型附录不是本家实际V11弃牌");
      const liabilityReport = report as unknown as LiabilityDiscardDecision;
      const expected = evaluateLiabilityDiscard(
        decisions[index].view,
        liabilityReport.baselineTile,
      );
      if (!expected) throw new Error("赔付附录节点不适用");
      exact(
        liabilityReport,
        expected,
        "赔付附录与固定模型、约束或实际基准不符",
      );
      exact(
        expected.choice.action,
        decisions[index].action,
        "赔付比较首选与实际动作不符",
      );
      liabilitySeen.add(index);
      continue;
    }
    if (record.policy === "candidate-advanced-liability-v11")
      throw new Error("V11只能记录实际赔付比较，没有续局采样");
    const allowed = [
      "status",
      "choices",
      "samples",
      "baselineKey",
      "candidates",
      "assumptions",
      "fallbackReason",
    ];
    if (
      !report ||
      typeof report !== "object" ||
      Object.keys(report).some((key) => !allowed.includes(key)) ||
      !["sampled", "fallback"].includes(report.status) ||
      !Number.isSafeInteger(report.samples) ||
      report.samples < 0 ||
      !Array.isArray(report.choices) ||
      !report.choices.length
    )
      throw new Error("无效evaluation report");
    if (
      (report.status === "fallback" &&
        (report.samples !== 0 ||
          typeof report.fallbackReason !== "string" ||
          !report.fallbackReason)) ||
      (report.status === "sampled" && report.samples < 1)
    )
      throw new Error("评估状态与实际采样次数不一致");
    exact(
      report.choices[0].action,
      decisions[index].action,
      "评估首选与实际动作不一致",
    );
  }
  if (record.policy === "candidate-advanced-liability-v11") {
    decisions.forEach((event, index) => {
      const view = event.view;
      if (
        event.actor === record.seat &&
        event.phase === "discard" &&
        event.action.type === "discard" &&
        view.decision?.kind === "self" &&
        !view.decision.canWin &&
        view.missing &&
        !view.hand.some((t) => suitOf(t) === view.missing) &&
        !liabilitySeen.has(index)
      )
        throw new Error("V11实际弃牌缺少完整赔付比较记录");
    });
  }
}

/** Replays stored actions in the trusted engine; never asks a candidate again. */
export async function auditFormalSeedAttempt(
  options: FormalSeedAuditOptions,
): Promise<FormalSeedAudit> {
  const { seed, directory, sourceFingerprint, runtime, rules } = options;
  const config = parseIndependentConfig(options.config);
  if (!config.seeds.includes(seed)) throw new Error("审计seed不在冻结网格");
  exact(
    rules,
    DEFAULT_RULES,
    "审计器只支持实际DEFAULT_RULES规则，不能用标签替换引擎规则",
  );
  const expected = { ...config, seeds: [seed] };
  const gamesPath = join(directory, "games.jsonl");
  const tracesPath = join(directory, "traces.jsonl");
  const [gamesSha256, tracesSha256] = await Promise.all([
    hashJsonl(gamesPath),
    hashJsonl(tracesPath),
  ]);
  let lineNumber = 0;
  let records: IndependentRecord[] | undefined;
  for await (const value of jsonLines(gamesPath)) {
    lineNumber++;
    if (lineNumber === 1) {
      fields(
        value,
        [
          "kind",
          "version",
          "config",
          "rules",
          "fingerprint",
          "runtime",
          "protocol",
          "opening",
          "pairing",
        ],
        "manifest",
      );
      if (
        value.kind !== "manifest" ||
        value.version !== 2 ||
        value.protocol !== "public-view-v2/independent-jsonl-v2"
      )
        throw new Error("未知manifest协议");
      exact(value.config, expected, "manifest配置与单seed冻结网格不一致");
      exact(value.rules, rules, "manifest规则不一致");
      exact(value.fingerprint, sourceFingerprint, "manifest来源不一致");
      exact(value.runtime, runtime, "manifest运行时不一致");
      exact(
        value.opening,
        {
          common: "teacher-v1 exchange and missing for all seats",
          composite:
            "each policy; both ebony references share teacher-v1 exchange only",
        },
        "manifest开局合同不一致",
      );
      exact(
        value.pairing,
        "same initial seed, then trajectories and draw recipients may diverge; seed-cluster statistics",
        "manifest配对合同不一致",
      );
    } else if (lineNumber === 2) {
      fields(value, ["kind", "seed", "records"], "seed envelope");
      if (
        value.kind !== "seed" ||
        value.seed !== seed ||
        !Array.isArray(value.records)
      )
        throw new Error("无效单种子提交");
      for (const row of value.records)
        fields(
          row,
          ["seed", "seat", "lineup", "opening", "policy", "result"],
          "game result",
        );
      records = value.records as IndependentRecord[];
      // Validate the exact Cartesian product and all financial categories first.
      summarizeIndependentEvaluation(records, expected, config.comparisons);
    } else {
      throw new Error("一个正式attempt只能包含单种子envelope");
    }
  }
  if (!records || lineNumber !== 2)
    throw new Error("单seed日志缺少完整网格提交");
  const byKey = new Map(records.map((row) => [recordKey(row), row]));
  const seen = new Set<string>();
  let decisionCount = 0;
  let replayedStates = 0;
  for await (const value of jsonLines(tracesPath)) {
    fields(
      value,
      [
        "kind",
        "seed",
        "seat",
        "lineup",
        "opening",
        "policy",
        "decisions",
        "evaluations",
      ],
      "trace",
    );
    if (value.kind !== "game") throw new Error("正式trace含失败或未知日志");
    const key = recordKey(value as unknown as IndependentRecord);
    const record = byKey.get(key);
    if (!record || seen.has(key))
      throw new Error("trace含额外网格组合或重复日志");
    seen.add(key);
    if (!Array.isArray(value.decisions) || !value.decisions.length)
      throw new Error("trace缺少实际决定");
    for (const event of value.decisions) {
      fields(event, ["actor", "phase", "step", "view", "action"], "decision");
      validateAction(event.action);
    }
    const decisions = value.decisions as IndependentDecisionTrace[];
    validateEvaluations(value.evaluations, decisions, record);
    let index = 0;
    const replay: Policy = (view, phase) => {
      const event = decisions[index++];
      if (!event) throw new Error("重放时缺少决定");
      if (event.actor !== view.seat || event.phase !== phase)
        throw new Error("重放决定的座位或阶段不符");
      exact(event.view, view, "重放时完整公开视图不符");
      if (
        record.opening === "common" &&
        (phase === "exchange" || phase === "choose-missing")
      )
        exact(
          event.action,
          chooseTeacherAction(view, phase),
          "共同开局偏离冻结老师选择",
        );
      return structuredClone(event.action);
    };
    let result: IndependentGameResult;
    try {
      result = await playIndependentGame(
        seed,
        record.seat,
        replay,
        { 0: replay, 1: replay, 2: replay, 3: replay },
        {
          openingPolicy: record.opening === "common" ? replay : undefined,
          onDecision: (actual) =>
            exact(
              actual,
              decisions[index - 1],
              "重放动作、step或完整公开决定不符",
            ),
        },
      );
    } catch (error) {
      throw new Error(
        `重放${key}失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (index !== decisions.length) throw new Error("终局之后仍有多余决定");
    exact(result, record.result, "重放完整终局与games记录不符");
    decisionCount += index;
    replayedStates += result.steps + 1;
  }
  if (seen.size !== byKey.size)
    throw new Error("trace网格不完整，缺少成功日志");
  const after = await Promise.all([
    hashJsonl(gamesPath),
    hashJsonl(tracesPath),
  ]);
  if (after[0] !== gamesSha256 || after[1] !== tracesSha256)
    throw new Error("原始日志在重放审计中发生变化");
  return {
    seed,
    records,
    gamesSha256,
    tracesSha256,
    gameCount: records.length,
    decisionCount,
    replayedStates,
  };
}
