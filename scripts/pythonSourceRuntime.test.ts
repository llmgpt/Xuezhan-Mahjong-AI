import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertPythonSourceCacheAbsent,
  PYTHON_SOURCE_CACHE_DIRECTORY,
  pythonSourceArguments,
  pythonSourceCachePrefix,
} from "./pythonSourceRuntime";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "xuezhan source cache "));
  directories.push(root);
  return { root, worker: join(root, "scripts", "external") };
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("Python源码与受控无缓存启动合同", () => {
  it("从策略根目录确定绝对路径，并把有空格的路径保留为一个参数", () => {
    const { root, worker } = fixture();
    const prefix = resolve(root, PYTHON_SOURCE_CACHE_DIRECTORY);
    expect(pythonSourceCachePrefix(worker)).toBe(prefix);
    expect(pythonSourceArguments(worker)).toEqual([
      "-B",
      "-X",
      `pycache_prefix=${prefix}`,
    ]);
    expect(() => assertPythonSourceCacheAbsent(prefix)).not.toThrow();
  });

  it.each(["file", "directory"])(
    "已有%s不能被当作空缓存位置，也不能自动删除",
    (kind) => {
      const { root, worker } = fixture();
      const prefix = join(root, PYTHON_SOURCE_CACHE_DIRECTORY);
      if (kind === "file") writeFileSync(prefix, "owned fixture");
      else mkdirSync(prefix);
      expect(() => pythonSourceArguments(worker)).toThrow(/缓存|cache/);
      expect(() => assertPythonSourceCacheAbsent(prefix)).toThrow(/缓存|cache/);
    },
  );
});
