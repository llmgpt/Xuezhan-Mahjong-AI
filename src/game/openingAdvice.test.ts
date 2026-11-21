import { describe, expect, it } from "vitest";
import { createGame } from "./game";
import { chooseStructureExchange } from "./openingAdvice";
import { suitOf, tile, type Suit, type Tile } from "./tiles";

function hand(spec: string): Tile[] {
  const names: Record<string, Suit> = { w: "wan", s: "tiao", d: "tong" };
  return spec
    .split(" ")
    .filter(Boolean)
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

  it("有 3 张可清门且其余两门已成顺时，优先清掉 3 张门而非拆 5 张门顺子", () => {
    expect(chooseStructureExchange(hand("w12379 s123456 d123"))).toEqual(
      hand("d123"),
    );
  });

  it("同门超过三张且需从该门换牌时，选择破坏结构较少且不送连张的组合", () => {
    expect(chooseStructureExchange(hand("w12379 s1234567 d12"))).toEqual(
      hand("w179"),
    );
  });

  it("种子 777 不拆 6 张筒主门完整 789筒，改换 4 张条门留 1 张废牌并保住 456万", () => {
    const tiles = chooseStructureExchange(createGame(777).players[0].hand);
    expect(suitOf(tiles[0])).toBe("tiao");
    expect(tiles).toEqual(hand("s135"));
  });

  it("种子 108 换 4 张条门时选 1条、2条、4条，不整对送出 11条", () => {
    const tiles = chooseStructureExchange(createGame(108).players[0].hand);
    expect(tiles).toEqual(hand("s124"));
    expect(chooseStructureExchange(hand("s1124"))).toEqual(hand("s124"));
  });

  it("五张同门含对子时保留对子，优先换出其余三张散牌", () => {
    expect(chooseStructureExchange(hand("s11247"))).toEqual(hand("s247"));
  });

  it("主门张数占优有清一色倾向时，清掉 3 张副门而不拆主门", () => {
    expect(chooseStructureExchange(hand("w112345679 s48 d269"))).toEqual(
      hand("d269"),
    );
  });

  it("不依赖输入顺序、不修改手牌，始终返回同门三张", () => {
    const tiles = hand("w123456 s269 d12345");
    const reversed = [...tiles].reverse();
    expect(chooseStructureExchange(reversed)).toEqual(hand("s269"));
    expect(reversed).toEqual([...tiles].reverse());
  });
});
