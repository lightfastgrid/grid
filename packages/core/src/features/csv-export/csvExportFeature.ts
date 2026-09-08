/** Headless CSV capability ownership and neutral Grid snapshot adaptation. */

import { CsvExportWorkerClientOwner } from "../../execution/operations/csv-export/csvExportWorkerClientOwner";
import { CooperativeScheduler } from "../../scheduling/CooperativeScheduler";
import type {
  HeadlessGridFeature,
  HeadlessGridFeatureFactoryContext,
} from "../registry";

import { createCsvExportSnapshot } from "./createCsvExportSnapshot";
import { CsvExportController } from "./CsvExportController";
import type {
  CsvExportCapability,
  CsvExportParams,
  CsvExportProgress,
  CsvExportResult,
  CsvExportTask,
} from "./csvExportTypes";

function safeNotify(callback: (() => void) | undefined): void {
  if (callback === undefined) return;
  try {
    callback();
  } catch {
    // Event and prop observers are isolated from task ownership and outcome.
  }
}

class CsvExportFeature implements HeadlessGridFeature, CsvExportCapability {
  readonly name = "csv-export";

  private readonly scheduler = new CooperativeScheduler();
  private readonly workerClientOwner = new CsvExportWorkerClientOwner();
  private readonly controller: CsvExportController;
  private destroyed = false;

  constructor(private readonly ctx: HeadlessGridFeatureFactoryContext) {
    this.controller = new CsvExportController({
      getConfig: () => this.ctx.getCsvExportConfig(),
      captureSnapshot: () =>
        createCsvExportSnapshot({
          state: this.ctx.captureReadSnapshot(),
          capabilities: {
            captureLogicalColumnLayoutSnapshot: (input) =>
              this.ctx.captureLogicalColumnLayoutSnapshot(input),
            captureRowSelectionSnapshot: (universeRowCount) =>
              this.ctx.captureRowSelectionSnapshot(universeRowCount),
            captureColumnSelectionSnapshot: () =>
              this.ctx.captureColumnSelectionSnapshot(),
          },
          resolveRowId: (row, sourceIndex) =>
            this.ctx.resolveRowId(row, sourceIndex),
        }),
      scheduler: this.scheduler,
      workerClientOwner: this.workerClientOwner,
      getSelectedCellThreshold: () =>
        this.ctx.getExecutionThreshold("csvExport"),
      now: () => performance.now(),
      onProgress: (progress) => this.notifyProgress(progress),
      onCompleted: (result) => this.notifyCompleted(result),
      onCancelled: (event) => this.notifyCancelled(event),
      onError: (event) => this.notifyError(event),
    });
  }

  exportDataAsCsv(params?: CsvExportParams): CsvExportTask {
    return this.controller.exportDataAsCsv(params);
  }

  getDataAsCsv(params?: Omit<CsvExportParams, "output">): Promise<string> {
    return this.controller.getDataAsCsv(params);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.destroy();
  }

  private notifyProgress(progress: CsvExportProgress): void {
    safeNotify(() => this.ctx.emit("csv-export:progress", progress));
  }

  private notifyCompleted(result: CsvExportResult): void {
    safeNotify(() => this.ctx.emit("csv-export:completed", result));
  }

  private notifyCancelled(event: { taskId: number }): void {
    safeNotify(() => this.ctx.emit("csv-export:cancelled", event));
  }

  private notifyError(event: { taskId: number; error: unknown }): void {
    safeNotify(() => this.ctx.emit("csv-export:error", event));
  }
}

export function csvExportFeature(
  ctx: HeadlessGridFeatureFactoryContext,
): HeadlessGridFeature & CsvExportCapability {
  return new CsvExportFeature(ctx);
}
