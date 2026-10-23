import { describe, expect, it } from "vitest";
import { v10ResponseChoice } from "./v10Response";
import boundaries from "./fixtures/public-ron-v1.json";
import observations from "../strategy/fixtures/observedHuDecisions.json";
import { evaluateWin } from "./scoring";
import type { PlayerView } from "./view";

describe("固定V1的V10公开响应组合", () => {
  it.each(boundaries.cases)("$name 普通点胡仍直接兑现已验证当前实收", (c) => {
    const view = structuredClone(c.context.view) as PlayerView;
    const result = v10ResponseChoice(view, "respond");
    expect(result?.action).toEqual({ type: "respond", choice: "hu" });
    expect(result?.reason).toContain(c.expectedIncome.toFixed(2));
  });
  it("固定V1抢杠当前点数至少2，符合金额修正参考高于1的收胡分支", () => {
    const rows = observations.rows.filter(
      (r) =>
        r.view.decision.kind === "respond" &&
        r.view.decision.responseKind === "rob-kong",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const view = structuredClone(row.view) as PlayerView,
        before = structuredClone(view),
        d = view.decision;
      if (d?.kind !== "respond") throw new Error();
      const current = evaluateWin(
        [...view.hand, d.tile],
        view.melds,
        view.missing!,
        { robKong: true },
      )!;
      expect(current.points).toBeGreaterThanOrEqual(2);
      const choice = v10ResponseChoice(view, "respond");
      expect(choice?.action).toEqual({ type: "respond", choice: "hu" });
      expect(choice?.reason).toContain(current.points.toFixed(2));
      expect(choice?.limit).toMatch(/最优|未来/);
      expect(view).toEqual(before);
    }
  });
  it("非合法胡不改；伪造抢杠时刻或牌型不能生成确定收入", () => {
    const row = observations.rows.find(
      (r) =>
        r.view.decision.kind === "respond" &&
        r.view.decision.responseKind === "rob-kong",
    )!;
    const view = structuredClone(row.view) as PlayerView;
    expect(v10ResponseChoice(view, "discard")).toBeUndefined();
    const no = structuredClone(view);
    if (no.decision?.kind !== "respond") throw new Error();
    no.decision.choices = ["pass"];
    expect(v10ResponseChoice(no, "respond")).toBeUndefined();
    const forged = structuredClone(view);
    forged.publicActions = [];
    expect(() => v10ResponseChoice(forged, "respond")).toThrow();
  });
});
