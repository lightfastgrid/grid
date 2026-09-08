/**
 * CSV Export V1 - text output sink (Stage 3A).
 *
 * Decodes byte chunks through one streaming `TextDecoder` (preserving UTF-8
 * characters split across chunk boundaries), accumulates decoded string parts,
 * flushes the decoder exactly once on close, and joins once. Text output
 * retains O(output size) memory (the accumulated string); prefer blob/stream
 * output for very large exports. Abort drops the retained parts.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 21 (Text).
 */

import { CsvExportSinkError } from "./csvExportErrors";
import { AbstractCsvSink, type CsvByteChunk, type CsvSinkResult } from "./csvOutputSink";

export class CsvTextSink extends AbstractCsvSink {
  private readonly decoder = new TextDecoder("utf-8");
  private parts: string[] = [];
  private byteLength = 0;

  protected handleWrite(chunk: CsvByteChunk): void {
    try {
      this.parts.push(this.decoder.decode(chunk, { stream: true }));
      this.byteLength += chunk.byteLength;
    } catch (cause) {
      throw new CsvExportSinkError("CSV text sink write failed", { cause });
    }
  }

  protected handleClose(): CsvSinkResult {
    try {
      this.parts.push(this.decoder.decode()); // flush exactly once
      const text = this.parts.join(""); // single final join
      this.parts = [];
      return { outputType: "text", byteLength: this.byteLength, text };
    } catch (cause) {
      this.parts = []; // drop retained parts on close failure
      throw new CsvExportSinkError("CSV text sink close failed", { cause });
    }
  }

  protected handleAbort(): void {
    this.parts = []; // drop retained parts
  }
}
