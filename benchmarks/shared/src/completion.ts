function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

export function waitAnimationFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      scheduleFrame(() => step(remaining - 1));
    };
    scheduleFrame(() => step(count - 1));
  });
}

export const PROTOCOL_TIMEOUT_MS = 30_000;

export function getProtocolTimeoutMs(): number {
  if (typeof window !== "undefined") {
    const raw = new URLSearchParams(window.location.search).get("protocolTimeoutMs");
    const parsed = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return PROTOCOL_TIMEOUT_MS;
}

export async function waitWithTimeout<T>(
  label: string,
  work: Promise<T>,
  timeoutMs = getProtocolTimeoutMs(),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function waitForAcceptedThenRender(
  accepted: Promise<void>,
  label?: string,
): Promise<void> {
  if (label) {
    await waitWithTimeout(label, accepted);
  } else {
    await accepted;
  }
  await waitAnimationFrames(2);
}

export function whenEvent<T>(
  subscribe: (handler: (value: T) => void) => () => void,
  predicate: (value: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve) => {
    const unsubscribe = subscribe((value) => {
      if (!predicate(value)) return;
      unsubscribe();
      resolve(value);
    });
  });
}

export function waitForPredicate(
  predicate: () => boolean,
  timeoutMs = getProtocolTimeoutMs(),
  options?: { signal?: AbortSignal; label?: string },
): Promise<void> {
  const started = performance.now();
  const failure =
    options?.label ?? "Timed out waiting for grid settlement";
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (options?.signal?.aborted) {
        reject(new Error(failure));
        return;
      }
      if (predicate()) {
        resolve();
        return;
      }
      if (performance.now() - started > timeoutMs) {
        reject(new Error(`${failure} timed out after ${timeoutMs}ms`));
        return;
      }
      scheduleFrame(tick);
    };
    scheduleFrame(tick);
  });
}

export type WaitForGridEventOptions<T> = {
  readonly appLabel: string;
  readonly operation: string;
  readonly subscribe: (handler: (value: T) => void) => () => void;
  readonly afterSubscribe: () => void | Promise<void>;
  readonly predicate?: (value: T) => boolean;
  readonly timeoutMs?: number;
};

export async function waitForGridEvent<T>(
  options: WaitForGridEventOptions<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? getProtocolTimeoutMs();
  const predicate = options.predicate ?? (() => true);
  const label = `${options.appLabel} ${options.operation} did not receive an accepted event`;
  let unsubscribe: (() => void) | undefined;
  try {
    const accepted = new Promise<T>((resolve, reject) => {
      unsubscribe = options.subscribe((value) => {
        if (!predicate(value)) return;
        resolve(value);
      });
      try {
        const result = options.afterSubscribe();
        if (result && typeof (result as Promise<void>).then === "function") {
          Promise.resolve(result).catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            reject(
              new Error(
                `${options.appLabel} ${options.operation} command failed: ${detail}`,
                { cause: error },
              ),
            );
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reject(
          new Error(
            `${options.appLabel} ${options.operation} command failed: ${detail}`,
            { cause: error },
          ),
        );
      }
    });
    return await waitWithTimeout(label, accepted, timeoutMs);
  } finally {
    unsubscribe?.();
  }
}

export async function waitForGridEventThenRender<T>(
  options: WaitForGridEventOptions<T>,
): Promise<T> {
  const value = await waitForGridEvent(options);
  await waitAnimationFrames(2);
  return value;
}
