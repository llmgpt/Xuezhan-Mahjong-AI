import { setupAdvice } from "../components/setupAdvice";
import { actionKey } from "../game/actionAdvice";
import type {
  DecisionAction,
  DecisionChoice,
  DecisionExplanation,
} from "../game/decision";
import type { Phase } from "../game/game";
import { teacherChoices } from "../game/teacher";
import { labelOf, suitOf } from "../game/tiles";
import type { PlayerView } from "../game/view";
import type { BrowserDecision } from "./advancedClient";
import { assertLegalAction, legalActionCount } from "./advancedProtocol";
import {
  explainAdvancedDiagnostics,
  readAdvancedDiagnostics,
} from "./advancedDiagnostics";

export interface ProductionPresentation {
  action: DecisionAction;
  choices: DecisionChoice[];
  origin: BrowserDecision["origin"];
  legalActionCount?: number;
}
export type ProductionAdviceState =
  | { status: "idle" | "loading"; key?: string }
  | { status: "error"; key?: string; error: string }
  | { status: "ready"; key?: string; presentation: ProductionPresentation };
const suits = { wan: "万", tiao: "条", tong: "筒" };
function key(action: DecisionAction) {
  if (action.type === "exchange")
    return `exchange:${[...action.tiles].sort((a, b) => a - b).join(",")}`;
  if (action.type === "missing") return `missing:${action.suit}`;
  return actionKey(action);
}
function label(action: DecisionAction) {
  if (action.type === "exchange")
    return `换出 ${action.tiles.map(labelOf).join("、")}`;
  if (action.type === "missing") return `定缺${suits[action.suit]}`;
  if (action.type === "discard") return `打出 ${labelOf(action.tile)}`;
  if (action.type === "kong")
    return `${action.kind === "concealed" ? "暗杠" : "补杠"} ${labelOf(action.tile)}`;
  if (action.type === "win") return "自摸胡";
  return { pass: "过", hu: "胡", pung: "碰", kong: "直杠" }[action.choice];
}
export function teacherPresentation(
  view: PlayerView,
  phase: Phase,
): ProductionPresentation | undefined {
  const all = teacherChoices(view, phase);
  if (!all.length) return undefined;
  const opening = phase === "exchange" || phase === "choose-missing";
  const ordinary =
    phase === "discard" &&
    view.decision?.kind === "self" &&
    !view.decision.canWin &&
    !view.decision.concealedKongs.length &&
    !view.decision.addedKongs.length;
  return {
    action: all[0].action,
    choices: opening
      ? setupAdvice(view, phase)
      : ordinary
        ? all.slice(0, 2)
        : all,
    origin: opening ? "teacher-opening" : "teacher-actions",
    legalActionCount: legalActionCount(view, phase),
  };
}
export function presentBrowserDecision(
  view: PlayerView,
  result: BrowserDecision,
): ProductionPresentation {
  assertLegalAction(result.action, view, result.phase);
  if (result.origin !== "advanced-public") {
    if (Object.hasOwn(result, "diagnostics"))
      throw new Error("老师来源不能附带其他策略的分支诊断");
    const teacher = teacherPresentation(view, result.phase);
    if (!teacher || key(teacher.action) !== key(result.action))
      throw new Error("老师来源与实际老师首选不一致");
    return teacher;
  }
  const action = structuredClone(result.action),
    name = label(action);
  const diagnostics = Object.hasOwn(result, "diagnostics")
    ? readAdvancedDiagnostics(result.diagnostics, view, result.phase, action)
    : undefined;
  const observed = diagnostics && explainAdvancedDiagnostics(diagnostics);
  const count = legalActionCount(view, result.phase);
  const facts = [
    "本步由只读取本家手牌与公开信息的高级策略选择。",
    ...(count === undefined
      ? []
      : [`当前共有 ${count} 项合法动作，展示的是本次首选。`]),
  ];
  let summary = `公开信息策略本次选择${name}。`;
  if (
    action.type === "discard" &&
    view.missing &&
    suitOf(action.tile) === view.missing
  ) {
    summary = "手中仍有定缺门牌，本桌规则要求先清缺。";
    facts.push(
      `当前仍有 ${view.hand.filter((tile) => suitOf(tile) === view.missing).length} 张${suits[view.missing]}牌，合法弃牌限定在缺门。`,
    );
  }
  if (action.type === "respond" && view.decision?.kind === "respond") {
    if (view.decision.choices.includes("hu"))
      facts.push(`当前可胡，本策略本次选择${name}。`);
    facts.push(
      `合法响应：${view.decision.choices.map((choice) => label({ type: "respond", choice })).join("、")}。`,
    );
  }
  if (observed) {
    summary =
      observed.summary +
      (diagnostics?.branch?.returnValue === "stand"
        ? `本次最终选择${name}。`
        : "");
    facts.push(...observed.details);
  }
  const choice: DecisionChoice = {
    action,
    label: name,
    summary,
    reason: facts.join(""),
    limit:
      observed?.limit ??
      "当前展示动作出处与规则事实；具体内部评分和分支理由尚未提供。",
  };
  return {
    action,
    choices: [choice],
    origin: "advanced-public",
    legalActionCount: count,
  };
}
/** Speech adapter. Teacher comparisons use the current captured choices only;
 * an uncovered manual alternative carries operation facts, never a new score. */
export function explainProductionAction(
  view: PlayerView,
  action: DecisionAction,
  recommendation?: ProductionPresentation,
): DecisionExplanation {
  const fromTeacher =
    recommendation && recommendation.origin !== "advanced-public";
  const chosen = fromTeacher
    ? recommendation.choices.find(
        (choice) => key(choice.action) === key(action),
      )
    : recommendation && key(recommendation.action) === key(action)
      ? recommendation.choices[0]
      : undefined;
  const actual = chosen ?? {
    action: structuredClone(action),
    label: label(action),
    summary: `你选择${label(action)}。`,
    reason: "这是玩家手动选择的合法操作。",
    limit: "此处仅记录操作事实。",
  };
  const recommended = (fromTeacher && recommendation.choices[0]) || actual;
  return {
    view: { missing: view.missing },
    actual,
    recommended,
    matchesRecommendation: key(action) === key(recommended.action),
  };
}

/** Shared by the hook and pure asynchronous regression tests. A changed render
 * key or synchronous user action invalidates old resolutions and old errors. */
export class ProductionAdviceGate {
  private key?: string;
  private generation = 0;
  expect(key: string) {
    if (this.key !== key) {
      this.generation++;
      this.key = key;
    }
  }
  invalidate() {
    this.generation++;
    this.key = undefined;
  }
  isCurrent(key: string | undefined) {
    return key !== undefined && key === this.key;
  }
  async run<T>(
    key: string,
    task: () => Promise<T>,
  ): Promise<
    { key: string; value: T } | { key: string; error: string } | undefined
  > {
    this.expect(key);
    const generation = ++this.generation;
    try {
      const value = await task();
      if (this.key === key && this.generation === generation)
        return { key, value };
    } catch (error) {
      if (this.key === key && this.generation === generation)
        return {
          key,
          error: error instanceof Error ? error.message : String(error),
        };
    }
    return undefined;
  }
}
