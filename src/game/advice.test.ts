import { describe, expect, it } from "vitest";
import { estimateShanten, recommendDiscards } from "./advice";
import { chooseBotExchange } from "./bot";
import { completeExchange, completeMissing } from "./demo";
import { createGame } from "./game";
import { hand } from "./testHelpers";
import { suitOf, tile, type Suit } from "./tiles";
import { playerView, type PlayerView } from "./view";

function adviceView(notation: string, missing: Suit): PlayerView {
  const owned = hand(notation);
  const missingTiles = owned.filter((item) => suitOf(item) === missing);
  return {
    seat: 0,
    hand: owned,
    melds: [],
    missing,
    legalDiscards: [...new Set(missingTiles.length ? missingTiles : owned)],
    ownDiscards: [],
    opponents: [1, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      melds: [],
      discards: [],
      missing: "tong",
      won: false,
      score: 0,
    })),
    wallRemaining: 55,
  };
}

describe("受限玩家视图", () => {
  it("仅公开自己的手牌和对手的公开牌面", () => {
    let state = createGame(42);
    state = completeExchange(state, chooseBotExchange(state.players[0].hand));
    state = completeMissing(state, "wan");
    const view = playerView(state, 0);
    expect(view.hand).toEqual(state.players[0].hand);
    expect(view.wallRemaining).toBe(state.wall.length);
    expect("wall" in view).toBe(false);
    expect(view.opponents.every((opponent) => !("hand" in opponent))).toBe(
      true,
    );
  });
});

describe("可解释出牌建议", () => {
  it("外部六搭教学牌例优先拆进张损失较小的边搭，并说明并列", () => {
    // https://pangruitao.com/post/4422 ，牌例 1245589m1244589s。
    const advice = recommendDiscards(adviceView("w1245589 s1244589", "tong"));
    const best = advice.filter(
      (item) =>
        item.shanten === advice[0].shanten &&
        item.effectiveCount === advice[0].effectiveCount,
    );
    expect(best.map((item) => item.tile)).toEqual([
      tile("wan", 1),
      tile("wan", 2),
      tile("tiao", 1),
      tile("tiao", 2),
    ]);
    expect(advice[0].summary).toContain("并列");
    expect(advice[0].effectiveCount).toBeGreaterThan(
      advice.find((item) => item.tile === tile("wan", 4))!.effectiveCount,
    );
  });

  it("七对与清一色路线有分歧时，备选说明仍需舍掉的异色牌", () => {
    // https://www.newton.com.tw/wiki/成都麻將 的第二个叙述性牌例。
    const advice = recommendDiscards(adviceView("w1124456788 s4455", "tong"));
    const flushRoute = advice.find((item) => item.tile === tile("tiao", 5))!;
    expect(advice[0].tile).toBe(tile("wan", 2));
    expect(advice[0].shanten).toBe(1);
    expect(flushRoute.shanten).toBe(2);
    expect(flushRoute.potential).toContain("清一色");
    expect(flushRoute.potential).toContain("3 张条牌");
    expect(flushRoute.reason).toContain(flushRoute.potential);
  });

  it("缺门牌必须先清时解释规则，并如实说明并列推荐", () => {
    const advice = recommendDiscards(adviceView("w1223779 d2346778", "wan"));
    expect(advice[0].summary).toContain("定缺万");
    expect(advice[0].summary).toContain("先打完");
    expect(advice[0].summary).toContain("并列");
    expect(advice[1].summary).toContain("同样可作备选");
  });

  it("同样听牌时解释为什么推荐进张更多的九万", () => {
    const view = adviceView("w11123429 s345678", "tong");
    view.legalDiscards = [tile("wan", 2), tile("wan", 9)];
    const advice = recommendDiscards(view);
    expect(advice[0].tile).toBe(tile("wan", 9));
    expect(advice[0].effectiveTiles).toEqual([
      tile("wan", 2),
      tile("wan", 3),
      tile("wan", 5),
    ]);
    expect(advice[0].effectiveCount).toBe(9);
    expect(advice[1].effectiveCount).toBe(3);
    expect(advice[0].summary).toContain("更多进张");
    expect(advice[0].summary).toContain("9");
    expect(advice[0].summary).toContain("3");
  });

  it("已碰异色牌时不把同色手牌误称为清一色潜力", () => {
    const view = adviceView("s11223344556", "tong");
    view.melds = [{ type: "pung", tile: tile("wan", 9), from: 1 }];
    const advice = recommendDiscards(view);
    expect(advice.length).toBeGreaterThan(0);
    expect(advice.every((item) => item.potential !== "有清一色潜力")).toBe(
      true,
    );
    expect(advice.every((item) => !item.reason.includes("清一色"))).toBe(true);
  });

  it("已碰同色牌时仍可说明清一色潜力", () => {
    const view = adviceView("s11223344556", "tong");
    view.melds = [{ type: "pung", tile: tile("tiao", 9), from: 1 }];
    const advice = recommendDiscards(view);
    expect(advice.every((item) => item.potential === "有清一色潜力")).toBe(
      true,
    );
  });

  it("两组同色明碰后仍可识别清一色潜力", () => {
    const view = adviceView("s11223344", "tong");
    view.melds = [
      { type: "pung", tile: tile("tiao", 7), from: 1 },
      { type: "pung", tile: tile("tiao", 9), from: 2 },
    ];
    const advice = recommendDiscards(view);
    expect(advice.every((item) => item.potential === "有清一色潜力")).toBe(
      true,
    );
  });

  it("四张同牌可算七对中的两对，不漏报七对潜力", () => {
    const view = adviceView("w1111223356 s4478", "tong");
    const advice = recommendDiscards(view);
    expect(
      advice.find((item) => item.tile === tile("tiao", 8))?.potential,
    ).toBe("有七对潜力");
  });

  it("只有一种合法牌时说明这是规则限制", () => {
    const advice = recommendDiscards(adviceView("w1111 s123456789 d1", "wan"));
    expect(advice).toHaveLength(1);
    expect(advice[0].summary).toContain("只有这一种合法出牌");
  });

  it("缺门未清时备选原因也暂缓报告向听", () => {
    const view = adviceView("w1223779 d2346778", "wan");
    view.opponents[0].discards = [tile("wan", 1)];
    const advice = recommendDiscards(view);
    expect(advice[1].summary).not.toContain("向听");
    expect(advice[1].summary).toContain("缺门");
  });

  it("已听牌和已胡的估算向听分别为 0 与 -1", () => {
    expect(estimateShanten(hand("w1112349 s345678"), 0, "tong")).toBe(0);
    expect(estimateShanten(hand("w11123499 s345678"), 0, "tong")).toBe(-1);
  });

  it("只推荐合法牌，提供备选、牌效率、收益和风险依据", () => {
    let state = createGame(20260929);
    const exchange = state.players[0].hand
      .filter((item) => suitOf(item) === "tiao")
      .slice(0, 3);
    state = completeExchange(state, exchange);
    state = completeMissing(state, "wan");
    const view = playerView(state, 0);
    const advice = recommendDiscards(view);
    expect(advice.length).toBeGreaterThanOrEqual(2);
    expect(advice.every((item) => view.legalDiscards.includes(item.tile))).toBe(
      true,
    );
    expect(advice[0].tile).not.toBe(advice[1].tile);
    expect(advice[0].reason).toContain("向听");
    expect(advice[0].reason).toContain("进张");
    expect(advice[0].reason).toContain("风险");
    expect(advice[0].reason).toContain("缺门未清");
    expect(advice[0].limit).toContain("未考虑");
  });

  it("改变隐藏的电脑手牌与墙牌，不改变当时的建议", () => {
    let state = createGame(20260929);
    const exchange = state.players[0].hand
      .filter((item) => suitOf(item) === "tiao")
      .slice(0, 3);
    state = completeMissing(completeExchange(state, exchange), "wan");
    const original = recommendDiscards(playerView(state, 0));
    const hidden = structuredClone(state);
    hidden.players[1].hand.reverse();
    hidden.wall.reverse();
    expect(recommendDiscards(playerView(hidden, 0))).toEqual(original);
  });
});
