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
  divergenceNote?: string;
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
  if (bs !== cs) return bs > cs;
  if (best.effectiveTotal !== candidate.effectiveTotal) {
    return best.effectiveTotal < candidate.effectiveTotal;
  }
  return (best.maxWinPoints ?? 0) < (candidate.maxWinPoints ?? 0);
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

function buildDivergenceNote(
  topCandidate: ActionBreakdownRow,
  recRow: ActionBreakdownRow | undefined,
  winExists: boolean,
): string | undefined {
  if (!recRow) return undefined;
  if (winExists && recRow.shanten !== -1) {
    return `注：当前可和牌（${topCandidate.label}），策略暂未直接兑现，可能基于未来更大番型或续局收益评估。`;
  }
  const recPoints = recRow.maxWinPoints ?? 0;
  const topPoints = topCandidate.maxWinPoints ?? 0;
  if (recPoints > topPoints) {
    return `注：当前策略推荐未取纯牌效最高的“${topCandidate.label}”，改走更高底算（${recPoints} 分）路线。`;
  }
  if (recRow.action?.type === "kong") {
    const shantenText =
      recRow.shanten === undefined
        ? ""
        : recRow.shanten === 0
          ? "保持听牌但进张变化"
          : `退回 ${recRow.shanten} 向听`;
    return `注：当前策略选择了${recRow.label}（直接记杠钱并补摸 1 张），客观上比“${topCandidate.label}”${shantenText || "进张更少"}，请权衡即时杠钱与听牌损失。`;
  }
  if (
    (recRow.shanten ?? 99) > (topCandidate.shanten ?? 99) ||
    recPoints < topPoints
  ) {
    return `注：当前策略推荐未取纯牌效最高的“${topCandidate.label}”（策略可能基于对局评估选择此步，但客观向听或底算更低，请结合牌面自主判断）。`;
  }
  return `注：当前策略推荐未取纯牌效最高的“${topCandidate.label}”，可能同时考虑了点炮安全或后续路线（客观有效进张较少，请对照明细取舍）。`;
}

function markAndSummarizeRows(
  rows: ActionBreakdownRow[],
  recommendedKey?: string,
  chosenKey?: string,
): {
  divergesFromEfficiency: boolean;
  topEfficiencyLabel?: string;
  divergenceNote?: string;
} {
  for (const row of rows) {
    row.isRecommended = Boolean(recommendedKey && row.key === recommendedKey);
    row.isChosen = Boolean(chosenKey && row.key === chosenKey);
  }

  const efficiencyRows = rows.filter((row) => row.shanten !== undefined);
  const winRows = efficiencyRows.filter((row) => row.shanten === -1);
  const winExists = winRows.length > 0;
  const topCandidate = (winExists ? winRows : efficiencyRows)
    .slice()
    .sort(compareEfficiency)[0];

  if (!topCandidate) {
    return { divergesFromEfficiency: false };
  }

  if (!winExists) {
    const topPoints = topCandidate.maxWinPoints ?? 0;
    for (const row of rows) {
      if (
        row.shanten === topCandidate.shanten &&
        row.effectiveTotal === topCandidate.effectiveTotal &&
        (row.maxWinPoints ?? 0) === topPoints
      ) {
        row.isTopEfficiency = true;
      }
    }
  }

  const recRow = recommendedKey
    ? rows.find((row) => row.key === recommendedKey)
    : undefined;
  const divergesFromEfficiency = Boolean(
    recRow &&
    ((winExists && recRow.shanten !== -1) ||
      (!winExists &&
        recRow.shanten !== undefined &&
        isBetterEfficiency(topCandidate, recRow))),
  );

  return {
    divergesFromEfficiency,
    topEfficiencyLabel: topCandidate.label,
    divergenceNote: divergesFromEfficiency
      ? buildDivergenceNote(topCandidate, recRow, winExists)
      : undefined,
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
      const rank = (tileValue % 9) + 1;
      const edgeKind = rank === 1 || rank === 9 ? "边张幺九" : "中张";
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
            : `先清理定缺牌（手牌尚余 ${missingInHand.length} 张；${edgeKind}）`,
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
  const topDiscard = discardRows.slice().sort(compareEfficiency)[0];
  const widestSlower =
    topDiscard?.shanten === 1 && topDiscard.effectiveTotal <= 4
      ? discardRows
          .filter(
            (row) =>
              (row.shanten ?? 99) > 1 &&
              row.effectiveTotal > topDiscard.effectiveTotal,
          )
          .sort((a, b) => b.effectiveTotal - a.effectiveTotal)[0]
      : undefined;
  if (widestSlower) {
    for (const row of allRows) {
      if (
        row.shanten === 1 &&
        row.effectiveTotal > 0 &&
        row.effectiveTotal <= 4 &&
        !row.note
      ) {
        row.note = `仅 ${row.effectiveTotal} 张进张（窄门假快听），建议对比下方 ${widestSlower.shanten} 向听的 ${widestSlower.effectiveTotal} 张宽进张打法。`;
      }
    }
  }
  const summary = markAndSummarizeRows(allRows, recommendedKey, chosenKey);

  const visibleKeys = new Set<string>();
  const picked: ActionBreakdownRow[] = [];
  for (const row of allRows) {
    if (
      specialRows.some((item) => item.key === row.key) ||
      picked.length < 4 ||
      row.isTopEfficiency ||
      row.isRecommended ||
      row.isChosen ||
      row === widestSlower
    ) {
      if (
        picked.length < 6 ||
        row.isRecommended ||
        row.isChosen ||
        row === widestSlower
      ) {
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

export function summarizeBreakdownHeadline(
  breakdown: TileBreakdown,
): string | undefined {
  if (breakdown.kind === "empty" || breakdown.rows.length === 0) {
    return undefined;
  }
  const recRow =
    breakdown.rows.find((row) => row.isRecommended) ?? breakdown.rows[0];
  if (breakdown.kind === "missing") {
    const remCount = breakdown.missingRemainingTiles?.length ?? 0;
    return remCount <= 1
      ? "打出后即清完定缺门，下巡起进入向听与听牌阶段。"
      : `手中仍有 ${remCount} 张定缺门牌，本桌规则要求先打完缺门牌。`;
  }
  if (recRow.shanten === -1) {
    return recRow.note
      ? `当前可直接和牌（${recRow.note}），优先落袋确定收益。`
      : "当前可直接和牌，优先落袋确定收益。";
  }

  let prefix = "打出后";
  if (recRow.action?.type === "respond") {
    if (recRow.action.choice === "pung") {
      prefix = recRow.note ? `${recRow.note}，之后` : "碰牌后";
    } else if (recRow.action.choice === "kong") {
      prefix = "直杠后先记杠钱并补摸 1 张，当前结构";
    } else if (recRow.action.choice === "pass") {
      prefix = "过牌不动桌面牌，维持当前手牌";
    } else {
      prefix = "响应后";
    }
  } else if (recRow.action?.type === "kong") {
    prefix = `${recRow.action.kind === "concealed" ? "暗杠" : "补杠"}后先记杠钱并补摸 1 张，当前结构`;
  }

  if (recRow.shanten === 0) {
    const waitNames = recRow.waits
      .slice(0, 4)
      .map((w) => labelOf(w.tile))
      .join("、");
    const exhaustedNames = recRow.exhaustedWaits
      .slice(0, 4)
      .map((w) => labelOf(w.tile))
      .join("、");
    const waitText =
      recRow.waits.length > 0
        ? `可胡 ${waitNames}${recRow.waits.length > 4 ? ` 等 ${recRow.waits.length} 种` : ""}，共余 ${recRow.effectiveTotal} 张`
        : `理论听 ${exhaustedNames || "口"} 但桌面已见完（余 0 张）`;
    const pointText = recRow.maxWinPoints
      ? `，最高底算 ${recRow.maxWinPoints} 分`
      : "";
    const wideOneShanten =
      recRow.effectiveTotal <= 3
        ? breakdown.rows.find(
            (row) => row.shanten === 1 && row.effectiveTotal >= 20,
          )
        : undefined;
    if (breakdown.divergesFromEfficiency && breakdown.topEfficiencyLabel) {
      return `${prefix}即可听牌（${waitText}${pointText}）；纯牌效最高为${breakdown.topEfficiencyLabel}，可在下方对照取舍。`;
    }
    if (wideOneShanten) {
      return `${prefix}即可听牌（${waitText}${pointText}）；当前听口较窄，也可对照下方${wideOneShanten.label}（1 向听、进张余 ${wideOneShanten.effectiveTotal} 张）求宽。`;
    }
    return `${prefix}即可听牌（${waitText}${pointText}）${recRow.isTopEfficiency ? "，当前纯牌效最优" : ""}。`;
  }

  if (recRow.shanten !== undefined && recRow.shanten > 0) {
    const base = `${prefix}为 ${recRow.shanten} 向听（有效进张 ${recRow.waits.length} 种、共余 ${recRow.effectiveTotal} 张）`;
    if (breakdown.divergesFromEfficiency && breakdown.topEfficiencyLabel) {
      return `${base}；纯牌效最高为${breakdown.topEfficiencyLabel}，可在下方对照取舍。`;
    }
    return `${base}${recRow.isTopEfficiency ? "，当前纯牌效最优" : ""}。`;
  }

  return undefined;
}
