import { describe, expect, it } from "vitest";
import { applyDecisionAction } from "./decision";
import {
  countTiles,
  createGame,
  declareKong,
  discard,
  draw,
  legalResponses,
  respond,
  type GameState,
  type Phase,
} from "./game";
import { immediateWinChoice } from "./immediateWin";
import { hand } from "./testHelpers";
import { createWall, tile, type Suit, type Tile } from "./tiles";
import { playerView } from "./view";

function scene(
  chosen: Partial<Record<number, Tile[]>>,
  missing: Partial<Record<number, Suit>> = {},
  firstDraw?: Tile,
): GameState {
  const wall = createWall();
  for (const tiles of Object.values(chosen))
    for (const item of tiles ?? []) {
      const index = wall.indexOf(item);
      if (index < 0) throw new Error("牌例超过四张同牌");
      wall.splice(index, 1);
    }
  if (firstDraw !== undefined) {
    const index = wall.indexOf(firstDraw);
    if (index < 0) throw new Error("预留摸牌已全部分配");
    wall.splice(index, 1);
  }
  const state = createGame(80000);
  state.phase = "discard";
  state.players = state.players.map((_, seat) => ({
    hand: chosen[seat] ?? wall.splice(0, seat === 0 ? 14 : 13),
    melds: [],
    discards: [],
    missing: missing[seat] ?? "tong",
    won: false,
    score: 0,
  }));
  if (firstDraw !== undefined) wall.unshift(firstDraw);
  state.wall = wall;
  expect(countTiles(state)).toBe(108);
  expect(state.wall).toHaveLength(55);
  return state;
}

function answerAll(state: GameState, pungSeat?: number): GameState {
  let next = state;
  while (next.phase === "respond") {
    const actor = next.pending!.eligible.find(
      (seat) => legalResponses(next, seat).length > 0,
    )!;
    next = respond(next, actor, actor === pungSeat ? "pung" : "pass");
  }
  return next;
}

function robKongScene(): GameState {
  let state = scene(
    {
      0: hand("w1 d1122334455667"),
      1: hand("w111 d778899 s1234"),
      2: hand("w23456789 s12355"),
    },
    { 0: "tiao" },
  );
  state = answerAll(discard(state, 0, tile("wan", 1)), 1);
  state = answerAll(discard(state, 1, tile("tong", 7)));
  for (const seat of [2, 3, 0]) {
    state = draw(state, seat);
    state = answerAll(discard(state, seat, state.lastDraw!.tile));
  }
  state = draw(state, 1);
  return declareKong(state, 1, "added", tile("wan", 1));
}

describe("宿主合法胡牌的即时选择", () => {
  it("庄家合法自摸时返回胡，解释结算与放弃未来收益的取舍", () => {
    const state = scene({ 0: hand("w11123499 s345678") });
    const view = playerView(state, 0);
    expect(view.decision?.kind === "self" && view.decision.canWin).toBe(true);
    const choice = immediateWinChoice(view, state.phase)!;
    expect(choice.action).toEqual({ type: "win" });
    expect(choice.label).toBe("自摸胡");
    expect(choice.reason).toMatch(/退出|停止/);
    expect(choice.limit).toMatch(/可能.*更大.*收益/);
    expect(choice.limit).toMatch(/未证明.*最优/);
    const after = applyDecisionAction(state, 0, choice.action);
    expect(after.players[0].won).toBe(true);
    expect(after.players[0].score).toBeGreaterThan(0);
    expect(countTiles(after)).toBe(108);
  });

  it("本人实际摸牌后的合法自摸也被接受", () => {
    const winning = tile("wan", 1);
    let state = scene(
      { 0: hand("w123456789 s11223"), 1: hand("w1123499 s345678") },
      {},
      winning,
    );
    state = answerAll(discard(state, 0, tile("wan", 9)));
    state = draw(state, 1);
    const choice = immediateWinChoice(playerView(state, 1), state.phase)!;
    expect(choice.action).toEqual({ type: "win" });
    const after = applyDecisionAction(state, 1, choice.action);
    expect(after.wins[0].selfDraw).toBe(true);
    expect(after.wins[0].tile).toBe(winning);
  });

  it("同一弃牌两家合法点胡均返回hu，由引擎保持多家胡和一次实体归属", () => {
    let state = discard(
      scene(
        {
          0: hand("w1 d1122334455667"),
          1: hand("w23456789 s12355"),
          2: hand("w23456789 s67899"),
        },
        { 0: "tiao" },
      ),
      0,
      tile("wan", 1),
    );
    for (const seat of [1, 2]) {
      const view = playerView(state, seat);
      expect(
        view.decision?.kind === "respond" &&
          view.decision.choices.includes("hu"),
      ).toBe(true);
      const choice = immediateWinChoice(view, state.phase)!;
      expect(choice.action).toEqual({ type: "respond", choice: "hu" });
      expect(choice.label).toBe("点胡");
      state = applyDecisionAction(state, seat, choice.action);
    }
    state = answerAll(state);
    expect(state.wins.map((win) => win.winner)).toEqual([1, 2]);
    expect(state.players[0].score).toBe(-2);
    expect(countTiles(state)).toBe(108);
  });

  it("真实补杠响应窗口接受抢杠胡，并标明抢杠而非普通点胡", () => {
    let state = robKongScene();
    const view = playerView(state, 2);
    expect(
      view.decision?.kind === "respond" && view.decision.responseKind,
    ).toBe("rob-kong");
    const choice = immediateWinChoice(view, state.phase)!;
    expect(choice.action).toEqual({ type: "respond", choice: "hu" });
    expect(choice.label).toBe("抢杠胡");
    state = answerAll(applyDecisionAction(state, 2, choice.action));
    expect(state.wins[0].evaluation.patterns).toContain("抢杠胡");
    expect(state.players[1].melds[0].type).toBe("pung");
    expect(
      state.transfers.some((transfer) => transfer.reason === "added-kong"),
    ).toBe(false);
    expect(countTiles(state)).toBe(108);
  });

  it("只有碰/过的响应以及不可胡的自己回合都不替原策略选动作", () => {
    const start = scene(
      { 0: hand("w1 d1122334455667"), 1: hand("w11 s11234567889") },
      { 0: "tiao" },
    );
    expect(immediateWinChoice(playerView(start, 0), "discard")).toBeUndefined();
    const pending = discard(start, 0, tile("wan", 1));
    const view = playerView(pending, 1);
    expect(view.decision?.kind === "respond" && view.decision.choices).toEqual([
      "pass",
      "pung",
    ]);
    expect(immediateWinChoice(view, "respond")).toBeUndefined();
  });

  it.each<Phase>(["exchange", "choose-missing", "draw", "respond", "ended"])(
    "%s阶段即使收到陈旧可自摸投影也不误拦截",
    (phase) => {
      const view = playerView(scene({ 0: hand("w11123499 s345678") }), 0);
      expect(immediateWinChoice(view, phase)).toBeUndefined();
    },
  );

  it("真实开局、非本人响应和阶段不相符的hu投影都不误拦截", () => {
    const opening = createGame(80000);
    expect(
      immediateWinChoice(playerView(opening, 0), opening.phase),
    ).toBeUndefined();
    const state = robKongScene();
    expect(immediateWinChoice(playerView(state, 1), "respond")).toBeUndefined();
    expect(immediateWinChoice(playerView(state, 2), "discard")).toBeUndefined();
  });

  it("只读合法动作投影，输入不变且不访问额外真seed、暗手或牌墙字段", () => {
    const view = playerView(scene({ 0: hand("w11123499 s345678") }), 0);
    const before = structuredClone(view);
    for (const hidden of ["seed", "wall", "players"])
      Object.defineProperty(view, hidden, {
        get() {
          throw new Error("不应读取隐藏字段 " + hidden);
        },
      });
    Object.freeze(view.hand);
    Object.freeze(view.opponents);
    Object.freeze(view.decision);
    Object.freeze(view);
    const first = immediateWinChoice(view, "discard")!;
    expect(first.action).toEqual({ type: "win" });
    first.label = "外部修改";
    expect(immediateWinChoice(view, "discard")!.label).toBe("自摸胡");
    expect(view).toEqual(before);
  });
});
