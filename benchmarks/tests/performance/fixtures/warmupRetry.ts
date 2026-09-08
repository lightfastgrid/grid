import {
  requiredOperationsForPurpose,
  type SlotPurpose,
} from "../../../shared/src/filterScenarios.ts";
import { RUNTIME_OPERATION_IDS } from "../metrics/schema.ts";
import type { RuntimeProfile } from "./profiles.ts";

export const REQUIRED_WARMUP_OPERATIONS = RUNTIME_OPERATION_IDS;

export type WarmupSlotIdentity = {
  readonly lane: "react" | "vanilla";
  readonly appId: string;
  readonly lfgMode: string | null;
  readonly purpose: SlotPurpose;
  readonly round: number;
};

export type WarmupSampleLike = {
  readonly lane: "react" | "vanilla";
  readonly appId: string;
  readonly lfgMode?: string | null;
  readonly purpose?: SlotPurpose | null;
  readonly round: number;
  readonly role: "warmup" | "measured" | string;
  readonly operation: string;
  readonly valid: boolean;
  readonly warmupAttempt?: 0 | 1 | null;
};

export type WarmupDecision = "success" | "retry" | "exhaust" | "record-diagnostic";

export function shouldRetryWarmup(profile: Pick<RuntimeProfile, "statisticsRole">): boolean {
  return profile.statisticsRole === "public-candidate";
}

export function warmupSlotKey(slot: WarmupSlotIdentity): string {
  return `${slot.lane}:${slot.appId}:${slot.purpose}:${slot.lfgMode ?? "default"}:${slot.round}`;
}

export function warmupAttemptSucceeded(
  samples: readonly WarmupSampleLike[],
  requiredOps: readonly string[] = REQUIRED_WARMUP_OPERATIONS,
): boolean {
  return requiredOps.every((operation) =>
    samples.some((sample) => sample.operation === operation && sample.valid),
  );
}

export function nextWarmupDecision(options: {
  readonly retryAllowed: boolean;
  readonly attempt: 0 | 1;
  readonly succeeded: boolean;
}): WarmupDecision {
  if (options.succeeded) return "success";
  if (!options.retryAllowed) return "record-diagnostic";
  if (options.attempt === 0) return "retry";
  return "exhaust";
}

export function samplesForWarmupAttempt(
  samples: readonly WarmupSampleLike[],
  slot: WarmupSlotIdentity,
  attempt: 0 | 1,
): WarmupSampleLike[] {
  return samples.filter((sample) => {
    if (sample.role !== "warmup") return false;
    if (sample.lane !== slot.lane || sample.appId !== slot.appId || sample.round !== slot.round) {
      return false;
    }
    if ((sample.lfgMode ?? null) !== slot.lfgMode) return false;
    if (slot.purpose != null && (sample.purpose ?? slot.purpose) !== slot.purpose) return false;
    return (sample.warmupAttempt ?? 0) === attempt;
  });
}

export function warmupSlotSucceeded(
  samples: readonly WarmupSampleLike[],
  slot: WarmupSlotIdentity,
  requiredOps: readonly string[] = requiredOperationsForPurpose(slot.purpose ?? "competitive"),
): boolean {
  const attempts: Array<0 | 1> = [0, 1];
  return attempts.some((attempt) =>
    warmupAttemptSucceeded(samplesForWarmupAttempt(samples, slot, attempt), requiredOps),
  );
}

export function collectWarmupPublicationReasons(options: {
  readonly profile: Pick<RuntimeProfile, "statisticsRole">;
  readonly warmupSlots: readonly WarmupSlotIdentity[];
  readonly samples: readonly WarmupSampleLike[];
  readonly requiredOps?: readonly string[];
}): { readonly denied: string[]; readonly fatal: string[] } {
  const denied: string[] = [];
  const fatal: string[] = [];
  for (const slot of options.warmupSlots) {
    const requiredOps = options.requiredOps ?? requiredOperationsForPurpose(slot.purpose ?? "competitive");
    if (warmupSlotSucceeded(options.samples, slot, requiredOps)) continue;
    const label = `${slot.appId} ${slot.purpose} ${slot.lfgMode ?? "default"} round ${slot.round}`;
    const measuredReplaced = options.samples.some(
      (sample) =>
        sample.role === "measured" &&
        sample.lane === slot.lane &&
        sample.appId === slot.appId &&
        sample.round === slot.round &&
        (sample.lfgMode ?? null) === slot.lfgMode &&
        (sample.purpose ?? slot.purpose ?? "competitive") === (slot.purpose ?? "competitive"),
    );
    const reason = measuredReplaced
      ? `required warmup slot ${label} did not complete successfully; a later measured sample must not replace it`
      : `required warmup slot ${label} did not complete successfully`;
    if (!denied.includes(reason)) denied.push(reason);
    if (options.profile.statisticsRole === "public-candidate" && !fatal.includes(reason)) {
      fatal.push(reason);
    }
  }
  return { denied, fatal };
}

export { requiredOperationsForPurpose };
