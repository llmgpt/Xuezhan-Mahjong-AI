import { describe, expect, it, vi } from "vitest";
import { chooseAdvancedComponentAction } from "./advancedComponents";
import { applyDecisionAction, type DecisionAction } from "./decision";
import {
  countTiles,
  createGame,
  discard,
  draw,
  legalDiscards,
  legalResponses,
  respond,
  type GameState,
  type Phase,
} from "./game";
import { chooseTeacherAction, teacherChoices } from "./teacher";
import { hand } from "./testHelpers";
import { createWall, tile, type Suit, type Tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

const components = ["full", "discard", "actions"] as const;

function scene(
  chosen: Partial<Record<number, Tile[]>>,
  missing: Partial<Record<number, Suit>> = {},
): GameState {
  const wall = createWall();
  for (const tiles of Object.values(chosen))
    for (const item of tiles ?? []) {
      const index = wall.indexOf(item);
      if (index < 0) throw new Error("牌例超过四张同牌");
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
  state.wall = wall;
  expect(countTiles(state)).toBe(108);
  return state;
}

function answerAll(state: GameState, pungSeat?: number): GameState {
  while (state.phase === "respond") {
    const actor = state.pending!.eligible.find(
      (seat) => legalResponses(state, seat).length,
    )!;
    state = respond(state, actor, actor === pungSeat ? "pung" : "pass");
  }
  return state;
}

function pungScene(): GameState {
  return answerAll(
    discard(
      scene(
        { 0: hand("w1 d1122334455667"), 1: hand("w111333359 s2222") },
        { 0: "tiao" },
      ),
      0,
      tile("wan", 1),
    ),
    1,
  );
}

function multipleKongScene(): GameState {
  let state = answerAll(discard(pungScene(), 1, tile("wan", 9)));
  for (const seat of [2, 3, 0]) {
    state = draw(state, seat);
    state = answerAll(discard(state, seat, legalDiscards(state, seat)[0]));
  }
  return draw(state, 1);
}

function addedKongDiscardScene(): GameState {
  let state = answerAll(
    discard(
      scene(
        { 0: hand("w1 d1122334455667"), 1: hand("w111239 s1234567") },
        { 0: "tiao" },
      ),
      0,
      tile("wan", 1),
    ),
    1,
  );
  state = answerAll(discard(state, 1, tile("wan", 9)));
  // Reserve a real remaining copy for seat 1's next draw, after three turns.
  const index = state.wall.indexOf(tile("wan", 9));
  if (index < 0) throw new Error("缺少预留的九万");
  state.wall.splice(3, 0, state.wall.splice(index, 1)[0]);
  for (const seat of [2, 3, 0]) {
    state = draw(state, seat);
    state = answerAll(discard(state, seat, legalDiscards(state, seat)[0]));
  }
  return draw(state, 1);
}

function responseScene(winning: boolean): GameState {
  return discard(
    scene(
      {
        0: hand("w1 d1122334455667"),
        1: hand(winning ? "w23456789 s12355" : "w1122589 s123679"),
      },
      { 0: "tiao" },
    ),
    0,
    tile("wan", 1),
  );
}

function firstTeacherDiscard(view: PlayerView): DecisionAction {
  const choice = teacherChoices(view, "discard").find(
    (item) => item.action.type === "discard",
  );
  if (!choice) throw new Error("牌例必须有原老师弃牌候选");
  return choice.action;
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) deepFreeze(nested);
  Object.freeze(value);
}

const forbidden = async (): Promise<DecisionAction> => {
  throw new Error("此模块不应调用高级策略");
};

describe("高级策略的独立模块组合", () => {
  it.each(components)("%s 的换牌与定缺精确使用原老师", async (component) => {
    let state = createGame(80000);
    for (const phase of ["exchange", "choose-missing"] as const) {
      for (const seat of [0, 1, 2, 3]) {
        const view = playerView(state, seat);
        const action = await chooseAdvancedComponentAction(
          view,
          phase,
          component,
          forbidden,
        );
        expect(action).toEqual(chooseTeacherAction(view, phase));
        state = applyDecisionAction(state, seat, action!);
        expect(countTiles(state)).toBe(108);
      }
    }
    expect(state.phase).toBe("discard");
  });

  it("full 不以原老师的杠建议抢占高级弃牌", async () => {
    const state = scene({ 0: hand("w1111 s1234567891") });
    const view = playerView(state, 0);
    expect(chooseTeacherAction(view, "discard")?.type).toBe("kong");
    const advancedAction: DecisionAction = {
      type: "discard",
      tile: view.legalDiscards.at(-1)!,
    };
    const advanced = vi.fn(async (input: PlayerView, phase: Phase) => {
      expect(input).toEqual(view);
      expect(input).not.toBe(view);
      expect(phase).toBe("discard");
      return advancedAction;
    });
    const action = await chooseAdvancedComponentAction(
      view,
      "discard",
      "full",
      advanced,
    );
    expect(action).toBe(advancedAction);
    expect(advanced).toHaveBeenCalledTimes(1);
    expect(countTiles(applyDecisionAction(state, 0, action!))).toBe(108);
  });

  it("discard 保留原老师的合法自摸与自杠，不询问高级", async () => {
    for (const spec of ["w11123499 s345678", "w1111 s1234567891"]) {
      const state = scene({ 0: hand(spec) });
      const view = playerView(state, 0);
      const expected = chooseTeacherAction(view, "discard")!;
      expect(["win", "kong"]).toContain(expected.type);
      const action = await chooseAdvancedComponentAction(
        view,
        "discard",
        "discard",
        forbidden,
      );
      expect(action).toEqual(expected);
      expect(countTiles(applyDecisionAction(state, 0, action!))).toBe(108);
    }
  });

  it("discard 在原老师放弃合法暗杠时，仅屏蔽回调的自杠候选，保留四张手牌与历史", async () => {
    const state = scene({ 0: hand("w1111 s2233445567") });
    const view = playerView(state, 0);
    const before = structuredClone(view);
    expect(
      view.decision?.kind === "self" && view.decision.concealedKongs,
    ).toEqual([tile("wan", 1)]);
    expect(chooseTeacherAction(view, "discard")?.type).toBe("discard");
    deepFreeze(view);
    const advanced = vi.fn(
      async (input: PlayerView): Promise<DecisionAction> => {
        expect(input.hand).toEqual(before.hand);
        expect(
          input.hand.filter((item) => item === tile("wan", 1)),
        ).toHaveLength(4);
        expect(input.publicActions).toEqual(before.publicActions);
        expect(input.legalDiscards).toEqual(before.legalDiscards);
        expect(input.decision).toEqual({
          kind: "self",
          canWin: false,
          concealedKongs: [],
          addedKongs: [],
        });
        return { type: "discard", tile: input.legalDiscards.at(-1)! };
      },
    );
    const action = await chooseAdvancedComponentAction(
      view,
      "discard",
      "discard",
      advanced,
    );
    expect(advanced).toHaveBeenCalledTimes(1);
    expect(action).toEqual({
      type: "discard",
      tile: before.legalDiscards.at(-1),
    });
    expect(view).toEqual(before);
    expect(countTiles(applyDecisionAction(state, 0, action!))).toBe(108);
  });

  it("discard 也屏蔽真实补杠候选，不删除第四张牌或修改已经公开的碰", async () => {
    const state = addedKongDiscardScene();
    const view = playerView(state, 1);
    const before = structuredClone(view);
    expect(view.hand).toEqual(hand("w123 s1234567 w9"));
    expect(view.decision).toEqual({
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [tile("wan", 1)],
    });
    expect(chooseTeacherAction(view, "discard")?.type).toBe("discard");
    const action = await chooseAdvancedComponentAction(
      view,
      "discard",
      "discard",
      async (input) => {
        expect(input.decision).toEqual({
          kind: "self",
          canWin: false,
          concealedKongs: [],
          addedKongs: [],
        });
        expect(input.hand).toEqual(before.hand);
        expect(input.melds).toEqual(before.melds);
        expect(input.publicTiles).toEqual(before.publicTiles);
        expect(input.publicActions).toEqual(before.publicActions);
        return { type: "discard", tile: tile("wan", 9) };
      },
    );
    expect(action).toEqual({ type: "discard", tile: tile("wan", 9) });
    expect(view).toEqual(before);
    expect(countTiles(applyDecisionAction(state, 1, action!))).toBe(108);
  });

  it.each(["full", "actions"] as const)(
    "%s 的点胡响应完整保留高级拒胡，discard 则使用原老师胡",
    async (component) => {
      const state = responseScene(true);
      const view = playerView(state, 1);
      expect(legalResponses(state, 1)).toContain("hu");
      const pass: DecisionAction = { type: "respond", choice: "pass" };
      const advanced = vi.fn(async () => pass);
      const action = await chooseAdvancedComponentAction(
        view,
        "respond",
        component,
        advanced,
      );
      expect(action).toBe(pass);
      expect(advanced).toHaveBeenCalledTimes(1);
      expect(countTiles(applyDecisionAction(state, 1, action!))).toBe(108);
      const teacher = await chooseAdvancedComponentAction(
        view,
        "respond",
        "discard",
        forbidden,
      );
      expect(teacher).toEqual({ type: "respond", choice: "hu" });
      expect(countTiles(applyDecisionAction(state, 1, teacher!))).toBe(108);
    },
  );

  it("非胡响应也按模块分工，不能只处理含hu的窗口", async () => {
    const state = responseScene(false);
    const view = playerView(state, 1);
    expect(legalResponses(state, 1)).toEqual(["pass", "pung"]);
    expect(chooseTeacherAction(view, "respond")).toEqual({
      type: "respond",
      choice: "pung",
    });
    const pass: DecisionAction = { type: "respond", choice: "pass" };
    for (const component of ["full", "actions"] as const)
      expect(
        await chooseAdvancedComponentAction(
          view,
          "respond",
          component,
          async () => pass,
        ),
      ).toBe(pass);
    const action = await chooseAdvancedComponentAction(
      view,
      "respond",
      "discard",
      forbidden,
    );
    expect(action).toEqual({ type: "respond", choice: "pung" });
    expect(countTiles(applyDecisionAction(state, 1, action!))).toBe(108);
  });

  it("actions 完整保留高级的两种暗杠和补杠，由真宿主验证合法并守恒", async () => {
    const state = multipleKongScene();
    const view = playerView(state, 1);
    expect(view.decision?.kind).toBe("self");
    if (view.decision?.kind !== "self") throw new Error("missing self view");
    expect(view.decision.concealedKongs).toEqual([
      tile("wan", 3),
      tile("tiao", 2),
    ]);
    expect(view.decision.addedKongs).toEqual([tile("wan", 1)]);
    const actions: DecisionAction[] = [
      ...view.decision.concealedKongs.map(
        (tile) => ({ type: "kong", kind: "concealed", tile }) as const,
      ),
      ...view.decision.addedKongs.map(
        (tile) => ({ type: "kong", kind: "added", tile }) as const,
      ),
    ];
    for (const expected of actions) {
      const action = await chooseAdvancedComponentAction(
        view,
        "discard",
        "actions",
        async () => expected,
      );
      expect(action).toBe(expected);
      expect(countTiles(applyDecisionAction(state, 1, action!))).toBe(108);
    }
  });

  it("actions 在高级弃牌后只取原老师第一项弃牌，不夹带老师优先的杠", async () => {
    const state = scene({ 0: hand("w1111 s1234567891") });
    const view = playerView(state, 0);
    expect(teacherChoices(view, "discard")[0].action.type).toBe("kong");
    const expected = firstTeacherDiscard(view);
    const action = await chooseAdvancedComponentAction(
      view,
      "discard",
      "actions",
      async () => ({
        type: "discard",
        tile: view.legalDiscards.at(-1)!,
      }),
    );
    expect(action).toEqual(expected);
    expect(action?.type).toBe("discard");
    expect(countTiles(applyDecisionAction(state, 0, action!))).toBe(108);
  });

  it("actions 保留高级自摸；高级合法弃牌时也不重新夹带老师的胡", async () => {
    const state = scene({ 0: hand("w11123499 s345678") });
    const view = playerView(state, 0);
    expect(view.decision?.kind === "self" && view.decision.canWin).toBe(true);
    expect(
      await chooseAdvancedComponentAction(
        view,
        "discard",
        "actions",
        async () => ({ type: "win" }),
      ),
    ).toEqual({ type: "win" });
    const action = await chooseAdvancedComponentAction(
      view,
      "discard",
      "actions",
      async () => ({
        type: "discard",
        tile: view.legalDiscards[0],
      }),
    );
    expect(action).toEqual(firstTeacherDiscard(view));
    expect(countTiles(applyDecisionAction(state, 0, action!))).toBe(108);
  });

  it.each(components)(
    "%s 在真实碰后11张短手牌上选择合法弃牌，不误启动自杠",
    async (component) => {
      const state = pungScene();
      const view = playerView(state, 1);
      expect(view.hand).toHaveLength(11);
      expect(view.decision).toEqual({
        kind: "self",
        canWin: false,
        concealedKongs: [],
        addedKongs: [],
      });
      const action = await chooseAdvancedComponentAction(
        view,
        "discard",
        component,
        async (input) => ({
          type: "discard",
          tile: input.legalDiscards.at(-1)!,
        }),
      );
      expect(action?.type).toBe("discard");
      expect(countTiles(applyDecisionAction(state, 1, action!))).toBe(108);
    },
  );

  it.each(components)(
    "%s 隔离回调的深层修改，actions 的老师弃牌也使用未污染的原快照",
    async (component) => {
      const state = scene({ 0: hand("w1111 s2233445567") });
      const view = playerView(state, 0);
      const before = structuredClone(view);
      const expectedTeacherDiscard = firstTeacherDiscard(view);
      const advancedDiscard: DecisionAction = {
        type: "discard",
        tile: view.legalDiscards.at(-1)!,
      };
      for (const hidden of ["seed", "wall", "players"])
        Object.defineProperty(view, hidden, {
          get() {
            throw new Error("不应读取隐藏字段 " + hidden);
          },
        });
      deepFreeze(view);
      const action = await chooseAdvancedComponentAction(
        view,
        "discard",
        component,
        async (input) => {
          expect(
            input.opponents.every((opponent) => !("hand" in opponent)),
          ).toBe(true);
          expect(Object.keys(input)).not.toContain("wall");
          input.hand.fill(tile("tong", 9));
          input.legalDiscards.fill(tile("tong", 9));
          input.melds.push({ type: "pung", tile: 0, from: 1 });
          input.opponents[0].melds.push({ type: "pung", tile: 1, from: 2 });
          input.opponents[0].discards.push(2);
          input.publicTiles!.push({ seat: 2, kind: "discard", tile: 3 });
          input.publicActions!.push({ seat: 2, kind: "discard", tile: 3 });
          if (input.decision?.kind === "self")
            input.decision.concealedKongs.push(4);
          return advancedDiscard;
        },
      );
      expect(view).toEqual(before);
      expect(action).toEqual(
        component === "actions" ? expectedTeacherDiscard : advancedDiscard,
      );
      expect(countTiles(applyDecisionAction(state, 0, action!))).toBe(108);
    },
  );

  it.each(components)(
    "%s 对无决策/非决策阶段返回undefined，已有不匹配投影明确报错",
    async (component) => {
      const view = playerView(scene({ 0: hand("w1111 s2233445567") }), 0);
      for (const phase of ["draw", "ended"] as const)
        expect(
          await chooseAdvancedComponentAction(
            view,
            phase,
            component,
            forbidden,
          ),
        ).toBeUndefined();
      for (const phase of ["discard", "respond"] as const)
        expect(
          await chooseAdvancedComponentAction(
            { ...view, decision: undefined },
            phase,
            component,
            forbidden,
          ),
        ).toBeUndefined();
      await expect(
        chooseAdvancedComponentAction(view, "respond", component, forbidden),
      ).rejects.toThrow(/阶段|phase/);
      await expect(
        chooseAdvancedComponentAction(
          playerView(responseScene(false), 1),
          "discard",
          component,
          forbidden,
        ),
      ).rejects.toThrow(/阶段|phase/);
    },
  );

  it.each<DecisionAction>([
    { type: "win" },
    { type: "kong", kind: "concealed", tile: tile("wan", 1) },
    { type: "respond", choice: "pass" },
  ])("discard 回调违反仅弃牌合同即报错，不退回teacher：%j", async (invalid) => {
    const view = playerView(scene({ 0: hand("w1111 s2233445567") }), 0);
    await expect(
      chooseAdvancedComponentAction(
        view,
        "discard",
        "discard",
        async () => invalid,
      ),
    ).rejects.toThrow(/弃牌|discard/);
  });

  it("actions 自己回合收到高级响应动作也明确报错", async () => {
    const view = playerView(scene({ 0: hand("w1111 s2233445567") }), 0);
    await expect(
      chooseAdvancedComponentAction(view, "discard", "actions", async () => ({
        type: "respond",
        choice: "pass",
      })),
    ).rejects.toThrow(/自己|self|弃牌|discard/);
  });

  it.each(["full", "discard", "actions"] as const)(
    "%s 精确传递实际调用的高级异常",
    async (component) => {
      const view = playerView(scene({ 0: hand("w1111 s2233445567") }), 0);
      const failure = new Error("upstream failed");
      await expect(
        chooseAdvancedComponentAction(view, "discard", component, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
    },
  );
});
