import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  collectBrowserPolicyAssets,
  browserPolicyAssetsPlugin,
} from "./browserPolicyAssets";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("xuezhan-browser-assets-")
    )
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const root = resolve("."),
  runtimeRoot = resolve("node_modules/pyodide");
function temp() {
  const result = mkdtempSync(join(tmpdir(), "xuezhan-browser-assets-"));
  roots.push(result);
  return result;
}
describe("本地浏览器策略资产构建", () => {
  it("真实本地NPM运行时匹配官方pin，39源只增实际观察模块并保留原字节及许可", () => {
    const assets = collectBrowserPolicyAssets({
      projectRoot: root,
      runtimeRoot,
    });
    const pin = JSON.parse(
      readFileSync("vendor/pyodide-runtime/UPSTREAM.json", "utf8"),
    );
    for (const [name, detail] of Object.entries(pin.files) as [
      string,
      { sha256: string },
    ][])
      expect(sha(assets.get("strategy/pyodide-314.0.7/" + name)!)).toBe(
        detail.sha256,
      );
    const payload = JSON.parse(
      Buffer.from(
        assets.get("strategy/advanced-public-v1/payload.json")!,
      ).toString("utf8"),
    );
    expect(payload.sourceFiles).toBe(39);
    expect(
      payload.files.some(
        (row: { path: string }) =>
          row.path === "scripts/external/public_decision_diagnostics.py",
      ),
    ).toBe(true);
    expect(
      payload.files.some((row: { path: string }) =>
        /v1_income|ready_income|cap8|fanfou/.test(row.path),
      ),
    ).toBe(false);
    for (const row of payload.files as {
      path: string;
      base64: string;
      sha256: string;
    }[])
      expect(Buffer.from(row.base64, "base64")).toEqual(
        readFileSync(resolve(root, row.path)),
      );
    expect(
      Buffer.from(
        assets.get("strategy/pyodide-314.0.7/LICENSE-MPL-2.0.txt")!,
      ).toString(),
    ).toContain("Mozilla Public License Version 2.0");
    const pythonLicensePath =
      "strategy/pyodide-314.0.7/LICENSE-CPython-3.14.2.txt";
    expect(assets.has(pythonLicensePath)).toBe(true);
    expect(sha(assets.get(pythonLicensePath)!)).toBe(
      sha(readFileSync("vendor/pyodide-runtime/LICENSE-CPython-3.14.2.txt")),
    );
    for (const name of [
      "THIRD_PARTY_NOTICES.txt",
      "THIRD_PARTY_SOURCES.json",
    ]) {
      const asset = "strategy/pyodide-314.0.7/" + name;
      expect(assets.has(asset)).toBe(true);
      expect(sha(assets.get(asset)!)).toBe(
        sha(readFileSync("vendor/pyodide-runtime/" + name)),
      );
    }
    expect(
      assets.get("strategy/advanced-public-v1/LICENSE-advanced.txt"),
    ).toEqual(readFileSync("vendor/ebony72-advanced/upstream/license.md"));
    expect(
      assets.get("strategy/advanced-public-v1/LICENSE-initial.txt"),
    ).toEqual(readFileSync("vendor/ebony72-mahjong/license.md"));
    expect(
      [...assets.keys()].some((path) =>
        /seed|trace|expected|fanfou|cap8/.test(path),
      ),
    ).toBe(false);
  });
  it("运行时文件漂移在生成或执行任何浏览器策略前拒绝", () => {
    const directory = temp();
    writeFileSync(join(directory, "package.json"), "changed runtime");
    expect(() =>
      collectBrowserPolicyAssets({ projectRoot: root, runtimeRoot: directory }),
    ).toThrow(/运行时|runtime/);
  });
  it("策略闭包含越界路径时拒绝，不能打包任意工作区数据", () => {
    const directory = temp();
    mkdirSync(join(directory, "scripts"));
    const source = JSON.parse(
      readFileSync("scripts/browserPolicySources.json", "utf8"),
    );
    const entries = Object.entries(source.files);
    entries[0][0] = "../private.py";
    writeFileSync(
      join(directory, "scripts/browserPolicySources.json"),
      JSON.stringify({ ...source, files: Object.fromEntries(entries) }),
    );
    expect(() =>
      collectBrowserPolicyAssets({ projectRoot: directory, runtimeRoot }),
    ).toThrow(/闭包|路径/);
  });
  it("Vite构建输出固定的同站URL资源，原字节作为asset而非业务JS重写", () => {
    const emitted: { type: string; fileName: string; source: Uint8Array }[] =
      [];
    const plugin = browserPolicyAssetsPlugin({
      projectRoot: root,
      runtimeRoot,
    });
    const hook = plugin.generateBundle as unknown as (this: unknown) => void;
    hook.call({
      emitFile: (asset: {
        type: string;
        fileName: string;
        source: Uint8Array;
      }) => emitted.push(asset),
    });
    expect(
      emitted.some(
        (item) =>
          item.type === "asset" &&
          item.fileName === "strategy/pyodide-314.0.7/pyodide.asm.wasm",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (item) => item.fileName === "strategy/advanced-public-v1/payload.json",
      ),
    ).toBe(true);
    expect(emitted.every((item) => item.source.byteLength > 0)).toBe(true);
  });
  it("开发服务在子路径以正确WASM类型响应HEAD，只暴露固定资源", () => {
    const plugin = browserPolicyAssetsPlugin({
      projectRoot: root,
      runtimeRoot,
    });
    let handler: (
      req: { url: string; method: string },
      res: unknown,
      next: () => void,
    ) => void = () => {
      throw new Error("Missing middleware");
    };
    const hook = plugin.configureServer as unknown as (server: unknown) => void;
    hook({
      config: { base: "/learn/" },
      middlewares: {
        use: (value: typeof handler) => {
          handler = value;
        },
      },
    });
    const headers: Record<string, string> = {},
      response = {
        setHeader: (key: string, value: string) => {
          headers[key] = value;
        },
        end: (body: unknown) => {
          expect(body).toBeUndefined();
        },
      };
    let unknown = 0;
    handler(
      {
        url: "/learn/strategy/pyodide-314.0.7/pyodide.asm.wasm",
        method: "HEAD",
      },
      response,
      () => unknown++,
    );
    expect(headers["Content-Type"]).toBe("application/wasm");
    expect(Number(headers["Content-Length"])).toBeGreaterThan(9_000_000);
    handler(
      { url: "/learn/strategy/../private.json", method: "GET" },
      response,
      () => unknown++,
    );
    expect(unknown).toBe(1);
  });
});
