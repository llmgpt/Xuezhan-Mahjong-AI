import { describe, expect, it } from "vitest";
import {
  chooseTeacherAction,
  chooseTeacherMissing,
  recommendTeacherDiscards,
} from "./teacher";
import { suitOf, tile, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";
import { recommendDiscards } from "./advice";

function hand(spec: string): Tile[] {
  const names: Record<string, Suit> = { w: "wan", s: "tiao", d: "tong" };
  return spec
    .split(" ")
    .flatMap((part) =>
      [...part.slice(1)].map((rank) => tile(names[part[0]], Number(rank))),
    );
}

function viewFor(spec: string, missing: Suit = "tong"): PlayerView {
  const tiles = hand(spec);
  const missingTiles = tiles.filter((item) => suitOf(item) === missing);
  return {
    seat: 0,
    hand: tiles,
    melds: [],
    missing,
    legalDiscards: [...new Set(missingTiles.length ? missingTiles : tiles)],
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
    wallRemaining: 40,
  };
}

describe("合理老师候选", () => {
  it("换牌保留成组联系，不固定拆最先出现的顺子", () => {
    const view = viewFor("w123456 s269 d12345");
    expect(chooseTeacherAction(view, "exchange")).toEqual({
      type: "exchange",
      tiles: hand("s269"),
    });
  });

  it("定缺张数并列时，保留完整顺子，清掉孤张较多的一门", () => {
    expect(chooseTeacherMissing(hand("w123 s159 d11223445"))).toBe("tiao");
  });

  it("清缺门只选合法缺门牌，不为番型越过规则", () => {
    const view = viewFor("w1112345678999 s1", "tiao");
    const choices = recommendTeacherDiscards(view);
    expect(choices.map((item) => item.tile)).toEqual(hand("s1"));
    expect(choices[0].summary).toContain("缺");
  });

  it("胡牌时优先结算现成收益，正常牌效例保留更宽进张", () => {
    const winView = viewFor("w123456789 s11122");
    winView.decision = {
      kind: "self",
      canWin: true,
      concealedKongs: [],
      addedKongs: [],
    };
    expect(chooseTeacherAction(winView, "discard")).toEqual({ type: "win" });
    expect(recommendTeacherDiscards(viewFor("w11123429 s345678"))[0].tile).toBe(
      tile("wan", 9),
    );
  });

  it("同一公开视图的选择可复现，评估不修改输入", () => {
    const view = viewFor("w11123429 s345678");
    const snapshot = structuredClone(view);
    expect(recommendTeacherDiscards(view)).toEqual(
      recommendTeacherDiscards(structuredClone(view)),
    );
    expect(view).toEqual(snapshot);
  });

  it("近听时比较本桌收益，能说明更宽等待与清一色的取舍", () => {
    const view = viewFor("w1112344567779 s1");
    view.opponents[0].discards = hand("w88889");
    const old = recommendDiscards(view)[0];
    const advised = recommendTeacherDiscards(view)[0];
    expect(old.tile).toBe(tile("wan", 9));
    expect(advised.tile).toBe(tile("tiao", 1));
    expect(advised.shanten).toBe(old.shanten);
    expect(advised.effectiveCount).toBeLessThan(old.effectiveCount);
    expect(advised.summary).toContain("番型");
    expect(advised.reason).toContain("加 1");
    expect(advised.limit).toContain("不是实战胡牌率");
  });

  it("牌墙已空时按理论等待的查叫价值取舍，不预测下一摸", () => {
    const view = viewFor("w1112344567779 s1");
    view.opponents[0].discards = hand("w88889");
    view.wallRemaining = 0;
    const advised = recommendTeacherDiscards(view)[0];
    expect(advised.tile).toBe(tile("tiao", 1));
    expect(advised.reason).toContain("查叫");
    expect(advised.reason).not.toContain("一摸模型成胡");
  });

  it("公开六搭牌例保留四个并列候选，不讲成唯一正确", () => {
    // 公开来源与适用边界见 docs/ADVICE_CASE_AUDIT.md 的五搭牌原理。
    const advised = recommendTeacherDiscards(viewFor("w1245589 s1244589"));
    expect(advised.slice(0, 4).map((item) => item.tile)).toEqual(
      hand("w12 s12"),
    );
    expect(
      advised.slice(0, 4).every((item) => item.effectiveCount === 28),
    ).toBe(true);
    expect(advised[0].summary).toContain("并列");
  });
});
