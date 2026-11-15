import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { chooseBotExchange, chooseBotMissing } from "./game/bot";
import { completeExchange, completeMissing } from "./game/demo";
import { createGame } from "./game/game";
import { hand } from "./game/testHelpers";
import { tile } from "./game/tiles";
import { teacherChoices } from "./game/teacher";
import { playerView } from "./game/view";
import App, { formatLogEntry, orderHandForDisplay } from "./App";
import { TurnReviewDialog } from "./components/TurnReviewDialog";
import { newGameSeed } from "./newGameSeed";

vi.mock("./newGameSeed", () => ({ newGameSeed: vi.fn(() => 42) }));

describe("App 牌桌与先想后看教学流", () => {
  it("默认开启先想后看：隐藏建议条和荐标记，先给思考空间再点揭晓", () => {
    const view = playerView(createGame(42), 0);
    const recommendation = teacherChoices(view, "exchange")[0];
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("先想后看：开");
    expect(markup).toContain("先自己想一想");
    expect(markup).toContain("揭晓本步建议");
    expect(markup).not.toContain(`建议${recommendation.label}`);
    expect(markup).not.toContain(recommendation.reason);
    expect(markup).not.toContain("查看依据");
  });

  it("关闭先想后看后，开局牌桌直接就地展示老师换牌建议与具体理由，不再需点查看依据", () => {
    const view = playerView(createGame(42), 0);
    const recommendation = teacherChoices(view, "exchange")[0];
    const markup = renderToStaticMarkup(<App thinkFirst={false} />);

    expect(markup).toContain("先想后看：关");
    expect(markup).toContain(`建议${recommendation.label}`);
    expect(markup).toContain(recommendation.reason);
    expect(markup).not.toContain("查看依据");
  });

  it("集成initialSeed直接初始化已有80000，不先生成随机开局", () => {
    const before = vi.mocked(newGameSeed).mock.calls.length;
    const choice = teacherChoices(
      playerView(createGame(80000), 0),
      "exchange",
    )[0];
    const markup = renderToStaticMarkup(
      <App initialSeed={80000} thinkFirst={false} />,
    );
    expect(markup).toContain("本局种子：80000");
    expect(markup).toContain(choice.reason);
    expect(vi.mocked(newGameSeed).mock.calls.length).toBe(before);
  });

  it("可选高级集成props在SSR加载阶段不泄露旧老师荐牌，默认模式不受影响", () => {
    const view = playerView(createGame(42), 0),
      choice = teacherChoices(view, "exchange")[0];
    const assets = {
      runtimeModuleUrl: "http://127.0.0.1/runtime/pyodide.mjs",
      runtimeIndexUrl: "http://127.0.0.1/runtime/",
      payloadUrl: "http://127.0.0.1/payload.json",
    };
    const immediateMarkup = renderToStaticMarkup(
      <App strategyMode="E" strategyAssets={assets} thinkFirst={false} />,
    );
    expect(immediateMarkup).toContain("正在计算当前建议");
    expect(immediateMarkup).not.toContain(`建议${choice.label}`);
    expect(immediateMarkup).not.toContain(choice.reason);

    const thinkFirstMarkup = renderToStaticMarkup(
      <App strategyMode="E" strategyAssets={assets} />,
    );
    expect(thinkFirstMarkup).toContain("先自己想一想");
    expect(thinkFirstMarkup).not.toContain(`建议${choice.label}`);
    expect(thinkFirstMarkup).not.toContain(choice.reason);
  });

  it("自家摸牌后把新摸牌分离排在最右侧并标出", () => {
    const hand = [5, 0, 12, 20, 3];
    const duringDiscard = orderHandForDisplay(hand, "discard", 0, {
      seat: 0,
      tile: 3,
    });
    expect(duringDiscard.map((item) => item.index)).toEqual([1, 0, 2, 3, 4]);
    expect(duringDiscard[4]).toEqual({ tile: 3, index: 4, drawn: true });

    const duringExchange = orderHandForDisplay(hand, "exchange", 0, {
      seat: 0,
      tile: 3,
    });
    expect(duringExchange.every((item) => !item.drawn)).toBe(true);
    expect(duringExchange.map((item) => item.tile)).toEqual([0, 3, 5, 12, 20]);
  });

  it("对局记录把座位号映射为玩家昵称展示，不改写原始日志", () => {
    expect(formatLogEntry("2 号玩家碰 5万")).toBe("小满碰 5万");
    expect(formatLogEntry("0 号玩家打出 1条；1 号玩家杠 1条")).toBe(
      "你打出 1条；阿川杠 1条",
    );
  });

  it("刚这手复盘对话框同时对照玩家选择、策略推荐与客观测算明细", () => {
    let state = createGame(42);
    state = completeExchange(state, chooseBotExchange(state.players[0].hand));
    state = completeMissing(state, chooseBotMissing(state.players[0].hand));
    state.phase = "discard";
    state.turn = 0;
    state.players[0].missing = "tong";
    state.players[0].hand = hand("w1245589 s1244589");
    const view = playerView(state, 0);
    const chosen = { type: "discard" as const, tile: tile("tiao", 5) };
    const recommended = { type: "discard" as const, tile: tile("wan", 1) };
    const markup = renderToStaticMarkup(
      <TurnReviewDialog
        review={{
          view,
          phase: "discard",
          chosenAction: chosen,
          chosenLabel: "打出 5条",
          recommendedLabel: "打出 1万",
          recommendedAction: recommended,
          recommendationReason: "示例策略原因",
        }}
      />,
    );
    expect(markup).toContain("刚这手复盘");
    expect(markup).toContain("打出 5条");
    expect(markup).toContain("打出 1万");
    expect(markup).toContain("示例策略原因");
    expect(markup).toContain("客观测算：手牌向听与有效进张");
  });
});
