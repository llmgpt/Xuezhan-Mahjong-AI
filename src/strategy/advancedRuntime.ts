import type { DecisionAction } from "../game/decision";
import type { Phase } from "../game/game";
import type { PlayerView } from "../game/view";
import {
  assertLegalAction,
  assertPosition,
  assertPublicView,
  fields,
  type AdvancedAssets,
  type WorkerReply,
} from "./advancedProtocol";

export interface PythonEngine {
  FS: {
    mkdirTree: (path: string) => void;
    writeFile: (path: string, bytes: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
  globals: {
    set: (key: string, value: unknown) => unknown;
    delete?: (key: string) => unknown;
  };
  runPython: (source: string) => unknown;
}
interface PyodideModule {
  version: string;
  loadPyodide: (options: {
    indexURL: string;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  }) => Promise<PythonEngine>;
}
export interface RuntimeDependencies {
  fetchJson: (url: string) => Promise<unknown>;
  importModule: (url: string) => Promise<PyodideModule>;
}
const defaults: RuntimeDependencies = {
  fetchJson: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`策略包读取失败 HTTP ${response.status}`);
    return response.json();
  },
  importModule: async (url) =>
    import(/* @vite-ignore */ url) as Promise<PyodideModule>,
};
const policy = "ebony72-advanced-public-v1";
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

/** The optional services are offline test seams. Production imports only its
 * explicit same-origin runtime URL and executes the shipped Python worker. */
export async function loadAdvancedRuntime(
  assets: AdvancedAssets,
  deps: RuntimeDependencies = defaults,
) {
  const raw = await deps.fetchJson(assets.payloadUrl);
  fields(raw, ["files", "sourceFiles"]);
  if (
    raw.sourceFiles !== 38 ||
    !Array.isArray(raw.files) ||
    raw.files.length !== 38
  )
    throw new Error("原高级Python闭包必须为38文件");
  const seen = new Set<string>(),
    files: { path: string; bytes: Uint8Array; sha256: string }[] = [];
  for (const row of raw.files) {
    fields(row, ["path", "base64", "sha256"]);
    if (
      typeof row.path !== "string" ||
      !/^(scripts\/external\/|vendor\/ebony72-(advanced|mahjong)\/)/.test(
        row.path,
      ) ||
      /[\\:]/.test(row.path) ||
      row.path
        .split("/")
        .some((part) => !part || part === "." || part === "..") ||
      /cap8|fanfou/.test(row.path) ||
      seen.has(row.path) ||
      typeof row.base64 !== "string" ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.sha256)
    )
      throw new Error("Python策略来源路径/摘要无效或重复");
    const bytes = Uint8Array.from(atob(row.base64), (character) =>
      character.charCodeAt(0),
    );
    if ((await digest(bytes)) !== row.sha256)
      throw new Error(`Python策略字节校验失败：${row.path}`);
    seen.add(row.path);
    files.push({ path: row.path, bytes, sha256: row.sha256 });
  }
  for (const name of [
    "worker.py",
    "advanced_policy.py",
    "public_history_validation.py",
  ])
    if (!seen.has("scripts/external/" + name))
      throw new Error("Python闭包缺少入口 " + name);
  const module = await deps.importModule(assets.runtimeModuleUrl);
  if (module.version !== "314.0.7" || typeof module.loadPyodide !== "function")
    throw new Error("本地Pyodide运行时版本无效");
  const python = await module.loadPyodide({
    indexURL: assets.runtimeIndexUrl,
    stdout: () => {},
    stderr: () => {},
  });
  for (const file of files) {
    const target = "/xuezhan/" + file.path;
    python.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
    python.FS.writeFile(target, file.bytes);
    if ((await digest(python.FS.readFile(target))) !== file.sha256)
      throw new Error("Python挂载字节校验失败");
  }
  python.runPython(
    "import sys, json\nsys.dont_write_bytecode = True\nsys.path.insert(0, '/xuezhan/scripts/external')\nimport worker, advanced_policy\nassert worker.__file__ == '/xuezhan/scripts/external/worker.py'\nassert advanced_policy.__file__ == '/xuezhan/scripts/external/advanced_policy.py'\nadvanced_policy.load_policy()",
  );
  let sequence = 0;
  return {
    metadata: {
      runtimeVersion: module.version,
      sourceFiles: files.length,
      policy,
    },
    act(view: PlayerView, phase: Phase): DecisionAction {
      assertPublicView(view);
      if (phase !== "discard" && phase !== "respond")
        throw new Error("Python桥仅接受实际弃牌/响应阶段");
      if (
        !view.decision ||
        (phase === "discard") !== (view.decision.kind === "self")
      )
        throw new Error("Python阶段与公开决策视图不符");
      const id = ++sequence;
      const request = { id, phase, policy, view: structuredClone(view) };
      python.globals.set("_browser_request_json", JSON.stringify(request));
      let response: unknown;
      try {
        const result = python.runPython(
          "json.dumps(worker.handle_request(json.loads(_browser_request_json)), ensure_ascii=False, allow_nan=False)",
        );
        if (typeof result !== "string")
          throw new Error("Python策略返回非JSON字符串");
        response = JSON.parse(result);
      } finally {
        python.globals.delete?.("_browser_request_json");
      }
      fields(response, ["id", "action", "error"], ["id"]);
      if (response.id !== id) throw new Error("Python策略响应id不符");
      if (response.error !== undefined) {
        fields(response, ["id", "error"]);
        fields(response.error, ["code", "message"]);
        throw new Error(
          `Python策略失败 ${String(response.error.code)}: ${String(response.error.message)}`,
        );
      }
      fields(response, ["id", "action"]);
      assertLegalAction(response.action, view, phase);
      return structuredClone(response.action);
    },
  };
}

export function createAdvancedWorkerHandler(
  post: (reply: WorkerReply) => void,
  deps?: RuntimeDependencies,
) {
  let generation: number | undefined,
    starting = false,
    runtime: Awaited<ReturnType<typeof loadAdvancedRuntime>> | undefined;
  return async (raw: unknown) => {
    let identity: { generation?: number; id?: number } = {};
    try {
      if (raw && typeof raw === "object") {
        const candidate = raw as Record<string, unknown>;
        identity = {
          ...(Number.isSafeInteger(candidate.generation)
            ? { generation: candidate.generation as number }
            : {}),
          ...(Number.isSafeInteger(candidate.id)
            ? { id: candidate.id as number }
            : {}),
        };
      }
      fields(
        raw,
        [
          "command",
          "generation",
          "assets",
          "id",
          "session",
          "revision",
          "phase",
          "view",
        ],
        ["command", "generation"],
      );
      if (
        !Number.isSafeInteger(raw.generation) ||
        (raw.generation as number) < 1
      )
        throw new Error("Worker运行代号无效");
      if (raw.command === "init") {
        fields(raw, ["command", "generation", "assets"]);
        if (starting || runtime) throw new Error("Worker不能重复初始化");
        fields(raw.assets, [
          "runtimeModuleUrl",
          "runtimeIndexUrl",
          "payloadUrl",
        ]);
        if (
          Object.values(raw.assets).some((value) => typeof value !== "string")
        )
          throw new Error("Worker资源地址无效");
        starting = true;
        generation = raw.generation as number;
        runtime = await loadAdvancedRuntime(
          raw.assets as unknown as AdvancedAssets,
          deps,
        );
        post({ kind: "ready", generation });
        return;
      }
      fields(raw, [
        "command",
        "generation",
        "id",
        "session",
        "revision",
        "phase",
        "view",
      ]);
      if (
        raw.command !== "act" ||
        !runtime ||
        raw.generation !== generation ||
        !Number.isSafeInteger(raw.id) ||
        (raw.id as number) < 1
      )
        throw new Error("Worker未就绪或请求已经过期");
      const position = {
        session: raw.session as number,
        revision: raw.revision as number,
      };
      assertPosition(position);
      assertPublicView(raw.view);
      if (raw.phase !== "discard" && raw.phase !== "respond")
        throw new Error("不支持的Worker决策阶段");
      const action = runtime.act(raw.view, raw.phase);
      post({
        kind: "action",
        generation: raw.generation as number,
        id: raw.id as number,
        ...position,
        action,
      });
    } catch (error) {
      post({
        kind: "error",
        ...identity,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
