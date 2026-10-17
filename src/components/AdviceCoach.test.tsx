import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { recommendActions } from "../game/actionAdvice";
import { recommendDiscards } from "../game/advice";
import type { DecisionChoice } from "../game/decision";
import { hand } from "../game/testHelpers";
import { teacherChoices } from "../game/teacher";
import { labelOf, tile } from "../game/tiles";
import type { PlayerView } from "../game/view";
import { AdviceCoach } from "./AdviceCoach";

function viewFor(notation: string, opening = false): PlayerView {
  const owned = hand(notation);
  return {
    seat: 0,
    hand: owned,
    melds: [],
    missing: opening ? undefined : "tong",
    legalDiscards: opening ? [] : [...new Set(owned)],
    ownDiscards: [],
    opponents: [1, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      melds: [],
      discards: [],
      won: false,
      score: 0,
    })),
    wallRemaining: 55,
  };
}

function renderCoach(
  props: ComponentProps<typeof AdviceCoach> & {
    openingChoices?: DecisionChoice[];
  },
): string {
  return renderToStaticMarkup(<AdviceCoach {...props} />);
}

describe("老师建议的展示契约", () => {
  it("换三张展示老师推荐、理由、局限和查看依据入口", () => {
    const view = viewFor("w123456 s269 d12345", true);
    const openingChoices = teacherChoices(view, "exchange");
    const markup = renderCoach({ advice: [], view, openingChoices });
    expect(markup).toContain(`建议${openingChoices[0].label}`);
    expect(markup).toContain(openingChoices[0].summary);
    expect(markup).toContain("查看依据");
    expect(markup).toContain(openingChoices[0].reason);
    expect(markup).toContain(openingChoices[0].limit);
  });

  it("定缺展示老师推荐及另两门备选，采用老师计算的说明", () => {
    const view = viewFor("w123 s159 d11223445", true);
    const openingChoices = teacherChoices(view, "choose-missing");
    const markup = renderCoach({ advice: [], view, openingChoices });
    expect(markup).toContain(`建议${openingChoices[0].label}`);
    expect(markup).toContain(`推荐 · ${openingChoices[0].label}`);
    for (const choice of openingChoices.slice(1)) {
      expect(markup).toContain(`备选 · ${choice.label}`);
    }
    for (const choice of openingChoices) {
      expect(markup).toContain(choice.summary);
      expect(markup).toContain(choice.reason);
      expect(markup).toContain(choice.limit);
    }
  });

  it("换牌只生成一个策略候选时，不声称只有一种合法选择", () => {
    const view = viewFor("w123456 s269 d12345", true);
    const openingChoices = teacherChoices(view, "exchange");
    const markup = renderCoach({ advice: [], view, openingChoices });
    expect(openingChoices).toHaveLength(1);
    expect(markup).toContain(openingChoices[0].label);
    expect(markup).not.toContain("当前只有这一种合法选择");
  });

  it("结束或非本家决策时没有建议则不显示建议面板", () => {
    const view = viewFor("w11123429 s345678");
    view.legalDiscards = [];
    expect(
      renderCoach({
        advice: [],
        actions: [],
        view,
        openingChoices: teacherChoices(view, "ended"),
      }),
    ).toBe("");
    expect(renderCoach({ advice: [], actions: [], view })).toBe("");
  });

  it("原有出牌建议仍展示推荐、详细依据和局限", () => {
    const view = viewFor("w11123429 s345678");
    const advice = recommendDiscards(view);
    const markup = renderCoach({ advice, view });
    expect(markup).toContain(`建议打出 ${labelOf(advice[0].tile)}`);
    expect(markup).toContain(advice[0].summary);
    expect(markup).toContain(advice[0].reason);
    expect(markup).toContain(advice[0].limit);
    expect(markup).toContain("查看依据");
  });

  it("原有响应建议仍展示碰与过的推荐和备选说明", () => {
    const view = viewFor("w1122589 s123679");
    view.legalDiscards = [];
    view.decision = {
      kind: "respond",
      responseKind: "discard",
      from: 1,
      tile: tile("wan", 1),
      choices: ["pass", "pung"],
    };
    const actions = recommendActions(view);
    const markup = renderCoach({ advice: [], actions, view });
    expect(markup).toContain(`建议${actions[0].label}`);
    for (const choice of actions) {
      expect(markup).toContain(choice.label);
      expect(markup).toContain(choice.reason);
      expect(markup).toContain(choice.limit);
    }
    expect(markup).toContain("查看依据");
  });
});
