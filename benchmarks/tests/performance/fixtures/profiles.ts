import { RUNTIME_OPERATIONS } from "../../../shared/src/expectedOperations.ts";
import {
  assertCanonicalPublicScenario,
} from "../../../shared/src/canonicalPublicScenario.ts";
import { getScenario } from "../../../shared/src/scenarios.ts";

export const LIGHTFASTGRID_WORKER_ELIGIBILITY_ROWS = 25_000;
export const SCHEDULE_SEED = 20260906;
export const REQUESTED_CPU_THROTTLE_RATE = 4;
export const NATIVE_CPU_THROTTLE_RATE = 1;

export type RuntimeProfileId = "smoke" | "publish" | "publish-native" | "trace";
export type CpuThrottlePolicy = "cdp-4x" | "native-1x";

export type RuntimeProfile = {
  readonly id: RuntimeProfileId;
  readonly scenario: string;
  readonly warmupRounds: number;
  readonly measuredRounds: number;
  readonly cpuThrottleRate: number;
  readonly cpuThrottleRequired: boolean;
  readonly cpuThrottlePolicy: CpuThrottlePolicy;
  readonly protocolTimeoutMs: number;
  readonly statisticsRole: "diagnostic" | "public-candidate";
  readonly tracing: boolean;
  readonly workerEligibilityNote: string;
};

function publishMeasuredRounds(): number {
  const raw = Number(process.env.LFG_BENCH_PUBLISH_ITERATIONS ?? 20);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(10, Math.min(20, Math.floor(raw)));
}

const publishSchedule = {
  scenario: "runtime-publish",
  warmupRounds: 3,
  measuredRounds: publishMeasuredRounds(),
  protocolTimeoutMs: 180_000,
  statisticsRole: "public-candidate" as const,
  tracing: false,
  workerEligibilityNote:
    "100,000 rows is above the 25,000-row Worker eligibility threshold. Eligibility is not proof of the execution producer.",
};

export const RUNTIME_PROFILES: Record<RuntimeProfileId, RuntimeProfile> = {
  smoke: {
    id: "smoke",
    scenario: "normal",
    warmupRounds: 1,
    measuredRounds: 1,
    cpuThrottleRate: REQUESTED_CPU_THROTTLE_RATE,
    cpuThrottleRequired: false,
    cpuThrottlePolicy: "cdp-4x",
    protocolTimeoutMs: 30_000,
    statisticsRole: "diagnostic",
    tracing: false,
    workerEligibilityNote:
      "Smoke uses 10,000 rows, below the 25,000-row LightFastGrid sort/filter/Quick Search Worker threshold. It is not Worker performance evidence.",
  },
  publish: {
    id: "publish",
    ...publishSchedule,
    cpuThrottleRate: REQUESTED_CPU_THROTTLE_RATE,
    cpuThrottleRequired: true,
    cpuThrottlePolicy: "cdp-4x",
  },
  "publish-native": {
    id: "publish-native",
    ...publishSchedule,
    cpuThrottleRate: NATIVE_CPU_THROTTLE_RATE,
    cpuThrottleRequired: false,
    cpuThrottlePolicy: "native-1x",
  },
  trace: {
    id: "trace",
    scenario: "normal",
    warmupRounds: 0,
    measuredRounds: 1,
    cpuThrottleRate: REQUESTED_CPU_THROTTLE_RATE,
    cpuThrottleRequired: false,
    cpuThrottlePolicy: "cdp-4x",
    protocolTimeoutMs: 30_000,
    statisticsRole: "diagnostic",
    tracing: true,
    workerEligibilityNote:
      "Trace mode captures one identified iteration. Tracing changes performance and is excluded from published timings.",
  },
};

export function isPublicCandidateProfile(id: RuntimeProfileId | string): boolean {
  return id === "publish" || id === "publish-native";
}

export function resolveRuntimeProfile(name = process.env.LFG_BENCH_PROFILE): RuntimeProfile {
  const id =
    name === "smoke" || name === "publish" || name === "publish-native" || name === "trace"
      ? name
      : "publish";
  const profile = RUNTIME_PROFILES[id];
  const scenario = getScenario(profile.scenario);
  assertCanonicalPublicScenario(profile.id, {
    name: profile.scenario,
    rowCount: scenario.rowCount,
    columnCount: scenario.columnCount,
  });
  return profile;
}

export { RUNTIME_OPERATIONS };
