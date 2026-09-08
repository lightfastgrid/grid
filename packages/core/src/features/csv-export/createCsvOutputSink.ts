/**
 * CSV Export V1 - internal output-sink factory (Stage 3A).
 *
 * Selects the concrete sink for a `CsvOutputTarget` and wraps it in the byte
 * guard. It does not re-normalize public options and knows nothing about
 * Grid/GridState, workers, progress, or task scheduling. Returns the byte-guard
 * wrapper so Stage 3B can read `acceptedBytes` for the result/progress.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 21.
 */

import { CsvBlobSink } from "./csvBlobSink";
import { CsvByteLimitedSink } from "./csvByteLimitedSink";
import {
  createBrowserDownloadEnvironment,
  type CsvDownloadEnvironment,
  CsvDownloadSink,
} from "./csvDownloadSink";
import type { CsvOutputTarget } from "./csvExportTypes";
import type { CsvOutputSink } from "./csvOutputSink";
import { CsvTextSink } from "./csvTextSink";
import { CsvWritableStreamSink } from "./csvWritableStreamSink";

export interface CreateCsvOutputSinkOptions {
  /** Effective byte ceiling (already resolved per output target; may be Infinity). */
  maxOutputBytes: number;
  /** Normalized file name (used by the download sink). */
  fileName: string;
  /** Injectable download environment; defaults to the real browser adapter. */
  downloadEnvironment?: CsvDownloadEnvironment;
}

export function createCsvOutputSink(
  target: CsvOutputTarget,
  options: CreateCsvOutputSinkOptions,
): CsvByteLimitedSink {
  let inner: CsvOutputSink;
  switch (target.type) {
    case "text":
      inner = new CsvTextSink();
      break;
    case "blob":
      inner = new CsvBlobSink();
      break;
    case "download":
      inner = new CsvDownloadSink(
        options.downloadEnvironment ?? createBrowserDownloadEnvironment(),
        options.fileName,
      );
      break;
    case "stream":
      inner = new CsvWritableStreamSink(target.writable);
      break;
  }
  return new CsvByteLimitedSink(inner, options.maxOutputBytes);
}
