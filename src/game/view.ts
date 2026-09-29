import { legalDiscards, type GameState } from "./game";
import type { Meld } from "./scoring";
import type { Suit, Tile } from "./tiles";

export interface PublicOpponent {
  seat: number;
  handCount: number;
  melds: Meld[];
  discards: Tile[];
  missing?: Suit;
  won: boolean;
  score: number;
}

export interface PlayerView {
  seat: number;
  hand: Tile[];
  melds: Meld[];
  missing?: Suit;
  legalDiscards: Tile[];
  ownDiscards: Tile[];
  opponents: PublicOpponent[];
  wallRemaining: number;
}

// 建议只能接收此投影；不传入完整 GameState、牌墙顺序或对手暗牌。
export function playerView(state: GameState, seat: number): PlayerView {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3)
    throw new Error("无效座位");
  const player = state.players[seat];
  return {
    seat,
    hand: [...player.hand],
    melds: player.melds.map((meld) => ({ ...meld })),
    missing: player.missing,
    legalDiscards: legalDiscards(state, seat),
    ownDiscards: [...player.discards],
    opponents: state.players.flatMap((other, index) =>
      index === seat
        ? []
        : [
            {
              seat: index,
              handCount: other.hand.length,
              melds: other.melds.map((meld) => ({ ...meld })),
              discards: [...other.discards],
              missing: other.missing,
              won: other.won,
              score: other.score,
            },
          ],
    ),
    wallRemaining: state.wall.length,
  };
}
