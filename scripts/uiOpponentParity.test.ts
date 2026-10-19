import { describe, expect, it } from "vitest";
import {
  applyDecisionAction,
  chooseAutoplayAction,
} from "../src/game/decision";
import { completeExchange, completeMissing } from "../src/game/demo";
import { countTiles, createGame, draw } from "../src/game/game";
import { advanceToHuman } from "../src/game/session";
import { createPolicySession } from "./independentPolicies";
import { playIndependentGame, summarizeTransfers } from "./independentRunner";

describe("实际UI电脑阵容的完整状态对齐", () => {
  it.each([80000, 80007])(
    "旧种子%s四座位与页面开局/轮转函数的完整终局一致",
    async (seed) => {
      for (const seat of [0, 1, 2, 3]) {
        let ui = createGame(seed);
        const exchange = chooseAutoplayAction(ui, seat)!;
        if (exchange.type !== "exchange") throw new Error("Expected exchange");
        ui = completeExchange(ui, exchange.tiles, seat);
        const missing = chooseAutoplayAction(ui, seat)!;
        if (missing.type !== "missing")
          throw new Error("Expected missing suit");
        ui = advanceToHuman(completeMissing(ui, missing.suit, seat), seat);
        let decisions = 0;
        while (ui.phase !== "ended" && decisions++ < 1000) {
          const action = chooseAutoplayAction(ui, seat);
          if (!action)
            throw new Error("UI flow did not stop at its actual player");
          ui = advanceToHuman(applyDecisionAction(ui, seat, action), seat);
        }
        expect(ui.phase).toBe("ended");
        expect(countTiles(ui)).toBe(108);
        const sessions = [0, 1, 2, 3].map((actor) =>
          createPolicySession(actor === seat ? "teacher-v1" : "ui-greedy-v1"),
        );
        let mirror = createGame(seed);
        let steps = 0;
        try {
          const result = await playIndependentGame(
            seed,
            seat,
            sessions[seat].choose,
            Object.fromEntries(
              sessions.map((session, actor) => [actor, session.choose]),
            ),
            {
              onDecision: (trace) => {
                expect(trace.step).toBe(steps);
                mirror = applyDecisionAction(mirror, trace.actor, trace.action);
                steps++;
                while (mirror.phase === "draw") {
                  mirror = draw(mirror, mirror.turn);
                  steps++;
                }
                expect(countTiles(mirror)).toBe(108);
              },
            },
          );
          expect(mirror).toEqual(ui);
          expect(result).toEqual({
            scores: ui.players.map((player) => player.score),
            wins: ui.wins,
            steps,
            income: summarizeTransfers(
              ui.transfers,
              ui.players.map((player) => player.score),
            ),
            endReason: ui.endReason,
          });
          await Promise.all(sessions.map((session) => session.finish()));
        } finally {
          await Promise.all(sessions.map((session) => session.close()));
        }
      }
    },
    30000,
  );
});
