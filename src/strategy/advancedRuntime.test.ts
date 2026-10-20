import { describe, expect, it, vi } from "vitest";
import {
  loadAdvancedRuntime,
  createAdvancedWorkerHandler,
  type PythonEngine,
} from "./advancedRuntime";
import type { WorkerReply } from "./advancedProtocol";
import { createGame } from "../game/game";
import { applyDecisionAction } from "../game/decision";
import { chooseTeacherAction } from "../game/teacher";
import { playerView } from "../game/view";

// Fake Pyodide/FS tests the loader and wire contract, not Python execution.
const assets = {
  runtimeModuleUrl: "http://127.0.0.1/runtime/pyodide.mjs",
  runtimeIndexUrl: "http://127.0.0.1/runtime/",
  payloadUrl: "http://127.0.0.1/payload.json",
};
async function payload() {
  const paths = [
    "scripts/external/worker.py",
    "scripts/external/advanced_policy.py",
    "scripts/external/public_history_validation.py",
    ...Array.from(
      { length: 35 },
      (_, i) => `vendor/ebony72-advanced/fixed-${i}.py`,
    ),
  ];
  return {
    sourceFiles: 38,
    files: await Promise.all(
      paths.map(async (path) => {
        const bytes = new TextEncoder().encode("synthetic content: " + path);
        const sha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("");
        return { path, base64: btoa(new TextDecoder().decode(bytes)), sha256 };
      }),
    ),
  };
}
function view() {
  let state = createGame(80000);
  for (const phase of ["exchange", "choose-missing"] as const)
    for (const seat of [0, 1, 2, 3])
      state = applyDecisionAction(
        state,
        seat,
        chooseTeacherAction(playerView(state, seat), phase)!,
      );
  return playerView(state, 0);
}
async function fixture() {
  const files = new Map<string, Uint8Array>(),
    globals = new Map<string, unknown>(),
    data = await payload();
  let result: unknown;
  const python: PythonEngine = {
    FS: {
      mkdirTree: vi.fn(),
      writeFile: (path, bytes) => files.set(path, bytes.slice()),
      readFile: (path) => files.get(path)!.slice(),
    },
    globals: {
      set: (key, value) => globals.set(key, value),
      delete: (key) => globals.delete(key),
    },
    runPython: vi.fn((source) => {
      if (!source.includes("worker.handle_request")) return undefined;
      const request = JSON.parse(String(globals.get("_browser_request_json")));
      return JSON.stringify(
        result ?? {
          id: request.id,
          action: { type: "discard", tile: request.view.legalDiscards[0] },
        },
      );
    }),
  };
  const loadPyodide = vi.fn(async () => python),
    importModule = vi.fn(async () => ({ version: "314.0.7", loadPyodide }));
  const deps = { fetchJson: vi.fn(async () => data), importModule };
  return {
    data,
    files,
    globals,
    python,
    loadPyodide,
    deps,
    setResult: (value: unknown) => {
      result = value;
    },
  };
}

describe("本地高级Python的包校验和真实调用协议（运行时在此处模拟）", () => {
  it("显式本地URL、38文件逐字节校验与挂载，实际调用固定advanced-public入口", async () => {
    const f = await fixture(),
      runtime = await loadAdvancedRuntime(assets, f.deps),
      input = view();
    const result = runtime.act(input, "discard");
    expect(f.deps.fetchJson).toHaveBeenCalledWith(assets.payloadUrl);
    expect(f.deps.importModule).toHaveBeenCalledWith(assets.runtimeModuleUrl);
    expect(f.loadPyodide).toHaveBeenCalledWith(
      expect.objectContaining({ indexURL: assets.runtimeIndexUrl }),
    );
    expect(f.files.size).toBe(38);
    expect(result).toEqual({ type: "discard", tile: input.legalDiscards[0] });
    const call = (
      f.python.runPython as ReturnType<typeof vi.fn>
    ).mock.calls.find((c) => String(c[0]).includes("worker.handle_request"));
    expect(call).toBeDefined();
    expect(f.globals.has("_browser_request_json")).toBe(false);
    expect(runtime.metadata).toMatchObject({
      runtimeVersion: "314.0.7",
      sourceFiles: 38,
      policy: "ebony72-advanced-public-v1",
    });
  });
  it.each(["hash", "count", "path", "duplicate"])(
    "%s损坏在加载运行时前显式失败，不改源或回退",
    async (kind) => {
      const f = await fixture();
      if (kind === "hash") f.data.files[0].sha256 = "0".repeat(64);
      if (kind === "count") f.data.files.pop();
      if (kind === "path")
        f.data.files[0].path = "scripts/external/../../private.py";
      if (kind === "duplicate") f.data.files[1] = { ...f.data.files[0] };
      await expect(loadAdvancedRuntime(assets, f.deps)).rejects.toThrow();
      expect(f.deps.importModule).not.toHaveBeenCalled();
    },
  );
  it("Python结构化错误、错误id和非法动作都直传；不伪造解释", async () => {
    const f = await fixture(),
      runtime = await loadAdvancedRuntime(assets, f.deps);
    for (const result of [
      { id: 1, error: { code: "upstream-error", message: "No preferrable" } },
      { id: 999, action: { type: "discard", tile: 0 } },
      { id: 3, action: { type: "win" } },
      {
        id: 4,
        action: { type: "discard", tile: view().legalDiscards[0] },
        score: 123,
      },
    ]) {
      f.setResult(result);
      expect(() => runtime.act(view(), "discard")).toThrow();
    }
  });
  it("桥可执行respond原样过牌，Python只收公开view和phase，不接宿主session/seed", async () => {
    const f = await fixture();
    let request: Record<string, unknown> | undefined;
    f.python.runPython = (source) => {
      if (!source.includes("worker.handle_request")) return undefined;
      request = JSON.parse(String(f.globals.get("_browser_request_json")));
      return JSON.stringify({
        id: request!.id,
        action: { type: "respond", choice: "pass" },
      });
    };
    const runtime = await loadAdvancedRuntime(assets, f.deps),
      input = view();
    input.hand.pop();
    input.legalDiscards = [];
    input.decision = {
      kind: "respond",
      responseKind: "discard",
      from: 1,
      tile: 0,
      choices: ["pass", "hu"],
    };
    expect(runtime.act(input, "respond")).toEqual({
      type: "respond",
      choice: "pass",
    });
    expect(Object.keys(request!).sort()).toEqual([
      "id",
      "phase",
      "policy",
      "view",
    ]);
    expect(request!.policy).toBe("ebony72-advanced-public-v1");
    expect(() =>
      runtime.act({ ...input, seed: 80000 } as never, "respond"),
    ).toThrow(/公开|隐藏|字段/);
  });
  it("worker初始化一次、echo位置标识，错误不输出action且不能凭错generation运行", async () => {
    const f = await fixture(),
      replies: WorkerReply[] = [];
    const handler = createAdvancedWorkerHandler(
      (reply) => replies.push(reply),
      f.deps,
    );
    await handler({ command: "init", generation: 4, assets });
    expect(replies.shift()).toEqual({ kind: "ready", generation: 4 });
    await handler({
      command: "act",
      generation: 4,
      id: 1,
      session: 8,
      revision: 7,
      phase: "discard",
      view: view(),
    });
    expect(replies.shift()).toMatchObject({
      kind: "action",
      generation: 4,
      id: 1,
      session: 8,
      revision: 7,
      action: { type: "discard" },
    });
    await handler({
      command: "act",
      generation: 3,
      id: 2,
      session: 8,
      revision: 7,
      phase: "discard",
      view: view(),
    });
    expect(replies.shift()).toMatchObject({
      kind: "error",
      generation: 3,
      id: 2,
    });
    await handler({ command: "init", generation: 4, assets });
    expect(replies.shift()).toMatchObject({ kind: "error" });
    expect(f.loadPyodide).toHaveBeenCalledTimes(1);
  });
});
