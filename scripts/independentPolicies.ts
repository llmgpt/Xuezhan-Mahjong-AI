import type { DecisionAction } from "../src/game/decision";
import type { Phase } from "../src/game/game";
import { immediateWinChoice } from "../src/game/immediateWin";
import {
  evaluateRolloutDecision,
  type RolloutDecision,
} from "../src/game/rolloutTeacher";
import { chooseStrongAction } from "../src/game/strongTeacher";
import { chooseTeacherAction } from "../src/game/teacher";
import type { PlayerView } from "../src/game/view";
import {
  ExternalMahjongWorker,
  type ExternalMahjongOptions,
} from "./externalMahjong";
import type { Policy } from "./independentRunner";

export const INDEPENDENT_POLICY_IDS = [
  "teacher-v1",
  "candidate-v2",
  "candidate-rollout-v3",
  "candidate-advanced-hu-v4",
  "ebony-initial",
  "ebony72-advanced-public-v1",
] as const;
export type IndependentPolicyId = (typeof INDEPENDENT_POLICY_IDS)[number];

// Fixed seat vectors. Internal opponents are sensitivity controls, not additional
// independent references or evidence of expert playing strength.
export const INDEPENDENT_LINEUPS = {
  "ebony-initial": [
    "ebony-initial",
    "ebony-initial",
    "ebony-initial",
    "ebony-initial",
  ],
  "teacher-v1": ["teacher-v1", "teacher-v1", "teacher-v1", "teacher-v1"],
  "ebony-advanced": [
    "ebony72-advanced-public-v1",
    "ebony72-advanced-public-v1",
    "ebony72-advanced-public-v1",
    "ebony72-advanced-public-v1",
  ],
} as const satisfies Record<string, readonly IndependentPolicyId[]>;

interface Worker {
  act: (view: PlayerView, phase: Phase) => Promise<DecisionAction>;
  close: () => Promise<void>;
  finish?: () => Promise<void>;
}

export interface PolicySession {
  choose: Policy;
  close: () => Promise<void>;
  finish: () => Promise<void>;
}

export function resolveLineup(name: string): readonly IndependentPolicyId[] {
  if (!Object.hasOwn(INDEPENDENT_LINEUPS, name))
    throw new Error(`未知对手 ${name}`);
  return INDEPENDENT_LINEUPS[name as keyof typeof INDEPENDENT_LINEUPS];
}

export function createPolicySession(
  name: string,
  options: {
    timeoutMs?: number;
    workerFactory?: (options: ExternalMahjongOptions) => Worker;
    onEvaluation?: (report: RolloutDecision) => void;
  } = {},
): PolicySession {
  if (!INDEPENDENT_POLICY_IDS.includes(name as IndependentPolicyId))
    throw new Error(`未知策略 ${name}`);
  let worker: Worker | undefined;
  let closed = false;
  let seat: number | undefined;
  return {
    choose: async (view, phase) => {
      if (closed) throw new Error("策略会话已关闭");
      seat ??= view.seat;
      if (seat !== view.seat)
        throw new Error("一个策略会话不能读取不同座位的暗牌");
      if (name === "teacher-v1") return chooseTeacherAction(view, phase);
      if (name === "candidate-v2") return chooseStrongAction(view, phase);
      if (name === "candidate-rollout-v3") {
        const report = evaluateRolloutDecision(view, phase);
        options.onEvaluation?.(structuredClone(report));
        return report.choices[0]?.action;
      }
      if (name === "candidate-advanced-hu-v4") {
        const win = immediateWinChoice(view, phase);
        if (win) return win.action;
      }
      // Upstream has no exchange implementation. The composite strategy states
      // this shared exchange explicitly; daquex and all later decisions are external.
      if (phase === "exchange") return chooseTeacherAction(view, phase);
      const workerOptions: ExternalMahjongOptions = {
        timeoutMs: options.timeoutMs,
        policy:
          name === "ebony72-advanced-public-v1" ||
          name === "candidate-advanced-hu-v4"
            ? "ebony72-advanced-public-v1"
            : undefined,
      };
      worker ??=
        options.workerFactory?.(workerOptions) ??
        new ExternalMahjongWorker(workerOptions);
      return worker.act(view, phase);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await worker?.close();
    },
    finish: async () => {
      if (closed) throw new Error("策略会话已关闭");
      if (worker?.finish) await worker.finish();
      else await worker?.close();
      closed = true;
    },
  };
}
