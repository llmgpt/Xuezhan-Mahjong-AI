import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { chooseTeacherAction } from "../src/game/teacher";
import { playIndependentGame, type Policy } from "./independentRunner";
import {
  createFormalJournal,
  inspectFormalJournal,
  type FormalJournalEvent,
} from "./formalJournal";

const directory = mkdtempSync(join(tmpdir(), "xuezhan-formal-journal-"));
const identity = { planHash: "a".repeat(64), seed: 80000, expectedGames: 1 };
let counter = 0;
const next = () => join(directory, `attempt-${++counter}.jsonl`);
let events: FormalJournalEvent[];

beforeAll(async () => {
  events = [
    {
      kind: "game-start",
      spec: {
        seed: 80000,
        seat: 0,
        lineup: "teacher-v1",
        opening: "composite",
        policy: "teacher-v1",
      },
    },
  ];
  const policy: Policy = (view, phase) => {
    events.push({
      kind: "attempt",
      actor: view.seat,
      phase,
      view: structuredClone(view),
    });
    return chooseTeacherAction(view, phase);
  };
  const result = await playIndependentGame(
    80000,
    0,
    policy,
    { 0: policy, 1: policy, 2: policy, 3: policy },
    {
      onDecision: (trace) => {
        events.push({ kind: "decision", trace: structuredClone(trace) });
      },
    },
  );
  events.push({ kind: "game-complete", result });
});

afterAll(() => {
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("xuezhan-formal-journal-")
  )
    throw new Error("Unsafe journal test cleanup");
  rmSync(directory, { recursive: true, force: true });
});

async function save(prefix: readonly FormalJournalEvent[], complete = false) {
  const path = next();
  const journal = await createFormalJournal(path, identity, []);
  try {
    for (const event of prefix) journal.record(event);
    if (complete) journal.complete();
  } finally {
    journal.close();
  }
  return path;
}

describe("正式attempt的持久化决策前缀", () => {
  it("保存真实旧种子的完整公开决定和终局，完整标记绑定精确游戏数", async () => {
    const path = await save(events, true);
    const report = await inspectFormalJournal(path, identity);
    expect(report.terminal).toBe("complete");
    expect(report.completedGames).toBe(1);
    expect(report.eventHashes).toHaveLength(events.length + 1);
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    const rows = readFileSync(path, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows[2].event.view).toEqual(
      events[1].kind === "attempt" ? events[1].view : null,
    );
    expect(
      rows.find((row) => row.event?.kind === "decision").event.trace.action,
    ).toEqual(events[2].kind === "decision" ? events[2].trace.action : null);
    await expect(createFormalJournal(next(), identity, [path])).rejects.toThrow(
      /完整|complete/,
    );
  });

  it("中断到询问策略的公开view后，新attempt必须复现全部已存事件", async () => {
    const previous = await save(events.slice(0, 18));
    const path = next();
    const journal = await createFormalJournal(path, identity, [previous]);
    try {
      for (const event of events.slice(0, 17)) journal.record(event);
      expect(() => journal.assertPrefixReproduced()).toThrow(/前缀/);
      for (const event of events.slice(17)) journal.record(event);
      journal.assertPrefixReproduced();
      journal.complete();
    } finally {
      journal.close();
    }
    expect((await inspectFormalJournal(path, identity)).terminal).toBe(
      "complete",
    );
  });

  it("不能缩短两次既存恢复前缀，也不能把另一条轨迹混入恢复", async () => {
    const shorter = await save(events.slice(0, 10));
    const longer = await save(events.slice(0, 20));
    const writer = await createFormalJournal(next(), identity, [
      shorter,
      longer,
    ]);
    try {
      for (const event of events.slice(0, 10)) writer.record(event);
      expect(() => writer.assertPrefixReproduced()).toThrow(/前缀/);
    } finally {
      writer.close();
    }
    const changed = structuredClone(events.slice(0, 10));
    if (changed[2].kind !== "decision") throw new Error("Expected decision");
    changed[2].trace.step++;
    const divergent = await save(changed);
    await expect(
      createFormalJournal(next(), identity, [shorter, divergent]),
    ).rejects.toThrow(/前缀/);
  });

  it("完整公开view或决定有差异会失败并留下终止错误，禁止有利重试", async () => {
    const previous = await save(events.slice(0, 6));
    const path = next();
    const writer = await createFormalJournal(path, identity, [previous]);
    try {
      writer.record(events[0]);
      const changed = structuredClone(events[1]);
      if (changed.kind !== "attempt") throw new Error("Expected attempt");
      changed.view.wallRemaining++;
      expect(() => writer.record(changed)).toThrow(/前缀/);
      writer.fail("persisted prefix mismatch");
    } finally {
      writer.close();
    }
    expect((await inspectFormalJournal(path, identity)).terminal).toBe(
      "failure",
    );
    await expect(
      createFormalJournal(next(), identity, [previous, path]),
    ).rejects.toThrow(/失败|failure/);
  });

  it("截断日志即使其余前缀有效也拒绝，保留原始字节", async () => {
    const path = await save(events.slice(0, 10));
    const truncated = readFileSync(path, "utf8").slice(0, -1);
    writeFileSync(path, truncated);
    await expect(inspectFormalJournal(path, identity)).rejects.toThrow(
      /截断|换行/,
    );
    expect(readFileSync(path, "utf8")).toBe(truncated);
  });

  it("已持久化询问不随调用者随后修改输入而改变", async () => {
    const writer = await createFormalJournal(next(), identity, []);
    try {
      writer.record(events[0]);
      const attempt = structuredClone(events[1]);
      const decision = structuredClone(events[2]);
      if (attempt.kind !== "attempt" || decision.kind !== "decision")
        throw new Error("Expected public events");
      writer.record(attempt);
      attempt.view.wallRemaining++;
      decision.trace.view = structuredClone(attempt.view);
      expect(() => writer.record(decision)).toThrow(/询问/);
    } finally {
      writer.close();
    }
  });

  it("旧事件被修改、删除或重排后哈希链不能冒充有效恢复", async () => {
    for (const mutation of ["change", "delete", "reorder"]) {
      const path = await save(events.slice(0, 10));
      const lines = readFileSync(path, "utf8").trimEnd().split("\n");
      if (mutation === "delete") lines.splice(2, 1);
      else if (mutation === "reorder")
        [lines[2], lines[3]] = [lines[3], lines[2]];
      else {
        const row = JSON.parse(lines[2]);
        row.event.actor = 3;
        lines[2] = JSON.stringify(row);
      }
      writeFileSync(path, lines.join("\n") + "\n");
      await expect(inspectFormalJournal(path, identity)).rejects.toThrow(
        /哈希|序号|事件/,
      );
    }
  });

  it("不同计划/种子和已存在输出不能作为本次恢复", async () => {
    const path = await save(events.slice(0, 10));
    await expect(
      inspectFormalJournal(path, { ...identity, seed: 80007 }),
    ).rejects.toThrow(/身份/);
    await expect(
      inspectFormalJournal(path, { ...identity, planHash: "b".repeat(64) }),
    ).rejects.toThrow(/身份/);
    await expect(createFormalJournal(path, identity, [])).rejects.toThrow();
  });

  it("未完游戏、没有全网格或尚未复现前缀时不能写完整标记", async () => {
    const writer = await createFormalJournal(next(), identity, []);
    try {
      expect(() => writer.complete()).toThrow(/完整|游戏/);
      writer.record(events[0]);
      expect(() => writer.complete()).toThrow(/完整|游戏/);
    } finally {
      writer.close();
    }
    const two = await createFormalJournal(
      next(),
      { ...identity, expectedGames: 2 },
      [],
    );
    try {
      for (const event of events) two.record(event);
      expect(() => two.complete()).toThrow(/完整|游戏/);
    } finally {
      two.close();
    }
  });

  it("明示策略/worker失败为终止事件，之后不能追加决定或完成", async () => {
    const path = next();
    const writer = await createFormalJournal(path, identity, []);
    writer.record(events[0]);
    writer.fail("worker timeout");
    expect(() => writer.record(events[1])).toThrow(/终止/);
    expect(() => writer.complete()).toThrow(/终止/);
    writer.close();
    const report = await inspectFormalJournal(path, identity);
    expect(report.terminal).toBe("failure");
    await expect(createFormalJournal(next(), identity, [path])).rejects.toThrow(
      /失败|failure/,
    );
  });
});
