// @vitest-environment jsdom

/** CSV Export V1 Stage 5C headless Grid integration coverage. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CsvWorkerRequest,
  CsvWorkerResponse,
} from "../../../execution/operations/csv-export/csvExportProtocol";
import { CsvExportWorkerRuntime } from "../../../execution/operations/csv-export/csvExportWorkerRuntime";
import { Grid } from "../../../Grid";
import { DomGridRenderer } from "../../../rendering/DomGridRenderer";
import { GridState } from "../../../state/GridState";
import {
  BUILT_IN_FEATURE_FACTORIES,
  BUILT_IN_HEADLESS_FEATURE_FACTORIES,
} from "../../registry";
import { CsvExportCancelledError } from "../csvExportErrors";

interface PostedWorkerMessage {
  readonly worker: number;
  readonly message: CsvWorkerRequest;
}

interface WorkerControls {
  readonly posted: PostedWorkerMessage[];
  instances: number;
  terminations: number;
  stallChunks: boolean;
}

interface InstallWorkerOptions {
  readonly failFirstChunk?: boolean;
  readonly stallChunks?: boolean;
}

function installCsvWorker(
  options: InstallWorkerOptions = {},
): WorkerControls {
  const controls: WorkerControls = {
    posted: [],
    instances: 0,
    terminations: 0,
    stallChunks: options.stallChunks === true,
  };

  class LoopbackCsvWorker extends EventTarget {
    private readonly workerNumber = ++controls.instances;
    private terminated = false;
    private failed = false;
    private readonly runtime = new CsvExportWorkerRuntime((response) => {
      const delivered: CsvWorkerResponse =
        response.kind === "csv:encodedChunk"
          ? { ...response, bytes: new Uint8Array(response.bytes) }
          : response;
      queueMicrotask(() => {
        if (this.terminated) return;
        this.dispatchEvent(
          new MessageEvent<CsvWorkerResponse>("message", { data: delivered }),
        );
      });
    });

    postMessage(message: CsvWorkerRequest): void {
      controls.posted.push({ worker: this.workerNumber, message });
      if (
        message.kind === "csv:chunk" &&
        controls.stallChunks
      ) {
        return;
      }
      if (
        message.kind === "csv:chunk" &&
        options.failFirstChunk === true &&
        this.workerNumber === 1 &&
        !this.failed
      ) {
        this.failed = true;
        queueMicrotask(() => {
          if (this.terminated) return;
          const error = new Error("CSV Worker transport failed");
          this.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
        });
        return;
      }
      this.runtime.handleMessage(message);
    }

    terminate(): void {
      if (this.terminated) return;
      this.terminated = true;
      controls.terminations++;
    }
  }

  vi.stubGlobal("Worker", LoopbackCsvWorker);
  return controls;
}

async function settleUntil(
  predicate: () => boolean,
  label: string,
  maxTicks = 200,
): Promise<void> {
  for (let tick = 0; tick < maxTicks; tick++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function simpleGridProps() {
  return {
    columns: [{ field: "value", headerName: "Value" }],
    rows: [{ id: "a", value: "Alpha" }],
    getRowId: (row: Record<string, unknown>) => row.id,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CSV export headless Grid integration", () => {
  it("registers CSV only in the independent headless feature list", () => {
    expect(
      BUILT_IN_HEADLESS_FEATURE_FACTORIES.map(({ name }) => name),
    ).toContain("csv-export");
    expect(BUILT_IN_FEATURE_FACTORIES.map(({ name }) => name)).not.toContain(
      "csv-export",
    );
  });

  it("constructs a flat Grid without snapshot capture, scheduling, or Worker creation", () => {
    const controls = installCsvWorker();
    const capture = vi.spyOn(GridState.prototype, "captureReadSnapshot");

    const grid = new Grid(simpleGridProps());

    expect(capture).not.toHaveBeenCalled();
    expect(controls.instances).toBe(0);
    expect(controls.posted).toEqual([]);
    grid.destroy();
    expect(controls.instances).toBe(0);
  });

  it("delegates text, download, and exact getDataAsCsv results", async () => {
    const createObjectURL = vi.fn(() => "blob:csv");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const grid = new Grid(simpleGridProps());

    const textTask = grid.exportDataAsCsv({ output: { type: "text" } });
    await expect(textTask.promise).resolves.toMatchObject({
      outputType: "text",
      text: "Value\r\nAlpha\r\n",
    });
    await expect(grid.getDataAsCsv()).resolves.toBe("Value\r\nAlpha\r\n");
    await expect(grid.exportDataAsCsv().promise).resolves.toMatchObject({
      outputType: "download",
      fileName: "export.csv",
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");
    expect(click).toHaveBeenCalledOnce();
    grid.destroy();
  });

  it("delivers progress, completion, cancellation, and error to bus and current props once", async () => {
    const propProgress = vi.fn();
    const propCompleted = vi.fn();
    const propCancelled = vi.fn();
    const propError = vi.fn();
    const grid = new Grid({
      ...simpleGridProps(),
      onCsvExportProgress: propProgress,
      onCsvExportCompleted: propCompleted,
      onCsvExportCancelled: propCancelled,
      onCsvExportError: propError,
    });
    const busProgress = vi.fn();
    const busCompleted = vi.fn();
    const busCancelled = vi.fn();
    const busError = vi.fn();
    grid.on("csv-export:progress", busProgress);
    grid.on("csv-export:completed", busCompleted);
    grid.on("csv-export:cancelled", busCancelled);
    grid.on("csv-export:error", busError);

    await grid.getDataAsCsv();
    expect(busProgress.mock.calls).toEqual(propProgress.mock.calls);
    expect(busCompleted).toHaveBeenCalledOnce();
    expect(propCompleted).toHaveBeenCalledOnce();

    const cancelled = grid.exportDataAsCsv({ output: { type: "text" } });
    cancelled.cancel();
    await expect(cancelled.promise).rejects.toBeInstanceOf(
      CsvExportCancelledError,
    );
    expect(busCancelled).toHaveBeenCalledOnce();
    expect(propCancelled).toHaveBeenCalledOnce();

    const failed = grid.exportDataAsCsv({
      output: { type: "text" },
      processCell: () => {
        throw new Error("projection failed");
      },
    });
    await expect(failed.promise).rejects.toThrow("projection failed");
    expect(busError).toHaveBeenCalledOnce();
    expect(propError).toHaveBeenCalledOnce();
    grid.destroy();
  });

  it("keeps disabled and cancel-before-bootstrap requests cold", async () => {
    const controls = installCsvWorker();
    const capture = vi.spyOn(GridState.prototype, "captureReadSnapshot");
    const disabledGrid = new Grid({ ...simpleGridProps(), csvExport: false });

    await expect(disabledGrid.getDataAsCsv()).rejects.toMatchObject({
      code: "csv-export/disabled",
    });
    expect(capture).not.toHaveBeenCalled();
    expect(controls.instances).toBe(0);
    disabledGrid.destroy();

    const grid = new Grid({
      ...simpleGridProps(),
      execution: { thresholds: { csvExport: 0 } },
    });
    const task = grid.exportDataAsCsv({ output: { type: "text" } });
    task.cancel();
    await expect(task.promise).rejects.toBeInstanceOf(CsvExportCancelledError);
    expect(capture).not.toHaveBeenCalled();
    expect(controls.instances).toBe(0);
    grid.destroy();
  });

  it("selects main below threshold and Worker at or above threshold", async () => {
    const controls = installCsvWorker();
    const props = {
      columns: [{ field: "value" }],
      rows: [
        { id: "a", value: "A" },
        { id: "b", value: "B" },
      ],
      getRowId: (row: Record<string, unknown>) => row.id,
    };

    const below = new Grid({
      ...props,
      execution: { thresholds: { csvExport: 3 } },
    });
    await below.getDataAsCsv();
    expect(controls.instances).toBe(0);
    below.destroy();

    const at = new Grid({
      ...props,
      execution: { thresholds: { csvExport: 2 } },
    });
    await at.getDataAsCsv();
    expect(controls.instances).toBe(1);
    at.destroy();

    const above = new Grid({
      ...props,
      execution: { thresholds: { csvExport: 1 } },
    });
    await above.getDataAsCsv();
    expect(controls.instances).toBe(2);
    above.destroy();
  });

  it("applies runtime CSV threshold updates without rendering", async () => {
    const controls = installCsvWorker();
    const render = vi.spyOn(DomGridRenderer.prototype, "render");
    const grid = new Grid({
      ...simpleGridProps(),
      execution: { thresholds: { csvExport: 2 } },
    });

    await grid.getDataAsCsv();
    expect(controls.instances).toBe(0);
    grid.setExecutionOptions({ thresholds: { csvExport: 1 } });
    expect(render).not.toHaveBeenCalled();
    await grid.getDataAsCsv();
    expect(controls.instances).toBe(1);
    grid.destroy();
  });

  it("cancels a replaced task before reading the replacement snapshot", async () => {
    const order: string[] = [];
    const originalCapture = GridState.prototype.captureReadSnapshot;
    vi.spyOn(GridState.prototype, "captureReadSnapshot").mockImplementation(
      function captureForTest(this: GridState) {
        order.push("snapshot");
        return originalCapture.call(this);
      },
    );
    const grid = new Grid({
      ...simpleGridProps(),
      onCsvExportCancelled: () => order.push("cancelled"),
    });

    const first = grid.exportDataAsCsv({ output: { type: "text" } });
    const firstRejection = first.promise.catch((error: unknown) => error);
    const second = grid.exportDataAsCsv({ output: { type: "text" } });
    await expect(firstRejection).resolves.toBeInstanceOf(CsvExportCancelledError);
    await expect(second.promise).resolves.toMatchObject({ outputType: "text" });

    expect(order).toEqual(["cancelled", "snapshot"]);
    grid.destroy();
  });

  it("destroy cancels active Worker work and terminates created resources once", async () => {
    const controls = installCsvWorker({ stallChunks: true });
    const grid = new Grid({
      ...simpleGridProps(),
      execution: { thresholds: { csvExport: 0 } },
    });
    const task = grid.exportDataAsCsv({ output: { type: "text" } });
    const rejection = task.promise.catch((error: unknown) => error);
    await settleUntil(
      () => controls.posted.some(({ message }) => message.kind === "csv:chunk"),
      "an in-flight CSV chunk",
    );

    grid.destroy();
    grid.destroy();
    await expect(rejection).resolves.toBeInstanceOf(CsvExportCancelledError);
    expect(controls.instances).toBe(1);
    expect(controls.terminations).toBe(1);

    const coldGrid = new Grid(simpleGridProps());
    coldGrid.destroy();
    expect(controls.instances).toBe(1);
    expect(controls.terminations).toBe(1);
  });

  it("reuses a healthy Worker and recreates it after Worker failure invalidation", async () => {
    const healthyControls = installCsvWorker();
    const healthy = new Grid({
      ...simpleGridProps(),
      execution: { thresholds: { csvExport: 0 } },
    });
    await healthy.getDataAsCsv();
    await healthy.getDataAsCsv();
    expect(healthyControls.instances).toBe(1);
    expect(healthyControls.terminations).toBe(0);

    healthyControls.stallChunks = true;
    const cancelled = healthy.exportDataAsCsv({ output: { type: "text" } });
    const cancelledRejection = cancelled.promise.catch(
      (error: unknown) => error,
    );
    await settleUntil(
      () =>
        healthyControls.posted.filter(
          ({ message }) => message.kind === "csv:chunk",
        ).length === 3,
      "the cancellable reusable-Worker chunk",
    );
    cancelled.cancel();
    await expect(cancelledRejection).resolves.toBeInstanceOf(
      CsvExportCancelledError,
    );
    expect(healthyControls.instances).toBe(1);
    expect(healthyControls.terminations).toBe(0);
    healthy.destroy();
    expect(healthyControls.terminations).toBe(1);

    const failureControls = installCsvWorker({ failFirstChunk: true });
    const recovering = new Grid({
      ...simpleGridProps(),
      execution: { thresholds: { csvExport: 0 } },
    });
    await expect(recovering.getDataAsCsv()).resolves.toBe(
      "Value\r\nAlpha\r\n",
    );
    expect(failureControls.instances).toBe(1);
    expect(failureControls.terminations).toBe(1);
    await expect(recovering.getDataAsCsv()).resolves.toBe(
      "Value\r\nAlpha\r\n",
    );
    expect(failureControls.instances).toBe(2);
    recovering.destroy();
  });

  it("keeps captured row, column, and selection ownership stable after mutation", async () => {
    const originalCapture = GridState.prototype.captureReadSnapshot;
    let mutateAfterCapture: (() => void) | null = null;
    vi.spyOn(GridState.prototype, "captureReadSnapshot").mockImplementation(
      function captureForTest(this: GridState) {
        const snapshot = originalCapture.call(this);
        queueMicrotask(() => mutateAfterCapture?.());
        return snapshot;
      },
    );
    const grid = new Grid({
      columns: [{ field: "value", headerName: "Value" }],
      rows: [
        { id: "a", value: "Alpha" },
        { id: "b", value: "Beta" },
      ],
      getRowId: (row) => row.id,
      rowSelection: "multiple",
    });
    grid.mount(document.createElement("div"));
    await settleUntil(() => {
      grid.setSelectedRowIds(["a"]);
      return grid.getSelectedRowIds().includes("a");
    }, "row-selection feature config");
    expect(grid.getSelectedRowIds()).toEqual(["a"]);
    mutateAfterCapture = () => {
      grid.setRows([{ id: "new", other: "Changed" }]);
      grid.setColumns([{ field: "other", headerName: "Other" }]);
      grid.setSelectedRowIds(["new"]);
    };

    await expect(
      grid.getDataAsCsv({ rows: { mode: "selected" } }),
    ).resolves.toBe("Value\r\nAlpha\r\n");
    grid.destroy();
  });

  it("captures pending-safe row views without synchronous row-model execution", async () => {
    const grid = new Grid({
      columns: [{ field: "value", headerName: "Value" }],
      rows: [
        { id: "a", value: "Alpha" },
        { id: "b", value: "Beta" },
      ],
      quickFilter: true,
      execution: { thresholds: { quickSearch: 0, csvExport: 10 } },
    });
    const capture = vi.spyOn(GridState.prototype, "captureReadSnapshot");
    grid.setQuickFilterText("Beta");

    expect(capture).not.toHaveBeenCalled();
    await expect(grid.getDataAsCsv()).resolves.toMatch(/Beta/);
    expect(capture).toHaveBeenCalledOnce();
    grid.destroy();
  });

  it("updates CSV config through its setter without eager Grid work", async () => {
    const controls = installCsvWorker();
    const capture = vi.spyOn(GridState.prototype, "captureReadSnapshot");
    const render = vi.spyOn(DomGridRenderer.prototype, "render");
    const grid = new Grid(simpleGridProps());

    grid.setCsvExportConfig(false);
    expect(capture).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(controls.instances).toBe(0);
    await expect(grid.getDataAsCsv()).rejects.toMatchObject({
      code: "csv-export/disabled",
    });
    grid.destroy();
  });

  it("keeps DOM/selection/pinning and CSV dependency boundaries separate", async () => {
    const registry = await readFile(resolve("src/features/registry.ts"), "utf8");
    const domFactories = registry.slice(
      registry.indexOf("export const BUILT_IN_FEATURE_FACTORIES"),
      registry.indexOf("export function createBuiltInFeatures"),
    );
    expect(domFactories).not.toContain("csv-export");

    const neutralFiles = [
      "../rendering/DomGridRenderer.ts",
      "../rendering/dom/DomFeatureHost.ts",
      "../features/selection/SelectionStore.ts",
      "../features/column-selection/columnSelectionFeature.ts",
      "../state/GridState.ts",
    ];
    for (const file of neutralFiles) {
      const source = await readFile(resolve("src/__tests__", file), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*csv-export/i);
    }

    const csvFeature = await readFile(
      resolve("src/features/csv-export/csvExportFeature.ts"),
      "utf8",
    );
    expect(csvFeature).not.toMatch(
      /from\s+["'][^"']*(?:render|Dom|quick-search|filters?|menu)/i,
    );
  });
});
