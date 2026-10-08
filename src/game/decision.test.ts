import { describe, expect, it } from "vitest";
import { completeExchange, completeMissing } from "./demo";
import { chooseBotExchange, chooseBotMissing } from "./bot";
import { countTiles, createGame, discard } from "./game";
import { advanceToHuman } from "./session";
import {
  applyDecisionAction,
  chooseAutoplayAction,
  recordDecision,
  summarizeDecisions,
} from "./decision";
import { playerView } from "./view";

function ready(seed: number) {
  let state = createGame(seed);
  state = completeExchange(state, chooseBotExchange(state.players[0].hand));
  return completeMissing(state, chooseBotMissing(state.players[0].hand));
}

describe("本家托管与决策记录", () => {
  it("只选择本家动作，不替对手出牌或摸牌", () => {
    const state = ready(42);
    expect(chooseAutoplayAction(state)).toBeDefined();
    state.turn = 1;
    expect(chooseAutoplayAction(state)).toBeUndefined();
    state.phase = "draw";
    expect(chooseAutoplayAction(state)).toBeUndefined();
    state.phase = "ended";
    expect(chooseAutoplayAction(state)).toBeUndefined();
  });

  it.each([0, 42, 20260929])("种子 %i 托管到结算，牌数和积分守恒", (seed) => {
    let state = createGame(seed);
    const records = [];
    let turns = 0;
    while (state.phase !== "ended" && turns < 300) {
      const action = chooseAutoplayAction(state);
      expect(action).toBeDefined();
      const immediate = applyDecisionAction(state, 0, action!);
      records.push(recordDecision(state, immediate, 0, action!));
      state =
        action!.type === "exchange"
          ? completeExchange(state, action!.tiles)
          : action!.type === "missing"
            ? advanceToHuman(completeMissing(state, action!.suit))
            : advanceToHuman(immediate);
      expect(countTiles(state)).toBe(108);
      expect(state.players.reduce((sum, player) => sum + player.score, 0)).toBe(
        0,
      );
      turns += 1;
    }
    expect(turns).toBeLessThan(300);
    expect(state.phase).toBe("ended");
    expect(records.every((record) => record.seat === 0)).toBe(true);
    expect(records.every((record) => record.matchesRecommendation)).toBe(true);
    expect(chooseAutoplayAction(state)).toBeUndefined();
  });

  it("托管依据不受对手暗牌或未来牌墙影响，复盘快照不随牌桌改变", () => {
    const state = ready(42);
    const action = chooseAutoplayAction(state)!;
    const record = recordDecision(
      state,
      applyDecisionAction(state, 0, action),
      0,
      action,
    );
    const hidden = structuredClone(state);
    hidden.wall.reverse();
    [hidden.players[1].hand, hidden.players[2].hand] = [
      hidden.players[2].hand,
      hidden.players[1].hand,
    ];
    expect(chooseAutoplayAction(hidden)).toEqual(action);
    const saved = structuredClone(record);
    state.players[0].hand.push(1);
    expect(record).toEqual(saved);
    expect(JSON.stringify(record.view)).not.toContain('"wall":');
    expect(record.view.opponents.every((other) => !("hand" in other))).toBe(
      true,
    );
  });

  it("玩家偏离推荐时保存实际选择与当时建议供复盘比较", () => {
    const state = ready(42);
    const recommended = chooseAutoplayAction(state)!;
    const other = playerView(state, 0).legalDiscards.find(
      (tile) => recommended.type !== "discard" || tile !== recommended.tile,
    )!;
    const action = { type: "discard" as const, tile: other };
    const record = recordDecision(state, discard(state, 0, other), 0, action);
    expect(record.actual.action).toEqual(action);
    expect(record.recommended.action).toEqual(recommended);
    expect(record.matchesRecommendation).toBe(false);
    expect(summarizeDecisions([record]).deviations).toBe(1);
  });
});
