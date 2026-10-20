import type { DecisionAction } from "../game/decision";
import type { Phase } from "../game/game";
import { suitOf } from "../game/tiles";
import type { PlayerView } from "../game/view";

export interface AdvancedAssets {
  runtimeModuleUrl: string;
  runtimeIndexUrl: string;
  payloadUrl: string;
}
export interface Position {
  session: number;
  revision: number;
}
export interface ActMessage extends Position {
  command: "act";
  generation: number;
  id: number;
  view: PlayerView;
  phase: "discard" | "respond";
}
export type WorkerRequest =
  | ActMessage
  | {
      command: "init";
      generation: number;
      assets: AdvancedAssets;
    };
export type WorkerReply =
  | { kind: "ready"; generation: number }
  | (Position & {
      kind: "action";
      generation: number;
      id: number;
      action: DecisionAction;
    })
  | { kind: "error"; generation?: number; id?: number; message: string };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function fields(
  value: unknown,
  allowed: string[],
  required = allowed,
): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(
      "公开协议含隐藏、缺失或未知字段：" +
        required
          .filter((key) => !object(value) || !Object.hasOwn(value, key))
          .join(","),
    );
}
const seat = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < 4;
const tile = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < 27;
const suit = (v: unknown) =>
  v === undefined || ["wan", "tiao", "tong"].includes(v as string);
function tiles(value: unknown, max = 108) {
  if (!Array.isArray(value) || value.length > max || !value.every(tile))
    throw new Error("公开牌面数组无效");
}
function melds(value: unknown) {
  if (!Array.isArray(value) || value.length > 4)
    throw new Error("公开副露无效");
  for (const item of value) {
    fields(
      item,
      ["type", "tile", "from", "kongKind"],
      ["type", "tile", "from"],
    );
    if (
      !["pung", "kong"].includes(item.type as string) ||
      !tile(item.tile) ||
      (item.from !== null && !seat(item.from)) ||
      (item.kongKind !== undefined &&
        !["direct", "concealed", "added"].includes(item.kongKind as string))
    )
      throw new Error("公开副露字段无效");
  }
}
export function assertPublicView(value: unknown): asserts value is PlayerView {
  fields(
    value,
    [
      "seat",
      "hand",
      "melds",
      "missing",
      "legalDiscards",
      "ownDiscards",
      "opponents",
      "wallRemaining",
      "publicTiles",
      "publicActions",
      "decision",
    ],
    [
      "seat",
      "hand",
      "melds",
      "legalDiscards",
      "ownDiscards",
      "opponents",
      "wallRemaining",
      "publicTiles",
      "publicActions",
    ],
  );
  if (
    !seat(value.seat) ||
    !suit(value.missing) ||
    !Number.isInteger(value.wallRemaining) ||
    (value.wallRemaining as number) < 0 ||
    (value.wallRemaining as number) > 55
  )
    throw new Error("公开视图座位/缺门/余牌无效");
  tiles(value.hand, 14);
  tiles(value.legalDiscards, 27);
  tiles(value.ownDiscards);
  melds(value.melds);
  if (!Array.isArray(value.opponents) || value.opponents.length !== 3)
    throw new Error("公开对手视图无效");
  const seen = new Set([value.seat]);
  for (const opponent of value.opponents) {
    fields(
      opponent,
      ["seat", "handCount", "melds", "discards", "missing", "won", "score"],
      ["seat", "handCount", "melds", "discards", "won", "score"],
    );
    if (
      !seat(opponent.seat) ||
      seen.has(opponent.seat) ||
      !Number.isInteger(opponent.handCount) ||
      (opponent.handCount as number) < 0 ||
      (opponent.handCount as number) > 14 ||
      !suit(opponent.missing) ||
      typeof opponent.won !== "boolean" ||
      typeof opponent.score !== "number" ||
      !Number.isFinite(opponent.score)
    )
      throw new Error("公开对手字段无效");
    seen.add(opponent.seat);
    tiles(opponent.discards);
    melds(opponent.melds);
  }
  if (!Array.isArray(value.publicTiles) || value.publicTiles.length > 108)
    throw new Error("缺少真实publicTiles公开牌时序");
  for (const event of value.publicTiles) {
    fields(event, ["seat", "kind", "tile"]);
    if (
      !seat(event.seat) ||
      !tile(event.tile) ||
      !["discard", "self-win"].includes(event.kind as string)
    )
      throw new Error("公开牌时序字段无效");
  }
  if (!Array.isArray(value.publicActions) || value.publicActions.length > 512)
    throw new Error("缺少真实publicActions公开历史");
  for (const event of value.publicActions) {
    if (!object(event)) throw new Error("公开历史字段无效");
    const keys =
      event.kind === "draw"
        ? ["seat", "kind"]
        : event.kind === "discard" || event.kind === "added-kong-offer"
          ? ["seat", "kind", "tile"]
          : event.kind === "pung"
            ? ["seat", "kind", "tile", "from"]
            : event.kind === "kong"
              ? ["seat", "kind", "tile", "from", "kongKind"]
              : event.kind === "win"
                ? ["seat", "kind", "tile", "from", "winKind"]
                : undefined;
    if (!keys) throw new Error("未知公开历史动作");
    fields(event, keys);
    if (
      !seat(event.seat) ||
      ("tile" in event && !tile(event.tile)) ||
      ("from" in event && event.from !== null && !seat(event.from)) ||
      (event.kind === "kong" &&
        !["direct", "concealed"].includes(event.kongKind as string)) ||
      (event.kind === "win" &&
        !["discard", "self", "rob-kong"].includes(event.winKind as string))
    )
      throw new Error("公开历史字段无效");
  }
  if (value.decision !== undefined) {
    const d = value.decision;
    if (!object(d)) throw new Error("公开decision视图无效");
    if (d.kind === "self") {
      fields(d, ["kind", "canWin", "concealedKongs", "addedKongs"]);
      if (typeof d.canWin !== "boolean") throw new Error("公开canWin无效");
      tiles(d.concealedKongs, 4);
      tiles(d.addedKongs, 4);
    } else {
      fields(d, ["kind", "responseKind", "from", "tile", "choices"]);
      if (
        d.kind !== "respond" ||
        !["discard", "rob-kong"].includes(d.responseKind as string) ||
        !seat(d.from) ||
        !tile(d.tile) ||
        !Array.isArray(d.choices) ||
        !d.choices.length ||
        !d.choices.every((c) => ["pass", "hu", "pung", "kong"].includes(c))
      )
        throw new Error("公开响应视图无效");
    }
  }
}

export function assertLegalAction(
  action: unknown,
  view: PlayerView,
  phase: Phase,
): asserts action is DecisionAction {
  if (!object(action)) throw new Error("策略返回非法动作");
  if (phase === "exchange" && action.type === "exchange") {
    fields(action, ["type", "tiles"]);
    tiles(action.tiles, 3);
    const selected = action.tiles as number[],
      available = [...view.hand];
    if (
      selected.length !== 3 ||
      selected.some((t) => suitOf(t) !== suitOf(selected[0]))
    )
      throw new Error("策略返回非法换牌");
    for (const value of selected) {
      const index = available.indexOf(value);
      if (index < 0) throw new Error("策略返回非法换牌");
      available.splice(index, 1);
    }
    return;
  }
  if (phase === "choose-missing" && action.type === "missing") {
    fields(action, ["type", "suit"]);
    if (action.suit && suit(action.suit)) return;
  }
  if (phase === "respond" && action.type === "respond") {
    fields(action, ["type", "choice"]);
    if (
      view.decision?.kind === "respond" &&
      view.decision.choices.includes(action.choice as never)
    )
      return;
  }
  if (phase === "discard" && view.decision?.kind === "self") {
    if (action.type === "win") {
      fields(action, ["type"]);
      if (view.decision.canWin) return;
    }
    if (action.type === "discard") {
      fields(action, ["type", "tile"]);
      if (view.legalDiscards.includes(action.tile as number)) return;
    }
    if (action.type === "kong") {
      fields(action, ["type", "kind", "tile"]);
      if (
        (action.kind === "concealed" &&
          view.decision.concealedKongs.includes(action.tile as number)) ||
        (action.kind === "added" &&
          view.decision.addedKongs.includes(action.tile as number))
      )
        return;
    }
  }
  throw new Error("策略返回宿主不允许的非法动作");
}
export function legalActionCount(
  view: PlayerView,
  phase: Phase,
): number | undefined {
  if (phase === "choose-missing") return 3;
  if (phase === "respond" && view.decision?.kind === "respond")
    return view.decision.choices.length;
  if (phase === "discard" && view.decision?.kind === "self")
    return (
      view.legalDiscards.length +
      Number(view.decision.canWin) +
      view.decision.concealedKongs.length +
      view.decision.addedKongs.length
    );
  return undefined;
}
export function assertPosition(position: Position) {
  if (
    !Number.isSafeInteger(position.session) ||
    position.session < 0 ||
    !Number.isSafeInteger(position.revision) ||
    position.revision < 0
  )
    throw new Error("会话/局面序号无效");
}
