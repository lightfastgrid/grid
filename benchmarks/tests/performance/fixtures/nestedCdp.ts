export type NestedCdpResponse = {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string; readonly code?: number };
};

export type WorkerThrottleAttempt = {
  readonly targetId: string;
  readonly sessionId: string;
  readonly url: string;
  readonly commandId: number;
  readonly acknowledged: boolean;
  readonly appliedRate: number | null;
  readonly failureReason: string | null;
  readonly acknowledgedBeforeTimedWork: boolean;
};

export type NestedCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
};

export function createMonotonicCdpCommandId(start = 1): () => number {
  let next = start;
  return () => {
    const id = next;
    next += 1;
    return id;
  };
}

export function parseNestedCdpMessage(raw: string): NestedCdpResponse | null {
  try {
    const parsed = JSON.parse(raw) as NestedCdpResponse;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function nestedCdpResponseSucceeded(parsed: NestedCdpResponse | null, commandId: number): boolean {
  if (!parsed || parsed.id !== commandId) return false;
  if (parsed.error) return false;
  return Object.prototype.hasOwnProperty.call(parsed, "result");
}

export function workerTargetIdentity(targetId: string, sessionId: string): string {
  return `${targetId}::${sessionId}`;
}

export function claimWorkerThrottleTarget(
  seen: Set<string>,
  targetId: string,
  sessionId: string,
): boolean {
  const identity = workerTargetIdentity(targetId, sessionId);
  if (seen.has(identity) || seen.has(`target:${targetId}`)) return false;
  seen.add(identity);
  seen.add(`target:${targetId}`);
  return true;
}

export type AwaitNestedAckOptions = {
  readonly session: NestedCdpSession;
  readonly sessionId: string;
  readonly targetId?: string;
  readonly commandId: number;
  readonly timeoutMs: number;
  readonly sendThrottle: () => Promise<void>;
};

export async function awaitNestedThrottleAcknowledgement(
  options: AwaitNestedAckOptions,
): Promise<{ ok: true } | { ok: false; failureReason: string }> {
  const { session, sessionId, commandId, timeoutMs } = options;
  let settled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let resolveWait: (value: { ok: true } | { ok: false; failureReason: string }) => void = () =>
    undefined;
  const wait = new Promise<{ ok: true } | { ok: false; failureReason: string }>((resolve) => {
    resolveWait = resolve;
  });

  const finish = (value: { ok: true } | { ok: false; failureReason: string }) => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    session.off?.("Target.receivedMessageFromTarget", handler);
    session.off?.("Target.detachedFromTarget", onDetach);
    session.off?.("Target.targetDestroyed", onDestroy);
    resolveWait(value);
  };

  const handler = (payload: unknown) => {
    const event = payload as { sessionId?: string; message?: string };
    if (event.sessionId !== sessionId) return;
    if (typeof event.message !== "string") return;
    const parsed = parseNestedCdpMessage(event.message);
    if (parsed?.id !== commandId) return;
    if (parsed.error) {
      finish({
        ok: false,
        failureReason: parsed.error.message ?? "nested CDP error",
      });
      return;
    }
    if (!nestedCdpResponseSucceeded(parsed, commandId)) {
      finish({
        ok: false,
        failureReason: "nested CDP response did not include a successful result",
      });
      return;
    }
    finish({ ok: true });
  };

  const onDetach = (payload: unknown) => {
    const event = payload as { sessionId?: string };
    if (event.sessionId !== sessionId) return;
    finish({
      ok: false,
      failureReason: "Worker target detached before throttle acknowledgement",
    });
  };

  const onDestroy = (payload: unknown) => {
    const event = payload as { targetId?: string };
    if (!options.targetId || event.targetId !== options.targetId) return;
    finish({
      ok: false,
      failureReason: "Worker target closed before throttle acknowledgement",
    });
  };

  session.on("Target.receivedMessageFromTarget", handler);
  session.on("Target.detachedFromTarget", onDetach);
  session.on("Target.targetDestroyed", onDestroy);
  timeoutHandle = setTimeout(() => {
    finish({
      ok: false,
      failureReason: `Worker throttle acknowledgement timed out after ${timeoutMs}ms`,
    });
  }, timeoutMs);

  try {
    await options.sendThrottle();
  } catch (error) {
    finish({
      ok: false,
      failureReason: error instanceof Error ? error.message : String(error),
    });
  }

  return wait;
}

export function mergeWorkerThrottleAttempts(
  attempts: readonly WorkerThrottleAttempt[],
  required: boolean,
): {
  confirmedEquivalentToPage: boolean;
  failureReason: string | null;
} {
  if (!required) {
    return { confirmedEquivalentToPage: true, failureReason: null };
  }
  if (attempts.length === 0) {
    return {
      confirmedEquivalentToPage: false,
      failureReason: "Worker throttle was required but no Quick Search Worker target was acknowledged",
    };
  }
  const failed = attempts.find((attempt) => !attempt.acknowledged);
  if (failed) {
    return {
      confirmedEquivalentToPage: false,
      failureReason:
        failed.failureReason ??
        `Worker target ${failed.targetId} did not acknowledge Emulation.setCPUThrottlingRate`,
    };
  }
  return { confirmedEquivalentToPage: true, failureReason: null };
}

export function allRequiredWorkerSlotsAcknowledged(
  slots: ReadonlyArray<{ required: boolean; confirmedEquivalentToPage: boolean }>,
): boolean {
  const required = slots.filter((slot) => slot.required);
  if (required.length === 0) return true;
  return required.every((slot) => slot.confirmedEquivalentToPage);
}
