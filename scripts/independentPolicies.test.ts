import { describe, expect, it } from "vitest";
import { applyDecisionAction } from "../src/game/decision";
import { createGame } from "../src/game/game";
import { chooseTeacherAction } from "../src/game/teacher";
import { playerView } from "../src/game/view";
import { createPolicySession, resolveLineup } from "./independentPolicies";
import { chooseOpponentAction } from "./benchmarkPolicies";
import ronBoundaries from "../src/game/fixtures/public-ron-v1.json";
import type { PlayerView } from "../src/game/view";
import type { RolloutDecision } from "../src/game/rolloutTeacher";

function openingViews() {
  let state = createGame(80000);
  const exchange = playerView(state, 0);
  for (const seat of [0, 1, 2, 3])
    state = applyDecisionAction(
      state,
      seat,
      chooseTeacherAction(playerView(state, seat), state.phase)!,
    );
  const missing = playerView(state, 0);
  for (const seat of [0, 1, 2, 3])
    state = applyDecisionAction(
      state,
      seat,
      chooseTeacherAction(playerView(state, seat), state.phase)!,
    );
  return { exchange, missing, self: playerView(state, 0) };
}

describe("独立评测策略注册", () => {
  it.each(ronBoundaries.cases)(
    "V10 $name 普通点胡直接兑现，不创建worker或续局样本",
    async (c) => {
      const view = structuredClone(c.context.view) as PlayerView;
      const before = structuredClone(view);
      const session = createPolicySession("candidate-advanced-accept-ron-v10", {
        workerFactory: () => {
          throw new Error("直接点胡不需要worker");
        },
        onEvaluation: () => {
          throw new Error("直接点胡没有续局样本");
        },
      });
      try {
        expect(await session.choose(view, "respond")).toEqual({
          type: "respond",
          choice: "hu",
        });
        expect(view).toEqual(before);
        await session.finish();
      } finally {
        await session.close();
      }
    },
  );

  it("V10其他节点沿用V8老师开局、ready-income worker及其真实返回", async () => {
    const views = openingViews();
    const seen: string[] = [];
    let finished = 0;
    const session = createPolicySession("candidate-advanced-accept-ron-v10", {
      workerFactory: (options) => {
        expect(options.policy).toBe("ebony72-advanced-ready-income-v1");
        return {
          act: async (view, phase) => {
            seen.push(phase);
            return phase === "respond"
              ? { type: "respond" as const, choice: "pass" as const }
              : { type: "discard" as const, tile: view.legalDiscards[0] };
          },
          close: async () => {},
          finish: async () => {
            finished++;
          },
        };
      },
      onEvaluation: () => {
        throw new Error("V10不采样");
      },
    });
    try {
      for (const [phase, view] of [
        ["exchange", views.exchange],
        ["choose-missing", views.missing],
      ] as const)
        expect(await session.choose(view, phase)).toEqual(
          chooseTeacherAction(view, phase),
        );
      expect(seen).toEqual([]);
      expect(await session.choose(views.self, "discard")).toEqual({
        type: "discard",
        tile: views.self.legalDiscards[0],
      });
      for (const [responseKind, choices] of [
        ["discard", ["pass", "pung"]],
        ["rob-kong", ["pass", "hu"]],
      ] as const) {
        const view = structuredClone(views.self);
        view.decision = {
          kind: "respond",
          responseKind,
          from: 1,
          tile: 0,
          choices: [...choices],
        };
        expect(await session.choose(view, "respond")).toEqual({
          type: "respond",
          choice: "pass",
        });
      }
      await session.finish();
      expect(seen).toEqual(["discard", "respond", "respond"]);
      expect(finished).toBe(1);
    } finally {
      await session.close();
    }
  });

  it("V9普通点胡记录实际模型选择，观察者副本不能改变动作且不用Python重问该节点", async () => {
    const input = structuredClone(
      ronBoundaries.cases.find((c) => c.name === "last-wall-discard")!.context
        .view,
    ) as PlayerView;
    const before = structuredClone(input);
    const reports: RolloutDecision[] = [];
    const session = createPolicySession(
      "candidate-advanced-ron-continuation-v9",
      {
        workerFactory: () => {
          throw new Error("当前点胡不应调用基础worker");
        },
        onEvaluation: (report) => {
          reports.push(structuredClone(report));
          report.choices[0].action = { type: "missing", suit: "wan" };
        },
      },
    );
    try {
      const action = await session.choose(input, "respond");
      expect(reports).toHaveLength(1);
      expect(action).toEqual(reports[0].choices[0].action);
      expect(action?.type).toBe("respond");
      if (action?.type === "respond" && input.decision?.kind === "respond")
        expect(input.decision.choices).toContain(action.choice);
      expect(["sampled", "fallback"]).toContain(reports[0].status);
      expect(reports[0].samples).toBe(reports[0].status === "sampled" ? 8 : 0);
      expect(input).toEqual(before);
      await session.finish();
    } finally {
      await session.close();
    }
  }, 30000);

  it("V9其他节点精确沿用V8的full组件、老师开局和正常worker收尾", async () => {
    const views = openingViews();
    const seen: string[] = [];
    let finished = 0;
    const session = createPolicySession(
      "candidate-advanced-ron-continuation-v9",
      {
        workerFactory: (options) => {
          expect(options.policy).toBe("ebony72-advanced-ready-income-v1");
          return {
            act: async (view, phase) => {
              seen.push(phase);
              return phase === "respond"
                ? { type: "respond" as const, choice: "hu" as const }
                : { type: "discard" as const, tile: view.legalDiscards[0] };
            },
            close: async () => {},
            finish: async () => {
              finished++;
            },
          };
        },
        onEvaluation: () => {
          throw new Error("不适用节点不应创建续局模型附录");
        },
      },
    );
    try {
      expect(await session.choose(views.exchange, "exchange")).toEqual(
        chooseTeacherAction(views.exchange, "exchange"),
      );
      expect(await session.choose(views.missing, "choose-missing")).toEqual(
        chooseTeacherAction(views.missing, "choose-missing"),
      );
      expect(seen).toEqual([]);
      expect(await session.choose(views.self, "discard")).toEqual({
        type: "discard",
        tile: views.self.legalDiscards[0],
      });
      const robbed = structuredClone(views.self);
      robbed.decision = {
        kind: "respond",
        responseKind: "rob-kong",
        from: 1,
        tile: 0,
        choices: ["pass", "hu"],
      };
      expect(await session.choose(robbed, "respond")).toEqual({
        type: "respond",
        choice: "hu",
      });
      await session.finish();
      expect(seen).toEqual(["discard", "respond"]);
      expect(finished).toBe(1);
    } finally {
      await session.close();
    }
  });

  it.each([
    ["candidate-advanced-income-v7", "ebony72-advanced-current-income-v1"],
    ["candidate-advanced-ready-income-v8", "ebony72-advanced-ready-income-v1"],
  ] as const)(
    "%s沿用E的老师开局和full组件，并复用自己的worker",
    async (policy, wire) => {
      const views = openingViews();
      const response = structuredClone(views.self);
      response.decision = {
        kind: "respond",
        responseKind: "discard",
        from: 1,
        tile: 0,
        choices: ["pass", "pung", "hu"],
      };
      const inputs = [views.self, response].map((view) =>
        structuredClone(view),
      );
      const phases: string[] = [];
      let started = 0;
      let finished = 0;
      const session = createPolicySession(policy, {
        timeoutMs: 1234,
        workerFactory: (options) => {
          expect(options.policy).toBe(wire);
          expect(options.timeoutMs).toBe(1234);
          started++;
          return {
            act: async (view, phase) => {
              phases.push(phase);
              // The full component delegates the host's hu choice too. It must
              // not silently turn this candidate into the always-win v4 shell.
              if (phase === "respond")
                return { type: "respond", choice: "pung" };
              const tile = view.legalDiscards[0];
              view.hand.length = 0;
              return { type: "discard", tile };
            },
            close: async () => {},
            finish: async () => {
              finished++;
            },
          };
        },
      });
      try {
        for (const [phase, view] of [
          ["exchange", views.exchange],
          ["choose-missing", views.missing],
        ] as const)
          expect(await session.choose(view, phase)).toEqual(
            chooseTeacherAction(view, phase),
          );
        expect(started).toBe(0);
        expect(await session.choose(views.self, "discard")).toEqual({
          type: "discard",
          tile: views.self.legalDiscards[0],
        });
        expect(await session.choose(response, "respond")).toEqual({
          type: "respond",
          choice: "pung",
        });
        expect([views.self, response]).toEqual(inputs);
        expect(phases).toEqual(["discard", "respond"]);
        expect(started).toBe(1);
        await session.finish();
        expect(finished).toBe(1);
        await expect(session.choose(response, "respond")).rejects.toThrow(
          /关闭/,
        );
      } finally {
        await session.close();
      }
    },
  );

  it.each([
    ["candidate-advanced-income-v7", "ebony72-advanced-current-income-v1"],
    ["candidate-advanced-ready-income-v8", "ebony72-advanced-ready-income-v1"],
  ] as const)(
    "%s保留actor隔离与决策/finish错误，cleanup不吞失败",
    async (policy, wire) => {
      const views = openingViews();
      let closed = 0;
      const session = createPolicySession(policy, {
        workerFactory: (options) => {
          expect(options.policy).toBe(wire);
          return {
            act: async () => {
              throw new Error("income decision failure");
            },
            finish: async () => {
              throw new Error("income finish failure");
            },
            close: async () => {
              closed++;
            },
          };
        },
      });
      try {
        await expect(session.choose(views.self, "discard")).rejects.toThrow(
          "income decision failure",
        );
        const other = structuredClone(views.self);
        other.seat = 1;
        await expect(session.choose(other, "discard")).rejects.toThrow(
          /不同座位/,
        );
        await expect(session.finish()).rejects.toThrow("income finish failure");
      } finally {
        await session.close();
      }
      expect(closed).toBe(1);
    },
  );

  it("实际牌桌电脑沿用旧greedy开局与行牌，并标为内部阵容且不启动外部worker", async () => {
    const session = createPolicySession("ui-greedy-v1", {
      workerFactory: () => {
        throw new Error("UI greedy must not use Python");
      },
    });
    expect(resolveLineup("ui-bots")).toEqual(Array(4).fill("ui-greedy-v1"));
    const views = openingViews();
    for (const [view, phase] of [
      [views.exchange, "exchange"],
      [views.missing, "choose-missing"],
      [views.self, "discard"],
    ] as const) {
      const before = structuredClone(view);
      expect(await session.choose(view, phase)).toEqual(
        chooseOpponentAction(view, phase, "greedy"),
      );
      expect(view).toEqual(before);
    }
    await session.finish();
    await expect(session.choose(views.exchange, "exchange")).rejects.toThrow(
      /关闭/,
    );
  });

  it("BA组合参考明确共用换牌，其他阶段均交给独立wire且复用同一进程", async () => {
    let started = 0;
    let finished = 0;
    const calls: string[] = [];
    const views = openingViews();
    const session = createPolicySession("fanfou-ba-composite-v1", {
      timeoutMs: 1234,
      workerFactory: (options) => {
        expect(options.policy).toBe("fanfou-ba-composite-v1");
        expect(options.timeoutMs).toBe(1234);
        started++;
        return {
          act: async (view, phase) => {
            calls.push(phase);
            if (phase === "choose-missing")
              return { type: "missing", suit: "tong" };
            if (phase === "discard")
              return { type: "discard", tile: view.legalDiscards[0] };
            throw new Error("BA explicit failure");
          },
          close: async () => {},
          finish: async () => {
            finished++;
          },
        };
      },
    });
    expect(resolveLineup("fanfou-ba")).toEqual([
      "fanfou-ba-composite-v1",
      "fanfou-ba-composite-v1",
      "fanfou-ba-composite-v1",
      "fanfou-ba-composite-v1",
    ]);
    expect(await session.choose(views.exchange, "exchange")).toEqual(
      chooseTeacherAction(views.exchange, "exchange"),
    );
    expect(started).toBe(0);
    expect(await session.choose(views.missing, "choose-missing")).toEqual({
      type: "missing",
      suit: "tong",
    });
    expect(await session.choose(views.self, "discard")).toEqual({
      type: "discard",
      tile: views.self.legalDiscards[0],
    });
    await expect(session.choose(views.self, "respond")).rejects.toThrow(
      "BA explicit failure",
    );
    expect(started).toBe(1);
    expect(calls).toEqual(["choose-missing", "discard", "respond"]);
    await session.finish();
    expect(finished).toBe(1);
    await expect(session.choose(views.exchange, "exchange")).rejects.toThrow(
      /关闭/,
    );
  });

  it("封顶弃牌候选只共用换牌，其余委派独立cap8 wire且不吞错误", async () => {
    let started = 0;
    let finished = 0;
    let calls = 0;
    const session = createPolicySession("candidate-advanced-cap8-v6", {
      timeoutMs: 1234,
      workerFactory: (options) => {
        expect(options.policy).toBe("ebony72-advanced-cap8-discard-v1");
        expect(options.timeoutMs).toBe(1234);
        started++;
        return {
          act: async (_view, phase) => {
            calls++;
            if (phase === "choose-missing")
              return { type: "missing", suit: "tong" };
            throw new Error("cap8 failure");
          },
          close: async () => {},
          finish: async () => {
            finished++;
          },
        };
      },
    });
    const views = openingViews();
    expect(await session.choose(views.exchange, "exchange")).toEqual(
      chooseTeacherAction(views.exchange, "exchange"),
    );
    expect(started).toBe(0);
    expect(await session.choose(views.missing, "choose-missing")).toEqual({
      type: "missing",
      suit: "tong",
    });
    await expect(session.choose(views.self, "discard")).rejects.toThrow(
      "cap8 failure",
    );
    expect(started).toBe(1);
    expect(calls).toBe(2);
    await session.finish();
    expect(finished).toBe(1);
    await expect(session.choose(views.exchange, "exchange")).rejects.toThrow(
      /关闭/,
    );
  });

  it.each([
    "candidate-advanced-opening-v5",
    "candidate-advanced-discard-v5",
    "candidate-advanced-actions-v5",
  ])("%s统一老师开局且非开局使用原高级wire和同一worker", async (name) => {
    let started = 0;
    let calls = 0;
    let finished = 0;
    const session = createPolicySession(name, {
      workerFactory: (options) => {
        expect(options.policy).toBe("ebony72-advanced-public-v1");
        started++;
        return {
          act: async (view, phase) => {
            expect(phase).toBe("discard");
            calls++;
            return { type: "discard", tile: view.legalDiscards[0] };
          },
          close: async () => {},
          finish: async () => {
            finished++;
          },
        };
      },
    });
    const views = openingViews();
    expect(views.self.decision?.kind).toBe("self");
    expect(
      views.self.decision?.kind === "self" && views.self.decision.canWin,
    ).toBe(false);
    expect(
      views.self.decision?.kind === "self" &&
        views.self.decision.concealedKongs,
    ).toEqual([]);
    for (const [phase, view] of [
      ["exchange", views.exchange],
      ["choose-missing", views.missing],
    ] as const)
      expect(await session.choose(view, phase)).toEqual(
        chooseTeacherAction(view, phase),
      );
    expect(started).toBe(0);
    for (let index = 0; index < 2; index++) {
      const action = await session.choose(views.self, "discard");
      expect(action?.type).toBe("discard");
    }
    expect(started).toBe(1);
    expect(calls).toBe(2);
    await session.finish();
    expect(finished).toBe(1);
    await expect(session.choose(views.exchange, "exchange")).rejects.toThrow(
      /关闭/,
    );
  });

  it("高级收胡候选在合法自摸和点胡时不启动外部worker", async () => {
    const view = playerView(createGame(80000), 0);
    const session = createPolicySession("candidate-advanced-hu-v4", {
      workerFactory: () => {
        throw new Error("合法胡牌不应委派外部worker");
      },
    });
    try {
      view.decision = {
        kind: "self",
        canWin: true,
        concealedKongs: [],
        addedKongs: [],
      };
      expect(await session.choose(view, "discard")).toEqual({ type: "win" });
      view.decision = {
        kind: "respond",
        responseKind: "discard",
        from: 1,
        tile: 0,
        choices: ["pass", "hu"],
      };
      expect(await session.choose(view, "respond")).toEqual({
        type: "respond",
        choice: "hu",
      });
    } finally {
      await session.finish();
    }
  });

  it("高级收胡候选共用换牌，其余动作保持原高级wire且复用worker", async () => {
    const view = playerView(createGame(80000), 0);
    const calls: string[] = [];
    let started = 0;
    let finished = 0;
    const session = createPolicySession("candidate-advanced-hu-v4", {
      workerFactory: (options) => {
        expect(options.policy).toBe("ebony72-advanced-public-v1");
        expect(options.timeoutMs).toBe(1234);
        started++;
        return {
          act: async (_view, phase) => {
            calls.push(phase);
            return phase === "choose-missing"
              ? { type: "missing", suit: "tong" }
              : { type: "respond", choice: "pung" };
          },
          finish: async () => {
            finished++;
          },
          close: async () => {},
        };
      },
      timeoutMs: 1234,
    });
    expect(await session.choose(view, "exchange")).toEqual(
      chooseTeacherAction(view, "exchange"),
    );
    expect(started).toBe(0);
    expect(await session.choose(view, "choose-missing")).toEqual({
      type: "missing",
      suit: "tong",
    });
    view.decision = {
      kind: "respond",
      responseKind: "discard",
      from: 1,
      tile: 0,
      choices: ["pass", "pung"],
    };
    expect(await session.choose(view, "respond")).toEqual({
      type: "respond",
      choice: "pung",
    });
    expect(calls).toEqual(["choose-missing", "respond"]);
    expect(started).toBe(1);
    await session.finish();
    expect(finished).toBe(1);
    await expect(session.choose(view, "respond")).rejects.toThrow(/关闭/);
  });

  it("高级收胡候选保留非胡节点的外部异常和座位隔离", async () => {
    const state = createGame(80000);
    const session = createPolicySession("candidate-advanced-hu-v4", {
      workerFactory: () => ({
        act: async () => {
          throw new Error("advanced failure");
        },
        close: async () => {},
      }),
    });
    try {
      await expect(
        session.choose(playerView(state, 0), "choose-missing"),
      ).rejects.toThrow("advanced failure");
      const other = playerView(state, 1);
      other.decision = {
        kind: "self",
        canWin: true,
        concealedKongs: [],
        addedKongs: [],
      };
      await expect(session.choose(other, "discard")).rejects.toThrow(
        /不同座位/,
      );
    } finally {
      await session.close();
    }
  });

  it("续局候选沿用开局并明确报告未触发，不会转入外部worker", async () => {
    const reports: string[] = [];
    const session = createPolicySession("candidate-rollout-v3", {
      onEvaluation: (report) => reports.push(report.status),
      workerFactory: () => {
        throw new Error("must not spawn");
      },
    });
    const view = playerView(createGame(80000), 0);
    try {
      expect(await session.choose(view, "exchange")).toEqual(
        chooseTeacherAction(view, "exchange"),
      );
      expect(reports).toEqual(["not-applicable"]);
    } finally {
      await session.close();
    }
  });
  it("高级公有参考注册独立线阵与明确wire策略标识", async () => {
    expect(resolveLineup("ebony-advanced")).toEqual(
      Array(4).fill("ebony72-advanced-public-v1"),
    );
    let wire: unknown;
    const session = createPolicySession("ebony72-advanced-public-v1", {
      workerFactory: (options) => {
        wire = options.policy;
        return {
          act: async () => ({ type: "missing", suit: "tong" }),
          close: async () => {},
        };
      },
    });
    try {
      await session.choose(playerView(createGame(80000), 0), "choose-missing");
      expect(wire).toBe("ebony72-advanced-public-v1");
    } finally {
      await session.close();
    }
  });
  it("同一会话拒绝切换暗牌所属座位", async () => {
    const session = createPolicySession("teacher-v1");
    const state = createGame(80000);
    try {
      await session.choose(playerView(state, 0), "exchange");
      await expect(
        session.choose(playerView(state, 1), "exchange"),
      ).rejects.toThrow(/不同座位/);
    } finally {
      await session.close();
    }
  });
  it("拒绝未知策略和未知对手，不能跌入旧默认分支", () => {
    expect(() => createPolicySession("typo")).toThrow(/未知策略/);
    expect(() => resolveLineup("typo")).toThrow(/未知对手/);
  });

  it("旧老师注册精确沿用当前策略", async () => {
    const state = createGame(80000);
    const view = playerView(state, 0);
    const session = createPolicySession("teacher-v1");
    try {
      expect(await session.choose(view, "exchange")).toEqual(
        chooseTeacherAction(view, "exchange"),
      );
    } finally {
      await session.close();
    }
  });

  it("外部组合策略只共用换三张，定缺与行牌实际委派外部进程", async () => {
    let started = 0;
    const phases: string[] = [];
    let closed = 0;
    const session = createPolicySession("ebony-initial", {
      workerFactory: () => {
        started++;
        return {
          act: async (_view, phase) => {
            phases.push(phase);
            return { type: "missing", suit: "tong" };
          },
          close: async () => {
            closed++;
          },
        };
      },
    });
    const view = playerView(createGame(80000), 0);
    expect(await session.choose(view, "exchange")).toEqual(
      chooseTeacherAction(view, "exchange"),
    );
    expect(started).toBe(0);
    expect(await session.choose(view, "choose-missing")).toEqual({
      type: "missing",
      suit: "tong",
    });
    expect(await session.choose(view, "choose-missing")).toEqual({
      type: "missing",
      suit: "tong",
    });
    expect(started).toBe(1);
    expect(phases).toEqual(["choose-missing", "choose-missing"]);
    await session.close();
    expect(closed).toBe(1);
  });

  it("一个actor一个worker，会话关闭后不可重新启动", async () => {
    let started = 0;
    const sessions = [0, 1].map(() =>
      createPolicySession("ebony-initial", {
        workerFactory: () => {
          started++;
          return {
            act: async () => ({ type: "missing", suit: "wan" }),
            close: async () => {},
          };
        },
      }),
    );
    const view = playerView(createGame(80000), 0);
    for (const session of sessions)
      await session.choose(view, "choose-missing");
    expect(started).toBe(2);
    for (const session of sessions) await session.close();
    await expect(sessions[0].choose(view, "choose-missing")).rejects.toThrow(
      /关闭/,
    );
    expect(started).toBe(2);
  });

  it("外部异常直接上抛，不调用内部动作替代", async () => {
    const session = createPolicySession("ebony-initial", {
      workerFactory: () => ({
        act: async () => {
          throw new Error("upstream failure");
        },
        close: async () => {},
      }),
    });
    try {
      await expect(
        session.choose(playerView(createGame(80000), 0), "choose-missing"),
      ).rejects.toThrow("upstream failure");
    } finally {
      await session.close();
    }
  });
});
