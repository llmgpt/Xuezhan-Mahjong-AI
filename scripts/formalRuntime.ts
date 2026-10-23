import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, isAbsolute } from "node:path";
import type { IndependentConfig } from "./independentBenchmark";
import { INDEPENDENT_POLICY_IDS, resolveLineup } from "./independentPolicies";
import {
  assertPythonSourceCacheAbsent,
  PYTHON_SOURCE_CACHE_DIRECTORY,
  pythonSourceArguments,
  pythonSourceCachePrefix,
} from "./pythonSourceRuntime";

interface PythonRuntime {
  executable: string;
  realPath: string;
  sha256: string;
  version: string;
  implementation: string;
  platform: string;
  machine: string;
  cacheTag: string;
  sourceCache: { policy: "empty-prefix-no-bytecode-v1"; prefix: string };
  flags: Record<string, number>;
}
interface NumpyRuntime {
  version: string;
  recordSha256: string;
  installationRoot: string;
  modulePath: string;
  files: Record<string, string>;
}
export interface FormalRuntime {
  versions: { node: string; python: string; numpy?: string };
  node: {
    executable: string;
    realPath: string;
    sha256: string;
    version: string;
    platform: string;
    arch: string;
    execArgv: string[];
  };
  python: PythonRuntime;
  numpy?: NumpyRuntime;
  loadedModules: Record<string, string>;
  environment: Record<string, string | null>;
  limitation: string;
}

const ENVIRONMENT = [
  "STRENGTH_PYTHON",
  "PYTHONHASHSEED",
  "PYTHONNOUSERSITE",
  "OMP_NUM_THREADS",
  "OPENBLAS_NUM_THREADS",
  "MKL_NUM_THREADS",
] as const;

function pythonSource(
  advanced: boolean,
  numpy: boolean,
  cap8: boolean,
  income: boolean,
  readyIncome: boolean,
): string {
  return `
import hashlib, json, pathlib, platform, sys, sysconfig

def digest(path):
    with pathlib.Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

worker_directory = pathlib.Path(sys.argv[1]).resolve()
policy_root = worker_directory.parents[1]
cache_prefix = policy_root / ${JSON.stringify(PYTHON_SOURCE_CACHE_DIRECTORY)}
if sys.flags.dont_write_bytecode != 1 or sys.pycache_prefix is None or pathlib.Path(sys.pycache_prefix).resolve() != cache_prefix:
    raise RuntimeError('Python源码缓存启动合同无效: require -B and controlled pycache_prefix')
if cache_prefix.exists() or cache_prefix.is_symlink():
    raise RuntimeError('Python源码缓存位置必须不存在')
sys.path.insert(0, str(worker_directory))
import worker
if pathlib.Path(worker.__file__).resolve() != worker_directory / 'worker.py':
    raise RuntimeError('Worker resolved outside the frozen policy root')
${advanced ? "import advanced_policy\nadvanced_policy.load_policy()" : ""}
${cap8 ? "import cap8_policy\ncap8_policy.load_policy()" : ""}
${income ? "import v1_income_policy\nv1_income_policy.load_policy()" : ""}
${readyIncome ? "import ready_income_policy\nready_income_policy.load_policy()" : ""}
${
  numpy
    ? `
import importlib.metadata
import numpy
import fanfou_policy
fanfou_policy.load_runtime()
if numpy.__version__ != '2.1.3':
    raise RuntimeError('Fanfou requires numpy==2.1.3')
distribution = importlib.metadata.distribution('numpy')
installation_root = pathlib.Path(distribution.locate_file('')).resolve()
numpy_root = (installation_root / 'numpy').resolve()
libraries_root = (installation_root / 'numpy.libs').resolve()
module_path = pathlib.Path(numpy.__file__).resolve()
if not module_path.is_relative_to(numpy_root):
    raise RuntimeError('NumPy import and distribution metadata disagree')
owned_files = list(distribution.files or [])
record_files = [entry for entry in owned_files if entry.as_posix().startswith('numpy-') and entry.as_posix().endswith('.dist-info/RECORD')]
if len(record_files) != 1:
    raise RuntimeError('NumPy installation lacks one verifiable RECORD')
files = {}
for entry in owned_files:
    name = entry.as_posix()
    if not name.startswith(('numpy/', 'numpy.libs/')) or '__pycache__' in name.split('/'):
        continue
    path = pathlib.Path(distribution.locate_file(entry)).resolve()
    if not any(path.is_relative_to(root) for root in (numpy_root, libraries_root)) or not path.is_file():
        raise RuntimeError('NumPy dependency escapes its package or is missing: ' + name)
    files[name] = digest(path)
if not files:
    raise RuntimeError('NumPy file closure is empty')
numpy_info = {'version': numpy.__version__, 'recordSha256': digest(distribution.locate_file(record_files[0])), 'installationRoot': str(installation_root), 'modulePath': str(module_path), 'files': files}
`
    : ""
}
roots = [('policy', policy_root), ('python-base', pathlib.Path(sys.base_prefix).resolve()), ('python-env', pathlib.Path(sys.prefix).resolve())]
modules = {}
for module in list(sys.modules.values()):
    filename = getattr(module, '__file__', None)
    if not filename:
        continue
    path = pathlib.Path(filename).resolve()
    if not path.is_file():
        continue
    for label, root in roots:
        if path.is_relative_to(root):
            modules[label + '/' + path.relative_to(root).as_posix()] = digest(path)
            break
    else:
        raise RuntimeError('A loaded runtime module has an untracked origin')
core_names = {sysconfig.get_config_var('LDLIBRARY'), 'python3.dll', 'python' + str(sys.version_info.major) + str(sys.version_info.minor) + '.dll'}
core_directories = {pathlib.Path(sys.executable).resolve().parent, pathlib.Path(sys.base_prefix).resolve(), pathlib.Path(sys.base_prefix).resolve() / 'DLLs', pathlib.Path(sysconfig.get_config_var('LIBDIR') or sys.base_prefix).resolve()}
for name in core_names:
    if not isinstance(name, str) or pathlib.Path(name).name != name:
        continue
    for directory in core_directories:
        path = (directory / name).resolve()
        if not path.is_file():
            continue
        for label, root in roots:
            if path.is_relative_to(root):
                modules[label + '/' + path.relative_to(root).as_posix()] = digest(path)
                break
        else:
            raise RuntimeError('Interpreter library has an untracked origin')
if cache_prefix.exists() or cache_prefix.is_symlink():
    raise RuntimeError('Python源码缓存位置在探针期间改变')
result = {'python': {'executable': sys.executable, 'realPath': str(pathlib.Path(sys.executable).resolve()), 'sha256': digest(sys.executable), 'version': platform.python_version(), 'implementation': platform.python_implementation(), 'platform': sys.platform, 'machine': platform.machine(), 'cacheTag': sys.implementation.cache_tag, 'sourceCache': {'policy': 'empty-prefix-no-bytecode-v1', 'prefix': str(cache_prefix)}, 'flags': {'debug': sys.flags.debug, 'optimize': sys.flags.optimize, 'noSite': sys.flags.no_site, 'noUserSite': sys.flags.no_user_site, 'isolated': sys.flags.isolated, 'ignoreEnvironment': sys.flags.ignore_environment, 'utf8Mode': sys.flags.utf8_mode, 'dontWriteBytecode': sys.flags.dont_write_bytecode}}, 'loadedModules': modules${numpy ? ", 'numpy': numpy_info" : ""}}
print(json.dumps(result, sort_keys=True, allow_nan=False))
`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactFields(value: unknown, names: string[]): boolean {
  return (
    object(value) &&
    Object.keys(value).sort().join(",") === [...names].sort().join(",")
  );
}
function hashMap(
  value: unknown,
  prefixes: string[],
): value is Record<string, string> {
  return (
    object(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
      ([name, hash]) =>
        prefixes.some((prefix) => name.startsWith(prefix)) &&
        !/[\\:]/.test(name) &&
        name
          .split("/")
          .every((part) => part && part !== "." && part !== "..") &&
        typeof hash === "string" &&
        /^[a-f0-9]{64}$/.test(hash),
    )
  );
}
async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Read-only capture. The optional query is a unit-test seam, never a CLI flag. */
export async function captureFormalRuntime(
  config: Pick<IndependentConfig, "policies" | "lineups">,
  queryPython: (source: string) => string = (source) => {
    const directory = fileURLToPath(new URL("./external/", import.meta.url));
    const result = execFileSync(
      process.env.STRENGTH_PYTHON ?? "python",
      [...pythonSourceArguments(directory), "-c", source, directory],
      {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    assertPythonSourceCacheAbsent(pythonSourceCachePrefix(directory));
    return result;
  },
): Promise<FormalRuntime> {
  if (
    !config.policies.length ||
    !config.lineups.length ||
    config.policies.some(
      (name) =>
        !INDEPENDENT_POLICY_IDS.includes(
          name as (typeof INDEPENDENT_POLICY_IDS)[number],
        ),
    )
  )
    throw new Error("未知正式运行时策略配置");
  const policies = [
    ...config.policies,
    ...config.lineups.flatMap((name) => [...resolveLineup(name)]),
  ];
  const numpy = policies.includes("fanfou-ba-composite-v1");
  const advanced = policies.some(
    (name) =>
      name === "ebony72-advanced-public-v1" ||
      name.startsWith("candidate-advanced-"),
  );
  const raw: unknown = JSON.parse(
    queryPython(
      pythonSource(
        advanced,
        numpy,
        policies.includes("candidate-advanced-cap8-v6"),
        policies.includes("candidate-advanced-income-v7"),
        policies.some(
          (name) =>
            name === "candidate-advanced-ready-income-v8" ||
            name === "candidate-advanced-ron-continuation-v9" ||
            name === "candidate-advanced-accept-ron-v10",
        ),
      ),
    ),
  );
  if (
    !object(raw) ||
    Object.keys(raw).some(
      (name) =>
        !["python", "loadedModules", ...(numpy ? ["numpy"] : [])].includes(
          name,
        ),
    ) ||
    !object(raw.python)
  )
    throw new Error("Python运行时投影无效");
  const python = raw.python as unknown as PythonRuntime;
  if (
    !exactFields(python, [
      "executable",
      "realPath",
      "sha256",
      "version",
      "implementation",
      "platform",
      "machine",
      "cacheTag",
      "sourceCache",
      "flags",
    ]) ||
    [
      python.executable,
      python.realPath,
      python.version,
      python.implementation,
      python.platform,
      python.machine,
      python.cacheTag,
    ].some((value) => typeof value !== "string" || !value) ||
    !/^[a-f0-9]{64}$/.test(python.sha256) ||
    !exactFields(python.flags, [
      "debug",
      "optimize",
      "noSite",
      "noUserSite",
      "isolated",
      "ignoreEnvironment",
      "utf8Mode",
      "dontWriteBytecode",
    ]) ||
    Object.values(python.flags).some((value) => !Number.isSafeInteger(value)) ||
    python.flags.dontWriteBytecode !== 1 ||
    !exactFields(python.sourceCache, ["policy", "prefix"]) ||
    python.sourceCache.policy !== "empty-prefix-no-bytecode-v1" ||
    typeof python.sourceCache.prefix !== "string" ||
    !isAbsolute(python.sourceCache.prefix) ||
    basename(python.sourceCache.prefix) !== PYTHON_SOURCE_CACHE_DIRECTORY ||
    !hashMap(raw.loadedModules, ["policy/", "python-base/", "python-env/"])
  )
    throw new Error("Python运行时路径或摘要无效");
  assertPythonSourceCacheAbsent(python.sourceCache.prefix);
  let numpyInfo: NumpyRuntime | undefined;
  if (numpy) {
    if (!object(raw.numpy)) throw new Error("缺少NumPy运行时闭包");
    numpyInfo = raw.numpy as unknown as NumpyRuntime;
    if (
      !exactFields(numpyInfo, [
        "version",
        "recordSha256",
        "installationRoot",
        "modulePath",
        "files",
      ]) ||
      numpyInfo.version !== "2.1.3" ||
      !/^[a-f0-9]{64}$/.test(numpyInfo.recordSha256) ||
      typeof numpyInfo.installationRoot !== "string" ||
      !numpyInfo.installationRoot ||
      typeof numpyInfo.modulePath !== "string" ||
      !numpyInfo.modulePath ||
      !hashMap(numpyInfo.files, ["numpy/", "numpy.libs/"])
    )
      throw new Error("NumPy运行时版本、路径或摘要无效");
  }
  const realPath = realpathSync(process.execPath);
  const nodeSha256 = await hashFile(realPath);
  assertPythonSourceCacheAbsent(python.sourceCache.prefix);
  return {
    versions: {
      node: process.version,
      python: python.version,
      ...(numpyInfo ? { numpy: numpyInfo.version } : {}),
    },
    node: {
      executable: process.execPath,
      realPath,
      sha256: nodeSha256,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      execArgv: [...process.execArgv],
    },
    python: structuredClone(python),
    ...(numpyInfo ? { numpy: structuredClone(numpyInfo) } : {}),
    loadedModules: structuredClone(raw.loadedModules as Record<string, string>),
    environment: Object.fromEntries(
      ENVIRONMENT.map((name) => [name, process.env[name] ?? null]),
    ),
    limitation:
      "Source-tree bytecode caches are bypassed with -B and an absent controlled startup prefix. Pins executables, discoverable interpreter libraries, probe-loaded Python modules and NumPy-owned files; operating-system libraries, zip/sourceless imports and unimported dependencies are outside this closure.",
  };
}
