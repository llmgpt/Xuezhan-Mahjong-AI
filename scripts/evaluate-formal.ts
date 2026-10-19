import { runFormalCli } from "./formalCli";

await runFormalCli(process.argv.slice(2), import.meta.url);
