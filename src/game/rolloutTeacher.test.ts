import { describe, expect, it } from "vitest";
import { actionKey } from "./actionAdvice";
import { applyDecisionAction } from "./decision";
import { createGame, draw } from "./game";
import { PublicSamplingError, type PublicParticle } from "./publicSampler";
import type { ContinuationResult } from "./sampledContinuation";
import { evaluateRolloutDecision } from "./rolloutTeacher";
import { teacherChoices } from "./teacher";
import { playerView } from "./view";

function fixture() {
  let state = createGame(80004);
  for (let step = 0; step < 3000; step++) {
    if (state.phase === "draw") {
      state = draw(state, state.turn);
      continue;
    }
    const actor =
      state.phase === "exchange"
        ? [0, 1, 2, 3].find((seat) => !state.players[seat].exchange)!
        : state.phase === "choose-missing"
          ? [0, 1, 2, 3].find((seat) => !state.players[seat].missing)!
          : state.phase === "respond"
            ? (state.pending!.eligible.find(
                (seat) => seat !== 1 && !state.pending!.answers[seat],
              ) ??
              state.pending!.eligible.find(
                (seat) => !state.pending!.answers[seat],
              )!)
            : state.turn;
    const view = playerView(state, actor);
    if (
      actor === 1 &&
      view.decision?.kind === "self" &&
      view.decision.concealedKongs.length
    )
      return { view, state };
    state = applyDecisionAction(
      state,
      actor,
      teacherChoices(view, state.phase)[0].action,
    );
  }
  throw new Error("no fixture");
}
const { view, state } = fixture();
const baseline = teacherChoices(view, "discard")[0].action;
const kong = {
  type: "kong",
  kind: "concealed",
  tile: view.decision!.kind === "self" ? view.decision!.concealedKongs[0] : -1,
} as const;
const particles: PublicParticle[] = [0, 1].map(() => ({
  hands: state.players.map((p) => [...p.hand]),
  wall: [...state.wall],
}));
function outcome(value: number): ContinuationResult {
  const scores = [0, value, 0, -value];
  return {
    scores,
    scoreDifferences: scores,
    transfers: [],
    steps: 1,
    endReason: "wall",
  };
}
const sample = () => ({
  particles: structuredClone(particles),
  assumptions: ["有偏的合成样本"],
});

describe("公开约束配对续局候选", () => {
  it("真实公开帧经受约束采样后，每个分支用V1引擎正常打到结算", () => {
    const report = evaluateRolloutDecision(view, "discard", { samples: 2 });
    expect(report.status).toBe("sampled");
    expect(report.candidates).toHaveLength(2);
    expect(
      report.candidates?.every((item) => item.futureNets.length === 2),
    ).toBe(true);
  }, 30000);
  it("同一批世界比较最终净分，不把当前杠钱当额外相对收益", () => {
    expect(baseline.type).toBe("discard");
    const seen: unknown[] = [];
    const report = evaluateRolloutDecision(view, "discard", {
      samples: 2,
      sample,
      continueGame: (_view, particle, action) => {
        seen.push({ action, particle: structuredClone(particle) });
        const index = seen.length % 2;
        return outcome(action.type === "kong" ? index + 5 : index + 6);
      },
    });
    expect(report.status).toBe("sampled");
    expect(report.choices[0].action).toEqual(baseline);
    expect(
      report.candidates?.find((item) => item.key === actionKey(kong))
        ?.pairedGain,
    ).toBe(-1);
    expect(
      report.candidates?.find((item) => item.key === actionKey(kong))
        ?.pairedStandardError,
    ).toBe(0);
    expect(seen).toHaveLength(4);
    expect(report.choices[0].reason).toContain("终局净分");
    expect(report.choices[0].limit).toContain("实战强度");
  });
  it("只有配对续局更高时才改变动作，解释展示实际样本数及相对旧选择的增量", () => {
    const report = evaluateRolloutDecision(view, "discard", {
      samples: 2,
      sample,
      continueGame: (_view, _particle, action) =>
        outcome(action.type === "kong" ? 3 : 1),
    });
    expect(report.choices[0].action).toEqual(kong);
    expect(report.choices[0].summary).toContain("2");
    expect(report.choices[0].reason).toContain("2.00");
    expect(
      report.candidates?.find((item) => item.key === actionKey(kong))
        ?.pairedGain,
    ).toBe(2);
  });
  it("估值并列保留旧选择；可明确要求最小模型增量", () => {
    const report = evaluateRolloutDecision(view, "discard", {
      samples: 2,
      sample,
      continueGame: () => outcome(2),
    });
    expect(report.choices[0].action).toEqual(baseline);
    const conservative = evaluateRolloutDecision(view, "discard", {
      samples: 2,
      sample,
      minimumGain: 3,
      continueGame: (_v, _p, action) => outcome(action.type === "kong" ? 3 : 1),
    });
    expect(conservative.choices[0].action).toEqual(baseline);
  });
  it("每个分支使用同一原始粒子的独立副本，不能污染下一分支或公开输入", () => {
    const before = structuredClone(view);
    const worlds: unknown[] = [];
    const report = evaluateRolloutDecision(view, "discard", {
      samples: 2,
      sample,
      continueGame: (input, particle) => {
        worlds.push(structuredClone(particle));
        (particle.wall as number[]).fill(0);
        input.hand.fill(0);
        return outcome(0);
      },
    });
    expect(report.status).toBe("sampled");
    expect(worlds[0]).toEqual(worlds[2]);
    expect(worlds[1]).toEqual(worlds[3]);
    expect(view).toEqual(before);
  });
  it("无杠、开局和可胡阶段沿用原规则，不运行无关采样", () => {
    const sampling = () => {
      throw new Error("must not sample");
    };
    const opening = playerView(createGame(80000), 0);
    expect(
      evaluateRolloutDecision(opening, "exchange", { sample: sampling }).status,
    ).toBe("not-applicable");
    const noKong = structuredClone(view);
    noKong.decision = {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [],
    };
    expect(
      evaluateRolloutDecision(noKong, "discard", { sample: sampling }).choices,
    ).toEqual(teacherChoices(noKong, "discard"));
    const win = structuredClone(view);
    win.decision = {
      kind: "self",
      canWin: true,
      concealedKongs: [],
      addedKongs: [],
    };
    expect(
      evaluateRolloutDecision(win, "discard", { sample: sampling }).status,
    ).toBe("not-applicable");
  });
  it("仅采样预算不可满足可明确回退；损坏历史、非法续局和少粒子直接失败", () => {
    const failure = evaluateRolloutDecision(view, "discard", {
      samples: 2,
      sample: () => {
        throw new PublicSamplingError("unsatisfiable", "模板预算耗尽");
      },
    });
    expect(failure.status).toBe("fallback");
    expect(failure.choices[0].action).toEqual(baseline);
    expect(failure.choices[0].reason).toContain("模板预算耗尽");
    expect(() =>
      evaluateRolloutDecision(view, "discard", {
        sample: () => {
          throw new PublicSamplingError("history", "bad");
        },
      }),
    ).toThrow("bad");
    expect(() =>
      evaluateRolloutDecision(view, "discard", {
        samples: 2,
        sample,
        continueGame: () => {
          throw new Error("illegal continuation");
        },
      }),
    ).toThrow("illegal continuation");
    expect(() =>
      evaluateRolloutDecision(view, "discard", { samples: 3, sample }),
    ).toThrow(/粒子/);
    expect(() =>
      evaluateRolloutDecision(view, "discard", { samples: 0 }),
    ).toThrow(/样本/);
  });
});
