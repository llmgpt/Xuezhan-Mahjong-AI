import { actionKey } from "../game/actionAdvice";
import { estimateShanten, publicCounts } from "../game/advice";
import type { DecisionAction } from "../game/decision";
import {
  evaluateWin,
  waitingTiles,
  type Meld,
  type WinContext,
} from "../game/scoring";
import { labelOf, suitOf, type Suit, type Tile } from "../game/tiles";
import type { PlayerView } from "../game/view";

export interface EffectiveWaitDetail {
  tile: Tile;
  remaining: number;
  winPatterns?: string[];
  winPoints?: number;
}

export interface ActionBreakdownRow {
  key: string;
  action?: DecisionAction;
  label: string;
  shanten?: number;
  effectiveTotal: number;
  waits: EffectiveWaitDetail[];
  exhaustedWaits: EffectiveWaitDetail[];
  maxWinPoints?: number;
  note?: string;
  isTopEfficiency?: boolean;
  isRecommended?: boolean;
  isChosen?: boolean;
}

export interface TileBreakdown {
  kind: "missing" | "discard" | "respond" | "empty";
  title: string;
  currentShanten?: number;
  missingRemainingTiles?: Tile[];
  rows: ActionBreakdownRow[];
  divergesFromEfficiency: boolean;
  topEfficiencyLabel?: string;
  note?: string;
}

export interface TileBreakdownOptions {
  recommendedAction?: DecisionAction;
  chosenAction?: DecisionAction;
}

function decisionKey(action?: DecisionAction): string | undefined {
  if (!action) return undefined;
  if (action.type === "exchange") {
    return `exchange:${[...action.tiles].sort((a, b) => a - b).join(",")}`;
  }
  if (action.type === "missing") return `missing:${action.suit}`;
  return actionKey(action);
}

function removeTiles(
  hand: readonly Tile[],
  target: Tile,
  count: number,
): Tile[] {
  let removed = 0;
  const next: Tile[] = [];
  for (const item of hand) {
    if (item === target && removed < count) {
      removed += 1;
      continue;
    }
    next.push(item);
  }
  return next;
}

function compareEfficiency(
  a: ActionBreakdownRow,
  b: ActionBreakdownRow,
): number {
  const sa = a.shanten ?? 99;
  const sb = b.shanten ?? 99;
  if (sa !== sb) return sa - sb;
  if (b.effectiveTotal !== a.effectiveTotal) {
    return b.effectiveTotal - a.effectiveTotal;
  }
  const pa = a.maxWinPoints ?? 0;
  const pb = b.maxWinPoints ?? 0;
  if (pb !== pa) return pb - pa;
  return 0;
}

function isBetterEfficiency(
  candidate: ActionBreakdownRow,
  best: ActionBreakdownRow,
): boolean {
  const cs = candidate.shanten ?? 99;
  const bs = best.shanten ?? 99;
  return (
    bs > cs || (bs === cs && best.effectiveTotal < candidate.effectiveTotal)
  );
}

interface HandEfficiency {
  shanten: number;
  waits: EffectiveWaitDetail[];
  exhaustedWaits: EffectiveWaitDetail[];
  effectiveTotal: number;
  maxWinPoints?: number;
}

function evaluateHandEfficiency(
  concealed: readonly Tile[],
  melds: readonly Meld[],
  missing: Suit,
  seen: readonly number[],
): HandEfficiency {
  const wt = waitingTiles(concealed, melds, missing);
  const waits: EffectiveWaitDetail[] = [];
  const exhaustedWaits: EffectiveWaitDetail[] = [];

  if (wt.tiles.length > 0) {
    let maxWinPoints = 0;
    for (const waitTile of wt.tiles) {
      const remaining = Math.max(0, 4 - seen[waitTile]);
      const win = evaluateWin([...concealed, waitTile], melds, missing);
      const detail: EffectiveWaitDetail = {
        tile: waitTile,
        remaining,
        winPatterns: win?.patterns,
        winPoints: win?.points,
      };
      if (remaining > 0) {
        waits.push(detail);
        maxWinPoints = Math.max(maxWinPoints, win?.points ?? 0);
      } else {
        exhaustedWaits.push(detail);
      }
    }
    const effectiveTotal = waits.reduce((sum, item) => sum + item.remaining, 0);
    return {
      shanten: 0,
      waits,
      exhaustedWaits,
      effectiveTotal,
      maxWinPoints: maxWinPoints || undefined,
    };
  }

  const shanten = estimateShanten(concealed, melds.length, missing);
  if (shanten >= 0) {
    for (let candidate = 0; candidate < 27; candidate += 1) {
      if (suitOf(candidate) === missing) continue;
      if (
        estimateShanten([...concealed, candidate], melds.length, missing) <
        shanten
      ) {
        const remaining = Math.max(0, 4 - seen[candidate]);
        const detail: EffectiveWaitDetail = { tile: candidate, remaining };
        if (remaining > 0) waits.push(detail);
        else exhaustedWaits.push(detail);
      }
    }
  }

  return {
    shanten,
    waits,
    exhaustedWaits,
    effectiveTotal: waits.reduce((sum, item) => sum + item.remaining, 0),
  };
}

function markAndSummarizeRows(
  rows: ActionBreakdownRow[],
  recommendedKey?: string,
  chosenKey?: string,
): {
  divergesFromEfficiency: boolean;
  topEfficiencyLabel?: string;
} {
  for (const row of rows) {
    row.isRecommended = Boolean(recommendedKey && row.key === recommendedKey);
    row.isChosen = Boolean(chosenKey && row.key === chosenKey);
  }

  const efficiencyRows = rows.filter((row) => row.shanten !== undefined);
  const nonWinRows = efficiencyRows.filter((row) => row.shanten! >= 0);
  const topCandidate = (nonWinRows.length > 0 ? nonWinRows : efficiencyRows)
    .slice()
    .sort(compareEfficiency)[0];

  if (!topCandidate) {
    return { divergesFromEfficiency: false };
  }

  for (const row of rows) {
    if (
      row.shanten === topCandidate.shanten &&
      row.effectiveTotal === topCandidate.effectiveTotal
    ) {
      row.isTopEfficiency = true;
    }
  }

  const recRow = recommendedKey
    ? rows.find((row) => row.key === recommendedKey)
    : undefined;
  const winExists = efficiencyRows.some((row) => row.shanten === -1);
  const divergesFromEfficiency = Boolean(
    recRow &&
    ((winExists && recRow.shanten !== -1) ||
      (recRow.shanten !== undefined &&
        recRow.shanten >= 0 &&
        isBetterEfficiency(topCandidate, recRow))),
  );

  return {
    divergesFromEfficiency,
    topEfficiencyLabel: topCandidate.label,
  };
}

function buildRespondBreakdown(
  view: PlayerView,
  missing: Suit,
  seen: readonly number[],
  recommendedKey?: string,
  chosenKey?: string,
): TileBreakdown {
  const decision = view.decision;
  if (decision?.kind !== "respond") {
    return {
      kind: "empty",
      title: "",
      rows: [],
      divergesFromEfficiency: false,
    };
  }

  const rows: ActionBreakdownRow[] = [];
  const hasMissing = view.hand.some((item) => suitOf(item) === missing);

  for (const choice of decision.choices) {
    const action: DecisionAction = { type: "respond", choice };
    const key = actionKey(action);
    if (choice === "hu") {
      const context: WinContext =
        decision.responseKind === "rob-kong" ? { robKong: true } : {};
      const win = evaluateWin(
        [...view.hand, decision.tile],
        view.melds,
        missing,
        context,
      );
      const actionVerb =
        decision.responseKind === "rob-kong" ? "抢杠胡" : "点胡";
      rows.push({
        key,
        action,
        label: `${actionVerb} ${labelOf(decision.tile)}`,
        shanten: -1,
        effectiveTotal: 0,
        waits: [],
        exhaustedWaits: [],
        maxWinPoints: win?.points,
        note: `${decision.responseKind === "rob-kong" ? "抢杠成立：" : ""}${
          win
            ? `${win.patterns.join("、")}（底算 ${win.points} 分）`
            : "当前可合法和牌"
        }`,
      });
    } else if (choice === "kong") {
      const concealedAfter = removeTiles(view.hand, decision.tile, 3);
      const meldsAfter: Meld[] = [
        ...view.melds,
        {
          type: "kong",
          tile: decision.tile,
          from: decision.from,
          kongKind: "direct",
        },
      ];
      const eff = evaluateHandEfficiency(
        concealedAfter,
        meldsAfter,
        missing,
        seen,
      );
      rows.push({
        key,
        action,
        label: `直杠 ${labelOf(decision.tile)}`,
        ...eff,
        note: "杠后需补摸 1 张再出牌；以上按当前 13 张结构算账",
      });
    } else if (choice === "pung") {
      const afterPung = removeTiles(view.hand, decision.tile, 2);
      const meldsAfter: Meld[] = [
        ...view.melds,
        { type: "pung", tile: decision.tile, from: decision.from },
      ];
      const missingAfter = afterPung.filter((item) => suitOf(item) === missing);
      const candidates = [
        ...new Set(missingAfter.length > 0 ? missingAfter : afterPung),
      ].sort((a, b) => a - b);

      let bestDiscard = candidates[0];
      let bestEff: HandEfficiency | undefined;
      for (const candidate of candidates) {
        const afterDiscard = removeTiles(afterPung, candidate, 1);
        const eff = evaluateHandEfficiency(
          afterDiscard,
          meldsAfter,
          missing,
          seen,
        );
        if (
          !bestEff ||
          eff.shanten < bestEff.shanten ||
          (eff.shanten === bestEff.shanten &&
            eff.effectiveTotal > bestEff.effectiveTotal)
        ) {
          bestDiscard = candidate;
          bestEff = eff;
        }
      }
      rows.push({
        key,
        action,
        label: `碰 ${labelOf(decision.tile)}`,
        shanten: bestEff?.shanten,
        effectiveTotal: bestEff?.effectiveTotal ?? 0,
        waits: bestEff?.waits ?? [],
        exhaustedWaits: bestEff?.exhaustedWaits ?? [],
        maxWinPoints: bestEff?.maxWinPoints,
        note: `碰后最佳出牌：打 ${labelOf(bestDiscard)}${
          missingAfter.length > 0 ? "（仍须先清定缺牌）" : ""
        }`,
      });
    } else {
      const eff = evaluateHandEfficiency(view.hand, view.melds, missing, seen);
      rows.push({
        key,
        action,
        label: "过",
        ...eff,
        note: hasMissing
          ? "手牌仍含定缺门，过牌维持现状等待摸牌"
          : "不动桌面牌，维持手牌继续等待摸牌",
      });
    }
  }

  rows.sort(compareEfficiency);
  const summary = markAndSummarizeRows(rows, recommendedKey, chosenKey);
  return {
    kind: "respond",
    title: "客观测算：响应候选项对照",
    rows,
    ...summary,
  };
}

export function buildTileBreakdown(
  view: PlayerView,
  options: TileBreakdownOptions = {},
): TileBreakdown {
  if (!view.missing) {
    return {
      kind: "empty",
      title: "",
      rows: [],
      divergesFromEfficiency: false,
    };
  }

  const missing = view.missing;
  const seen = publicCounts(view);
  const recommendedKey = decisionKey(options.recommendedAction);
  const chosenKey = decisionKey(options.chosenAction);

  if (view.decision?.kind === "respond") {
    return buildRespondBreakdown(
      view,
      missing,
      seen,
      recommendedKey,
      chosenKey,
    );
  }

  const missingInHand = view.hand
    .filter((item) => suitOf(item) === missing)
    .sort((a, b) => a - b);
  if (missingInHand.length > 0) {
    const uniqueLegal = [...new Set(view.legalDiscards)].sort((a, b) => a - b);
    const rows: ActionBreakdownRow[] = uniqueLegal.map((tileValue) => {
      const action: DecisionAction = { type: "discard", tile: tileValue };
      return {
        key: actionKey(action),
        action,
        label: `打 ${labelOf(tileValue)}`,
        effectiveTotal: 0,
        waits: [],
        exhaustedWaits: [],
        note:
          missingInHand.length === 1
            ? "打出后即清完缺门，下巡起进入向听与听牌阶段"
            : `先清理定缺牌（手牌尚余 ${missingInHand.length} 张）`,
      };
    });
    markAndSummarizeRows(rows, recommendedKey, chosenKey);
    return {
      kind: "missing",
      title: "定缺清理阶段：须先打完缺门牌",
      missingRemainingTiles: missingInHand,
      rows,
      divergesFromEfficiency: false,
      note: "定缺门未清完前按规则不能胡牌，也不能优先保搭留缺牌。",
    };
  }

  const specialRows: ActionBreakdownRow[] = [];
  if (view.decision?.kind === "self") {
    if (view.decision.canWin) {
      const action: DecisionAction = { type: "win" };
      const win = evaluateWin(view.hand, view.melds, missing);
      specialRows.push({
        key: actionKey(action),
        action,
        label: "自摸胡",
        shanten: -1,
        effectiveTotal: 0,
        waits: [],
        exhaustedWaits: [],
        maxWinPoints: win?.points,
        note: win
          ? `自摸：${win.patterns.join("、")}（牌型底算 ${win.points} 分）`
          : "当前可自摸和牌",
      });
    }
    for (const kongTile of view.decision.concealedKongs) {
      const action: DecisionAction = {
        type: "kong",
        kind: "concealed",
        tile: kongTile,
      };
      const concealedAfter = removeTiles(view.hand, kongTile, 4);
      const meldsAfter: Meld[] = [
        ...view.melds,
        { type: "kong", tile: kongTile, from: null, kongKind: "concealed" },
      ];
      const eff = evaluateHandEfficiency(
        concealedAfter,
        meldsAfter,
        missing,
        seen,
      );
      specialRows.push({
        key: actionKey(action),
        action,
        label: `暗杠 ${labelOf(kongTile)}`,
        ...eff,
        note: "暗杠后补摸 1 张再出牌；以上按杠后 13 张结构算账",
      });
    }
    for (const kongTile of view.decision.addedKongs) {
      const action: DecisionAction = {
        type: "kong",
        kind: "added",
        tile: kongTile,
      };
      const concealedAfter = removeTiles(view.hand, kongTile, 1);
      let upgraded = false;
      const meldsAfter: Meld[] = view.melds.map((meld) => {
        if (!upgraded && meld.type === "pung" && meld.tile === kongTile) {
          upgraded = true;
          return { ...meld, type: "kong", kongKind: "added" };
        }
        return meld;
      });
      const eff = evaluateHandEfficiency(
        concealedAfter,
        meldsAfter,
        missing,
        seen,
      );
      specialRows.push({
        key: actionKey(action),
        action,
        label: `补杠 ${labelOf(kongTile)}`,
        ...eff,
        note: "补杠需谨防他人抢杠胡；以上按杠后 13 张结构算账",
      });
    }
  }

  const discardRows: ActionBreakdownRow[] = [...new Set(view.legalDiscards)]
    .sort((a, b) => a - b)
    .map((tileValue) => {
      const action: DecisionAction = { type: "discard", tile: tileValue };
      const after = removeTiles(view.hand, tileValue, 1);
      const eff = evaluateHandEfficiency(after, view.melds, missing, seen);
      return {
        key: actionKey(action),
        action,
        label: `打 ${labelOf(tileValue)}`,
        ...eff,
      };
    });

  const allRows = [...specialRows, ...discardRows].sort(compareEfficiency);
  const summary = markAndSummarizeRows(allRows, recommendedKey, chosenKey);

  const visibleKeys = new Set<string>();
  const picked: ActionBreakdownRow[] = [];
  for (const row of allRows) {
    if (
      specialRows.some((item) => item.key === row.key) ||
      picked.length < 4 ||
      row.isTopEfficiency ||
      row.isRecommended ||
      row.isChosen
    ) {
      if (picked.length < 6 || row.isRecommended || row.isChosen) {
        if (!visibleKeys.has(row.key)) {
          visibleKeys.add(row.key);
          picked.push(row);
        }
      }
    }
  }

  const currentShanten = estimateShanten(view.hand, view.melds.length, missing);
  return {
    kind: "discard",
    title: "客观测算：手牌向听与有效进张",
    currentShanten,
    rows: picked,
    ...summary,
  };
}
