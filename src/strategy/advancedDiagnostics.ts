import type { DecisionAction } from "../game/decision";
import type { Phase } from "../game/game";
import type { PlayerView } from "../game/view";
import { assertLegalAction, fields } from "./advancedProtocol";

interface ScalarStep {
  before: number;
  after: number;
  delta: number;
}
interface HuBranch {
  function: "check_hu" | "check_robkong";
  functionSha256: string;
  sourceFileSha256: string;
  returnValue: "hu" | "stand" | "robkong";
  returnLine: { function: number; source: number };
}
interface HuComparison {
  actualUtl: number;
  utlUnit: "legacy-base-score";
  numS: number;
  wallRemaining: number;
  approxRemainingDraws: number;
  finalHeuristicWaitingFactor: number | null;
  declineThreshold: number | null;
  baseScoreThreshold: number | null;
  currentEventRatio: null;
  eventFactorStep: ScalarStep | null;
  futureKongStep: ScalarStep | null;
  calibration: "heuristic-not-exact-probability";
}
export interface AdvancedDiagnostics {
  version: 1;
  policyId: "ebony72-advanced-public-v1";
  publicViewHash: string;
  coverage: "not-covered" | "observed-hu-branch";
  branch: HuBranch | null;
  comparison: HuComparison | null;
  currentIncome: { status: "not-called" };
  postHuMeldStage: "not-covered" | "not-observed" | "not-run";
}
export interface AdvancedReason {
  summary: string;
  details: string[];
  limit: string;
}

const sourceHash =
  "12fc6958cc0466292fc2352578a34ac89eb7e73b9938f885fd17852497932fd2";
const methods = {
  check_hu: {
    hash: "02b4ab62ea1c829456a5f2d3ee5f64a21dc1497fe534d09ca056c8b3ee93e1a8",
    start: 820,
    lines: { hu: 1010, stand: 1008 },
  },
  check_robkong: {
    hash: "81a4a29da0758fbe93ae2dc87342f10c4738f24960117381e265a0b272c25e0e",
    start: 1238,
    lines: { robkong: 1266, stand: 1267 },
  },
} as const;
function finite(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("策略诊断只接受有限数值");
}
function step(value: unknown) {
  if (value === null) return;
  fields(value, ["before", "after", "delta"]);
  for (const scalar of Object.values(value)) finite(scalar);
  const before = value.before as number,
    after = value.after as number,
    delta = value.delta as number;
  if (
    Math.abs(after - before - delta) >
    1e-12 * Math.max(1, Math.abs(after), Math.abs(before))
  )
    throw new Error("策略诊断修正项不一致");
}
function robCondition(
  value: Pick<HuComparison, "actualUtl" | "numS" | "approxRemainingDraws">,
) {
  if (value.actualUtl > 1) return "utl";
  if (value.approxRemainingDraws < 4) return "draws";
  if (value.numS <= 4 && value.approxRemainingDraws <= 5) return "late";
  if (value.numS <= 1) return "waits";
  return undefined;
}

/** Restricted to actual A used by browser E/D. The request/position envelope is
 * checked by both transports; publicViewHash records Python's canonical input,
 * rather than claiming a separate browser source attestation. */
export function readAdvancedDiagnostics(
  value: unknown,
  view: PlayerView,
  phase: Phase,
  action: DecisionAction,
): AdvancedDiagnostics {
  fields(value, [
    "version",
    "policyId",
    "publicViewHash",
    "coverage",
    "branch",
    "comparison",
    "currentIncome",
    "postHuMeldStage",
  ]);
  if (
    value.version !== 1 ||
    value.policyId !== "ebony72-advanced-public-v1" ||
    typeof value.publicViewHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.publicViewHash)
  )
    throw new Error("未知高级诊断来源或公开视图摘要");
  assertLegalAction(action, view, phase);
  fields(value.currentIncome, ["status"]);
  if (value.currentIncome.status !== "not-called")
    throw new Error("原高级模型未调用本桌实际收益计算");
  const decision = view.decision;
  const eligible =
    phase === "respond" &&
    decision?.kind === "respond" &&
    decision.choices.includes("hu") &&
    decision.choices.includes("pass") &&
    new Set(decision.choices).size === decision.choices.length;
  if (!eligible) {
    if (
      value.coverage !== "not-covered" ||
      value.branch !== null ||
      value.comparison !== null ||
      value.postHuMeldStage !== "not-covered"
    )
      throw new Error("非胡牌比较节点不能声称已有分支理由");
    return structuredClone(value as unknown as AdvancedDiagnostics);
  }
  if (value.coverage !== "observed-hu-branch")
    throw new Error("缺少本步实际胡牌分支");
  fields(value.branch, [
    "function",
    "functionSha256",
    "sourceFileSha256",
    "returnValue",
    "returnLine",
  ]);
  const branch = value.branch;
  const name =
    decision.responseKind === "rob-kong" ? "check_robkong" : "check_hu";
  const method = methods[name];
  if (
    branch.function !== name ||
    branch.functionSha256 !== method.hash ||
    branch.sourceFileSha256 !== sourceHash ||
    typeof branch.returnValue !== "string" ||
    !Object.hasOwn(method.lines, branch.returnValue)
  )
    throw new Error("胡牌分支与实际来源/响应阶段不符");
  fields(branch.returnLine, ["function", "source"]);
  const line = (method.lines as Record<string, number>)[branch.returnValue];
  if (
    branch.returnLine.source !== line ||
    branch.returnLine.function !== line - method.start + 1
  )
    throw new Error("胡牌分支返回行与固定源码不符");
  if (
    action.type !== "respond" ||
    (branch.returnValue !== "stand") !== (action.choice === "hu") ||
    value.postHuMeldStage !==
      (branch.returnValue === "stand" ? "not-observed" : "not-run")
  )
    throw new Error("胡牌判断与实际动作/后续阶段不符");
  fields(value.comparison, [
    "actualUtl",
    "utlUnit",
    "numS",
    "wallRemaining",
    "approxRemainingDraws",
    "finalHeuristicWaitingFactor",
    "declineThreshold",
    "baseScoreThreshold",
    "currentEventRatio",
    "eventFactorStep",
    "futureKongStep",
    "calibration",
  ]);
  const comparison = value.comparison;
  if (
    comparison.utlUnit !== "legacy-base-score" ||
    comparison.calibration !== "heuristic-not-exact-probability" ||
    comparison.currentEventRatio !== null
  )
    throw new Error("高级比较值的单位或估计边界不符");
  for (const field of [
    "actualUtl",
    "numS",
    "wallRemaining",
    "approxRemainingDraws",
  ])
    finite(comparison[field]);
  if (
    (comparison.actualUtl as number) <= 0 ||
    !Number.isInteger(comparison.numS) ||
    (comparison.numS as number) < 0 ||
    (comparison.numS as number) > 108 ||
    comparison.wallRemaining !== view.wallRemaining ||
    (comparison.approxRemainingDraws as number) < 0 ||
    (comparison.approxRemainingDraws as number) > 55
  )
    throw new Error("高级比较值与当前公开局面不符");
  if (name === "check_hu") {
    finite(comparison.finalHeuristicWaitingFactor);
    if (
      comparison.declineThreshold !== 1 ||
      comparison.baseScoreThreshold !== null ||
      comparison.finalHeuristicWaitingFactor > 1 !==
        (branch.returnValue === "stand")
    )
      throw new Error("实际等待比较方向与返回分支不符");
  } else if (
    comparison.finalHeuristicWaitingFactor !== null ||
    comparison.declineThreshold !== null ||
    comparison.baseScoreThreshold !== 1 ||
    (robCondition(comparison as unknown as HuComparison) !== undefined) !==
      (branch.returnValue === "robkong") ||
    comparison.eventFactorStep !== null ||
    comparison.futureKongStep !== null
  ) {
    throw new Error("实际抢杠比较方向与返回分支不符");
  }
  step(comparison.eventFactorStep);
  step(comparison.futureKongStep);
  return structuredClone(value as unknown as AdvancedDiagnostics);
}

function number(value: number, threshold?: number) {
  const short = String(Number(value.toPrecision(4)));
  return threshold !== undefined &&
    Number(short) === threshold &&
    value !== threshold
    ? String(value)
    : short;
}

export function explainAdvancedDiagnostics(
  value: AdvancedDiagnostics,
): AdvancedReason | undefined {
  if (
    value.coverage !== "observed-hu-branch" ||
    !value.branch ||
    !value.comparison
  )
    return undefined;
  const branch = value.branch,
    comparison = value.comparison;
  const decline = branch.returnValue === "stand";
  const rob = robCondition(comparison);
  const robSummary =
    rob === "draws"
      ? `原模型余摸估计 ${number(comparison.approxRemainingDraws, 4)} 少于 4，满足抢杠收胡条件。`
      : rob === "late"
        ? `原模型可成胡张数 ${comparison.numS} 不超过 4、余摸估计 ${number(comparison.approxRemainingDraws, 5)} 不超过 5，本次收胡。`
        : rob === "waits"
          ? `原模型可成胡张数 ${comparison.numS} 不超过 1，本次收胡。`
          : `原模型牌型值 ${number(comparison.actualUtl, 1)}${decline ? "未高于" : "高于"}阈值 1，${decline ? "其余收胡条件也未满足，暂不收胡" : "本次收胡"}。`;
  const summary =
    branch.function === "check_hu"
      ? `等待比较值 ${number(comparison.finalHeuristicWaitingFactor!, 1)}${decline ? "高于" : "不高于"}阈值 1，${decline ? "暂不收胡" : "本次收胡"}。`
      : robSummary;
  const details: string[] = ["这些数值来自本次实际胡牌判断。"];
  details.push(
    `原模型可成胡张数估计 ${comparison.numS} 张，余摸估计 ${number(comparison.approxRemainingDraws)} 次；这些公开信息估计不等于实际牌墙张数。`,
  );
  if (comparison.eventFactorStep)
    details.push(
      `当前事件修正将比较值由 ${number(comparison.eventFactorStep.before)} 调整为 ${number(comparison.eventFactorStep.after)}。`,
    );
  if (comparison.futureKongStep)
    details.push(
      `继续等待估算计入未来杠机会时，比较值由 ${number(comparison.futureKongStep.before)} 变为 ${number(comparison.futureKongStep.after)}。`,
    );
  if (decline) details.push("仅记录了胡牌判断；后续碰、杠、过的取舍未采集。");
  return {
    summary,
    details,
    limit:
      "模型比较值是启发式指标，不是胜率或精确净分；原模型基础牌型值不是本桌实际可收点数。",
  };
}
