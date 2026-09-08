/**
 * CSV Export V1 - blob output sink (Stage 3A).
 *
 * Retains byte chunks as Blob parts and constructs exactly one `Blob` on close
 * with MIME type `text/csv;charset=utf-8`. No per-chunk Blob, no object URL, no
 * DOM work. Abort drops the retained chunk references.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 21 (Blob).
 */

import { CsvExportSinkError } from "./csvExportErrors";
import { AbstractCsvSink, type CsvByteChunk, type CsvSinkResult } from "./csvOutputSink";

export const CSV_BLOB_MIME_TYPE = "text/csv;charset=utf-8";

export class CsvBlobSink extends AbstractCsvSink {
  private chunks: CsvByteChunk[] = [];
  private byteLength = 0;

  protected handleWrite(chunk: CsvByteChunk): void {
    // Store the reference; never mutate the input chunk.
    this.chunks.push(chunk);
    this.byteLength += chunk.byteLength;
  }

  protected handleClose(): CsvSinkResult {
    try {
      const blob = new Blob(this.chunks, { type: CSV_BLOB_MIME_TYPE });
      this.chunks = [];
      return { outputType: "blob", byteLength: this.byteLength, blob };
    } catch (cause) {
      this.chunks = [];
      throw new CsvExportSinkError("CSV blob sink close failed", { cause });
    }
  }

  protected handleAbort(): void {
    this.chunks = []; // drop retained chunk references
  }
}
