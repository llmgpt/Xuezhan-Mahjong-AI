import {
  evaluateWin,
  waitingTiles,
  type Meld,
  type WinContext,
  type WinEvaluation,
} from "./scoring";
import {
  createWall,
  deal,
  labelOf,
  shuffle,
  suitOf,
  type Suit,
  type Tile,
} from "./tiles";

export type Phase =
  "exchange" | "choose-missing" | "discard" | "draw" | "respond" | "ended";
export type ResponseChoice = "pass" | "hu" | "pung" | "kong";
export type KongKind = "concealed" | "added";

export interface GameRules {
  exchangeDirection: "clockwise" | "counterclockwise" | "opposite";
  fanCap: number;
  selfDrawBonus: number;
  flowerPenalty: number;
  checkTenpai: boolean;
}

export const DEFAULT_RULES: GameRules = {
  exchangeDirection: "clockwise",
  fanCap: 3,
  selfDrawBonus: 1,
  flowerPenalty: 8,
  checkTenpai: true,
};

export interface PlayerState {
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  exchange?: Tile[];
  missing?: Suit;
  won: boolean;
  score: number;
}

export interface WinRecord {
  winner: number;
  payer: number | null;
  tile: Tile;
  selfDraw: boolean;
  evaluation: WinEvaluation;
}

export interface PendingResponse {
  kind: "discard" | "rob-kong";
  from: number;
  tile: Tile;
  eligible: number[];
  answers: Partial<Record<number, ResponseChoice>>;
  kongShot?: boolean;
  seaBottom?: boolean;
}

export interface GameState {
  seed: number;
  rules: GameRules;
  wall: Tile[];
  players: PlayerState[];
  phase: Phase;
  turn: number;
  pending?: PendingResponse;
  lastDiscard?: { seat: number; tile: Tile };
  lastDraw?: { seat: number; tile: Tile; fromKong: boolean; last: boolean };
  afterKong: boolean;
  wins: WinRecord[];
  endReason?: "three-wins" | "wall";
  log: string[];
}

function copy(state: GameState): GameState {
  return {
    ...state,
    rules: { ...state.rules },
    wall: [...state.wall],
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
      melds: player.melds.map((meld) => ({ ...meld })),
      discards: [...player.discards],
      exchange: player.exchange && [...player.exchange],
    })),
    pending: state.pending && {
      ...state.pending,
      eligible: [...state.pending.eligible],
      answers: { ...state.pending.answers },
    },
    wins: [...state.wins],
    log: [...state.log],
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

function nextActive(state: GameState, after: number): number {
  for (let offset = 1; offset <= 4; offset += 1) {
    const seat = (after + offset) % 4;
    if (!state.players[seat].won) return seat;
  }
  throw new Error("没有仍在对局的玩家");
}

function transfer(
  state: GameState,
  from: number,
  to: number,
  points: number,
): void {
  state.players[from].score -= points;
  state.players[to].score += points;
}

function log(state: GameState, message: string): void {
  state.log.push(message);
}

function finishThreeWins(state: GameState): GameState {
  state.phase = "ended";
  state.endReason = "three-wins";
  state.pending = undefined;
  log(state, "已有三家胡牌，本局结束。");
  return state;
}

function advanceAfterDiscard(state: GameState, from: number): GameState {
  state.pending = undefined;
  if (state.players.filter((player) => player.won).length >= 3)
    return finishThreeWins(state);
  state.phase = "draw";
  if (state.wall.length === 0) return finishWall(state);
  state.turn = nextActive(state, from);
  return state;
}

function supplement(state: GameState, seat: number): void {
  if (state.wall.length === 0) throw new Error("牌墙已空，不能补牌");
  const drawn = state.wall.pop()!;
  state.players[seat].hand.push(drawn);
  state.turn = seat;
  state.phase = "discard";
  state.afterKong = true;
  state.lastDraw = {
    seat,
    tile: drawn,
    fromKong: true,
    last: state.wall.length === 0,
  };
  log(state, `${seat} 号玩家杠后补牌。`);
}

function applyWin(
  state: GameState,
  winner: number,
  tile: Tile,
  payer: number | null,
  context: WinContext,
): void {
  const player = state.players[winner];
  const evaluation = evaluateWin(
    payer === null ? player.hand : [...player.hand, tile],
    player.melds,
    player.missing!,
    context,
    state.rules.fanCap,
  );
  if (!evaluation) throw new Error("这副牌不能胡");
  if (payer === null) {
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat !== winner && !state.players[seat].won) {
        transfer(
          state,
          seat,
          winner,
          evaluation.points + state.rules.selfDrawBonus,
        );
      }
    }
  } else {
    transfer(state, payer, winner, evaluation.points);
  }
  player.won = true;
  state.wins.push({
    winner,
    payer,
    tile,
    selfDraw: payer === null,
    evaluation,
  });
  log(
    state,
    `${winner} 号玩家${payer === null ? "自摸" : `胡 ${payer} 号玩家`} ${labelOf(tile)}，${evaluation.patterns.join("、")}。`,
  );
}

function discardOptions(
  state: GameState,
  seat: number,
  from: number,
  tile: Tile,
): ResponseChoice[] {
  if (seat === from || state.players[seat].won) return [];
  const player = state.players[seat];
  const options: ResponseChoice[] = [];
  if (
    evaluateWin(
      [...player.hand, tile],
      player.melds,
      player.missing!,
      {},
      state.rules.fanCap,
    )
  ) {
    options.push("hu");
  }
  if (suitOf(tile) !== player.missing) {
    const copies = player.hand.filter((item) => item === tile).length;
    if (copies >= 2) options.push("pung");
    if (copies >= 3 && state.wall.length > 0) options.push("kong");
  }
  return options;
}

export function createGame(
  seed: number,
  overrides: Partial<GameRules> = {},
): GameState {
  const rules = { ...DEFAULT_RULES, ...overrides };
  if (
    !Number.isInteger(rules.fanCap) ||
    rules.fanCap < 0 ||
    rules.selfDrawBonus < 0 ||
    rules.flowerPenalty < 0
  ) {
    throw new Error("无效规则配置");
  }
  const dealt = deal(shuffle(createWall(), seed));
  return {
    seed,
    rules,
    wall: dealt.wall,
    players: dealt.hands.map((hand) => ({
      hand,
      melds: [],
      discards: [],
      won: false,
      score: 0,
    })),
    phase: "exchange",
    turn: 0,
    afterKong: false,
    wins: [],
    log: [`本局种子 ${seed}，庄家为 0 号玩家。`],
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
    const source = (seat: number) => {
      switch (next.rules.exchangeDirection) {
        case "clockwise":
          return (seat + 3) % 4;
        case "counterclockwise":
          return (seat + 1) % 4;
        case "opposite":
          return (seat + 2) % 4;
      }
    };
    next.players.forEach((player, index) => {
      player.hand = [
        ...removeOwned(player.hand, sent[index]),
        ...sent[source(index)],
      ];
      delete player.exchange;
    });
    next.phase = "choose-missing";
    log(next, "四家已换三张，开始定缺。");
  }
  return next;
}

export function chooseMissing(
  state: GameState,
  seat: number,
  missing: Suit,
): GameState {
  requireSeat(seat);
  if (state.phase !== "choose-missing" || state.players[seat].missing)
    throw new Error("当前不可定缺");
  if (!["wan", "tiao", "tong"].includes(missing)) throw new Error("无效缺门");
  const next = copy(state);
  next.players[seat].missing = missing;
  if (next.players.every((player) => player.missing)) {
    next.phase = "discard";
    log(next, "四家定缺完成，庄家先出牌。");
  }
  return next;
}

export function legalDiscards(state: GameState, seat: number): Tile[] {
  requireSeat(seat);
  if (
    state.phase !== "discard" ||
    state.turn !== seat ||
    state.players[seat].won
  )
    return [];
  const player = state.players[seat];
  const missingTiles = player.hand.filter(
    (item) => suitOf(item) === player.missing,
  );
  return [...new Set(missingTiles.length ? missingTiles : player.hand)].sort(
    (a, b) => a - b,
  );
}

export function legalSelfActions(
  state: GameState,
  seat: number,
): {
  canWin: boolean;
  concealedKongs: Tile[];
  addedKongs: Tile[];
} {
  requireSeat(seat);
  const unavailable = { canWin: false, concealedKongs: [], addedKongs: [] };
  if (
    state.phase !== "discard" ||
    state.turn !== seat ||
    state.players[seat].won
  )
    return unavailable;
  const openingDealer = seat === 0 && !state.lastDiscard && !state.lastDraw;
  if (!openingDealer && state.lastDraw?.seat !== seat) return unavailable;
  const player = state.players[seat];
  const canWin = !!evaluateWin(
    player.hand,
    player.melds,
    player.missing!,
    {
      kongFlower: state.lastDraw?.seat === seat && state.lastDraw.fromKong,
      seaBottom: state.lastDraw?.seat === seat && state.lastDraw.last,
    },
    state.rules.fanCap,
  );
  if (state.wall.length === 0)
    return { canWin, concealedKongs: [], addedKongs: [] };
  const counts = Array<number>(27).fill(0);
  for (const item of player.hand) counts[item] += 1;
  return {
    canWin,
    concealedKongs: counts.flatMap((count, item) =>
      count === 4 && suitOf(item) !== player.missing ? [item] : [],
    ),
    addedKongs: player.melds.flatMap((meld) =>
      meld.type === "pung" &&
      counts[meld.tile] > 0 &&
      suitOf(meld.tile) !== player.missing
        ? [meld.tile]
        : [],
    ),
  };
}

export function draw(state: GameState, seat: number): GameState {
  requireSeat(seat);
  if (
    state.phase !== "draw" ||
    state.turn !== seat ||
    state.players[seat].won ||
    state.wall.length === 0
  ) {
    throw new Error("当前不能摸牌");
  }
  const next = copy(state);
  const drawn = next.wall.shift()!;
  next.players[seat].hand.push(drawn);
  next.lastDraw = {
    seat,
    tile: drawn,
    fromKong: false,
    last: next.wall.length === 0,
  };
  next.afterKong = false;
  next.phase = "discard";
  return next;
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
  log(next, `${seat} 号玩家打出 ${labelOf(chosen)}。`);
  const eligible = next.players.flatMap((_, other) =>
    discardOptions(next, other, seat, chosen).length ? [other] : [],
  );
  const kongShot = next.afterKong;
  const seaBottom = next.lastDraw?.seat === seat && next.lastDraw.last;
  next.afterKong = false;
  if (eligible.length) {
    next.phase = "respond";
    next.pending = {
      kind: "discard",
      from: seat,
      tile: chosen,
      eligible,
      answers: {},
      kongShot,
      seaBottom,
    };
    return next;
  }
  return advanceAfterDiscard(next, seat);
}

export function legalResponses(
  state: GameState,
  seat: number,
): ResponseChoice[] {
  requireSeat(seat);
  const pending = state.pending;
  if (
    state.phase !== "respond" ||
    !pending ||
    !pending.eligible.includes(seat) ||
    pending.answers[seat]
  )
    return [];
  if (pending.kind === "rob-kong") return ["pass", "hu"];
  return ["pass", ...discardOptions(state, seat, pending.from, pending.tile)];
}

function claimDiscard(
  state: GameState,
  seat: number,
  kind: "pung" | "kong",
): GameState {
  const pending = state.pending!;
  const source = state.players[pending.from].discards;
  const index = source.lastIndexOf(pending.tile);
  if (index < 0) throw new Error("待响应的弃牌不存在");
  source.splice(index, 1);
  state.players[seat].hand = removeOwned(
    state.players[seat].hand,
    Array(kind === "kong" ? 3 : 2).fill(pending.tile),
  );
  state.players[seat].melds.push({
    type: kind,
    tile: pending.tile,
    from: pending.from,
    ...(kind === "kong" && { kongKind: "direct" as const }),
  });
  state.pending = undefined;
  state.turn = seat;
  log(
    state,
    `${seat} 号玩家${kind === "kong" ? "直杠" : "碰"} ${labelOf(pending.tile)}。`,
  );
  if (kind === "kong") {
    transfer(state, pending.from, seat, 2);
    supplement(state, seat);
  } else {
    state.phase = "discard";
    state.afterKong = false;
    state.lastDraw = undefined;
  }
  return state;
}

function finishAddedKong(
  state: GameState,
  seat: number,
  chosen: Tile,
): GameState {
  const player = state.players[seat];
  const meld = player.melds.find(
    (entry) => entry.type === "pung" && entry.tile === chosen,
  );
  if (!meld) throw new Error("没有可补的碰牌");
  player.hand = removeOwned(player.hand, [chosen]);
  meld.type = "kong";
  meld.kongKind = "added";
  for (let other = 0; other < 4; other += 1) {
    if (other !== seat && !state.players[other].won)
      transfer(state, other, seat, 1);
  }
  state.pending = undefined;
  log(state, `${seat} 号玩家补杠 ${labelOf(chosen)}。`);
  supplement(state, seat);
  return state;
}

function resolveResponses(state: GameState): GameState {
  const pending = state.pending!;
  const huSeats = pending.eligible
    .filter((seat) => pending.answers[seat] === "hu")
    .sort(
      (a, b) => ((a - pending.from + 4) % 4) - ((b - pending.from + 4) % 4),
    );
  if (huSeats.length) {
    if (pending.kind === "rob-kong") {
      state.players[pending.from].hand = removeOwned(
        state.players[pending.from].hand,
        [pending.tile],
      );
      state.players[pending.from].discards.push(pending.tile);
      state.lastDiscard = { seat: pending.from, tile: pending.tile };
    }
    for (const seat of huSeats) {
      applyWin(state, seat, pending.tile, pending.from, {
        kongShot: pending.kind === "discard" && pending.kongShot,
        robKong: pending.kind === "rob-kong",
        seaBottom: pending.seaBottom,
      });
    }
    return advanceAfterDiscard(state, pending.from);
  }
  if (pending.kind === "rob-kong")
    return finishAddedKong(state, pending.from, pending.tile);
  for (const kind of ["kong", "pung"] as const) {
    const candidates = pending.eligible
      .filter((seat) => pending.answers[seat] === kind)
      .sort(
        (a, b) => ((a - pending.from + 4) % 4) - ((b - pending.from + 4) % 4),
      );
    if (candidates.length) return claimDiscard(state, candidates[0], kind);
  }
  return advanceAfterDiscard(state, pending.from);
}

export function respond(
  state: GameState,
  seat: number,
  choice: ResponseChoice,
): GameState {
  if (!legalResponses(state, seat).includes(choice))
    throw new Error("当前不能这样响应");
  const next = copy(state);
  next.pending!.answers[seat] = choice;
  if (next.pending!.eligible.every((other) => next.pending!.answers[other]))
    return resolveResponses(next);
  return next;
}

export function declareKong(
  state: GameState,
  seat: number,
  kind: KongKind,
  chosen: Tile,
): GameState {
  const legal = legalSelfActions(state, seat);
  if (
    !(kind === "concealed" ? legal.concealedKongs : legal.addedKongs).includes(
      chosen,
    )
  ) {
    throw new Error("当前不能开杠");
  }
  const next = copy(state);
  if (kind === "concealed") {
    next.players[seat].hand = removeOwned(next.players[seat].hand, [
      chosen,
      chosen,
      chosen,
      chosen,
    ]);
    next.players[seat].melds.push({
      type: "kong",
      tile: chosen,
      from: null,
      kongKind: "concealed",
    });
    for (let other = 0; other < 4; other += 1) {
      if (other !== seat && !next.players[other].won)
        transfer(next, other, seat, 2);
    }
    log(next, `${seat} 号玩家暗杠 ${labelOf(chosen)}。`);
    supplement(next, seat);
    return next;
  }
  const eligible = next.players.flatMap((player, other) =>
    other !== seat &&
    !player.won &&
    evaluateWin(
      [...player.hand, chosen],
      player.melds,
      player.missing!,
      { robKong: true },
      next.rules.fanCap,
    )
      ? [other]
      : [],
  );
  if (eligible.length) {
    next.phase = "respond";
    next.pending = {
      kind: "rob-kong",
      from: seat,
      tile: chosen,
      eligible,
      answers: {},
    };
    return next;
  }
  return finishAddedKong(next, seat, chosen);
}

export function winSelf(state: GameState, seat: number): GameState {
  if (!legalSelfActions(state, seat).canWin) throw new Error("当前不能自摸胡");
  const next = copy(state);
  const context = {
    kongFlower: next.lastDraw?.seat === seat && next.lastDraw.fromKong,
    seaBottom: next.lastDraw?.seat === seat && next.lastDraw.last,
  };
  const tile =
    next.lastDraw?.seat === seat
      ? next.lastDraw.tile
      : next.players[seat].hand.at(-1)!;
  applyWin(next, seat, tile, null, context);
  if (next.players.filter((player) => player.won).length >= 3)
    return finishThreeWins(next);
  if (next.wall.length === 0) return finishWall(next);
  next.turn = nextActive(next, seat);
  next.phase = "draw";
  next.afterKong = false;
  return next;
}

export function finishWall(state: GameState): GameState {
  if (
    state.wall.length !== 0 ||
    state.phase === "respond" ||
    state.phase === "ended"
  ) {
    throw new Error("现在不能流局结算");
  }
  const next = copy(state);
  const remaining = next.players.flatMap((player, seat) =>
    player.won ? [] : [seat],
  );
  const flowers = remaining.filter((seat) =>
    next.players[seat].hand.some(
      (item) => suitOf(item) === next.players[seat].missing,
    ),
  );
  const clean = remaining.filter((seat) => !flowers.includes(seat));
  for (const from of flowers) {
    for (const to of clean) transfer(next, from, to, next.rules.flowerPenalty);
  }
  if (flowers.length) log(next, `查花猪：${flowers.join("、")} 号玩家支付。`);
  if (next.rules.checkTenpai) {
    const waits = new Map(
      clean.map((seat) => [
        seat,
        waitingTiles(
          next.players[seat].hand,
          next.players[seat].melds,
          next.players[seat].missing!,
          next.rules.fanCap,
        ),
      ]),
    );
    const ready = clean.filter(
      (seat) => (waits.get(seat)?.tiles.length ?? 0) > 0,
    );
    const notReady = clean.filter((seat) => !ready.includes(seat));
    for (const from of notReady) {
      for (const to of ready)
        transfer(next, from, to, waits.get(to)!.maxPoints);
    }
    if (ready.length && notReady.length)
      log(next, `查叫：${notReady.join("、")} 号玩家向听牌者支付。`);
  }
  next.phase = "ended";
  next.endReason = "wall";
  log(next, "牌墙摸尽，本局结束。");
  return next;
}

export function countTiles(state: GameState): number {
  return (
    state.wall.length +
    state.players.reduce(
      (total, player) =>
        total +
        player.hand.length +
        player.discards.length +
        player.melds.reduce(
          (sum, meld) => sum + (meld.type === "kong" ? 4 : 3),
          0,
        ),
      0,
    )
  );
}
