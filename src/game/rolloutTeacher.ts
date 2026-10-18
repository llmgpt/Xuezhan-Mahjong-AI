import { actionKey } from "./actionAdvice";
import type { DecisionAction, DecisionChoice } from "./decision";
import type { Phase } from "./game";
import { PublicSamplingError, samplePublicParticles } from "./publicSampler";
import { continueSampledGame } from "./sampledContinuation";
import { teacherChoices } from "./teacher";
import type { PlayerView } from "./view";

export interface RolloutCandidateEstimate {
  key: string;
  meanFutureNet: number;
  pairedGain: number;
  pairedStandardError: number | null;
  futureNets: number[];
}

export interface RolloutDecision {
  status: "not-applicable" | "sampled" | "fallback";
  choices: DecisionChoice[];
  samples: number;
  baselineKey?: string;
  candidates?: RolloutCandidateEstimate[];
  assumptions?: string[];
  fallbackReason?: string;
}

export interface RolloutOptions {
  samples?: number;
  minimumGain?: number;
  sample?: typeof samplePublicParticles;
  continueGame?: typeof continueSampledGame;
}

function playKey(action: DecisionAction): string {
  if (action.type === "exchange" || action.type === "missing")
    throw new Error("续局估值不包含开局动作");
  return actionKey(action);
}

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Experimental self-kong comparison. Not connected to the page's teacher. */
export function evaluateRolloutDecision(
  view: PlayerView,
  phase: Phase,
  options: RolloutOptions = {},
): RolloutDecision {
  const samples = options.samples ?? 8;
  const minimumGain = options.minimumGain ?? 0;
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 64)
    throw new Error("续局样本数必须是1到64的整数");
  if (!Number.isFinite(minimumGain) || minimumGain < 0)
    throw new Error("续局最小模型增量必须是非负数");
  const original = teacherChoices(view, phase);
  const notApplicable: RolloutDecision = {
    status: "not-applicable",
    choices: original,
    samples: 0,
  };
  if (
    phase !== "discard" ||
    view.decision?.kind !== "self" ||
    view.decision.canWin ||
    !original.length ||
    !(view.decision.concealedKongs.length + view.decision.addedKongs.length)
  )
    return notApplicable;

  const baselineKey = playKey(original[0].action);
  const discard = original.find((item) => item.action.type === "discard");
  const candidates = [
    original[0],
    ...(discard ? [discard] : []),
    ...original.filter((item) => item.action.type === "kong"),
  ].filter(
    (item, index, all) =>
      all.findIndex(
        (other) => playKey(other.action) === playKey(item.action),
      ) === index,
  );
  if (candidates.length < 2) return notApplicable;

  let sampled: ReturnType<typeof samplePublicParticles>;
  try {
    sampled = (options.sample ?? samplePublicParticles)(
      structuredClone(view),
      samples,
    );
  } catch (error) {
    if (
      !(error instanceof PublicSamplingError) ||
      error.code !== "unsatisfiable"
    )
      throw error;
    const fallbackReason = error.message;
    return {
      status: "fallback",
      samples: 0,
      baselineKey,
      fallbackReason,
      choices: original.map((item) => ({
        ...item,
        summary: `本次公开约束采样未完成，沿用原规则选择。${item.summary}`,
        reason: `采样失败：${fallbackReason}。未计算续局净分。${item.reason}`,
      })),
    };
  }
  if (sampled.particles.length !== samples)
    throw new Error("续局采样未返回指定数量的完整粒子");
  const simulate = options.continueGame ?? continueSampledGame;
  const estimates: RolloutCandidateEstimate[] = candidates.map((item) => {
    const futureNets = sampled.particles.map((particle) => {
      const result = simulate(
        structuredClone(view),
        structuredClone(particle),
        structuredClone(item.action),
      );
      const value = result.scoreDifferences[view.seat];
      if (!Number.isFinite(value)) throw new Error("续局返回无效本家净分");
      return value;
    });
    return {
      key: playKey(item.action),
      meanFutureNet: mean(futureNets),
      pairedGain: 0,
      pairedStandardError: null,
      futureNets,
    };
  });
  const baseline = estimates[0];
  for (const item of estimates) {
    const differences = item.futureNets.map(
      (value, index) => value - baseline.futureNets[index],
    );
    item.pairedGain = mean(differences);
    item.pairedStandardError =
      samples > 1
        ? Math.sqrt(
            differences.reduce(
              (sum, value) => sum + (value - item.pairedGain) ** 2,
              0,
            ) /
              (samples - 1) /
              samples,
          )
        : null;
  }
  const strongest = [...estimates].sort(
    (a, b) => b.meanFutureNet - a.meanFutureNet,
  )[0];
  // A tie or a gain below the explicitly configured threshold preserves baseline.
  const selectedKey =
    strongest.pairedGain > minimumGain + 1e-9 ? strongest.key : baselineKey;
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(playKey(b.action) === selectedKey) -
      Number(playKey(a.action) === selectedKey),
  );
  const used = new Set(estimates.map((item) => item.key));
  const choices = ordered.map((item) => {
    const estimate = estimates.find(
      (value) => value.key === playKey(item.action),
    )!;
    const se =
      estimate.pairedStandardError === null
        ? "样本不足以估计波动"
        : `配对蒙特卡洛标准误 ${estimate.pairedStandardError.toFixed(2)}`;
    return {
      ...item,
      summary: `${samples}个公开约束样本中，后续净分均值 ${estimate.meanFutureNet.toFixed(2)}；相对原选择 ${estimate.pairedGain >= 0 ? "+" : ""}${estimate.pairedGain.toFixed(2)}。`,
      reason: `对相同${samples}个合成暗手与牌墙，分别执行候选后由原老师继续行牌至结算，比较当前之后的终局净分；包含后续胡牌、点炮、碰杠和流局收付，也允许原选择稍后再杠。本候选均值 ${estimate.meanFutureNet.toFixed(2)}，相对原选择增量 ${estimate.pairedGain.toFixed(2)}，${se}。仅当模型增量大于 ${minimumGain} 才更改原选择；并列保留原选择。`,
      limit: `${sampled.assumptions.join(" ")} 后续四家均用原老师，未拟合实际对手；样本分布有偏且数量有限，标准误仅反映此采样模型的波动，不是实战强度证明或真实胜率。只比较原选择、原推荐弃牌及合法自杠，未搜索全部弃牌。`,
    };
  });
  return {
    status: "sampled",
    samples,
    baselineKey,
    candidates: estimates,
    assumptions: [...sampled.assumptions],
    choices: [
      ...choices,
      ...original.filter((item) => !used.has(playKey(item.action))),
    ],
  };
}

export function chooseRolloutAction(
  view: PlayerView,
  phase: Phase,
  options: RolloutOptions = {},
): DecisionAction | undefined {
  return evaluateRolloutDecision(view, phase, options).choices[0]?.action;
}
