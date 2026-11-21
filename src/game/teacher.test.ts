import { describe, expect, it } from "vitest";
import { createGame } from "./game";
import {
  chooseTeacherAction,
  chooseTeacherMissing,
  recommendTeacherDiscards,
  teacherChoices,
} from "./teacher";
import { suitOf, tile, type Suit, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";
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

  it("同张数且同向听时，定缺不按固定花色顺序拆掉成顺", () => {
    // 万 4 张含 234 完整顺子，条 4 张仅为 12 边搭 + 68 嵌张；去掉任一门后剩余向听均为 3
    expect(chooseTeacherMissing(hand("w2348 s1268 d123569"))).toBe("tiao");
    // 种子 3：万 4 张为 1234 顺搭，条 4 张为 5699 无成顺
    expect(chooseTeacherMissing(createGame(3).players[0].hand)).toBe("tiao");
    // 种子 4：条 4 张含 789 成顺，筒 4 张为 5668 无成顺
    expect(chooseTeacherMissing(createGame(4).players[0].hand)).toBe("tong");
  });

  it("开局换牌与定缺解释用玩家可读语言，展示三门张数与清缺成本，不暴露算法黑话", () => {
    const view777 = playerView(createGame(777), 0);
    const exchangeChoice = teacherChoices(view777, "exchange")[0];
    expect(exchangeChoice.action).toEqual({
      type: "exchange",
      tiles: hand("s135"),
    });
    const exchangeText = `${exchangeChoice.summary}${exchangeChoice.reason}${exchangeChoice.limit}`;
    expect(exchangeText).toContain("三门张数");
    expect(exchangeText).toContain("余 1 张");
    expect(exchangeText).toContain("定缺");
    expect(exchangeText).not.toMatch(/同张计 4|相邻计 2|隔张计 1|固定牌序/);

    const missingChoices = teacherChoices(
      playerView(createGame(3), 0),
      "choose-missing",
    );
    expect(missingChoices[0].action).toEqual({ type: "missing", suit: "tiao" });
    const missingText = missingChoices
      .map((item) => `${item.summary}${item.reason}${item.limit}`)
      .join("");
    expect(missingText).toContain("三门张数");
    expect(missingText).toContain("当前向听下有效进张");
    expect(missingText).not.toMatch(/固定花色顺序|取较大值/);

    // 跨向听比较时明确提示向听越高离听牌越远，避免新手误把高向听的大进张数当成优势
    const crossShanten = teacherChoices(
      viewFor("w6 s12233555 d113578"),
      "choose-missing",
    );
    expect(crossShanten[0].action).toEqual({ type: "missing", suit: "wan" });
    expect(crossShanten[1].reason).toContain("离听牌更远");
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
    // 公开来源与适用边界见 docs/research/ADVICE_CASE_AUDIT.md 的五搭牌原理。
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
