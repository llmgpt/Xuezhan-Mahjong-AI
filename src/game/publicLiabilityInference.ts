import type { PlayerView } from "./view";
import type { Tile } from "./tiles";
import { liabilityFeatures } from "./publicLiabilityFeatures";

export interface LiabilityModel {
  featureNames: string[];
  baseFeeClasses: number[];
  classes: number[];
  coefficients: number[][];
  intercepts: number[];
}
const FEATURE_NAMES = [
  "wall_fraction",
  "wall_late",
  "active_others_fraction",
  "visible_total_fraction",
  "opponent_meld_0",
  "opponent_meld_1",
  "opponent_meld_2",
  "opponent_meld_3",
  "opponent_meld_4",
  "opponent_kong_fraction",
  "candidate_suit_meld_fraction",
  "max_same_suit_meld_fraction",
  "mixed_meld_suits",
  "opponent_discard_count",
  "opponent_missing_discards",
  "opponent_candidate_suit_discards",
  "opponent_exact_discards",
  "recent_three_nonmissing",
  "last_discard_missing",
  "clear_proof_after_last_draw",
  "known_candidate_copies",
  "own_candidate_copies",
  "known_neighbors",
  "known_distance_two",
  "known_candidate_suit",
  "known_opponent_missing_suit",
  "edge_distance_0",
  "edge_distance_1",
  "edge_distance_2",
  "edge_distance_3",
  "edge_distance_4",
  "recent_six_candidate_suit",
];
const FEES = [0, 1, 2, 4, 8];

export function predictFeatureLiability(
  model: LiabilityModel,
  values: readonly number[],
  forcedZero: boolean,
): {
  probabilities: number[];
  legalHuProbability: number;
  expectedBasePayment: number;
} {
  if (
    model.featureNames.length !== FEATURE_NAMES.length ||
    model.featureNames.some((name, i) => name !== FEATURE_NAMES[i]) ||
    model.baseFeeClasses.length !== FEES.length ||
    model.baseFeeClasses.some((fee, i) => fee !== FEES[i])
  )
    throw new Error("Incompatible liability feature/fee schema");
  if (
    values.length !== FEATURE_NAMES.length ||
    values.some((n) => !Number.isFinite(n) || n < 0 || n > 1) ||
    typeof forcedZero !== "boolean"
  )
    throw new Error("Invalid liability input");
  if (
    model.classes.length < 2 ||
    new Set(model.classes).size !== model.classes.length ||
    model.classes.some(
      (c) => !Number.isInteger(c) || c < 0 || c >= FEES.length,
    ) ||
    model.coefficients.length !== model.classes.length ||
    model.intercepts.length !== model.classes.length ||
    model.intercepts.some((n) => !Number.isFinite(n)) ||
    model.coefficients.some(
      (row) =>
        row.length !== values.length || row.some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error("Invalid liability coefficients");
  const probabilities = Array<number>(FEES.length).fill(0);
  if (forcedZero) probabilities[0] = 1;
  else {
    const logits = model.coefficients.map((row, i) =>
      row.reduce(
        (sum, coefficient, j) => sum + coefficient * values[j],
        model.intercepts[i],
      ),
    );
    if (logits.some((n) => !Number.isFinite(n)))
      throw new Error("Invalid liability logits");
    const maximum = Math.max(...logits),
      weights = logits.map((z) => Math.exp(z - maximum));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    weights.forEach((weight, i) => {
      probabilities[model.classes[i]] = weight / total;
    });
  }
  return {
    probabilities,
    legalHuProbability: 1 - probabilities[0],
    expectedBasePayment: probabilities.reduce(
      (sum, p, i) => sum + p * FEES[i],
      0,
    ),
  };
}
export function predictPublicLiability(
  model: LiabilityModel,
  view: PlayerView,
  tile: Tile,
  opponent: number,
) {
  const features = liabilityFeatures(view, tile, opponent);
  return {
    ...predictFeatureLiability(model, features.values, features.forcedZero),
    forcedZero: features.forcedZero,
    reason: features.reason,
  };
}
