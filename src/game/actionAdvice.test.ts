import { describe, expect, it } from "vitest";
import { recommendActions } from "./actionAdvice";
import { createGame, type GameState } from "./game";
import type { Meld } from "./scoring";
import { hand } from "./testHelpers";
import { tile } from "./tiles";
import { playerView, type PlayerView } from "./view";

function responseView(
  notation: string,
  choices: ("pass" | "pung" | "kong" | "hu")[],
): PlayerView {
  const state = createGame(1);
  state.phase = "respond";
  state.turn = 1;
  state.players[0].hand = hand(notation);
  state.players.forEach((player) => {
    player.missing = "tong";
  });
  state.players[1].discards = [tile("wan", 1)];
  const view = playerView(state, 0);
  view.decision = {
    kind: "respond",
    responseKind: "discard",
    from: 1,
    tile: tile("wan", 1),
    choices,
  };
  return view;
}

function selfView(notation: string, melds: Meld[] = []): PlayerView {
  const state = createGame(1);
  state.phase = "discard";
  state.players[0].hand = hand(notation);
  state.players[0].melds = melds;
  state.players.forEach((player) => {
    player.missing = "tong";
  });
  return playerView(state, 0);
}

describe("碰杠与胡牌建议", () => {
  it("碰能缩短向听时推荐碰，并比较过与碰后的最佳弃牌", () => {
    const advice = recommendActions(
      responseView("w1122589 s123679", ["pass", "pung"]),
    );
    expect(advice[0].action).toEqual({ type: "respond", choice: "pung" });
    expect(advice[0].summary).toContain("向听");
    expect(
      advice.find(
        (item) =>
          item.action.type === "respond" && item.action.choice === "pass",
      ),
    ).toBeDefined();
    expect(advice[0].reason).toContain("打出");
  });

  it("六对听牌时推荐过，解释碰会失去七对资格", () => {
    const advice = recommendActions(
      responseView("w112233 s4455667", ["pass", "pung"]),
    );
    expect(advice[0].action).toEqual({ type: "respond", choice: "pass" });
    expect(advice[0].summary).toContain("七对");
    expect(
      advice.find(
        (item) =>
          item.action.type === "respond" && item.action.choice === "pung",
      )?.reason,
    ).toContain("七对");
  });

  it("直杠不损伤效率时比较碰与过，说明由出牌者付 2 分及未知补牌", () => {
    const advice = recommendActions(
      responseView("w111 s1234567891", ["pass", "pung", "kong"]),
    );
    expect(advice[0].action).toEqual({ type: "respond", choice: "kong" });
    expect(advice[0].reason).toContain("出牌者");
    expect(advice[0].reason).toContain("2 分");
    expect(advice[0].limit).toContain("补牌");
    expect(advice).toHaveLength(3);
  });

  it("暗杠与出牌比较，仅从未胡玩家收取杠钱", () => {
    const view = selfView("w1111 s1234567891");
    view.opponents[0].won = true;
    const advice = recommendActions(view);
    expect(advice[0].action).toEqual({
      type: "kong",
      kind: "concealed",
      tile: tile("wan", 1),
    });
    expect(advice[0].reason).toContain("4 分");
    expect(advice.some((item) => item.action.type === "discard")).toBe(true);
  });

  it("有七对潜力的四张同牌不自动暗杠", () => {
    const advice = recommendActions(selfView("w1111 s2233445567"));
    expect(advice[0].action.type).toBe("discard");
    expect(advice[0].summary).toContain("七对");
  });

  it("补杠解释抢杠风险，收益以补杠成立为条件", () => {
    const view = selfView("w19 s123456789", [
      { type: "pung", tile: tile("wan", 1), from: 1 },
    ]);
    const advice = recommendActions(view);
    const kong = advice.find((item) => item.action.type === "kong");
    expect(kong?.action).toEqual({
      type: "kong",
      kind: "added",
      tile: tile("wan", 1),
    });
    expect(kong?.reason).toContain("抢杠");
    expect(kong?.reason).toContain("成立");
    expect(kong?.reason).toContain("3 分");
  });

  it("可以胡牌时优先胡，抢杠窗口只有胡与过", () => {
    const view = responseView("w11 s12345678911", ["pass", "hu"]);
    view.decision = {
      ...view.decision!,
      kind: "respond",
      responseKind: "rob-kong",
      from: 1,
      tile: tile("wan", 1),
      choices: ["pass", "hu"],
    };
    const advice = recommendActions(view);
    expect(advice[0].action).toEqual({ type: "respond", choice: "hu" });
    expect(advice[0].reason).toContain("抢杠");
    expect(advice).toHaveLength(2);
    expect(recommendActions(selfView("w11123499 s345678"))[0].action).toEqual({
      type: "win",
    });
  });

  it("定缺牌与墙尽时没有非法杠建议，平常出牌沿用出牌建议", () => {
    const missing = selfView("w1111 s1234567891");
    missing.missing = "wan";
    missing.decision = {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [],
    };
    expect(recommendActions(missing)).toEqual([]);
    const empty = selfView("w1111 s1234567891");
    empty.wallRemaining = 0;
    empty.decision = {
      kind: "self",
      canWin: false,
      concealedKongs: [],
      addedKongs: [],
    };
    expect(recommendActions(empty)).toEqual([]);
    expect(recommendActions(selfView("w1122589 s1236799"))).toEqual([]);
  });

  it("动作视图不泄露其他人的响应资格、选择或牌墙内容", () => {
    const state: GameState = { ...createGame(1), phase: "respond", turn: 1 };
    state.players[0].hand = hand("w1122589 s123679");
    state.players.forEach((player) => {
      player.missing = "tong";
    });
    state.players[1].discards = [tile("wan", 1)];
    state.pending = {
      kind: "discard",
      from: 1,
      tile: tile("wan", 1),
      eligible: [0, 2],
      answers: {},
    };
    const view = playerView(state, 0);
    expect(view.decision).toEqual({
      kind: "respond",
      responseKind: "discard",
      from: 1,
      tile: tile("wan", 1),
      choices: ["pass", "pung"],
    });
    const original = recommendActions(view);
    const hidden = structuredClone(state);
    hidden.wall.reverse();
    hidden.players[2].hand = hand("s1122334455667");
    hidden.pending!.eligible = [0, 3];
    hidden.pending!.answers = { 3: "pass" };
    expect(recommendActions(playerView(hidden, 0))).toEqual(original);
    expect(JSON.stringify(view.decision)).not.toMatch(/eligible|answers|wall/);
    const snapshot = structuredClone(view);
    recommendActions(view);
    expect(view).toEqual(snapshot);
  });
});
