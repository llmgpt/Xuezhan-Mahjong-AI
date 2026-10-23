import { applyDecisionAction, type DecisionAction } from "./decision";
import {
  countTiles,
  createGame,
  draw,
  discardClaimOptions,
  legalDiscards,
  legalResponses,
  legalSelfActions,
  type GameState,
  type Phase,
  type ScoreTransfer,
} from "./game";
import { chooseTeacherAction } from "./teacher";
import {
  assertPublicParticle,
  assertPublicRonParticle,
  publicRonContext,
} from "./publicSampler";
import { suitOf, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

export type ContinuationPolicy = (
  view: PlayerView,
  phase: Phase,
) => DecisionAction | undefined;
export interface ContinuationParticle {
  hands: readonly (readonly Tile[])[];
  wall: readonly Tile[];
}
export interface ContinuationResult {
  scores: number[];
  scoreDifferences: number[];
  transfers: ScoreTransfer[];
  steps: number;
  endReason: GameState["endReason"];
}

function materialize(
  view: PlayerView,
  particle: ContinuationParticle,
): GameState {
  const response = view.decision?.kind === "respond";
  if ((!response && view.decision?.kind !== "self") || !view.missing)
    throw new Error("续局只支持已定缺的self摸打或普通合法点胡响应");
  if (!Array.isArray(view.publicActions))
    throw new Error("续局缺少真实公开历史publicActions");
  if (!Array.isArray(view.publicTiles))
    throw new Error("续局缺少当前公开库存publicTiles");
  if (response) assertPublicRonParticle(view, particle);
  else assertPublicParticle(view, particle);
  if (
    particle.hands.length !== 4 ||
    particle.wall.length !== view.wallRemaining
  )
    throw new Error("粒子牌墙或四家库存不符");
  if (JSON.stringify(particle.hands[view.seat]) !== JSON.stringify(view.hand))
    throw new Error("粒子不得更改本家手牌");
  if (
    view.opponents.length !== 3 ||
    new Set(view.opponents.map((p) => p.seat)).size !== 3
  )
    throw new Error("粒子需要完整四座位公开投影");
  const initialOwnScore = -view.opponents.reduce((sum, p) => sum + p.score, 0);
  const state = createGame(0); // Dummy initializer, replaced completely; never an original game seed.
  state.players = [0, 1, 2, 3].map((seat) => {
    const other = view.opponents.find((p) => p.seat === seat);
    if (seat !== view.seat && !other) throw new Error("公开投影缺少座位");
    const count = seat === view.seat ? view.hand.length : other!.handCount;
    if (particle.hands[seat].length !== count)
      throw new Error("粒子暗手张数不符");
    const missing = seat === view.seat ? view.missing : other!.missing;
    const score = seat === view.seat ? initialOwnScore : other!.score;
    if (!missing || !Number.isFinite(score))
      throw new Error("公开定缺或积分无效");
    return {
      hand: [...particle.hands[seat]],
      melds: (seat === view.seat ? view.melds : other!.melds).map((m) => ({
        ...m,
      })),
      discards: [...(seat === view.seat ? view.ownDiscards : other!.discards)],
      missing,
      score,
      won: seat !== view.seat && other!.won,
    };
  });
  state.wall = [...particle.wall];
  state.phase = "discard";
  state.turn = view.seat;
  state.publicTiles = view.publicTiles.map((p) => ({ ...p }));
  state.publicActions = view.publicActions.map((action) => ({ ...action }));
  state.log = [];
  // Past payments are already in public scores; this ledger contains future cash flow only.
  state.transfers = [];
  state.wins = [];
  const previousDiscard = [...view.publicActions]
    .reverse()
    .find((action) => action.kind === "discard");
  state.lastDiscard = previousDiscard && {
    seat: previousDiscard.seat,
    tile: previousDiscard.tile,
  };
  const latest = view.publicActions.at(-1);
  const beforeDraw = view.publicActions.at(-2);
  const drew = latest?.kind === "draw" && latest.seat === view.seat;
  const fromKong = !!(
    drew &&
    beforeDraw?.seat === view.seat &&
    (beforeDraw.kind === "kong" || beforeDraw.kind === "added-kong-offer")
  );
  state.afterKong = fromKong;
  // PlayerView preserves engine hand order, whose last tile is the player's own new draw.
  // Draw identities of other players are never reconstructed from the real game.
  state.lastDraw = drew
    ? {
        seat: view.seat,
        tile: view.hand.at(-1)!,
        fromKong,
        last: view.wallRemaining === 0,
      }
    : undefined;
  if (response) {
    const context = publicRonContext(view);
    // Recompute eligibility from generated hands. Actual hidden answers and
    // another player's unknown last-draw tile are never reconstructed.
    state.phase = "respond";
    state.turn = context.from;
    state.pending = {
      kind: "discard",
      from: context.from,
      tile: context.tile,
      eligible: state.players.flatMap((player, seat) =>
        seat !== context.from &&
        !player.won &&
        discardClaimOptions(
          { hand: player.hand, melds: player.melds, missing: player.missing! },
          context.tile,
          state.wall.length,
          state.rules.fanCap,
        ).length
          ? [seat]
          : [],
      ),
      answers: {},
      kongShot: context.winContext.kongShot,
      seaBottom: context.winContext.seaBottom,
    };
    assertState(state);
    if (
      JSON.stringify(legalResponses(state, view.seat)) !==
      JSON.stringify(
        view.decision!.kind === "respond" && view.decision!.choices,
      )
    )
      throw new Error("合成响应窗口与本家合法选择不一致");
    return state;
  }
  assertState(state);
  const self = legalSelfActions(state, view.seat);
  const sameTiles = (a: readonly Tile[], b: readonly Tile[]) =>
    [...a].sort((x, y) => x - y).join(",") ===
    [...b].sort((x, y) => x - y).join(",");
  if (
    view.decision?.kind !== "self" ||
    self.canWin !== view.decision.canWin ||
    !sameTiles(self.concealedKongs, view.decision.concealedKongs) ||
    !sameTiles(self.addedKongs, view.decision.addedKongs) ||
    !sameTiles(legalDiscards(state, view.seat), view.legalDiscards)
  )
    throw new Error("粒子的摸打上下文与宿主合法动作不一致");
  return state;
}

function assertState(state: GameState): void {
  if (countTiles(state) !== 108) throw new Error("续局粒子不满足108张库存");
  const copies = Array<number>(27).fill(0);
  const add = (tile: Tile) => {
    suitOf(tile);
    copies[tile]++;
  };
  state.wall.forEach(add);
  for (const player of state.players) {
    player.hand.forEach(add);
    player.discards.forEach(add);
    for (const meld of player.melds)
      for (let i = 0; i < (meld.type === "kong" ? 4 : 3); i++) add(meld.tile);
  }
  if (copies.some((count) => count !== 4))
    throw new Error("续局粒子的逐种库存不为四张");
  if (state.players.reduce((sum, p) => sum + p.score, 0) !== 0)
    throw new Error("续局积分不守恒");
}

function nextActor(state: GameState, seat: number): number {
  if (state.phase !== "respond") return state.turn;
  const next =
    state.pending!.eligible.find(
      (actor) => actor !== seat && !state.pending!.answers[actor],
    ) ??
    state.pending!.eligible.find((actor) => !state.pending!.answers[actor]);
  if (next === undefined) throw new Error("续局缺少待响应者");
  return next;
}

/** V1 continuation on generated tiles. It never accepts a real GameState or seed. */
export function continueSampledGame(
  view: PlayerView,
  particle: ContinuationParticle,
  firstAction: DecisionAction,
  options: { policy?: ContinuationPolicy; maxSteps?: number } = {},
): ContinuationResult {
  const maxSteps = options.maxSteps ?? 3000;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw new Error("续局步数预算无效");
  let state = materialize(view, particle);
  const initial = state.players.map((p) => p.score);
  state = applyDecisionAction(state, view.seat, structuredClone(firstAction));
  assertState(state);
  let steps = 1;
  const policy = options.policy ?? chooseTeacherAction;
  while (state.phase !== "ended" && steps < maxSteps) {
    if (state.phase === "draw") state = draw(state, state.turn);
    else {
      const actor = nextActor(state, view.seat);
      const chosen = policy(playerView(state, actor), state.phase);
      if (!chosen) throw new Error("续局策略未选择合法动作");
      state = applyDecisionAction(state, actor, structuredClone(chosen));
    }
    assertState(state);
    steps++;
  }
  if (state.phase !== "ended") throw new Error("续局达到步数上限仍未结束");
  const scoreDifferences = state.players.map(
    (p, seat) => p.score - initial[seat],
  );
  const ledger = [0, 0, 0, 0];
  for (const payment of state.transfers) {
    ledger[payment.from] -= payment.points;
    ledger[payment.to] += payment.points;
  }
  if (ledger.some((value, seat) => value !== scoreDifferences[seat]))
    throw new Error("续局未来转账与净分增量不符");
  return {
    scores: state.players.map((p) => p.score),
    scoreDifferences,
    transfers: state.transfers.map((pay) => ({ ...pay })),
    steps,
    endReason: state.endReason,
  };
}
