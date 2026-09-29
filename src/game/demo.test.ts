import { describe, expect, it } from "vitest";
import { chooseBotDiscard, chooseBotExchange, chooseBotMissing } from "./bot";
import { tile } from "./tiles";

describe("固定电脑策略", () => {
  it("仅根据自己的手牌或合法出牌集合做确定性选择", () => {
    const hand = [
      tile("wan", 1),
      tile("wan", 2),
      tile("wan", 3),
      tile("tiao", 1),
      tile("tiao", 2),
      tile("tong", 9),
    ];
    expect(chooseBotExchange(hand)).toEqual(hand.slice(0, 3));
    expect(chooseBotMissing(hand)).toBe("tong");
    expect(chooseBotDiscard([tile("tiao", 8), tile("wan", 2)])).toBe(
      tile("tiao", 8),
    );
  });
});
