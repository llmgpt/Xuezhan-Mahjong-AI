import { describe, expect, it } from "vitest";
import { pairedSummary, seatClusterSummary } from "./evaluationStats";

describe("成对牌局统计", () => {
  it("按同一种子的各座位先求均值，再估计跨种子波动", () => {
    const summary = seatClusterSummary([
      [2, 0],
      [0, 2],
    ]);
    expect(summary).toEqual({
      meanScoreDifference: 1,
      standardError: 0,
      betterSeedFraction: 1,
    });
  });

  it("单个种子不声称有可估计的标准误", () => {
    expect(pairedSummary([3])).toEqual({
      meanScoreDifference: 3,
      standardError: null,
      betterSeedFraction: 1,
    });
  });
});
