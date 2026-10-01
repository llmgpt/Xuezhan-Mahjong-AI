import { estimateShanten, publicCounts, recommendDiscards } from "./advice";
import type { Meld } from "./scoring";
import type { PlayerAction } from "./session";
import { labelOf, suitOf, type Tile } from "./tiles";
import type { PlayerView } from "./view";

export interface ActionAdvice {
  action: PlayerAction;
  label: string;
  tile?: Tile;
  summary: string;
  reason: string;
  limit: string;
}

export function actionKey(action: PlayerAction): string {
  if (action.type === "respond") return `respond:${action.choice}`;
  if (action.type === "kong") return `kong:${action.kind}:${action.tile}`;
  if (action.type === "discard") return `discard:${action.tile}`;
  return "win";
}

interface Efficiency {
  shanten: number;
  effectiveCount: number;
}
interface Candidate extends ActionAdvice {
  efficiency: Efficiency;
  preferred: boolean;
  gain: number;
  winning: boolean;
}
const limit =
  "只用本家手牌与公开牌；补牌是未知牌，进张是未见牌粗估，不代表真实摸牌概率；未预测对手暗牌、抢杠概率或未来收益。";

function remove(hand: readonly Tile[], chosen: Tile, count: number): Tile[] {
  const after = [...hand];
  for (let i = 0; i < count; i += 1) {
    const index = after.indexOf(chosen);
    if (index < 0) throw new Error("建议中的碰杠牌不足");
    after.splice(index, 1);
  }
  return after;
}

// 比较补牌前/弃牌后的结构，绝不读取真实的下一张牌。
function efficiency(
  hand: Tile[],
  meldCount: number,
  view: PlayerView,
  seen: number[],
): Efficiency {
  const shanten = estimateShanten(hand, meldCount, view.missing!);
  let effectiveCount = 0;
  for (let candidate = 0; candidate < 27; candidate += 1) {
    const unseen = Math.max(0, 4 - seen[candidate]);
    if (!unseen || suitOf(candidate) === view.missing) continue;
    if (
      estimateShanten([...hand, candidate], meldCount, view.missing!) < shanten
    )
      effectiveCount += unseen;
  }
  return { shanten, effectiveCount };
}

function bestDiscard(
  hand: Tile[],
  meldCount: number,
  view: PlayerView,
  seen: number[],
) {
  const missing = hand.filter((item) => suitOf(item) === view.missing);
  return [...new Set(missing.length ? missing : hand)]
    .map((tile) => ({
      tile,
      efficiency: efficiency(remove(hand, tile, 1), meldCount, view, seen),
    }))
    .sort(
      (a, b) =>
        a.efficiency.shanten - b.efficiency.shanten ||
        b.efficiency.effectiveCount - a.efficiency.effectiveCount ||
        a.tile - b.tile,
    )[0];
}

export function recommendActions(view: PlayerView): ActionAdvice[] {
  const decision = view.decision;
  if (!view.missing || !decision) return [];
  if (
    decision.kind === "self" &&
    !decision.canWin &&
    !decision.concealedKongs.length &&
    !decision.addedKongs.length
  )
    return [];
  const seen = publicCounts(view);
  const missingInHand = view.hand.some((item) => suitOf(item) === view.missing);
  const counts = Array<number>(27).fill(0);
  view.hand
    .filter((item) => suitOf(item) !== view.missing)
    .forEach((item) => (counts[item] += 1));
  const sevenPairs =
    !view.melds.length &&
    counts.reduce((sum, count) => sum + Math.floor(count / 2), 0) >= 5;
  const active = view.opponents.filter((opponent) => !opponent.won);
  const discarded =
    decision.kind === "self" ? recommendDiscards(view)[0] : undefined;
  if (decision.kind === "self" && !discarded) return [];
  const baseline = discarded
    ? efficiency(
        remove(view.hand, discarded.tile, 1),
        view.melds.length,
        view,
        seen,
      )
    : efficiency(view.hand, view.melds.length, view, seen);
  const describe = (item: Efficiency) =>
    missingInHand
      ? "缺门未清，向听暂缓报告，碰杠后仍须先打缺门牌"
      : `估算向听 ${item.shanten}，有效进张粗估 ${item.effectiveCount} 张`;
  const shapeWarning = sevenPairs
    ? "碰或开杠后不再具备七对资格。"
    : "固定面子会减少拆牌调整的空间。";
  const candidates: Candidate[] = [];
  const base: Candidate = {
    action: discarded
      ? { type: "discard", tile: discarded.tile }
      : { type: "respond", choice: "pass" },
    label: discarded ? `打出 ${labelOf(discarded.tile)}` : "过",
    tile:
      discarded?.tile ??
      (decision.kind === "respond" ? decision.tile : undefined),
    efficiency: baseline,
    preferred: true,
    gain: 0,
    winning: false,
    summary: discarded
      ? discarded.summary
      : decision.kind === "respond" && decision.responseKind === "rob-kong"
        ? "放弃本次抢杠胡机会。"
        : "保留手牌，放弃本次认领，不固定这个面子。",
    reason: discarded
      ? discarded.reason
      : decision.kind === "respond" && decision.responseKind === "rob-kong"
        ? "过会放弃这次抢杠胡机会；对手补杠是否成立仍取决于其他玩家的响应。本版没有过手胡限制。"
        : `过后${describe(baseline)}；保留对子和搭子的调整空间，不获得杠钱。${view.wallRemaining === 0 ? "牌墙已空，不再有正常摸牌机会。" : ""}`,
    limit,
  };
  if (decision.kind === "self" || decision.choices.includes("pass"))
    candidates.push(base);

  const addWin = (robKong: boolean) =>
    candidates.push({
      action:
        decision.kind === "self"
          ? { type: "win" }
          : { type: "respond", choice: "hu" },
      label: decision.kind === "self" ? "自摸胡" : robKong ? "抢杠胡" : "胡",
      tile: decision.kind === "respond" ? decision.tile : undefined,
      efficiency: { shanten: -1, effectiveCount: 0 },
      preferred: true,
      gain: 0,
      winning: true,
      summary: "当前已可合法胡牌，优先结算现成的胡牌。",
      reason: `${robKong ? "这是补杠的抢杠胡窗口，只有胡与过。" : "当前牌型符合本桌胡牌条件。"}胡牌后获得结算并退出本局摸打；选择其他动作会放弃当前的胡牌机会。`,
      limit:
        "采用优先胡牌的保守策略，未搜索放弃胡牌后的长期收益；只使用本家可见信息。",
    });
  const addKong = (chosen: Tile, kind: "direct" | "concealed" | "added") => {
    if (view.wallRemaining <= 0 || suitOf(chosen) === view.missing) return;
    const after = remove(
      view.hand,
      chosen,
      kind === "direct" ? 3 : kind === "concealed" ? 4 : 1,
    );
    const melds: Meld[] =
      kind === "added"
        ? view.melds.map((meld) =>
            meld.tile === chosen && meld.type === "pung"
              ? { ...meld, type: "kong", kongKind: "added" }
              : meld,
          )
        : [
            ...view.melds,
            {
              type: "kong",
              tile: chosen,
              from:
                kind === "direct" && decision.kind === "respond"
                  ? decision.from
                  : null,
              kongKind: kind,
            },
          ];
    const metric = efficiency(after, melds.length, view, seen);
    const preservesSeven = sevenPairs && metric.shanten >= baseline.shanten;
    const deadWait =
      metric.shanten === 0 &&
      !metric.effectiveCount &&
      baseline.effectiveCount > 0;
    const preferred =
      metric.shanten <= baseline.shanten && !preservesSeven && !deadWait;
    const gain =
      kind === "direct" ? 2 : active.length * (kind === "concealed" ? 2 : 1);
    const name = { direct: "直杠", concealed: "暗杠", added: "补杠" }[kind];
    const payment =
      kind === "direct"
        ? "出牌者付 2 分"
        : `${active.length} 名未胡对手各付 ${kind === "concealed" ? 2 : 1} 分，共 ${gain} 分`;
    const robbers = active.filter(
      (opponent) => opponent.missing !== suitOf(chosen),
    ).length;
    const risk =
      kind === "added"
        ? robbers
          ? `有 ${robbers} 名未胡对手未定缺这门牌，可能抢杠胡；补杠被抢则不收费。`
          : "未胡对手都定缺这门牌，按本桌规则不能抢这张补杠牌。"
        : "本桌不抢暗杠或直杠；响应直杠仍服从其他玩家胡牌优先。";
    candidates.push({
      action:
        kind === "direct"
          ? { type: "respond", choice: "kong" }
          : { type: "kong", kind, tile: chosen },
      label: `${name} ${labelOf(chosen)}`,
      tile: chosen,
      efficiency: metric,
      preferred,
      gain,
      winning: false,
      summary: preferred
        ? missingInHand
          ? `可固定刻子并获得杠钱，但仍须先清缺门；补牌内容未知。`
          : `补牌前向听 ${metric.shanten}（不杠为 ${baseline.shanten}）；${name}成立可收 ${gain} 分，补牌内容未知。`
        : preservesSeven
          ? "当前有七对潜力，开杠会失去七对资格，效率未改善，暂不优先杠。"
          : "杠后结构变差或有效等待牌已无未见张，暂不优先杠。",
      reason: `用 ${kind === "added" ? "明碰加一张手牌" : kind === "concealed" ? "四张手牌" : "三张手牌认领弃牌"}组成${name}，再补一张未知牌。补牌前${describe(metric)}；不杠${describe(baseline)}。${shapeWarning}杠成立后${payment}。${risk}`,
      limit,
    });
  };

  if (decision.kind === "respond") {
    if (decision.choices.includes("hu"))
      addWin(decision.responseKind === "rob-kong");
    if (
      decision.responseKind === "discard" &&
      decision.choices.includes("pung") &&
      suitOf(decision.tile) !== view.missing
    ) {
      const after = remove(view.hand, decision.tile, 2);
      const best = bestDiscard(after, view.melds.length + 1, view, seen);
      if (best) {
        const preferred =
          best.efficiency.shanten < baseline.shanten ||
          (!sevenPairs &&
            best.efficiency.shanten === baseline.shanten &&
            best.efficiency.effectiveCount > baseline.effectiveCount);
        candidates.push({
          action: { type: "respond", choice: "pung" },
          label: `碰 ${labelOf(decision.tile)}`,
          tile: decision.tile,
          efficiency: best.efficiency,
          preferred,
          gain: 0,
          winning: false,
          summary: preferred
            ? missingInHand
              ? `碰后先打出 ${labelOf(best.tile)} 清缺门，按牌型效率比较优于过。`
              : `碰后打出 ${labelOf(best.tile)}：向听 ${best.efficiency.shanten}（过为 ${baseline.shanten}），进张粗估 ${best.efficiency.effectiveCount} 张。`
            : sevenPairs
              ? "碰会失去七对资格，当前效率未改善，暂不优先碰。"
              : "碰后没有改善向听或进张，优先保留手牌的调整空间。",
          reason: `用两张 ${labelOf(decision.tile)} 认领弃牌组成刻子，不摸牌，随后打出 ${labelOf(best.tile)}（按牌效率比较）。碰后${describe(best.efficiency)}；过后${describe(baseline)}。${shapeWarning}碰没有杠钱，后续出牌仍可能点炮；其他玩家胡牌优先。`,
          limit,
        });
      }
    }
    if (
      decision.responseKind === "discard" &&
      decision.choices.includes("kong")
    )
      addKong(decision.tile, "direct");
  } else {
    if (decision.canWin) addWin(false);
    decision.concealedKongs.forEach((chosen) => addKong(chosen, "concealed"));
    decision.addedKongs.forEach((chosen) => addKong(chosen, "added"));
  }
  candidates.sort(
    (a, b) =>
      Number(b.winning) - Number(a.winning) ||
      Number(b.preferred) - Number(a.preferred) ||
      a.efficiency.shanten - b.efficiency.shanten ||
      b.gain - a.gain ||
      b.efficiency.effectiveCount - a.efficiency.effectiveCount ||
      actionKey(a.action).localeCompare(actionKey(b.action)),
  );
  if (candidates[0] === base && candidates.length > 1) {
    base.summary = sevenPairs
      ? `当前有七对潜力，碰或开杠会失去七对资格，效率没有改善，建议${discarded ? "先出牌" : "过"}。`
      : `碰杠没有改善当前的向听与进张，保留手牌的调整空间，建议${discarded ? "先出牌" : "过"}。`;
  }
  return candidates.map(({ action, label, tile, summary, reason, limit }) => ({
    action,
    label,
    tile,
    summary,
    reason,
    limit,
  }));
}
