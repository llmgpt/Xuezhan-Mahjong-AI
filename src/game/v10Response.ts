import type { DecisionChoice } from "./decision";
import type { Phase } from "./game";
import type { PlayerView } from "./view";
import { acceptRonChoice } from "./acceptRonTeacher";
import { evaluateWin } from "./scoring";
import { suitOf, type Tile } from "./tiles";

/** Composition for fixed default V1 only. The Node ready-income facade changes
 * A only at check_hu / check_robkong. Ordinary legal HU is already intercepted;
 * rob-kong income includes +1 fan, so its known score>=2 always exceeds the
 * source-pinned check_robkong base_score1. Other A action objects are unchanged.
 */
export function v10ResponseChoice(
  view: PlayerView,
  phase: Phase,
): DecisionChoice | undefined {
  const ordinary = acceptRonChoice(view, phase);
  if (ordinary) return ordinary;
  const d = view.decision;
  if (
    phase !== "respond" ||
    d?.kind !== "respond" ||
    d.responseKind !== "rob-kong" ||
    !d.choices.includes("hu")
  )
    return undefined;
  const offer = view.publicActions?.at(-1),
    payer = view.opponents.find((p) => p.seat === d.from);
  if (
    !view.missing ||
    view.hand.length !== 13 - 3 * view.melds.length ||
    !offer ||
    offer.kind !== "added-kong-offer" ||
    offer.seat !== d.from ||
    offer.tile !== d.tile ||
    !payer ||
    payer.won ||
    d.from === view.seat ||
    !payer.melds.some((m) => m.type === "pung" && m.tile === d.tile)
  )
    throw new Error("抢杠公开时刻、手牌数或明碰不符");
  const counts = Array<number>(27).fill(0);
  const add = (t: Tile, n = 1) => {
    suitOf(t);
    counts[t] += n;
    if (counts[t] > 4) throw new Error("抢杠公开库存超过四张");
  };
  view.hand.forEach((t) => add(t));
  for (const m of [...view.melds, ...view.opponents.flatMap((p) => p.melds)])
    add(m.tile, m.type === "kong" ? 4 : 3);
  if (!view.publicTiles) throw new Error("抢杠缺少公开库存");
  view.publicTiles.forEach((p) => add(p.tile));
  add(d.tile);
  const current = evaluateWin(
    [...view.hand, d.tile],
    view.melds,
    view.missing,
    { robKong: true },
  );
  if (!current || current.points < 2)
    throw new Error("合法V1抢杠胡应至少为2分");
  const income = current.points.toFixed(2);
  return {
    action: { type: "respond", choice: "hu" },
    label: "抢杠胡",
    summary: `抢杠胡直接收取当前确定的 ${income} 分。`,
    reason: `本桌抢杠胡加一番，本次由补杠者单独支付 ${income} 分。本候选接受当前确定收益；胡后本家退出后续摸打、响应及收付。`,
    limit:
      "只适用于当前V1默认规则。当前点数是规则事实；没有证明放弃抢杠后的未来收益更低，也不声称总是最优。",
  };
}
