import type { PlayerView } from "./view";
import type { Tile } from "./tiles";
import model from "./fixtures/public-liability-model-v1.json";
import {
  predictFeatureLiability as inferFeatures,
  predictPublicLiability as inferPublic,
} from "./publicLiabilityInference";

export function predictFeatureLiability(
  values: readonly number[],
  forcedZero: boolean,
) {
  return inferFeatures(model, values, forcedZero);
}
export function predictPublicLiability(
  view: PlayerView,
  tile: Tile,
  opponent: number,
) {
  return inferPublic(model, view, tile, opponent);
}

// At a self discard, only the immediately preceding draw can carry a last-wall
// or kong supplement event. A preceding pung consumes neither event.
export function discardBonusFans(view: PlayerView): number {
  if (!view.publicActions) throw new Error("点炮加番需要完整公开历史");
  const last = view.publicActions.at(-1),
    before = view.publicActions.at(-2);
  if (last?.kind !== "draw" || last.seat !== view.seat) return 0;
  const kong =
    before?.seat === view.seat &&
    (before.kind === "kong" || before.kind === "added-kong-offer");
  return Number(kong) + Number(view.wallRemaining === 0);
}

export function discardLiability(view: PlayerView, tile: Tile) {
  const bonusFans = discardBonusFans(view);
  const opponents = view.opponents.map((opponent) => {
    const predicted = predictPublicLiability(view, tile, opponent.seat);
    const expectedPayment = predicted.probabilities.reduce(
      (sum, p, i) =>
        sum + p * Math.min(model.baseFeeClasses[i] * 2 ** bonusFans, 8),
      0,
    );
    return { seat: opponent.seat, ...predicted, expectedPayment };
  });
  // Linearity of expected payments does not require independent opponents.
  return {
    bonusFans,
    opponents,
    expectedPayment: opponents.reduce(
      (sum, opponent) => sum + opponent.expectedPayment,
      0,
    ),
  };
}
