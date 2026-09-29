import { describe, expect, it } from "vitest";
import { createWall, deal, shuffle, suitOf, tile } from "./tiles";

describe("108 张牌与发牌", () => {
  it("每种序数牌恰好四张，庄 14 闲 13，墙余 55", () => {
    const wall = createWall();
    expect(wall).toHaveLength(108);
    for (let id = 0; id < 27; id += 1) {
      expect(wall.filter((item) => item === id)).toHaveLength(4);
    }
    expect(suitOf(tile("wan", 9))).toBe("wan");
    const dealt = deal(shuffle(wall, 31415));
    expect(dealt.hands.map((hand) => hand.length)).toEqual([14, 13, 13, 13]);
    expect(dealt.wall).toHaveLength(55);
    expect(
      [...dealt.hands.flat(), ...dealt.wall].sort((a, b) => a - b),
    ).toEqual([...wall].sort((a, b) => a - b));
  });

  it("相同种子重现洗牌，不同种子改变顺序", () => {
    const wall = createWall();
    expect(shuffle(wall, 7)).toEqual(shuffle(wall, 7));
    expect(shuffle(wall, 7)).not.toEqual(shuffle(wall, 8));
  });
});
