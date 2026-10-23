import type { PlayerView } from "./view";
import { suitOf, type Tile } from "./tiles";

export interface PublicLiabilityFeatures {
  forcedZero: boolean;
  reason?: "won" | "missing-suit" | "known-four-single";
  values: number[];
}

export function liabilityFeatures(
  view: PlayerView,
  tile: Tile,
  opponentSeat: number,
): PublicLiabilityFeatures {
  if (
    view.decision?.kind !== "self" ||
    !view.legalDiscards.includes(tile) ||
    !view.hand.includes(tile)
  )
    throw new Error("Liability features require a legal discard view");
  if (!Array.isArray(view.publicTiles) || !Array.isArray(view.publicActions))
    throw new Error("Complete public history is required");
  const opponent = view.opponents.find((p) => p.seat === opponentSeat);
  if (!opponent || opponentSeat === view.seat || !opponent.missing)
    throw new Error("Invalid public opponent");
  if (
    !Number.isSafeInteger(view.wallRemaining) ||
    view.wallRemaining < 0 ||
    view.wallRemaining > 55
  )
    throw new Error("Invalid V1 wall count");
  if (
    opponent.melds.length > 4 ||
    (!opponent.won && opponent.handCount !== 13 - 3 * opponent.melds.length)
  )
    throw new Error("Invalid public hand/meld count");
  const known = Array<number>(27).fill(0),
    own = Array<number>(27).fill(0);
  const add = (t: Tile, count = 1) => {
    suitOf(t);
    known[t] += count;
    if (known[t] > 4) throw new Error("More than four known copies");
  };
  for (const t of view.hand) {
    add(t);
    own[t]++;
  }
  for (const m of [...view.melds, ...view.opponents.flatMap((p) => p.melds)])
    add(m.tile, m.type === "kong" ? 4 : 3);
  // Public inventory already excludes claimed discards; self-win exposures are
  // counted here once and are not present in the current active actor's hand.
  for (const p of view.publicTiles) add(p.tile);
  const suit = suitOf(tile),
    suits = [suitOf(0), suitOf(9), suitOf(18)];
  const m = opponent.melds.length,
    meldSuitCounts = suits.map(
      (s) => opponent.melds.filter((p) => suitOf(p.tile) === s).length,
    );
  const discards = view.publicActions
    .filter((a) => a.seat === opponentSeat && a.kind === "discard")
    .map((a) => (a as { tile: Tile }).tile);
  let lastDraw = -1,
    lastClear = -1;
  view.publicActions.forEach((a, i) => {
    if (a.seat !== opponentSeat) return;
    if (a.kind === "draw") lastDraw = i;
    if (a.kind === "discard" && suitOf(a.tile) !== opponent.missing)
      lastClear = i;
  });
  const scaled = (n: number, maximum: number) => Math.min(n, maximum) / maximum;
  const neighbor = (distance: number) =>
    [-distance, distance].reduce((sum, delta) => {
      const t = tile + delta;
      return (
        sum +
        (t >= 0 && t < 27 && Math.floor(t / 9) === Math.floor(tile / 9)
          ? known[t]
          : 0)
      );
    }, 0) / 8;
  const knownSuit = (s: string) =>
    known.reduce((sum, n, i) => sum + (suitOf(i) === s ? n : 0), 0) / 36;
  const edge = Math.min(tile % 9, 8 - (tile % 9));
  const values = [
    view.wallRemaining / 55,
    Number(view.wallRemaining <= 16),
    view.opponents.filter((p) => !p.won).length / 3,
    known.reduce((a, b) => a + b, 0) / 108,
    ...[0, 1, 2, 3, 4].map((n) => Number(m === n)),
    opponent.melds.filter((p) => p.type === "kong").length / 4,
    opponent.melds.filter((p) => suitOf(p.tile) === suit).length / 4,
    Math.max(...meldSuitCounts) / 4,
    Number(meldSuitCounts.filter((n) => n > 0).length >= 2),
    scaled(discards.length, 20),
    scaled(discards.filter((t) => suitOf(t) === opponent.missing).length, 6),
    scaled(discards.filter((t) => suitOf(t) === suit).length, 12),
    scaled(discards.filter((t) => t === tile).length, 4),
    discards.slice(-3).filter((t) => suitOf(t) !== opponent.missing).length / 3,
    Number(
      discards.length > 0 && suitOf(discards.at(-1)!) === opponent.missing,
    ),
    Number(lastClear >= 0 && lastClear > lastDraw),
    known[tile] / 4,
    own[tile] / 4,
    neighbor(1),
    neighbor(2),
    knownSuit(suit),
    knownSuit(opponent.missing),
    ...[0, 1, 2, 3, 4].map((n) => Number(edge === n)),
    discards.slice(-6).filter((t) => suitOf(t) === suit).length / 6,
  ];
  if (
    values.length !== 32 ||
    values.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
  )
    throw new Error("Invalid public feature range");
  const reason = opponent.won
    ? "won"
    : opponent.missing === suit
      ? "missing-suit"
      : opponent.handCount === 1 && known[tile] === 4
        ? "known-four-single"
        : undefined;
  return {
    forcedZero: reason !== undefined,
    ...(reason ? { reason } : {}),
    values,
  };
}
