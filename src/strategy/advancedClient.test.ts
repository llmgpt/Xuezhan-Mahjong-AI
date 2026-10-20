import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  BrowserAdvancedClient,
  type BrowserPolicyWorker,
} from "./advancedClient";
import type { DecisionAction } from "../game/decision";
import {
  createGame,
  discard,
  legalResponses,
  type GameState,
  type Phase,
} from "../game/game";
import { applyDecisionAction } from "../game/decision";
import { chooseTeacherAction } from "../game/teacher";
import { hand } from "../game/testHelpers";
import { createWall, tile, type Tile } from "../game/tiles";
import { playerView, type PlayerView } from "../game/view";
import * as diagnosticReader from "./advancedDiagnostics";
import observedHuFixture from "./fixtures/observedHuDecisions.json";

// Synthetic transport only. Host legality and E/D composition are real;
// these tests do not claim that a mock ran Python or established strength.
class FakeWorker implements BrowserPolicyWorker {
  onmessage: BrowserPolicyWorker["onmessage"] = null;
  onerror: BrowserPolicyWorker["onerror"] = null;
  onmessageerror: BrowserPolicyWorker["onmessageerror"] = null;
  messages: Record<string, unknown>[] = [];
  terminated = false;
  reply?: DecisionAction;
  ready = true;
  postMessage(value: unknown) {
    const message = structuredClone(value) as Record<string, unknown>;
    this.messages.push(message);
    if (message.command === "init" && this.ready)
      this.emit({ kind: "ready", generation: message.generation });
    if (message.command === "act" && this.reply) this.answer(this.reply);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  answer(action: DecisionAction, patch: Record<string, unknown> = {}) {
    const request = this.messages
      .filter((item) => item.command === "act")
      .at(-1)!;
    this.emit({
      kind: "action",
      generation: request.generation,
      id: request.id,
      session: request.session,
      revision: request.revision,
      action,
      ...patch,
    });
  }
}
const assets = {
  runtimeModuleUrl: "http://127.0.0.1/strategy/pyodide.mjs",
  runtimeIndexUrl: "http://127.0.0.1/strategy/",
  payloadUrl: "http://127.0.0.1/strategy/payload.json",
};
const position = { policy: "E" as const, session: 1, revision: 0 };
const clients: BrowserAdvancedClient[] = [];
function fixture(reply?: DecisionAction) {
  const workers: FakeWorker[] = [];
  const client = new BrowserAdvancedClient({
    ...assets,
    timeoutMs: 1000,
    workerFactory: () => {
      const worker = new FakeWorker();
      worker.reply = reply;
      workers.push(worker);
      return worker;
    },
  });
  clients.push(client);
  return { client, workers };
}
async function untilSent(workers: FakeWorker[]) {
  for (let n = 0; n < 10; n++) {
    await Promise.resolve();
    if (workers.at(-1)?.messages.some((m) => m.command === "act")) return;
  }
  throw new Error("Expected one actual worker request");
}
function scene(chosen: Partial<Record<number, Tile[]>>, turn = 0): GameState {
  const wall = createWall();
  for (const tiles of Object.values(chosen))
    for (const value of tiles ?? []) {
      const index = wall.indexOf(value);
      if (index < 0) throw new Error("More than four copies");
      wall.splice(index, 1);
    }
  const state = createGame(80000);
  state.phase = "discard";
  state.turn = turn;
  state.players = state.players.map((_, seat) => ({
    hand: chosen[seat] ?? wall.splice(0, seat === turn ? 14 : 13),
    melds: [],
    discards: [],
    missing: "tong",
    won: false,
    score: 0,
  }));
  state.wall = wall;
  return state;
}
function normal(seat = 0) {
  return playerView(scene({ [seat]: hand("w123456789 s12345") }, seat), seat);
}
function response() {
  const before = scene({
    0: hand("w1 d1122334455667"),
    1: hand("w23456789 s12355"),
  });
  before.players[0].missing = "tiao";
  const state = discard(before, 0, tile("wan", 1));
  expect(legalResponses(state, 1)).toContain("hu");
  return { state, view: playerView(state, 1) };
}
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const huRows = observedHuFixture.rows.map((row) => ({
  ...row,
  phase: row.phase as Phase,
  view: row.view as unknown as PlayerView,
  action: row.action as DecisionAction,
}));
function uncoveredDiagnostics(view: PlayerView) {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, ordered(item)]),
          )
        : value;
  return {
    version: 1,
    policyId: "ebony72-advanced-public-v1",
    publicViewHash: createHash("sha256")
      .update(JSON.stringify(ordered(view)))
      .digest("hex"),
    coverage: "not-covered",
    branch: null,
    comparison: null,
    currentIncome: { status: "not-called" },
    postHuMeldStage: "not-covered",
  };
}

describe("同一回复中的实际高级诊断", () => {
  it.each(huRows)(
    "$caseId 的真实动作与诊断只收一次，并隔离回复/调用者/cache快照",
    async (row) => {
      const f = fixture(),
        view = structuredClone(row.view),
        original = structuredClone(row.view);
      const pending = f.client.choose(view, row.phase, position);
      await untilSent(f.workers);
      const diagnostics = structuredClone(row.diagnostics);
      f.workers[0].answer(row.action, { diagnostics });
      const result = await pending;
      expect(result).toMatchObject({
        action: row.action,
        origin: "advanced-public",
        diagnostics: row.diagnostics,
      });
      diagnostics.comparison.actualUtl = 999;
      expect(result!.diagnostics).toEqual(row.diagnostics);
      result!.action = { type: "respond", choice: "hu" };
      result!.diagnostics!.comparison!.actualUtl = 777;
      const cached = await f.client.choose(original, row.phase, position);
      expect(cached).toMatchObject({
        action: row.action,
        diagnostics: row.diagnostics,
      });
      expect(
        f.workers[0].messages.filter((message) => message.command === "act"),
      ).toHaveLength(1);
      expect(view).toEqual(original);
    },
  );
  it.each(["unknown", "non-finite", "null", "undefined"])(
    "当前回复的%s诊断显式失败并关闭，不重选或退老师",
    async (kind) => {
      const row = huRows[0],
        f = fixture();
      const pending = f.client.choose(row.view, row.phase, position);
      const rejected = expect(pending).rejects.toThrow();
      await untilSent(f.workers);
      let diagnostics: unknown = structuredClone(row.diagnostics);
      if (kind === "unknown")
        Object.assign(diagnostics!, { privateOpponent: { hand: [0] } });
      else if (kind === "non-finite")
        (
          diagnostics as typeof row.diagnostics
        ).comparison.finalHeuristicWaitingFactor = Infinity;
      else diagnostics = kind === "null" ? null : undefined;
      f.workers[0].answer(row.action, { diagnostics });
      await rejected;
      expect(f.workers).toHaveLength(1);
      expect(f.workers[0].terminated).toBe(true);
      expect(
        f.workers[0].messages.filter((message) => message.command === "act"),
      ).toHaveLength(1);
    },
  );
  it("同一Worker的旧id坏诊断迟到，不污染下一局面的合法元数据", async () => {
    const first = huRows[0],
      next = huRows[3],
      f = fixture();
    const old = f.client.choose(first.view, first.phase, position);
    await untilSent(f.workers);
    const worker = f.workers[0],
      oldRequest = worker.messages.at(-1)!;
    worker.answer(first.action, { diagnostics: first.diagnostics });
    await old;
    const current = f.client.choose(next.view, next.phase, {
      ...position,
      revision: 1,
    });
    await untilSent(f.workers);
    expect(f.workers).toHaveLength(1);
    worker.emit({
      ...oldRequest,
      kind: "action",
      action: first.action,
      diagnostics: { privateOpponent: [0] },
    });
    expect(worker.terminated).toBe(false);
    worker.answer(next.action, { diagnostics: next.diagnostics });
    expect(await current).toMatchObject({
      action: next.action,
      diagnostics: next.diagnostics,
      revision: 1,
    });
  });
  it("同一客户端切到D老师响应或开局，不附加之前A的诊断", async () => {
    const row = huRows[0],
      f = fixture();
    const advanced = f.client.choose(row.view, row.phase, position);
    await untilSent(f.workers);
    f.workers[0].answer(row.action, { diagnostics: row.diagnostics });
    await advanced;
    const teacher = await f.client.choose(row.view, row.phase, {
      ...position,
      policy: "D",
      revision: 1,
    });
    expect(teacher).toMatchObject({
      action: chooseTeacherAction(row.view, row.phase),
      origin: "teacher-actions",
    });
    expect(teacher).not.toHaveProperty("diagnostics");
    const openingView = playerView(createGame(80000), 0);
    const opening = await f.client.choose(openingView, "exchange", {
      ...position,
      session: 2,
    });
    expect(opening?.origin).toBe("teacher-opening");
    expect(opening).not.toHaveProperty("diagnostics");
    expect(
      f.workers[0].messages.filter((message) => message.command === "act"),
    ).toHaveLength(1);
  });
  it("D的未覆盖诊断使用真实mask后Pending视图校验，原局面和诊断快照独立", async () => {
    const view = playerView(scene({ 0: hand("w1111 s2233445567") }), 0),
      original = structuredClone(view),
      f = fixture();
    expect(chooseTeacherAction(view, "discard")?.type).toBe("discard");
    const reader = vi.spyOn(diagnosticReader, "readAdvancedDiagnostics");
    const pending = f.client.choose(view, "discard", {
      ...position,
      policy: "D",
    });
    await untilSent(f.workers);
    const input = f.workers[0].messages.at(-1)!.view as PlayerView;
    expect(input.decision).toMatchObject({
      concealedKongs: [],
      addedKongs: [],
    });
    const action: DecisionAction = {
        type: "discard",
        tile: view.legalDiscards[0],
      },
      diagnostics = uncoveredDiagnostics(input);
    f.workers[0].answer(action, { diagnostics });
    expect(await pending).toMatchObject({
      action,
      diagnostics,
      origin: "advanced-public",
    });
    expect(reader).toHaveBeenCalledWith(diagnostics, input, "discard", action);
    expect(view).toEqual(original);
  });
});

describe("浏览器高级客户端的真实E/D组合与公开输入", () => {
  it("E保留高级拒绝合法点胡，D采用老师胡牌，不伪装成同一策略", async () => {
    const { view, state } = response();
    const e = fixture({ type: "respond", choice: "pass" });
    const result = await e.client.choose(view, "respond", position);
    expect(result).toMatchObject({
      action: { type: "respond", choice: "pass" },
      origin: "advanced-public",
      phase: "respond",
      policy: "E",
      session: 1,
      revision: 0,
      recommendationCount: 1,
      legalActionCount:
        view.decision?.kind === "respond" ? view.decision.choices.length : 0,
    });
    expect(() => applyDecisionAction(state, 1, result!.action)).not.toThrow();
    const d = fixture();
    expect(
      await d.client.choose(view, "respond", { ...position, policy: "D" }),
    ).toMatchObject({
      action: { type: "respond", choice: "hu" },
      origin: "teacher-actions",
    });
    expect(d.workers).toHaveLength(0);
  });
  it("D保留老师自杠，E可选择合法弃牌；单项推荐不冒充唯一合法动作", async () => {
    const state = scene({ 0: hand("w1111 s1234567891") }),
      view = playerView(state, 0);
    expect(chooseTeacherAction(view, "discard")?.type).toBe("kong");
    const d = fixture();
    expect(
      await d.client.choose(view, "discard", { ...position, policy: "D" }),
    ).toMatchObject({ action: { type: "kong" }, origin: "teacher-actions" });
    const e = fixture({ type: "discard", tile: view.legalDiscards.at(-1)! });
    const result = await e.client.choose(view, "discard", position);
    expect(result?.legalActionCount).toBeGreaterThan(1);
    expect(result?.recommendationCount).toBe(1);
    expect(() => applyDecisionAction(state, 0, result!.action)).not.toThrow();
  });
  it("D实际弃牌进入高级时清空自杠候选，输入不被修改", async () => {
    const view = playerView(scene({ 0: hand("w1111 s2233445567") }), 0);
    expect(
      view.decision?.kind === "self" && view.decision.concealedKongs,
    ).toEqual([0]);
    expect(chooseTeacherAction(view, "discard")?.type).toBe("discard");
    const snapshot = structuredClone(view);
    const f = fixture({ type: "discard", tile: view.legalDiscards[0] });
    const result = await f.client.choose(view, "discard", {
      ...position,
      policy: "D",
    });
    const message = f.workers[0].messages.find((m) => m.command === "act")!;
    expect((message.view as PlayerView).decision).toMatchObject({
      concealedKongs: [],
      addedKongs: [],
    });
    expect(result?.origin).toBe("advanced-public");
    expect(view).toEqual(snapshot);
  });
  it.each([0, 1, 2, 3])(
    "公开输入支持seat%s，Python消息不含seed或GameState",
    async (seat) => {
      const view = normal(seat),
        f = fixture({ type: "discard", tile: view.legalDiscards[0] });
      const result = await f.client.choose(view, "discard", position);
      const message = f.workers[0].messages.find((m) => m.command === "act")!;
      expect(message.view).toEqual(view);
      expect(result?.action).toEqual({
        type: "discard",
        tile: view.legalDiscards[0],
      });
      expect(Object.keys(message).sort()).toEqual([
        "command",
        "generation",
        "id",
        "phase",
        "revision",
        "session",
        "view",
      ]);
    },
  );
  it("E/D开局精确复用老师，无需初始化Python", async () => {
    let state = createGame(80000);
    for (const phase of ["exchange", "choose-missing"] as const)
      for (const seat of [0, 1, 2, 3]) {
        const view = playerView(state, seat),
          f = fixture();
        const result = await f.client.choose(view, phase, position);
        expect(result).toMatchObject({
          action: chooseTeacherAction(view, phase),
          origin: "teacher-opening",
        });
        expect(f.workers).toHaveLength(0);
        state = applyDecisionAction(state, seat, result!.action);
      }
  });
  it("拒绝顶层/对手/历史/副露夹带的隐藏字段，未发出worker消息", async () => {
    const mutations = [
      (v: PlayerView) => Object.assign(v, { seed: 80000 }),
      (v: PlayerView) => Object.assign(v.opponents[0], { hand: [0] }),
      (v: PlayerView) =>
        v.publicActions!.push({ kind: "draw", seat: 1, tile: 0 } as never),
      (v: PlayerView) =>
        v.melds.push({ type: "pung", tile: 0, from: 1, secret: [0] } as never),
    ];
    for (const mutate of mutations) {
      const f = fixture(),
        view = normal();
      mutate(view);
      await expect(f.client.choose(view, "discard", position)).rejects.toThrow(
        /公开|隐藏|字段/,
      );
      expect(f.workers).toHaveLength(0);
    }
  });
  it("阶段错配、缺真实历史和非决策状态不启动worker", async () => {
    const f = fixture();
    await expect(
      f.client.choose(normal(), "respond", position),
    ).rejects.toThrow(/阶段|视图/);
    const view = normal();
    delete view.publicActions;
    await expect(f.client.choose(view, "discard", position)).rejects.toThrow(
      /publicActions|历史/,
    );
    expect(await f.client.choose(normal(), "ended", position)).toBeUndefined();
    expect(f.workers).toHaveLength(0);
  });
});

describe("异步失效、取消与错误不会执行旧动作或静默回退", () => {
  it("上一决定已完成时同一牌局的下一revision复用空闲Worker，不每次重载WASM", async () => {
    const view = normal(),
      f = fixture({ type: "discard", tile: view.legalDiscards[0] });
    await f.client.choose(view, "discard", position);
    await f.client.choose(view, "discard", { ...position, revision: 1 });
    expect(f.workers).toHaveLength(1);
    expect(
      f.workers[0].messages.filter((m) => m.command === "init"),
    ).toHaveLength(1);
    expect(
      f.workers[0].messages.filter((m) => m.command === "act"),
    ).toHaveLength(2);
  });
  it("等待ready期间调用者修改context也不能重标旧view的session/revision", async () => {
    const f = fixture(),
      view = normal(),
      context = { ...position };
    const pending = f.client.choose(view, "discard", context);
    context.session = 9;
    context.revision = 99;
    await untilSent(f.workers);
    const request = f.workers[0].messages
      .filter((m) => m.command === "act")
      .at(-1)!;
    f.workers[0].answer({ type: "discard", tile: view.legalDiscards[0] });
    const result = await pending;
    expect(request).toMatchObject({ session: 1, revision: 0 });
    expect(result).toMatchObject({ session: 1, revision: 0 });
  });
  it("构造后修改调用者的asset options不能替换已经选定的资源来源", async () => {
    const worker = new FakeWorker(),
      view = normal();
    worker.reply = { type: "discard", tile: view.legalDiscards[0] };
    const options = { ...assets, workerFactory: () => worker };
    const client = new BrowserAdvancedClient(options);
    clients.push(client);
    options.payloadUrl = "http://127.0.0.1/other.json";
    await client.choose(view, "discard", position);
    expect(worker.messages[0].assets).toEqual(assets);
  });
  it("相同局面重复请求共用一次worker决定，调用者修改不会改变快照", async () => {
    const f = fixture(),
      view = normal(),
      same = structuredClone(view);
    const first = f.client.choose(view, "discard", position),
      second = f.client.choose(same, "discard", position);
    view.hand[0] = 26;
    await untilSent(f.workers);
    expect(
      f.workers[0].messages.filter((m) => m.command === "act"),
    ).toHaveLength(1);
    f.workers[0].answer({ type: "discard", tile: same.legalDiscards[0] });
    expect(await first).toEqual(await second);
  });
  it("revision更新立即拒绝旧结果；迟到action与旧session不得污染重建请求", async () => {
    const f = fixture(),
      view = normal();
    const old = f.client.choose(view, "discard", position);
    const rejected = expect(old).rejects.toThrow(/取消|过期/);
    await untilSent(f.workers);
    const first = f.workers[0];
    f.client.setPosition({ session: 1, revision: 1 });
    await rejected;
    expect(first.terminated).toBe(true);
    const next = f.client.choose(view, "discard", { ...position, revision: 1 });
    await untilSent(f.workers);
    first.answer({ type: "discard", tile: view.legalDiscards.at(-1)! });
    f.workers[1].answer(
      { type: "discard", tile: view.legalDiscards[0] },
      { session: 0 },
    );
    f.workers[1].answer({ type: "discard", tile: view.legalDiscards[0] });
    expect((await next)?.revision).toBe(1);
    await expect(f.client.choose(view, "discard", position)).rejects.toThrow(
      /过期/,
    );
  });
  it("取消和重建都终止旧Worker，新请求重新初始化，close后不可复用", async () => {
    const f = fixture(),
      view = normal();
    const pending = f.client.choose(view, "discard", position);
    const rejected = expect(pending).rejects.toThrow(/取消/);
    await untilSent(f.workers);
    f.client.cancel();
    await rejected;
    f.client.rebuild();
    const next = f.client.choose(view, "discard", position);
    await untilSent(f.workers);
    expect(f.workers).toHaveLength(2);
    expect(f.workers[0].terminated).toBe(true);
    f.workers[1].answer({ type: "discard", tile: view.legalDiscards[0] });
    await next;
    f.client.close();
    await expect(f.client.choose(view, "discard", position)).rejects.toThrow(
      /关闭/,
    );
  });
  it.each(["error", "messageerror", "python-error", "illegal", "extra-field"])(
    "%s显式失败并终止，无teacher fallback",
    async (kind) => {
      const f = fixture(),
        view = normal();
      const pending = f.client.choose(view, "discard", position);
      const rejected = expect(pending).rejects.toThrow();
      await untilSent(f.workers);
      if (kind === "error")
        f.workers[0].onerror?.({ message: "worker failed" } as ErrorEvent);
      else if (kind === "messageerror")
        f.workers[0].onmessageerror?.({} as MessageEvent);
      else if (kind === "python-error") {
        const req = f.workers[0].messages.at(-1)!;
        f.workers[0].emit({
          kind: "error",
          generation: req.generation,
          id: req.id,
          message: "upstream-error",
        });
      } else if (kind === "illegal") f.workers[0].answer({ type: "win" });
      else
        f.workers[0].answer({
          type: "discard",
          tile: view.legalDiscards[0],
          reason: "invented",
        } as never);
      await rejected;
      expect(f.workers[0].terminated).toBe(true);
    },
  );
  it("worker初始化超时也终止，不能等一个永不返回的ready", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    worker.ready = false;
    const client = new BrowserAdvancedClient({
      ...assets,
      timeoutMs: 20,
      workerFactory: () => worker,
    });
    clients.push(client);
    const pending = client.choose(normal(), "discard", position),
      rejected = expect(pending).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(21);
    await rejected;
    expect(worker.terminated).toBe(true);
  });
});
