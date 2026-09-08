/**
 * CSV Export V1 - writable-stream output sink (Stage 3A).
 *
 * Acquires exactly one writer and awaits each `writer.write()`, so backpressure
 * from the destination controls the whole pipeline. It never queues multiple
 * writes internally. Close and abort operations are observed independently;
 * the writer lock is released exactly once after every operation that started
 * has settled. Retained memory is O(current chunk plus the stream
 * implementation's own buffering).
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 21 (Writable
 * stream), 23.
 */

import { CsvExportSinkError } from "./csvExportErrors";
import { AbstractCsvSink, type CsvByteChunk, type CsvSinkResult } from "./csvOutputSink";

export class CsvWritableStreamSink extends AbstractCsvSink {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private byteLength = 0;
  private activeWriterOperations = 0;
  private lockReleased = false;
  private releaseRequested = false;
  private releasePromise: Promise<CsvExportSinkError | null> | null = null;
  private resolveRelease: ((error: CsvExportSinkError | null) => void) | null =
    null;

  constructor(stream: WritableStream<Uint8Array>) {
    super();
    try {
      this.writer = stream.getWriter();
    } catch (cause) {
      throw new CsvExportSinkError("CSV stream writer acquisition failed", {
        cause,
      });
    }
  }

  protected async handleWrite(chunk: CsvByteChunk): Promise<void> {
    try {
      await this.writer.write(chunk); // awaits backpressure; one write at a time
      this.byteLength += chunk.byteLength;
    } catch (cause) {
      throw new CsvExportSinkError("CSV stream write failed", { cause });
    }
  }

  protected async handleClose(): Promise<CsvSinkResult> {
    const closeError = await this.observeWriterOperation(
      () => this.writer.close(),
      "CSV stream close failed",
    );
    const releaseError = await this.requestRelease();
    // Close failure stays primary; release is the failure only if close was ok.
    if (closeError !== null) throw closeError;
    if (releaseError !== null) throw releaseError;
    return { outputType: "stream", byteLength: this.byteLength };
  }

  protected async handleAbort(reason: unknown): Promise<void> {
    const abortError = await this.observeWriterOperation(
      () => this.writer.abort(reason),
      "CSV stream abort failed",
    );
    const releaseError = await this.requestRelease();
    if (abortError !== null) throw abortError;
    if (releaseError !== null) throw releaseError;
  }

  /**
   * Observe an underlying writer operation without allowing a late rejection
   * to escape. The operation count keeps releaseLock behind both close and
   * abort when cancellation races asynchronous finalization.
   */
  private observeWriterOperation(
    operation: () => Promise<void>,
    failureMessage: string,
  ): Promise<CsvExportSinkError | null> {
    this.activeWriterOperations++;

    let outcome: Promise<void>;
    try {
      outcome = operation();
    } catch (cause) {
      this.finishWriterOperation();
      return Promise.resolve(new CsvExportSinkError(failureMessage, { cause }));
    }

    return outcome.then(
      () => {
        this.finishWriterOperation();
        return null;
      },
      (cause: unknown) => {
        this.finishWriterOperation();
        return new CsvExportSinkError(failureMessage, { cause });
      },
    );
  }

  private finishWriterOperation(): void {
    this.activeWriterOperations--;
    this.releaseIfReady();
  }

  private requestRelease(): Promise<CsvExportSinkError | null> {
    if (this.releasePromise === null) {
      this.releasePromise = new Promise<CsvExportSinkError | null>((resolve) => {
        this.resolveRelease = resolve;
      });
    }
    this.releaseRequested = true;
    this.releaseIfReady();
    return this.releasePromise;
  }

  private releaseIfReady(): void {
    if (
      !this.releaseRequested ||
      this.activeWriterOperations !== 0 ||
      this.lockReleased
    ) {
      return;
    }

    const releaseError = this.releaseLockOnce();
    const resolve = this.resolveRelease;
    this.resolveRelease = null;
    resolve?.(releaseError);
  }

  /** Release the writer lock at most once; return a wrapped error on failure. */
  private releaseLockOnce(): CsvExportSinkError | null {
    if (this.lockReleased) return null;
    this.lockReleased = true;
    try {
      this.writer.releaseLock();
      return null;
    } catch (cause) {
      return new CsvExportSinkError("CSV stream releaseLock failed", { cause });
    }
  }
}
