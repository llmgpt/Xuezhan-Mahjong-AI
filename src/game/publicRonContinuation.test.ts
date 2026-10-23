import { describe, expect, it } from "vitest";
import { analyzePublicRonContinuation } from "./publicRonContinuation";
import { PublicSamplingError, samplePublicRonParticles } from "./publicSampler";
import { publicRonContext } from "./publicSampler";
import type { ContinuationResult } from "./sampledContinuation";
import { hand } from "./testHelpers";
import type { PlayerView } from "./view";

function view(): PlayerView {
  return {
    seat: 1,
    hand: hand("w1112233445566"),
    melds: [],
    missing: "tong",
    legalDiscards: [],
    ownDiscards: [],
    opponents: [0, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      melds: [],
      discards: seat === 0 ? [0] : [],
      missing: seat === 0 ? "tiao" : "tong",
      won: false,
      score: 0,
    })),
    wallRemaining: 55,
    publicTiles: [{ seat: 0, tile: 0, kind: "discard" }],
    publicActions: [{ seat: 0, kind: "discard", tile: 0 }],
    decision: {
      kind: "respond",
      responseKind: "discard",
      from: 0,
      tile: 0,
      choices: ["pass", "hu", "pung", "kong"],
    },
  };
}
function result(value: number): ContinuationResult {
  return {
    scores: [-value, value, 0, 0],
    scoreDifferences: [-value, value, 0, 0],
    transfers: [],
    steps: 1,
    endReason: "wall",
  };
}

describe("点胡与拒胡路径的净分模型", () => {
  it("当前胡为确定实收，完整比较过/碰/杠；不重复模拟胡或当前旧积分", () => {
    const input = view(),
      before = structuredClone(input);
    const samples = samplePublicRonParticles(input, 4);
    const values = {
      pass: [-5, -1, 1, 5],
      pung: [9, 10, 11, 10],
      kong: [16, 0, 12, 4],
    };
    const counts = { pass: 0, pung: 0, kong: 0 };
    const report = analyzePublicRonContinuation(input, "respond", {
      samples: 4,
      sample: () => structuredClone(samples),
      continueGame: (publicView, particle, action) => {
        expect(action.type).toBe("respond");
        if (action.type !== "respond" || action.choice === "hu")
          throw new Error("不能模拟确定胡收入");
        expect(publicView).toEqual(input);
        const choice = action.choice,
          index = counts[choice]++;
        expect(particle).toEqual(samples.particles[index]);
        // A hostile JS callback can ignore the readonly type contract.
        (particle.hands[0] as number[])[0] = 26;
        publicView.hand[0] = 26;
        return result(values[choice][index]);
      },
    });
    expect(report.status).toBe("complete");
    expect(report.currentIncome).toBe(8);
    expect(counts).toEqual({ pass: 4, pung: 4, kong: 4 });
    const estimates = report.estimates!;
    expect(estimates.map((e) => e.choice)).toEqual([
      "pass",
      "hu",
      "pung",
      "kong",
    ]);
    expect(estimates.find((e) => e.choice === "hu")).toMatchObject({
      futureNets: [8, 8, 8, 8],
      meanFutureNet: 8,
      advantageOverHu: 0,
      modelStandardError: 0,
      simulatedTransitions: 0,
    });
    expect(estimates.find((e) => e.choice === "pass")).toMatchObject({
      meanFutureNet: 0,
      advantageOverHu: -8,
      simulatedTransitions: 4,
    });
    expect(
      estimates.find((e) => e.choice === "pass")!.modelStandardError,
    ).toBeCloseTo(Math.sqrt(52 / 12));
    expect(estimates.find((e) => e.choice === "pung")!.advantageOverHu).toBe(2);
    expect(input).toEqual(before);
  });

  it("真实公开粒子所有非胡分支完整结算，当前胡只作为常数", () => {
    const input = view();
    const report = analyzePublicRonContinuation(input, "respond", {
      samples: 2,
    });
    expect(report.status).toBe("complete");
    expect(report.currentIncome).toBe(publicRonContext(input).currentIncome);
    expect(report.estimates).toHaveLength(4);
    for (const estimate of report.estimates!) {
      expect(estimate.futureNets).toHaveLength(2);
      expect(estimate.futureNets.every(Number.isFinite)).toBe(true);
      if (estimate.choice !== "hu")
        expect(estimate.simulatedTransitions).toBeGreaterThan(0);
    }
  }, 30000);

  it("一粒子不伪造拒胡标准误；选定模型与局限随报告给出", () => {
    const report = analyzePublicRonContinuation(view(), "respond", {
      samples: 1,
      continueGame: () => result(5),
    });
    expect(report.status).toBe("complete");
    expect(
      report
        .estimates!.filter((e) => e.choice !== "hu")
        .every((e) => e.modelStandardError === null),
    ).toBe(true);
    expect(report.assumptions.join(" ")).toMatch(/原老师/);
    expect(report.assumptions.join(" ")).toMatch(/有偏|非均匀/);
    expect(report.assumptions.join(" ")).toMatch(/真实|最优/);
  });

  it("完整粒子不可凑数；采样耗尽明确不可用，续局错误不得按部分样本成功", () => {
    const input = view(),
      sampled = samplePublicRonParticles(input, 1);
    expect(() =>
      analyzePublicRonContinuation(input, "respond", {
        samples: 2,
        sample: () => sampled,
      }),
    ).toThrow(/数量|完整/);
    const unavailable = analyzePublicRonContinuation(input, "respond", {
      sample: () => {
        throw new PublicSamplingError("unsatisfiable", "budget");
      },
    });
    expect(unavailable).toMatchObject({
      status: "unavailable",
      samples: 0,
      failureReason: "budget",
    });
    expect(() =>
      analyzePublicRonContinuation(input, "respond", {
        samples: 1,
        continueGame: () => {
          throw new Error("step-budget");
        },
      }),
    ).toThrow("step-budget");
    expect(() =>
      analyzePublicRonContinuation(input, "respond", {
        samples: 1,
        continueGame: () => result(NaN),
      }),
    ).toThrow(/净分|无效/);
    expect(() =>
      analyzePublicRonContinuation(input, "respond", {
        samples: 1,
        continueGame: () => ({ ...result(1), endReason: undefined }),
      }),
    ).toThrow(/完整|结算/);
  });

  it("只有合法普通点胡适用，抢杠与self不触发模型，拒绝非法预算", () => {
    for (const samples of [0, -1, 65, 1.5])
      expect(() =>
        analyzePublicRonContinuation(view(), "respond", { samples }),
      ).toThrow(/样本|粒子/);
    const input = view();
    if (input.decision?.kind === "respond")
      input.decision.responseKind = "rob-kong";
    expect(analyzePublicRonContinuation(input, "respond").status).toBe(
      "not-applicable",
    );
    expect(analyzePublicRonContinuation(view(), "discard").status).toBe(
      "not-applicable",
    );
    expect(() =>
      analyzePublicRonContinuation(
        { ...view(), seed: 80000 } as PlayerView,
        "respond",
      ),
    ).toThrow(/隐藏|字段/);
  });
});
