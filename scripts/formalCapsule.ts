import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  independentSourceFingerprint,
  type IndependentConfig,
} from "./independentBenchmark";
import { formalPlanHash, parseFormalScientificPlan } from "./formalProtocol";
import { captureFormalRuntime, type FormalRuntime } from "./formalRuntime";

interface CapsuleOptions {
  directory: string;
  entryPath: string;
}
interface CapsuleServices {
  sourceFingerprint: () => Record<string, string>;
  captureRuntime: (
    config: Pick<IndependentConfig, "policies" | "lineups">,
  ) => Promise<FormalRuntime>;
}
interface BuildDescriptor {
  version: 1;
  entry: "scripts/evaluate-formal.mjs";
  sourceFingerprint: Record<string, string>;
  inputs: Record<string, string>;
  bundleSha256: string;
  compiler: { name: "esbuild"; version: string };
}
interface FormalSeal {
  version: 1;
  planHash: string;
  scienceSha256: string;
  buildSha256: string;
  runtime: FormalRuntime;
  sealedAtUtc: string;
}
const services: CapsuleServices = {
  sourceFingerprint: independentSourceFingerprint,
  captureRuntime: captureFormalRuntime,
};
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const digestValid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const safeRelative = (value: string) =>
  value.length > 0 &&
  !/[\\:]/.test(value) &&
  !isAbsolute(value) &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
function exact(actual: unknown, expected: unknown, message: string) {
  if (canonical(actual) !== canonical(expected)) throw new Error(message);
}
function fields(
  value: unknown,
  names: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...names].sort().join(",")
  )
    throw new Error(label + "含缺失或未知字段");
}
function map(
  value: unknown,
  label: string,
): asserts value is Record<string, string> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.keys(value).length ||
    Object.entries(value).some(
      ([path, h]) => !safeRelative(path) || !digestValid(h),
    )
  )
    throw new Error(label + "无效或路径越界");
}
function sourcePath(root: string, path: string) {
  if (!safeRelative(path)) throw new Error("源码/构建路径越界");
  const actual = realpathSync(resolve(root, path)),
    rel = relative(realpathSync(root), actual);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("源码/构建实际路径越界");
  return actual;
}
function durableExclusive(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp";
  const fd = openSync(temporary, "wx");
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
  } finally {
    unlinkSync(temporary);
  }
}
function inputs(options: CapsuleOptions, deps: CapsuleServices) {
  const root = resolve(options.directory);
  if (
    resolve(options.entryPath) !== resolve(root, "scripts/evaluate-formal.mjs")
  )
    throw new Error("必须从本capsule固定编译入口执行");
  const sciencePath = join(root, "science.json"),
    buildPath = join(root, "build.json");
  const plan = parseFormalScientificPlan(
    JSON.parse(readFileSync(sciencePath, "utf8")),
  );
  const raw: unknown = JSON.parse(readFileSync(buildPath, "utf8"));
  fields(
    raw,
    [
      "version",
      "entry",
      "sourceFingerprint",
      "inputs",
      "bundleSha256",
      "compiler",
    ],
    "构建清单",
  );
  if (
    raw.version !== 1 ||
    raw.entry !== "scripts/evaluate-formal.mjs" ||
    !digestValid(raw.bundleSha256)
  )
    throw new Error("构建版本或产物摘要无效");
  map(raw.sourceFingerprint, "构建源码指纹");
  map(raw.inputs, "构建输入");
  fields(raw.compiler, ["name", "version"], "构建编译器");
  if (
    raw.compiler.name !== "esbuild" ||
    typeof raw.compiler.version !== "string" ||
    !raw.compiler.version
  )
    throw new Error("构建编译器记录无效");
  const build = raw as unknown as BuildDescriptor;
  exact(
    build.sourceFingerprint,
    plan.sourceFingerprint,
    "构建源码与科学配置不符",
  );
  const checkSource = () => {
    exact(
      deps.sourceFingerprint(),
      plan.sourceFingerprint,
      "执行源码指纹与科学配置不符",
    );
    for (const [path, expected] of Object.entries(plan.sourceFingerprint))
      if (hash(sourcePath(root, path)) !== expected)
        throw new Error("冻结源码字节发生变化：" + path);
    for (const [path, expected] of Object.entries(build.inputs)) {
      if (
        plan.sourceFingerprint[path] !== expected ||
        hash(sourcePath(root, path)) !== expected
      )
        throw new Error("构建输入不属于冻结源：" + path);
    }
    if (!Object.hasOwn(build.inputs, "scripts/evaluate-formal.ts"))
      throw new Error("构建输入缺少固定入口");
    if (hash(sourcePath(root, build.entry)) !== build.bundleSha256)
      throw new Error("编译产物字节发生变化");
  };
  checkSource();
  return { root, plan, build, checkSource, sciencePath, buildPath };
}

/** No seeds are chosen here. CLI callers always use the real default services. */
export async function sealFormalCapsule(
  options: CapsuleOptions,
  deps: CapsuleServices = services,
): Promise<FormalSeal> {
  const target = join(resolve(options.directory), "seal.json");
  if (existsSync(target)) throw new Error("封存记录已存在，禁止覆盖");
  const prepared = inputs(options, deps),
    scienceSha256 = hash(prepared.sciencePath),
    buildSha256 = hash(prepared.buildPath);
  const runtime = await deps.captureRuntime(prepared.plan.config);
  exact(
    runtime.versions,
    prepared.plan.runtime,
    "实际运行时版本与科学配置不符",
  );
  prepared.checkSource();
  if (
    hash(prepared.sciencePath) !== scienceSha256 ||
    hash(prepared.buildPath) !== buildSha256
  )
    throw new Error("封存期间科学/构建记录发生变化");
  const seal: FormalSeal = {
    version: 1,
    planHash: formalPlanHash(prepared.plan),
    scienceSha256,
    buildSha256,
    runtime,
    sealedAtUtc: new Date().toISOString(),
  };
  durableExclusive(target, seal);
  return structuredClone(seal);
}

/** Verifies files and current runtime, without replacing or repairing any evidence. */
export async function verifyFormalCapsule(
  options: CapsuleOptions,
  deps: CapsuleServices = services,
) {
  const prepared = inputs(options, deps),
    sealPath = join(prepared.root, "seal.json"),
    sealSha256 = hash(sealPath);
  const raw: unknown = JSON.parse(readFileSync(sealPath, "utf8"));
  fields(
    raw,
    [
      "version",
      "planHash",
      "scienceSha256",
      "buildSha256",
      "runtime",
      "sealedAtUtc",
    ],
    "封存记录",
  );
  const seal = raw as unknown as FormalSeal;
  if (
    seal.version !== 1 ||
    !digestValid(seal.planHash) ||
    !digestValid(seal.scienceSha256) ||
    !digestValid(seal.buildSha256) ||
    typeof seal.sealedAtUtc !== "string" ||
    !seal.sealedAtUtc.endsWith("Z") ||
    !Number.isFinite(Date.parse(seal.sealedAtUtc))
  )
    throw new Error("封存身份或时间无效");
  if (
    seal.planHash !== formalPlanHash(prepared.plan) ||
    seal.scienceSha256 !== hash(prepared.sciencePath) ||
    seal.buildSha256 !== hash(prepared.buildPath)
  )
    throw new Error("科学配置/构建清单与原封存记录不符");
  const runtime = await deps.captureRuntime(prepared.plan.config);
  exact(runtime, seal.runtime, "当前完整运行时与封存不符");
  exact(runtime.versions, prepared.plan.runtime, "科学配置运行时版本不符");
  prepared.checkSource();
  if (
    hash(sealPath) !== sealSha256 ||
    hash(prepared.sciencePath) !== seal.scienceSha256 ||
    hash(prepared.buildPath) !== seal.buildSha256
  )
    throw new Error("核验期间封存/科学/构建记录变化");
  return { plan: prepared.plan, build: prepared.build, seal, sealSha256 };
}
