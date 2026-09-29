import { recommendDiscards } from "./advice";
import { chooseBotDiscard } from "./bot";
import {
  declareKong,
  discard,
  draw,
  legalDiscards,
  legalResponses,
  legalSelfActions,
  respond,
  winSelf,
  type GameState,
  type KongKind,
  type ResponseChoice,
} from "./game";
import type { Tile } from "./tiles";
import { playerView } from "./view";

export type PlayerAction =
  | { type: "discard"; tile: Tile }
  | { type: "win" }
  | { type: "kong"; kind: KongKind; tile: Tile }
  | { type: "respond"; choice: ResponseChoice };

function botResponse(options: readonly ResponseChoice[]): ResponseChoice {
  if (options.includes("hu")) return "hu";
  if (options.includes("kong")) return "kong";
  if (options.includes("pung")) return "pung";
  return "pass";
}

// 连续执行电脑动作，停在玩家可操作的状态或结算状态。
export function advanceToHuman(initial: GameState): GameState {
  let state = initial;
  for (let step = 0; step < 1000; step += 1) {
    if (
      state.phase === "ended" ||
      state.phase === "exchange" ||
      state.phase === "choose-missing"
    )
      return state;
    if (state.phase === "draw") {
      state = draw(state, state.turn);
      continue;
    }
    if (state.phase === "respond") {
      const bot = state.pending!.eligible.find(
        (seat) => seat !== 0 && !state.pending!.answers[seat],
      );
      if (bot !== undefined) {
        state = respond(state, bot, botResponse(legalResponses(state, bot)));
        continue;
      }
      if (legalResponses(state, 0).length > 0) return state;
      throw new Error("响应窗口没有待处理玩家");
    }
    if (state.turn === 0) return state;
    const seat = state.turn;
    const self = legalSelfActions(state, seat);
    if (self.canWin) {
      state = winSelf(state, seat);
      continue;
    }
    if (self.addedKongs.length) {
      state = declareKong(state, seat, "added", self.addedKongs[0]);
      continue;
    }
    if (self.concealedKongs.length) {
      state = declareKong(state, seat, "concealed", self.concealedKongs[0]);
      continue;
    }
    const recommendations = recommendDiscards(playerView(state, seat));
    const chosen =
      recommendations[0]?.tile ?? chooseBotDiscard(legalDiscards(state, seat));
    state = discard(state, seat, chosen);
  }
  throw new Error("电脑轮转超过安全上限");
}

export function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
): GameState {
  let next: GameState;
  switch (action.type) {
    case "discard":
      next = discard(state, 0, action.tile);
      break;
    case "win":
      next = winSelf(state, 0);
      break;
    case "kong":
      next = declareKong(state, 0, action.kind, action.tile);
      break;
    case "respond":
      next = respond(state, 0, action.choice);
      break;
  }
  return advanceToHuman(next);
}
