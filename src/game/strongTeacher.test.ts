import { describe, expect, it } from "vitest";
import { publicCounts } from "./advice";
import {
  countTiles,
  createGame,
  discard,
  legalResponses,
  respond,
  type GameState,
} from "./game";
import { chooseStrongAction, recommendStrongDiscards } from "./strongTeacher";
import type { Meld } from "./scoring";
import { recommendTeacherDiscards } from "./teacher";
import { hand } from "./testHelpers";
import { createWall, tile, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

const onlyTerminalProof = {
  correctLegalWaits: false,
  adjustDrawBudget: false,
};

function ordinaryView(notation: string, melds: Meld[] = []): PlayerView {
  const owned = hand(notation);
  return {
    seat: 0,
    hand: owned,
    melds,
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
    wallRemaining: 40,
  };
}

// 本家持唯一一张已知1万，三家各四碰且各剩一张暗牌。
// 108张中其余牌全部公开，所以三张未见牌只能是1万。
function forcedTripleRonState(): GameState {
  const state = createGame(1);
  state.phase = "discard";
  state.turn = 0;
  state.wall = [];
  state.afterKong = false;
  state.lastDraw = {
    seat: 0,
    tile: tile("tiao", 9),
    fromKong: false,
    last: true,
  };
  const meldTiles = [[], hand("w2345"), hand("w6789"), hand("s2356")];
  state.players = meldTiles.map((melds, seat) => ({
    hand: seat === 0 ? hand("s1112344567779 w1") : hand("w1"),
    melds: melds.map((tile) => ({ type: "pung" as const, tile, from: 0 })),
    discards: [],
    missing: "tong",
    won: false,
    score: 0,
  }));
  const publicTiles = createWall();
  for (const player of state.players) {
    for (const owned of [
      ...player.hand,
      ...player.melds.flatMap((meld) => Array<Tile>(3).fill(meld.tile)),
    ]) {
      const index = publicTiles.indexOf(owned);
      if (index < 0) throw new Error("牌例超过四张同牌");
      publicTiles.splice(index, 1);
    }
  }
  publicTiles.forEach((tile, index) => {
    state.players[index % 4].discards.push(tile);
  });
  return state;
}

function finishDiscard(
  state: GameState,
  chosen: Tile,
  claimants = new Set([1, 2, 3]),
): GameState {
  let next = discard(state, 0, chosen);
  while (next.pending) {
    const seat = next.pending.eligible.find(
      (seat) => next.pending!.answers[seat] === undefined,
    );
    if (seat === undefined) throw new Error("响应没有可执行玩家");
    const legal = legalResponses(next, seat);
    next = respond(
      next,
      seat,
      legal.includes("hu") && claimants.has(seat) ? "hu" : "pass",
    );
  }
  return next;
}

describe("独立启用的强度候选：公开信息能证明的终局点炮", () => {
  it("同一完整牌例中，基线打1万一炮三响付20分，打9条保持听牌流局0分", () => {
    const state = forcedTripleRonState();
    const view = playerView(state, 0);
    expect(countTiles(state)).toBe(108);
    expect(publicCounts(view).map((count) => 4 - count)).toEqual([
      3,
      ...Array<number>(26).fill(0),
    ]);
    expect(recommendTeacherDiscards(view)[0].tile).toBe(tile("wan", 1));

    const bad = finishDiscard(state, tile("wan", 1));
    const safe = finishDiscard(state, tile("tiao", 9));
    expect(bad.phase).toBe("ended");
    expect(safe.phase).toBe("ended");
    expect(bad.players.map((player) => player.score)).toEqual([-20, 8, 8, 4]);
    expect(safe.players.map((player) => player.score)).toEqual([0, 0, 0, 0]);
    expect(countTiles(bad)).toBe(108);
    expect(countTiles(safe)).toBe(108);
  });

  it("只读本家视图，改选可证明终局净分更高的9条，并显示推断依据", () => {
    const view = playerView(forcedTripleRonState(), 0);
    const before = structuredClone(view);
    const best = recommendStrongDiscards(view)[0];
    expect(best.tile).toBe(tile("tiao", 9));
    expect(best.reason).toContain("未见牌");
    expect(best.reason).toContain("1万");
    expect(best.reason).toContain("0 分");
    expect(chooseStrongAction(view, "discard")).toEqual({
      type: "discard",
      tile: tile("tiao", 9),
    });
    expect(view).toEqual(before);
  });

  it("三家任意选择胡或过时，安全听牌收尾均不劣于打1万", () => {
    const state = forcedTripleRonState();
    for (let mask = 0; mask < 8; mask += 1) {
      const claimants = new Set(
        [1, 2, 3].filter((_, index) => mask & (1 << index)),
      );
      const bad = finishDiscard(state, tile("wan", 1), claimants);
      const safe = finishDiscard(state, tile("tiao", 9), claimants);
      expect(safe.players[0].score).toBe(0);
      expect(safe.players[0].score).toBeGreaterThanOrEqual(
        bad.players[0].score,
      );
      if (mask) expect(bad.players[0].score).toBeLessThan(0);
    }
  });

  it("还有摸牌机会时，保持原策略，不把本约束外推到中盘", () => {
    const view = playerView(forcedTripleRonState(), 0);
    view.wallRemaining = 1;
    expect(recommendStrongDiscards(view, onlyTerminalProof)).toEqual(
      recommendTeacherDiscards(view),
    );
  });

  it("未见牌不唯一时，保持原策略，不把可疑牌认成必然点炮", () => {
    const state = forcedTripleRonState();
    const revealed = state.players.find((player) =>
      player.discards.includes(tile("tiao", 8)),
    )!;
    const index = revealed.discards.indexOf(tile("tiao", 8));
    revealed.discards[index] = tile("wan", 1);
    state.players[1].hand = hand("s8");
    expect(countTiles(state)).toBe(108);
    const view = playerView(state, 0);
    expect(recommendStrongDiscards(view, onlyTerminalProof)).toEqual(
      recommendTeacherDiscards(view),
    );
  });

  it("对手仍持缺门牌而不能胡时，不使用单吊点炮结论", () => {
    const state = forcedTripleRonState();
    state.players[3].missing = "wan";
    const view = playerView(state, 0);
    expect(recommendStrongDiscards(view, onlyTerminalProof)).toEqual(
      recommendTeacherDiscards(view),
    );
  });

  it("牌数无法解释全部暗牌时，不从不完整公开信息下确定结论", () => {
    const state = forcedTripleRonState();
    state.players[0].discards.pop();
    const view = playerView(state, 0);
    expect(recommendStrongDiscards(view, onlyTerminalProof)).toEqual(
      recommendTeacherDiscards(view),
    );
  });
});

describe("候选的合法等待纠错与有限轮转取舍", () => {
  it("带副露的四张同牌假听牌在候选弃牌指标中按至少一向听处理", () => {
    const melds: Meld[] = [
      { type: "pung", tile: tile("wan", 2), from: 1 },
      { type: "kong", tile: tile("wan", 3), from: null, kongKind: "concealed" },
      { type: "pung", tile: tile("wan", 4), from: 1 },
    ];
    const view = ordinaryView("w11112", melds);
    expect(
      recommendTeacherDiscards(view).every((item) => item.shanten === 0),
    ).toBe(true);
    const corrected = recommendStrongDiscards(view);
    expect(corrected.every((item) => item.shanten === 1)).toBe(true);
    expect(corrected.every((item) => item.reason.includes("合法等待"))).toBe(
      true,
    );
  });

  it("正常轮转无本家摸牌预算时，按待评测的查叫取舍保留更高牌型分", () => {
    const view = ordinaryView("w1112344567779 s1");
    view.opponents[0].discards = hand("w8888999");
    view.wallRemaining = 1;
    expect(recommendTeacherDiscards(view)[0].tile).toBe(tile("wan", 9));
    const candidate = recommendStrongDiscards(view)[0];
    expect(candidate.tile).toBe(tile("tiao", 1));
    expect(candidate.reason).toContain("正常轮转");
    expect(candidate.reason).toContain("查叫");
    expect(candidate.limit).toContain("碰杠");
  });

  it("可关闭两项扩展用于消融，旧老师依然可独立调用", () => {
    const view = ordinaryView("w1112344567779 s1");
    view.opponents[0].discards = hand("w8888999");
    view.wallRemaining = 1;
    expect(recommendStrongDiscards(view, onlyTerminalProof)).toEqual(
      recommendTeacherDiscards(view),
    );
  });
});
