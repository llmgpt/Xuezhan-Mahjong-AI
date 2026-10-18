import { describe, expect, it } from "vitest";
import { estimateShanten, publicCounts } from "./advice";
import {
  analyzeCandidateDraws,
  candidatePublicCounts,
  estimateCandidateShanten,
  normalDrawBudget,
} from "./candidateEvaluation";
import { evaluateWin, waitingTiles, type Meld } from "./scoring";
import { hand } from "./testHelpers";
import { analyzeScoredDraws } from "./teacherEvaluation";
import { tile } from "./tiles";
import type { PlayerView } from "./view";

function viewFor(notation = "w11123429 s345678"): PlayerView {
  const owned = hand(notation);
  return {
    seat: 0,
    hand: owned,
    melds: [],
    missing: "tong",
    legalDiscards: [...new Set(owned)],
    ownDiscards: [],
    opponents: [1, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      melds: [],
      discards: [],
      missing: "tong",
      won: false,
      score: 0,
    })),
    wallRemaining: 40,
  };
}

const threePungs: Meld[] = hand("w234").map((tile) => ({
  type: "pung",
  tile,
  from: 1,
}));

describe("候选合法等待校验", () => {
  it("三副露加1111万不是真听牌，不能把第五张1万作为等待", () => {
    const owned = hand("w1111");
    expect(estimateShanten(owned, 3, "tong")).toBe(0);
    expect(waitingTiles(owned, threePungs, "tong").tiles).toEqual([]);
    expect(estimateCandidateShanten(owned, threePungs, "tong")).toBe(1);
  });

  it("14张结构只有非法五张同牌延续时，不能继续报零向听", () => {
    const melds: Meld[] = [
      threePungs[0],
      { ...threePungs[1], type: "kong", kongKind: "concealed", from: null },
      threePungs[2],
    ];
    const owned = hand("w11112");
    expect(estimateShanten(owned, melds.length, "tong")).toBe(0);
    expect(evaluateWin(owned, melds, "tong")).toBeNull();
    for (const chosen of new Set(owned)) {
      const after = [...owned];
      after.splice(after.indexOf(chosen), 1);
      expect(waitingTiles(after, melds, "tong").tiles).toEqual([]);
    }
    expect(estimateCandidateShanten(owned, melds, "tong")).toBe(1);
  });

  it("14张有一个合法弃牌能听时仍为零向听，四张同牌也可合法算七对两对", () => {
    expect(estimateCandidateShanten(hand("w11112"), threePungs, "tong")).toBe(
      0,
    );
    expect(estimateCandidateShanten(hand("w1111223344556"), [], "tong")).toBe(
      0,
    );
    expect(estimateCandidateShanten(hand("w11112233445566"), [], "tong")).toBe(
      -1,
    );
  });
});

describe("无碰杠轮转假设下的有限摸牌模型", () => {
  it("当前弃牌后按存活人数估计正常轮转的本家摸牌预算", () => {
    const view = viewFor();
    const budgets = [0, 1, 2, 3, 4, 7, 8, 20].map((remaining) => {
      view.wallRemaining = remaining;
      return normalDrawBudget(view);
    });
    expect(budgets).toEqual([0, 0, 0, 0, 1, 1, 2, 2]);
    view.opponents[0].won = true;
    view.opponents[1].won = true;
    view.wallRemaining = 2;
    expect(normalDrawBudget(view)).toBe(1);
  });

  it("墙余一张时轮转模型不虚构本家一摸收入，未声称碰牌跳转后也不可能摸牌", () => {
    const view = viewFor();
    view.wallRemaining = 1;
    const chosen = tile("wan", 9);
    const old = analyzeScoredDraws(view, [chosen])[0];
    expect(old.oneDrawValue).toBeGreaterThan(0);
    expect(analyzeCandidateDraws(view, [chosen])).toEqual([
      { tile: chosen, normalDraws: 0, winChance: 0, value: 0 },
    ]);
  });

  it("四家存活且余四张时使用一摸值，不把两摸模型当成实际可用轮数", () => {
    const view = viewFor();
    view.wallRemaining = 4;
    const chosen = tile("wan", 9);
    const old = analyzeScoredDraws(view, [chosen])[0];
    const current = analyzeCandidateDraws(view, [chosen])[0];
    expect(current.normalDraws).toBe(1);
    expect(current.value).toBeCloseTo(old.oneDrawValue);
    expect(current.winChance).toBeCloseTo(old.oneDrawWinChance);
    expect(current.value).toBeLessThan(old.twoDrawValue);
  });

  it("已公开的对手自摸胡张算可见牌，既不漏计也不重复计本家手牌", () => {
    const view = viewFor();
    view.publicTiles = [
      { seat: 1, tile: tile("wan", 2), kind: "self-win" },
      { seat: 0, tile: tile("wan", 1), kind: "self-win" },
      { seat: 1, tile: tile("wan", 9), kind: "discard" },
    ];
    view.opponents[0].won = true;
    const before = structuredClone(view);
    const old = publicCounts(view);
    const counts = candidatePublicCounts(view);
    expect(counts[tile("wan", 2)]).toBe(old[tile("wan", 2)] + 1);
    expect(counts[tile("wan", 1)]).toBe(old[tile("wan", 1)]);
    expect(counts[tile("wan", 9)]).toBe(old[tile("wan", 9)]);
    view.wallRemaining = 3;
    const estimate = analyzeCandidateDraws(view, [tile("wan", 9)])[0];
    expect(estimate.value).toBeCloseTo((8 / 93) * 2 * 2);
    expect(view.publicTiles).toEqual(before.publicTiles);
    expect(view.opponents).toEqual(before.opponents);
  });
});
