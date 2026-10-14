import { combineBenchmarkFiles } from "./benchmarkRunner";

const paths = process.argv.slice(2);
if (!paths.length)
  throw new Error(
    "用法：npx vite-node scripts/analyze-benchmark.ts <分片1.jsonl> [分片2.jsonl ...]",
  );
console.log(JSON.stringify(combineBenchmarkFiles(paths), null, 2));
