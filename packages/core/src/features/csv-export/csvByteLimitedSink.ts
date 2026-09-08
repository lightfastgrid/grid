/**
 * CSV Export V1 - output-byte guard decorator (Stage 3A).
 *
 * Wraps any {@link CsvOutputSink} and checks the byte ceiling before forwarding
 * each chunk. An overflowing chunk is never forwarded; the guard throws
 * {@link CsvExportSizeLimitError}. The comparison is overflow-safe
 * (`chunk.byteLength > maxOutputBytes - acceptedBytes`) and treats `Infinity`
 * as unlimited. Zero-length chunks do not change accounting.
 *
 * Accounting is transactional: a chunk is counted only after the wrapped sink
 * accepts it. A synchronous write increments on return; an asynchronous write
 * increments only on resolution and never on rejection. Only one write may be
 * in flight - a second write (or a `close`) while one is pending is rejected
 * deterministically, so a pending write can never let another write bypass the
 * limit. There is no internal write queue; Stage 3B awaits each write for
 * backpressure. `abort` may be forwarded while a write is pending.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 21 (byte guard).
 */

import {
  CsvExportSinkError,
  CsvExportSizeLimitError,
} from "./csvExportErrors";
import type { CsvByteChunk, CsvOutputSink, CsvSinkResult } from "./csvOutputSink";

export class CsvByteLimitedSink implements CsvOutputSink {
  private accepted = 0;
  private pending = false;

  constructor(
    private readonly inner: CsvOutputSink,
    private readonly maxOutputBytes: number,
  ) {}

  /** Bytes accepted (and forwarded) so far; authoritative for the result. */
  get acceptedBytes(): number {
    return this.accepted;
  }

  write(chunk: CsvByteChunk): Promise<void> | void {
    if (this.pending) {
      throw new CsvExportSinkError(
        "CSV byte guard: a previous write is still pending",
      );
    }
    // Overflow-safe: never compute acceptedBytes + byteLength for the check.
    if (chunk.byteLength > this.maxOutputBytes - this.accepted) {
      throw new CsvExportSizeLimitError(
        this.accepted + chunk.byteLength,
        this.maxOutputBytes,
      );
    }

    const outcome = this.inner.write(chunk);
    if (outcome instanceof Promise) {
      this.pending = true;
      return outcome.then(
        () => {
          this.pending = false;
          this.accepted += chunk.byteLength; // count only after acceptance
        },
        (error: unknown) => {
          this.pending = false; // rejection: accounting unchanged
          throw error;
        },
      );
    }

    // Synchronous success: count immediately.
    this.accepted += chunk.byteLength;
    return outcome;
  }

  close(): Promise<CsvSinkResult> | CsvSinkResult {
    if (this.pending) {
      throw new CsvExportSinkError("CSV byte guard: close while a write is pending");
    }
    return this.inner.close();
  }

  abort(reason: unknown): Promise<void> | void {
    return this.inner.abort(reason);
  }
}
