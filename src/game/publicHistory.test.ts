import { describe, expect, it } from "vitest";
import { chooseBotExchange } from "./bot";
import { completeExchange } from "./demo";
import {
  chooseMissing,
  countTiles,
  createGame,
  declareKong,
  discard,
  draw,
  legalResponses,
  respond,
  winSelf,
  type GameState,
  type ResponseChoice,
} from "./game";
import type { Meld } from "./scoring";
import { hand } from "./testHelpers";
import { createWall, suitOf, tile, type Tile } from "./tiles";
import { playerView } from "./view";

function scene(
  hands: Partial<Record<number, Tile[]>>,
  melds: Partial<Record<number, Meld[]>> = {},
): GameState {
  const available = createWall();
  const take = (items: readonly Tile[]) => {
    for (const item of items) {
      const index = available.indexOf(item);
      if (index < 0) throw new Error(`牌例超过四张：${item}`);
      available.splice(index, 1);
    }
  };
  for (const owned of Object.values(hands)) take(owned ?? []);
  for (const groups of Object.values(melds))
    for (const group of groups ?? [])
      take(Array(group.type === "kong" ? 4 : 3).fill(group.tile));
  const state = createGame(1);
  state.players = state.players.map((player, seat) => ({
    ...player,
    hand:
      hands[seat] ?? available.splice(0, 13 - (melds[seat]?.length ?? 0) * 3),
    melds: melds[seat] ?? [],
    missing: "tong",
  }));
  state.wall = available;
  state.phase = "discard";
  return state;
}

function answerRest(
  state: GameState,
  choices: Partial<Record<number, ResponseChoice>> = {},
): GameState {
  let next = state;
  while (next.phase === "respond") {
    const seat = next.pending!.eligible.find(
      (actor) => legalResponses(next, actor).length,
    )!;
    next = respond(next, seat, choices[seat] ?? "pass");
  }
  expect(countTiles(next)).toBe(108);
  return next;
}

function addedKongScene(): GameState {
  return scene(
    {
      0: hand("w123456789 s12"),
      1: hand("w23 w456 w789 s123 s55"),
    },
    { 0: [{ type: "pung", tile: tile("wan", 1), from: 2 }] },
  );
}

describe("实际公开动作的完整顺序历史", () => {
  it("庄家初始14张、换牌与尚未同时公开的定缺均不伪造行牌事件", () => {
    const initial = createGame(19);
    expect(initial.publicActions).toEqual([]);
    expect(playerView(initial, 1).publicActions).toEqual([]);
    let state = completeExchange(
      initial,
      chooseBotExchange(initial.players[0].hand),
    );
    state = chooseMissing(state, 0, "tong");
    expect(state.phase).toBe("choose-missing");
    expect(playerView(state, 1).publicActions).toEqual([]);
    for (const seat of [1, 2, 3]) state = chooseMissing(state, seat, "tong");
    expect(state.phase).toBe("discard");
    expect(state.publicActions).toEqual([]);
  });

  it("普通摸牌只公开谁摸牌，不泄露所摸的牌或私有响应资格", () => {
    const chosen = tile("wan", 1);
    const before = scene({
      0: hand("w123456789 s12345"),
      1: hand("w1123456789 s123"),
    });
    const dropped = discard(before, 0, chosen);
    expect(dropped.publicActions).toEqual([
      { seat: 0, kind: "discard", tile: chosen },
    ]);
    const passed = answerRest(dropped);
    expect(passed.publicActions).toEqual(dropped.publicActions);
    const drawn = draw(passed, passed.turn);
    expect(drawn.publicActions).toEqual([
      { seat: 0, kind: "discard", tile: chosen },
      { seat: 1, kind: "draw" },
    ]);
    expect(Object.keys(drawn.publicActions.at(-1)!)).toEqual(["seat", "kind"]);
    expect(countTiles(drawn)).toBe(108);
    expect(before.publicActions).toEqual([]);
  });

  it("碰牌永久保留原弃牌历史，库存中则移除已认领弃牌", () => {
    const chosen = tile("wan", 1);
    const dropped = discard(
      scene({
        0: hand("w123456789 s12345"),
        1: hand("w1123456789 s123"),
      }),
      0,
      chosen,
    );
    const claimed = answerRest(dropped, { 1: "pung" });
    expect(claimed.publicActions).toEqual([
      { seat: 0, kind: "discard", tile: chosen },
      { seat: 1, kind: "pung", tile: chosen, from: 0 },
    ]);
    expect(claimed.publicTiles).toEqual([]);
    expect(dropped.publicActions).toHaveLength(1);
  });

  it("直杠先记录认领，再记录无牌面的补摸；响应未采纳时不记杠", () => {
    const chosen = tile("wan", 1);
    const claimed = answerRest(
      discard(
        scene({
          0: hand("w123456789 s12345"),
          1: hand("w1112345678 s123"),
        }),
        0,
        chosen,
      ),
      { 1: "kong" },
    );
    expect(claimed.publicActions).toEqual([
      { seat: 0, kind: "discard", tile: chosen },
      { seat: 1, kind: "kong", tile: chosen, kongKind: "direct", from: 0 },
      { seat: 1, kind: "draw" },
    ]);
    expect(claimed.publicTiles).toEqual([]);
  });

  it("暗杠公开牌及杠种，补摸不公开牌，不把庄家初始手牌记成摸牌", () => {
    const before = scene({ 0: hand("w111123456789 s12") });
    const next = declareKong(before, 0, "concealed", tile("wan", 1));
    expect(next.publicActions).toEqual([
      {
        seat: 0,
        kind: "kong",
        tile: tile("wan", 1),
        kongKind: "concealed",
        from: null,
      },
      { seat: 0, kind: "draw" },
    ]);
    expect(before.publicActions).toEqual([]);
    expect(countTiles(next)).toBe(108);
  });

  it("补杠提议在进入抢杠响应前公开，被抢后不伪造出牌或成功杠事件", () => {
    const chosen = tile("wan", 1);
    const offered = declareKong(addedKongScene(), 0, "added", chosen);
    expect(offered.phase).toBe("respond");
    expect(offered.publicActions).toEqual([
      { seat: 0, kind: "added-kong-offer", tile: chosen },
    ]);
    expect(playerView(offered, 1).publicActions).toEqual(offered.publicActions);
    const robbed = answerRest(offered, { 1: "hu" });
    expect(robbed.publicActions).toEqual([
      { seat: 0, kind: "added-kong-offer", tile: chosen },
      { seat: 1, kind: "win", tile: chosen, winKind: "rob-kong", from: 0 },
    ]);
    expect(robbed.publicTiles).toEqual([
      { seat: 0, tile: chosen, kind: "discard" },
    ]);
    expect(offered.publicActions).toHaveLength(1);
  });

  it("抢杠都过时补杠提议只记一次，成功后直接记录补摸", () => {
    const chosen = tile("wan", 1);
    const offered = declareKong(addedKongScene(), 0, "added", chosen);
    const completed = answerRest(offered);
    expect(completed.publicActions).toEqual([
      { seat: 0, kind: "added-kong-offer", tile: chosen },
      { seat: 0, kind: "draw" },
    ]);
    expect(completed.players[0].melds[0].kongKind).toBe("added");
  });

  it("无人可抢杠时也只记录一次补杠提议及补摸", () => {
    const state = addedKongScene();
    for (const player of state.players.slice(1))
      player.missing = suitOf(player.hand[0]);
    const next = declareKong(state, 0, "added", tile("wan", 1));
    expect(next.phase).toBe("discard");
    expect(next.publicActions).toEqual([
      { seat: 0, kind: "added-kong-offer", tile: tile("wan", 1) },
      { seat: 0, kind: "draw" },
    ]);
    expect(countTiles(next)).toBe(108);
  });

  it("同一弃牌多家胡按实际裁决座次记win，响应到达顺序不泄露也不改变顺序", () => {
    const chosen = tile("wan", 1);
    const dropped = discard(
      scene({
        0: hand("w123456789 s12345"),
        1: hand("w1234567 s123456"),
        2: hand("w1789 s123456789"),
      }),
      0,
      chosen,
    );
    const answered = respond(dropped, 2, "hu");
    expect(answered.publicActions).toEqual(dropped.publicActions);
    const next = answerRest(answered, { 1: "hu" });
    expect(next.publicActions).toEqual([
      { seat: 0, kind: "discard", tile: chosen },
      { seat: 1, kind: "win", tile: chosen, winKind: "discard", from: 0 },
      { seat: 2, kind: "win", tile: chosen, winKind: "discard", from: 0 },
    ]);
    expect(next.publicTiles).toEqual([
      { seat: 0, tile: chosen, kind: "discard" },
    ]);
  });

  it("自摸公开胡张与self类型，库存只加入这张一次且不伪造摸牌事件", () => {
    const next = winSelf(scene({ 0: hand("w11123499 s345678") }), 0);
    const chosen = tile("tiao", 8);
    expect(next.publicActions).toEqual([
      { seat: 0, kind: "win", tile: chosen, winKind: "self", from: null },
    ]);
    expect(next.publicTiles).toEqual([
      { seat: 0, tile: chosen, kind: "self-win" },
    ]);
    expect(countTiles(next)).toBe(108);
  });

  it("状态转换与公开投影都复制历史条目，修改副本不会污染原状态", () => {
    const chosen = tile("wan", 1);
    const dropped = discard(
      scene({
        0: hand("w123456789 s12345"),
        1: hand("w1123456789 s123"),
      }),
      0,
      chosen,
    );
    const passed = answerRest(dropped);
    expect(passed.publicActions).not.toBe(dropped.publicActions);
    expect(passed.publicActions[0]).not.toBe(dropped.publicActions[0]);
    passed.publicActions[0].seat = 3;
    const view = playerView(dropped, 2);
    expect(view.publicActions).not.toBe(dropped.publicActions);
    expect(view.publicActions![0]).not.toBe(dropped.publicActions[0]);
    view.publicActions![0].seat = 2;
    view.publicActions!.length = 0;
    expect(dropped.publicActions).toEqual([
      { seat: 0, kind: "discard", tile: chosen },
    ]);
  });
});
