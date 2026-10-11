import { describe, expect, it } from "vitest";
import { newGameSeed } from "./newGameSeed";

describe("新牌局种子", () => {
  it("随机重开即使抽中当前种子也会换成另一局", () => {
    expect(newGameSeed(42, 42)).toBe(43);
    expect(newGameSeed(0xffffffff, 0xffffffff)).toBe(0);
  });

  it("新种子在 32 位范围内，仍可通过种子复现", () => {
    expect(newGameSeed(undefined, 20260929)).toBe(20260929);
    expect(newGameSeed(42, 123456)).toBe(123456);
  });
});
