import { describe, expect, it } from "vitest";
import {
  countTiles,
  createGame,
  declareKong,
  discard,
  draw,
  legalResponses,
  respond,
  winSelf,
  type GameState,
} from "./game";
import { applyDecisionAction } from "./decision";
import { chooseTeacherAction } from "./teacher";
import { evaluateWin } from "./scoring";
import {
  assertPublicParticle,
  PublicSamplingError,
  samplePublicParticles,
} from "./publicSampler";
import { hand } from "./testHelpers";
import { createWall, suitOf, tile, type Suit, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

function initialScene(
  chosen: Partial<Record<number, Tile[]>>,
  missing: Partial<Record<number, Suit>> = {},
): GameState {
  const available = createWall();
  for (const owned of Object.values(chosen)) {
    for (const item of owned ?? []) {
      const index = available.indexOf(item);
      if (index < 0) throw new Error("合成牌例超过四张同牌");
      available.splice(index, 1);
    }
  }
  const state = createGame(80000);
  state.phase = "discard";
  state.players = state.players.map((_, seat) => ({
    hand: chosen[seat] ?? available.splice(0, seat === 0 ? 14 : 13),
    melds: [],
    discards: [],
    missing: missing[seat] ?? "tong",
    won: false,
    score: 0,
  }));
  state.wall = available;
  expect(state.wall).toHaveLength(55);
  expect(countTiles(state)).toBe(108);
  return state;
}

function firstDiscard(): GameState {
  let state = createGame(80000);
  for (const phase of ["exchange", "choose-missing"] as const) {
    for (let seat = 0; seat < 4; seat += 1) {
      expect(state.phase).toBe(phase);
      const action = chooseTeacherAction(playerView(state, seat), phase)!;
      state = applyDecisionAction(state, seat, action);
    }
  }
  return state;
}

function answerAll(
  state: GameState,
  winners: number[] = [],
  pungSeat?: number,
) {
  let next = state;
  while (next.phase === "respond") {
    const seat = next.pending!.eligible.find(
      (other) => legalResponses(next, other).length > 0,
    )!;
    next = respond(
      next,
      seat,
      winners.includes(seat) ? "hu" : seat === pungSeat ? "pung" : "pass",
    );
  }
  return next;
}

function currentView(state: GameState): PlayerView {
  const ready = state.phase === "draw" ? draw(state, state.turn) : state;
  expect(ready.phase).toBe("discard");
  return playerView(ready, ready.turn);
}

function beforeAddedKong(clearThenMissing = false): GameState {
  let state = initialScene(
    {
      0: hand("w1 d1122334455667"),
      1: hand(clearThenMissing ? "w111 s1122334456" : "w111 d778899 s1234"),
      2: hand("w23456789 s12355"),
    },
    { 0: "tiao" },
  );
  state = answerAll(discard(state, 0, tile("wan", 1)), [], 1);
  state = answerAll(
    discard(state, 1, clearThenMissing ? tile("tiao", 6) : tile("tong", 7)),
  );
  for (const seat of [2, 3, 0]) {
    expect(state.turn).toBe(seat);
    state = draw(state, seat);
    state = answerAll(discard(state, seat, state.lastDraw!.tile));
  }
  expect(state.turn).toBe(1);
  if (clearThenMissing) {
    const missingIndex = state.wall.findIndex(
      (item) => suitOf(item) === "tong",
    );
    expect(missingIndex).toBeGreaterThanOrEqual(0);
    const [missingTile] = state.wall.splice(missingIndex, 1);
    state.wall.unshift(missingTile);
  }
  return draw(state, 1);
}

function physicalTiles(
  view: PlayerView,
  particle: { hands: Tile[][]; wall: Tile[] },
) {
  const melds = [
    view.melds,
    ...view.opponents.map((other) => other.melds),
  ].flat();
  return [
    ...particle.hands.flat(),
    ...particle.wall,
    ...melds.flatMap((meld) =>
      Array<Tile>(meld.type === "kong" ? 4 : 3).fill(meld.tile),
    ),
    ...(view.publicTiles ?? [])
      .filter((entry) => entry.kind === "discard")
      .map((entry) => entry.tile),
  ].sort((a, b) => a - b);
}

function assertParticle(
  view: PlayerView,
  particle: { hands: Tile[][]; wall: Tile[] },
) {
  expect(particle.hands).toHaveLength(4);
  expect(particle.hands[view.seat]).toEqual(view.hand);
  expect(particle.wall).toHaveLength(view.wallRemaining);
  for (const other of view.opponents)
    expect(particle.hands[other.seat]).toHaveLength(other.handCount);
  expect(physicalTiles(view, particle)).toEqual(createWall());
}

describe("只基于公开view的受约束采样", () => {
  it("真实引擎开局的每粒子保留本家，满足108张实体库存和手牌数", () => {
    const view = playerView(firstDiscard(), 0);
    const before = structuredClone(view);
    const result = samplePublicParticles(view, 4);
    expect(result.particles).toHaveLength(4);
    for (const particle of result.particles) assertParticle(view, particle);
    expect(view).toEqual(before);
    expect(result.assumptions.join(" ")).toMatch(/近似|非均匀/);
    expect(result.assumptions.join(" ")).toContain("V1");
  });

  it("只由规范化view与粒子序号决定，跨座位调用和请求数量不改变前缀", () => {
    const state = firstDiscard();
    const view = playerView(state, 0);
    const expected = samplePublicParticles(view, 3);
    const afterDrop = answerAll(discard(state, 0, view.legalDiscards[0]));
    samplePublicParticles(currentView(afterDrop), 2);
    expect(samplePublicParticles(view, 3)).toEqual(expected);
    expect(samplePublicParticles(view, 2).particles).toEqual(
      expected.particles.slice(0, 2),
    );
    const reordered = structuredClone(view);
    reordered.opponents.reverse();
    reordered.opponents = reordered.opponents.map(
      (other) =>
        Object.fromEntries(Object.entries(other).reverse()) as typeof other,
    );
    reordered.legalDiscards.reverse();
    reordered.hand.reverse();
    const same = samplePublicParticles(reordered, 3);
    expect(same.particles.map((p) => p.wall)).toEqual(
      expected.particles.map((p) => p.wall),
    );
    expect(
      same.particles.map((p) =>
        p.hands.filter((_, seat) => seat !== view.seat),
      ),
    ).toEqual(
      expected.particles.map((p) =>
        p.hands.filter((_, seat) => seat !== view.seat),
      ),
    );
  });

  it("修改输出粒子不能污染原view、其他粒子或后续同view调用", () => {
    const view = playerView(firstDiscard(), 0);
    const before = structuredClone(view);
    const first = samplePublicParticles(view, 2);
    const expected = structuredClone(first);
    first.particles[0].hands[view.seat][0] = 26;
    first.particles[0].hands[1].push(26);
    first.particles[0].wall.pop();
    expect(first.particles[1]).toEqual(expected.particles[1]);
    expect(samplePublicParticles(view, 2)).toEqual(expected);
    expect(view).toEqual(before);
  });

  it("已公开自摸胡张只在赢家手牌出现一次实体归属，赢家样本必须合法成胡且支付相容", () => {
    const won = winSelf(initialScene({ 0: hand("w11123499 s345678") }), 0);
    const view = currentView(won);
    const shown = view.publicTiles!.find((entry) => entry.kind === "self-win")!;
    const winner = view.opponents.find((other) => other.seat === shown.seat)!;
    const particles = samplePublicParticles(view, 4).particles;
    for (const particle of particles) {
      assertParticle(view, particle);
      expect(particle.hands[winner.seat]).toContain(shown.tile);
      expect(
        evaluateWin(particle.hands[winner.seat], winner.melds, winner.missing!)
          ?.points,
      ).toBe(won.wins[0].evaluation.points);
    }
  });

  it("一炮两响的同一胡张仍属于原弃牌，两家假设暗手分别满足合法胡型", () => {
    const start = initialScene(
      {
        0: hand("w1 d1122334455667"),
        1: hand("w23456789 s12355"),
        2: hand("w23456789 s67899"),
      },
      { 0: "tiao" },
    );
    const won = answerAll(discard(start, 0, tile("wan", 1)), [1, 2]);
    const view = currentView(won);
    expect(view.opponents.filter((other) => other.won)).toHaveLength(2);
    expect(
      view.publicTiles!.filter((entry) => entry.tile === tile("wan", 1)),
    ).toEqual([{ seat: 0, tile: tile("wan", 1), kind: "discard" }]);
    for (const particle of samplePublicParticles(view, 4).particles) {
      assertParticle(view, particle);
      for (const winner of view.opponents.filter((other) => other.won)) {
        const evaluation = evaluateWin(
          [...particle.hands[winner.seat], tile("wan", 1)],
          winner.melds,
          winner.missing!,
        );
        expect(evaluation?.points).toBe(1);
        expect(
          particle.hands[winner.seat].every(
            (item) => suitOf(item) !== winner.missing,
          ),
        ).toBe(true);
      }
    }
  });

  it("被认领的非缺门弃牌仍证明清缺门，稳定暗手不能重新塞入该门", () => {
    let state = initialScene({
      0: hand("w123456789 s11223"),
      1: hand("w1123456789 s123"),
      2: hand("w44 s44556677889"),
    });
    state = answerAll(discard(state, 0, tile("wan", 9)));
    state = draw(state, state.turn);
    expect(state.turn).toBe(1);
    state = answerAll(discard(state, 1, tile("wan", 4)), [], 2);
    expect(state.phase).toBe("discard");
    expect(state.players[1].discards).toEqual([]);
    const view = playerView(state, 2);
    for (const particle of samplePublicParticles(view, 5).particles) {
      assertParticle(view, particle);
      expect(particle.hands[1].every((item) => suitOf(item) !== "tong")).toBe(
        true,
      );
    }
  });

  it("成功补杠按公开提议与补牌核对升格和三家各一分，不重复保留原弃牌", () => {
    const offered = declareKong(beforeAddedKong(), 1, "added", tile("wan", 1));
    const state = answerAll(offered);
    expect(state.phase).toBe("discard");
    expect(state.players.map((player) => player.score)).toEqual([
      -1, 3, -1, -1,
    ]);
    expect(state.players[1].melds[0].kongKind).toBe("added");
    const view = playerView(state, 1);
    expect(
      view.publicTiles!.some((entry) => entry.tile === tile("wan", 1)),
    ).toBe(false);
    for (const particle of samplePublicParticles(view, 3).particles)
      assertParticle(view, particle);
  });

  it("抢杠成功保留原碰、只公开一张被抢牌，赢家样本按抢杠番和实际支付约束", () => {
    const offered = declareKong(beforeAddedKong(), 1, "added", tile("wan", 1));
    const state = answerAll(offered, [2]);
    expect(state.players[1].melds[0].type).toBe("pung");
    expect(state.wins[0].evaluation.points).toBe(2);
    expect(state.players.map((player) => player.score)).toEqual([0, -2, 2, 0]);
    const view = currentView(state);
    expect(
      view.publicTiles!.filter((entry) => entry.tile === tile("wan", 1)),
    ).toEqual([{ seat: 1, tile: tile("wan", 1), kind: "discard" }]);
    const winner = view.opponents.find((other) => other.seat === 2)!;
    for (const particle of samplePublicParticles(view, 3).particles) {
      assertParticle(view, particle);
      expect(
        evaluateWin(
          [...particle.hands[2], tile("wan", 1)],
          winner.melds,
          winner.missing!,
          { robKong: true },
        )?.points,
      ).toBe(2);
    }
  });

  it("非缺门弃牌后重新摸牌须撤销清缺推断，补杠被抢可合法留下新摸的缺门牌", () => {
    const before = beforeAddedKong(true);
    expect(suitOf(before.lastDraw!.tile)).toBe("tong");
    expect(
      before.publicActions.some(
        (action) =>
          action.kind === "discard" &&
          action.seat === 1 &&
          suitOf(action.tile) !== "tong",
      ),
    ).toBe(true);
    let state = answerAll(declareKong(before, 1, "added", tile("wan", 1)), [2]);
    state = draw(state, state.turn);
    expect(state.players[1].hand.some((item) => suitOf(item) === "tong")).toBe(
      true,
    );
    const view = playerView(state, state.turn);
    const actualParticle = {
      hands: state.players.map((player) => [...player.hand]),
      wall: [...state.wall],
    };
    assertParticle(view, actualParticle);
    expect(() => assertPublicParticle(view, actualParticle)).not.toThrow();
    for (const particle of samplePublicParticles(view, 3).particles)
      assertParticle(view, particle);
  });

  it("完整55次摸牌后的本家海底自摸节点仍能采样，墙尽已结算投影明确不支持", () => {
    const chosen: Record<number, Tile[]> = {
      0: hand("w123456789 s11223"),
      3: hand("w1123499 s345678"),
    };
    const available = createWall();
    for (const owned of Object.values(chosen))
      for (const item of owned) available.splice(available.indexOf(item), 1);
    const filler = available.filter(
      (item) => item !== tile("wan", 1) && suitOf(item) !== "tong",
    );
    chosen[1] = filler.splice(0, 13);
    chosen[2] = filler.splice(0, 13);
    let state = initialScene(chosen);
    const finalIndex = state.wall.indexOf(tile("wan", 1));
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    state.wall.splice(finalIndex, 1);
    state.wall.push(tile("wan", 1));
    state = answerAll(discard(state, 0, tile("wan", 9)));
    while (state.wall.length > 0) {
      state = draw(state, state.turn);
      if (state.wall.length > 0)
        state = answerAll(discard(state, state.turn, state.lastDraw!.tile));
    }
    expect(state.turn).toBe(3);
    const view = playerView(state, 3);
    expect(
      view.publicActions!.filter((action) => action.kind === "draw"),
    ).toHaveLength(55);
    expect(view.decision?.kind === "self" && view.decision.canWin).toBe(true);
    for (const particle of samplePublicParticles(view, 3).particles)
      assertParticle(view, particle);
    const ended = winSelf(state, 3);
    expect(ended.wins[0].evaluation.patterns).toContain("海底胡");
    expect(ended.wins[0].evaluation.points).toBe(2);
    expect(() => samplePublicParticles(playerView(ended, 3), 1)).toThrow(
      /self|弃牌/,
    );
  });

  it("历史缺失或墙余与draw数量不相容时明确失败", () => {
    const view = playerView(firstDiscard(), 0);
    const absent = { ...view } as PlayerView & { publicActions?: unknown };
    delete absent.publicActions;
    expect(() => samplePublicParticles(absent, 1)).toThrow(PublicSamplingError);
    const inconsistent = structuredClone(view);
    inconsistent.wallRemaining -= 1;
    expect(() => samplePublicParticles(inconsistent, 1)).toThrow(
      /draw|摸牌|历史/,
    );
    const missingPublicTiles = { ...view };
    delete missingPublicTiles.publicTiles;
    expect(() => samplePublicParticles(missingPublicTiles, 1)).toThrow(
      /publicTiles|公开/,
    );
  });

  it("publicTiles真实发生顺序也必须吻合完整历史，不能只满足库存多重集", () => {
    let state = initialScene({
      0: hand("w123456789 s11223"),
      1: hand("w1123456789 s123"),
      2: hand("w44 s44556677889"),
    });
    state = answerAll(discard(state, 0, tile("wan", 9)));
    state = draw(state, 1);
    state = answerAll(discard(state, 1, tile("wan", 4)));
    const view = currentView(state);
    expect(view.publicTiles).toHaveLength(2);
    expect(() => samplePublicParticles(view, 1)).not.toThrow();
    const reordered = structuredClone(view);
    reordered.publicTiles!.reverse();
    expect(() => samplePublicParticles(reordered, 1)).toThrow(/顺序|历史|公开/);
  });

  it("拒绝总牌库存仍守恒、但已胡者被换入缺门或不成胡的外部粒子", () => {
    const won = winSelf(initialScene({ 0: hand("w11123499 s345678") }), 0);
    const view = currentView(won);
    const particle = samplePublicParticles(view, 1).particles[0];
    expect(() => assertPublicParticle(view, particle)).not.toThrow();
    const frozen = {
      hands: Object.freeze(
        particle.hands.map((hand) => Object.freeze([...hand])),
      ),
      wall: Object.freeze([...particle.wall]),
    };
    expect(() => assertPublicParticle(view, frozen)).not.toThrow();
    const missing = structuredClone(particle);
    const missingWall = missing.wall.findIndex(
      (item) => suitOf(item) === "tong",
    );
    expect(missingWall).toBeGreaterThanOrEqual(0);
    [missing.hands[0][0], missing.wall[missingWall]] = [
      missing.wall[missingWall],
      missing.hands[0][0],
    ];
    expect(physicalTiles(view, missing)).toEqual(createWall());
    expect(() => assertPublicParticle(view, missing)).toThrow(/缺门|胡型|胡牌/);
    let broken = false;
    for (let held = 0; held < particle.hands[0].length && !broken; held++) {
      for (let wall = 0; wall < particle.wall.length && !broken; wall++) {
        const invalid = structuredClone(particle);
        const drawn = invalid.wall[wall];
        if (suitOf(drawn) === "tong") continue;
        [invalid.hands[0][held], invalid.wall[wall]] = [
          drawn,
          invalid.hands[0][held],
        ];
        if (evaluateWin(invalid.hands[0], [], "tong")) continue;
        expect(physicalTiles(view, invalid)).toEqual(createWall());
        expect(() => assertPublicParticle(view, invalid)).toThrow(/胡型|胡牌/);
        broken = true;
      }
    }
    expect(broken).toBe(true);
  });

  it("外部粒子逐家计数、库存、稳定清缺和公开支付都必须相容", () => {
    const won = winSelf(initialScene({ 0: hand("w11123499 s345678") }), 0);
    const view = currentView(won);
    const particle = samplePublicParticles(view, 1).particles[0];
    const short = structuredClone(particle);
    short.hands[2].pop();
    expect(() => assertPublicParticle(view, short)).toThrow(/手牌数|张数/);
    const wrongOwn = structuredClone(particle);
    wrongOwn.hands[view.seat][0] = (wrongOwn.hands[view.seat][0] + 1) % 27;
    expect(() => assertPublicParticle(view, wrongOwn)).toThrow(/本家/);
    const extra = structuredClone(particle);
    extra.wall[0] = tile("wan", 1);
    if (particle.wall[0] === tile("wan", 1)) extra.wall[0] = tile("tong", 1);
    expect(() => assertPublicParticle(view, extra)).toThrow(/库存|四张/);
    const scoreView = structuredClone(view);
    scoreView.opponents.find((other) => other.seat === 0)!.score = 9;
    for (const other of scoreView.opponents.filter((other) => other.seat !== 0))
      other.score = -3;
    expect(() => assertPublicParticle(scoreView, particle)).toThrow(
      /支付|积分|结算/,
    );
  });

  it("采样数量超过公开硬上限时显式unsupported，不暴露原生数组异常", () => {
    const view = playerView(firstDiscard(), 0);
    for (const count of [65, 2 ** 32]) {
      try {
        samplePublicParticles(view, count);
        expect.fail("超出采样数量上限仍被接受");
      } catch (error) {
        expect(error).toBeInstanceOf(PublicSamplingError);
        expect((error as PublicSamplingError).code).toBe("unsupported");
      }
    }
  });

  it("不支持非self discard投影，也拒绝真seed、wall和额外对手hand字段", () => {
    const view = playerView(firstDiscard(), 0);
    expect(() =>
      samplePublicParticles({ ...view, decision: undefined }, 1),
    ).toThrow(/self|弃牌/);
    expect(() =>
      samplePublicParticles({ ...view, seed: 80000 } as PlayerView, 1),
    ).toThrow(/seed|未允许|隐藏/);
    expect(() =>
      samplePublicParticles({ ...view, wall: [] } as PlayerView, 1),
    ).toThrow(/wall|未允许|隐藏/);
    const hidden = structuredClone(view);
    Object.assign(hidden.opponents[0], { hand: [] });
    expect(() => samplePublicParticles(hidden, 1)).toThrow(/hand|未允许|隐藏/);
    const wrongDecision = structuredClone(view);
    expect(
      wrongDecision.decision?.kind === "self" && wrongDecision.decision.canWin,
    ).toBe(false);
    if (wrongDecision.decision?.kind === "self")
      wrongDecision.decision.canWin = true;
    expect(() => samplePublicParticles(wrongDecision, 1)).toThrow(
      /合法|胡牌|上下文/,
    );
  });

  it("公开库存过量与公开结算无法解释时失败，不为了凑粒子制造牌", () => {
    const view = playerView(firstDiscard(), 0);
    const overfull = structuredClone(view);
    overfull.hand.fill(tile("wan", 1), 0, 5);
    expect(() => samplePublicParticles(overfull, 1)).toThrow(/库存|四张|牌/);
    const wrongScore = structuredClone(view);
    wrongScore.opponents[0].score = 100;
    expect(() => samplePublicParticles(wrongScore, 1)).toThrow(
      /积分|结算|score/,
    );
  });
});
