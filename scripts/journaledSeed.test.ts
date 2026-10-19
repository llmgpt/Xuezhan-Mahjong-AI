import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { executeJournaledSeed, adoptJournaledSeed } from "./journaledSeed";
import type { IndependentConfig } from "./independentBenchmark";

const root = mkdtempSync(join(tmpdir(), "xuezhan-journaled-seed-"));
const config: IndependentConfig = {
  mode: "development",
  seeds: [80000],
  seats: [0],
  lineups: ["ui-bots"],
  openings: ["composite"],
  policies: ["teacher-v1", "candidate-v2"],
  comparisons: [{ candidate: "candidate-v2", baseline: "teacher-v1" }],
  timeoutMs: 1000,
};
const planHash = "a".repeat(64);
let count = 0;
const request = () => ({
  config,
  seed: 80000,
  planHash,
  directory: join(root, `attempt-${++count}`),
  priorJournals: [] as string[],
});
afterAll(() => {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith("xuezhan-journaled-seed-")
  )
    throw new Error("Unsafe seed test cleanup");
  rmSync(root, { recursive: true, force: true });
});

describe("绑定真实执行器的单seed持久化与收据", () => {
  it("真实旧seed两完整局经原始动作审计后提交双原始哈希收据", async () => {
    const options = request();
    const receipt = await executeJournaledSeed(options);
    expect(receipt.gameCount).toBe(2);
    expect(receipt.decisionCount).toBeGreaterThan(20);
    for (const name of [
      "gamesSha256",
      "tracesSha256",
      "journalSha256",
      "metadataSha256",
    ] as const)
      expect(receipt[name]).toMatch(/^[a-f0-9]{64}$/);
    expect(
      JSON.parse(readFileSync(join(options.directory, "receipt.json"), "utf8")),
    ).toEqual(receipt);
    const before = readFileSync(
      join(options.directory, "receipt.json"),
      "utf8",
    );
    expect(await adoptJournaledSeed(options)).toEqual(receipt);
    expect(readFileSync(join(options.directory, "receipt.json"), "utf8")).toBe(
      before,
    );
    await expect(executeJournaledSeed(options)).rejects.toThrow();
  }, 30000);

  it("完整内层提交在收据前中断，可只审计原始记录补收据", async () => {
    const options = request();
    const first = await executeJournaledSeed(options);
    const games = readFileSync(join(options.directory, "games.jsonl"));
    const traces = readFileSync(join(options.directory, "traces.jsonl"));
    const receiptPath = join(options.directory, "receipt.json");
    rmSync(receiptPath);
    const journalPath = join(options.directory, "journal.jsonl");
    const journal = readFileSync(journalPath, "utf8").trimEnd().split("\n");
    expect(JSON.parse(journal.at(-1)!).event.kind).toBe("seed-complete");
    writeFileSync(journalPath, journal.slice(0, -1).join("\n") + "\n");
    const adopted = await adoptJournaledSeed(options);
    expect(adopted.gameCount).toBe(first.gameCount);
    expect(adopted.journalTerminal).toBe("game-grid-complete-no-marker");
    expect(readFileSync(join(options.directory, "games.jsonl"))).toEqual(games);
    expect(readFileSync(join(options.directory, "traces.jsonl"))).toEqual(
      traces,
    );
    expect(readFileSync(journalPath, "utf8")).toBe(
      journal.slice(0, -1).join("\n") + "\n",
    );
  }, 30000);

  it("恢复到新attempt时逐个核对已保存公开决定，拒绝失败轨迹", async () => {
    const original = request();
    await executeJournaledSeed(original);
    const prefixPath = join(root, "host-interrupted-prefix.jsonl");
    const prefix =
      readFileSync(join(original.directory, "journal.jsonl"), "utf8")
        .split("\n")
        .slice(0, 20)
        .join("\n") + "\n";
    writeFileSync(prefixPath, prefix);
    const resumed = request();
    resumed.priorJournals = [prefixPath];
    expect((await executeJournaledSeed(resumed)).gameCount).toBe(2);
    const corruptPath = join(root, "corrupt-prefix.jsonl");
    writeFileSync(corruptPath, prefix.slice(0, -1));
    const corrupt = request();
    corrupt.priorJournals = [corruptPath];
    await expect(executeJournaledSeed(corrupt)).rejects.toThrow(/截断|换行/);
  }, 30000);

  it("原始动作/收据/身份变化不能被完整状态或旧哈希掩盖", async () => {
    const options = request();
    await executeJournaledSeed(options);
    await expect(
      adoptJournaledSeed({ ...options, planHash: "b".repeat(64) }),
    ).rejects.toThrow(/身份|元数据/);
    const tracesPath = join(options.directory, "traces.jsonl");
    const traces = readFileSync(tracesPath, "utf8");
    const rows = traces
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    rows[0].decisions[0].step++;
    writeFileSync(
      tracesPath,
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    await expect(adoptJournaledSeed(options)).rejects.toThrow(/重放|step/);
    writeFileSync(tracesPath, traces);
    const receiptPath = join(options.directory, "receipt.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    writeFileSync(
      receiptPath,
      JSON.stringify({ ...receipt, gameCount: 999 }) + "\n",
    );
    await expect(adoptJournaledSeed(options)).rejects.toThrow(/收据/);
  }, 30000);
});
