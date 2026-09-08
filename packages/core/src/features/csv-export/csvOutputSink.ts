/**
 * CSV Export V1 - internal output-sink contract and lifecycle base (Stage 3A).
 *
 * One internal sink contract backs every destination (text, blob, download,
 * writable stream). `AbstractCsvSink` centralizes the explicit lifecycle:
 *
 *   open --close(sync ok)-----> closed        (finalizes, caches the result)
 *   open --close(async)-------> closing --ok--> closed
 *                                       --rej--> failed (retains rejection)
 *                              --abort---------> aborted
 *   open --close(sync throw)--> failed         (caches the original error)
 *   open --abort--------------> aborted        (drops retained state)
 *
 * Rules enforced here:
 *   - a sink becomes `closed` only after `handleClose` succeeds;
 *   - a pending async close returns the same promise on repeated `close`;
 *   - a close failure (sync throw or async rejection) transitions to `failed`
 *     and reproduces the SAME failure on repeated `close` - never null/success;
 *   - `write` while closing/closed/aborted/failed throws;
 *   - `close` after abort throws (close and abort cannot both finalize);
 *   - `abort` while an async close is pending is logically authoritative;
 *   - `abort` after close/abort/failed is a no-op (idempotent).
 *
 * Subclasses wrap their low-level failures in {@link CsvExportSinkError},
 * preserving the original `cause`, and release retained state before
 * propagating a close failure. No sink schedules a grid render; only the
 * download adapter touches the DOM.
 *
 * Internal only - never exported from the package root or the public CSV barrel.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 21, 23.
 */

import { CsvExportSinkError } from "./csvExportErrors";
import type { CsvOutputTarget } from "./csvExportTypes";

/**
 * A byte chunk flowing into a sink. `ArrayBuffer`-backed (not `ArrayBufferLike`)
 * so it composes with `Blob`/`BufferSource` without casts; the encoder and
 * `TextEncoder` already produce this shape.
 */
export type CsvByteChunk = Uint8Array<ArrayBuffer>;

export type CsvSinkState =
  | "open"
  | "closing"
  | "closed"
  | "aborted"
  | "failed";

/** Finalized sink output; Stage 3B assembles the public result from this. */
export interface CsvSinkResult {
  outputType: CsvOutputTarget["type"];
  /** Bytes accepted by the sink. */
  byteLength: number;
  text?: string;
  blob?: Blob;
  fileName?: string;
}

export interface CsvOutputSink {
  write(chunk: CsvByteChunk): Promise<void> | void;
  close(): Promise<CsvSinkResult> | CsvSinkResult;
  abort(reason: unknown): Promise<void> | void;
}

export abstract class AbstractCsvSink implements CsvOutputSink {
  private state: CsvSinkState = "open";
  private closeResult: CsvSinkResult | null = null;
  private closePromise: Promise<CsvSinkResult> | null = null;
  private closeError: unknown = undefined;
  private closeCancellationError: CsvExportSinkError | null = null;
  private rejectPendingClose: ((error: CsvExportSinkError) => void) | null = null;

  write(chunk: CsvByteChunk): Promise<void> | void {
    if (this.state !== "open") {
      throw new CsvExportSinkError(`CSV sink write after ${this.state}`);
    }
    return this.handleWrite(chunk);
  }

  close(): Promise<CsvSinkResult> | CsvSinkResult {
    switch (this.state) {
      case "aborted":
        if (this.closeCancellationError !== null) {
          throw this.closeCancellationError;
        }
        throw new CsvExportSinkError("CSV sink cannot close after abort");
      case "closed":
        return this.closeResult!; // cached success
      case "closing":
        return this.closePromise!; // same pending promise
      case "failed":
        if (this.closePromise !== null) return this.closePromise; // same rejection
        throw this.closeError; // reproduce the original sync failure
      case "open":
        break;
    }

    this.state = "closing";
    let outcome: Promise<CsvSinkResult> | CsvSinkResult;
    try {
      outcome = this.handleClose();
    } catch (error) {
      if (this.isAborted()) {
        throw this.closeCancellationError!;
      }
      this.state = "failed";
      this.closeError = error;
      throw error;
    }

    if (this.isAborted()) {
      const cancellationError = this.closeCancellationError!;
      if (outcome instanceof Promise) {
        // The physical close already started. Observe either late outcome, but
        // expose only the logically authoritative cancellation.
        void outcome.then(
          () => undefined,
          () => undefined,
        );
        const cancelled = Promise.reject<CsvSinkResult>(cancellationError);
        this.closePromise = cancelled;
        return cancelled;
      }
      throw cancellationError;
    }

    if (outcome instanceof Promise) {
      const tracked = new Promise<CsvSinkResult>((resolve, reject) => {
        this.rejectPendingClose = reject;
        void outcome.then(
          (result) => {
            if (this.state !== "closing") return;
            this.rejectPendingClose = null;
            this.state = "closed";
            this.closeResult = result;
            resolve(result);
          },
          (error: unknown) => {
            if (this.state !== "closing") return;
            this.rejectPendingClose = null;
            this.state = "failed";
            this.closeError = error;
            reject(error);
          },
        );
      });
      this.closePromise = tracked;
      return tracked;
    }

    this.state = "closed";
    this.closeResult = outcome;
    return outcome;
  }

  abort(reason: unknown): Promise<void> | void {
    if (this.state !== "open" && this.state !== "closing") return;

    const wasClosing = this.state === "closing";
    this.state = "aborted";

    if (wasClosing) {
      const cancellationError = new CsvExportSinkError(
        "CSV sink close cancelled by abort",
        { cause: reason },
      );
      this.closeCancellationError = cancellationError;
      const reject = this.rejectPendingClose;
      this.rejectPendingClose = null;
      reject?.(cancellationError);
    }

    return this.handleAbort(reason);
  }

  private isAborted(): boolean {
    return this.state === "aborted";
  }

  protected abstract handleWrite(chunk: CsvByteChunk): Promise<void> | void;
  protected abstract handleClose(): Promise<CsvSinkResult> | CsvSinkResult;
  protected abstract handleAbort(reason: unknown): Promise<void> | void;
}
