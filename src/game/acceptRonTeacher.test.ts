import { describe, expect, it } from "vitest";
import { acceptRonChoice } from "./acceptRonTeacher";
import boundaries from "./fixtures/public-ron-v1.json";
import type { PlayerView } from "./view";

describe("普通合法点胡直接兑现对照", () => {
  it.each(boundaries.cases)("$name 只报告实际确定实收并接受点胡", (c) => {
    const view = structuredClone(c.context.view) as PlayerView;
    const before = structuredClone(view);
    const choice = acceptRonChoice(view, "respond");
    expect(choice?.action).toEqual({ type: "respond", choice: "hu" });
    expect(choice?.summary).toContain(c.expectedIncome.toFixed(2));
    expect(choice?.reason).toContain(c.expectedIncome.toFixed(2));
    expect(choice?.reason).toMatch(/退出/);
    expect(choice?.limit).toMatch(/未来|最优/);
    expect(choice?.reason).not.toMatch(/粒子|标准误|均值/);
    expect(view).toEqual(before);
  });

  it("抢杠、自摸、没有合法胡与非响应阶段不适用", () => {
    const normal = structuredClone(
      boundaries.cases[0].context.view,
    ) as PlayerView;
    const rob = structuredClone(normal);
    if (rob.decision?.kind !== "respond") throw new Error("测试需要响应");
    rob.decision.responseKind = "rob-kong";
    const noHu = structuredClone(normal);
    if (noHu.decision?.kind !== "respond") throw new Error("测试需要响应");
    noHu.decision.choices = ["pass"];
    const self = structuredClone(normal);
    self.decision = {
      kind: "self",
      canWin: true,
      concealedKongs: [],
      addedKongs: [],
    };
    expect(acceptRonChoice(rob, "respond")).toBeUndefined();
    expect(acceptRonChoice(noHu, "respond")).toBeUndefined();
    expect(acceptRonChoice(self, "discard")).toBeUndefined();
    expect(acceptRonChoice(normal, "discard")).toBeUndefined();
  });

  it("非法公开库存不能伪造确定收益", () => {
    const view = structuredClone(
      boundaries.cases[0].context.view,
    ) as PlayerView;
    view.hand[0] = 99;
    expect(() => acceptRonChoice(view, "respond")).toThrow();
  });
});
