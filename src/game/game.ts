import {
  createWall,
  deal,
  shuffle,
  suitOf,
  type Suit,
  type Tile,
} from "./tiles";

export type Phase =
  "exchange" | "choose-missing" | "discard" | "draw" | "ended";

export interface PlayerState {
  hand: Tile[];
  discards: Tile[];
  exchange?: Tile[];
  missing?: Suit;
  won: boolean;
}

export interface GameState {
  seed: number;
  wall: Tile[];
  players: PlayerState[];
  phase: Phase;
  turn: number;
  lastDiscard?: { seat: number; tile: Tile };
}

function copy(state: GameState): GameState {
  return {
    ...state,
    wall: [...state.wall],
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
      discards: [...player.discards],
      exchange: player.exchange && [...player.exchange],
    })),
  };
}

function requireSeat(seat: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3)
    throw new Error("无效座位");
}

function removeOwned(hand: Tile[], selected: readonly Tile[]): Tile[] {
  const remaining = [...hand];
  for (const item of selected) {
    const index = remaining.indexOf(item);
    if (index < 0) throw new Error("所选牌不在手中");
    remaining.splice(index, 1);
  }
  return remaining;
}

export function createGame(seed: number): GameState {
  const dealt = deal(shuffle(createWall(), seed));
  return {
    seed,
    wall: dealt.wall,
    players: dealt.hands.map((hand) => ({ hand, discards: [], won: false })),
    phase: "exchange",
    turn: 0,
  };
}

export function chooseExchange(
  state: GameState,
  seat: number,
  selected: readonly Tile[],
): GameState {
  requireSeat(seat);
  if (state.phase !== "exchange" || state.players[seat].exchange)
    throw new Error("当前不可换牌");
  if (
    selected.length !== 3 ||
    selected.some((item) => suitOf(item) !== suitOf(selected[0]))
  ) {
    throw new Error("须选择同一门的三张牌");
  }
  removeOwned(state.players[seat].hand, selected);
  const next = copy(state);
  next.players[seat].exchange = [...selected];
  if (next.players.every((player) => player.exchange)) {
    const sent = next.players.map((player) => player.exchange!);
    next.players.forEach((player, index) => {
      player.hand = [
        ...removeOwned(player.hand, sent[index]),
        ...sent[(index + 3) % 4],
      ];
      delete player.exchange;
    });
    next.phase = "choose-missing";
  }
  return next;
}

export function chooseMissing(
  state: GameState,
  seat: number,
  missing: Suit,
): GameState {
  requireSeat(seat);
  if (state.phase !== "choose-missing" || state.players[seat].missing) {
    throw new Error("当前不可定缺");
  }
  if (!["wan", "tiao", "tong"].includes(missing)) throw new Error("无效缺门");
  const next = copy(state);
  next.players[seat].missing = missing;
  if (next.players.every((player) => player.missing)) next.phase = "discard";
  return next;
}

export function legalDiscards(state: GameState, seat: number): Tile[] {
  requireSeat(seat);
  if (state.phase !== "discard" || state.turn !== seat) return [];
  const player = state.players[seat];
  const missingTiles = player.hand.filter(
    (item) => suitOf(item) === player.missing,
  );
  return [...new Set(missingTiles.length ? missingTiles : player.hand)].sort(
    (a, b) => a - b,
  );
}

export function discard(
  state: GameState,
  seat: number,
  chosen: Tile,
): GameState {
  if (!legalDiscards(state, seat).includes(chosen))
    throw new Error("当前不能打这张牌");
  const next = copy(state);
  next.players[seat].hand = removeOwned(next.players[seat].hand, [chosen]);
  next.players[seat].discards.push(chosen);
  next.lastDiscard = { seat, tile: chosen };
  next.turn = (seat + 1) % 4;
  next.phase = next.wall.length === 0 ? "ended" : "draw";
  return next;
}

export function draw(state: GameState, seat: number): GameState {
  requireSeat(seat);
  if (
    state.phase !== "draw" ||
    state.turn !== seat ||
    state.wall.length === 0
  ) {
    throw new Error("当前不能摸牌");
  }
  const next = copy(state);
  next.players[seat].hand.push(next.wall.shift()!);
  next.phase = "discard";
  return next;
}

export function countTiles(state: GameState): number {
  return (
    state.wall.length +
    state.players.reduce(
      (total, player) => total + player.hand.length + player.discards.length,
      0,
    )
  );
}
