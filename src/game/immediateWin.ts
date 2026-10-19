import type { DecisionChoice } from "./decision";
import type { Phase } from "./game";
import type { PlayerView } from "./view";

export function immediateWinChoice(
  view: PlayerView,
  phase: Phase,
): DecisionChoice | undefined {
  const decision = view.decision;
  let label: string;
  let action: DecisionChoice["action"];
  if (phase === "discard" && decision?.kind === "self" && decision.canWin) {
    label = "自摸胡";
    action = { type: "win" };
  } else if (
    phase === "respond" &&
    decision?.kind === "respond" &&
    decision.choices.includes("hu")
  ) {
    label = decision.responseKind === "rob-kong" ? "抢杠胡" : "点胡";
    action = { type: "respond", choice: "hu" };
  } else return undefined;
  return {
    action,
    label,
    summary: "接受当前合法的" + label + "，收取本次胡牌收益。",
    reason:
      "优先收取当前合法胡牌收益；按宿主规则结算后，本家退出后续血战的摸打及响应。",
    limit:
      "只使用本家视图中的公开合法动作；可能放弃更大未来收益，未证明总是最优。",
  };
}
