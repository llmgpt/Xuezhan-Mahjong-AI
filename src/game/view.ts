import {
  legalDiscards,
  legalResponses,
  legalSelfActions,
  type GameState,
  type ResponseChoice,
} from "./game";
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
  decision?:
    | {
        kind: "respond";
        responseKind: "discard" | "rob-kong";
        from: number;
        tile: Tile;
        choices: ResponseChoice[];
      }
    | {
        kind: "self";
        canWin: boolean;
        concealedKongs: Tile[];
        addedKongs: Tile[];
      };
}

// 建议只能接收此投影；不传入完整 GameState、牌墙顺序或对手暗牌。
export function playerView(state: GameState, seat: number): PlayerView {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3)
    throw new Error("无效座位");
  const player = state.players[seat];
  const choices = legalResponses(state, seat);
  const decision: PlayerView["decision"] =
    state.pending && choices.length
      ? {
          kind: "respond",
          responseKind: state.pending.kind,
          from: state.pending.from,
          tile: state.pending.tile,
          choices,
        }
      : state.phase === "discard" && state.turn === seat && !player.won
        ? { kind: "self", ...legalSelfActions(state, seat) }
        : undefined;
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
    decision,
  };
}
