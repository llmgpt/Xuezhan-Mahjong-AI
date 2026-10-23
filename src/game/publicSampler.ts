import {
  DEFAULT_RULES,
  discardClaimOptions,
  type PublicAction,
  type PublicTile,
} from "./game";
import { evaluateWin, type Meld, type WinContext } from "./scoring";
import { suitOf, type Suit, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface PublicParticleInput {
  readonly hands: readonly (readonly Tile[])[];
  readonly wall: readonly Tile[];
}

export interface PublicParticle extends PublicParticleInput {
  hands: Tile[][];
  wall: Tile[];
}

export class PublicSamplingError extends Error {
  constructor(
    public readonly code:
      "unsupported" | "history" | "inventory" | "unsatisfiable",
    message: string,
  ) {
    super(message);
    this.name = "PublicSamplingError";
  }
}

interface SeatInfo {
  seat: number;
  handCount: number;
  melds: readonly Meld[];
  discards: readonly Tile[];
  missing: Suit;
  won: boolean;
  score: number;
}

interface SeenWin {
  seat: number;
  tile: Tile;
  self: boolean;
  context: WinContext;
  payers: number[];
}

interface Constraints {
  seats: SeatInfo[];
  cleared: boolean[];
  wins: SeenWin[];
  points: number[][];
  remaining: number[];
  canonical: string;
  ron?: PublicRonContext;
}

export interface PublicRonContext {
  from: number;
  tile: Tile;
  winContext: WinContext;
  currentIncome: number;
}

type SamplingKind = "self" | "ron";

export const PUBLIC_SAMPLING_LIMITS = {
  maxParticles: 64,
  attemptsPerParticle: 64,
  templateNodesPerAttempt: 12_000,
} as const;

const assumptions = [
  "只支持V1默认规则及本家self弃牌决策；从完整publicActions核对公开历史、库存与积分，不接收原局seed或真实牌墙。",
  "暗手和牌墙是可复现的受约束近似样本，非均匀后验；不声称还原真实对手暗牌或策略选择概率。",
  "已胡者用标准型或七对的随机合法模板构造，并满足公开胡张、缺门和结算支付；模板顺序、分解数量及容量回溯会产生分布偏差。",
  "稳定暗手仅在最近一次真实摸牌后有非缺门弃牌或已合法胡牌时排除缺门；每次摸牌撤销旧清缺推断，保守放宽普通摸切的部分约束。",
  "活跃暗手采用逐张容量可行的随机分配，余牌随机排成墙；忽略未提供的换牌私有记忆，不按对手历史行为拟合牌型偏好。",
  `单次至多${PUBLIC_SAMPLING_LIMITS.maxParticles}个粒子；每粒子最多${PUBLIC_SAMPLING_LIMITS.attemptsPerParticle}次联合重试，每次至多${PUBLIC_SAMPLING_LIMITS.templateNodesPerAttempt}个赢家模板节点；无可行解或耗尽预算则显式失败，不返回凑数粒子。`,
];

function fail(code: PublicSamplingError["code"], message: string): never {
  throw new PublicSamplingError(code, message);
}

function fields(value: object, allowed: readonly string[]) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) fail("unsupported", `公开输入含未允许或隐藏字段 ${extra}`);
}

function seatNumber(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 3)
    fail("history", "公开历史含无效座位");
}

function tileNumber(value: Tile): void {
  if (!Number.isInteger(value) || value < 0 || value > 26)
    fail("inventory", "公开库存含无效牌");
}

const sorted = (tiles: readonly Tile[]) => [...tiles].sort((a, b) => a - b);
const meldKey = (meld: Meld) =>
  `${meld.type}:${meld.tile}:${meld.from ?? "null"}:${meld.kongKind ?? ""}`;
const meldKeys = (melds: readonly Meld[]) => melds.map(meldKey).sort();
const publicSequence = (tiles: readonly PublicTile[]) =>
  tiles.map((entry) => `${entry.seat}:${entry.kind}:${entry.tile}`);
const publicKeys = (tiles: readonly PublicTile[]) =>
  publicSequence(tiles).sort();
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function validateView(view: PlayerView, kind: SamplingKind): SeatInfo[] {
  fields(view, [
    "seat",
    "hand",
    "melds",
    "missing",
    "legalDiscards",
    "ownDiscards",
    "opponents",
    "wallRemaining",
    "publicTiles",
    "publicActions",
    "decision",
  ]);
  seatNumber(view.seat);
  if (kind === "self") {
    if (view.decision?.kind !== "self" || !view.legalDiscards.length)
      fail("unsupported", "采样只支持本家self弃牌决策");
    fields(view.decision, ["kind", "canWin", "concealedKongs", "addedKongs"]);
  } else {
    const decision = view.decision;
    if (
      decision?.kind !== "respond" ||
      decision.responseKind !== "discard" ||
      !Array.isArray(decision.choices) ||
      !decision.choices.includes("hu") ||
      view.legalDiscards.length
    )
      fail("unsupported", "采样只支持本家普通合法点胡响应");
    fields(decision, ["kind", "responseKind", "from", "tile", "choices"]);
    seatNumber(decision.from);
    tileNumber(decision.tile);
    if (decision.from === view.seat) fail("history", "响应来张不能来自本家");
  }
  if (!Array.isArray(view.publicActions))
    fail("unsupported", "缺少完整公开历史publicActions");
  if (!Array.isArray(view.publicTiles))
    fail("unsupported", "缺少当前公开库存publicTiles");
  if (
    !Number.isInteger(view.wallRemaining) ||
    view.wallRemaining < 0 ||
    view.wallRemaining > 55
  )
    fail("inventory", "牌墙余量无效");
  if (
    view.opponents.length !== 3 ||
    new Set(view.opponents.map((o) => o.seat)).size !== 3 ||
    view.opponents.some((o) => o.seat === view.seat)
  )
    fail("unsupported", "需要完整且不重复的四座位公开输入");
  for (const other of view.opponents)
    fields(other, [
      "seat",
      "handCount",
      "melds",
      "discards",
      "missing",
      "won",
      "score",
    ]);
  const ownScore = -view.opponents.reduce((sum, other) => sum + other.score, 0);
  const seats: SeatInfo[] = [0, 1, 2, 3].map((seat) => {
    const other = view.opponents.find((o) => o.seat === seat);
    return seat === view.seat
      ? {
          seat,
          handCount: view.hand.length,
          melds: view.melds,
          discards: view.ownDiscards,
          missing: view.missing!,
          won: false,
          score: ownScore,
        }
      : { ...other!, missing: other!.missing! };
  });
  for (const info of seats) {
    seatNumber(info.seat);
    if (!["wan", "tiao", "tong"].includes(info.missing))
      fail("unsupported", "四家均须已公开定缺");
    if (
      !Number.isInteger(info.handCount) ||
      info.handCount < 1 ||
      info.handCount > 14 ||
      info.melds.length > 4
    )
      fail("inventory", "公开手牌数或副露数无效");
    if (!Number.isSafeInteger(info.score)) fail("history", "公开积分score无效");
    for (const meld of info.melds) {
      fields(meld, ["type", "tile", "from", "kongKind"]);
      tileNumber(meld.tile);
      if (
        suitOf(meld.tile) === info.missing ||
        !["pung", "kong"].includes(meld.type)
      )
        fail("history", "公开副露违反缺门规则");
    }
    info.discards.forEach(tileNumber);
  }
  view.hand.forEach(tileNumber);
  view.legalDiscards.forEach(tileNumber);
  if (view.hand.length !== (kind === "self" ? 14 : 13) - 3 * view.melds.length)
    fail("inventory", "本家摸打或普通响应手牌数不符");
  const missing = view.hand.filter((tile) => suitOf(tile) === view.missing);
  const legal = [...new Set(missing.length ? missing : view.hand)];
  if (kind === "self" && !equal(sorted(legal), sorted(view.legalDiscards)))
    fail("history", "本家合法弃牌与公开手牌不符");
  return seats;
}

function actionFields(action: PublicAction) {
  seatNumber(action.seat);
  const byKind: Record<PublicAction["kind"], string[]> = {
    draw: ["seat", "kind"],
    discard: ["seat", "kind", "tile"],
    pung: ["seat", "kind", "tile", "from"],
    kong: ["seat", "kind", "tile", "kongKind", "from"],
    "added-kong-offer": ["seat", "kind", "tile"],
    win: ["seat", "kind", "tile", "winKind", "from"],
  };
  if (!Object.hasOwn(byKind, action.kind)) fail("history", "未知公开历史动作");
  fields(action, byKind[action.kind]);
  if ("tile" in action) tileNumber(action.tile);
  if ("from" in action && action.from !== null) seatNumber(action.from);
}

function replayHistory(
  view: PlayerView,
  seats: SeatInfo[],
  kind: SamplingKind,
) {
  const handCounts = [14, 13, 13, 13];
  const melds: Meld[][] = [[], [], [], []];
  const discards: Tile[][] = [[], [], [], []];
  const publicTiles: PublicTile[] = [];
  const won = [false, false, false, false];
  const cleared = [false, false, false, false];
  const cash = [0, 0, 0, 0];
  const wins: SeenWin[] = [];
  let draws = 0;
  let turn = 0;
  let mode:
    "discard" | "response" | "supplement" | "offer" | "robbed" | "self-win" =
    "discard";
  let lastDraw: { seat: number; fromKong: boolean; last: boolean } | undefined;
  let window:
    { seat: number; tile: Tile; context: WinContext; won: boolean } | undefined;
  let offer: { seat: number; tile: Tile } | undefined;
  const transfer = (from: number, to: number, points: number) => {
    cash[from] -= points;
    cash[to] += points;
  };
  const payers = (seat: number) =>
    [0, 1, 2, 3].filter((s) => s !== seat && !won[s]);
  const next = (from: number) => {
    for (let n = 1; n <= 4; n++)
      if (!won[(from + n) % 4]) return (from + n) % 4;
    return fail("history", "公开历史没有存活玩家");
  };
  const requireTurn = (seat: number) => {
    if (mode !== "discard" || turn !== seat)
      fail("history", "公开历史摸打顺序不一致");
  };
  const claim = (seat: number, tile: Tile, from: number) => {
    if (
      mode !== "response" ||
      !window ||
      window.won ||
      window.seat !== from ||
      window.tile !== tile ||
      from === seat
    )
      fail("history", "公开认领动作没有对应弃牌");
    const index = discards[from].lastIndexOf(tile);
    let shown = publicTiles.length - 1;
    while (
      shown >= 0 &&
      !(
        publicTiles[shown].kind === "discard" &&
        publicTiles[shown].seat === from &&
        publicTiles[shown].tile === tile
      )
    )
      shown--;
    if (index < 0 || shown < 0) fail("history", "被认领的公开弃牌缺失");
    discards[from].splice(index, 1);
    publicTiles.splice(shown, 1);
    window = undefined;
  };
  for (const [index, action] of view.publicActions!.entries()) {
    actionFields(action);
    const seat = action.seat;
    if (won[seat]) fail("history", "已胡玩家继续行动或重复胡牌");
    if (action.kind === "draw") {
      const fromKong = mode === "supplement" || mode === "offer";
      if (fromKong) {
        if (seat !== turn) fail("history", "公开补牌座位不一致");
        if (mode === "offer") {
          const pung = melds[seat].find(
            (m) => m.type === "pung" && m.tile === offer?.tile,
          );
          if (!pung) fail("history", "补杠没有对应明碰");
          pung.type = "kong";
          pung.kongKind = "added";
          for (const payer of payers(seat)) transfer(payer, seat, 1);
        }
      } else {
        const from =
          mode === "response"
            ? window?.seat
            : mode === "robbed"
              ? offer?.seat
              : mode === "self-win"
                ? turn
                : undefined;
        if (from === undefined || seat !== next(from))
          fail("history", "公开draw摸牌顺序缺失或不一致");
      }
      if (++draws > 55) fail("history", "公开draw超过初始牌墙");
      // 摸缺门后仍可杠其他牌；补杠被抢或多次补牌会让新缺门牌留手。
      cleared[seat] = false;
      handCounts[seat]++;
      lastDraw = { seat, fromKong, last: draws === 55 };
      turn = seat;
      mode = "discard";
      offer = undefined;
      window = undefined;
    } else if (action.kind === "discard") {
      requireTurn(seat);
      handCounts[seat]--;
      discards[seat].push(action.tile);
      publicTiles.push({ seat, kind: "discard", tile: action.tile });
      if (suitOf(action.tile) !== seats[seat].missing) cleared[seat] = true;
      window = {
        seat,
        tile: action.tile,
        won: false,
        context: {
          seaBottom: lastDraw?.seat === seat && lastDraw.last,
          kongShot: lastDraw?.seat === seat && lastDraw.fromKong,
        },
      };
      mode = "response";
    } else if (action.kind === "pung") {
      claim(seat, action.tile, action.from);
      handCounts[seat] -= 2;
      melds[seat].push({ type: "pung", tile: action.tile, from: action.from });
      turn = seat;
      mode = "discard";
      lastDraw = undefined;
    } else if (action.kind === "kong") {
      if (draws >= 55) fail("history", "牌墙已空仍公开开杠");
      if (action.kongKind === "direct" && action.from !== null) {
        claim(seat, action.tile, action.from);
        handCounts[seat] -= 3;
        transfer(action.from, seat, 2);
      } else if (action.kongKind === "concealed" && action.from === null) {
        requireTurn(seat);
        if (!(lastDraw?.seat === seat || (index === 0 && seat === 0)))
          fail("history", "非摸牌后非法暗杠");
        handCounts[seat] -= 4;
        for (const payer of payers(seat)) transfer(payer, seat, 2);
      } else fail("history", "公开杠类型或来源无效");
      melds[seat].push({
        type: "kong",
        tile: action.tile,
        from: action.from,
        kongKind: action.kongKind,
      });
      turn = seat;
      mode = "supplement";
    } else if (action.kind === "added-kong-offer") {
      requireTurn(seat);
      if (
        draws >= 55 ||
        lastDraw?.seat !== seat ||
        !melds[seat].some((m) => m.type === "pung" && m.tile === action.tile)
      )
        fail("history", "公开补杠提议缺少摸牌或明碰");
      handCounts[seat]--;
      offer = { seat, tile: action.tile };
      mode = "offer";
    } else {
      let context: WinContext;
      let sources: number[];
      if (action.winKind === "self" && action.from === null) {
        requireTurn(seat);
        if (!(lastDraw?.seat === seat || (index === 0 && seat === 0)))
          fail("history", "公开自摸缺少本家摸牌");
        context = {
          kongFlower: lastDraw?.seat === seat && lastDraw.fromKong,
          seaBottom: lastDraw?.seat === seat && lastDraw.last,
        };
        sources = payers(seat);
        for (const source of sources) transfer(source, seat, 1);
        publicTiles.push({ seat, kind: "self-win", tile: action.tile });
        mode = "self-win";
        turn = seat;
      } else if (action.winKind === "discard" && action.from !== null) {
        if (
          mode !== "response" ||
          !window ||
          window.seat !== action.from ||
          window.tile !== action.tile ||
          action.from === seat
        )
          fail("history", "公开点胡没有对应弃牌");
        context = { ...window.context };
        sources = [action.from];
        window.won = true;
      } else if (action.winKind === "rob-kong" && action.from !== null) {
        if (
          (mode !== "offer" && mode !== "robbed") ||
          !offer ||
          offer.seat !== action.from ||
          offer.tile !== action.tile ||
          action.from === seat
        )
          fail("history", "公开抢杠胡没有对应补杠提议");
        if (mode === "offer") {
          discards[offer.seat].push(offer.tile);
          publicTiles.push({
            seat: offer.seat,
            kind: "discard",
            tile: offer.tile,
          });
        }
        mode = "robbed";
        context = { robKong: true };
        sources = [action.from];
      } else return fail("history", "公开胡牌类型与付款方不一致");
      wins.push({
        seat,
        tile: action.tile,
        self: action.winKind === "self",
        context,
        payers: sources,
      });
      won[seat] = true;
      cleared[seat] = true;
      if (wins.length > 2) fail("unsupported", "三家已胡后不支持继续采样");
    }
    if (
      handCounts.some((count) => count < 0 || count > 14) ||
      melds.some((groups) => groups.length > 4)
    )
      fail("history", "公开历史的手牌数或副露数不可能");
  }
  if (draws !== 55 - view.wallRemaining)
    fail("history", "公开draw摸牌数与牌墙余量不符");
  let ron: PublicRonContext | undefined;
  if (kind === "ron") {
    const decision = view.decision;
    if (
      decision?.kind !== "respond" ||
      mode !== "response" ||
      !window ||
      window.won ||
      won[view.seat] ||
      decision.from !== window.seat ||
      decision.tile !== window.tile
    )
      fail("history", "公开历史与当前普通点胡响应窗口不符");
    const own = seats[view.seat];
    const choices = [
      "pass",
      ...discardClaimOptions(
        { hand: view.hand, melds: own.melds, missing: own.missing },
        decision.tile,
        view.wallRemaining,
        DEFAULT_RULES.fanCap,
      ),
    ];
    if (!equal(decision.choices, choices))
      fail("history", "本家合法响应集与公开手牌不符");
    const evaluation = evaluateWin(
      [...view.hand, decision.tile],
      own.melds,
      own.missing,
      window.context,
    );
    if (!evaluation) fail("history", "当前响应不是V1合法胡牌");
    ron = {
      from: decision.from,
      tile: decision.tile,
      winContext: { ...window.context },
      currentIncome: evaluation.points,
    };
  } else {
    if (mode !== "discard" || turn !== view.seat || won[view.seat])
      fail("history", "公开历史不是当前本家self弃牌阶段");
    const self = view.decision!;
    if (self.kind !== "self") fail("unsupported", "缺少self弃牌上下文");
    const canAct =
      lastDraw?.seat === view.seat ||
      (view.publicActions!.length === 0 && view.seat === 0);
    const own = seats[view.seat];
    const canWin =
      canAct &&
      evaluateWin(view.hand, own.melds, own.missing, {
        kongFlower: lastDraw?.seat === view.seat && lastDraw.fromKong,
        seaBottom: lastDraw?.seat === view.seat && lastDraw.last,
      }) !== null;
    const concealed =
      canAct && view.wallRemaining > 0
        ? [...new Set(view.hand)].filter(
            (tile) =>
              suitOf(tile) !== own.missing &&
              view.hand.filter((held) => held === tile).length === 4,
          )
        : [];
    const added =
      canAct && view.wallRemaining > 0
        ? own.melds
            .filter(
              (meld) =>
                meld.type === "pung" &&
                suitOf(meld.tile) !== own.missing &&
                view.hand.includes(meld.tile),
            )
            .map((meld) => meld.tile)
        : [];
    if (
      self.canWin !== canWin ||
      !equal(sorted(self.concealedKongs), sorted(concealed)) ||
      !equal(sorted(self.addedKongs), sorted(added))
    )
      fail("history", "本家合法胡牌或杠牌上下文与公开历史不符");
  }
  for (const info of seats) {
    if (
      handCounts[info.seat] !== info.handCount ||
      won[info.seat] !== info.won ||
      !equal(meldKeys(melds[info.seat]), meldKeys(info.melds)) ||
      !equal(sorted(discards[info.seat]), sorted(info.discards))
    )
      fail("history", `公开历史与${info.seat}家手牌数、副露或弃牌不符`);
  }
  for (const shown of view.publicTiles!) {
    fields(shown, ["seat", "tile", "kind"]);
    seatNumber(shown.seat);
    tileNumber(shown.tile);
  }
  if (!equal(publicSequence(publicTiles), publicSequence(view.publicTiles!)))
    fail("history", "公开历史与未认领publicTiles库存或顺序不符");
  const points: number[][] = [];
  const chosen: number[] = [];
  const search = (index: number, scores: number[]) => {
    if (index === wins.length) {
      if (scores.every((value, seat) => value === seats[seat].score))
        points.push([...chosen]);
      return;
    }
    const win = wins[index];
    for (const value of [1, 2, 4, 8]) {
      const nextScores = [...scores];
      for (const payer of win.payers) {
        nextScores[payer] -= value;
        nextScores[win.seat] += value;
      }
      chosen.push(value);
      search(index + 1, nextScores);
      chosen.pop();
    }
  };
  search(0, cash);
  if (!points.length) fail("history", "V1默认积分结算无法解释公开score");
  return { cleared, wins, points, ...(ron && { ron }) };
}

function constraintsFor(
  view: PlayerView,
  kind: SamplingKind = "self",
): Constraints {
  const seats = validateView(view, kind);
  const history = replayHistory(view, seats, kind);
  const remaining = Array<number>(27).fill(4);
  const take = (tile: Tile) => {
    if (--remaining[tile] < 0) fail("inventory", "公开库存超过每种牌四张");
  };
  view.hand.forEach(take);
  for (const seat of seats) {
    for (const meld of seat.melds)
      for (let n = 0; n < (meld.type === "kong" ? 4 : 3); n++) take(meld.tile);
    seat.discards.forEach(take);
  }
  for (const win of history.wins) if (win.self) take(win.tile);
  const needed =
    view.wallRemaining +
    seats
      .filter((s) => s.seat !== view.seat)
      .reduce((sum, s) => sum + s.handCount, 0) -
    history.wins.filter((w) => w.self).length;
  if (remaining.reduce((sum, n) => sum + n, 0) !== needed)
    fail("inventory", "108张实体库存与公开手牌、牌墙不守恒");
  const canonical = JSON.stringify({
    seat: view.seat,
    hand: sorted(view.hand),
    legalDiscards: sorted(view.legalDiscards),
    seats: seats.map((s) => ({
      seat: s.seat,
      handCount: s.handCount,
      missing: s.missing,
      won: s.won,
      score: s.score,
      melds: meldKeys(s.melds),
      discards: sorted(s.discards),
    })),
    wallRemaining: view.wallRemaining,
    publicTiles: publicKeys(view.publicTiles!),
    publicActions: view.publicActions!.map((a) => {
      if (a.kind === "draw") return [a.kind, a.seat];
      if (a.kind === "discard" || a.kind === "added-kong-offer")
        return [a.kind, a.seat, a.tile];
      if (a.kind === "pung") return [a.kind, a.seat, a.tile, a.from];
      if (a.kind === "kong")
        return [a.kind, a.seat, a.tile, a.from, a.kongKind];
      return [a.kind, a.seat, a.tile, a.from, a.winKind];
    }),
    decision:
      kind === "ron" && view.decision?.kind === "respond"
        ? [
            "ordinary-ron-v1",
            view.decision.from,
            view.decision.tile,
            view.decision.choices,
          ]
        : [
            view.decision!.kind,
            view.decision!.kind === "self" && view.decision!.canWin,
          ],
  });
  return { ...history, seats, remaining, canonical };
}

function rngFor(text: string): () => number {
  let state = 2166136261;
  for (let n = 0; n < text.length; n++)
    state = Math.imul(state ^ text.charCodeAt(n), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function assertParticleWithConstraints(
  view: PlayerView,
  particle: PublicParticleInput,
  constraints: Constraints,
): void {
  if (!particle || typeof particle !== "object")
    fail("inventory", "粒子须提供四家暗手及牌墙");
  fields(particle, ["hands", "wall"]);
  if (
    !Array.isArray(particle.hands) ||
    particle.hands.length !== 4 ||
    !Array.isArray(particle.wall)
  )
    fail("inventory", "粒子须提供四家暗手及牌墙");
  if (particle.wall.length !== view.wallRemaining)
    fail("inventory", "粒子牌墙张数与公开余量不符");
  for (const info of constraints.seats) {
    const hand = particle.hands[info.seat];
    if (!Array.isArray(hand) || hand.length !== info.handCount)
      fail("inventory", `粒子${info.seat}家手牌数不符`);
    hand.forEach(tileNumber);
    if (
      info.seat !== view.seat &&
      constraints.cleared[info.seat] &&
      hand.some((tile) => suitOf(tile) === info.missing)
    )
      fail("history", `粒子${info.seat}家违反公开清缺门约束`);
  }
  particle.wall.forEach(tileNumber);
  if (!equal(particle.hands[view.seat], view.hand))
    fail("inventory", "粒子本家原手发生改变");
  const remaining = [...constraints.remaining];
  const take = (tile: Tile) => {
    if (--remaining[tile] < 0) fail("inventory", "粒子实体库存超过每种牌四张");
  };
  for (const info of constraints.seats.filter(
    (seat) => seat.seat !== view.seat,
  )) {
    const unknown = [...particle.hands[info.seat]];
    const win = constraints.wins.find((win) => win.seat === info.seat);
    if (win?.self) {
      const anchor = unknown.indexOf(win.tile);
      if (anchor < 0) fail("history", "粒子自摸胡牌暗手缺少已公开胡张");
      unknown.splice(anchor, 1);
    }
    unknown.forEach(take);
  }
  particle.wall.forEach(take);
  if (remaining.some((copies) => copies !== 0))
    fail("inventory", "粒子与公开信息合计不是108张实体牌");
  const points = constraints.wins.map((win) => {
    const info = constraints.seats[win.seat];
    const concealed = particle.hands[win.seat];
    const evaluation = evaluateWin(
      win.self ? concealed : [...concealed, win.tile],
      info.melds,
      info.missing,
      win.context,
    );
    if (!evaluation)
      fail("history", `粒子${win.seat}家已胡但暗手不满足合法胡型`);
    return evaluation.points;
  });
  if (!constraints.points.some((allowed) => equal(allowed, points)))
    fail("history", "粒子赢家胡型番数与公开积分支付不相容");
}

/** 验证外部粒子与V1公开事实相容；不读取原局暗手、seed或牌墙。 */
export function assertPublicParticle(
  view: PlayerView,
  particle: PublicParticleInput,
): void {
  assertParticleWithConstraints(view, particle, constraintsFor(view));
}

function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let n = result.length - 1; n > 0; n--) {
    const other = Math.floor(random() * (n + 1));
    [result[n], result[other]] = [result[other], result[n]];
  }
  return result;
}

function winningTemplate(
  info: SeatInfo,
  win: SeenWin,
  points: number,
  remaining: number[],
  random: () => number,
  budget: { nodes: number },
): Tile[] | undefined {
  if (suitOf(win.tile) === info.missing) return undefined;
  const extraFan = Object.values(win.context).filter(Boolean).length;
  const fixedFan =
    extraFan +
    info.melds.filter((meld) => meld.type === "kong").length +
    Number(info.melds.length === 4);
  if (points < 2 ** Math.min(3, fixedFan)) return undefined;
  const capacity = [...remaining];
  capacity[win.tile]++;
  const exposed = Array<number>(27).fill(0);
  for (const meld of info.melds)
    exposed[meld.tile] += meld.type === "kong" ? 4 : 3;
  for (let tile = 0; tile < 27; tile++)
    capacity[tile] =
      suitOf(tile) === info.missing
        ? 0
        : Math.min(capacity[tile], 4 - exposed[tile]);
  const allowed = Array.from({ length: 27 }, (_, tile) => tile).filter(
    (tile) => capacity[tile] > 0,
  );
  const groups: Tile[][] = [];
  for (const tile of allowed) {
    if (capacity[tile] >= 3) groups.push([tile, tile, tile]);
    if (tile % 9 <= 6 && capacity[tile + 1] && capacity[tile + 2])
      groups.push([tile, tile + 1, tile + 2]);
  }
  const pairs = allowed
    .filter((tile) => capacity[tile] >= 2)
    .map((tile) => [tile, tile]);
  const cards: Tile[] = [];
  const use = (part: readonly Tile[], direction: -1 | 1) => {
    for (const tile of part) capacity[tile] += direction;
  };
  const fits = (part: readonly Tile[]) =>
    part.every(
      (tile) => capacity[tile] >= part.filter((x) => x === tile).length,
    );
  const finish = () => {
    if (!cards.includes(win.tile)) return undefined;
    const result = evaluateWin(cards, info.melds, info.missing, win.context);
    return result?.points === points ? [...cards] : undefined;
  };
  const fill = (
    parts: number,
    choices: readonly Tile[][],
  ): Tile[] | undefined => {
    if (++budget.nodes > PUBLIC_SAMPLING_LIMITS.templateNodesPerAttempt)
      return undefined;
    if (!parts) return finish();
    for (const group of shuffleWith(choices, random)) {
      if (!fits(group)) continue;
      use(group, -1);
      cards.push(...group);
      const found = fill(parts - 1, choices);
      cards.length -= group.length;
      use(group, 1);
      if (found) return found;
      if (budget.nodes >= PUBLIC_SAMPLING_LIMITS.templateNodesPerAttempt)
        return undefined;
    }
    return undefined;
  };
  const families =
    info.melds.length === 0 && points >= 2 ** Math.min(3, 2 + extraFan)
      ? shuffleWith(["standard", "pairs"], random)
      : ["standard"];
  for (const family of families) {
    if (family === "pairs") {
      const head = [win.tile, win.tile];
      if (!fits(head)) continue;
      use(head, -1);
      cards.push(...head);
      const found = fill(6, pairs);
      cards.length = 0;
      use(head, 1);
      if (found) return found;
    } else {
      const anchors = [
        { part: [win.tile, win.tile], head: true },
        ...groups
          .filter((group) => group.includes(win.tile))
          .map((part) => ({ part, head: false })),
      ];
      for (const anchor of shuffleWith(anchors, random)) {
        if (!fits(anchor.part)) continue;
        const neededGroups = 4 - info.melds.length - Number(!anchor.head);
        if (neededGroups < 0) continue;
        use(anchor.part, -1);
        cards.push(...anchor.part);
        for (const head of anchor.head ? [[]] : shuffleWith(pairs, random)) {
          if (!fits(head)) continue;
          use(head, -1);
          cards.push(...head);
          const found = fill(neededGroups, groups);
          cards.length -= head.length;
          use(head, 1);
          if (found) {
            cards.length = 0;
            use(anchor.part, 1);
            return found;
          }
          if (budget.nodes >= PUBLIC_SAMPLING_LIMITS.templateNodesPerAttempt)
            break;
        }
        cards.length = 0;
        use(anchor.part, 1);
        if (budget.nodes >= PUBLIC_SAMPLING_LIMITS.templateNodesPerAttempt)
          return undefined;
      }
    }
  }
  return undefined;
}

function capacityFeasible(
  remaining: readonly number[],
  active: readonly SeatInfo[],
  needs: readonly number[],
  cleared: readonly boolean[],
): boolean {
  for (let subset = 1; subset < 1 << active.length; subset++) {
    let demand = 0;
    const members = active.filter((_, index) => subset & (1 << index));
    active.forEach((_, index) => {
      if (subset & (1 << index)) demand += needs[index];
    });
    const supply = remaining.reduce(
      (sum, n, tile) =>
        sum +
        (members.some(
          (info) => !cleared[info.seat] || suitOf(tile) !== info.missing,
        )
          ? n
          : 0),
      0,
    );
    if (demand > supply) return false;
  }
  return true;
}

function makeParticle(
  view: PlayerView,
  constraints: Constraints,
  index: number,
): PublicParticle {
  const random = rngFor(`${constraints.canonical}:${index}`);
  const active = constraints.seats.filter(
    (info) => info.seat !== view.seat && !info.won,
  );
  const winners = [...constraints.wins].sort(
    (a, b) =>
      constraints.seats[a.seat].handCount -
        constraints.seats[b.seat].handCount || a.seat - b.seat,
  );
  for (
    let attempt = 0;
    attempt < PUBLIC_SAMPLING_LIMITS.attemptsPerParticle;
    attempt++
  ) {
    const remaining = [...constraints.remaining];
    const hands: Tile[][] = [[], [], [], []];
    hands[view.seat] = [...view.hand];
    const values =
      constraints.points[Math.floor(random() * constraints.points.length)];
    const budget = { nodes: 0 };
    let failed = false;
    for (const win of winners) {
      const template = winningTemplate(
        constraints.seats[win.seat],
        win,
        values[constraints.wins.indexOf(win)],
        remaining,
        random,
        budget,
      );
      if (!template) {
        failed = true;
        break;
      }
      const unknown = [...template];
      unknown.splice(unknown.indexOf(win.tile), 1);
      for (const tile of unknown)
        if (--remaining[tile] < 0)
          return fail("inventory", "赢家模板消耗了不存在的实体牌");
      hands[win.seat] = win.self ? sorted(template) : sorted(unknown);
    }
    if (failed) continue;
    const needs = active.map((info) => info.handCount);
    if (!capacityFeasible(remaining, active, needs, constraints.cleared))
      continue;
    while (needs.some((n) => n > 0)) {
      const actor = needs.findIndex((n) => n > 0);
      const info = active[actor];
      const candidates: { tile: Tile; weight: number }[] = [];
      needs[actor]--;
      for (let tile = 0; tile < 27; tile++) {
        if (
          !remaining[tile] ||
          (constraints.cleared[info.seat] && suitOf(tile) === info.missing)
        )
          continue;
        const weight = remaining[tile];
        remaining[tile]--;
        if (capacityFeasible(remaining, active, needs, constraints.cleared))
          candidates.push({ tile, weight });
        remaining[tile]++;
      }
      if (!candidates.length)
        return fail("inventory", "活跃暗手容量分配内部失败");
      let draw =
        random() * candidates.reduce((sum, entry) => sum + entry.weight, 0);
      let chosen = candidates.at(-1)!;
      for (const candidate of candidates) {
        draw -= candidate.weight;
        if (draw < 0) {
          chosen = candidate;
          break;
        }
      }
      remaining[chosen.tile]--;
      hands[info.seat].push(chosen.tile);
    }
    for (const info of active) hands[info.seat].sort((a, b) => a - b);
    const wall = shuffleWith(
      remaining.flatMap((n, tile) => Array<Tile>(n).fill(tile)),
      random,
    );
    if (wall.length !== view.wallRemaining)
      return fail("inventory", "采样后牌墙长度不符");
    const particle = { hands, wall };
    assertParticleWithConstraints(view, particle, constraints);
    return particle;
  }
  return fail(
    "unsatisfiable",
    `公开条件无可行采样或耗尽预算：粒子${index}，${PUBLIC_SAMPLING_LIMITS.attemptsPerParticle}次联合尝试`,
  );
}

function sampleFor(
  view: PlayerView,
  count: number,
  kind: SamplingKind,
): { particles: PublicParticle[]; assumptions: string[] } {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > PUBLIC_SAMPLING_LIMITS.maxParticles
  )
    fail(
      "unsupported",
      `采样数量须为0到${PUBLIC_SAMPLING_LIMITS.maxParticles}的整数`,
    );
  const constraints = constraintsFor(view, kind);
  return {
    particles: Array.from({ length: count }, (_, index) =>
      makeParticle(view, constraints, index),
    ),
    assumptions:
      kind === "self"
        ? [...assumptions]
        : [
            "只支持V1普通合法点胡响应；完整公开历史、13−3m暗手及来张库存已核对；其他人的未公开响应只能在合成粒子中建模，不能还原真实队列。",
            ...assumptions.slice(1),
          ],
  };
}

export function samplePublicParticles(view: PlayerView, count: number) {
  return sampleFor(view, count, "self");
}

export function samplePublicRonParticles(view: PlayerView, count: number) {
  return sampleFor(view, count, "ron");
}

export function assertPublicRonParticle(
  view: PlayerView,
  particle: PublicParticleInput,
): void {
  assertParticleWithConstraints(view, particle, constraintsFor(view, "ron"));
}

export function publicRonContext(view: PlayerView): PublicRonContext {
  return structuredClone(constraintsFor(view, "ron").ron!);
}
