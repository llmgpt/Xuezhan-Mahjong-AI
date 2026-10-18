import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runIndependentBenchmark } from "./independentBenchmark";

const [configFile, output] = process.argv.slice(2);
if (!configFile || !output || process.argv.length !== 4)
  throw new Error(
    "用法: vite-node scripts/evaluate-independent.ts <config.json> <output-directory>",
  );
const result = await runIndependentBenchmark(
  JSON.parse(readFileSync(resolve(configFile), "utf8")),
  output,
  { progress: console.log },
);
console.log(
  JSON.stringify(
    {
      complete: result.complete,
      completedSeeds: result.completedSeeds,
      summary: resolve(output, "summary.json"),
    },
    null,
    2,
  ),
);
