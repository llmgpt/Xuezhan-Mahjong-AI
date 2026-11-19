import { describe, expect, it } from "vitest";
import { recommendDiscards } from "../game/advice";
import { createGame } from "../game/game";
import type { Meld } from "../game/scoring";
import { hand } from "../game/testHelpers";
import { suitOf, tile, type Suit } from "../game/tiles";
import { playerView, type PlayerView } from "../game/view";
import { buildTileBreakdown } from "./tileBreakdown";

function discardView(
  notation: string,
  missing: Suit,
  melds: Meld[] = [],
  extraDiscards: number[] = [],
): PlayerView {
  const state = createGame(1);
  state.phase = "discard";
  state.players[0].hand = hand(notation);
  state.players[0].melds = melds;
  state.players.forEach((player) => {
    player.missing = missing;
  });
  state.players[1].discards = extraDiscards;
  return playerView(state, 0);
}

function respondView(
  notation: string,
  discardTile: number,
  choices: ("pass" | "pung" | "kong" | "hu")[],
  responseKind: "discard" | "rob-kong" = "discard",
): PlayerView {
  const state = createGame(1);
  state.phase = "respond";
  state.turn = 1;
  state.players[0].hand = hand(notation);
  state.players.forEach((player) => {
    player.missing = "tong";
  });
  if (responseKind === "discard") {
    state.players[1].discards = [discardTile];
  }
  const view = playerView(state, 0);
  view.decision = {
    kind: "respond",
    responseKind,
    from: 1,
    tile: discardTile,
    choices,
  };
  return view;
}

describe("客观牌效与听牌算账明细", () => {
  it("定缺未清时只统计余下的缺门牌，不提前排向听高低", () => {
    const view = discardView("w1223779 d2346778", "wan");
    const result = buildTileBreakdown(view, {
      recommendedAction: { type: "discard", tile: tile("wan", 1) },
      chosenAction: { type: "discard", tile: tile("wan", 9) },
    });
    expect(result.kind).toBe("missing");
    expect(result.missingRemainingTiles).toEqual(
      view.hand.filter((item) => suitOf(item) === "wan").sort((a, b) => a - b),
    );
    expect(result.divergesFromEfficiency).toBe(false);
    expect(result.rows.find((row) => row.isRecommended)?.label).toContain(
      "1万",
    );
    expect(result.rows.find((row) => row.isChosen)?.label).toContain("9万");
  });

  it("出牌阶段计算向听、有效进张与推荐/自选分歧，且总是保留对应候选项", () => {
    const view = discardView("w1245589 s1244589", "tong");
    const result = buildTileBreakdown(view, {
      recommendedAction: { type: "discard", tile: tile("wan", 5) },
      chosenAction: { type: "discard", tile: tile("tiao", 5) },
    });
    expect(result.kind).toBe("discard");
    expect(result.divergesFromEfficiency).toBe(true);

    const top = result.rows.find((row) => row.isTopEfficiency);
    const engineTop = recommendDiscards(view)[0];
    expect(top).toBeDefined();
    expect(top!.shanten).toBe(engineTop.shanten);
    expect(top!.effectiveTotal).toBe(engineTop.effectiveCount);
    expect([
      tile("wan", 1),
      tile("wan", 2),
      tile("tiao", 1),
      tile("tiao", 2),
    ]).toContain((top!.action as { type: "discard"; tile: number }).tile);

    const rec = result.rows.find((row) => row.isRecommended);
    const chosen = result.rows.find((row) => row.isChosen);
    expect(rec?.label).toContain("5万");
    expect(chosen?.label).toContain("5条");
    expect(top!.effectiveTotal).toBeGreaterThan(rec!.effectiveTotal);
  });

  it("听牌时按桌面与手牌扣减真实余张，区分已见完 0 张并列出底分番型", () => {
    // 打 9万 后手牌 w1112342 s345678，理论听 2万/3万/5万；把 4 张 5万 放到公开弃牌中。
    const wan5 = tile("wan", 5);
    const view = discardView(
      "w11123429 s345678",
      "tong",
      [],
      [wan5, wan5, wan5, wan5],
    );
    const result = buildTileBreakdown(view);
    const d9 = result.rows.find(
      (row) =>
        row.action?.type === "discard" && row.action.tile === tile("wan", 9),
    );
    expect(d9).toBeDefined();
    expect(d9!.shanten).toBe(0);
    // 2万 手持 2 张余 2，3万 手持 1 张余 3，合计 5 张（已扣掉 5万 的 4 张）
    expect(d9!.effectiveTotal).toBe(5);
    expect(d9!.waits.map((item) => [item.tile, item.remaining])).toEqual([
      [tile("wan", 2), 2],
      [tile("wan", 3), 3],
    ]);
    expect(d9!.exhaustedWaits.map((item) => item.tile)).toEqual([wan5]);
    expect(d9!.waits[0].winPoints).toBeGreaterThanOrEqual(1);
    expect(d9!.waits[0].winPatterns?.length).toBeGreaterThan(0);
  });

  it("响应阶段对比碰后最佳弃牌与过，并展示胡牌/抢杠胡底分", () => {
    const pungResult = buildTileBreakdown(
      respondView("w1122589 s123679", tile("wan", 1), ["pass", "pung"]),
    );
    expect(pungResult.kind).toBe("respond");
    const pungRow = pungResult.rows.find(
      (row) => row.action?.type === "respond" && row.action.choice === "pung",
    );
    const passRow = pungResult.rows.find(
      (row) => row.action?.type === "respond" && row.action.choice === "pass",
    );
    expect(pungRow).toBeDefined();
    expect(passRow).toBeDefined();
    expect(pungRow!.shanten!).toBeLessThanOrEqual(passRow!.shanten!);
    expect(pungRow!.label).toContain("碰 1万");
    expect(pungRow!.note).toContain("打");

    const robKongResult = buildTileBreakdown(
      respondView(
        "w11 s12345678911",
        tile("wan", 1),
        ["pass", "hu"],
        "rob-kong",
      ),
      { recommendedAction: { type: "respond", choice: "hu" } },
    );
    const huRow = robKongResult.rows.find(
      (row) => row.action?.type === "respond" && row.action.choice === "hu",
    );
    const robPassRow = robKongResult.rows.find(
      (row) => row.action?.type === "respond" && row.action.choice === "pass",
    );
    expect(huRow?.shanten).toBe(-1);
    expect(huRow?.maxWinPoints).toBeGreaterThanOrEqual(2);
    expect(huRow?.note).toContain("抢杠");
    expect(robPassRow?.isTopEfficiency).not.toBe(true);
    expect(robKongResult.divergesFromEfficiency).toBe(false);
  });

  it("可点胡时绝不把过标成纯牌效最优；若策略暂不点胡，顶格比较对象应是胡牌本身", () => {
    const view = respondView("w45667899 s12345", tile("wan", 3), [
      "pass",
      "hu",
    ]);
    const accept = buildTileBreakdown(view, {
      recommendedAction: { type: "respond", choice: "hu" },
    });
    const passRow = accept.rows.find(
      (row) => row.action?.type === "respond" && row.action.choice === "pass",
    );
    expect(passRow?.isTopEfficiency).not.toBe(true);
    expect(accept.divergesFromEfficiency).toBe(false);

    const refuse = buildTileBreakdown(view, {
      recommendedAction: { type: "respond", choice: "pass" },
    });
    expect(refuse.divergesFromEfficiency).toBe(true);
    expect(refuse.topEfficiencyLabel).toContain("点胡");
    expect(refuse.divergenceNote).toContain("当前可和牌");
  });

  it("同向听同进张时低番打法不与高番打法并列纯牌效最优", () => {
    // 种子 42 第 15 手原型：碰 6条、碰 1筒，手牌 345条 + 12346筒
    const view = discardView("s345 d12346", "wan", [
      { type: "pung", tile: tile("tiao", 6), from: 3 },
      { type: "pung", tile: tile("tong", 1), from: 2 },
    ]);
    view.decision = {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [tile("tong", 1)],
    };
    const result = buildTileBreakdown(view, {
      recommendedAction: {
        type: "kong",
        kind: "added",
        tile: tile("tong", 1),
      },
    });
    const discard1Tong = result.rows.find(
      (row) =>
        row.action?.type === "discard" && row.action.tile === tile("tong", 1),
    );
    const discard4Tong = result.rows.find(
      (row) =>
        row.action?.type === "discard" && row.action.tile === tile("tong", 4),
    );
    expect(discard4Tong?.maxWinPoints).toBe(2);
    expect(discard1Tong?.maxWinPoints).toBe(1);
    expect(discard4Tong?.isTopEfficiency).toBe(true);
    expect(discard1Tong?.isTopEfficiency).not.toBe(true);
  });

  it("策略推荐退向听或补杠拆听时，如实说明退向听损失，不误导为高番路线", () => {
    // 种子 42 第 13 手原型：碰 6条、碰 1筒，手牌 3455条 + 1236筒（公开已见完部分 2条/5条）
    const tiao2 = tile("tiao", 2);
    const tiao5 = tile("tiao", 5);
    const view = discardView(
      "s3455 d1236",
      "wan",
      [
        { type: "pung", tile: tile("tiao", 6), from: 3 },
        { type: "pung", tile: tile("tong", 1), from: 2 },
      ],
      [tiao2, tiao2, tiao2, tiao5, tiao5],
    );
    view.decision = {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [tile("tong", 1)],
    };
    const result = buildTileBreakdown(view, {
      recommendedAction: {
        type: "kong",
        kind: "added",
        tile: tile("tong", 1),
      },
    });
    expect(result.divergesFromEfficiency).toBe(true);
    expect(result.topEfficiencyLabel).toBe("打 5条");
    expect(result.divergenceNote).toContain("退回 1 向听");
    expect(result.divergenceNote).not.toContain("高番路线");
  });

  it("1向听仅有极窄进张时标出窄门提醒，并保留更宽的2向听候选项对照", () => {
    // 种子 777 第 6 手原型：3456889万 + 2336789筒，外已见两张 7万
    const wan7 = tile("wan", 7);
    const view = discardView("w3456889 d2336789", "tiao", [], [wan7, wan7]);
    const result = buildTileBreakdown(view, {
      recommendedAction: { type: "discard", tile: tile("tong", 9) },
    });
    const d9Tong = result.rows.find(
      (row) =>
        row.action?.type === "discard" && row.action.tile === tile("tong", 9),
    );
    expect(d9Tong?.shanten).toBe(1);
    expect(d9Tong?.effectiveTotal).toBe(2);
    expect(d9Tong?.note).toContain("窄门");
    expect(
      result.rows.some((row) => row.shanten === 2 && row.effectiveTotal > 10),
    ).toBe(true);
  });

  it("有自摸胡或暗杠机会时展示自摸番型及杠前后向听对照", () => {
    const winView = discardView("w11123499 s345678", "tong");
    const winResult = buildTileBreakdown(winView);
    const winRow = winResult.rows.find((row) => row.action?.type === "win");
    expect(winRow).toBeDefined();
    expect(winRow!.shanten).toBe(-1);
    expect(winRow!.maxWinPoints).toBeGreaterThanOrEqual(1);
    expect(winRow!.note).toContain("自摸");

    const kongView = discardView("w1111 s1234567891", "tong");
    const kongResult = buildTileBreakdown(kongView);
    const kongRow = kongResult.rows.find(
      (row) => row.action?.type === "kong" && row.action.kind === "concealed",
    );
    expect(kongRow).toBeDefined();
    expect(kongRow!.label).toContain("暗杠 1万");
    expect(kongRow!.shanten).toBe(0);
    expect(kongRow!.waits.length).toBeGreaterThan(0);
  });
});
