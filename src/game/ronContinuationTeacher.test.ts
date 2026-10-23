import { describe, expect, it } from "vitest";
import { evaluateRonContinuationDecision } from "./ronContinuationTeacher";
import { PublicSamplingError, publicRonContext } from "./publicSampler";
import type { ContinuationResult } from "./sampledContinuation";
import type { PlayerView } from "./view";
import boundaries from "./fixtures/public-ron-v1.json";

const view = boundaries.cases[0].context.view as PlayerView;
const current = publicRonContext(view).currentIncome;
const outcome = (value: number): ContinuationResult => {
  const deltas = Array.from({ length: 4 }, (_, s) =>
    s === view.seat ? value : s === (view.seat + 1) % 4 ? -value : 0,
  );
  return {
    scores: deltas,
    scoreDifferences: deltas,
    transfers: [],
    steps: 1,
    endReason: "wall",
  };
};

describe("普通点胡续局候选选择与理由", () => {
  it("只有保守模型净值严格超过当前实收才拒胡，原因显示实际计算", () => {
    const report = evaluateRonContinuationDecision(view, "respond", {
      samples: 4,
      continueGame: (_v, _p, action) =>
        outcome(
          current +
            (action.type === "respond" && action.choice === "pass" ? 4 : 1),
        ),
    });
    expect(report.status).toBe("sampled");
    expect(report.choices[0].action).toEqual({
      type: "respond",
      choice: "pass",
    });
    expect(report.baselineKey).toBe("respond:hu");
    expect(
      report.candidates?.find((c) => c.key === "respond:hu"),
    ).toMatchObject({
      meanFutureNet: current,
      pairedGain: 0,
      pairedStandardError: 0,
    });
    expect(report.choices[0].reason).toContain("2");
    expect(report.choices[0].reason).toContain(current.toFixed(2));
    expect(report.choices[0].limit).toMatch(/原老师/);
    expect(report.choices[0].limit).toMatch(/模型偏差|有偏/);
    expect(report.assumptions?.join(" ")).toMatch(/确定|常数/);
  });

  it("高均值但高波动、并列或一粒子未知波动都保留当前胡", () => {
    let calls = 0;
    const noisy = evaluateRonContinuationDecision(view, "respond", {
      samples: 4,
      continueGame: () => outcome(current + (calls++ % 2 === 0 ? 100 : -96)),
    });
    expect(noisy.candidates?.some((c) => c.pairedGain > 0)).toBe(true);
    expect(noisy.choices[0].action).toEqual({ type: "respond", choice: "hu" });
    for (const samples of [1, 4]) {
      const tie = evaluateRonContinuationDecision(view, "respond", {
        samples,
        continueGame: () => outcome(current + (samples === 1 ? 100 : 0)),
      });
      expect(tie.choices[0].action).toEqual({ type: "respond", choice: "hu" });
    }
  });

  it("联合采样不可用时明示0样本并接受合法实收，不伪造成功比较", () => {
    const report = evaluateRonContinuationDecision(view, "respond", {
      sample: () => {
        throw new PublicSamplingError("unsatisfiable", "joint-budget");
      },
    });
    expect(report).toMatchObject({
      status: "fallback",
      samples: 0,
      fallbackReason: "joint-budget",
    });
    expect(report.choices[0].action).toEqual({ type: "respond", choice: "hu" });
    expect(report.choices[0].reason).toMatch(/未.*续局|没有.*续局/);
    expect(evaluateRonContinuationDecision(view, "discard").status).toBe(
      "not-applicable",
    );
  });
});
