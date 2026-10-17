import { describe, expect, it } from "vitest";
import { chooseStructureExchange } from "../game/openingAdvice";
import { hand } from "../game/testHelpers";
import { teacherChoices } from "../game/teacher";
import { suitOf } from "../game/tiles";
import type { PlayerView } from "../game/view";
import { setupAdvice } from "./setupAdvice";

function viewFor(notation: string): PlayerView {
  return {
    seat: 0,
    hand: hand(notation),
    melds: [],
    legalDiscards: [],
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

describe("仅用于展示的开局建议适配", () => {
  it("完整保留老师换牌推荐，再按万筒顺序列出其他可换门的规则候选", () => {
    const view = viewFor("w123456 s269 d12345");
    const choices = setupAdvice(view, "exchange");
    expect(choices[0]).toEqual(teacherChoices(view, "exchange")[0]);
    expect(choices[0].action).toEqual({
      type: "exchange",
      tiles: hand("s269"),
    });
    expect(choices).toHaveLength(3);
    const alternativeSuits = choices.slice(1).map((choice) => {
      expect(choice.action.type).toBe("exchange");
      if (choice.action.type !== "exchange") throw new Error("应为换牌候选");
      const suit = suitOf(choice.action.tiles[0]);
      expect(choice.action.tiles).toEqual(
        chooseStructureExchange(
          view.hand.filter((tile) => suitOf(tile) === suit),
        ),
      );
      const explanation = `${choice.summary}${choice.reason}${choice.limit}`;
      expect(explanation).toContain("该门内");
      expect(explanation).toContain("规则候选");
      expect(explanation).toContain("不是并列");
      expect(explanation).toContain("长期收益排名");
      expect(explanation).toContain("只列部分合法组合");
      return suit;
    });
    expect(alternativeSuits).toEqual(["wan", "tong"]);
  });

  it("同牌有多副本时，所有展示组合仍是手内持有的同门三张", () => {
    const view = viewFor("w111123 s222 d33445");
    const choices = setupAdvice(view, "exchange");
    expect(choices).toHaveLength(3);
    let hasRepeatedTile = false;
    for (const choice of choices) {
      expect(choice.action.type).toBe("exchange");
      if (choice.action.type !== "exchange") throw new Error("应为换牌候选");
      const tiles = choice.action.tiles;
      expect(tiles).toHaveLength(3);
      expect(new Set(tiles.map(suitOf)).size).toBe(1);
      const remaining = [...view.hand];
      for (const selected of tiles) {
        const index = remaining.indexOf(selected);
        expect(index).toBeGreaterThanOrEqual(0);
        remaining.splice(index, 1);
      }
      hasRepeatedTile ||= new Set(tiles).size < tiles.length;
    }
    expect(hasRepeatedTile).toBe(true);
  });

  it("仅一门够三张时保留老师单项，不虚构其他门备选", () => {
    const view = viewFor("w1112345678 s12 d12");
    expect(setupAdvice(view, "exchange")).toEqual(
      teacherChoices(view, "exchange"),
    );
  });

  it("出牌、响应、摸牌和结束阶段均不产生开局选项", () => {
    const view = viewFor("w11123429 s345678");
    view.missing = "tong";
    view.legalDiscards = [...new Set(view.hand)];
    for (const phase of ["discard", "respond", "draw", "ended"] as const) {
      expect(setupAdvice(view, phase)).toEqual([]);
    }
  });

  it("定缺候选的顺序、动作、理由和局限完全来自老师", () => {
    const view = viewFor("w123 s159 d11223445");
    const expected = teacherChoices(view, "choose-missing");
    expect(expected).toHaveLength(3);
    expect(setupAdvice(view, "choose-missing")).toEqual(expected);
  });

  it("展示换牌与定缺都不修改玩家公开视图", () => {
    const view = viewFor("w123456 s269 d12345");
    const snapshot = structuredClone(view);
    setupAdvice(view, "exchange");
    setupAdvice(view, "choose-missing");
    expect(view).toEqual(snapshot);
  });
});
