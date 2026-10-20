import { describe, expect, it } from "vitest";
import type { DecisionAction } from "../game/decision";
import type { Phase } from "../game/game";
import type { PlayerView } from "../game/view";
import fixture from "./fixtures/observedHuDecisions.json";
import {
  explainAdvancedDiagnostics,
  readAdvancedDiagnostics,
} from "./advancedDiagnostics";

const rows = fixture.rows.map((row) => ({
  ...row,
  phase: row.phase as Phase,
  view: row.view as unknown as PlayerView,
  action: row.action as DecisionAction,
}));
function read(index: number, data: unknown = rows[index].diagnostics) {
  const row = rows[index];
  return readAdvancedDiagnostics(data, row.view, row.phase, row.action);
}
describe("同一次高级胡牌选择的实际分支解释", () => {
  it("保留四个已被实际3.13/3.14复算一致的分支数值", () => {
    for (const [index, row] of rows.entries())
      expect(read(index)).toEqual(row.diagnostics);
  });
  it("拒胡后碰牌只解释胡牌比较，不能把最终动作写成过或虚构碰牌收益", () => {
    const reason = explainAdvancedDiagnostics(read(0))!;
    expect(reason.summary).toContain("4.249");
    expect(reason.summary).toContain("暂不收胡");
    expect(reason.details.join("。")).toContain("后续碰、杠、过的取舍未采集");
    expect(reason.limit).toContain("不是胜率");
    expect(reason.limit).toContain("不是本桌实际可收点数");
    expect(reason.summary + reason.details.join("。")).not.toMatch(
      /本次选择过|更安全|碰牌收益更高|424\.9%/,
    );
  });
  it("抢杠比较明确使用原模型值，不能当作本桌实际付款", () => {
    const reason = explainAdvancedDiagnostics(read(1))!;
    expect(reason.summary).toContain("原模型牌型值 1");
    expect(reason.summary).toContain("阈值 1");
    expect(reason.summary).toContain("暂不收胡");
    expect(reason.limit).toContain("不是本桌实际可收点数");
  });
  it("收胡展示实际等待比较值和阈值，不把0.4735读成概率", () => {
    const reason = explainAdvancedDiagnostics(read(3))!;
    expect(reason.summary).toContain("0.4735");
    expect(reason.summary).toContain("阈值 1");
    expect(reason.summary).toContain("收胡");
    expect(reason.summary).not.toMatch(/%|胜率|预计净分/);
  });
  it("拒绝未知字段、非有限数、错误来源、错误单位与串到其他局面的信息", () => {
    const bad = [
      { ...rows[0].diagnostics, privateOpponent: { hand: [0] } },
      { ...rows[0].diagnostics, publicViewHash: "not-a-hash" },
      { ...rows[0].diagnostics, policyId: "teacher" },
      {
        ...rows[0].diagnostics,
        branch: {
          ...rows[0].diagnostics.branch,
          sourceFileSha256: "0".repeat(64),
        },
      },
      {
        ...rows[0].diagnostics,
        branch: {
          ...rows[0].diagnostics.branch,
          returnLine: { function: 189, source: 1010 },
        },
      },
      {
        ...rows[0].diagnostics,
        comparison: {
          ...rows[0].diagnostics.comparison,
          finalHeuristicWaitingFactor: Infinity,
        },
      },
      {
        ...rows[0].diagnostics,
        comparison: {
          ...rows[0].diagnostics.comparison,
          finalHeuristicWaitingFactor: NaN,
        },
      },
      {
        ...rows[0].diagnostics,
        comparison: {
          ...rows[0].diagnostics.comparison,
          utlUnit: "exact-V1-income",
        },
      },
      {
        ...rows[0].diagnostics,
        comparison: {
          ...rows[0].diagnostics.comparison,
          wallRemaining: rows[0].view.wallRemaining - 1,
        },
      },
      {
        ...rows[0].diagnostics,
        currentIncome: { status: "not-called", totalPoints: 2 },
      },
      {
        ...rows[0].diagnostics,
        comparison: {
          ...rows[0].diagnostics.comparison,
          futureKongStep: { before: 1, after: 2, delta: 100 },
        },
      },
    ];
    for (const value of bad) expect(() => read(0, value)).toThrow();
    expect(() => read(0, rows[1].diagnostics)).toThrow();
  });
  it("胡分支返回值须与实际动作及比较方向一致", () => {
    expect(() => read(0, rows[3].diagnostics)).toThrow();
    const inconsistent = structuredClone(rows[0].diagnostics);
    inconsistent.comparison.finalHeuristicWaitingFactor = 0.5;
    expect(() => read(0, inconsistent)).toThrow();
  });
  it("不覆盖的节点只保留状态，不编造出牌或碰杠理由", () => {
    const row = rows[0],
      data = {
        version: 1,
        policyId: "ebony72-advanced-public-v1",
        publicViewHash: row.diagnostics.publicViewHash,
        coverage: "not-covered",
        branch: null,
        comparison: null,
        currentIncome: { status: "not-called" },
        postHuMeldStage: "not-covered",
      };
    const view = structuredClone(row.view);
    view.decision = {
      kind: "respond",
      responseKind: "discard",
      from: 1,
      tile: 0,
      choices: ["pass"],
    };
    const parsed = readAdvancedDiagnostics(data, view, "respond", {
      type: "respond",
      choice: "pass",
    });
    expect(explainAdvancedDiagnostics(parsed)).toBeUndefined();
    expect(() => read(0, data)).toThrow();
  });
  it("返回独立快照，接收者修改原对象不能改变解释", () => {
    const original = structuredClone(rows[0].diagnostics),
      parsed = read(0, original);
    original.comparison.actualUtl = 100;
    expect(parsed.comparison!.actualUtl).toBe(1);
  });
  it("合成标量边界保留抢杠源码的余摸/进张收胡条件，不误要求牌型值必须大于1", () => {
    for (const [wall, waits] of [
      [12, 3],
      [20, 4],
      [25, 1],
    ]) {
      const row = rows[1],
        data = structuredClone(row.diagnostics),
        view = structuredClone(row.view);
      view.wallRemaining = wall;
      data.branch.returnValue = "robkong";
      data.branch.returnLine = { function: 29, source: 1266 };
      data.postHuMeldStage = "not-run";
      data.comparison.wallRemaining = wall;
      data.comparison.approxRemainingDraws = wall / 4;
      data.comparison.numS = waits;
      const parsed = readAdvancedDiagnostics(data, view, "respond", {
        type: "respond",
        choice: "hu",
      });
      const reason = explainAdvancedDiagnostics(parsed)!;
      expect(reason.summary).toContain("收胡");
      expect(reason.summary).not.toContain("牌型值 1高于");
      expect(reason.details.join("。")).toContain("可成胡张数");
    }
  });
  it("可成胡张数不是手牌张数；合成20张估计不应被14张上限误拒", () => {
    const row = rows[1],
      data = structuredClone(row.diagnostics);
    data.comparison.numS = 20;
    expect(() => read(1, data)).not.toThrow();
  });
  it("比较值紧邻阈值时保留差异，不能四舍五入成相等后仍说高于", () => {
    const data = structuredClone(rows[0].diagnostics);
    data.comparison.finalHeuristicWaitingFactor = 1.0000000000000002;
    data.comparison.eventFactorStep = null as never;
    data.comparison.futureKongStep = null as never;
    const reason = explainAdvancedDiagnostics(read(0, data))!;
    expect(reason.summary).toContain("1.0000000000000002");
  });
});
