import type { CDPSession, Page } from "@playwright/test";

import {
  allRequiredWorkerSlotsAcknowledged,
  awaitNestedThrottleAcknowledgement,
  createMonotonicCdpCommandId,
  mergeWorkerThrottleAttempts,
  claimWorkerThrottleTarget,
  type NestedCdpSession,
  type WorkerThrottleAttempt,
} from "./nestedCdp.ts";
import {
  NATIVE_CPU_THROTTLE_RATE,
  REQUESTED_CPU_THROTTLE_RATE,
  type CpuThrottlePolicy,
} from "./profiles.ts";

export type { WorkerThrottleAttempt };

export type WorkerCpuThrottleResult = {
  readonly attempted: boolean;
  readonly required: boolean;
  readonly targetsThrottled: number;
  readonly targetUrls: readonly string[];
  readonly attempts: readonly WorkerThrottleAttempt[];
  readonly appliedRate: number | null;
  readonly confirmedEquivalentToPage: boolean;
  readonly failureReason: string | null;
  readonly equalComputePolicy: "cdp-worker-ack" | "native-unthrottled" | "unconfirmed";
};

export type CpuThrottleResult = {
  readonly requestedRate: number;
  readonly appliedRate: number | null;
  readonly cdpAvailable: boolean;
  readonly appliedBeforeTimedWork: boolean;
  readonly failureReason: string | null;
  readonly chromiumProduct: string | null;
  readonly policy: CpuThrottlePolicy;
  readonly cdpThrottleApplied: boolean;
  readonly equalComputeNote: string | null;
  readonly workerThrottle: WorkerCpuThrottleResult;
};

export type CpuThrottleHandle = {
  snapshot(): CpuThrottleResult;
  refresh(): Promise<CpuThrottleResult>;
};

const ACK_TIMEOUT_MS = 2_000;

const NATIVE_EQUAL_COMPUTE_NOTE =
  "Native 1x: CDP CPU throttling was not applied to the page or Worker. Equal compute is native machine speed. This does not prove 4x throttled performance.";

const emptyWorkerThrottle = (
  failureReason: string | null,
  required: boolean,
  equalComputePolicy: WorkerCpuThrottleResult["equalComputePolicy"] = required
    ? "unconfirmed"
    : "native-unthrottled",
): WorkerCpuThrottleResult => ({
  attempted: false,
  required,
  targetsThrottled: 0,
  targetUrls: [],
  attempts: [],
  appliedRate: null,
  confirmedEquivalentToPage: !required,
  failureReason,
  equalComputePolicy: required ? (failureReason ? "unconfirmed" : equalComputePolicy) : "native-unthrottled",
});

function isQuickSearchWorkerTarget(url: string, type: string): boolean {
  return (
    (type === "worker" || type === "shared_worker") &&
    /quickSearchWorker|quickSearch|quick-search|QuickSearch/i.test(url)
  );
}

function toNestedSession(session: CDPSession): NestedCdpSession {
  return {
    send: (method, params) => session.send(method as "Target.activateTarget", params as never),
    on: (event, handler) => {
      session.on(event as "Target.attachedToTarget", handler as never);
    },
    off: (event, handler) => {
      session.off(event as "Target.attachedToTarget", handler as never);
    },
  };
}

function summarizeAttempts(
  attempts: readonly WorkerThrottleAttempt[],
  required: boolean,
  attempted: boolean,
  rate: number,
): WorkerCpuThrottleResult {
  const merged = mergeWorkerThrottleAttempts(attempts, required);
  const urls = [...new Set(attempts.map((attempt) => attempt.url))];
  return {
    attempted,
    required,
    targetsThrottled: attempts.filter((attempt) => attempt.acknowledged).length,
    targetUrls: urls,
    attempts,
    appliedRate: merged.confirmedEquivalentToPage && required ? rate : required ? null : rate,
    confirmedEquivalentToPage: merged.confirmedEquivalentToPage,
    failureReason: merged.failureReason,
    equalComputePolicy: merged.confirmedEquivalentToPage
      ? required
        ? "cdp-worker-ack"
        : "native-unthrottled"
      : "unconfirmed",
  };
}

export async function applyCpuThrottling(
  page: Page,
  rate = REQUESTED_CPU_THROTTLE_RATE,
  options?: {
    readonly workerThrottleRequired?: boolean;
    readonly applyCdpThrottle?: boolean;
    readonly policy?: CpuThrottlePolicy;
  },
): Promise<CpuThrottleHandle> {
  const policy: CpuThrottlePolicy = options?.policy ?? (rate <= 1 ? "native-1x" : "cdp-4x");
  const applyCdpThrottle = options?.applyCdpThrottle ?? policy === "cdp-4x";

  if (!applyCdpThrottle) {
    let chromiumProduct: string | null = null;
    let cdpAvailable = false;
    try {
      const session = await page.context().newCDPSession(page);
      cdpAvailable = true;
      try {
        const info = await session.send("Browser.getVersion");
        chromiumProduct = typeof info.product === "string" ? info.product : null;
      } catch {
        chromiumProduct = null;
      }
    } catch {
      cdpAvailable = false;
    }
    const snapshot = (): CpuThrottleResult => ({
      requestedRate: NATIVE_CPU_THROTTLE_RATE,
      appliedRate: NATIVE_CPU_THROTTLE_RATE,
      cdpAvailable,
      appliedBeforeTimedWork: true,
      failureReason: null,
      chromiumProduct,
      policy: "native-1x",
      cdpThrottleApplied: false,
      equalComputeNote: NATIVE_EQUAL_COMPUTE_NOTE,
      workerThrottle: emptyWorkerThrottle(null, false, "native-unthrottled"),
    });
    return { snapshot, refresh: async () => snapshot() };
  }

  const workerThrottleRequired = options?.workerThrottleRequired === true;
  const nextCommandId = createMonotonicCdpCommandId(1);
  const attempts: WorkerThrottleAttempt[] = [];
  const seen = new Set<string>();
  let workerAttempted = false;

  const failed = (failureReason: string): CpuThrottleHandle => {
    const snapshot = (): CpuThrottleResult => ({
      requestedRate: rate,
      appliedRate: null,
      cdpAvailable: !/newCDPSession|CDP session/i.test(failureReason),
      appliedBeforeTimedWork: false,
      failureReason,
      chromiumProduct: null,
      policy,
      cdpThrottleApplied: false,
      equalComputeNote: null,
      workerThrottle: emptyWorkerThrottle(failureReason, workerThrottleRequired),
    });
    return { snapshot, refresh: async () => snapshot() };
  };

  try {
    const session = await page.context().newCDPSession(page);
    const nested = toNestedSession(session);
    await session.send("Emulation.setCPUThrottlingRate", { rate });
    let chromiumProduct: string | null = null;
    try {
      const info = await session.send("Browser.getVersion");
      chromiumProduct = typeof info.product === "string" ? info.product : null;
    } catch {
      chromiumProduct = null;
    }

    const sendNested = async (sessionId: string, method: string, params: Record<string, unknown>, id = nextCommandId()) => {
      await session.send("Target.sendMessageToTarget" as "Target.activateTarget", {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      } as never);
    };

    const resumeTarget = async (sessionId: string): Promise<void> => {
      try {
        await sendNested(sessionId, "Runtime.runIfWaitingForDebugger", {});
      } catch {
        // Resume best-effort so a failed throttle does not pin the Worker.
      }
    };

    const inFlight = new Set<Promise<void>>();
    const track = (work: Promise<void>) => {
      inFlight.add(work);
      void work.finally(() => inFlight.delete(work));
    };
    const waitForInFlight = async () => {
      while (inFlight.size > 0) {
        await Promise.all([...inFlight]);
      }
    };

    const throttleAttached = async (
      targetId: string,
      url: string,
      sessionId: string | undefined,
      beforeTimedWork: boolean,
    ): Promise<void> => {
      workerAttempted = true;
      if (!sessionId) {
        attempts.push({
          targetId,
          sessionId: "",
          url,
          commandId: -1,
          acknowledged: false,
          appliedRate: null,
          failureReason: "Quick Search Worker attached without a CDP sessionId",
          acknowledgedBeforeTimedWork: false,
        });
        return;
      }
      if (!claimWorkerThrottleTarget(seen, targetId, sessionId)) {
        await resumeTarget(sessionId);
        return;
      }
      const commandId = nextCommandId();
      const ack = await awaitNestedThrottleAcknowledgement({
        session: nested,
        sessionId,
        targetId,
        commandId,
        timeoutMs: ACK_TIMEOUT_MS,
        sendThrottle: async () => {
          await sendNested(sessionId, "Emulation.setCPUThrottlingRate", { rate }, commandId);
        },
      });
      attempts.push({
        targetId,
        sessionId,
        url,
        commandId,
        acknowledged: ack.ok,
        appliedRate: ack.ok ? rate : null,
        failureReason: ack.ok ? null : ack.failureReason,
        acknowledgedBeforeTimedWork: ack.ok && beforeTimedWork,
      });
      await resumeTarget(sessionId);
    };

    try {
      if (workerThrottleRequired) {
        session.on(
          "Target.attachedToTarget",
          (event: {
            sessionId?: string;
            waitingForDebugger?: boolean;
            targetInfo?: { targetId?: string; type?: string; url?: string };
          }) => {
            const info = event.targetInfo;
            if (!info) return;
            const url = info.url ?? "";
            const type = info.type ?? "";
            if (!isQuickSearchWorkerTarget(url, type)) {
              if (event.sessionId) track(resumeTarget(event.sessionId));
              return;
            }
            track(throttleAttached(info.targetId ?? url, url, event.sessionId, true));
          },
        );
        try {
          await session.send("Target.setAutoAttach", {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: false,
            filter: [{ type: "worker" }, { type: "shared_worker" }],
          });
        } catch {
          await session.send("Target.setAutoAttach", {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: false,
          });
        }
        await waitForInFlight();
      }
    } catch (error) {
      workerAttempted = true;
      attempts.push({
        targetId: "",
        sessionId: "",
        url: "",
        commandId: -1,
        acknowledged: false,
        appliedRate: null,
        failureReason: error instanceof Error ? error.message : String(error),
        acknowledgedBeforeTimedWork: false,
      });
    }

    const pageResult = (): Omit<CpuThrottleResult, "workerThrottle"> => ({
      requestedRate: rate,
      appliedRate: rate,
      cdpAvailable: true,
      appliedBeforeTimedWork: true,
      failureReason: null,
      chromiumProduct,
      policy,
      cdpThrottleApplied: true,
      equalComputeNote: null,
    });

    const snapshot = (): CpuThrottleResult => ({
      ...pageResult(),
      workerThrottle: summarizeAttempts(attempts, workerThrottleRequired, workerAttempted, rate),
    });

    return {
      snapshot,
      async refresh() {
        await waitForInFlight();
        return snapshot();
      },
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

export function mergeThrottleResults(
  results: readonly CpuThrottleResult[],
): CpuThrottleResult {
  if (results.length === 0) {
    return {
      requestedRate: REQUESTED_CPU_THROTTLE_RATE,
      appliedRate: null,
      cdpAvailable: false,
      appliedBeforeTimedWork: false,
      failureReason: "CPU throttling was never attempted",
      chromiumProduct: null,
      policy: "cdp-4x",
      cdpThrottleApplied: false,
      equalComputeNote: null,
      workerThrottle: emptyWorkerThrottle("CPU throttling was never attempted", true),
    };
  }
  const failed = results.find((result) => result.appliedRate !== result.requestedRate);
  const attempts = results.flatMap((result) => [...result.workerThrottle.attempts]);
  const requiredSlots = results.map((result) => ({
    required: result.workerThrottle.required,
    confirmedEquivalentToPage: result.workerThrottle.confirmedEquivalentToPage,
  }));
  const allAcknowledged = allRequiredWorkerSlotsAcknowledged(requiredSlots);
  const workerFailure =
    results
      .filter((result) => result.workerThrottle.required && !result.workerThrottle.confirmedEquivalentToPage)
      .map((result) => result.workerThrottle.failureReason)
      .find((reason) => reason != null) ?? null;
  const base = failed ?? results[0]!;
  const urls = [...new Set(attempts.map((attempt) => attempt.url))];
  const native = base.policy === "native-1x" || results.every((result) => result.cdpThrottleApplied === false);
  const required = requiredSlots.some((slot) => slot.required);
  return {
    ...base,
    policy: native ? "native-1x" : "cdp-4x",
    cdpThrottleApplied: results.some((result) => result.cdpThrottleApplied === true),
    equalComputeNote: native ? NATIVE_EQUAL_COMPUTE_NOTE : base.equalComputeNote ?? null,
    workerThrottle: {
      attempted: results.some((result) => result.workerThrottle.attempted),
      required,
      targetsThrottled: attempts.filter((attempt) => attempt.acknowledged).length,
      targetUrls: urls,
      attempts,
      appliedRate: allAcknowledged && required ? (base.requestedRate ?? REQUESTED_CPU_THROTTLE_RATE) : required ? null : base.requestedRate,
      confirmedEquivalentToPage: allAcknowledged,
      failureReason: allAcknowledged
        ? null
        : workerFailure ?? "Quick Search Worker CPU throttle was not acknowledged on every required slot",
      equalComputePolicy: native
        ? "native-unthrottled"
        : allAcknowledged && required
          ? "cdp-worker-ack"
          : "unconfirmed",
    },
  };
}

export function equalComputeConfirmed(cpuThrottle: CpuThrottleResult): boolean {
  if (cpuThrottle.policy === "native-1x") {
    return cpuThrottle.cdpThrottleApplied !== true && cpuThrottle.requestedRate === NATIVE_CPU_THROTTLE_RATE;
  }
  return cpuThrottle.workerThrottle.confirmedEquivalentToPage === true;
}

export function workerThrottleRequiredForSlot(lfgMode: string | null | undefined): boolean {
  return lfgMode === "workerIsolated" || lfgMode === "workerProductionOptimized";
}
