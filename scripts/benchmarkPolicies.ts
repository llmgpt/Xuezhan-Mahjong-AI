import { recommendActions } from "../src/game/actionAdvice";
import { recommendDiscards } from "../src/game/advice";
import { chooseBotExchange, chooseBotMissing } from "../src/game/bot";
import type { DecisionAction } from "../src/game/decision";
import type { Phase } from "../src/game/game";
import { analyzeNextDraw } from "../src/game/lookahead";
import { chooseStructureExchange } from "../src/game/openingAdvice";
import type { PlayerView } from "../src/game/view";

export const DEFAULT_POLICIES = [
  "advice",
  "efficiency",
  "lookahead",
  "first",
  "random",
] as const;
export const ALL_POLICIES = [
  ...DEFAULT_POLICIES,
  "opening-structure",
  "teacher-candidate",
  "teacher-legacy-discard",
] as const;
export const OPPONENT_POLICIES = ["greedy", "patient"] as const;
export type BenchmarkPolicy = (typeof ALL_POLICIES)[number];
export type OpponentPolicy = (typeof OPPONENT_POLICIES)[number];
export type TeacherPolicy = (
  view: PlayerView,
  phase: Phase,
) => DecisionAction | undefined;
export interface TeacherPolicies {
  teacherCandidate?: TeacherPolicy;
  teacherLegacyDiscard?: TeacherPolicy;
}

function openingAction(
  view: PlayerView,
  phase: Phase,
): DecisionAction | undefined {
  if (phase === "exchange")
    return { type: "exchange", tiles: chooseBotExchange(view.hand) };
  if (phase === "choose-missing")
    return { type: "missing", suit: chooseBotMissing(view.hand) };
  return undefined;
}

// 冻结原实时建议的基线，避免页面未来换策略后 benchmark 也悄悄跟着变。
export function chooseAdviceAction(
  view: PlayerView,
  phase: Phase,
): DecisionAction | undefined {
  const opening = openingAction(view, phase);
  if (opening) return opening;
  const action = recommendActions(view)[0]?.action;
  if (action) return action;
  const discard = recommendDiscards(view)[0];
  return discard && { type: "discard", tile: discard.tile };
}

function efficiencyDiscard(view: PlayerView) {
  return [...recommendDiscards(view)].sort(
    (a, b) =>
      a.shanten - b.shanten ||
      b.effectiveCount - a.effectiveCount ||
      a.tile - b.tile,
  );
}

export function choosePolicyAction(
  view: PlayerView,
  phase: Phase,
  policy: BenchmarkPolicy,
  random: () => number,
  teachers: TeacherPolicies = {},
): DecisionAction | undefined {
  if (policy === "teacher-candidate" || policy === "teacher-legacy-discard") {
    const teacher =
      policy === "teacher-candidate"
        ? teachers.teacherCandidate
        : teachers.teacherLegacyDiscard;
    if (!teacher) throw new Error(`未注入策略 ${policy}`);
    return teacher(view, phase);
  }
  const original = chooseAdviceAction(view, phase);
  if (!original) return undefined;
  if (original.type === "exchange" && policy === "opening-structure") {
    return { type: "exchange", tiles: chooseStructureExchange(view.hand) };
  }
  if (
    original.type !== "discard" ||
    policy === "advice" ||
    policy === "opening-structure"
  )
    return original;
  if (policy === "first")
    return { type: "discard", tile: view.legalDiscards[0] };
  if (policy === "random")
    return {
      type: "discard",
      tile: view.legalDiscards[
        Math.floor(random() * view.legalDiscards.length)
      ],
    };
  const ranked = efficiencyDiscard(view);
  if (policy === "efficiency") return { type: "discard", tile: ranked[0].tile };
  const top = ranked
    .filter((item) => item.shanten === ranked[0].shanten)
    .slice(0, 3);
  const lookahead = analyzeNextDraw(
    view,
    top.map((item) => item.tile),
  );
  const best = lookahead.length
    ? [...top].sort(
        (a, b) =>
          (lookahead.find((item) => item.tile === b.tile)?.twoDrawWinChance ??
            0) -
            (lookahead.find((item) => item.tile === a.tile)?.twoDrawWinChance ??
              0) ||
          b.effectiveCount - a.effectiveCount ||
          a.tile - b.tile,
      )[0]
    : ranked[0];
  return { type: "discard", tile: best.tile };
}

export function chooseOpponentAction(
  view: PlayerView,
  phase: Phase,
  policy: OpponentPolicy,
): DecisionAction | undefined {
  const opening = openingAction(view, phase);
  if (opening) return opening;
  if (policy === "patient") {
    const action = recommendActions(view)[0]?.action;
    if (action && action.type !== "discard") return action;
    const best = efficiencyDiscard(view)[0];
    return best && { type: "discard", tile: best.tile };
  }
  const decision = view.decision;
  if (decision?.kind === "respond") {
    const choice = (["hu", "kong", "pung", "pass"] as const).find((item) =>
      decision.choices.includes(item),
    );
    return choice && { type: "respond", choice };
  }
  if (decision?.kind === "self") {
    if (decision.canWin) return { type: "win" };
    if (decision.addedKongs.length)
      return { type: "kong", kind: "added", tile: decision.addedKongs[0] };
    if (decision.concealedKongs.length)
      return {
        type: "kong",
        kind: "concealed",
        tile: decision.concealedKongs[0],
      };
    const best = recommendDiscards(view)[0];
    return best && { type: "discard", tile: best.tile };
  }
  return undefined;
}
