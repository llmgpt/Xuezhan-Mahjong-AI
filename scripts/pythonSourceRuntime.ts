import { lstatSync } from "node:fs";
import { resolve } from "node:path";

export const PYTHON_SOURCE_CACHE_DIRECTORY = ".source-only-pycache-v1";

export function pythonSourceCachePrefix(workerDirectory: string): string {
  return resolve(workerDirectory, "../..", PYTHON_SOURCE_CACHE_DIRECTORY);
}

export function assertPythonSourceCacheAbsent(prefix: string): void {
  try {
    lstatSync(prefix);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Python源码缓存位置必须始终不存在：${prefix}`);
}

export function pythonSourceArguments(workerDirectory: string): string[] {
  const prefix = pythonSourceCachePrefix(workerDirectory);
  assertPythonSourceCacheAbsent(prefix);
  // -B alone forbids writes but can still read an old timestamp .pyc. An
  // absent, explicitly selected prefix bypasses source-tree caches at startup.
  return ["-B", "-X", `pycache_prefix=${prefix}`];
}
