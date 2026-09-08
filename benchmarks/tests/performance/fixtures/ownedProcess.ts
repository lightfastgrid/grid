import { type ChildProcess } from "node:child_process";

export const TERM_WAIT_MS = 2_000;
export const KILL_WAIT_MS = 2_000;
export const STDIO_BUFFER_LIMIT = 16 * 1024;

export type ChildExit = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
};

export type OwnedProcess = {
  readonly pid: number;
  readonly child: ChildProcess;
  readonly label: string;
  readonly processGroup: boolean;
  readonly exit: Promise<ChildExit>;
  exitResult: ChildExit | null;
  stopping: Promise<void> | null;
  stopped: boolean;
};

const owned = new Map<number, OwnedProcess>();
let interruptHandlersInstalled = false;

export function appendBounded(current: string, chunk: Buffer | string, limit = STDIO_BUFFER_LIMIT): string {
  const next = current + String(chunk);
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sendSignalToOwnedPid(pid: number, signal: NodeJS.Signals, processGroup: boolean): void {
  try {
    if (processGroup) process.kill(-pid, signal);
    else process.kill(pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

export function waitForChildExit(child: ChildProcess): Promise<ChildExit> {
  return new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function waitForExitOrTimeout(handle: OwnedProcess, timeoutMs: number): Promise<boolean> {
  if (handle.exitResult) return true;
  return Promise.race([
    handle.exit.then(() => true),
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => resolve(Boolean(handle.exitResult) || !isPidAlive(handle.pid)),
        timeoutMs,
      );
      timer.unref?.();
    }),
  ]);
}

export function registerOwnedProcess(handle: OwnedProcess): void {
  owned.set(handle.pid, handle);
  installInterruptHandlers();
}

export function unregisterOwnedProcess(pid: number): void {
  owned.delete(pid);
}

export function ownedProcessCount(): number {
  return owned.size;
}

export function ownedProcessPids(): number[] {
  return [...owned.keys()];
}

export function trackChildProcess(
  child: ChildProcess,
  label: string,
  processGroup: boolean,
): OwnedProcess {
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    throw new Error(`${label} spawned without a pid`);
  }
  const handle: OwnedProcess = {
    pid,
    child,
    label,
    processGroup,
    exit: waitForChildExit(child).then((result) => {
      handle.exitResult = result;
      unregisterOwnedProcess(handle.pid);
      return result;
    }),
    exitResult: null,
    stopping: null,
    stopped: false,
  };
  if (child.exitCode != null || child.signalCode) {
    handle.exitResult = { code: child.exitCode, signal: child.signalCode };
  }
  registerOwnedProcess(handle);
  return handle;
}

export async function stopOwnedProcess(handle: OwnedProcess): Promise<void> {
  if (handle.stopping) return handle.stopping;
  handle.stopping = stopOwnedProcessOnce(handle);
  try {
    await handle.stopping;
  } catch (error) {
    handle.stopping = null;
    if (!isPidAlive(handle.pid)) {
      handle.stopped = true;
      unregisterOwnedProcess(handle.pid);
      return;
    }
    throw error;
  }
}

async function stopOwnedProcessOnce(handle: OwnedProcess): Promise<void> {
  if (handle.stopped || handle.exitResult || !isPidAlive(handle.pid)) {
    handle.stopped = true;
    unregisterOwnedProcess(handle.pid);
    return;
  }
  sendSignalToOwnedPid(handle.pid, "SIGTERM", handle.processGroup);
  const termExited = await waitForExitOrTimeout(handle, TERM_WAIT_MS);
  if (!termExited && (handle.exitResult == null && isPidAlive(handle.pid))) {
    sendSignalToOwnedPid(handle.pid, "SIGKILL", handle.processGroup);
    const killExited = await waitForExitOrTimeout(handle, KILL_WAIT_MS);
    if (!killExited && handle.exitResult == null && isPidAlive(handle.pid)) {
      throw new Error(
        `${handle.label} pid ${handle.pid} did not exit after SIGTERM and SIGKILL`,
      );
    }
  }
  if (handle.exitResult == null) {
    await Promise.race([
      handle.exit,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        timer.unref?.();
      }),
    ]);
  }
  if (handle.exitResult == null && isPidAlive(handle.pid)) {
    throw new Error(`${handle.label} pid ${handle.pid} stop sent a signal but exit was not confirmed`);
  }
  handle.stopped = true;
  unregisterOwnedProcess(handle.pid);
}

export async function stopAllOwnedProcesses(): Promise<void> {
  const handles = [...owned.values()];
  const results = await Promise.allSettled(handles.map((handle) => stopOwnedProcess(handle)));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(
      `failed to stop ${failures.length} owned process(es): ${failures
        .map((failure) => (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)))
        .join("; ")}`,
    );
  }
}

export const INTERRUPT_STATUS = {
  SIGINT: 130,
  SIGTERM: 143,
} as const;

export type InterruptHooks = {
  readonly stopAll?: () => Promise<void>;
  readonly exit?: (code: number) => void;
  readonly writeStderr?: (text: string) => void;
};

let interruptShutdown: Promise<void> | null = null;
let interruptCleanupRuns = 0;
let beforeExitSignaled = false;
let interruptStopAllOverride: (() => Promise<void>) | null = null;

export function interruptCleanupRunCount(): number {
  return interruptCleanupRuns;
}

export function resetInterruptStateForTest(): void {
  interruptShutdown = null;
  interruptCleanupRuns = 0;
  beforeExitSignaled = false;
  interruptStopAllOverride = null;
}

export function setInterruptStopAllForTest(fn: (() => Promise<void>) | null): void {
  interruptStopAllOverride = fn;
}

function interruptStatusOf(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? INTERRUPT_STATUS.SIGINT : INTERRUPT_STATUS.SIGTERM;
}

/**
 * Shared SIGINT/SIGTERM handler. First signal awaits owned-process stop then
 * exits 130/143. A second signal force-exits without running cleanup again.
 * Does not swallow cleanup errors: they are written to stderr, then the
 * process still exits.
 */
export function handleHarnessInterrupt(signal: NodeJS.Signals, hooks?: InterruptHooks): void {
  const status = interruptStatusOf(signal);
  const exit = hooks?.exit ?? ((code: number) => {
    process.exit(code);
  });
  const writeStderr =
    hooks?.writeStderr ??
    ((text: string) => {
      process.stderr.write(text);
    });
  const stopAll = hooks?.stopAll ?? interruptStopAllOverride ?? stopAllOwnedProcesses;

  if (interruptShutdown) {
    exit(status);
    return;
  }

  interruptShutdown = (async () => {
    interruptCleanupRuns += 1;
    try {
      await stopAll();
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      writeStderr(`owned process cleanup failed: ${message}\n`);
    } finally {
      exit(status);
    }
  })();
}

function installInterruptHandlers(): void {
  if (interruptHandlersInstalled) return;
  interruptHandlersInstalled = true;
  process.on("SIGINT", () => {
    handleHarnessInterrupt("SIGINT");
  });
  process.on("SIGTERM", () => {
    handleHarnessInterrupt("SIGTERM");
  });
  process.on("beforeExit", () => {
    if (interruptShutdown || beforeExitSignaled || owned.size === 0) return;
    beforeExitSignaled = true;
    for (const handle of owned.values()) {
      if (handle.stopped || handle.exitResult) continue;
      sendSignalToOwnedPid(handle.pid, "SIGTERM", handle.processGroup);
    }
  });
}

/**
 * SIGKILL cannot be caught. If the harness is killed with SIGKILL, owned
 * preview processes may remain. Callers must not treat SIGKILL as recoverable.
 */
export const SIGKILL_CANNOT_BE_HANDLED =
  "SIGKILL cannot be caught; owned preview processes may leak if the harness is SIGKILL'd.";
