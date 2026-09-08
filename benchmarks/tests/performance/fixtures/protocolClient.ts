import type { Page } from "@playwright/test";

import type {
  FilterExecutionEvidence,
  GridBenchmarkAcceptedState,
  GridBenchmarkRuntimeSample,
  QuickSearchExecutionEvidence,
  QuickSearchTypingSessionResult,
} from "../../../shared/src/benchmarkProtocol.ts";
import type { RuntimeVisibleState } from "../metrics/schema.ts";

export type ProtocolCallResult = {
  readonly ok: boolean;
  readonly durationMs: number | null;
  readonly observers: GridBenchmarkRuntimeSample | null;
  readonly visible: RuntimeVisibleState | null;
  readonly accepted: GridBenchmarkAcceptedState | null;
  readonly domNodeCount: number | null;
  readonly error: string | null;
  readonly typingSession: QuickSearchTypingSessionResult | null;
  readonly executionEvidence: QuickSearchExecutionEvidence | FilterExecutionEvidence | null;
};

export type PrepareResult = {
  readonly scenario: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly generationMs: number;
};

export async function waitForProtocol(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__GRID_BENCHMARK__), null, {
    timeout: timeoutMs,
  });
}

export async function readMeta(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const api = window.__GRID_BENCHMARK__;
    if (!api) throw new Error("window.__GRID_BENCHMARK__ is missing");
    return api.getMeta() as unknown as Record<string, unknown>;
  });
}

export async function prepareScenario(
  page: Page,
  name: string,
): Promise<PrepareResult> {
  return page.evaluate(async (scenarioName) => {
    const api = window.__GRID_BENCHMARK__;
    if (!api) throw new Error("window.__GRID_BENCHMARK__ is missing");
    return api.prepareScenario(scenarioName);
  }, name);
}

export async function destroyGrid(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = window.__GRID_BENCHMARK__;
    if (!api) throw new Error("window.__GRID_BENCHMARK__ is missing");
    await api.destroy();
  });
}

export async function measureProtocolCall(
  page: Page,
  method: string,
  args: readonly unknown[] = [],
  timeoutMs = 90_000,
): Promise<ProtocolCallResult> {
  page.setDefaultTimeout(timeoutMs);
  try {
    return await page.evaluate(
      async ({ methodName, methodArgs }) => {
        const api = window.__GRID_BENCHMARK__;
        if (!api) throw new Error("window.__GRID_BENCHMARK__ is missing");
        const fn = (api as unknown as Record<string, unknown>)[methodName];
        if (typeof fn !== "function") {
          throw new Error(`window.__GRID_BENCHMARK__.${methodName} is not a function`);
        }
        api.startRuntimeObservers();
        const started = performance.now();
        let thrown: unknown;
        let returned: unknown;
        try {
          returned = await (fn as (...callArgs: unknown[]) => Promise<unknown>).apply(api, methodArgs);
        } catch (error) {
          thrown = error;
        }
        const durationMs = performance.now() - started;
        const observers = api.stopRuntimeObservers();
        const typingSession =
          returned &&
          typeof returned === "object" &&
          "firstKeystrokeToFinalPaintMs" in returned
            ? (returned as QuickSearchTypingSessionResult)
            : null;
        const isFilterMethod =
          methodName === "applyFilterModel" ||
          methodName === "clearFilterModel" ||
          methodName === "typeColumnFilter";
        const isSortMethod = methodName === "sort";
        const executionEvidence = isFilterMethod
          ? typeof api.getFilterExecutionEvidence === "function"
            ? api.getFilterExecutionEvidence()
            : null
          : isSortMethod
            ? typeof api.getSortExecutionEvidence === "function"
              ? api.getSortExecutionEvidence()
              : null
            : typeof api.getQuickSearchExecutionEvidence === "function"
              ? api.getQuickSearchExecutionEvidence()
              : null;
        // Visible/accepted inspection is outside durationMs and must not mutate
        // loading, overlays, filters, search, or rows.
        if (thrown) {
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          return {
            ok: false,
            durationMs,
            observers,
            visible: null,
            accepted: null,
            domNodeCount: null,
            error: message,
            typingSession,
            executionEvidence,
          };
        }
        return {
          ok: true,
          durationMs,
          observers,
          visible: api.getVisibleState(),
          accepted: api.getAcceptedState(),
          domNodeCount: api.getDomNodeCount(),
          error: null,
          typingSession,
          executionEvidence,
        };
      },
      { methodName: method, methodArgs: [...args] },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      durationMs: null,
      observers: null,
      visible: null,
      accepted: null,
      domNodeCount: null,
      error: message,
      typingSession: null,
      executionEvidence: null,
    };
  }
}

export function classifyProtocolError(
  message: string,
): "protocol-timeout" | "unavailable-required-instrumentation" | "protocol-error" {
  if (/timed out/i.test(message)) return "protocol-timeout";
  if (
    /is not a function|getAcceptedState|getVisibleState|startRuntimeObservers|window\.__GRID_BENCHMARK__ is missing/i.test(
      message,
    )
  ) {
    return "unavailable-required-instrumentation";
  }
  return "protocol-error";
}
