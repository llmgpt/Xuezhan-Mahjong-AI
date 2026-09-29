import { describe, expect, it } from "vitest";
import { isWinningHand, isBloodBattleOver } from "./rules";
import { tile, type Tile } from "./tiles";

function hand(groups: string): Tile[] {
  return groups.split(" ").flatMap((group) => {
    const suit = { w: "wan", s: "tiao", d: "tong" }[group[0]] as
      "wan" | "tiao" | "tong";
    return [...group.slice(1)].map((rank) => tile(suit, Number(rank)));
  });
}

describe("胡牌结构", () => {
  it("四面子一对且缺门为空可胡", () => {
    expect(isWinningHand(hand("w11123499 s345678"), "tong")).toBe(true);
    expect(isWinningHand(hand("w11123499 s345678"), "wan")).toBe(false);
  });

  it("七对可胡，含缺门牌与不完整牌型不可胡", () => {
    expect(isWinningHand(hand("w11223344556677"), "tong")).toBe(true);
    expect(isWinningHand(hand("w11223344556677"), "wan")).toBe(false);
    expect(isWinningHand(hand("w11123498 s345678"), "tong")).toBe(false);
  });
});

describe("血战结束", () => {
  it("三人胡牌，或墙尽且弃牌响应完成才结束", () => {
    expect(isBloodBattleOver([true, true, true, false], 10, false)).toBe(true);
    expect(isBloodBattleOver([true, false, false, false], 10, false)).toBe(
      false,
    );
    expect(isBloodBattleOver([true, false, false, false], 0, true)).toBe(false);
    expect(isBloodBattleOver([true, false, false, false], 0, false)).toBe(true);
  });
});
