import type { DecisionAction } from "./decision";
import type { Phase } from "./game";
import { chooseTeacherAction, teacherChoices } from "./teacher";
import type { PlayerView } from "./view";

export type AdvancedComponent = "full" | "discard" | "actions";

/** Experimental module ablations; all three share the original teacher opening.
 * Nondecision phases and views without a decision have no action. A stale
 * self/response projection for the other decision phase is a caller error.
 */
export async function chooseAdvancedComponentAction(
  view: PlayerView,
  phase: Phase,
  component: AdvancedComponent,
  advanced: (view: PlayerView, phase: Phase) => Promise<DecisionAction>,
): Promise<DecisionAction | undefined> {
  if (phase === "exchange" || phase === "choose-missing")
    return chooseTeacherAction(view, phase);
  if (phase !== "discard" && phase !== "respond") return undefined;
  const decision = view.decision;
  if (!decision) return undefined;
  if ((phase === "discard") !== (decision.kind === "self"))
    throw new Error("高级模块组合的阶段与决策视图不符");

  if (component === "full") return advanced(structuredClone(view), phase);
  if (phase === "respond")
    return component === "discard"
      ? chooseTeacherAction(view, phase)
      : advanced(structuredClone(view), phase);

  if (component === "discard") {
    const teacher = chooseTeacherAction(view, phase);
    if (teacher?.type !== "discard") return teacher;
    const input = structuredClone(view);
    if (input.decision?.kind === "self") {
      input.decision.concealedKongs = [];
      input.decision.addedKongs = [];
    }
    const action = await advanced(input, phase);
    if (action?.type !== "discard")
      throw new Error("高级弃牌模块必须返回discard弃牌动作");
    return action;
  }

  // Preserve a separate original snapshot: an external callback may mutate its
  // argument, and its discard must not change the teacher's candidate ranking.
  const original = structuredClone(view);
  const action = await advanced(structuredClone(original), phase);
  if (action?.type === "win" || action?.type === "kong") return action;
  if (action?.type !== "discard")
    throw new Error("高级动作模块在自己回合必须返回胡、杠或discard弃牌动作");
  const discard = teacherChoices(original, phase).find(
    (item) => item.action.type === "discard",
  );
  if (!discard) throw new Error("原老师没有可用的弃牌候选");
  return discard.action;
}
