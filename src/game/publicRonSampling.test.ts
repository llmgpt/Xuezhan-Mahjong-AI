import { describe, expect, it } from "vitest";
import {
  countTiles,
  createGame,
  discard,
  draw,
  type GameState,
  type ResponseChoice,
} from "./game";
import { applyDecisionAction, type DecisionAction } from "./decision";
import {
  continueSampledGame,
  type ContinuationPolicy,
} from "./sampledContinuation";
import { chooseTeacherAction } from "./teacher";
import {
  assertPublicRonParticle,
  publicRonContext,
  samplePublicParticles,
  samplePublicRonParticles,
} from "./publicSampler";
import { hand } from "./testHelpers";
import { createWall, tile, type Suit, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";
import boundaries from "./fixtures/public-ron-v1.json";

function scene(chosen: Partial<Record<number, Tile[]>>): GameState {
  const stock = createWall();
  for (const cards of Object.values(chosen))
    for (const card of cards!) {
      const index = stock.indexOf(card);
      if (index < 0) throw new Error("牌例超过四张");
      stock.splice(index, 1);
    }
  const state = createGame(80000);
  state.phase = "discard";
  state.players = state.players.map((_, seat) => ({
    hand: chosen[seat] ?? stock.splice(0, seat === 0 ? 14 : 13),
    melds: [],
    discards: [],
    missing: (seat === 0 ? "tiao" : "tong") as Suit,
    won: false,
    score: 0,
  }));
  state.wall = stock;
  expect(stock).toHaveLength(55);
  expect(countTiles(state)).toBe(108);
  return state;
}

function ronScene() {
  const before = scene({
    0: hand("s2 d1122334455667"),
    1: hand("w123456789 s1112"),
  });
  return discard(before, 0, tile("tiao", 2));
}

describe("普通点胡公开粒子", () => {
  it("13张暗手和已公开来张各计一次，返回完整可复现粒子", () => {
    const state = ronScene();
    const view = playerView(state, 1);
    const before = structuredClone(view);
    expect(view.decision).toMatchObject({ choices: ["pass", "hu"] });
    const sampled = samplePublicRonParticles(view, 3);
    expect(sampled.particles).toHaveLength(3);
    expect(samplePublicRonParticles(view, 2).particles).toEqual(
      sampled.particles.slice(0, 2),
    );
    for (const particle of sampled.particles) {
      expect(particle.hands[1]).toEqual(view.hand);
      expect(particle.wall).toHaveLength(55);
      assertPublicRonParticle(view, particle);
    }
    expect(view).toEqual(before);
    expect(publicRonContext(view)).toEqual({
      from: 0,
      tile: tile("tiao", 2),
      winContext: { seaBottom: false, kongShot: false },
      currentIncome: 1,
    });
  });

  it("只接普通合法胡响应，旧self入口仍拒绝响应视图", () => {
    const view = playerView(ronScene(), 1);
    expect(() => samplePublicParticles(view, 1)).toThrow(/self/);
    const self = playerView(scene({ 0: hand("s2 d1122334455667") }), 0);
    expect(() => samplePublicRonParticles(self, 1)).toThrow(/普通|响应/);
    const robbed = structuredClone(view);
    if (robbed.decision?.kind === "respond")
      robbed.decision.responseKind = "rob-kong";
    expect(() => samplePublicRonParticles(robbed, 1)).toThrow(/普通|响应/);
  });

  it("核完整来张来源、合法响应集、公开积分并拒绝暗牌字段", () => {
    const view = playerView(ronScene(), 1);
    const changed = structuredClone(view);
    if (changed.decision?.kind === "respond")
      changed.decision.tile = tile("tiao", 3);
    expect(() => samplePublicRonParticles(changed, 1)).toThrow();
    const extra = structuredClone(view);
    if (extra.decision?.kind === "respond") extra.decision.choices.push("kong");
    expect(() => samplePublicRonParticles(extra, 1)).toThrow(/响应|合法/);
    const scores = structuredClone(view);
    scores.opponents[0].score++;
    expect(() => samplePublicRonParticles(scores, 1)).toThrow(/积分|score/);
    expect(() =>
      samplePublicRonParticles({ ...view, seed: 80000 } as typeof view, 1),
    ).toThrow(/隐藏|字段/);
  });
});

describe("普通点胡完整净分续局", () => {
  it.each(boundaries.cases)(
    "既有公开节点 $name 的事件金额和收胡吸收性质",
    ({ context, expectedIncome, expectedWinContext }) => {
      const view = context.view as PlayerView;
      const before = structuredClone(view);
      expect(publicRonContext(view)).toMatchObject({
        currentIncome: expectedIncome,
        winContext: expectedWinContext,
      });
      const sample = samplePublicRonParticles(view, 1);
      const result = continueSampledGame(view, sample.particles[0], {
        type: "respond",
        choice: "hu",
      });
      expect(result.scoreDifferences[view.seat]).toBe(expectedIncome);
      expect(result.transfers.filter((p) => p.from === view.seat)).toEqual([]);
      expect(
        result.transfers
          .filter((p) => p.to === view.seat)
          .reduce((sum, p) => sum + p.points, 0),
      ).toBe(expectedIncome);
      expect(view).toEqual(before);
    },
    30000,
  );
  const passOthers: ContinuationPolicy = (view, phase) =>
    phase === "respond" && view.seat !== 1
      ? { type: "respond", choice: "pass" }
      : chooseTeacherAction(view, phase);

  function fullHost(
    state: GameState,
    choice: ResponseChoice,
    policy: ContinuationPolicy,
  ) {
    const initial = state.players.map((p) => p.score);
    let next = structuredClone(state);
    next.transfers = [];
    next = applyDecisionAction(next, 1, { type: "respond", choice });
    let steps = 1;
    while (next.phase !== "ended" && steps < 3000) {
      if (next.phase === "draw") next = draw(next, next.turn);
      else {
        const actor =
          next.phase === "respond"
            ? (next.pending!.eligible.find(
                (s) => s !== 1 && !next.pending!.answers[s],
              ) ??
              next.pending!.eligible.find((s) => !next.pending!.answers[s])!)
            : next.turn;
        next = applyDecisionAction(
          next,
          actor,
          policy(playerView(next, actor), next.phase)!,
        );
      }
      steps++;
    }
    expect(next.phase).toBe("ended");
    return {
      scores: next.players.map((p) => p.score),
      scoreDifferences: next.players.map((p, s) => p.score - initial[s]),
      transfers: next.transfers,
      steps,
      endReason: next.endReason,
    };
  }

  it("同一生成世界的胡/过/碰/杠均与原宿主完整响应续局一致", () => {
    const state = discard(
      scene({ 0: hand("w1 d1122334455667"), 1: hand("w1112233445566") }),
      0,
      tile("wan", 1),
    );
    const view = playerView(state, 1);
    expect(view.decision).toMatchObject({
      choices: ["pass", "hu", "pung", "kong"],
    });
    const particle = {
      hands: state.players.map((p) => [...p.hand]),
      wall: [...state.wall],
    };
    const before = structuredClone({ view, particle });
    for (const choice of ["hu", "pass", "pung", "kong"] as const) {
      const action: DecisionAction = { type: "respond", choice };
      expect(
        continueSampledGame(view, particle, action, { policy: passOthers }),
      ).toEqual(fullHost(state, choice, passOthers));
    }
    expect({ view, particle }).toEqual(before);
  }, 30000);

  it("他家胡牌压过碰杠，当前收胡后本家净增量等于实际单家付款", () => {
    const state = discard(
      scene({
        0: hand("w1 d1122334455667"),
        1: hand("w1112233445566"),
        2: hand("w23 s11223344555"),
      }),
      0,
      tile("wan", 1),
    );
    const view = playerView(state, 1);
    const particle = {
      hands: state.players.map((p) => [...p.hand]),
      wall: [...state.wall],
    };
    for (const choice of ["hu", "pung", "kong"] as const) {
      const result = continueSampledGame(view, particle, {
        type: "respond",
        choice,
      });
      expect(result).toEqual(fullHost(state, choice, chooseTeacherAction));
      if (choice === "hu")
        expect(result.scoreDifferences[1]).toBe(
          publicRonContext(view).currentIncome,
        );
      else
        expect(result.transfers.some((p) => p.reason === "direct-kong")).toBe(
          false,
        );
    }
  }, 30000);
});
