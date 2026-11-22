import type { DecisionChoice } from "./decision";
import type { Phase } from "./game";
import { publicRonContext } from "./publicSampler";
import type { PlayerView } from "./view";

/** 将规则确定点数格式化为展示分值（整数不补 .00）。 */
export function formatExactPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(2);
}

export function acceptRonChoice(
  view: PlayerView,
  phase: Phase,
): DecisionChoice | undefined {
  const decision = view.decision;
  if (
    phase !== "respond" ||
    decision?.kind !== "respond" ||
    decision.responseKind !== "discard" ||
    !decision.choices.includes("hu")
  )
    return undefined;
  const current = formatExactPoints(publicRonContext(view).currentIncome);
  return {
    action: { type: "respond", choice: "hu" },
    label: "点胡",
    summary: `直接收取当前确定的 ${current} 分。`,
    reason: `本次普通点胡的确定实收为 ${current} 分。本候选优先兑现当前收益；胡牌后本家退出后续摸打、响应及收付。`,
    limit:
      "只依据当前合法收益作出选择，没有估计拒胡后的未来动作价值；可能放弃更大收益，未证明总是最优。",
  };
}
