import { describe, expect, it } from "vitest";
import { estimateShanten, recommendDiscards } from "./advice";
import { chooseBotExchange } from "./bot";
import { completeExchange, completeMissing } from "./demo";
import { createGame } from "./game";
import { hand } from "./testHelpers";
import { suitOf } from "./tiles";
import { playerView } from "./view";

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
