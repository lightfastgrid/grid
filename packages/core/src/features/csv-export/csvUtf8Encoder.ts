/**
 * CSV Export V1 - incremental UTF-8 encoding session (Stage 2C).
 *
 * A stateful, synchronous, single-pass encoder. It consumes projected values,
 * applies formula protection, stringifies at the encoding boundary, quotes per
 * mode, and emits UTF-8 `Uint8Array` chunks. It reuses a single `TextEncoder`
 * and retains only per-call state (a small parts array for the current batch)
 * plus scalar counters - it never builds or retains a complete row or the
 * complete export, and never concatenates the whole export.
 *
 * Rows may be encoded across multiple bounded field batches via
 * `encodeRowChunk`, so Stage 3 can yield by cell/time/byte budget on very wide
 * rows. `encodeRow` is a convenience wrapper that encodes a whole row at once.
 * Delimiters stay exact across chunk boundaries; the line ending and the row
 * count are applied only when the row is finalized.
 *
 * BOM: emitted exactly once (when enabled), before any output bytes, via
 * `emitBom` or lazily on the first emitted chunk. Line endings: exactly one
 * configured ending per finalized row, so the final row's ending is the file's
 * final newline. A completely empty export yields empty bytes unless BOM is
 * enabled. Options are copied at construction so later caller mutation cannot
 * change a running task's delimiter, quoting, BOM, or safety policy.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 13.3-13.5.
 */

import type {
  CsvFormulaProtection,
  CsvLineEnding,
  CsvQuoteMode,
} from "./csvExportTypes";
import { applyCsvFormulaProtection } from "./csvFormulaProtection";
import { csvEmptyStringify, type CsvProjectedValue } from "./csvProjectedValue";
import { type CsvFieldEncodingOptions, encodeCsvField } from "./encodeCsvField";

export interface CsvEncodingOptions {
  delimiter: string;
  quoteMode: CsvQuoteMode;
  lineEnding: CsvLineEnding;
  utf8Bom: boolean;
  formulaProtection: CsvFormulaProtection;
}

export interface EncodeRowChunkOptions {
  /** Finalize the row: append the line ending and advance the row count. */
  endRow: boolean;
}

const BOM_BYTES: readonly number[] = [0xef, 0xbb, 0xbf];
const EMPTY: Uint8Array<ArrayBuffer> = new Uint8Array(0);

function bomChunk(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(BOM_BYTES);
}

function prependBom(
  body: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(BOM_BYTES.length + body.length);
  out.set(BOM_BYTES, 0);
  out.set(body, BOM_BYTES.length);
  return out;
}

export class CsvEncodingSession {
  private readonly encoder = new TextEncoder();
  private readonly options: CsvEncodingOptions;
  /** One immutable field-encoding options object reused for every field. */
  private readonly fieldOptions: CsvFieldEncodingOptions;
  private bomHandled = false;
  private rowCount = 0;
  /** Fields emitted so far in the current (possibly multi-chunk) row. */
  private rowFieldCount = 0;
  /** True while a row started by `encodeRowChunk` has not been finalized. */
  private rowActive = false;
  /** True after a successful `finish()`; the session is then terminal. */
  private finished = false;

  constructor(options: CsvEncodingOptions) {
    // Copy so later caller mutation cannot alter a running session's policy.
    this.options = {
      delimiter: options.delimiter,
      quoteMode: options.quoteMode,
      lineEnding: options.lineEnding,
      utf8Bom: options.utf8Bom,
      formulaProtection: options.formulaProtection,
    };
    // Built once; no per-field options-object allocation in the hot loop.
    this.fieldOptions = {
      delimiter: this.options.delimiter,
      quoteMode: this.options.quoteMode,
    };
  }

  /** Rows finalized so far (for the caller's final-newline / empty checks). */
  get emittedRowCount(): number {
    return this.rowCount;
  }

  /** Whether a chunked logical row still requires a later row end. */
  get hasOpenRow(): boolean {
    return this.rowActive;
  }

  /**
   * Emit the BOM once, before any content. Returns the BOM bytes when enabled,
   * otherwise empty. Idempotent: subsequent calls return empty. Use for a
   * BOM-only empty export.
   */
  emitBom(): Uint8Array<ArrayBuffer> {
    if (this.bomHandled) return EMPTY;
    this.bomHandled = true;
    return this.options.utf8Bom ? bomChunk() : EMPTY;
  }

  /**
   * Encode a bounded batch of a row's fields. Only `values` are processed this
   * call. Delimiters are placed relative to the whole row, so boundaries stay
   * exact. When `endRow` is true the row's line ending is appended and the row
   * count advances; otherwise the row remains open for the next chunk.
   *
   * An empty non-final chunk (`[]` with `endRow: false`) makes no valid state
   * transition and throws, so a driver cannot spin a zero-progress loop.
   */
  encodeRowChunk(
    values: readonly CsvProjectedValue[],
    options: EncodeRowChunkOptions,
  ): Uint8Array<ArrayBuffer> {
    if (this.finished) {
      throw new Error("CsvEncodingSession: session already finished");
    }
    if (values.length === 0 && !options.endRow) {
      throw new Error(
        "CsvEncodingSession: empty non-final chunk makes no progress",
      );
    }

    const parts: string[] = [];
    for (const value of values) {
      if (this.rowFieldCount > 0) parts.push(this.options.delimiter);
      parts.push(this.encodeFieldValue(value));
      this.rowFieldCount++;
    }

    if (options.endRow) {
      parts.push(this.options.lineEnding);
      this.rowActive = false;
      this.rowFieldCount = 0;
      this.rowCount++;
    } else {
      this.rowActive = true;
    }

    const body = this.encoder.encode(parts.join(""));
    return this.applyBom(body);
  }

  /**
   * Encode one flattened bounded projection chunk. `rowEnds` contains
   * cumulative exclusive offsets into `values`; duplicate offsets encode
   * zero-field rows, and values after the last offset keep the logical row
   * open for the next call.
   *
   * The method validates offsets before changing session state, retains no
   * per-row arrays, and performs one TextEncoder operation for the whole
   * accepted chunk.
   */
  encodeFlattenedChunk(
    values: readonly CsvProjectedValue[],
    rowEnds: Uint32Array,
  ): Uint8Array<ArrayBuffer> {
    if (this.finished) {
      throw new Error("CsvEncodingSession: session already finished");
    }

    let previousEnd = 0;
    for (let i = 0; i < rowEnds.length; i++) {
      const end = rowEnds[i]!;
      if (end < previousEnd || end > values.length) {
        throw new Error("CsvEncodingSession: invalid flattened row ends");
      }
      previousEnd = end;
    }

    const parts: string[] = [];
    let valueIndex = 0;
    for (let rowIndex = 0; rowIndex < rowEnds.length; rowIndex++) {
      const end = rowEnds[rowIndex]!;
      while (valueIndex < end) {
        if (this.rowFieldCount > 0) parts.push(this.options.delimiter);
        parts.push(this.encodeFieldValue(values[valueIndex]!));
        this.rowFieldCount++;
        this.rowActive = true;
        valueIndex++;
      }

      parts.push(this.options.lineEnding);
      this.rowFieldCount = 0;
      this.rowActive = false;
      if (this.rowCount < Number.MAX_SAFE_INTEGER) this.rowCount++;
    }

    while (valueIndex < values.length) {
      if (this.rowFieldCount > 0) parts.push(this.options.delimiter);
      parts.push(this.encodeFieldValue(values[valueIndex]!));
      this.rowFieldCount++;
      this.rowActive = true;
      valueIndex++;
    }

    const body = this.encoder.encode(parts.join(""));
    return this.applyBom(body);
  }

  /**
   * Encode a whole row at once (convenience). Invalid while a chunked row is in
   * progress or after finish; those transitions fail deterministically.
   */
  encodeRow(
    values: readonly CsvProjectedValue[],
  ): Uint8Array<ArrayBuffer> {
    if (this.finished) {
      throw new Error("CsvEncodingSession: session already finished");
    }
    if (this.rowActive) {
      throw new Error(
        "CsvEncodingSession: cannot start a new row while one is in progress",
      );
    }
    return this.encodeRowChunk(values, { endRow: true });
  }

  /**
   * Terminal transition. Throws if a chunked row is still open (never silently
   * accepts a row without a finalized line ending). Guarantees the empty-export
   * BOM contract: when nothing was emitted and BOM is enabled and not yet sent,
   * returns the BOM; otherwise empty. After success the session is terminal and
   * repeated calls return empty idempotently.
   */
  finish(): Uint8Array<ArrayBuffer> {
    if (this.finished) return EMPTY;
    if (this.rowActive) {
      throw new Error("CsvEncodingSession: cannot finish while a row is open");
    }
    this.finished = true;
    return this.applyBom(EMPTY);
  }

  private applyBom(
    body: Uint8Array<ArrayBuffer>,
  ): Uint8Array<ArrayBuffer> {
    if (this.bomHandled) return body;
    this.bomHandled = true;
    return this.options.utf8Bom ? prependBom(body) : body;
  }

  private encodeFieldValue(value: CsvProjectedValue): string {
    const protectedValue = applyCsvFormulaProtection(
      value,
      this.options.formulaProtection,
    );
    const text = csvEmptyStringify(protectedValue);
    // Reuse the per-session field options; no allocation per field.
    return encodeCsvField(text, this.fieldOptions);
  }
}
