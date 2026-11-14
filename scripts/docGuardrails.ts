import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const MAX_NEXT_STEPS_LINES = 60;

export const CORE_DOC_NAMES = [
  "PROJECT_PLAN.md",
  "RULES_V1.md",
  "AUTOPLAY.md",
  "ENGINEERING.md",
  "NEXT_STEPS.md",
] as const;

export const RESEARCH_STATUSES = [
  "active-reference",
  "superseded",
  "rejected",
  "diagnostic",
  "reference",
] as const;

const LOCAL_EVIDENCE_RE = /local\/[^\s`'")\]}>，。；：、]+/;
const RESEARCH_STATUS_RE = new RegExp(
  `^>\\s*状态：(?:${RESEARCH_STATUSES.join("|")})(?:$|[\\s（(：:])`,
  "m",
);

function stripFencedCodeBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}

function collectMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(fullPath));
    else if (entry.name.endsWith(".md")) files.push(fullPath);
  }
  return files;
}

function extractRelativeTargets(markdown: string): string[] {
  const cleaned = stripFencedCodeBlocks(markdown).replace(/`[^`\n]+`/g, "");
  const targets: string[] = [];
  for (const match of cleaned.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
    const raw = match[1].trim().split(/\s+/)[0];
    if (
      !raw ||
      raw.startsWith("#") ||
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("mailto:") ||
      raw.startsWith("data:")
    ) {
      continue;
    }
    const target = raw.split("#")[0];
    if (target) targets.push(target);
  }
  return targets;
}

function checkNextSteps(root: string, issues: string[]): void {
  const path = join(root, "docs", "NEXT_STEPS.md");
  if (!existsSync(path)) {
    issues.push("缺少 docs/NEXT_STEPS.md。");
    return;
  }
  const content = readFileSync(path, "utf8");
  const lines = content.split(/\r?\n/).length;
  if (lines > MAX_NEXT_STEPS_LINES) {
    issues.push(
      `docs/NEXT_STEPS.md 超过 ${MAX_NEXT_STEPS_LINES} 行上限（当前 ${lines} 行）：交接文档须覆盖写而非追加，历史请留在 git log 或 docs/research/。`,
    );
  }
}

function checkCoreDocsAndLocalRefs(root: string, issues: string[]): void {
  const coreFiles = [
    "AGENTS.md",
    "README.md",
    "ARCHITECTURE.md",
    ...CORE_DOC_NAMES.map((name) => join("docs", name)),
    join("docs", "research", "README.md"),
  ];
  for (const rel of coreFiles) {
    const fullPath = join(root, rel);
    if (!existsSync(fullPath)) {
      issues.push(`缺少核心文档 ${rel.replaceAll("\\", "/")}。`);
      continue;
    }
    const content = readFileSync(fullPath, "utf8");
    if (LOCAL_EVIDENCE_RE.test(content)) {
      issues.push(
        `${rel.replaceAll("\\", "/")} 不得引用 local/ 子路径作为长期证据来源（local/ 不入库）。`,
      );
    }
  }
}

function checkDocsDirectoryLayout(root: string, issues: string[]): void {
  const docsDir = join(root, "docs");
  if (!existsSync(docsDir)) {
    issues.push("缺少 docs/ 目录。");
    return;
  }
  if (existsSync(join(docsDir, "benchmarks"))) {
    issues.push(
      "docs/benchmarks 应归档在 docs/research/benchmarks/，不要放在 docs/ 根目录。",
    );
  }
  const allowed = new Set<string>(CORE_DOC_NAMES);
  for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !allowed.has(entry.name)
    ) {
      issues.push(
        `docs/${entry.name} 不在核心文档清单中：研究或历史文档请移入 docs/research/ 并注明状态。`,
      );
    }
  }
}

function checkResearchArchive(root: string, issues: string[]): void {
  const researchDir = join(root, "docs", "research");
  const indexPath = join(researchDir, "README.md");
  if (!existsSync(indexPath)) return;
  const indexContent = readFileSync(indexPath, "utf8");

  for (const entry of readdirSync(researchDir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".md") ||
      entry.name === "README.md"
    ) {
      continue;
    }
    const fullPath = join(researchDir, entry.name);
    const header = readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .slice(0, 6)
      .join("\n");
    if (!RESEARCH_STATUS_RE.test(header)) {
      issues.push(
        `docs/research/${entry.name} 前 6 行缺少标准状态声明（例如：> 状态：superseded）。`,
      );
    }
    if (!indexContent.includes(`(${entry.name})`)) {
      issues.push(
        `docs/research/README.md 尚未索引 docs/research/${entry.name}。`,
      );
    }
  }
}

function checkMarkdownLinks(root: string, issues: string[]): void {
  const markdownFiles = [
    join(root, "AGENTS.md"),
    join(root, "README.md"),
    join(root, "ARCHITECTURE.md"),
    ...collectMarkdownFiles(join(root, "docs")),
    ...collectMarkdownFiles(join(root, "scripts")),
  ].filter((filePath) => existsSync(filePath));

  for (const filePath of markdownFiles) {
    const content = readFileSync(filePath, "utf8");
    const relSource = relative(root, filePath).replaceAll("\\", "/");
    for (const target of extractRelativeTargets(content)) {
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        // Keep raw target if percent sequence is literal.
      }
      const resolved = resolve(dirname(filePath), decoded);
      const relTarget = relative(root, resolved).replaceAll("\\", "/");
      if (relTarget === "local" || relTarget.startsWith("local/")) {
        issues.push(
          `${relSource} 包含指向 local/ 的 Markdown 链接 (${target})，请在仓库外或改用行内说明。`,
        );
      } else if (!existsSync(resolved)) {
        issues.push(`${relSource} 存在失效链接: ${target}`);
      }
    }
  }
}

/**
 * 校验仓库核心文档规范、研究归档索引与相对 Markdown 链接完整性。
 */
export function checkRepoDocs(rootDir: string): string[] {
  const root = resolve(rootDir);
  const issues: string[] = [];
  checkNextSteps(root, issues);
  checkCoreDocsAndLocalRefs(root, issues);
  checkDocsDirectoryLayout(root, issues);
  checkResearchArchive(root, issues);
  checkMarkdownLinks(root, issues);
  return issues;
}
