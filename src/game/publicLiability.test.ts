import { describe, expect, it } from "vitest";
import reference from "./fixtures/public-liability-reference-v1.json";
import { liabilityFeatures } from "./publicLiabilityFeatures";
import {
  discardBonusFans,
  discardLiability,
  predictFeatureLiability,
  predictPublicLiability,
} from "./publicLiability";
import type { PlayerView } from "./view";

function view(): PlayerView {
  const hand = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13];
  return {
    seat: 0,
    hand,
    melds: [],
    missing: "tong",
    legalDiscards: [...new Set(hand)],
    ownDiscards: [],
    wallRemaining: 55,
    opponents: ["tiao", "wan", "tong"].map((missing, i) => ({
      seat: i + 1,
      handCount: 13,
      missing: missing as "tiao" | "wan" | "tong",
      melds: [],
      discards: [],
      won: false,
      score: 0,
    })),
    publicTiles: [],
    publicActions: [],
    decision: {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [],
    },
  };
}
describe("固定公开基础赔付模型", () => {
  it("保持原模型特征顺序和Python参考概率，不接收暗手输入", () => {
    for (const r of reference.rows) {
      const actual = predictFeatureLiability(r.features, r.forcedZero);
      r.probabilities.forEach((p, i) =>
        expect(actual.probabilities[i]).toBeCloseTo(p, 12),
      );
      expect(actual.expectedBasePayment).toBeCloseTo(r.expectedBasePayment, 12);
    }
    const a = view(),
      b = Object.assign(structuredClone(a), { realWall: [12], seed: 123 });
    Object.assign(b.opponents[1], { hand: [12] });
    const before = structuredClone(a);
    expect(liabilityFeatures(a, 12, 2).values).toHaveLength(32);
    expect(predictPublicLiability(a, 12, 2).legalHuProbability).toBeGreaterThan(
      0,
    );
    expect(predictPublicLiability(a, 12, 2)).toEqual(
      predictPublicLiability(b, 12, 2),
    );
    expect(a).toEqual(before);
  });
  it("缺门、已胡和四张全明的单张手确定为零；旧弃牌不能证明安全", () => {
    const a = view();
    expect(predictPublicLiability(a, 12, 1).forcedZero).toBe(true);
    a.opponents[1].won = true;
    expect(predictPublicLiability(a, 12, 2).probabilities).toEqual([
      1, 0, 0, 0, 0,
    ]);
    const single = view();
    single.hand = [13, 13, 13, 13, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11];
    single.legalDiscards = [...new Set(single.hand)];
    single.opponents[1].handCount = 1;
    single.opponents[1].melds = [15, 16, 17, 18].map((tile) => ({
      type: "pung",
      tile,
      from: 3,
    }));
    expect(predictPublicLiability(single, 13, 2).forcedZero).toBe(true);
    const old = view();
    old.opponents[1].discards.push(12);
    old.publicTiles!.push({ seat: 2, tile: 12, kind: "discard" });
    old.publicActions!.push({ seat: 2, tile: 12, kind: "discard" });
    expect(predictPublicLiability(old, 12, 2).forcedZero).toBe(false);
    expect(() => predictFeatureLiability([NaN], false)).toThrow();
  });
  it("只有紧邻本家实际摸牌的公开杠与最后墙能加番，碰后不沿用旧标记", () => {
    const a = view();
    a.wallRemaining = 0;
    expect(discardBonusFans(a)).toBe(0);
    a.publicActions = [
      { seat: 0, kind: "kong", tile: 0, kongKind: "concealed", from: null },
      { seat: 0, kind: "draw" },
    ];
    expect(discardBonusFans(a)).toBe(2);
    a.publicActions.push({ seat: 0, kind: "pung", tile: 1, from: 1 });
    expect(discardBonusFans(a)).toBe(0);
    a.publicActions = [
      { seat: 0, kind: "added-kong-offer", tile: 0 },
      { seat: 0, kind: "draw" },
    ];
    a.wallRemaining = 1;
    expect(discardBonusFans(a)).toBe(1);
  });
  it("对多家潜在赔付用期望求和，加番逐类封顶而不把各家事件当独立", () => {
    const a = view(),
      b = structuredClone(a);
    b.wallRemaining = 0;
    b.publicActions = [
      { seat: 0, kind: "kong", tile: 0, kongKind: "concealed", from: null },
      { seat: 0, kind: "draw" },
    ];
    const ordinary = discardLiability(a, 12),
      bonus = discardLiability(b, 12);
    expect(ordinary.opponents).toHaveLength(3);
    expect(ordinary.expectedPayment).toBeGreaterThan(0);
    expect(ordinary.expectedPayment).toBeCloseTo(
      ordinary.opponents.reduce((n, p) => n + p.expectedPayment, 0),
      12,
    );
    expect(bonus.bonusFans).toBe(2);
    for (const p of bonus.opponents) {
      expect(p.expectedPayment).toBeGreaterThanOrEqual(p.expectedBasePayment);
      expect(p.expectedPayment).toBeLessThanOrEqual(8);
    }
    expect(discardLiability(b, 12).expectedPayment).toBe(bonus.expectedPayment);
  });
});
