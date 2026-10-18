import { describe, expect, it } from "vitest";
import {
  countTiles,
  createGame,
  declareKong,
  discard,
  finishWall,
  legalResponses,
  respond,
  winSelf,
  type GameState,
} from "./game";
import type { Meld } from "./scoring";
import { hand } from "./testHelpers";
import { createWall, tile, type Tile } from "./tiles";
import { playerView } from "./view";

function scene(
  hands: Partial<Record<number, Tile[]>>,
  melds: Partial<Record<number, Meld[]>> = {},
): GameState {
  const available = createWall();
  const take = (item: Tile) => {
    const index = available.indexOf(item);
    if (index < 0) throw new Error(`牌例超过四张: ${item}`);
    available.splice(index, 1);
  };
  for (const owned of Object.values(hands)) {
    for (const item of owned ?? []) take(item);
  }
  for (const groups of Object.values(melds)) {
    for (const group of groups ?? []) {
      for (let n = 0; n < (group.type === "kong" ? 4 : 3); n += 1)
        take(group.tile);
    }
  }
  const state = createGame(1);
  state.players = state.players.map((player, seat) => ({
    ...player,
    hand:
      hands[seat] ?? available.splice(0, 13 - 3 * (melds[seat]?.length ?? 0)),
    melds: melds[seat] ?? [],
    missing: "tong",
  }));
  state.wall = available;
  state.phase = "discard";
  return state;
}

function answerRest(
  state: GameState,
  seat: number,
  choice: "pung" | "kong" | "hu",
) {
  let next = state;
  while (next.phase === "respond") {
    const actor = next.pending!.eligible.find(
      (other) => legalResponses(next, other).length,
    )!;
    next = respond(next, actor, actor === seat ? choice : "pass");
  }
  return next;
}

function expectBalancedLedger(state: GameState) {
  const scores = Array<number>(4).fill(0);
  for (const item of state.transfers) {
    scores[item.from] -= item.points;
    scores[item.to] += item.points;
  }
  expect(scores).toEqual(state.players.map((player) => player.score));
  expect(countTiles(state)).toBe(108);
}

describe("独立策略可读取的公开时序与结算账本", () => {
  it("新开局公开投影不含种子、牌墙及对手暗牌", () => {
    const state = createGame(19);
    expect(state.publicTiles).toEqual([]);
    expect(state.transfers).toEqual([]);
    const view = playerView(state, 0);
    expect(view.publicTiles).toEqual([]);
    expect(view).not.toHaveProperty("seed");
    expect(view).not.toHaveProperty("wall");
    expect(view.opponents.every((other) => !("hand" in other))).toBe(true);
  });

  it("碰牌移除最近被认领的弃牌，保留同值旧弃牌及其顺序", () => {
    const state = scene({
      0: hand("w123456789 s12345"),
      1: hand("w1123456789 s123"),
      2: hand("d1112223334445"),
      3: hand("d5566677788899"),
    });
    const chosen = tile("wan", 1);
    state.wall.splice(state.wall.indexOf(chosen), 1);
    state.players[0].discards.push(chosen);
    state.publicTiles.push({ seat: 0, tile: chosen, kind: "discard" });
    const dropped = discard(state, 0, chosen);
    expect(dropped.publicTiles).toHaveLength(2);
    const claimed = answerRest(dropped, 1, "pung");
    expect(claimed.publicTiles).toEqual([
      { seat: 0, tile: chosen, kind: "discard" },
    ]);
    expect(dropped.publicTiles).toHaveLength(2);
    expectBalancedLedger(claimed);
  });

  it("自摸仅公开胡张，投影副本不能修改牌局，逐笔付款可重算积分", () => {
    const state = scene({ 0: hand("w11123499 s345678") });
    const ended = winSelf(state, 0);
    const shown = { seat: 0, tile: tile("tiao", 8), kind: "self-win" };
    expect(ended.publicTiles).toEqual([shown]);
    expect(ended.transfers).toEqual(
      [1, 2, 3].map((from) => ({
        from,
        to: 0,
        points: 2,
        reason: "self-win",
      })),
    );
    const view = playerView(ended, 1);
    expect(view.publicTiles).toEqual([shown]);
    expect(view.opponents.find((other) => other.seat === 0)?.handCount).toBe(
      14,
    );
    view.publicTiles![0].tile = tile("wan", 9);
    expect(ended.publicTiles).toEqual([shown]);
    expect(state.publicTiles).toEqual([]);
    expectBalancedLedger(ended);
  });

  it("直杠与暗杠按实际付款分类，记录不改变牌数和旧状态", () => {
    const direct = answerRest(
      discard(
        scene({
          0: hand("w123456789 s12345"),
          1: hand("w1112345678 s123"),
        }),
        0,
        tile("wan", 1),
      ),
      1,
      "kong",
    );
    expect(direct.transfers).toEqual([
      { from: 0, to: 1, points: 2, reason: "direct-kong" },
    ]);
    expect(direct.publicTiles).toEqual([]);
    expectBalancedLedger(direct);
    const before = scene({ 0: hand("w111123456789 s12") });
    const concealed = declareKong(before, 0, "concealed", tile("wan", 1));
    expect(concealed.transfers).toHaveLength(3);
    expect(
      concealed.transfers.every(
        (item) => item.reason === "concealed-kong" && item.points === 2,
      ),
    ).toBe(true);
    expect(before.transfers).toEqual([]);
    expectBalancedLedger(concealed);
  });

  it("补杠遭抢时只记点胡付款，并公开被抢的牌，不收补杠钱", () => {
    const state = scene(
      {
        0: hand("w123456789 s12"),
        1: hand("w23 w456 w789 s123 s55"),
      },
      { 0: [{ type: "pung", tile: tile("wan", 1), from: 2 }] },
    );
    const robbed = answerRest(
      declareKong(state, 0, "added", tile("wan", 1)),
      1,
      "hu",
    );
    expect(robbed.transfers).toHaveLength(1);
    expect(robbed.transfers[0]).toMatchObject({
      from: 0,
      to: 1,
      reason: "discard-win",
    });
    expect(robbed.publicTiles).toEqual([
      { seat: 0, tile: tile("wan", 1), kind: "discard" },
    ]);
    expectBalancedLedger(robbed);
  });

  it("墙尽的花猪与查叫分别记账，所有分类合计等于最终积分", () => {
    const state = scene({
      0: hand("w1112349 s34567 d8"),
      1: hand("w1234567 s123456"),
    });
    state.players[2].missing = "wan";
    state.players[3].missing = "wan";
    state.players[3].discards.push(...state.wall.splice(0));
    const ended = finishWall(state);
    expect(ended.transfers.some((item) => item.reason === "flower")).toBe(true);
    expect(
      ended.transfers.every(
        (item) => item.reason === "flower" || item.reason === "ready",
      ),
    ).toBe(true);
    expectBalancedLedger(ended);
  });
});
