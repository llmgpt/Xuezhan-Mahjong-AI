import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULT_RULES } from "../src/game/game";
import { chooseTeacherAction } from "../src/game/teacher";
import { auditFormalSeedAttempt } from "./formalAudit";
import {
  runIndependentBenchmark,
  type IndependentConfig,
} from "./independentBenchmark";
import { createPolicySession } from "./independentPolicies";
import { playIndependentGame, type Policy } from "./independentRunner";

const config: IndependentConfig = {
  mode: "development",
  seeds: [80000],
  seats: [0],
  lineups: ["teacher-v1"],
  openings: ["common"],
  policies: ["teacher-v1", "candidate-v2"],
  comparisons: [{ candidate: "candidate-v2", baseline: "teacher-v1" }],
  timeoutMs: 1000,
};
const sourceFingerprint = { "test-only-source": "a".repeat(64) };
const runtime = { node: "test-node", python: "test-python" };
let fixture: { games: string; traces: string };
let directory: string;
const directories: string[] = [];

function temporary() {
  const path = mkdtempSync(join(tmpdir(), "xuezhan-formal-audit-"));
  directories.push(path);
  return path;
}

function removeTemporary(path: string) {
  if (
    dirname(resolve(path)) !== resolve(tmpdir()) ||
    !basename(path).startsWith("xuezhan-formal-audit-")
  )
    throw new Error("unsafe formal test cleanup");
  rmSync(path, { recursive: true, force: true });
}

function rows(name: "games" | "traces") {
  return readFileSync(join(directory, name + ".jsonl"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function save(name: "games" | "traces", data: unknown[]) {
  writeFileSync(
    join(directory, name + ".jsonl"),
    data.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

function audit(overrides = {}) {
  return auditFormalSeedAttempt({
    config,
    seed: 80000,
    directory,
    sourceFingerprint,
    runtime,
    rules: DEFAULT_RULES,
    ...overrides,
  });
}

beforeAll(async () => {
  const output = temporary();
  await runIndependentBenchmark(config, output, {
    runtime,
    fingerprint: () => sourceFingerprint,
    play: async (spec, events) => {
      const own = createPolicySession(spec.policy);
      const opponent: Policy = (view, phase) =>
        chooseTeacherAction(view, phase);
      try {
        return await playIndependentGame(
          spec.seed,
          spec.seat,
          own.choose,
          { 0: opponent, 1: opponent, 2: opponent, 3: opponent },
          { openingPolicy: opponent, onDecision: events.onDecision },
        );
      } finally {
        await own.finish();
      }
    },
  });
  fixture = {
    games: readFileSync(join(output, "games.jsonl"), "utf8"),
    traces: readFileSync(join(output, "traces.jsonl"), "utf8"),
  };
}, 30000);

beforeEach(() => {
  directory = temporary();
  writeFileSync(join(directory, "games.jsonl"), fixture.games);
  writeFileSync(join(directory, "traces.jsonl"), fixture.traces);
});

afterEach(() => {
  if (directory) removeTemporary(directory);
  directory = "";
});

afterAll(() => {
  for (const path of directories) removeTemporary(path);
});

describe("正式证据的逐动作全网格审计", () => {
  it("只重放已保存动作，完整终局和公开视图都与真实引擎一致", async () => {
    const report = await audit();
    expect(report.gameCount).toBe(2);
    expect(report.records).toEqual(rows("games")[1].records);
    expect(report.decisionCount).toBe(
      rows("traces").reduce((n, row) => n + row.decisions.length, 0),
    );
    expect(report.replayedStates).toBe(
      report.records.reduce((n, row) => n + row.result.steps + 1, 0),
    );
    expect(report.gamesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.tracesSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("规则、来源和运行时标签必须匹配实际固定引擎与manifest", async () => {
    await expect(
      audit({ sourceFingerprint: { source: "b".repeat(64) } }),
    ).rejects.toThrow(/manifest|来源/);
    await expect(
      audit({ runtime: { ...runtime, python: "other" } }),
    ).rejects.toThrow(/manifest|运行时/);
    await expect(
      audit({ rules: { ...DEFAULT_RULES, unknown: true } }),
    ).rejects.toThrow(/规则/);
  });

  it.each(["games", "traces"] as const)("%s文件截断即拒绝", async (name) => {
    const path = join(directory, name + ".jsonl");
    writeFileSync(path, readFileSync(path, "utf8").trimEnd());
    await expect(audit()).rejects.toThrow(/截断|换行/);
  });

  it("成绩完整也不能接纳缺一条、重复、failure或额外trace", async () => {
    const original = rows("traces");
    for (const changed of [
      original.slice(1),
      [...original, original[0]],
      [{ ...original[0], kind: "failure", error: "timeout" }, original[1]],
      [{ ...original[0], seed: 80001 }, original[1]],
    ]) {
      save("traces", changed);
      await expect(audit()).rejects.toThrow(/trace|日志|失败|网格|重复/);
    }
  });

  it("不能接纳少一个成绩组合或附加另一个seed的envelope", async () => {
    const original = rows("games");
    const missing = structuredClone(original);
    missing[1].records.pop();
    save("games", missing);
    await expect(audit()).rejects.toThrow(/组合|网格|缺少/);
    save("games", [...original, { ...original[1], seed: 80001 }]);
    await expect(audit()).rejects.toThrow(/种子|单seed|单种子/);
  });

  it("零和成绩仍不能掩盖伪造胡牌、步骤或终局原因", async () => {
    for (const key of ["wins", "steps", "endReason"]) {
      const changed = rows("games");
      const result = changed[1].records[0].result;
      if (key === "wins") result.wins = [];
      if (key === "steps") result.steps += 1;
      if (key === "endReason")
        result.endReason = result.endReason === "wall" ? "three-wins" : "wall";
      save("games", changed);
      await expect(audit()).rejects.toThrow(/终局|重放/);
      writeFileSync(join(directory, "games.jsonl"), fixture.games);
    }
  });

  it("每步公开视图、座位、阶段和step均须对应重放时刻", async () => {
    for (const key of ["view", "actor", "phase", "step"]) {
      const changed = JSON.parse(
        JSON.stringify(
          fixture.traces
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line)),
        ),
      );
      const event = changed[0].decisions[0];
      if (key === "view") event.view.wallRemaining -= 1;
      if (key === "actor") event.actor = (event.actor + 1) % 4;
      if (key === "phase") event.phase = "discard";
      if (key === "step") event.step += 1;
      save("traces", changed);
      await expect(audit()).rejects.toThrow(/公开|座位|阶段|step|重放/);
    }
  });

  it("非法动作、丢失尾部决定和多余决定都不能通过重放", async () => {
    const original = rows("traces");
    for (const mode of ["illegal", "missing", "extra"]) {
      const changed = structuredClone(original);
      const decisions = changed[0].decisions;
      if (mode === "illegal")
        decisions.find(
          (event: { phase: string }) => event.phase === "discard",
        ).action = { type: "discard", tile: 99 };
      if (mode === "missing") decisions.pop();
      if (mode === "extra") decisions.push(structuredClone(decisions.at(-1)));
      save("traces", changed);
      await expect(audit()).rejects.toThrow(/动作|重放|决定|合法/);
    }
  });

  it("共同开局必须采用冻结的老师选择，即使另一个换牌组合也合法", async () => {
    const changed = rows("traces");
    const event = changed[0].decisions[0];
    let alternative: number[] | undefined;
    for (let suit = 0; suit < 3; suit++) {
      const hand = event.view.hand.filter(
        (tile: number) => Math.floor(tile / 9) === suit,
      );
      for (let i = 0; i < hand.length - 2; i++) {
        const tiles = hand.slice(i, i + 3);
        if (
          JSON.stringify([...tiles].sort()) !==
          JSON.stringify([...event.action.tiles].sort())
        )
          alternative = tiles;
      }
    }
    expect(alternative).toBeDefined();
    event.action.tiles = alternative;
    save("traces", changed);
    await expect(audit()).rejects.toThrow(/共同开局/);
  });

  it("拒绝未知顶层字段和不对应任何决定的评估附录", async () => {
    const extra = rows("traces");
    extra[0].wall = [1, 2];
    save("traces", extra);
    await expect(audit()).rejects.toThrow(/字段|schema/);
    const evaluation = JSON.parse(fixture.traces.trimEnd().split("\n")[0]);
    evaluation.evaluations = [
      {
        actor: 0,
        decisionIndex: 99999,
        report: { status: "fallback", samples: 0, choices: [] },
      },
    ];
    save("traces", [
      evaluation,
      JSON.parse(fixture.traces.trimEnd().split("\n")[1]),
    ]);
    await expect(audit()).rejects.toThrow(/评估|evaluation/);
  });

  it("动作不能夹带合法类型之外的额外载荷", async () => {
    const changed = rows("traces");
    changed[0].decisions.find(
      (event: { phase: string }) => event.phase === "discard",
    ).action.privateWall = [1, 2];
    save("traces", changed);
    await expect(audit()).rejects.toThrow(/字段|schema/);
  });
});
