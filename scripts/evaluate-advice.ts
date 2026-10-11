import { recommendDiscards } from "../src/game/advice";
import {
  applyDecisionAction,
  chooseAutoplayAction,
} from "../src/game/decision";
import { completeExchange, completeMissing } from "../src/game/demo";
import { createGame, legalDiscards } from "../src/game/game";
import { advanceToHuman } from "../src/game/session";
import { playerView } from "../src/game/view";

type Policy = "advice" | "efficiency" | "first" | "random";
type Result = {
  score: number;
  won: number;
  wall: number;
  changedDiscards: number;
};

function play(seed: number, policy: Policy): Result {
  let state = createGame(seed);
  let randomState = (seed ^ 0x9e3779b9) >>> 0;
  let steps = 0;
  let changedDiscards = 0;
  while (state.phase !== "ended" && steps++ < 300) {
    let action = chooseAutoplayAction(state);
    if (!action)
      throw new Error(`No action: ${seed}, ${policy}, ${state.phase}`);
    if (action.type === "discard" && policy !== "advice") {
      const original = action.tile;
      if (policy === "first") {
        action = { type: "discard", tile: legalDiscards(state, 0)[0] };
      } else if (policy === "efficiency") {
        const best = [...recommendDiscards(playerView(state, 0))].sort(
          (a, b) =>
            a.shanten - b.shanten ||
            b.effectiveCount - a.effectiveCount ||
            a.tile - b.tile,
        )[0];
        action = { type: "discard", tile: best.tile };
      } else {
        const legal = legalDiscards(state, 0);
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        action = {
          type: "discard",
          tile: legal[Math.floor((randomState / 2 ** 32) * legal.length)],
        };
      }
      if (action.tile !== original) changedDiscards += 1;
    }
    const immediate = applyDecisionAction(state, 0, action);
    state =
      action.type === "exchange"
        ? completeExchange(state, action.tiles)
        : action.type === "missing"
          ? advanceToHuman(completeMissing(state, action.suit))
          : advanceToHuman(immediate);
  }
  if (state.phase !== "ended")
    throw new Error(`Unfinished: ${seed}, ${policy}`);
  return {
    score: state.players[0].score,
    won: Number(state.wins.some((win) => win.winner === 0)),
    wall: Number(state.endReason === "wall"),
    changedDiscards,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const count = Number(process.env.EVAL_COUNT ?? 100);
const startSeed = Number(process.env.EVAL_START ?? 10000);
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(startSeed)) {
  throw new Error(
    "EVAL_COUNT must be positive and EVAL_START must be an integer",
  );
}
const policies: Policy[] = ["advice", "efficiency", "first", "random"];
const results = Array.from({ length: count }, (_, index) => {
  const seed = startSeed + index;
  return Object.fromEntries(
    policies.map((policy) => [policy, play(seed, policy)]),
  ) as Record<Policy, Result>;
});
const byPolicy = Object.fromEntries(
  policies.map((policy) => [
    policy,
    {
      meanScore: mean(results.map((result) => result[policy].score)),
      winRate: mean(results.map((result) => result[policy].won)),
      wallRate: mean(results.map((result) => result[policy].wall)),
      changedDiscards: results.reduce(
        (sum, result) => sum + result[policy].changedDiscards,
        0,
      ),
    },
  ]),
);
const comparisons = Object.fromEntries(
  (["efficiency", "first", "random"] as const).map((baseline) => {
    const differences = results.map(
      (result) => result.advice.score - result[baseline].score,
    );
    const average = mean(differences);
    const variance = mean(differences.map((value) => (value - average) ** 2));
    return [
      baseline,
      {
        meanScoreDifference: average,
        standardError: Math.sqrt(variance / count),
        betterSeedFraction: mean(differences.map((value) => Number(value > 0))),
      },
    ];
  }),
);
console.log(
  JSON.stringify({ count, startSeed, byPolicy, comparisons }, null, 2),
);
