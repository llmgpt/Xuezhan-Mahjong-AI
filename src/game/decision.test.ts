import { describe, expect, it } from "vitest";
import { completeExchange, completeMissing } from "./demo";
import { chooseBotExchange, chooseBotMissing } from "./bot";
import { countTiles, createGame } from "./game";
import { advanceToHuman } from "./session";
import {
  applyDecisionAction,
  chooseAutoplayAction,
  describeDecision,
} from "./decision";
import { playerView } from "./view";

function ready(seed: number) {
  let state = createGame(seed);
  state = completeExchange(state, chooseBotExchange(state.players[0].hand));
  return completeMissing(state, chooseBotMissing(state.players[0].hand));
}

describe("本家托管与即时解释", () => {
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
    let turns = 0;
    while (state.phase !== "ended" && turns < 300) {
      const action = chooseAutoplayAction(state);
      expect(action).toBeDefined();
      const immediate = applyDecisionAction(state, 0, action!);
      expect(describeDecision(state, 0, action!).matchesRecommendation).toBe(
        true,
      );
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
    expect(chooseAutoplayAction(state)).toBeUndefined();
  });

  it("即时解释不受对手暗牌或未来牌墙影响，只返回播报所需信息", () => {
    const state = ready(42);
    const action = chooseAutoplayAction(state)!;
    const explanation = describeDecision(state, 0, action);
    const hidden = structuredClone(state);
    hidden.wall.reverse();
    [hidden.players[1].hand, hidden.players[2].hand] = [
      hidden.players[2].hand,
      hidden.players[1].hand,
    ];
    expect(chooseAutoplayAction(hidden)).toEqual(action);
    expect(describeDecision(hidden, 0, action)).toEqual(explanation);
    expect(Object.keys(explanation).sort()).toEqual([
      "actual",
      "matchesRecommendation",
      "recommended",
      "view",
    ]);
    expect(explanation.view).toEqual({ missing: state.players[0].missing });
  });

  it("玩家偏离推荐时即时解释实际选择与当时建议", () => {
    const state = ready(42);
    const recommended = chooseAutoplayAction(state)!;
    const other = playerView(state, 0).legalDiscards.find(
      (tile) => recommended.type !== "discard" || tile !== recommended.tile,
    )!;
    const action = { type: "discard" as const, tile: other };
    const explanation = describeDecision(state, 0, action);
    expect(explanation.actual.action).toEqual(action);
    expect(explanation.recommended.action).toEqual(recommended);
    expect(explanation.matchesRecommendation).toBe(false);
  });
});
