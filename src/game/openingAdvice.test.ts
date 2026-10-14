import { describe, expect, it } from "vitest";
import { chooseStructureExchange } from "./openingAdvice";
import { tile, type Suit, type Tile } from "./tiles";

function hand(spec: string): Tile[] {
  const names: Record<string, Suit> = { w: "wan", s: "tiao", d: "tong" };
  return spec
    .split(" ")
    .flatMap((part) =>
      [...part.slice(1)].map((rank) => tile(names[part[0]], Number(rank))),
    );
}

describe("结构保留换三张候选", () => {
  it("换出另一门的三张孤张，保留万和筒的连续搭子", () => {
    expect(chooseStructureExchange(hand("w123456 s269 d12345"))).toEqual(
      hand("s269"),
    );
  });

  it("同门超过三张时，选择破坏联系较少的组合", () => {
    expect(chooseStructureExchange(hand("w12379 s123456 d123"))).toEqual(
      hand("w179"),
    );
  });

  it("不依赖输入顺序、不修改手牌，始终返回同门三张", () => {
    const tiles = hand("w123456 s269 d12345");
    const reversed = [...tiles].reverse();
    expect(chooseStructureExchange(reversed)).toEqual(hand("s269"));
    expect(reversed).toEqual([...tiles].reverse());
  });
});
