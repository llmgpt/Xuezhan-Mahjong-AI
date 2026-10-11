import { recommendDiscards } from "../src/game/advice";
import { analyzeNextDraw } from "../src/game/lookahead";
import {
  applyDecisionAction,
  chooseAutoplayAction,
} from "../src/game/decision";
import { completeExchange, completeMissing } from "../src/game/demo";
import { createGame, legalDiscards } from "../src/game/game";
import { advanceToHuman } from "../src/game/session";
import { playerView } from "../src/game/view";
import { pairedSummary, seatClusterSummary } from "./evaluationStats";

type Policy = "advice" | "efficiency" | "lookahead" | "first" | "random";
type Result = {
  score: number;
  won: number;
  wall: number;
  changedDiscards: number;
};

function play(seed: number, seat: number, policy: Policy): Result {
  let state = createGame(seed);
  let randomState = (seed ^ 0x9e3779b9) >>> 0;
  let steps = 0;
  let changedDiscards = 0;
  while (state.phase !== "ended" && steps++ < 300) {
    let action = chooseAutoplayAction(state, seat);
    if (!action)
      throw new Error(
        `No action: ${seed}, seat ${seat}, ${policy}, ${state.phase}`,
      );
    if (action.type === "discard" && policy !== "advice") {
      const original = action.tile;
      if (policy === "first") {
        action = { type: "discard", tile: legalDiscards(state, seat)[0] };
      } else if (policy === "efficiency" || policy === "lookahead") {
        const view = playerView(state, seat);
        const ranked = [...recommendDiscards(view)].sort(
          (a, b) =>
            a.shanten - b.shanten ||
            b.effectiveCount - a.effectiveCount ||
            a.tile - b.tile,
        );
        const top = ranked
          .filter((item) => item.shanten === ranked[0].shanten)
          .slice(0, 3);
        const lookahead =
          policy === "lookahead"
            ? analyzeNextDraw(
                view,
                top.map((item) => item.tile),
              )
            : [];
        const best =
          policy === "lookahead" && lookahead.length
            ? [...top].sort(
                (a, b) =>
                  (lookahead.find((item) => item.tile === b.tile)
                    ?.twoDrawWinChance ?? 0) -
                    (lookahead.find((item) => item.tile === a.tile)
                      ?.twoDrawWinChance ?? 0) ||
                  b.effectiveCount - a.effectiveCount ||
                  a.tile - b.tile,
              )[0]
            : ranked[0];
        action = { type: "discard", tile: best.tile };
      } else {
        const legal = legalDiscards(state, seat);
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        action = {
          type: "discard",
          tile: legal[Math.floor((randomState / 2 ** 32) * legal.length)],
        };
      }
      if (action.tile !== original) changedDiscards += 1;
    }
    const immediate = applyDecisionAction(state, seat, action);
    state =
      action.type === "exchange"
        ? completeExchange(state, action.tiles, seat)
        : action.type === "missing"
          ? advanceToHuman(completeMissing(state, action.suit, seat), seat)
          : advanceToHuman(immediate, seat);
  }
  if (state.phase !== "ended")
    throw new Error(`Unfinished: ${seed}, seat ${seat}, ${policy}`);
  return {
    score: state.players[seat].score,
    won: Number(state.wins.some((win) => win.winner === seat)),
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
const allPolicies: Policy[] = [
  "advice",
  "efficiency",
  "lookahead",
  "first",
  "random",
];
const seats = (process.env.EVAL_SEATS ?? "0").split(",").map(Number);
const policies = (process.env.EVAL_POLICIES ?? allPolicies.join(",")).split(
  ",",
) as Policy[];
if (
  seats.length === 0 ||
  seats.some((seat) => !Number.isInteger(seat) || seat < 0 || seat > 3) ||
  new Set(seats).size !== seats.length ||
  !policies.includes("advice") ||
  !policies.includes("efficiency") ||
  policies.some((policy) => !allPolicies.includes(policy)) ||
  new Set(policies).size !== policies.length
) {
  throw new Error(
    "EVAL_SEATS 必须是不重复的 0～3；EVAL_POLICIES 必须包含 advice、efficiency 且不重复",
  );
}

type SeatRun = { seat: number; outcomes: Partial<Record<Policy, Result>> };
const results: SeatRun[][] = Array.from({ length: count }, (_, index) => {
  const seed = startSeed + index;
  return seats.map((seat) => ({
    seat,
    outcomes: Object.fromEntries(
      policies.map((policy) => [policy, play(seed, seat, policy)]),
    ),
  }));
});

function outcome(run: SeatRun, policy: Policy): Result {
  const value = run.outcomes[policy];
  if (!value) throw new Error(`Missing result: seat ${run.seat}, ${policy}`);
  return value;
}

function policySummary(runs: readonly SeatRun[]) {
  return Object.fromEntries(
    policies.map((policy) => {
      const samples = runs.map((run) => outcome(run, policy));
      return [
        policy,
        {
          meanScore: mean(samples.map((sample) => sample.score)),
          winRate: mean(samples.map((sample) => sample.won)),
          wallRate: mean(samples.map((sample) => sample.wall)),
          changedDiscards: samples.reduce(
            (sum, sample) => sum + sample.changedDiscards,
            0,
          ),
        },
      ];
    }),
  );
}

function scoreDifference(run: SeatRun, left: Policy, right: Policy) {
  return outcome(run, left).score - outcome(run, right).score;
}

const baselines = policies.filter((policy) => policy !== "advice");
const bySeat = Object.fromEntries(
  seats.map((seat) => {
    const runs = results.map((seedRuns) =>
      seedRuns.find((run) => run.seat === seat)!,
    );
    return [
      seat,
      {
        byPolicy: policySummary(runs),
        comparisons: Object.fromEntries(
          baselines.map((baseline) => [
            baseline,
            pairedSummary(
              runs.map((run) => scoreDifference(run, "advice", baseline)),
            ),
          ]),
        ),
      },
    ];
  }),
);
const comparisons = Object.fromEntries(
  baselines.map((baseline) => [
    baseline,
    seatClusterSummary(
      results.map((seedRuns) =>
        seedRuns.map((run) => scoreDifference(run, "advice", baseline)),
      ),
    ),
  ]),
);
const lookaheadVsEfficiency = policies.includes("lookahead")
  ? seatClusterSummary(
      results.map((seedRuns) =>
        seedRuns.map((run) => scoreDifference(run, "lookahead", "efficiency")),
      ),
    )
  : undefined;
console.log(
  JSON.stringify(
    {
      count,
      startSeed,
      seats,
      policies,
      byPolicy: policySummary(results.flat()),
      comparisons,
      bySeat,
      ...(lookaheadVsEfficiency && { lookaheadVsEfficiency }),
    },
    null,
    2,
  ),
);
