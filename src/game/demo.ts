import { chooseBotExchange, chooseBotMissing } from "./bot";
import { chooseExchange, chooseMissing, type GameState } from "./game";
import type { Suit, Tile } from "./tiles";

// 开局时，电脑各自根据手牌完成换牌和定缺。
export function completeExchange(
  state: GameState,
  playerTiles: readonly Tile[],
  playerSeat = 0,
): GameState {
  let next = chooseExchange(state, playerSeat, playerTiles);
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat === playerSeat) continue;
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
  playerSeat = 0,
): GameState {
  let next = chooseMissing(state, playerSeat, playerMissing);
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat === playerSeat) continue;
    next = chooseMissing(next, seat, chooseBotMissing(next.players[seat].hand));
  }
  return next;
}
