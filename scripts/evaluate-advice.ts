import type { TeacherPolicies } from "./benchmarkPolicies";
import { parseBenchmarkConfig, runBenchmark } from "./benchmarkRunner";

const config = parseBenchmarkConfig(process.env);
const teachers: TeacherPolicies = {};
if (
  config.policies.includes("teacher-candidate") ||
  config.policies.includes("teacher-legacy-discard")
) {
  const { chooseTeacherAction } = await import("../src/game/teacher");
  teachers.teacherCandidate = chooseTeacherAction;
  teachers.teacherLegacyDiscard = (view, phase) =>
    chooseTeacherAction(view, phase, { discardMode: "legacy" });
}
console.log(JSON.stringify(runBenchmark(config, teachers), null, 2));
