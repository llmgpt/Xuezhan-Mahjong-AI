import { describe, expect, it } from "vitest";
import { analyzeNextDraw } from "./lookahead";
import { hand } from "./testHelpers";
import { tile } from "./tiles";
import type { PlayerView } from "./view";

function view(): PlayerView {
  return {
    seat: 0,
    hand: hand("w11123429 s345678"),
    melds: [],
    missing: "tong",
    legalDiscards: [tile("wan", 2), tile("wan", 9)],
    ownDiscards: [],
    opponents: [1, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      melds: [],
      discards: [],
      missing: "tong" as const,
      won: false,
      score: 0,
    })),
    wallRemaining: 55,
  };
}

describe("行动时可见信息的两摸前瞻", () => {
  it("比较两张出牌下一摸可直接成胡的未见张数", () => {
    const result = analyzeNextDraw(view(), [tile("wan", 9), tile("wan", 2)]);
    expect(result.map((item) => item.winningDraws)).toEqual([9, 3]);
    expect(result[0].drawsConsidered).toBe(94);
    expect(result[0].twoDrawWinChance).toBeGreaterThan(
      result[0].winningDraws / result[0].drawsConsidered,
    );
    expect(result[0].twoDrawWinChance).toBeGreaterThan(
      result[1].twoDrawWinChance,
    );
  });

  it("已打出的进张不会再被算作可摸到的牌", () => {
    const current = view();
    current.opponents[0].discards = [tile("wan", 3), tile("wan", 3)];
    current.wallRemaining = 53;
    const result = analyzeNextDraw(current, [tile("wan", 9)]);
    expect(result[0].winningDraws).toBe(7);
    expect(result[0].drawsConsidered).toBe(92);
  });

  it("可以识别一摸不成胡、两摸后可能成胡的延续", () => {
    const current = view();
    current.hand = hand("w111234559 s34569");
    current.legalDiscards = [tile("tiao", 9)];
    const result = analyzeNextDraw(current, [tile("tiao", 9)]);
    expect(result[0].winningDraws).toBe(0);
    expect(result[0].twoDrawWinChance).toBeGreaterThan(0);
  });

  it("清缺门阶段和非法候选都不作前瞻比较", () => {
    const current = view();
    current.missing = "wan";
    expect(analyzeNextDraw(current, [tile("wan", 9)])).toEqual([]);
    expect(analyzeNextDraw(view(), [tile("tiao", 1)])).toEqual([]);
    const nearEnd = view();
    nearEnd.wallRemaining = 1;
    expect(analyzeNextDraw(nearEnd, [tile("wan", 9)])).toEqual([]);
  });
});
