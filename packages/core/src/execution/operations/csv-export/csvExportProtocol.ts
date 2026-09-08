/**
 * CSV Export V1 - Worker protocol types, validators, and transfer helpers
 * (Stage 4A).
 *
 * Pure contract only: no Worker runtime, client, Grid, sinks, or encoding.
 * Transferred message objects are single-use after `postMessage`.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 18–19.
 */

import type {
  CsvFormulaProtection,
  CsvLineEnding,
  CsvQuoteMode,
} from "../../../features/csv-export/csvExportTypes";
import { estimateCsvProjectedBytes } from "../../../features/csv-export/estimateCsvProjectedBytes";

import { isCsvExportTaskId } from "./csvExportTaskId";
import {
  CSV_CHUNK_MAX_COMPLETED_ROWS,
  CSV_CHUNK_MAX_ESTIMATED_BYTES,
  CSV_CHUNK_MAX_VALUES,
} from "./csvProjectionChunkLimits";

/** Typed projected field values posted to the Worker without stringification. */
export type CsvWorkerProjectionValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined;

/** Encoding options carried by `csv:start` only. */
export interface CsvWorkerEncodingOptions {
  delimiter: string;
  quoteMode: CsvQuoteMode;
  lineEnding: CsvLineEnding;
  utf8Bom: boolean;
  formulaProtection: CsvFormulaProtection;
}

export interface CsvStartRequest {
  kind: "csv:start";
  taskId: number;
  plannedColumnCount: number;
  encoding: CsvWorkerEncodingOptions;
}

/**
 * Flattened projection chunk. `rowEnds` entries are cumulative exclusive
 * offsets into `values`. Values after the last end are a partial open row.
 */
export interface CsvChunkRequest {
  kind: "csv:chunk";
  taskId: number;
  sequence: number;
  values: CsvWorkerProjectionValue[];
  rowEnds: Uint32Array<ArrayBuffer>;
  estimatedBytes: number;
  final: boolean;
}

export interface CsvCancelRequest {
  kind: "csv:cancel";
  taskId: number;
}

export type CsvWorkerRequest =
  | CsvStartRequest
  | CsvChunkRequest
  | CsvCancelRequest;

export interface CsvReadyResponse {
  kind: "csv:ready";
  taskId: number;
}

export interface CsvEncodedChunkResponse {
  kind: "csv:encodedChunk";
  taskId: number;
  sequence: number;
  bytes: Uint8Array<ArrayBuffer>;
  rowCount: number;
  final: boolean;
}

export interface CsvCompleteResponse {
  kind: "csv:complete";
  taskId: number;
  rowCount: number;
  byteLength: number;
}

/** Stable internal codes emitted by the CSV Worker runtime. */
export type CsvWorkerErrorCode =
  | "csv-worker/encoding-failed"
  | "csv-worker/invalid-message"
  | "csv-worker/row-state"
  | "csv-worker/sequence-mismatch"
  | "csv-worker/task-active"
  | "csv-worker/task-mismatch";

export interface CsvErrorResponse {
  kind: "csv:error";
  taskId: number;
  code: CsvWorkerErrorCode;
  message: string;
}

export interface CsvCancelledResponse {
  kind: "csv:cancelled";
  taskId: number;
}

export type CsvWorkerResponse =
  | CsvReadyResponse
  | CsvEncodedChunkResponse
  | CsvCompleteResponse
  | CsvErrorResponse
  | CsvCancelledResponse;

const QUOTE_MODES: ReadonlySet<string> = new Set(["minimal", "always", "never"]);
const LINE_ENDINGS: ReadonlySet<string> = new Set(["\r\n", "\n"]);
const FORMULA_PROTECTIONS: ReadonlySet<string> = new Set(["escape", "none"]);
const WORKER_ERROR_CODES: ReadonlySet<string> = new Set([
  "csv-worker/encoding-failed",
  "csv-worker/invalid-message",
  "csv-worker/row-state",
  "csv-worker/sequence-mismatch",
  "csv-worker/task-active",
  "csv-worker/task-mismatch",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidDelimiter(delimiter: string): boolean {
  const codePoints = [...delimiter];
  if (codePoints.length !== 1) return false;
  return delimiter !== '"' && delimiter !== "\r" && delimiter !== "\n";
}

function isCsvWorkerProjectionValue(
  value: unknown,
): value is CsvWorkerProjectionValue {
  if (value === null || value === undefined) return true;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return true;
    default:
      return false;
  }
}

function isCsvWorkerEncodingOptions(
  value: unknown,
): value is CsvWorkerEncodingOptions {
  if (!isRecord(value)) return false;
  const delimiter = value.delimiter;
  const quoteMode = value.quoteMode;
  const lineEnding = value.lineEnding;
  const utf8Bom = value.utf8Bom;
  const formulaProtection = value.formulaProtection;
  return (
    typeof delimiter === "string" &&
    isValidDelimiter(delimiter) &&
    typeof quoteMode === "string" &&
    QUOTE_MODES.has(quoteMode) &&
    typeof lineEnding === "string" &&
    LINE_ENDINGS.has(lineEnding) &&
    typeof utf8Bom === "boolean" &&
    typeof formulaProtection === "string" &&
    FORMULA_PROTECTIONS.has(formulaProtection)
  );
}

function isArrayBufferBacked(view: { buffer: ArrayBufferLike }): boolean {
  return view.buffer instanceof ArrayBuffer;
}

/**
 * Validate `rowEnds` against `values.length` without copying either buffer.
 * Entries must be non-decreasing cumulative exclusive offsets.
 */
export function isValidCsvChunkRowEnds(
  rowEnds: Uint32Array,
  valuesLength: number,
): boolean {
  if (!Number.isSafeInteger(valuesLength) || valuesLength < 0) return false;
  if (rowEnds.length > CSV_CHUNK_MAX_COMPLETED_ROWS) return false;
  let previous = 0;
  for (let i = 0; i < rowEnds.length; i++) {
    const end = rowEnds[i]!;
    if (end < previous || end > valuesLength) return false;
    previous = end;
  }
  return true;
}

function isOversizedAloneChunkShape(
  values: unknown[],
  rowEnds: Uint32Array,
  final: boolean,
  recomputedBytes: number,
): boolean {
  return (
    !final &&
    values.length === 1 &&
    rowEnds.length === 0 &&
    recomputedBytes > CSV_CHUNK_MAX_ESTIMATED_BYTES
  );
}

function isCsvStartRequest(value: Record<string, unknown>): boolean {
  return (
    value.kind === "csv:start" &&
    isCsvExportTaskId(value.taskId) &&
    isSafeNonNegativeInteger(value.plannedColumnCount) &&
    isCsvWorkerEncodingOptions(value.encoding)
  );
}

function isCsvChunkRequest(value: Record<string, unknown>): boolean {
  if (value.kind !== "csv:chunk") return false;
  if (!isCsvExportTaskId(value.taskId)) return false;
  if (!isSafeNonNegativeInteger(value.sequence)) return false;
  if (!isFiniteNonNegativeNumber(value.estimatedBytes)) return false;
  if (!Number.isInteger(value.estimatedBytes)) return false;
  if (typeof value.final !== "boolean") return false;
  if (!value.final && value.sequence === Number.MAX_SAFE_INTEGER) return false;
  if (!Array.isArray(value.values)) return false;
  if (!(value.rowEnds instanceof Uint32Array)) return false;
  if (!isArrayBufferBacked(value.rowEnds)) return false;

  const values = value.values;
  if (values.length > CSV_CHUNK_MAX_VALUES) return false;

  let recomputed = 0;
  for (let i = 0; i < values.length; i++) {
    const projected = values[i];
    if (!isCsvWorkerProjectionValue(projected)) return false;
    const cost = estimateCsvProjectedBytes(projected);
    if (recomputed >= Number.MAX_SAFE_INTEGER - cost) {
      recomputed = Number.MAX_SAFE_INTEGER;
    } else {
      recomputed += cost;
    }
  }

  if (value.estimatedBytes !== recomputed) return false;

  if (recomputed > CSV_CHUNK_MAX_ESTIMATED_BYTES) {
    if (
      !isOversizedAloneChunkShape(
        values,
        value.rowEnds,
        value.final,
        recomputed,
      )
    ) {
      return false;
    }
  }

  if (!isValidCsvChunkRowEnds(value.rowEnds, values.length)) return false;
  if (value.final) {
    const lastEnd =
      value.rowEnds.length === 0
        ? 0
        : value.rowEnds[value.rowEnds.length - 1]!;
    if (lastEnd !== values.length) return false;
  } else if (values.length === 0 && value.rowEnds.length === 0) {
    // Non-final empty chunks make no logical progress and are rejected.
    return false;
  }

  return true;
}

function isCsvCancelRequest(value: Record<string, unknown>): boolean {
  return value.kind === "csv:cancel" && isCsvExportTaskId(value.taskId);
}

function isCsvReadyResponse(value: Record<string, unknown>): boolean {
  return value.kind === "csv:ready" && isCsvExportTaskId(value.taskId);
}

function isCsvEncodedChunkResponse(value: Record<string, unknown>): boolean {
  return (
    value.kind === "csv:encodedChunk" &&
    isCsvExportTaskId(value.taskId) &&
    isSafeNonNegativeInteger(value.sequence) &&
    value.bytes instanceof Uint8Array &&
    isArrayBufferBacked(value.bytes) &&
    isSafeNonNegativeInteger(value.rowCount) &&
    typeof value.final === "boolean"
  );
}

function isCsvCompleteResponse(value: Record<string, unknown>): boolean {
  return (
    value.kind === "csv:complete" &&
    isCsvExportTaskId(value.taskId) &&
    isSafeNonNegativeInteger(value.rowCount) &&
    isSafeNonNegativeInteger(value.byteLength)
  );
}

function isCsvErrorResponse(value: Record<string, unknown>): boolean {
  return (
    value.kind === "csv:error" &&
    isCsvExportTaskId(value.taskId) &&
    typeof value.code === "string" &&
    WORKER_ERROR_CODES.has(value.code) &&
    typeof value.message === "string"
  );
}

function isCsvCancelledResponse(value: Record<string, unknown>): boolean {
  return value.kind === "csv:cancelled" && isCsvExportTaskId(value.taskId);
}

/** Narrow an unknown Worker request. Bounded by the received message only. */
export function isCsvWorkerRequest(value: unknown): value is CsvWorkerRequest {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "csv:start":
      return isCsvStartRequest(value);
    case "csv:chunk":
      return isCsvChunkRequest(value);
    case "csv:cancel":
      return isCsvCancelRequest(value);
    default:
      return false;
  }
}

/** Narrow an unknown Worker response. Bounded by the received message only. */
export function isCsvWorkerResponse(value: unknown): value is CsvWorkerResponse {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "csv:ready":
      return isCsvReadyResponse(value);
    case "csv:encodedChunk":
      return isCsvEncodedChunkResponse(value);
    case "csv:complete":
      return isCsvCompleteResponse(value);
    case "csv:error":
      return isCsvErrorResponse(value);
    case "csv:cancelled":
      return isCsvCancelledResponse(value);
    default:
      return false;
  }
}

/**
 * Transfer list for `csv:chunk`. Transfers `rowEnds.buffer` only; `values`
 * remain structured-clone owned. Returns a fresh list; does not clone buffers.
 * The message is single-use after posting.
 */
export function getCsvChunkTransferList(
  message: CsvChunkRequest,
): ArrayBuffer[] {
  return [message.rowEnds.buffer];
}

/**
 * Transfer list for `csv:encodedChunk`. Transfers `bytes.buffer` only.
 * Returns a fresh list; does not clone buffers. The message is single-use
 * after posting.
 */
export function getCsvEncodedChunkTransferList(
  message: CsvEncodedChunkResponse,
): ArrayBuffer[] {
  return [message.bytes.buffer];
}
