import { describe, expect, it } from "vitest";
import { completeExchange, completeMissing } from "./demo";
import { chooseBotExchange, chooseBotMissing } from "./bot";
import { countTiles, createGame, discard, type GameState } from "./game";
import { hand } from "./testHelpers";
import {
  recordDecision,
  takeAutomaticStep,
  summarizeDecisions,
} from "./teaching";
import { playerView } from "./view";

function ready(seed: number) {
  let state = createGame(seed);
  state = completeExchange(state, chooseBotExchange(state.players[0].hand));
  return completeMissing(state, chooseBotMissing(state.players[0].hand));
}

describe("自动教学对局与决策记录", () => {
  it.each([0, 42, 20260929])("种子 %i 从换牌自动走到结算，每步守恒", (seed) => {
    let state = createGame(seed);
    let steps = 0;
    const actions = new Set<string>();
    while (state.phase !== "ended" && steps < 1000) {
      const step = takeAutomaticStep(state)!;
      expect(step.before).toEqual(state);
      expect(step.decision.view).toEqual(playerView(state, step.decision.seat));
      expect(step.decision.actual.reason.length).toBeGreaterThan(0);
      expect(step.decision.matchesRecommendation).toBe(true);
      actions.add(step.decision.actual.action.type);
      state = step.after;
      expect(countTiles(state)).toBe(108);
      expect(state.players.reduce((sum, player) => sum + player.score, 0)).toBe(
        0,
      );
      steps += 1;
    }
    expect(steps).toBeLessThan(1000);
    expect(state.phase).toBe("ended");
    for (const type of ["exchange", "missing", "discard"])
      expect(actions.has(type)).toBe(true);
    expect(takeAutomaticStep(state)).toBeUndefined();
  });

  it("同种子逐步播放和连续执行得到相同决策和终局", () => {
    function run() {
      let state = createGame(31415);
      const records = [];
      while (state.phase !== "ended") {
        const step = takeAutomaticStep(state)!;
        records.push(step.decision);
        state = step.after;
      }
      return { state, records };
    }
    expect(run()).toEqual(run());
  });

  it("决策依据不受对手暗牌及未来牌墙顺序影响，记录不被后续修改", () => {
    const state = ready(42);
    const original = takeAutomaticStep(state)!;
    const hidden = structuredClone(state);
    hidden.wall.reverse();
    [hidden.players[1].hand, hidden.players[2].hand] = [
      hidden.players[2].hand,
      hidden.players[1].hand,
    ];
    expect(takeAutomaticStep(hidden)!.decision.actual).toEqual(
      original.decision.actual,
    );
    const saved = structuredClone(original.decision);
    original.after.players[0].hand.push(0);
    state.players[0].hand.push(1);
    expect(original.decision).toEqual(saved);
    expect(JSON.stringify(original.decision.view)).not.toContain('"wall":');
    expect(
      original.decision.view.opponents.every((other) => !("hand" in other)),
    ).toBe(true);
  });

  it("玩家偏离推荐时保存实际选择、当时建议与牌面供复盘比较", () => {
    const state = ready(42);
    const recommended = takeAutomaticStep(state)!.decision.recommended;
    const other = playerView(state, 0).legalDiscards.find(
      (tile) =>
        recommended.action.type !== "discard" ||
        tile !== recommended.action.tile,
    )!;
    const action = { type: "discard" as const, tile: other };
    const record = recordDecision(state, discard(state, 0, other), 0, action);
    expect(record.actual.action).toEqual(action);
    expect(record.recommended).toEqual(recommended);
    expect(record.matchesRecommendation).toBe(false);
    expect(summarizeDecisions([record]).deviations).toBe(1);
  });

  it("自摸后不再给已胡玩家安排动作，响应优先胡牌", () => {
    const state: GameState = ready(1);
    state.players[0].hand = hand("w11123499 s345678");
    state.players[0].missing = "tong";
    const step = takeAutomaticStep(state)!;
    expect(step.decision.actual.action.type).toBe("win");
    expect(step.after.players[0].won).toBe(true);
    expect(takeAutomaticStep(step.after)!.decision.seat).not.toBe(0);
    const response = ready(1);
    response.phase = "respond";
    response.players[1].missing = "tong";
    response.players[1].hand = hand("w1112349 s345678");
    response.pending = {
      kind: "discard",
      from: 0,
      tile: 8,
      eligible: [1],
      answers: {},
    };
    expect(takeAutomaticStep(response)!.decision.actual.action).toEqual({
      type: "respond",
      choice: "hu",
    });
  });
});
