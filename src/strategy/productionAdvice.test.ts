import { describe, expect, it } from "vitest";
import { announcementsForDecision } from "../sound";
import { chooseTeacherAction, teacherChoices } from "../game/teacher";
import { hand } from "../game/testHelpers";
import type { PlayerView } from "../game/view";
import type { BrowserDecision } from "./advancedClient";
import observations from "./fixtures/observedHuDecisions.json";
import ronBoundaries from "../game/fixtures/public-ron-v1.json";
import {
  presentBrowserDecision,
  teacherPresentation,
  explainProductionAction,
  ProductionAdviceGate,
} from "./productionAdvice";

function view(): PlayerView {
  const owned = hand("w123456789 s12345");
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
    wallRemaining: 30,
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
function advanced(input: PlayerView): BrowserDecision {
  return {
    action: { type: "discard", tile: input.legalDiscards.at(-1)! },
    phase: "discard",
    policy: "E",
    origin: "advanced-public",
    session: 1,
    revision: 0,
    recommendationCount: 1,
    legalActionCount: input.legalDiscards.length,
  };
}
describe("当前生产策略的忠实展示与语音快照", () => {
  it("V10兑现响应展示该步确定金额，禁止伪装其他动作或附加别的分支诊断", () => {
    const c = ronBoundaries.cases[0],
      input = structuredClone(c.context.view) as PlayerView;
    const result = {
      action: { type: "respond" as const, choice: "hu" as const },
      phase: "respond" as const,
      policy: "V10" as const,
      origin: "v10-response" as const,
      session: 1,
      revision: 0,
      recommendationCount: 1 as const,
    };
    const shown = presentBrowserDecision(input, result);
    expect(shown.choices[0].reason).toContain(c.expectedIncome.toFixed(2));
    expect(shown.origin).toBe("v10-response");
    expect(() =>
      presentBrowserDecision(input, {
        ...result,
        action: { type: "respond", choice: "pass" },
      }),
    ).toThrow();
    expect(() =>
      presentBrowserDecision(input, {
        ...result,
        diagnostics: observations.rows[0].diagnostics as never,
      }),
    ).toThrow();
    const manual = explainProductionAction(
      input,
      { type: "respond", choice: "pass" },
      shown,
    );
    expect(manual.actual.reason).toBe("这是玩家手动选择的合法操作。");
  });
  it("实际高级胡牌分支显示同次比较值，拒胡后碰牌不被改写成过", () => {
    const row = observations.rows[0],
      input = row.view as unknown as PlayerView;
    const result = {
      ...advanced(input),
      phase: "respond" as const,
      action: row.action,
      diagnostics: row.diagnostics,
    } as unknown as BrowserDecision;
    const presented = presentBrowserDecision(input, result);
    expect(presented.action).toEqual({ type: "respond", choice: "pung" });
    expect(presented.choices[0].summary).toContain("4.249");
    expect(presented.choices[0].summary).toContain("暂不收胡");
    expect(presented.choices[0].summary).toContain("最终选择碰");
    expect(presented.choices[0].reason).toContain("后续碰、杠、过的取舍未采集");
    expect(presented.choices[0].limit).toContain("不是胜率");
    expect(presented.choices[0].summary).not.toContain("最终选择过");
  });
  it("高级收胡的真实比较值同时进入当前建议和推荐语音", () => {
    const row = observations.rows[3],
      input = row.view as unknown as PlayerView;
    const presented = presentBrowserDecision(input, {
      ...advanced(input),
      phase: "respond",
      action: row.action,
      diagnostics: row.diagnostics,
    } as unknown as BrowserDecision);
    const explanation = explainProductionAction(
      input,
      presented.action,
      presented,
    );
    expect(announcementsForDecision(explanation, []).join("。")).toContain(
      "0.4735",
    );
    expect(presented.choices[0].reason).toContain("实际胡牌判断");
  });
  it("老师出处不能附带其他策略的分支诊断，高级坏诊断也不能静默丢弃", () => {
    const input = view(),
      teacher = teacherPresentation(input, "discard")!;
    expect(() =>
      presentBrowserDecision(input, {
        ...advanced(input),
        action: teacher.action,
        origin: "teacher-actions",
        diagnostics: observations.rows[0].diagnostics,
      } as unknown as BrowserDecision),
    ).toThrow();
    expect(() =>
      presentBrowserDecision(input, {
        ...advanced(input),
        diagnostics: { ...observations.rows[0].diagnostics, privateHand: [] },
      } as unknown as BrowserDecision),
    ).toThrow();
  });
  it("高级只呈现实际出处和合法事实，不借用老师分数/风险/两摸说明", () => {
    const input = view(),
      result = advanced(input),
      presented = presentBrowserDecision(input, result);
    expect(presented.action).toEqual(result.action);
    expect(presented.choices).toHaveLength(1);
    expect(presented.choices[0].reason).toContain("公开信息");
    expect(presented.choices[0].reason).toContain(
      String(result.legalActionCount),
    );
    expect(presented.choices[0].reason).not.toMatch(
      /两摸|向听|更安全|收益约|放铳率/,
    );
    expect(presented.legalActionCount).toBeGreaterThan(1);
  });
  it("老师origin才显示该老师真实首选依据，动作不符就拒绝追认", () => {
    const input = view(),
      action = chooseTeacherAction(input, "discard")!;
    const result = {
      ...advanced(input),
      action,
      origin: "teacher-actions" as const,
      policy: "D" as const,
    };
    const presented = presentBrowserDecision(input, result);
    expect(presented.choices[0].reason).toBe(
      teacherChoices(input, "discard")[0].reason,
    );
    const different = input.legalDiscards.find(
      (t) => action.type === "discard" && t !== action.tile,
    )!;
    expect(() =>
      presentBrowserDecision(input, {
        ...result,
        action: { type: "discard", tile: different },
      }),
    ).toThrow(/老师|一致/);
  });
  it("高级拒合法胡仅说明本次选择与可选事实，不编造拒胡收益依据", () => {
    const input = view();
    input.hand.pop();
    input.legalDiscards = [];
    input.decision = {
      kind: "respond",
      responseKind: "discard",
      from: 1,
      tile: 0,
      choices: ["pass", "hu"],
    };
    const presented = presentBrowserDecision(input, {
      ...advanced(input),
      phase: "respond",
      action: { type: "respond", choice: "pass" },
      legalActionCount: 2,
    });
    expect(presented.choices[0].reason).toContain("可胡");
    expect(presented.choices[0].reason).toContain("过");
    expect(presented.choices[0].reason).not.toMatch(
      /自摸收益更高|风险更低|最优/,
    );
  });
  it("荐牌与托管使用同一高级动作，语音不把它读成偏离旧老师", () => {
    const input = view(),
      presented = presentBrowserDecision(input, advanced(input));
    const explanation = explainProductionAction(
      input,
      presented.action,
      presented,
    );
    expect(explanation.actual).toEqual(presented.choices[0]);
    expect(explanation.matchesRecommendation).toBe(true);
    const spoken = announcementsForDecision(explanation, []).join("。");
    expect(spoken).toContain(presented.choices[0].summary);
    expect(spoken).not.toContain("系统建议");
  });
  it("手工其他合法动作只读操作事实，加载期间也不臆造老师对照", () => {
    const input = view(),
      presented = presentBrowserDecision(input, advanced(input));
    const tile = input.legalDiscards.find(
      (t) => presented.action.type === "discard" && t !== presented.action.tile,
    )!;
    for (const recommendation of [presented, undefined]) {
      const explanation = explainProductionAction(
        input,
        { type: "discard", tile },
        recommendation,
      );
      expect(explanation.actual.reason).toContain("玩家手动");
      expect(announcementsForDecision(explanation, []).join("。")).not.toMatch(
        /系统建议|向听|两摸|收益/,
      );
    }
  });
  it("默认老师的展示首选与实际teacher选择精确一致", () => {
    const input = view(),
      presented = teacherPresentation(input, "discard")!;
    expect(presented.action).toEqual(chooseTeacherAction(input, "discard"));
    expect(presented.choices[0].reason).toBe(
      teacherChoices(input, "discard")[0].reason,
    );
  });
  it("手动偏离当前老师时保留实际首选及当步已有备选的解释", () => {
    const input = view(),
      presented = teacherPresentation(input, "discard")!,
      alternative = presented.choices[1];
    expect(alternative).toBeDefined();
    const explanation = explainProductionAction(
      input,
      alternative.action,
      presented,
    );
    expect(explanation.actual).toEqual(alternative);
    expect(explanation.recommended).toEqual(presented.choices[0]);
    expect(explanation.matchesRecommendation).toBe(false);
    expect(announcementsForDecision(explanation, []).join("。")).toContain(
      `系统建议${presented.choices[0].label}`,
    );
  });
  it("老师未展示的手动弃牌只说明操作事实，仍准确提示当前老师首选", () => {
    const input = view(),
      presented = teacherPresentation(input, "discard")!,
      tile = input.legalDiscards.find(
        (candidate) =>
          !presented.choices.some(
            (choice) =>
              choice.action.type === "discard" &&
              choice.action.tile === candidate,
          ),
      )!;
    expect(tile).toBeDefined();
    const action = { type: "discard" as const, tile },
      explanation = explainProductionAction(input, action, presented);
    expect(explanation.actual.action).toEqual(action);
    expect(explanation.actual.reason).toContain("玩家手动");
    expect(explanation.recommended).toEqual(presented.choices[0]);
    expect(explanation.matchesRecommendation).toBe(false);
  });
});

describe("React接入使用的异步建议门禁", () => {
  it("新局/手动操作同步失效后，先前请求完成不能恢复旧建议", async () => {
    const gate = new ProductionAdviceGate();
    let resolve!: (value: string) => void;
    const old = gate.run(
      "game1/rev0",
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    gate.invalidate();
    expect(gate.isCurrent("game1/rev0")).toBe(false);
    const next = await gate.run("game2/rev0", async () => "new");
    resolve("old");
    expect(await old).toBeUndefined();
    expect(next).toEqual({ key: "game2/rev0", value: "new" });
  });
  it("切策略/资源/phase的key改变时，旧错误不暂停或覆盖新结果", async () => {
    const gate = new ProductionAdviceGate();
    let reject!: (error: Error) => void;
    const old = gate.run(
      "E/rev0",
      () =>
        new Promise<string>((_, r) => {
          reject = r;
        }),
    );
    gate.expect("D/rev0");
    reject(new Error("old worker failed"));
    expect(await old).toBeUndefined();
    expect(gate.isCurrent("E/rev0")).toBe(false);
    expect(await gate.run("D/rev0", async () => "new")).toEqual({
      key: "D/rev0",
      value: "new",
    });
  });
});
