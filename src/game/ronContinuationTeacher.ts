import type { Phase, ResponseChoice } from "./game";
import type { RolloutDecision } from "./rolloutTeacher";
import {
  analyzePublicRonContinuation,
  type PublicRonOptions,
} from "./publicRonContinuation";
import type { PlayerView } from "./view";

export const RON_MODEL_SAFETY_STANDARD_ERRORS = 2;

export function evaluateRonContinuationDecision(
  view: PlayerView,
  phase: Phase,
  options: PublicRonOptions = {},
): RolloutDecision {
  const analysis = analyzePublicRonContinuation(view, phase, options);
  if (analysis.status === "not-applicable")
    return { status: "not-applicable", choices: [], samples: 0 };
  const decision = view.decision;
  const current = analysis.currentIncome;
  if (
    decision?.kind !== "respond" ||
    current === undefined ||
    !Number.isFinite(current)
  )
    throw new Error("点胡净分模型缺少合法响应或当前金额");
  const labels: Record<ResponseChoice, string> = {
    hu: "点胡",
    pass: "过",
    pung: "碰",
    kong: "直杠",
  };
  const baselineKey = "respond:hu";
  if (analysis.status === "unavailable") {
    const fallbackReason = analysis.failureReason!;
    return {
      status: "fallback",
      samples: 0,
      baselineKey,
      fallbackReason,
      assumptions: [
        "普通点胡公开联合采样不可用时，固定收取当前合法胡牌；此回退没有成功续局样本。",
      ],
      choices: [...decision.choices]
        .sort((a, b) => Number(b === "hu") - Number(a === "hu"))
        .map((choice) => ({
          action: { type: "respond", choice },
          label: labels[choice],
          summary:
            choice === "hu"
              ? `采样未完成，收取当前确定的 ${current.toFixed(2)} 分。`
              : "当前合法响应；未计算其完整续局价值。",
          reason: `联合采样未完成：${fallbackReason}。本节点没有成功的续局比较，按预定回退接受当前合法点胡实收 ${current.toFixed(2)} 分。`,
          limit: "回退只确认当前合法付款，不代表拒胡一定更差或此选择最优。",
        })),
    };
  }
  const estimates = analysis.estimates!;
  let selected: ResponseChoice = "hu";
  let strongestBound = current;
  for (const estimate of estimates) {
    if (estimate.choice === "hu" || estimate.modelStandardError === null)
      continue;
    const bound =
      estimate.meanFutureNet -
      RON_MODEL_SAFETY_STANDARD_ERRORS * estimate.modelStandardError;
    if (bound > strongestBound) {
      strongestBound = bound;
      selected = estimate.choice;
    }
  }
  const assumptions = [
    ...analysis.assumptions,
    "收胡为已知常数；随机分支与它相减没有额外配对降噪。均值减2个模型标准误是固定保守启发式，不是校准的置信区间；并列或波动不可估时收胡。",
  ];
  const choices = estimates
    .map((estimate) => {
      const error = estimate.modelStandardError;
      const bound =
        error === null
          ? null
          : estimate.meanFutureNet - RON_MODEL_SAFETY_STANDARD_ERRORS * error;
      return {
        action: { type: "respond" as const, choice: estimate.choice },
        label: labels[estimate.choice],
        summary:
          estimate.choice === "hu"
            ? `收取当前确定实收 ${current.toFixed(2)} 分，退出后续收付。`
            : `${analysis.samples}个公开生成世界中，后续净分均值 ${estimate.meanFutureNet.toFixed(2)} 分。`,
        reason: `当前胡的确定实收 ${current.toFixed(2)} 分。本动作模型后续净分均值 ${estimate.meanFutureNet.toFixed(2)}，相对实收增量 ${estimate.advantageOverHu.toFixed(2)}；${error === null ? "单粒子不能估计随机分支波动" : `模型采样标准误 ${error.toFixed(2)}，均值减2个标准误为 ${bound!.toFixed(2)}`}。只在全部合法响应中的保守模型比较值严格超过当前实收时拒胡，并列保留胡；比较的是原老师未来策略模型下的净收付。`,
        limit: assumptions.join(" "),
      };
    })
    .sort(
      (a, b) =>
        Number(b.action.choice === selected) -
        Number(a.action.choice === selected),
    );
  return {
    status: "sampled",
    samples: analysis.samples,
    baselineKey,
    choices,
    assumptions,
    // Existing trace schema stores per-world differences to the baseline.
    // Here that baseline is the exact C0 constant, not a simulated hu branch.
    candidates: estimates.map((estimate) => ({
      key: `respond:${estimate.choice}`,
      meanFutureNet: estimate.meanFutureNet,
      pairedGain: estimate.advantageOverHu,
      pairedStandardError: estimate.modelStandardError,
      futureNets: [...estimate.futureNets],
    })),
  };
}
