import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createGame } from "./game/game";
import { teacherChoices } from "./game/teacher";
import { playerView } from "./game/view";
import App from "./App";

vi.mock("./newGameSeed", () => ({ newGameSeed: () => 42 }));

it("开局牌桌接入同一老师的换牌建议和依据入口", () => {
  const view = playerView(createGame(42), 0);
  const recommendation = teacherChoices(view, "exchange")[0];
  const markup = renderToStaticMarkup(<App />);

  expect(markup).toContain(`建议${recommendation.label}`);
  expect(markup).toContain(recommendation.reason);
  expect(markup).toContain("查看依据");
});
