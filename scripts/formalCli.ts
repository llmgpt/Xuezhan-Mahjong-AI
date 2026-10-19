import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sealFormalCapsule, verifyFormalCapsule } from "./formalCapsule";
import { createFormalController } from "./formalController";

type FormalCommand =
  | { kind: "seal" | "verify" | "finalize" }
  | { kind: "run"; shard: number }
  | {
      kind: "reserve";
      ledgerPath: string;
      projectRoot: string;
      seedsPath: string;
      shards: number;
    };
const usage =
  "用法: node <capsule>/scripts/evaluate-formal.mjs seal|verify|finalize|run <shard>|reserve <ledger.json> <project-root> <seeds.json> <shards>";
function shard(value: string) {
  if (!/^[1-8]$/.test(value)) throw new Error("分片必须是1..8的规范整数");
  return Number(value);
}
export function parseFormalCommand(args: readonly string[]): FormalCommand {
  if (args.length === 1 && ["seal", "verify", "finalize"].includes(args[0]))
    return { kind: args[0] as "seal" | "verify" | "finalize" };
  if (args.length === 2 && args[0] === "run")
    return { kind: "run", shard: shard(args[1]) };
  if (args.length === 5 && args[0] === "reserve")
    return {
      kind: "reserve",
      ledgerPath: args[1],
      projectRoot: args[2],
      seedsPath: args[3],
      shards: shard(args[4]),
    };
  throw new Error(usage);
}
export function parseFormalSeedList(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    new Set(value).size !== value.length ||
    value.some(
      (seed) => !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff,
    )
  )
    throw new Error("种子必须是唯一32位无符号整数数组");
  return [...value] as number[];
}

/** No CLI option injects services, chooses replacement seeds, or bypasses an audit. */
export async function runFormalCli(args: readonly string[], entryUrl: string) {
  const command = parseFormalCommand(args),
    entryPath = fileURLToPath(entryUrl),
    directory = resolve(dirname(entryPath), ".."),
    options = { directory, entryPath };
  // Both seal and all execution operations independently enforce the fixed .mjs path.
  if (command.kind === "seal") {
    const seal = await sealFormalCapsule(options);
    console.log(JSON.stringify({ sealed: true, planHash: seal.planHash }));
    return;
  }
  if (command.kind === "verify") {
    const capsule = await verifyFormalCapsule(options);
    console.log(
      JSON.stringify({
        verified: true,
        planHash: capsule.seal.planHash,
        sealSha256: capsule.sealSha256,
      }),
    );
    return;
  }
  const controller = createFormalController(options);
  if (command.kind === "reserve") {
    const seeds = parseFormalSeedList(
      JSON.parse(readFileSync(resolve(command.seedsPath), "utf8")),
    );
    const run = await controller.reserve({
      ledgerPath: command.ledgerPath,
      projectRoot: command.projectRoot,
      seeds,
      shards: command.shards,
    });
    console.log(
      JSON.stringify({
        reserved: true,
        planHash: run.planHash,
        seedCount: run.seeds.length,
        shardCount: run.shards.length,
      }),
    );
  } else if (command.kind === "run") {
    const completed = await controller.runShard(command.shard, console.log);
    console.log(
      JSON.stringify({
        shardComplete: completed.id,
        seedCount: completed.seeds.length,
      }),
    );
  } else {
    const result = await controller.finalize();
    console.log(
      JSON.stringify(
        result.complete
          ? {
              complete: true,
              executionAndStatisticalConditionsMet:
                result.executionAndStatisticalConditionsMet,
              expertStrengthEstablished: false,
              report: resolve(directory, "final-report.json"),
            }
          : result,
      ),
    );
  }
}
