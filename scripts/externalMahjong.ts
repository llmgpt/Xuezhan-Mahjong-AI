import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DecisionAction } from "../src/game/decision";
import type { Phase } from "../src/game/game";
import type { PlayerView } from "../src/game/view";

export interface ExternalMahjongOptions {
  executable?: string;
  args?: string[];
  timeoutMs?: number;
  policy?:
    | "ebony72-initial"
    | "ebony72-advanced-public-v1"
    | "ebony72-advanced-cap8-discard-v1"
    | "ebony72-advanced-current-income-v1"
    | "fanfou-ba-composite-v1";
}

interface Pending {
  view: PlayerView;
  phase: Phase;
  timer: ReturnType<typeof setTimeout>;
  resolve: (action: DecisionAction) => void;
  reject: (error: Error) => void;
}

function onlyFields(value: object, allowed: string[], name: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`公开投影 ${name} 含隐藏或未允许字段 ${key}`);
}

// Fail before serialization if a full engine state was accidentally attached.
// The Python side independently checks types, inventory and phase consistency.
function assertPublicView(view: PlayerView): void {
  onlyFields(
    view,
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
    "view",
  );
  if (!Array.isArray(view.publicTiles))
    throw new Error("缺少真实公开牌时序 publicTiles");
  if (view.publicActions !== undefined) {
    if (!Array.isArray(view.publicActions))
      throw new Error("publicActions 必须是公开历史数组");
    for (const action of view.publicActions) {
      const common = ["seat", "kind"];
      const keys =
        action.kind === "draw"
          ? common
          : action.kind === "discard" || action.kind === "added-kong-offer"
            ? [...common, "tile"]
            : action.kind === "pung"
              ? [...common, "tile", "from"]
              : action.kind === "kong"
                ? [...common, "tile", "from", "kongKind"]
                : action.kind === "win"
                  ? [...common, "tile", "from", "winKind"]
                  : undefined;
      if (!keys) throw new Error("未知公开历史动作");
      onlyFields(action, keys, "publicActions");
      if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat > 3)
        throw new Error("公开历史座位无效");
      if (
        "tile" in action &&
        (!Number.isInteger(action.tile) || action.tile < 0 || action.tile > 26)
      )
        throw new Error("公开历史牌面无效");
      if (
        "from" in action &&
        action.from !== null &&
        (!Number.isInteger(action.from) || action.from < 0 || action.from > 3)
      )
        throw new Error("公开历史来源from必须是座位标量或null");
      if (
        action.kind === "kong" &&
        !["direct", "concealed"].includes(action.kongKind)
      )
        throw new Error("公开历史杠类型无效");
      if (
        action.kind === "win" &&
        !["discard", "self", "rob-kong"].includes(action.winKind)
      )
        throw new Error("公开历史胡牌类型无效");
    }
  }
  for (const item of view.publicTiles)
    onlyFields(item, ["seat", "tile", "kind"], "publicTiles");
  const melds = [...view.melds];
  for (const opponent of view.opponents) {
    onlyFields(
      opponent,
      ["seat", "handCount", "melds", "discards", "missing", "won", "score"],
      "opponents (不能包含 hand 暗牌)",
    );
    melds.push(...opponent.melds);
  }
  for (const meld of melds)
    onlyFields(meld, ["type", "tile", "from", "kongKind"], "meld");
  if (view.decision)
    onlyFields(
      view.decision,
      view.decision.kind === "self"
        ? ["kind", "canWin", "concealedKongs", "addedKongs"]
        : ["kind", "responseKind", "from", "tile", "choices"],
      "decision",
    );
}

function isLegalAction(
  action: unknown,
  view: PlayerView,
  phase: Phase,
): action is DecisionAction {
  if (!action || typeof action !== "object" || !("type" in action))
    return false;
  const candidate = action as DecisionAction;
  if (phase === "choose-missing")
    return (
      candidate.type === "missing" &&
      ["wan", "tiao", "tong"].includes(candidate.suit)
    );
  if (phase === "respond")
    return (
      candidate.type === "respond" &&
      view.decision?.kind === "respond" &&
      view.decision.choices.includes(candidate.choice)
    );
  if (phase !== "discard" || view.decision?.kind !== "self") return false;
  if (candidate.type === "win") return view.decision.canWin;
  if (candidate.type === "discard")
    return view.legalDiscards.includes(candidate.tile);
  if (candidate.type === "kong") {
    if (candidate.kind === "concealed")
      return view.decision.concealedKongs.includes(candidate.tile);
    if (candidate.kind === "added")
      return view.decision.addedKongs.includes(candidate.tile);
  }
  return false;
}

/** One worker per actor; no seed, full wall or other actor's private state. */
export class ExternalMahjongWorker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, Pending>();
  private readonly stopped: Promise<void>;
  private readonly timeoutMs: number;
  private sequence = 0;
  private terminated = false;
  private finishing = false;
  private aborted = false;
  private failure?: Error;
  private finishTask?: Promise<void>;
  private stderr = "";
  private readonly policy: ExternalMahjongOptions["policy"];

  constructor(options: ExternalMahjongOptions = {}) {
    if (
      options.policy !== undefined &&
      options.policy !== "ebony72-initial" &&
      options.policy !== "ebony72-advanced-public-v1" &&
      options.policy !== "ebony72-advanced-cap8-discard-v1" &&
      options.policy !== "ebony72-advanced-current-income-v1" &&
      options.policy !== "fanfou-ba-composite-v1"
    )
      throw new Error("未知外部策略");
    this.policy = options.policy;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error("外部策略超时必须是正数");
    this.child = spawn(
      options.executable ?? process.env.STRENGTH_PYTHON ?? "python",
      options.args ?? [
        "-B",
        "-u",
        fileURLToPath(new URL("./external/worker.py", import.meta.url)),
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    this.stopped = new Promise((resolve) => {
      this.child.once("close", (code, signal) => {
        if (
          !this.aborted &&
          (!this.finishing ||
            code !== 0 ||
            signal !== null ||
            this.pending.size)
        )
          this.fail(
            new Error(
              `外部策略退出 (code=${code}, signal=${signal})${this.stderr ? `: ${this.stderr}` : ""}`,
            ),
          );
        this.terminated = true;
        resolve();
      });
    });
    this.child.on("error", (error) =>
      this.fail(new Error(`外部策略启动失败: ${error.message}`)),
    );
    this.child.stdin.on("error", (error) =>
      this.fail(new Error(`外部策略输入失败: ${error.message}`)),
    );
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (data: string) => {
      this.stderr = (this.stderr + data).slice(-4096);
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.receive(line));
  }

  act(view: PlayerView, phase: Phase): Promise<DecisionAction> {
    if (this.terminated || this.finishing)
      return Promise.reject(new Error("外部策略会话已终止或关闭"));
    assertPublicView(view);
    if (
      (this.policy === "ebony72-advanced-public-v1" ||
        this.policy === "ebony72-advanced-cap8-discard-v1" ||
        this.policy === "ebony72-advanced-current-income-v1" ||
        this.policy === "fanfou-ba-composite-v1") &&
      !Array.isArray(view.publicActions)
    )
      throw new Error("外部参考缺少真实公开历史 publicActions");
    if (!["choose-missing", "discard", "respond"].includes(phase))
      throw new Error(`外部策略不支持阶段 ${phase}`);
    const snapshot = structuredClone(view);
    const id = `request-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(new Error(`外部策略请求 ${id} 超时 (${this.timeoutMs}ms)`)),
        this.timeoutMs,
      );
      this.pending.set(id, { view: snapshot, phase, timer, resolve, reject });
      this.child.stdin.write(
        `${JSON.stringify({ id, phase, view: snapshot, ...(this.policy && { policy: this.policy }) })}\n`,
        (error) => {
          if (error) this.fail(new Error(`外部策略发送失败: ${error.message}`));
        },
      );
    });
  }

  private receive(line: string): void {
    if (this.terminated) return;
    let response: { id?: unknown; action?: unknown; error?: unknown };
    try {
      response = JSON.parse(line);
      if (!response || typeof response !== "object")
        throw new Error("回复必须为对象");
    } catch {
      this.fail(new Error("外部策略 stdout 出现非 JSON 协议内容"));
      return;
    }
    const request =
      typeof response.id === "string" && this.pending.get(response.id);
    if (!request) {
      this.fail(new Error("外部策略回复 ID 不匹配"));
      return;
    }
    this.pending.delete(response.id as string);
    clearTimeout(request.timer);
    if (response.error !== undefined) {
      const message =
        typeof response.error === "string"
          ? response.error
          : JSON.stringify(response.error);
      const error = new Error(`外部策略错误: ${message}`);
      request.reject(error);
      this.fail(error);
    } else if (isLegalAction(response.action, request.view, request.phase)) {
      request.resolve(response.action);
    } else {
      request.reject(new Error("外部策略返回不合法动作"));
      this.fail(new Error("外部策略返回不合法动作，会话终止"));
    }
  }

  private fail(error: Error): void {
    if (this.aborted) return;
    this.failure ??= error;
    this.terminated = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.failure);
    }
    this.pending.clear();
    if (!this.child.killed) this.child.kill("SIGKILL");
  }

  // Success requires EOF, all requested replies, clean stdout and a normal exit.
  // A valid last reply alone cannot prove that the worker finished successfully.
  finish(): Promise<void> {
    this.finishTask ??= this.finishOnce();
    return this.finishTask;
  }

  private async finishOnce(): Promise<void> {
    if (this.aborted) throw new Error("外部策略会话已主动关闭");
    this.finishing = true;
    if (!this.terminated) this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`外部策略收尾超时 (${this.timeoutMs}ms)`);
        this.fail(error);
        reject(this.failure ?? error);
      }, this.timeoutMs);
    });
    try {
      await Promise.race([this.stopped, deadline]);
      if (this.failure) throw this.failure;
      if (this.aborted) throw new Error("外部策略会话已主动关闭");
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (!this.terminated) {
      this.aborted = true;
      this.terminated = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("外部策略会话关闭"));
      }
      this.pending.clear();
      if (!this.child.killed) this.child.kill("SIGKILL");
    }
    await this.stopped;
  }
}
