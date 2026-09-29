import { describe, expect, it } from "vitest";
import { chooseBotDiscard, chooseBotExchange, chooseBotMissing } from "./bot";
import { completeExchange, completeMissing, playDemoRound } from "./demo";
import { countTiles, createGame } from "./game";
import { suitOf, tile } from "./tiles";

describe("固定电脑策略", () => {
  it("仅根据自己的手牌或合法出牌集合做确定性选择", () => {
    const hand = [
      tile("wan", 1),
      tile("wan", 2),
      tile("wan", 3),
      tile("tiao", 1),
      tile("tiao", 2),
      tile("tong", 9),
    ];
    expect(chooseBotExchange(hand)).toEqual(hand.slice(0, 3));
    expect(chooseBotMissing(hand)).toBe("tong");
    expect(chooseBotDiscard([tile("tiao", 8), tile("wan", 2)])).toBe(
      tile("tiao", 8),
    );
  });
});

describe("演示流程", () => {
  it("玩家出牌后电脑各摸打一轮，牌数守恒并回到玩家回合", () => {
    let state = createGame(20260929);
    state = completeExchange(state, chooseBotExchange(state.players[0].hand));
    state = completeMissing(state, suitOf(state.players[0].hand[0]));
    state = playDemoRound(state, state.players[0].hand[0]);
    expect(state.phase).toBe("discard");
    expect(state.turn).toBe(0);
    expect(
      state.players.slice(1).map((player) => player.discards.length),
    ).toEqual([1, 1, 1]);
    expect(countTiles(state)).toBe(108);
  });
});
