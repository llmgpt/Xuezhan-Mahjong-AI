import type { Phase, ResponseChoice } from "./game";
import {
  PUBLIC_SAMPLING_LIMITS,
  PublicSamplingError,
  publicRonContext,
  samplePublicRonParticles,
} from "./publicSampler";
import { continueSampledGame } from "./sampledContinuation";
import type { PlayerView } from "./view";

export interface PublicRonEstimate {
  choice: ResponseChoice;
  futureNets: number[];
  meanFutureNet: number;
  advantageOverHu: number;
  modelStandardError: number | null;
  simulatedTransitions: number;
}

export interface PublicRonAnalysis {
  status: "not-applicable" | "complete" | "unavailable";
  model: "public-ron-teacher-v1";
  samples: number;
  currentIncome?: number;
  estimates?: PublicRonEstimate[];
  assumptions: string[];
  failureReason?: string;
}

export interface PublicRonOptions {
  samples?: number;
  maxSteps?: number;
  sample?: typeof samplePublicRonParticles;
  continueGame?: typeof continueSampledGame;
}

/** Conditional generated-world net values, not actual-world action values. */
export function analyzePublicRonContinuation(
  view: PlayerView,
  phase: Phase,
  options: PublicRonOptions = {},
): PublicRonAnalysis {
  const samples = options.samples ?? 8;
  const maxSteps = options.maxSteps ?? 3000;
  if (
    !Number.isSafeInteger(samples) ||
    samples < 1 ||
    samples > PUBLIC_SAMPLING_LIMITS.maxParticles
  )
    throw new Error("点胡续局粒子样本数必须是1到64的整数");
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 3000)
    throw new Error("点胡续局步数预算必须是1到3000的整数");
  const empty: PublicRonAnalysis = {
    status: "not-applicable",
    model: "public-ron-teacher-v1",
    samples: 0,
    assumptions: [],
  };
  const decision = view.decision;
  if (
    phase !== "respond" ||
    decision?.kind !== "respond" ||
    decision.responseKind !== "discard" ||
    !decision.choices.includes("hu")
  )
    return empty;
  const context = publicRonContext(view);
  let sampled: ReturnType<typeof samplePublicRonParticles>;
  try {
    sampled = (options.sample ?? samplePublicRonParticles)(
      structuredClone(view),
      samples,
    );
  } catch (error) {
    if (
      !(error instanceof PublicSamplingError) ||
      error.code !== "unsatisfiable"
    )
      throw error;
    return {
      ...empty,
      status: "unavailable",
      currentIncome: context.currentIncome,
      failureReason: error.message,
    };
  }
  if (sampled.particles.length !== samples)
    throw new Error("采样未返回指定数量的完整粒子");
  const simulate = options.continueGame ?? continueSampledGame;
  const estimates = decision.choices.map((choice): PublicRonEstimate => {
    let simulatedTransitions = 0;
    const futureNets = sampled.particles.map((particle) => {
      // A legal ron ends this player's future payments. Its known value has
      // zero simulation noise; it does not require a second rollout branch.
      if (choice === "hu") return context.currentIncome;
      const result = simulate(
        structuredClone(view),
        structuredClone(particle),
        { type: "respond", choice },
        { maxSteps },
      );
      if (result.endReason !== "wall" && result.endReason !== "three-wins")
        throw new Error("续局尚未完整结算");
      if (
        !Number.isSafeInteger(result.steps) ||
        result.steps < 1 ||
        result.steps > maxSteps
      )
        throw new Error("续局返回无效步骤预算");
      if (
        result.scoreDifferences.length !== 4 ||
        !result.scoreDifferences.every(Number.isSafeInteger) ||
        Math.abs(result.scoreDifferences.reduce((sum, v) => sum + v, 0)) > 1e-9
      )
        throw new Error("续局返回无效或不守恒的净分");
      simulatedTransitions += result.steps;
      return result.scoreDifferences[view.seat];
    });
    const meanFutureNet =
      futureNets.reduce((sum, value) => sum + value, 0) / samples;
    const modelStandardError =
      choice === "hu"
        ? 0
        : samples === 1
          ? null
          : Math.sqrt(
              futureNets.reduce(
                (sum, value) => sum + (value - meanFutureNet) ** 2,
                0,
              ) /
                (samples - 1) /
                samples,
            );
    return {
      choice,
      futureNets,
      meanFutureNet,
      advantageOverHu: meanFutureNet - context.currentIncome,
      modelStandardError,
      simulatedTransitions,
    };
  });
  return {
    ...empty,
    status: "complete",
    samples,
    currentIncome: context.currentIncome,
    estimates,
    assumptions: [
      ...sampled.assumptions,
      "当前合法收胡按实际单家付款作为确定常数；过、碰、杠在同一批生成世界中分别执行并结算后续净收付，不把既有积分重复计算。",
      "其他人的未公开回答从各生成手牌重新确定资格，由原老师重新回答；未来四家也固定采用原老师，未恢复真实隐藏队列或拟合真实对手。",
      "样本分布有偏，标准误只反映选定生成与未来策略模型的采样波动，不包括模型偏差，不是实战强度区间或最优动作证明。",
    ],
  };
}
