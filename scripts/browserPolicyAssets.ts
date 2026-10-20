import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Plugin } from "vite";

interface Options {
  projectRoot?: string;
  runtimeRoot?: string;
}
const runtimeVersion = "314.0.7";
const runtimeNames = [
  "package.json",
  "README.md",
  "pyodide-lock.json",
  "pyodide.mjs",
  "pyodide.mjs.map",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
];
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function inside(root: string, path: string) {
  const target = realpathSync(resolve(root, path)),
    rel = relative(realpathSync(root), target);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("构建来源实际路径越界");
  return readFileSync(target);
}
function validSourcePath(path: string) {
  return (
    /^(scripts\/external\/|vendor\/ebony72-(advanced|mahjong)\/)/.test(path) &&
    !/[\\:]/.test(path) &&
    !/cap8|fanfou/.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

/** Build-time only: fixed source closure + exact NPM runtime bytes. */
export function collectBrowserPolicyAssets(
  options: Options = {},
): Map<string, Uint8Array> {
  const root = resolve(options.projectRoot ?? process.cwd()),
    runtimeRoot = resolve(
      options.runtimeRoot ?? resolve(root, "node_modules/pyodide"),
    );
  const source = JSON.parse(
    readFileSync(resolve(root, "scripts/browserPolicySources.json"), "utf8"),
  ) as { version: number; policy: string; files: Record<string, string> };
  if (
    source.version !== 1 ||
    source.policy !== "ebony72-advanced-public-v1" ||
    !source.files ||
    Object.keys(source.files).length !== 39 ||
    !Object.hasOwn(
      source.files,
      "scripts/external/public_decision_diagnostics.py",
    ) ||
    Object.entries(source.files).some(
      ([path, hash]) => !validSourcePath(path) || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error("浏览器策略闭包版本、路径或摘要无效");
  const pin = JSON.parse(
    inside(root, "vendor/pyodide-runtime/UPSTREAM.json").toString("utf8"),
  ) as {
    version: string;
    sourceUrl: string;
    licenseSha256: string;
    cpython: { version: string; sourceUrl: string; licenseSha256: string };
    additionalNotices: Record<string, string>;
    files: Record<string, { sha256: string }>;
  };
  if (
    pin.version !== runtimeVersion ||
    Object.keys(pin.files).sort().join() !== [...runtimeNames].sort().join()
  )
    throw new Error("固定Pyodide运行时清单无效");
  const assets = new Map<string, Uint8Array>();
  for (const name of runtimeNames) {
    let bytes: Buffer;
    try {
      bytes = inside(runtimeRoot, name);
    } catch {
      throw new Error("缺少本地Pyodide运行时文件：" + name);
    }
    if (sha(bytes) !== pin.files[name].sha256)
      throw new Error("Pyodide运行时字节变化：" + name);
    assets.set(`strategy/pyodide-${runtimeVersion}/${name}`, bytes);
  }
  const license = inside(root, "vendor/pyodide-runtime/LICENSE-MPL-2.0.txt");
  if (sha(license) !== pin.licenseSha256) throw new Error("运行时许可字节变化");
  assets.set(`strategy/pyodide-${runtimeVersion}/LICENSE-MPL-2.0.txt`, license);
  if (pin.cpython.version !== "3.14.2") throw new Error("固定CPython版本无效");
  const pythonLicense = inside(
    root,
    "vendor/pyodide-runtime/LICENSE-CPython-3.14.2.txt",
  );
  if (sha(pythonLicense) !== pin.cpython.licenseSha256)
    throw new Error("CPython许可字节变化");
  assets.set(
    `strategy/pyodide-${runtimeVersion}/LICENSE-CPython-3.14.2.txt`,
    pythonLicense,
  );
  for (const name of ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_SOURCES.json"]) {
    const bytes = inside(root, "vendor/pyodide-runtime/" + name);
    if (sha(bytes) !== pin.additionalNotices[name])
      throw new Error("运行时第三方通知字节变化：" + name);
    assets.set(`strategy/pyodide-${runtimeVersion}/${name}`, bytes);
  }
  const files = Object.entries(source.files).map(([path, expected]) => {
    const bytes = inside(root, path);
    if (sha(bytes) !== expected)
      throw new Error("浏览器Python策略源码字节变化：" + path);
    if (/\/(license(?:\.md)?|LICENSE)$/.test(path))
      assets.set(
        "strategy/advanced-public-v1/" +
          (path.includes("ebony72-advanced")
            ? "LICENSE-advanced.txt"
            : "LICENSE-initial.txt"),
        bytes,
      );
    return { path, base64: bytes.toString("base64"), sha256: expected };
  });
  assets.set(
    "strategy/advanced-public-v1/payload.json",
    Buffer.from(JSON.stringify({ files, sourceFiles: files.length }) + "\n"),
  );
  assets.set(
    `strategy/pyodide-${runtimeVersion}/NOTICE.txt`,
    Buffer.from(
      `Pyodide ${runtimeVersion}, unmodified local NPM runtime files.\nLicense: MPL-2.0; see LICENSE-MPL-2.0.txt.\nSource: ${pin.sourceUrl}\nIncludes CPython ${pin.cpython.version}, built with Pyodide patches; see LICENSE-CPython-3.14.2.txt.\nCPython upstream source: ${pin.cpython.sourceUrl}\nBundled component and toolchain notices: THIRD_PARTY_NOTICES.txt; exact sources and limits: THIRD_PARTY_SOURCES.json.\nPython strategy sources retain their original MIT notices in the policy payload and separate LICENSE files.\n`,
    ),
  );
  assets.set(
    "strategy/manifest.json",
    Buffer.from(
      JSON.stringify(
        {
          version: 1,
          runtimeVersion,
          policy: source.policy,
          sourceFiles: source.files,
          assets: Object.fromEntries(
            [...assets].map(([path, bytes]) => [path, sha(bytes)]),
          ),
        },
        null,
        2,
      ) + "\n",
    ),
  );
  return assets;
}
function contentType(path: string) {
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json") || path.endsWith(".map"))
    return "application/json; charset=utf-8";
  if (path.endsWith(".zip")) return "application/zip";
  return "text/plain; charset=utf-8";
}
export function browserPolicyAssetsPlugin(options: Options = {}): Plugin {
  const assets = collectBrowserPolicyAssets(options);
  return {
    name: "xuezhan-local-browser-policy",
    configureServer(server) {
      const base = new URL(server.config.base, "http://localhost/").pathname;
      server.middlewares.use((request, response, next) => {
        if (!request.url) return next();
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (!pathname.startsWith(base)) return next();
        const path = pathname.slice(base.length),
          bytes = assets.get(path);
        if (!bytes) return next();
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end();
          return;
        }
        response.setHeader("Content-Type", contentType(path));
        response.setHeader("Content-Length", String(bytes.byteLength));
        response.setHeader("Cache-Control", "no-store");
        response.end(
          request.method === "HEAD" ? undefined : Buffer.from(bytes),
        );
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets)
        this.emitFile({ type: "asset", fileName, source });
    },
  };
}
