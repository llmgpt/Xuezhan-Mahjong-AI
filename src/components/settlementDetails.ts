import type { GameState, ScoreTransfer } from "../game/game";
import { waitingTiles } from "../game/scoring";
import { labelOf, suitOf } from "../game/tiles";

export interface WinLineSummary {
  key: string;
  headline: string;
  patterns: string;
  netPoints: number;
}

export interface WallSeatStatus {
  seat: number;
  name: string;
  status: "已胡牌" | "花猪" | "已听牌" | "未听牌";
  detail?: string;
}

export interface SettlementDetails {
  winLines: WinLineSummary[];
  kongLines: string[];
  flowLines: string[];
  playerStatuses: WallSeatStatus[];
  transferLines: string[];
}

const TRANSFER_LABELS: Record<ScoreTransfer["reason"], string> = {
  "self-win": "自摸",
  "discard-win": "点胡",
  "direct-kong": "直杠",
  "concealed-kong": "暗杠",
  "added-kong": "补杠",
  flower: "查花猪",
  ready: "查叫",
};

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

/** 根据终局状态和零和转账流水，整理本局胡牌、杠钱与流局查叫明细。 */
export function buildSettlementDetails(
  state: GameState,
  seatNames: readonly string[],
): SettlementDetails {
  const winLines: WinLineSummary[] = state.wins.map((win, index) => {
    const winTransfers = state.transfers.filter(
      (item) =>
        item.to === win.winner &&
        (win.selfDraw
          ? item.reason === "self-win"
          : item.reason === "discard-win"),
    );
    const netPoints = winTransfers.reduce((sum, item) => sum + item.points, 0);
    const kind = win.selfDraw
      ? "自摸"
      : `点胡（${win.payer !== null ? seatNames[win.payer] : "未知"}放铳）`;
    let patterns = win.evaluation.patterns.join(" · ");
    if (win.selfDraw && winTransfers.length > 0) {
      const payerCount = winTransfers.length;
      const perPayer = winTransfers[0].points;
      const scopeText =
        payerCount === 1
          ? `1 家付 ${perPayer} 分`
          : `${payerCount} 家各付 ${perPayer} 分`;
      const detail =
        state.rules.selfDrawBonus > 0
          ? `底算 ${win.evaluation.points} + 自摸加底 ${state.rules.selfDrawBonus}，${scopeText}`
          : scopeText;
      patterns = `${patterns}（${detail}）`;
    }
    return {
      key: `${win.winner}-${index}`,
      headline: `${seatNames[win.winner]} · ${kind} ${labelOf(win.tile)}`,
      patterns,
      netPoints,
    };
  });

  const kongNet = [0, 0, 0, 0];
  let hasKongTransfer = false;
  for (const item of state.transfers) {
    if (
      item.reason === "direct-kong" ||
      item.reason === "concealed-kong" ||
      item.reason === "added-kong"
    ) {
      hasKongTransfer = true;
      kongNet[item.from] -= item.points;
      kongNet[item.to] += item.points;
    }
  }
  const kongLines = hasKongTransfer
    ? [
        `刮风下雨（杠钱净计）：${kongNet
          .map((delta, seat) =>
            delta === 0 ? null : `${seatNames[seat]} ${signed(delta)}`,
          )
          .filter(Boolean)
          .join("，")}`,
      ]
    : [];

  const flowLines: string[] = [];
  for (const item of state.transfers) {
    if (item.reason === "flower") {
      flowLines.push(
        `查花猪：${seatNames[item.from]} 赔付 ${seatNames[item.to]} ${item.points} 分`,
      );
    } else if (item.reason === "ready") {
      flowLines.push(
        `查叫：${seatNames[item.from]}（未听牌）赔付 ${seatNames[item.to]}（已听牌）${item.points} 分`,
      );
    }
  }

  const playerStatuses: WallSeatStatus[] =
    state.endReason === "wall"
      ? state.players.map((player, seat) => {
          const name = seatNames[seat];
          if (player.won) return { seat, name, status: "已胡牌" };
          if (
            player.missing &&
            player.hand.some((item) => suitOf(item) === player.missing)
          ) {
            return { seat, name, status: "花猪", detail: "手牌仍含定缺门" };
          }
          if (!player.missing) return { seat, name, status: "未听牌" };
          const waits = waitingTiles(
            player.hand,
            player.melds,
            player.missing,
            state.rules.fanCap,
          );
          return waits.tiles.length > 0
            ? {
                seat,
                name,
                status: "已听牌",
                detail: `理论最高 ${waits.maxPoints} 分`,
              }
            : { seat, name, status: "未听牌" };
        })
      : [];

  const transferLines = state.transfers.map(
    (item) =>
      `${TRANSFER_LABELS[item.reason]}：${seatNames[item.from]} → ${seatNames[item.to]} ${item.points} 分`,
  );

  return { winLines, kongLines, flowLines, playerStatuses, transferLines };
}
