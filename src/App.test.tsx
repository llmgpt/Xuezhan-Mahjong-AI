import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createGame } from "./game/game";
import { teacherChoices } from "./game/teacher";
import { playerView } from "./game/view";
import App from "./App";
import { newGameSeed } from "./newGameSeed";

vi.mock("./newGameSeed", () => ({ newGameSeed: vi.fn(() => 42) }));

it("开局牌桌接入同一老师的换牌建议和依据入口", () => {
  const view = playerView(createGame(42), 0);
  const recommendation = teacherChoices(view, "exchange")[0];
  const markup = renderToStaticMarkup(<App />);

  expect(markup).toContain(`建议${recommendation.label}`);
  expect(markup).toContain(recommendation.reason);
  expect(markup).toContain("查看依据");
});

it("集成initialSeed直接初始化已有80000，不先生成随机开局", () => {
  const before = vi.mocked(newGameSeed).mock.calls.length;
  const choice = teacherChoices(
    playerView(createGame(80000), 0),
    "exchange",
  )[0];
  const markup = renderToStaticMarkup(<App initialSeed={80000} />);
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
  const markup = renderToStaticMarkup(
    <App strategyMode="E" strategyAssets={assets} />,
  );
  expect(markup).toContain("正在计算当前建议");
  expect(markup).not.toContain(`建议${choice.label}`);
  expect(markup).not.toContain(choice.reason);
});
