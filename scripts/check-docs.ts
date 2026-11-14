import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepoDocs } from "./docGuardrails";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const issues = checkRepoDocs(root);

if (issues.length > 0) {
  console.error("文档规范检查未通过：");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("文档规范检查通过。");
