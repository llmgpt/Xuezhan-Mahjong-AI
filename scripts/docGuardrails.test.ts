import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRepoDocs, MAX_NEXT_STEPS_LINES } from "./docGuardrails";

const createdDirs: string[] = [];

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "xuezhan-doc-guard-"));
  createdDirs.push(root);
  mkdirSync(join(root, "docs", "research", "benchmarks"), { recursive: true });
  mkdirSync(join(root, "scripts", "external"), { recursive: true });

  writeFileSync(join(root, "AGENTS.md"), "# 入口\n\n- [README](README.md)\n");
  writeFileSync(
    join(root, "README.md"),
    "# 说明\n\n- [计划](docs/PROJECT_PLAN.md)\n",
  );
  writeFileSync(
    join(root, "ARCHITECTURE.md"),
    "# 架构\n\n- [工程](docs/ENGINEERING.md)\n",
  );
  writeFileSync(join(root, "docs", "PROJECT_PLAN.md"), "# 计划\n");
  writeFileSync(join(root, "docs", "RULES_V1.md"), "# 规则\n");
  writeFileSync(join(root, "docs", "AUTOPLAY.md"), "# 托管\n");
  writeFileSync(
    join(root, "docs", "ENGINEERING.md"),
    "# 工程\n\n- 不在核心文档中把 `local/` 目录当作证据来源。\n",
  );
  writeFileSync(
    join(root, "docs", "NEXT_STEPS.md"),
    "# 下一步\n\n## 当前状态\n\n- 就绪\n",
  );
  writeFileSync(
    join(root, "docs", "research", "README.md"),
    "# 研究归档\n\n- [V10](V10.md)\n",
  );
  writeFileSync(
    join(root, "docs", "research", "V10.md"),
    "# V10\n\n> 状态：active-reference（默认策略参考）\n",
  );
  writeFileSync(join(root, "scripts", "external", "README.md"), "# 外部\n");
  return root;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("文档守卫检查", () => {
  it("符合规范的精简结构返回零问题", () => {
    const root = createTempRepo();
    expect(checkRepoDocs(root)).toEqual([]);
  });

  it("NEXT_STEPS.md 超过行数上限时报错", () => {
    const root = createTempRepo();
    const lines = Array.from(
      { length: MAX_NEXT_STEPS_LINES + 1 },
      (_, index) => `- 第 ${index + 1} 行`,
    ).join("\n");
    writeFileSync(join(root, "docs", "NEXT_STEPS.md"), lines);

    const issues = checkRepoDocs(root);
    expect(issues.some((msg) => msg.includes("NEXT_STEPS.md"))).toBe(true);
  });

  it("核心文档把 local/ 子路径当作证据来源时报错", () => {
    const root = createTempRepo();
    writeFileSync(
      join(root, "docs", "NEXT_STEPS.md"),
      "# 下一步\n\n证据在 `local/run-1/result.json`。\n",
    );

    const issues = checkRepoDocs(root);
    expect(issues.some((msg) => msg.includes("local/"))).toBe(true);
  });

  it("docs 根目录新增未归档研究文档或 benchmarks 目录时报错", () => {
    const root = createTempRepo();
    writeFileSync(join(root, "docs", "NEW_STUDY.md"), "# 新研究\n");
    mkdirSync(join(root, "docs", "benchmarks"), { recursive: true });

    const issues = checkRepoDocs(root);
    expect(issues.some((msg) => msg.includes("NEW_STUDY.md"))).toBe(true);
    expect(issues.some((msg) => msg.includes("docs/benchmarks"))).toBe(true);
  });

  it("研究文档缺少状态声明或未列入研究索引时报错", () => {
    const root = createTempRepo();
    writeFileSync(
      join(root, "docs", "research", "V12.md"),
      "# V12\n\n没有状态行。\n",
    );

    const issues = checkRepoDocs(root);
    expect(issues.some((msg) => msg.includes("状态"))).toBe(true);
    expect(issues.some((msg) => msg.includes("README.md"))).toBe(true);
  });

  it("失效的相对 Markdown 链接报错", () => {
    const root = createTempRepo();
    writeFileSync(
      join(root, "README.md"),
      "# 说明\n\n- [缺失](docs/MISSING.md)\n",
    );

    const issues = checkRepoDocs(root);
    expect(issues.some((msg) => msg.includes("MISSING.md"))).toBe(true);
  });
});
