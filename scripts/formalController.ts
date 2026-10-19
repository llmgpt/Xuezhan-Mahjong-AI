import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_RULES } from "../src/game/game";
import { verifyFormalCapsule } from "./formalCapsule";
import { inspectFormalJournal } from "./formalJournal";
import {
  formalPlanHash,
  reserveFormalSeeds,
  summarizeFormalStatistics,
  verifyFormalReservation,
} from "./formalProtocol";
import { adoptJournaledSeed, executeJournaledSeed } from "./journaledSeed";
import type { IndependentRecord } from "./independentEvaluation";

type Capsule = Pick<
  Awaited<ReturnType<typeof verifyFormalCapsule>>,
  "plan" | "sealSha256"
>;
type SeedRequest = Parameters<typeof executeJournaledSeed>[0];
type Receipt = Awaited<ReturnType<typeof executeJournaledSeed>>;
export interface FormalControllerServices {
  verifyCapsule: () => Promise<Capsule>;
  execute: typeof executeJournaledSeed;
  adopt: typeof adoptJournaledSeed;
}
interface RunManifest {
  version: 1;
  planHash: string;
  sealSha256: string;
  ledgerPath: string;
  projectRoot: string;
  ledgerSnapshotSha256: string;
  seeds: number[];
  shards: { id: number; seeds: number[] }[];
  reservation: ReturnType<typeof verifyFormalReservation>["reservation"];
  createdAtUtc: string;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const hash = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
function exact(a: unknown, b: unknown, message: string) {
  if (canonical(a) !== canonical(b)) throw new Error(message);
}
function fields(
  v: unknown,
  names: string[],
  label: string,
): asserts v is Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).sort().join(",") !== [...names].sort().join(",")
  )
    throw new Error(label + "含缺失或未知字段");
}
function exclusive(path: string, value: unknown) {
  const tmp = path + "." + randomUUID() + ".tmp",
    fd = openSync(tmp, "wx");
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, path);
  } finally {
    unlinkSync(tmp);
  }
}
async function replaceOwned(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp",
    fd = openSync(temporary, "wx");
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Windows scanners may briefly deny replacement of a recently read file.
  // Retry only this already-fsynced byte commit, before any strategy starts.
  const waits = [10, 25, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      if (
        attempt === waits.length ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      await delay(waits[attempt]);
    }
  }
}
function partition(seeds: readonly number[], count: number) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 8 ||
    count > seeds.length
  )
    throw new Error("正式分片数必须1..8且非空");
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    seeds: seeds.filter((_, i) => i % count === index),
  }));
}
function inside(root: string, path: string) {
  const r = relative(realpathSync(root), realpathSync(path));
  if (r.startsWith("..") || isAbsolute(r)) throw new Error("历史来源路径越界");
}
function verifyHistory(ledgerPath: string, projectRoot: string) {
  const ledger = read(ledgerPath) as { imports?: unknown };
  if (!Array.isArray(ledger.imports) || !ledger.imports.length)
    throw new Error("历史来源尚未有效导入");
  for (const item of ledger.imports) {
    fields(item, ["source", "sha256"], "历史来源");
    if (
      typeof item.source !== "string" ||
      !item.source ||
      /[\\:]/.test(item.source) ||
      isAbsolute(item.source) ||
      item.source.split("/").some((v) => !v || v === "." || v === "..") ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error("历史来源格式或路径无效");
    const path = resolve(projectRoot, item.source);
    inside(projectRoot, path);
    if (hash(path) !== item.sha256)
      throw new Error("历史来源原始哈希变化：" + item.source);
  }
}
class BusyError extends Error {}
class InputError extends Error {}
function lock(path: string, runSha256: string) {
  if (existsSync(path)) {
    const saved = read(path) as { pid?: number };
    if (!Number.isSafeInteger(saved.pid) || saved.pid! < 1)
      throw new Error("正式分片锁损坏");
    try {
      process.kill(saved.pid!, 0);
      throw new BusyError("正式分片仍被存活进程占用");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    unlinkSync(path);
  }
  const fd = openSync(path, "wx");
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, runSha256 }) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return () => unlinkSync(path);
}
async function assertNoFailedTraces(path: string) {
  if (!existsSync(path)) return;
  const stream = createReadStream(path),
    lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lastByte: number | undefined;
  stream.on("data", (chunk: Buffer | string) => {
    lastByte = (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).at(-1);
  });
  try {
    for await (const line of lines) {
      if (!line.trim() || JSON.parse(line).kind !== "game")
        throw new Error("既存trace含明示失败或无效日志");
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if (lastByte !== undefined && lastByte !== 10)
    throw new Error("既存trace截断，拒绝修补或重试");
}

/** The CLI fixes real services. Optional service seams are for isolated controller tests only. */
export function createFormalController(
  options: { directory: string; entryPath: string },
  injected?: FormalControllerServices,
) {
  const root = resolve(options.directory),
    runPath = join(root, "run.json"),
    commitPath = join(root, "run-commit.json"),
    fatalPath = join(root, "fatal.json"),
    snapshotPath = join(root, "reservation-ledger.json");
  const deps: FormalControllerServices = injected ?? {
    verifyCapsule: () => verifyFormalCapsule(options),
    execute: executeJournaledSeed,
    adopt: adoptJournaledSeed,
  };
  const assertNotFatal = () => {
    if (existsSync(fatalPath))
      throw new Error("正式运行已有终止失败，禁止继续或挑选重试");
  };
  const registrationRoot = join(root, "registrations"),
    registrationMap = join(root, "registrations.json");
  const registrationPath = (seed: number) =>
    join(registrationRoot, `${seed}.json`);
  const registrationMapValue = (run: RunManifest) => ({
    version: 1,
    runSha256: hash(runPath),
    seeds: run.seeds,
  });
  function registration(run: RunManifest, seed: number) {
    if (!existsSync(registrationPath(seed)))
      throw new Error("attempt权威登记缺失");
    const raw = read(registrationPath(seed));
    fields(
      raw,
      ["version", "runSha256", "seed", "attempts"],
      "attempt权威登记",
    );
    if (
      raw.version !== 1 ||
      raw.runSha256 !== hash(runPath) ||
      raw.seed !== seed ||
      !Array.isArray(raw.attempts) ||
      raw.attempts.length > 9999
    )
      throw new Error("attempt权威登记身份不符");
    const attempts = raw.attempts as string[];
    exact(
      attempts,
      attempts.map((_, i) => `attempt-${String(i + 1).padStart(4, "0")}`),
      "attempt权威登记不连续",
    );
    return { version: 1, runSha256: hash(runPath), seed, attempts };
  }
  function initializeRegistrations(run: RunManifest) {
    const value = registrationMapValue(run);
    if (existsSync(registrationMap))
      exact(read(registrationMap), value, "attempt种子登记集合变化");
    else exclusive(registrationMap, value);
    mkdirSync(registrationRoot, { recursive: true });
    for (const seed of run.seeds) {
      if (existsSync(registrationPath(seed))) {
        if (registration(run, seed).attempts.length)
          throw new Error("未提交绑定前已存在执行登记");
      } else
        exclusive(registrationPath(seed), {
          version: 1,
          runSha256: hash(runPath),
          seed,
          attempts: [],
        });
    }
  }
  const fatal = (error: unknown) => {
    if (!existsSync(fatalPath) && existsSync(runPath))
      exclusive(fatalPath, {
        version: 1,
        failedAtUtc: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
  };
  const commitValue = (run: RunManifest) => ({
    version: 1,
    runSha256: hash(runPath),
    sealSha256: run.sealSha256,
    ledgerSnapshotSha256: run.ledgerSnapshotSha256,
    registrationsSha256: hash(registrationMap),
  });
  function loadRun(capsule: Capsule, allowUncommitted = false) {
    assertNotFatal();
    const raw: unknown = read(runPath);
    fields(
      raw,
      [
        "version",
        "planHash",
        "sealSha256",
        "ledgerPath",
        "projectRoot",
        "ledgerSnapshotSha256",
        "seeds",
        "shards",
        "reservation",
        "createdAtUtc",
      ],
      "正式run manifest",
    );
    const run = raw as unknown as RunManifest;
    if (
      run.version !== 1 ||
      run.planHash !== formalPlanHash(capsule.plan) ||
      run.sealSha256 !== capsule.sealSha256 ||
      !Array.isArray(run.seeds) ||
      !Array.isArray(run.shards) ||
      typeof run.ledgerPath !== "string" ||
      !isAbsolute(run.ledgerPath) ||
      typeof run.projectRoot !== "string" ||
      !isAbsolute(run.projectRoot) ||
      typeof run.createdAtUtc !== "string" ||
      !run.createdAtUtc.endsWith("Z") ||
      !Number.isFinite(Date.parse(run.createdAtUtc))
    )
      throw new Error("正式manifest身份无效");
    exact(
      run.shards,
      partition(run.seeds, run.shards.length),
      "正式分片不再是完整无重叠预定并集",
    );
    if (hash(snapshotPath) !== run.ledgerSnapshotSha256)
      throw new Error("预约账本快照变化");
    inside(run.projectRoot, run.ledgerPath);
    verifyHistory(run.ledgerPath, run.projectRoot);
    verifyHistory(snapshotPath, run.projectRoot);
    const current = verifyFormalReservation(
        run.ledgerPath,
        capsule.plan,
        run.seeds,
      ),
      snapshot = verifyFormalReservation(snapshotPath, capsule.plan, run.seeds);
    exact(run.reservation, current.reservation, "正式整组预约与manifest不符");
    exact(run.reservation, snapshot.reservation, "正式预约快照不符");
    if (existsSync(commitPath)) {
      exact(read(commitPath), commitValue(run), "正式manifest权威绑定发生变化");
      exact(
        read(registrationMap),
        registrationMapValue(run),
        "attempt种子登记集合变化",
      );
      for (const seed of run.seeds) registration(run, seed);
    } else if (!allowUncommitted) throw new Error("正式manifest缺少权威绑定");
    const resultRoot = join(root, "results");
    if (existsSync(resultRoot))
      for (const entry of readdirSync(resultRoot, { withFileTypes: true }))
        if (!entry.isDirectory() || !run.seeds.map(String).includes(entry.name))
          throw new Error("结果目录含额外或未知seed");
    return run;
  }
  const request = (
    run: RunManifest,
    capsule: Capsule,
    seed: number,
    directory: string,
    priorJournals: string[],
  ): SeedRequest => ({
    config: { ...capsule.plan.config, seeds: run.seeds },
    seed,
    planHash: run.planHash,
    directory,
    priorJournals,
  });
  function attemptPaths(run: RunManifest, seed: number) {
    const dir = join(root, "results", String(seed));
    const expected = registration(run, seed).attempts;
    if (!existsSync(dir)) {
      if (expected.length) throw new Error("已登记attempt目录缺失");
      return [];
    }
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    exact(
      entries.map((v) => v.name),
      expected,
      "已登记attempt目录有缺失或额外内容",
    );
    return entries.map((entry, i) => {
      if (
        !entry.isDirectory() ||
        entry.name !== `attempt-${String(i + 1).padStart(4, "0")}`
      )
        throw new Error("attempt权威登记有缺失、额外或非连续目录");
      const path = join(dir, entry.name);
      inside(root, path);
      return path;
    });
  }
  async function inspectChain(
    run: RunManifest,
    capsule: Capsule,
    seed: number,
    paths: string[],
  ) {
    let prefix: string[] = [];
    const config = { ...capsule.plan.config, seeds: run.seeds },
      expectedGames =
        config.seats.length *
        config.lineups.length *
        config.openings.length *
        config.policies.length;
    for (let i = 0; i < paths.length; i++) {
      exact(
        read(join(paths[i], "attempt.json")),
        {
          version: 1,
          planHash: run.planHash,
          seed,
          configSha256: digest(config),
          sourceFingerprint: capsule.plan.sourceFingerprint,
          runtime: capsule.plan.runtime,
          rules: DEFAULT_RULES,
        },
        "既存attempt元数据或身份不符",
      );
      const report = await inspectFormalJournal(
        join(paths[i], "journal.jsonl"),
        { planHash: run.planHash, seed, expectedGames },
      );
      if (report.terminal === "failure")
        throw new Error("既存attempt有明示失败，禁止重试");
      if (report.terminal === "complete" && i !== paths.length - 1)
        throw new Error("完整attempt之后出现额外重试");
      for (
        let j = 0;
        j < Math.min(prefix.length, report.eventHashes.length);
        j++
      )
        if (prefix[j] !== report.eventHashes[j])
          throw new Error("既存attempt前缀变化");
      if (report.eventHashes.length > prefix.length)
        prefix = report.eventHashes;
      await assertNoFailedTraces(join(paths[i], "traces.jsonl"));
    }
  }
  function hasCompleteInner(path: string, seed: number) {
    const games = join(path, "games.jsonl");
    if (!existsSync(games)) return false;
    const raw = readFileSync(games, "utf8");
    if (!raw.endsWith("\n")) throw new Error("既存成绩日志截断");
    const rows = raw
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (rows.length === 1) return false;
    if (rows.length !== 2 || rows[1].kind !== "seed" || rows[1].seed !== seed)
      throw new Error("既存成绩日志不是单seed完整提交");
    return true;
  }
  function checkReceipt(
    receipt: Receipt,
    run: RunManifest,
    capsule: Capsule,
    seed: number,
    path: string,
  ) {
    const config = { ...capsule.plan.config, seeds: run.seeds };
    if (
      receipt.version !== 1 ||
      receipt.seed !== seed ||
      receipt.planHash !== run.planHash ||
      receipt.configSha256 !== digest(config)
    )
      throw new Error("收据身份与正式预约不符");
    for (const [field, name] of [
      ["metadataSha256", "attempt.json"],
      ["gamesSha256", "games.jsonl"],
      ["tracesSha256", "traces.jsonl"],
      ["journalSha256", "journal.jsonl"],
    ] as const)
      if (receipt[field] !== hash(join(path, name)))
        throw new Error("收据原始证据哈希变化：" + name);
    const expected =
      config.seats.length *
      config.lineups.length *
      config.openings.length *
      config.policies.length;
    if (
      receipt.gameCount !== expected ||
      receipt.decisionCount < expected ||
      receipt.replayedStates <= expected
    )
      throw new Error("收据缺少完整游戏或重放计数");
    exact(read(join(path, "receipt.json")), receipt, "磁盘收据与审计结果不符");
  }
  return {
    async reserve(args: {
      ledgerPath: string;
      projectRoot: string;
      seeds: readonly number[];
      shards: number;
    }) {
      assertNotFatal();
      const capsule = await deps.verifyCapsule(),
        ledgerPath = resolve(args.ledgerPath),
        projectRoot = resolve(args.projectRoot);
      partition(args.seeds, args.shards);
      inside(projectRoot, ledgerPath);
      verifyHistory(ledgerPath, projectRoot);
      if (existsSync(runPath)) {
        const run = loadRun(capsule, true);
        exact(
          {
            ledgerPath,
            projectRoot,
            seeds: args.seeds,
            shards: partition(args.seeds, args.shards),
          },
          {
            ledgerPath: run.ledgerPath,
            projectRoot: run.projectRoot,
            seeds: run.seeds,
            shards: run.shards,
          },
          "不能改变原正式manifest或分片",
        );
        if (!existsSync(commitPath)) {
          if (existsSync(join(root, "results")))
            throw new Error("已有执行但权威绑定缺失");
          initializeRegistrations(run);
          exclusive(commitPath, commitValue(run));
        }
        return run;
      }
      const reserved = reserveFormalSeeds(ledgerPath, capsule.plan, args.seeds);
      if (!existsSync(snapshotPath)) exclusive(snapshotPath, read(ledgerPath));
      const snapshot = verifyFormalReservation(
        snapshotPath,
        capsule.plan,
        args.seeds,
      );
      exact(
        snapshot.reservation,
        reserved.reservation,
        "已有账本快照与预约不符",
      );
      const run: RunManifest = {
        version: 1,
        planHash: formalPlanHash(capsule.plan),
        sealSha256: capsule.sealSha256,
        ledgerPath,
        projectRoot,
        ledgerSnapshotSha256: hash(snapshotPath),
        seeds: [...args.seeds],
        shards: partition(args.seeds, args.shards),
        reservation: reserved.reservation,
        createdAtUtc: new Date().toISOString(),
      };
      exclusive(runPath, run);
      initializeRegistrations(run);
      exclusive(commitPath, commitValue(run));
      loadRun(capsule);
      return run;
    },
    async runShard(id: number, progress?: (message: string) => void) {
      let unlock: (() => void) | undefined;
      try {
        assertNotFatal();
        let capsule = await deps.verifyCapsule();
        const run = loadRun(capsule),
          shard = run.shards.find((v) => v.id === id);
        if (!shard) throw new InputError("未知正式分片");
        unlock = lock(join(root, `shard-${id}.lock`), hash(runPath));
        for (let index = 0; index < shard.seeds.length; index++) {
          assertNotFatal();
          capsule = await deps.verifyCapsule();
          loadRun(capsule);
          const seed = shard.seeds[index],
            paths = attemptPaths(run, seed);
          await inspectChain(run, capsule, seed, paths);
          let receipt: Receipt, path: string;
          const last = paths.at(-1);
          if (last && hasCompleteInner(last, seed)) {
            path = last;
            receipt = await deps.adopt(
              request(
                run,
                capsule,
                seed,
                last,
                paths.slice(0, -1).map((p) => join(p, "journal.jsonl")),
              ),
            );
          } else {
            const parent = join(root, "results", String(seed));
            mkdirSync(parent, { recursive: true });
            path = join(
              parent,
              `attempt-${String(paths.length + 1).padStart(4, "0")}`,
            );
            const registered = registration(run, seed);
            await replaceOwned(registrationPath(seed), {
              ...registered,
              attempts: [
                ...registered.attempts,
                `attempt-${String(paths.length + 1).padStart(4, "0")}`,
              ],
            });
            receipt = await deps.execute(
              request(
                run,
                capsule,
                seed,
                path,
                paths.map((p) => join(p, "journal.jsonl")),
              ),
            );
          }
          checkReceipt(receipt, run, capsule, seed, path);
          capsule = await deps.verifyCapsule();
          loadRun(capsule);
          assertNotFatal();
          progress?.(
            `完成正式种子 ${seed}；分片${id} ${index + 1}/${shard.seeds.length}`,
          );
        }
        const complete = {
          version: 1,
          runSha256: hash(runPath),
          id,
          seeds: shard.seeds,
        };
        const path = join(root, `shard-${id}.complete.json`);
        if (existsSync(path))
          exact(read(path), complete, "既存分片完成绑定变化");
        else exclusive(path, complete);
        return complete;
      } catch (error) {
        if (!(error instanceof BusyError) && !(error instanceof InputError))
          try {
            fatal(error);
          } catch {
            /* Preserve the original failure. */
          }
        throw error;
      } finally {
        unlock?.();
      }
    },
    async finalize() {
      let unlock: (() => void) | undefined;
      try {
        assertNotFatal();
        const capsule = await deps.verifyCapsule(),
          run = loadRun(capsule),
          missing: number[] = [];
        unlock = lock(join(root, "finalize.lock"), hash(runPath));
        for (const shard of run.shards) {
          const path = join(root, `shard-${shard.id}.complete.json`);
          if (!existsSync(path)) {
            missing.push(...shard.seeds);
            continue;
          }
          exact(
            read(path),
            {
              version: 1,
              runSha256: hash(runPath),
              id: shard.id,
              seeds: shard.seeds,
            },
            "正式分片完成绑定不符",
          );
          if (existsSync(join(root, `shard-${shard.id}.lock`)))
            throw new BusyError("正式分片尚未释放执行锁");
        }
        if (missing.length)
          return { complete: false as const, missingSeeds: missing };
        const records: IndependentRecord[] = [],
          receipts: Receipt[] = [],
          audited: {
            seed: number;
            paths: string[];
            receipt: Receipt;
            evidence: Record<string, string>;
          }[] = [];
        for (const seed of run.seeds) {
          const paths = attemptPaths(run, seed);
          if (!paths.length || !existsSync(join(paths.at(-1)!, "receipt.json")))
            return { complete: false as const, missingSeeds: [seed] };
          await inspectChain(run, capsule, seed, paths);
          const last = paths.at(-1)!;
          const receipt = await deps.adopt(
            request(
              run,
              capsule,
              seed,
              last,
              paths.slice(0, -1).map((p) => join(p, "journal.jsonl")),
            ),
          );
          checkReceipt(receipt, run, capsule, seed, last);
          receipts.push(receipt);
          audited.push({
            seed,
            paths,
            receipt,
            evidence: Object.fromEntries(
              paths.flatMap((path) =>
                [
                  "attempt.json",
                  "games.jsonl",
                  "traces.jsonl",
                  "journal.jsonl",
                  "receipt.json",
                ]
                  .map((name) => join(path, name))
                  .filter(existsSync)
                  .map((file) => [file, hash(file)]),
              ),
            ),
          });
          records.push(
            ...JSON.parse(
              readFileSync(join(last, "games.jsonl"), "utf8")
                .trimEnd()
                .split("\n")[1],
            ).records,
          );
        }
        const statistics = summarizeFormalStatistics(
          capsule.plan,
          run.seeds,
          records,
        );
        loadRun(await deps.verifyCapsule());
        assertNotFatal();
        // No async gap between this final evidence check and report commit.
        // Runtime capture may yield long after an earlier seed was audited.
        for (const shard of run.shards) {
          exact(
            read(join(root, `shard-${shard.id}.complete.json`)),
            {
              version: 1,
              runSha256: hash(runPath),
              id: shard.id,
              seeds: shard.seeds,
            },
            "最终提交前分片完成绑定变化",
          );
          if (existsSync(join(root, `shard-${shard.id}.lock`)))
            throw new BusyError("正式分片尚未释放执行锁");
        }
        for (const item of audited) {
          exact(
            attemptPaths(run, item.seed),
            item.paths,
            "最终提交前attempt证据集合变化",
          );
          for (const [file, expected] of Object.entries(item.evidence))
            if (hash(file) !== expected)
              throw new Error("最终提交前原始证据哈希变化");
          checkReceipt(
            item.receipt,
            run,
            capsule,
            item.seed,
            item.paths.at(-1)!,
          );
        }
        const core = {
          version: 1,
          purpose: "formal",
          complete: true as const,
          planHash: run.planHash,
          runManifestSha256: hash(runPath),
          sealSha256: run.sealSha256,
          ledgerSnapshotSha256: run.ledgerSnapshotSha256,
          seedCount: run.seeds.length,
          gameCount: records.length,
          receipts,
          statistics,
          executionAndStatisticalConditionsMet:
            statistics.allStatisticalConditionsMet,
          expertStrengthEstablished: false as const,
          limitation:
            "All seeded raw grids audited under sealed source/runtime; statistical and execution conditions alone do not establish expert strength, faithful explanations or production-browser acceptance.",
        };
        const path = join(root, "final-report.json");
        if (existsSync(path)) {
          const { completedAtUtc, ...stored } = read(path);
          if (
            typeof completedAtUtc !== "string" ||
            !completedAtUtc.endsWith("Z") ||
            !Number.isFinite(Date.parse(completedAtUtc))
          )
            throw new Error("既存最终报告时间无效");
          exact(stored, core, "既存最终报告与完整原始证据不符");
          return { ...core, completedAtUtc };
        }
        const report = { ...core, completedAtUtc: new Date().toISOString() };
        exclusive(path, report);
        return report;
      } catch (error) {
        if (!(error instanceof BusyError))
          try {
            fatal(error);
          } catch {
            /* Preserve original audit failure. */
          }
        throw error;
      } finally {
        unlock?.();
      }
    },
  };
}
