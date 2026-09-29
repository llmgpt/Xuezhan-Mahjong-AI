import { chooseBotExchange, chooseBotMissing } from "./bot";
import { chooseExchange, chooseMissing, type GameState } from "./game";
import type { Suit, Tile } from "./tiles";

// 开局时，电脑各自根据手牌完成换牌和定缺。
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
