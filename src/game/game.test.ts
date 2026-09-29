import { describe, expect, it } from "vitest";
import {
  chooseExchange,
  chooseMissing,
  countTiles,
  createGame,
  discard,
  draw,
  legalDiscards,
  legalResponses,
  respond,
} from "./game";
import { suitOf, type Tile } from "./tiles";

function firstSameSuitThree(hand: Tile[]): Tile[] {
  for (const suit of ["wan", "tiao", "tong"] as const) {
    const group = hand.filter((item) => suitOf(item) === suit);
    if (group.length >= 3) return group.slice(0, 3);
  }
  throw new Error("13 张牌必有一门至少 3 张");
}

describe("开局状态与合法动作", () => {
  it("四人同时换三张，只有同门且真实持有的牌可选", () => {
    let state = createGame(42);
    const original = state.players.map((player) => [...player.hand]);
    expect(state.phase).toBe("exchange");
    expect(() => chooseExchange(state, 0, [0, 9, 18])).toThrow();
    expect(() => chooseExchange(state, 0, [0, 0, 0])).toThrow();
    for (let seat = 0; seat < 4; seat += 1) {
      state = chooseExchange(
        state,
        seat,
        firstSameSuitThree(state.players[seat].hand),
      );
      if (seat < 3)
        expect(state.players.map((player) => player.hand)).toEqual(original);
    }
    expect(state.phase).toBe("choose-missing");
    expect(state.players.every((player) => player.hand.length >= 13)).toBe(
      true,
    );
    expect(countTiles(state)).toBe(108);
    for (let seat = 0; seat < 4; seat += 1) {
      const sent = firstSameSuitThree(original[(seat + 3) % 4]);
      expect(
        sent.every((item) => state.players[seat].hand.includes(item)),
      ).toBe(true);
    }
  });

  it("牌墙摸尽后完成最后一次出牌才结束，过程中保持 108 张", () => {
    let state = createGame(2026);
    for (let seat = 0; seat < 4; seat += 1) {
      state = chooseExchange(
        state,
        seat,
        firstSameSuitThree(state.players[seat].hand),
      );
    }
    for (let seat = 0; seat < 4; seat += 1)
      state = chooseMissing(state, seat, "wan");
    while (state.phase !== "ended") {
      if (state.phase === "draw") state = draw(state, state.turn);
      else if (state.phase === "respond") {
        const seat = state.pending!.eligible.find(
          (item) => legalResponses(state, item).length > 0,
        )!;
        state = respond(state, seat, "pass");
      } else
        state = discard(state, state.turn, legalDiscards(state, state.turn)[0]);
      expect(countTiles(state)).toBe(108);
    }
    expect(state.wall).toHaveLength(0);
    expect(
      state.players.reduce(
        (total, player) => total + player.discards.length,
        0,
      ),
    ).toBe(56);
  });

  it("定缺完成才轮到庄，缺门牌未清时必须先打缺门", () => {
    let state = createGame(9);
    for (let seat = 0; seat < 4; seat += 1) {
      state = chooseExchange(
        state,
        seat,
        firstSameSuitThree(state.players[seat].hand),
      );
    }
    const missing = suitOf(state.players[0].hand[0]);
    for (let seat = 0; seat < 4; seat += 1) {
      state = chooseMissing(state, seat, missing);
    }
    expect(state.phase).toBe("discard");
    expect(state.turn).toBe(0);
    const hand = state.players[0].hand;
    const options = legalDiscards(state, 0);
    const missingTiles = hand.filter((item) => suitOf(item) === missing);
    expect(options).toEqual([...new Set(missingTiles)].sort((a, b) => a - b));
    expect(() => discard(state, 1, state.players[1].hand[0])).toThrow();
    expect(() =>
      discard(
        state,
        0,
        hand.find((item) => suitOf(item) !== missing)!,
      ),
    ).toThrow();
    state = discard(state, 0, options[0]);
    expect(state.phase).toBe("draw");
    expect(state.turn).toBe(1);
    expect(countTiles(state)).toBe(108);
    state = draw(state, 1);
    expect(state.phase).toBe("discard");
    expect(state.players[1].hand).toHaveLength(14);
    expect(countTiles(state)).toBe(108);
  });
});
