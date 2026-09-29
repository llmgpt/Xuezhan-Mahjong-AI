import { describe, expect, it } from "vitest";
import { evaluateWin, waitingTiles } from "./scoring";
import { hand } from "./testHelpers";

describe("V1 番型", () => {
  it("平胡按 0 番 1 分，清一色对对胡按 3 番封顶", () => {
    const plain = evaluateWin(hand("w11123499 s345678"), [], "tong");
    expect(plain?.fan).toBe(0);
    expect(plain?.points).toBe(1);

    const triplets = evaluateWin(hand("w11122233344455"), [], "tong");
    expect(triplets?.patterns).toContain("对对胡");
    expect(triplets?.patterns).toContain("清一色");
    expect(triplets?.points).toBe(8);
  });

  it("七对含四张同牌可算两对和一根，不重复算对对胡", () => {
    const result = evaluateWin(hand("w11112233445566"), [], "tong");
    expect(result?.patterns).toContain("七对");
    expect(result?.patterns).toContain("根");
    expect(result?.patterns).not.toContain("对对胡");
    expect(result?.points).toBe(8);
  });

  it("缺门牌存在时不得胡，杠后补牌可计杠上花", () => {
    expect(evaluateWin(hand("w11123499 s345678"), [], "wan")).toBeNull();
    const result = evaluateWin(hand("w11123499 s345678"), [], "tong", {
      kongFlower: true,
    });
    expect(result?.patterns).toContain("杠上花");
    expect(result?.points).toBe(2);
  });
});

describe("查叫基础", () => {
  it("返回全部理论等待牌与其中最高的封顶牌型分", () => {
    const result = waitingTiles(hand("w1112349 s345678"), [], "tong");
    expect(result.tiles).toContain(hand("w9")[0]);
    expect(result.maxPoints).toBeGreaterThanOrEqual(1);
    expect(waitingTiles(hand("w123456789 s1234"), [], "wan").tiles).toEqual([]);
  });
});
