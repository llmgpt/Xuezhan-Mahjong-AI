import { chooseBotDiscard, chooseBotExchange, chooseBotMissing } from "./bot";
import {
  chooseExchange,
  chooseMissing,
  discard,
  draw,
  legalDiscards,
  type GameState,
} from "./game";
import type { Suit, Tile } from "./tiles";

// 首个演示切片的自动轮转；正式响应窗口与电脑对局将取代它。
export function completeExchange(
  state: GameState,
  playerTiles: readonly Tile[],
): GameState {
  let next = chooseExchange(state, 0, playerTiles);
  for (let seat = 1; seat < 4; seat += 1) {
    next = chooseExchange(
      next,
      seat,
      chooseBotExchange(next.players[seat].hand),
    );
  }
  return next;
}

export function completeMissing(
  state: GameState,
  playerMissing: Suit,
): GameState {
  let next = chooseMissing(state, 0, playerMissing);
  for (let seat = 1; seat < 4; seat += 1) {
    next = chooseMissing(next, seat, chooseBotMissing(next.players[seat].hand));
  }
  return next;
}

export function playDemoRound(state: GameState, playerTile: Tile): GameState {
  let next = discard(state, 0, playerTile);
  while (next.phase === "draw" && next.turn !== 0) {
    const seat = next.turn;
    next = draw(next, seat);
    next = discard(next, seat, chooseBotDiscard(legalDiscards(next, seat)));
  }
  if (next.phase === "draw" && next.turn === 0) next = draw(next, 0);
  return next;
}
