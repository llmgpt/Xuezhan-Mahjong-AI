import { chooseAdvancedComponentAction } from "../game/advancedComponents";
import type { DecisionAction } from "../game/decision";
import type { Phase } from "../game/game";
import type { PlayerView } from "../game/view";
import { v10ResponseChoice } from "../game/v10Response";
import {
  readAdvancedDiagnostics,
  type AdvancedDiagnostics,
} from "./advancedDiagnostics";
import {
  assertLegalAction,
  assertPosition,
  assertPublicView,
  fields,
  legalActionCount,
  type AdvancedAssets,
  type Position,
  type WorkerReply,
} from "./advancedProtocol";

export interface BrowserPolicyWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}
export interface BrowserDecision extends Position {
  action: DecisionAction;
  phase: Phase;
  policy: "E" | "D" | "V10";
  origin:
    "teacher-opening" | "teacher-actions" | "advanced-public" | "v10-response";
  recommendationCount: 1;
  legalActionCount?: number;
  diagnostics?: AdvancedDiagnostics;
}
interface AdvancedReply {
  action: DecisionAction;
  diagnostics?: AdvancedDiagnostics;
}
interface Pending extends Position {
  view: PlayerView;
  phase: Phase;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: AdvancedReply) => void;
  reject: (error: Error) => void;
}
interface Transport {
  worker: BrowserPolicyWorker;
  generation: number;
  ready: Promise<void>;
  readyResolve: () => void;
  readyReject: (error: Error) => void;
  readyDone: boolean;
  timer?: ReturnType<typeof setTimeout>;
  pending: Map<number, Pending>;
}
export class BrowserAdvancedClient {
  private transport?: Transport;
  private position?: Position;
  private epoch = 0;
  private sequence = 0;
  private closed = false;
  private cache?: {
    key: string;
    promise: Promise<BrowserDecision | undefined>;
  };
  private timeoutMs: number;
  constructor(
    private options: AdvancedAssets & {
      timeoutMs?: number;
      workerFactory?: () => BrowserPolicyWorker;
    },
  ) {
    this.options = { ...options };
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error("策略超时必须为正数");
    const urls = [
      options.runtimeModuleUrl,
      options.runtimeIndexUrl,
      options.payloadUrl,
    ].map((value) => new URL(value));
    if (
      urls.some(
        (url) => !["http:", "https:", "file:"].includes(url.protocol),
      ) ||
      urls.some((url) => url.origin !== urls[0].origin)
    )
      throw new Error("运行时和策略包必须来自相同来源");
  }
  setPosition(position: Position) {
    assertPosition(position);
    if (
      this.position &&
      (position.session < this.position.session ||
        (position.session === this.position.session &&
          position.revision < this.position.revision))
    )
      throw new Error("过期会话或局面");
    if (
      !this.position ||
      position.session !== this.position.session ||
      position.revision !== this.position.revision
    ) {
      if (
        this.position?.session === position.session &&
        this.transport?.readyDone &&
        !this.transport.pending.size
      ) {
        this.epoch++;
        this.cache = undefined;
      } else this.cancel();
      this.position = {
        session: position.session,
        revision: position.revision,
      };
    }
  }
  cancel() {
    this.epoch++;
    this.cache = undefined;
    this.stop(new Error("策略计算已取消或过期"));
  }
  rebuild() {
    if (this.closed) throw new Error("策略客户端已关闭");
    this.cancel();
  }
  close() {
    this.cancel();
    this.closed = true;
  }
  private stop(error: Error) {
    const transport = this.transport;
    if (!transport) return;
    this.transport = undefined;
    if (transport.timer) clearTimeout(transport.timer);
    transport.readyReject(error);
    for (const pending of transport.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    transport.pending.clear();
    transport.worker.terminate();
  }
  private fail(transport: Transport, error: Error) {
    if (this.transport !== transport) return;
    this.epoch++;
    this.cache = undefined;
    this.stop(error);
  }
  private getTransport(): Transport {
    if (this.transport) return this.transport;
    let readyResolve!: () => void, readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const worker =
      this.options.workerFactory?.() ??
      new Worker(new URL("./advanced.worker.ts", import.meta.url), {
        type: "module",
      });
    const transport: Transport = {
      worker,
      generation: ++this.sequence,
      ready,
      readyResolve,
      readyReject,
      readyDone: false,
      pending: new Map(),
    };
    this.transport = transport;
    worker.onmessage = ({ data }: { data: WorkerReply }) => {
      if (
        this.transport !== transport ||
        data?.generation !== transport.generation
      )
        return;
      try {
        if (data.kind === "ready") {
          fields(data, ["kind", "generation"]);
          if (transport.timer) clearTimeout(transport.timer);
          transport.readyDone = true;
          transport.readyResolve();
          return;
        }
        if (data.kind === "error") {
          if (data.id !== undefined && !transport.pending.has(data.id)) return;
          throw new Error(data.message || "Python策略失败");
        }
        if (data.kind !== "action") throw new Error("未知策略Worker消息");
        const pending = transport.pending.get(data.id);
        if (
          !pending ||
          data.session !== pending.session ||
          data.revision !== pending.revision
        )
          return;
        const required = [
          "kind",
          "generation",
          "id",
          "session",
          "revision",
          "action",
        ];
        fields(data, [...required, "diagnostics"], required);
        assertLegalAction(data.action, pending.view, pending.phase);
        const diagnostics = Object.hasOwn(data, "diagnostics")
          ? readAdvancedDiagnostics(
              data.diagnostics,
              pending.view,
              pending.phase,
              data.action,
            )
          : undefined;
        clearTimeout(pending.timer);
        transport.pending.delete(data.id);
        pending.resolve({
          action: structuredClone(data.action),
          ...(diagnostics ? { diagnostics } : {}),
        });
      } catch (error) {
        this.fail(
          transport,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };
    worker.onerror = (event) =>
      this.fail(transport, new Error(event.message || "策略Worker错误"));
    worker.onmessageerror = () =>
      this.fail(transport, new Error("策略Worker消息无法解析"));
    transport.timer = setTimeout(
      () => this.fail(transport, new Error("策略Worker初始化超时")),
      this.timeoutMs,
    );
    const { runtimeModuleUrl, runtimeIndexUrl, payloadUrl } = this.options;
    try {
      worker.postMessage({
        command: "init",
        generation: transport.generation,
        assets: { runtimeModuleUrl, runtimeIndexUrl, payloadUrl },
      });
    } catch (error) {
      this.fail(
        transport,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return transport;
  }
  private async advanced(
    view: PlayerView,
    phase: Phase,
    position: Position,
    epoch: number,
  ): Promise<AdvancedReply> {
    const transport = this.getTransport();
    await transport.ready;
    if (this.epoch !== epoch || this.transport !== transport)
      throw new Error("策略结果已取消或过期");
    return new Promise<AdvancedReply>((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(
        () => this.fail(transport, new Error("高级策略响应超时")),
        this.timeoutMs,
      );
      transport.pending.set(id, {
        ...position,
        view: structuredClone(view),
        phase,
        timer,
        resolve,
        reject,
      });
      try {
        transport.worker.postMessage({
          command: "act",
          generation: transport.generation,
          id,
          session: position.session,
          revision: position.revision,
          phase,
          view: structuredClone(view),
        });
      } catch (error) {
        this.fail(
          transport,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }
  async choose(
    view: PlayerView,
    phase: Phase,
    context: Position & { policy: BrowserDecision["policy"] },
  ): Promise<BrowserDecision | undefined> {
    if (this.closed) throw new Error("策略客户端已关闭");
    context = {
      policy: context.policy,
      session: context.session,
      revision: context.revision,
    };
    assertPublicView(view);
    assertPosition(context);
    if (!["E", "D", "V10"].includes(context.policy))
      throw new Error("未知生产高级策略");
    this.setPosition(context);
    const snapshot = structuredClone(view),
      key = JSON.stringify({ view: snapshot, phase, ...context });
    if (this.cache?.key === key)
      return structuredClone(await this.cache.promise);
    if (this.cache) this.cancel();
    const epoch = this.epoch;
    const promise = (async () => {
      let origin: BrowserDecision["origin"] =
        phase === "exchange" || phase === "choose-missing"
          ? "teacher-opening"
          : "teacher-actions";
      let diagnostics: AdvancedDiagnostics | undefined;
      const response =
        context.policy === "V10"
          ? v10ResponseChoice(snapshot, phase)
          : undefined;
      if (response) origin = "v10-response";
      const action =
        response?.action ??
        (await chooseAdvancedComponentAction(
          snapshot,
          phase,
          context.policy === "D" ? "discard" : "full",
          async (input, decisionPhase) => {
            origin = "advanced-public";
            const result = await this.advanced(
              input,
              decisionPhase,
              context,
              epoch,
            );
            diagnostics = result.diagnostics;
            return result.action;
          },
        ));
      if (this.epoch !== epoch || this.closed)
        throw new Error("策略结果已取消或过期");
      if (!action) return undefined;
      assertLegalAction(action, snapshot, phase);
      return {
        action: structuredClone(action),
        origin,
        phase,
        policy: context.policy,
        session: context.session,
        revision: context.revision,
        recommendationCount: 1 as const,
        legalActionCount: legalActionCount(snapshot, phase),
        ...(diagnostics ? { diagnostics } : {}),
      };
    })();
    this.cache = { key, promise };
    return structuredClone(await promise);
  }
}
