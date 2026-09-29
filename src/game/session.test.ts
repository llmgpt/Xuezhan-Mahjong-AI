import { describe, expect, it } from "vitest";
import { chooseBotExchange, chooseBotMissing } from "./bot";
import { completeExchange, completeMissing } from "./demo";
import {
  countTiles,
  createGame,
  legalResponses,
  legalSelfActions,
} from "./game";
import { advanceToHuman, applyPlayerAction } from "./session";
import { playerView } from "./view";
import { recommendDiscards } from "./advice";

function playSeed(seed: number) {
  let state = createGame(seed);
  state = completeExchange(state, chooseBotExchange(state.players[0].hand));
  state = completeMissing(state, chooseBotMissing(state.players[0].hand));
  state = advanceToHuman(state);
  let decisions = 0;
  while (state.phase !== "ended" && decisions < 300) {
    decisions += 1;
    if (state.phase === "respond") {
      const options = legalResponses(state, 0);
      state = applyPlayerAction(state, {
        type: "respond",
        choice: options.includes("hu") ? "hu" : "pass",
      });
    } else {
      expect(state.phase).toBe("discard");
      expect(state.turn).toBe(0);
      const self = legalSelfActions(state, 0);
      if (self.canWin) state = applyPlayerAction(state, { type: "win" });
      else if (self.concealedKongs.length)
        state = applyPlayerAction(state, {
          type: "kong",
          kind: "concealed",
          tile: self.concealedKongs[0],
        });
      else
        state = applyPlayerAction(state, {
          type: "discard",
          tile: recommendDiscards(playerView(state, 0))[0].tile,
        });
    }
    expect(countTiles(state)).toBe(108);
    expect(state.players.reduce((sum, player) => sum + player.score, 0)).toBe(
      0,
    );
  }
  expect(decisions).toBeLessThan(300);
  expect(state.phase).toBe("ended");
  expect(["three-wins", "wall"]).toContain(state.endReason);
  return state;
}

describe("玩家与三名电脑完成一局", () => {
  it.each([0, 1, 42, 20260929])("固定种子 %i 可走到结算", (seed) => {
    playSeed(seed);
  });

  it("同种子同样选择产生相同终局", () => {
    const first = playSeed(31415);
    const second = playSeed(31415);
    expect(first.players.map((player) => player.score)).toEqual(
      second.players.map((player) => player.score),
    );
    expect(first.wins).toEqual(second.wins);
  });
});
