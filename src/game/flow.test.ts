import { describe, expect, it } from "vitest";
import {
  countTiles,
  createGame,
  declareKong,
  discard,
  finishWall,
  legalResponses,
  legalSelfActions,
  respond,
  winSelf,
  type GameState,
} from "./game";
import { createWall, tile, type Tile } from "./tiles";
import { hand } from "./testHelpers";
import type { Meld } from "./scoring";

function scene(
  hands: Partial<Record<number, Tile[]>>,
  melds: Partial<Record<number, Meld[]>> = {},
  emptyWall = false,
): GameState {
  const available = createWall();
  const take = (items: readonly Tile[]) => {
    for (const item of items) {
      const index = available.indexOf(item);
      if (index < 0) throw new Error(`牌例超过四张：${item}`);
      available.splice(index, 1);
    }
  };
  for (const values of Object.values(hands)) if (values) take(values);
  for (const groups of Object.values(melds)) {
    for (const group of groups ?? [])
      take(Array(group.type === "kong" ? 4 : 3).fill(group.tile));
  }
  const players = Array.from({ length: 4 }, (_, seat) => {
    const groups = melds[seat] ?? [];
    const count = (seat === 0 ? 14 : 13) - groups.length * 3;
    const owned = hands[seat] ?? available.splice(0, count);
    return {
      hand: [...owned],
      melds: [...groups],
      discards: [] as Tile[],
      missing: "tong" as const,
      won: false,
      score: 0,
    };
  });
  if (emptyWall) players[3].discards.push(...available.splice(0));
  return {
    ...createGame(1),
    players,
    wall: available,
    phase: "discard",
    turn: 0,
  };
}

function answerRest(
  state: GameState,
  choices: Partial<Record<number, "pass" | "hu" | "pung" | "kong">> = {},
) {
  let next = state;
  for (let seat = 0; seat < 4; seat += 1) {
    if (next.phase === "respond" && legalResponses(next, seat).length > 0) {
      next = respond(next, seat, choices[seat] ?? "pass");
    }
  }
  return next;
}

describe("可玩的血战流程", () => {
  it("庄家自摸胡后退出，其余三家继续，支付零和", () => {
    const state = scene({ 0: hand("w11123499 s345678") });
    expect(legalSelfActions(state, 0).canWin).toBe(true);
    const next = winSelf(state, 0);
    expect(next.players[0].won).toBe(true);
    expect(next.players.map((player) => player.score)).toEqual([6, -2, -2, -2]);
    expect(next.phase).toBe("draw");
    expect(next.turn).toBe(1);
    expect(countTiles(next)).toBe(108);
  });

  it("同一张弃牌可由两家胡，均由点炮者支付", () => {
    let state = scene({
      0: hand("w123456789 s12345"),
      1: hand("w1234567 s123456"),
      2: hand("w1789 s123456789"),
    });
    state = discard(state, 0, tile("wan", 1));
    expect(legalResponses(state, 1)).toContain("hu");
    expect(legalResponses(state, 2)).toContain("hu");
    state = answerRest(state, { 1: "hu", 2: "hu" });
    expect(state.players[1].won).toBe(true);
    expect(state.players[2].won).toBe(true);
    expect(state.players.reduce((sum, player) => sum + player.score, 0)).toBe(
      0,
    );
    expect(state.turn).toBe(3);
    expect(countTiles(state)).toBe(108);
  });

  it("碰与直杠认领弃牌，补牌从墙尾取，杠钱由点杠者付", () => {
    let pung = scene({
      0: hand("w123456789 s12345"),
      1: hand("w1123456789 s123"),
    });
    pung = answerRest(discard(pung, 0, tile("wan", 1)), { 1: "pung" });
    expect(pung.phase).toBe("discard");
    expect(pung.turn).toBe(1);
    expect(pung.players[1].melds[0]).toMatchObject({
      type: "pung",
      tile: tile("wan", 1),
    });
    expect(countTiles(pung)).toBe(108);

    let kong = scene({
      0: hand("w123456789 s12345"),
      1: hand("w1112345678 s123"),
    });
    const tail = kong.wall.at(-1);
    kong = answerRest(discard(kong, 0, tile("wan", 1)), { 1: "kong" });
    expect(kong.players[1].melds[0].kongKind).toBe("direct");
    expect(kong.players[1].hand).toContain(tail);
    expect(kong.players[0].score).toBe(-2);
    expect(kong.players[1].score).toBe(2);
    expect(countTiles(kong)).toBe(108);
  });

  it("碰牌后只能出牌，不能把碰出的完整牌型当成自摸", () => {
    const state = scene({
      0: hand("w123456789 s12345"),
      1: hand("w11234234 s34566"),
    });
    const claimed = answerRest(discard(state, 0, tile("wan", 1)), {
      1: "pung",
    });
    expect(claimed.phase).toBe("discard");
    expect(legalSelfActions(claimed, 1).canWin).toBe(false);
    expect(() => winSelf(claimed, 1)).toThrow("当前不能自摸胡");
  });

  it("暗杠各家付 2；补杠遭抢杠时不成立且不收杠钱", () => {
    let concealed = scene({ 0: hand("w111123456789 s12") });
    expect(legalSelfActions(concealed, 0).concealedKongs).toContain(
      tile("wan", 1),
    );
    concealed = declareKong(concealed, 0, "concealed", tile("wan", 1));
    expect(concealed.players.map((player) => player.score)).toEqual([
      6, -2, -2, -2,
    ]);
    expect(countTiles(concealed)).toBe(108);

    let added = scene(
      { 0: hand("w123456789 s12"), 1: hand("w23 w456 w789 s123 s55") },
      { 0: [{ type: "pung", tile: tile("wan", 1), from: 2 }] },
    );
    expect(legalSelfActions(added, 0).addedKongs).toContain(tile("wan", 1));
    added = declareKong(added, 0, "added", tile("wan", 1));
    expect(legalResponses(added, 1)).toContain("hu");
    added = answerRest(added, { 1: "hu" });
    expect(added.players[0].melds[0].type).toBe("pung");
    expect(added.players[1].won).toBe(true);
    expect(added.players[0].score).toBeLessThan(0);
    expect(countTiles(added)).toBe(108);
  });

  it("第三家胡牌立即结束，即使牌墙未摸尽", () => {
    const state = scene({ 0: hand("w11123499 s345678") });
    state.players[2].won = true;
    state.players[3].won = true;
    const ended = winSelf(state, 0);
    expect(ended.phase).toBe("ended");
    expect(ended.endReason).toBe("three-wins");
    expect(ended.wall.length).toBeGreaterThan(0);
  });

  it("墙尽查花猪与查叫，所有支付保持零和", () => {
    const state = scene(
      { 0: hand("w1112349 s34567 d8"), 1: hand("w1234567 s123456") },
      {},
      true,
    );
    state.players[0].missing = "tong";
    state.players[1].missing = "tong";
    state.players[2].missing = "wan";
    state.players[3].missing = "wan";
    const ended = finishWall(state);
    expect(ended.phase).toBe("ended");
    expect(ended.endReason).toBe("wall");
    expect(ended.players[0].score).toBeLessThan(0);
    expect(ended.players.reduce((sum, player) => sum + player.score, 0)).toBe(
      0,
    );
    expect(countTiles(ended)).toBe(108);
  });
});
