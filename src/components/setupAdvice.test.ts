import { describe, expect, it } from "vitest";
import { createGame } from "../game/game";
import { chooseStructureExchange } from "../game/openingAdvice";
import { hand } from "../game/testHelpers";
import { teacherChoices } from "../game/teacher";
import { suitOf, tile } from "../game/tiles";
import { playerView, type PlayerView } from "../game/view";
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
  it("完整保留老师换牌推荐，再按优劣顺序列出其他可换门的对照备选", () => {
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
          view.hand.filter((item) => suitOf(item) === suit),
        ),
      );
      const explanation = `${choice.summary}${choice.reason}${choice.limit}`;
      expect(explanation).toContain("该门内");
      expect(explanation).toContain("不是并列推荐");
      expect(explanation).toContain("长期收益排名");
      expect(explanation).toContain("其他三张组合也可合法换出");
      return suit;
    });
    expect(alternativeSuits).toEqual(["tong", "wan"]);
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

  it("种子 777 推荐换条并保留 6 张筒主门，备选对比用人话说明差异", () => {
    const view = playerView(createGame(777), 0);
    const choices = setupAdvice(view, "exchange");
    expect(choices).toHaveLength(3);
    expect(choices[0].action).toEqual({
      type: "exchange",
      tiles: hand("s135"),
    });
    const tongChoice = choices.find(
      (choice) =>
        choice.action.type === "exchange" &&
        suitOf(choice.action.tiles[0]) === "tong",
    );
    expect(tongChoice?.action.type).toBe("exchange");
    if (tongChoice?.action.type === "exchange") {
      expect(tongChoice.action.tiles).not.toEqual(hand("d789"));
    }
    const allText = choices
      .map((choice) => `${choice.summary}${choice.reason}${choice.limit}`)
      .join("");
    expect(allText).not.toMatch(/同张计 4|固定牌序|运行同一结构保留算法/);
  });

  it("种子 108 换牌与各门备选均不整对强拆 11条 对子", () => {
    const view = playerView(createGame(108), 0);
    const choices = setupAdvice(view, "exchange");
    expect(choices).toHaveLength(3);
    const tiaoChoice = choices.find(
      (choice) =>
        choice.action.type === "exchange" &&
        suitOf(choice.action.tiles[0]) === "tiao",
    );
    expect(tiaoChoice?.action).toEqual({
      type: "exchange",
      tiles: hand("s124"),
    });
    for (const choice of choices) {
      if (choice.action.type !== "exchange") continue;
      const onesOfTiao = choice.action.tiles.filter(
        (item) => item === tile("tiao", 1),
      ).length;
      expect(onesOfTiao).toBeLessThan(2);
    }
    const wanChoice = choices.find(
      (choice) =>
        choice.action.type === "exchange" &&
        suitOf(choice.action.tiles[0]) === "wan",
    );
    expect(wanChoice?.action).toEqual({
      type: "exchange",
      tiles: hand("w179"),
    });
  });

  it("两门条件完全相当（如种子 15 万条对称）时如实提示任选其一，不误说备选略逊", () => {
    const view = playerView(createGame(15), 0);
    const exchangeChoices = setupAdvice(view, "exchange");
    expect(exchangeChoices[0].reason).toContain("条件相当");
    expect(exchangeChoices[1].summary).toContain("条件相当");
    expect(exchangeChoices[1].summary).not.toContain("略逊");

    const missingChoices = setupAdvice(view, "choose-missing");
    expect(missingChoices[0].summary).toContain("牌形相当");
    expect(missingChoices[0].summary).toContain("定缺哪一门都可以");
    expect(missingChoices[1].summary).toContain("条件相当");
  });

  it("推荐不拆 3 张完整顺子而备选虽能清门时，备选文案如实说明少清但拆面子", () => {
    const view = viewFor("w1234569 s1479 d234");
    const choices = setupAdvice(view, "exchange");
    expect(choices[0].action).toEqual({
      type: "exchange",
      tiles: hand("s149"),
    });
    const tongAlt = choices.find(
      (choice) =>
        choice.action.type === "exchange" &&
        suitOf(choice.action.tiles[0]) === "tong",
    );
    expect(tongAlt?.action).toEqual({
      type: "exchange",
      tiles: hand("d234"),
    });
    expect(tongAlt?.summary).toContain("虽可少清");
    expect(tongAlt?.summary).toContain("拆散已有成组面子");
    expect(tongAlt?.summary).not.toContain("同样余");
  });
});
