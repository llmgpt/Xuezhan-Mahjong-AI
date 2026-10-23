import { describe, expect, it } from "vitest";
import { captureFormalRuntime } from "./formalRuntime";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PYTHON_SOURCE_CACHE_DIRECTORY } from "./pythonSourceRuntime";

function pythonInfo(numpy = false) {
  return {
    python: {
      executable: "C:/Runtime/python.exe",
      realPath: "C:/Runtime/python.exe",
      sha256: "a".repeat(64),
      version: "3.13.5",
      implementation: "CPython",
      platform: "win32",
      machine: "AMD64",
      cacheTag: "cpython-313",
      sourceCache: {
        policy: "empty-prefix-no-bytecode-v1",
        prefix: join(
          tmpdir(),
          "xuezhan-mock-formal-runtime",
          PYTHON_SOURCE_CACHE_DIRECTORY,
        ),
      },
      flags: {
        debug: 0,
        optimize: 0,
        noSite: 0,
        noUserSite: 1,
        isolated: 0,
        ignoreEnvironment: 0,
        utf8Mode: 1,
        dontWriteBytecode: 1,
      },
    },
    loadedModules: {
      "python-base/Lib/json/__init__.py": "b".repeat(64),
      "policy/scripts/external/worker.py": "c".repeat(64),
    } as Record<string, string>,
    ...(numpy
      ? {
          numpy: {
            version: "2.1.3",
            recordSha256: "d".repeat(64),
            installationRoot: "C:/Runtime/Lib/site-packages",
            modulePath: "C:/Runtime/Lib/site-packages/numpy/__init__.py",
            files: {
              "numpy/__init__.py": "e".repeat(64),
              "numpy.libs/library.dll": "f".repeat(64),
            } as Record<string, string>,
          },
        }
      : {}),
  };
}

describe("正式运行环境的实际文件闭包", () => {
  it("没有受控源码缓存合同的旧报告不能用于新正式冻结", async () => {
    const report = pythonInfo();
    Reflect.deleteProperty(report.python, "sourceCache");
    await expect(
      captureFormalRuntime(
        { policies: ["teacher-v1"], lineups: ["ebony-initial"] },
        () => JSON.stringify(report),
      ),
    ).rejects.toThrow(/源码|缓存|运行时/);
  });

  it("Python探针在导入worker之前验证启动时的缓存读取合同", async () => {
    await captureFormalRuntime(
      { policies: ["teacher-v1"], lineups: ["ebony-initial"] },
      (source) => {
        const check = source.indexOf("sys.pycache_prefix");
        expect(check).toBeGreaterThanOrEqual(0);
        expect(check).toBeLessThan(source.indexOf("import worker"));
        return JSON.stringify(pythonInfo());
      },
    );
  });

  it("缓存模式、绝对位置和禁止写入标记均必须有效", async () => {
    const wrongPolicy = pythonInfo();
    wrongPolicy.python.sourceCache.policy = "uncontrolled";
    const relative = pythonInfo();
    relative.python.sourceCache.prefix = PYTHON_SOURCE_CACHE_DIRECTORY;
    const wrongDirectory = pythonInfo();
    wrongDirectory.python.sourceCache.prefix = join(tmpdir(), "other-cache");
    const writable = pythonInfo();
    writable.python.flags.dontWriteBytecode = 0;
    for (const report of [wrongPolicy, relative, wrongDirectory, writable])
      await expect(
        captureFormalRuntime(
          { policies: ["teacher-v1"], lineups: ["ebony-initial"] },
          () => JSON.stringify(report),
        ),
      ).rejects.toThrow(/运行时|缓存/);
  });

  it("旧参考不加载NumPy，捕获实际Node二进制和所选环境值且不改环境", async () => {
    const before = process.env.PYTHONNOUSERSITE;
    const report = await captureFormalRuntime(
      { policies: ["teacher-v1"], lineups: ["ebony-initial"] },
      (source) => {
        expect(source).not.toContain("import numpy");
        expect(source).not.toContain("import fanfou_policy");
        expect(source).not.toContain("import v1_income_policy");
        expect(source).not.toContain("import ready_income_policy");
        return JSON.stringify(pythonInfo());
      },
    );
    expect(report.versions).toEqual({
      node: process.version,
      python: "3.13.5",
    });
    expect(report.node.executable).toBe(process.execPath);
    expect(report.node.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.numpy).toBeUndefined();
    expect(Object.keys(report.environment).sort()).toEqual(
      [
        "MKL_NUM_THREADS",
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "PYTHONHASHSEED",
        "PYTHONNOUSERSITE",
        "STRENGTH_PYTHON",
      ].sort(),
    );
    expect(process.env.PYTHONNOUSERSITE).toBe(before);
  });

  it.each([
    { policies: ["fanfou-ba-composite-v1"], lineups: ["teacher-v1"] },
    { policies: ["teacher-v1"], lineups: ["fanfou-ba", "ebony-advanced"] },
  ])("BA在受评或对手中都必须记录完整安装文件而不只版本", async (config) => {
    const report = await captureFormalRuntime(config, (source) => {
      expect(source).toContain("import numpy");
      expect(source).toContain("import fanfou_policy");
      return JSON.stringify(pythonInfo(true));
    });
    expect(report.versions.numpy).toBe("2.1.3");
    expect(report.numpy?.files["numpy.libs/library.dll"]).toBe("f".repeat(64));
    expect(report.loadedModules["policy/scripts/external/worker.py"]).toBe(
      "c".repeat(64),
    );
  });

  it.each([
    {
      policy: "candidate-advanced-income-v7",
      module: "v1_income_policy",
    },
    {
      policy: "candidate-advanced-ready-income-v8",
      module: "ready_income_policy",
    },
    {
      policy: "candidate-advanced-ron-continuation-v9",
      module: "ready_income_policy",
    },
    {
      policy: "candidate-advanced-accept-ron-v10",
      module: "ready_income_policy",
    },
  ])(
    "金额候选 $policy 的实际加载路径必须进入运行时探针",
    async ({ policy, module }) => {
      await captureFormalRuntime(
        { policies: [policy], lineups: ["ui-bots"] },
        (source) => {
          const imports = source.indexOf(`import ${module}\n`);
          const load = source.indexOf(`${module}.load_policy()`);
          const collect = source.indexOf("modules = {}");
          expect(imports).toBeGreaterThanOrEqual(0);
          expect(load).toBeGreaterThan(imports);
          expect(load).toBeLessThan(collect);
          return JSON.stringify(pythonInfo());
        },
      );
    },
  );

  it("相同版本的Python二进制或NumPy文件变化仍留在冻结记录中", async () => {
    const config = { policies: ["teacher-v1"], lineups: ["fanfou-ba"] };
    const first = await captureFormalRuntime(config, () =>
      JSON.stringify(pythonInfo(true)),
    );
    const changed = pythonInfo(true);
    changed.python.sha256 = "1".repeat(64);
    changed.numpy!.files["numpy/__init__.py"] = "2".repeat(64);
    const second = await captureFormalRuntime(config, () =>
      JSON.stringify(changed),
    );
    expect(first.versions).toEqual(second.versions);
    expect(first.python.sha256).not.toBe(second.python.sha256);
    expect(first.numpy?.files).not.toEqual(second.numpy?.files);
  });

  it("依赖缺失、错误NumPy版本、越界文件或不完整摘要显式失败", async () => {
    const config = { policies: ["teacher-v1"], lineups: ["fanfou-ba"] };
    await expect(
      captureFormalRuntime(config, () => {
        throw new Error("numpy unavailable");
      }),
    ).rejects.toThrow("numpy unavailable");
    const version = pythonInfo(true);
    version.numpy!.version = "9.0.0";
    const path = pythonInfo(true);
    path.numpy!.files["numpy/../../private"] = "a".repeat(64);
    const module = pythonInfo(true);
    module.loadedModules["policy/../../private"] = "a".repeat(64);
    const hash = pythonInfo(true);
    hash.python.sha256 = "bad";
    for (const info of [version, path, module, hash, pythonInfo(false)])
      await expect(
        captureFormalRuntime(config, () => JSON.stringify(info)),
      ).rejects.toThrow(/NumPy|numpy|摘要|路径|运行时/);
  });

  it("运行时投影不能夹带额外元数据或漏报有效解释器标记", async () => {
    const config = { policies: ["teacher-v1"], lineups: ["fanfou-ba"] };
    const extra = pythonInfo(true);
    Object.assign(extra.python, {
      unrequestedEnvironment: {
        personal: "not part of the allowed projection",
      },
    });
    const incomplete = pythonInfo(true);
    Reflect.deleteProperty(incomplete.python.flags, "dontWriteBytecode");
    for (const value of [extra, incomplete])
      await expect(
        captureFormalRuntime(config, () => JSON.stringify(value)),
      ).rejects.toThrow(/运行时|字段|标记/);
  });
});
