import type { HarnessPhase } from "./harnessFailures.ts";
import { isAlreadyClosedCleanupError } from "./alreadyClosed.ts";

export type SlotPreview = {
  stop(): Promise<void>;
};

export type SlotPage = {
  close(): Promise<void>;
};

export type SlotGuards = {
  detach(): void;
};

export type OwnedSlotResources<
  P extends SlotPreview = SlotPreview,
  A extends SlotPage = SlotPage,
  G extends SlotGuards = SlotGuards,
> = {
  preview: P | null;
  page: A | null;
  guards: G | null;
};

export type TeardownKind = "primary" | "secondary";

export async function cleanupOwnedSlot<
  P extends SlotPreview,
  A extends SlotPage,
  G extends SlotGuards,
>(
  resources: OwnedSlotResources<P, A, G>,
  recordTeardown: (error: unknown, kind: TeardownKind) => void,
): Promise<void> {
  const kindFor = (error: unknown): TeardownKind =>
    isAlreadyClosedCleanupError(error) ? "secondary" : "primary";

  if (resources.guards) {
    try {
      resources.guards.detach();
    } catch (error) {
      recordTeardown(error, kindFor(error));
    }
  }
  if (resources.page) {
    try {
      await resources.page.close();
    } catch (error) {
      recordTeardown(error, kindFor(error));
    }
  }
  if (resources.preview) {
    try {
      await resources.preview.stop();
    } catch (error) {
      recordTeardown(error, kindFor(error));
    }
  }
}

export async function closeOwnedContext(
  context: { close(): Promise<void> } | null,
  recordTeardown: (error: unknown, kind: TeardownKind) => void,
): Promise<boolean> {
  if (!context) return false;
  try {
    await context.close();
    return false;
  } catch (error) {
    const kind: TeardownKind = isAlreadyClosedCleanupError(error) ? "secondary" : "primary";
    recordTeardown(error, kind);
    return kind === "primary";
  }
}

export async function acquireOwnedContext<C>(
  create: () => Promise<C>,
  recordFailure: (phase: Extract<HarnessPhase, "context-create">, error: unknown) => void,
): Promise<C> {
  try {
    return await create();
  } catch (error) {
    recordFailure("context-create", error);
    throw error;
  }
}

export type RunOwnedSlotOptions<
  P extends SlotPreview,
  A extends SlotPage,
  G extends SlotGuards,
> = {
  startPreview: () => Promise<P>;
  createPage: () => Promise<A>;
  attachGuards: (page: A) => Promise<G>;
  startTracing?: () => Promise<void>;
  stopTracing?: (incomplete: boolean) => Promise<void>;
  work: (resources: { preview: P; page: A; guards: G }) => Promise<void>;
  recordFailure: (
    phase: HarnessPhase,
    error: unknown,
    options?: { secondary?: boolean },
  ) => void;
  hasPrimaryFailure?: () => boolean;
  setPhase?: (phase: HarnessPhase) => void;
  onTracingState?: (state: {
    tracingCompleted: boolean;
    tracingIncomplete: boolean;
  }) => void;
};

export async function runOwnedSlot<
  P extends SlotPreview,
  A extends SlotPage,
  G extends SlotGuards,
>(
  options: RunOwnedSlotOptions<P, A, G>,
): Promise<{ tracingCompleted: boolean; tracingIncomplete: boolean }> {
  const resources: OwnedSlotResources<P, A, G> = {
    preview: null,
    page: null,
    guards: null,
  };
  let tracingStarted = false;
  let tracingCompleted = false;
  let tracingIncomplete = false;
  let slotFailed = false;

  try {
    options.setPhase?.("preview-start");
    try {
      resources.preview = await options.startPreview();
    } catch (error) {
      options.recordFailure("preview-start", error);
      throw error;
    }

    options.setPhase?.("page-create");
    try {
      resources.page = await options.createPage();
    } catch (error) {
      options.recordFailure("page-create", error);
      throw error;
    }

    options.setPhase?.("guard-attach");
    try {
      resources.guards = await options.attachGuards(resources.page);
    } catch (error) {
      options.recordFailure("guard-attach", error);
      throw error;
    }

    if (options.startTracing) {
      try {
        await options.startTracing();
        tracingStarted = true;
      } catch (error) {
        options.recordFailure("teardown", error, {
          secondary: isAlreadyClosedCleanupError(error),
        });
        throw error;
      }
    }

    await options.work({
      preview: resources.preview,
      page: resources.page,
      guards: resources.guards,
    });
  } catch (error) {
    slotFailed = true;
    throw error;
  } finally {
    if (tracingStarted && options.stopTracing) {
      try {
        const incomplete = slotFailed || Boolean(options.hasPrimaryFailure?.());
        await options.stopTracing(incomplete);
        tracingCompleted = !incomplete;
        tracingIncomplete = incomplete;
      } catch (error) {
        tracingCompleted = false;
        tracingIncomplete = true;
        options.recordFailure("teardown", error, {
          secondary: isAlreadyClosedCleanupError(error),
        });
      }
    }
    await cleanupOwnedSlot(resources, (error, kind) => {
      options.recordFailure("teardown", error, { secondary: kind === "secondary" });
    });
    options.onTracingState?.({ tracingCompleted, tracingIncomplete });
  }

  return { tracingCompleted, tracingIncomplete };
}
