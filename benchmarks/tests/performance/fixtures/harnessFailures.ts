export const HARNESS_PHASES = [
  "context-create",
  "preview-start",
  "page-create",
  "guard-attach",
  "navigation",
  "protocol-discovery",
  "throttling",
  "preparation",
  "operation",
  "teardown",
  "evidence-write",
] as const;

export type HarnessPhase = (typeof HARNESS_PHASES)[number];

export type HarnessFailure = {
  readonly lane: "react" | "vanilla" | null;
  readonly appId: string | null;
  readonly round: number | null;
  readonly slotIndex: number | null;
  readonly lfgMode?: string | null;
  readonly warmupAttempt?: 0 | 1 | null;
  readonly phase: HarnessPhase;
  readonly message: string;
  readonly stack: string | null;
  readonly secondary?: boolean;
  readonly recovered?: boolean;
};

export class HarnessPhaseError extends Error {
  readonly harnessPhase: HarnessPhase;
  readonly causeError: unknown;

  constructor(phase: HarnessPhase, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    super(message);
    this.name = "HarnessPhaseError";
    this.harnessPhase = phase;
    this.causeError = error;
    if (error instanceof Error && error.stack) {
      this.stack = error.stack;
    }
  }
}

export function harnessPhaseOf(error: unknown): HarnessPhase | null {
  if (error instanceof HarnessPhaseError) return error.harnessPhase;
  if (error && typeof error === "object" && "harnessPhase" in error) {
    const phase = (error as { harnessPhase?: unknown }).harnessPhase;
    if (typeof phase === "string" && (HARNESS_PHASES as readonly string[]).includes(phase)) {
      return phase as HarnessPhase;
    }
  }
  return null;
}

export function harnessFailureFrom(
  error: unknown,
  context: {
    readonly phase?: HarnessPhase;
    readonly lane?: "react" | "vanilla" | null;
    readonly appId?: string | null;
    readonly round?: number | null;
    readonly slotIndex?: number | null;
    readonly lfgMode?: string | null;
    readonly warmupAttempt?: 0 | 1 | null;
    readonly secondary?: boolean;
    readonly recovered?: boolean;
  },
): HarnessFailure {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    lane: context.lane ?? null,
    appId: context.appId ?? null,
    round: context.round ?? null,
    slotIndex: context.slotIndex ?? null,
    lfgMode: context.lfgMode ?? null,
    warmupAttempt: context.warmupAttempt ?? null,
    phase: context.phase ?? harnessPhaseOf(error) ?? "operation",
    message: err.message,
    stack: err.stack ?? null,
    secondary: context.secondary === true ? true : undefined,
    recovered: context.recovered === true ? true : undefined,
  };
}

export function formatHarnessFatalReason(failure: HarnessFailure): string {
  return `harness ${failure.phase}: ${failure.message}`;
}

export function rootHarnessFailure(
  failures: readonly HarnessFailure[],
): HarnessFailure | undefined {
  return failures.find((failure) => failure.secondary !== true && failure.recovered !== true);
}

export type WarmupRecoveryIdentity = {
  readonly lane: "react" | "vanilla" | null;
  readonly appId: string | null;
  readonly lfgMode: string | null;
  readonly round: number | null;
  readonly slotIndex: number | null;
  readonly warmupAttempt: 0;
};

export function markSlotFailuresRecovered(
  failures: HarnessFailure[],
  identity: WarmupRecoveryIdentity,
): void {
  for (let index = 0; index < failures.length; index += 1) {
    const failure = failures[index]!;
    if (failure.secondary === true || failure.recovered === true) continue;
    if (failure.warmupAttempt !== 0) continue;
    if (failure.lane !== identity.lane) continue;
    if (failure.appId !== identity.appId) continue;
    if ((failure.lfgMode ?? null) !== identity.lfgMode) continue;
    if (failure.round !== identity.round) continue;
    if (failure.slotIndex !== identity.slotIndex) continue;
    failures[index] = { ...failure, recovered: true };
  }
}

export function throwPreservingOriginal(original: unknown, extra: unknown): never {
  if (extra == null) {
    throw original;
  }
  if (original == null) {
    throw extra;
  }
  const first = original instanceof Error ? original : new Error(String(original));
  const second = extra instanceof Error ? extra : new Error(String(extra));
  throw new AggregateError(
    [first, second],
    `${first.message}; evidence write also failed: ${second.message}`,
  );
}

export function failAfterEvidenceWrite(runError: unknown, writeError: unknown): void {
  if (writeError && runError) {
    throwPreservingOriginal(runError, writeError);
  }
  if (writeError) {
    throw writeError instanceof Error ? writeError : new Error(String(writeError));
  }
  if (runError) {
    throw runError;
  }
}
