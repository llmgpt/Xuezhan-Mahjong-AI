import { describe, expect, it } from "vitest";
import {
  evaluateLiabilityDiscard,
  selectLiabilityCandidate,
  type LiabilityCandidate,
} from "./liabilityDiscard";
import type { PlayerView } from "./view";

const candidate = (
  tile: number,
  fields: Partial<LiabilityCandidate> = {},
): LiabilityCandidate => ({
  tile,
  shanten: 1,
  effectiveCount: 8,
  terminalCallPoints: 0,
  attackValue: 0.2,
  expectedPayment: 0.3,
  ...fields,
});
function view(): PlayerView {
  const hand = [0, 0, 0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13];
  return {
    seat: 0,
    hand,
    missing: "tong",
    melds: [],
    legalDiscards: [...new Set(hand)],
    ownDiscards: [],
    wallRemaining: 55,
    opponents: [1, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      missing: "tong",
      melds: [],
      discards: [],
      won: false,
      score: 0,
    })),
    publicActions: [],
    publicTiles: [],
    decision: {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [],
    },
  };
}
describe("受约束的预测赔付弃牌实验", () => {
  it("允许小额模型进攻损失换更大即时赔付降幅，拒绝破坏向听或有效进张", () => {
    const rows = [
      candidate(0),
      candidate(1, { attackValue: 0.18, expectedPayment: 0.05 }),
      candidate(2, { effectiveCount: 7, attackValue: 10, expectedPayment: 0 }),
      candidate(3, { shanten: 2, attackValue: 10, expectedPayment: 0 }),
    ];
    expect(selectLiabilityCandidate(rows, 0).tile).toBe(1);
    expect(rows[0].expectedPayment).toBe(0.3);
  });
  it("不能用不保留理论查叫收益的安全牌替代，模型并列沿用原选择", () => {
    const base = candidate(0, {
      shanten: 0,
      terminalCallPoints: 8,
      attackValue: 0,
      expectedPayment: 0.2,
    });
    const breaking = candidate(1, {
      shanten: 0,
      terminalCallPoints: 4,
      attackValue: 0,
      expectedPayment: 0,
    });
    expect(selectLiabilityCandidate([breaking, base], 0).tile).toBe(0);
    expect(selectLiabilityCandidate([candidate(1), candidate(0)], 0).tile).toBe(
      0,
    );
    expect(() => selectLiabilityCandidate([candidate(1)], 0)).toThrow();
    expect(() =>
      selectLiabilityCandidate([candidate(0, { expectedPayment: NaN })], 0),
    ).toThrow();
  });
  it("真实计算只用公开view；记录的收益、赔付、选择和说明一致且不改输入", () => {
    const a = view(),
      before = structuredClone(a),
      report = evaluateLiabilityDiscard(a, 13);
    expect(report).toBeDefined();
    if (!report) throw new Error("需要弃牌报告");
    expect(report.baselineTile).toBe(13);
    const selected = report.candidates.find(
      (c) => c.tile === report.selectedTile,
    )!;
    const baseline = report.candidates.find(
      (c) => c.tile === report.baselineTile,
    )!;
    expect(selected.shanten).toBe(baseline.shanten);
    expect(selected.effectiveCount).toBeGreaterThanOrEqual(
      baseline.effectiveCount,
    );
    expect(
      selected.attackValue - selected.expectedPayment,
    ).toBeGreaterThanOrEqual(
      baseline.attackValue - baseline.expectedPayment - 1e-12,
    );
    expect(report.choice.action).toEqual({
      type: "discard",
      tile: selected.tile,
    });
    expect(report.choice.reason).toContain(selected.expectedPayment.toFixed(4));
    expect(report.choice.limit).toMatch(/未来|近似|偏差/);
    expect(a).toEqual(before);
    const b = Object.assign(structuredClone(a), { realWall: [0] });
    Object.assign(b.opponents[0], { hand: [0] });
    expect(evaluateLiabilityDiscard(b, 13)).toEqual(report);
  });
  it("定缺未清、自摸及非自己弃牌节点不改，非法基准弃牌报错", () => {
    const a = view();
    expect(() => evaluateLiabilityDiscard(a, 26)).toThrow();
    a.missing = "wan";
    expect(evaluateLiabilityDiscard(a, 0)).toBeUndefined();
    const b = view();
    if (b.decision?.kind !== "self") throw new Error();
    b.decision.canWin = true;
    expect(evaluateLiabilityDiscard(b, 13)).toBeUndefined();
    const c = view();
    c.decision = undefined;
    expect(evaluateLiabilityDiscard(c, 13)).toBeUndefined();
  });
});
