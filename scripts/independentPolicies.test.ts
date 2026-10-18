import { describe, expect, it } from "vitest";
import { createGame } from "../src/game/game";
import { chooseTeacherAction } from "../src/game/teacher";
import { playerView } from "../src/game/view";
import { createPolicySession, resolveLineup } from "./independentPolicies";

describe("独立评测策略注册", () => {
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
