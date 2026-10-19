import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { Phase } from "../src/game/game";
import type { RolloutDecision } from "../src/game/rolloutTeacher";
import type { PlayerView } from "../src/game/view";
import type { IndependentRecord } from "./independentEvaluation";
import type {
  IndependentDecisionTrace,
  IndependentGameResult,
} from "./independentRunner";

export interface FormalJournalIdentity {
  planHash: string;
  seed: number;
  expectedGames: number;
}
export type FormalJournalEvent =
  | { kind: "game-start"; spec: Omit<IndependentRecord, "result"> }
  | { kind: "attempt"; actor: number; phase: Phase; view: PlayerView }
  | { kind: "evaluation"; actor: number; report: RolloutDecision }
  | { kind: "decision"; trace: IndependentDecisionTrace }
  | { kind: "game-complete"; result: IndependentGameResult };
type StoredEvent =
  | FormalJournalEvent
  | { kind: "seed-complete" }
  | { kind: "failure"; message: string };
type Terminal = "complete" | "failure" | null;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error("日志含非有限数值");
    return item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item;
  });
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function fields(
  value: unknown,
  names: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...names].sort().join(",")
  )
    throw new Error("日志事件含缺失或未知字段");
}
function checkIdentity(value: FormalJournalIdentity) {
  fields(value, ["planHash", "seed", "expectedGames"]);
  if (
    !/^[a-f0-9]{64}$/.test(value.planHash) ||
    !Number.isSafeInteger(value.seed) ||
    value.seed < 0 ||
    value.seed > 0xffffffff ||
    !Number.isSafeInteger(value.expectedGames) ||
    value.expectedGames < 1
  )
    throw new Error("日志身份无效");
}
const phaseValid = (phase: unknown) =>
  ["exchange", "choose-missing", "discard", "respond"].includes(
    phase as string,
  );
const actorValid = (actor: unknown) =>
  typeof actor === "number" &&
  Number.isInteger(actor) &&
  actor >= 0 &&
  actor < 4;

/** Checks observer ordering; legality and full game/grid replay belong to formalAudit. */
class EventState {
  terminal: Terminal = null;
  completedGames = 0;
  private active = false;
  private pending?: Extract<FormalJournalEvent, { kind: "attempt" }>;
  private seen = new Set<string>();
  constructor(private identity: FormalJournalIdentity) {}
  accept(raw: unknown) {
    if (this.terminal) throw new Error("日志已终止，不能追加事件");
    if (!raw || typeof raw !== "object" || !("kind" in raw))
      throw new Error("无效日志事件");
    const event = raw as StoredEvent;
    switch (event.kind) {
      case "game-start": {
        fields(event, ["kind", "spec"]);
        fields(event.spec, ["seed", "seat", "lineup", "opening", "policy"]);
        if (
          this.active ||
          this.completedGames >= this.identity.expectedGames ||
          event.spec.seed !== this.identity.seed ||
          !actorValid(event.spec.seat) ||
          !["common", "composite"].includes(event.spec.opening) ||
          typeof event.spec.lineup !== "string" ||
          !event.spec.lineup ||
          typeof event.spec.policy !== "string" ||
          !event.spec.policy ||
          this.seen.has(canonical(event.spec))
        )
          throw new Error("游戏开始事件不符或重复");
        this.seen.add(canonical(event.spec));
        this.active = true;
        break;
      }
      case "attempt":
        fields(event, ["kind", "actor", "phase", "view"]);
        if (
          !this.active ||
          this.pending ||
          !actorValid(event.actor) ||
          !phaseValid(event.phase) ||
          event.view?.seat !== event.actor
        )
          throw new Error("询问事件缺少游戏或与待定决定不符");
        this.pending = structuredClone(event);
        break;
      case "evaluation":
        fields(event, ["kind", "actor", "report"]);
        if (
          !this.pending ||
          event.actor !== this.pending.actor ||
          !event.report ||
          !["not-applicable", "sampled", "fallback"].includes(
            event.report.status,
          )
        )
          throw new Error("估值事件没有对应询问");
        break;
      case "decision":
        fields(event, ["kind", "trace"]);
        fields(event.trace, ["actor", "phase", "view", "step", "action"]);
        if (
          !this.pending ||
          event.trace.actor !== this.pending.actor ||
          event.trace.phase !== this.pending.phase ||
          canonical(event.trace.view) !== canonical(this.pending.view) ||
          !Number.isSafeInteger(event.trace.step) ||
          event.trace.step < 0 ||
          !event.trace.action ||
          typeof event.trace.action.type !== "string"
        )
          throw new Error("决定事件与完整询问不符");
        this.pending = undefined;
        break;
      case "game-complete":
        fields(event, ["kind", "result"]);
        fields(event.result, [
          "scores",
          "wins",
          "steps",
          "income",
          "endReason",
        ]);
        if (!this.active || this.pending) throw new Error("游戏尚未完成决定");
        this.active = false;
        this.completedGames++;
        break;
      case "seed-complete":
        fields(event, ["kind"]);
        this.assertComplete();
        this.terminal = "complete";
        break;
      case "failure":
        fields(event, ["kind", "message"]);
        if (typeof event.message !== "string" || !event.message)
          throw new Error("失败事件缺少错误");
        this.terminal = "failure";
        break;
      default:
        throw new Error("未知日志事件");
    }
  }
  assertComplete() {
    if (this.terminal) throw new Error("日志已终止");
    if (
      this.active ||
      this.pending ||
      this.completedGames !== this.identity.expectedGames
    )
      throw new Error("尚无完整游戏网格");
  }
}

/** Streams prior evidence, retaining only hashes. Never repairs or rewrites it. */
export async function inspectFormalJournal(
  path: string,
  identity: FormalJournalIdentity,
) {
  checkIdentity(identity);
  const state = new EventState(structuredClone(identity));
  const eventHashes: string[] = [];
  const fileHash = createHash("sha256");
  const decoder = new StringDecoder("utf8");
  let pending = "",
    sequence = 0,
    previous = "",
    hasHeader = false;
  const line = (text: string) => {
    if (!text.trim()) throw new Error("日志事件含空行");
    const raw: unknown = JSON.parse(text);
    if (!hasHeader) {
      fields(raw, ["kind", "version", "identity"]);
      if (
        raw.kind !== "formal-journal" ||
        raw.version !== 1 ||
        canonical(raw.identity) !== canonical(identity)
      )
        throw new Error("日志身份或版本不符");
      previous = digest(raw);
      hasHeader = true;
      return;
    }
    fields(raw, ["sequence", "previous", "event", "sha256"]);
    const payload = {
      sequence: raw.sequence,
      previous: raw.previous,
      event: raw.event,
    };
    if (
      raw.sequence !== sequence ||
      raw.previous !== previous ||
      raw.sha256 !== digest(payload)
    )
      throw new Error("日志序号或哈希链不符");
    state.accept(raw.event);
    eventHashes.push(digest(raw.event));
    previous = raw.sha256 as string;
    sequence++;
  };
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    fileHash.update(bytes);
    pending += decoder.write(bytes);
    let end: number;
    while ((end = pending.indexOf("\n")) !== -1) {
      line(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
  }
  pending += decoder.end();
  if (!hasHeader || pending.length) throw new Error("日志截断或缺少末尾换行");
  return {
    sha256: fileHash.digest("hex"),
    eventHashes,
    completedGames: state.completedGames,
    terminal: state.terminal,
  };
}

/** A new attempt always creates a new exclusive file, with fsync per observed event. */
export async function createFormalJournal(
  path: string,
  identity: FormalJournalIdentity,
  priorPaths: readonly string[],
) {
  checkIdentity(identity);
  if (
    new Set(priorPaths).size !== priorPaths.length ||
    priorPaths.includes(path)
  )
    throw new Error("恢复日志路径重复");
  let expected: string[] = [];
  for (const prior of priorPaths) {
    const report = await inspectFormalJournal(prior, identity);
    if (report.terminal === "failure")
      throw new Error("既存attempt明示失败，禁止重试");
    if (report.terminal === "complete")
      throw new Error("既存attempt已完整，应审计原始结果而不重新询问策略");
    for (
      let i = 0;
      i < Math.min(expected.length, report.eventHashes.length);
      i++
    )
      if (expected[i] !== report.eventHashes[i])
        throw new Error("多次attempt的既存前缀不一致");
    if (report.eventHashes.length > expected.length)
      expected = report.eventHashes;
  }
  const header = {
    kind: "formal-journal",
    version: 1,
    identity: structuredClone(identity),
  };
  const handle = openSync(path, "wx");
  try {
    writeFileSync(handle, canonical(header) + "\n");
    fsyncSync(handle);
  } catch (error) {
    closeSync(handle);
    throw error;
  }
  let sequence = 0,
    previous = digest(header),
    closed = false;
  const state = new EventState(structuredClone(identity));
  const assertOpen = () => {
    if (closed) throw new Error("日志已关闭");
  };
  const append = (event: StoredEvent) => {
    const payload = { sequence, previous, event };
    const sha256 = digest(payload);
    writeFileSync(handle, canonical({ ...payload, sha256 }) + "\n");
    fsyncSync(handle);
    previous = sha256;
    sequence++;
  };
  const fail = (message: string) => {
    assertOpen();
    if (state.terminal === "failure") return;
    const event = { kind: "failure", message } as const;
    state.accept(event);
    append(event);
  };
  const assertPrefixReproduced = () => {
    assertOpen();
    if (sequence < expected.length) throw new Error("尚未完整复现既存前缀");
  };
  return {
    record(event: FormalJournalEvent) {
      assertOpen();
      try {
        if (sequence < expected.length && digest(event) !== expected[sequence])
          throw new Error(`第${sequence}项持久化前缀不一致`);
        state.accept(event);
        append(event);
      } catch (error) {
        if (!state.terminal)
          fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    assertPrefixReproduced,
    complete() {
      assertOpen();
      assertPrefixReproduced();
      state.assertComplete();
      const event = { kind: "seed-complete" } as const;
      state.accept(event);
      append(event);
    },
    fail,
    close() {
      if (!closed) {
        closeSync(handle);
        closed = true;
      }
    },
  };
}
