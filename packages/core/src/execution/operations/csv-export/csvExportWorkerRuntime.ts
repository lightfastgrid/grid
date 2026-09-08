/**
 * CSV Export V1 - stateful Worker-side encoder runtime (Stage 4B).
 *
 * Owns one task at a time, validates every unknown message through the Stage
 * 4A protocol, enforces strict chunk sequencing, and encodes only flattened
 * projected values. It has no scheduler, sink, Grid, row-object, callback, or
 * renderer dependency.
 */

import { CsvEncodingSession } from "../../../features/csv-export/csvUtf8Encoder";

import type {
  CsvCancelRequest,
  CsvChunkRequest,
  CsvErrorResponse,
  CsvStartRequest,
  CsvWorkerErrorCode,
  CsvWorkerResponse,
} from "./csvExportProtocol";
import { isCsvWorkerRequest } from "./csvExportProtocol";
import { isCsvExportTaskId } from "./csvExportTaskId";

interface ActiveCsvWorkerTask {
  taskId: number;
  plannedColumnCount: number;
  expectedSequence: number;
  encoder: CsvEncodingSession;
  rowCount: number;
  byteLength: number;
}

const ERROR_MESSAGES: Readonly<Record<CsvWorkerErrorCode, string>> = {
  "csv-worker/encoding-failed": "CSV Worker encoding failed",
  "csv-worker/invalid-message": "Invalid CSV Worker message",
  "csv-worker/row-state": "Final CSV chunk left a logical row open",
  "csv-worker/sequence-mismatch": "CSV chunk sequence mismatch",
  "csv-worker/task-active": "Another CSV Worker task is already active",
  "csv-worker/task-mismatch": "CSV Worker task does not match the active task",
};

function saturatingAdd(left: number, right: number): number {
  if (left >= Number.MAX_SAFE_INTEGER - right) return Number.MAX_SAFE_INTEGER;
  return left + right;
}

function getMessageTaskId(message: unknown): number | null {
  if (typeof message !== "object" || message === null) return null;
  if (!("taskId" in message)) return null;
  return isCsvExportTaskId(message.taskId) ? message.taskId : null;
}

export class CsvExportWorkerRuntime {
  private activeTask: ActiveCsvWorkerTask | null = null;

  constructor(private readonly post: (response: CsvWorkerResponse) => void) {}

  handleMessage(message: unknown): void {
    if (!isCsvWorkerRequest(message)) {
      const taskId = getMessageTaskId(message);
      if (taskId !== null) {
        this.postError(taskId, "csv-worker/invalid-message");
      }
      return;
    }

    switch (message.kind) {
      case "csv:start":
        this.handleStart(message);
        return;
      case "csv:chunk":
        this.handleChunk(message);
        return;
      case "csv:cancel":
        this.handleCancel(message);
    }
  }

  private handleStart(message: CsvStartRequest): void {
    if (this.activeTask !== null) {
      this.postError(message.taskId, "csv-worker/task-active");
      return;
    }

    this.activeTask = {
      taskId: message.taskId,
      plannedColumnCount: message.plannedColumnCount,
      expectedSequence: 0,
      encoder: new CsvEncodingSession(message.encoding),
      rowCount: 0,
      byteLength: 0,
    };
    this.post({ kind: "csv:ready", taskId: message.taskId });
  }

  private handleChunk(message: CsvChunkRequest): void {
    const active = this.activeTask;
    if (active === null || active.taskId !== message.taskId) {
      this.postError(message.taskId, "csv-worker/task-mismatch");
      return;
    }

    if (message.sequence !== active.expectedSequence) {
      this.activeTask = null;
      this.postError(message.taskId, "csv-worker/sequence-mismatch");
      return;
    }

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = active.encoder.encodeFlattenedChunk(
        message.values,
        message.rowEnds,
      );
    } catch {
      this.activeTask = null;
      this.postError(message.taskId, "csv-worker/encoding-failed");
      return;
    }

    if (message.final && active.encoder.hasOpenRow) {
      this.activeTask = null;
      this.postError(message.taskId, "csv-worker/row-state");
      return;
    }

    if (message.final) {
      try {
        active.encoder.finish();
      } catch {
        this.activeTask = null;
        this.postError(message.taskId, "csv-worker/encoding-failed");
        return;
      }
    }

    const chunkRowCount = message.rowEnds.length;
    active.rowCount = saturatingAdd(active.rowCount, chunkRowCount);
    active.byteLength = saturatingAdd(active.byteLength, bytes.byteLength);

    const encoded = {
      kind: "csv:encodedChunk",
      taskId: message.taskId,
      sequence: message.sequence,
      bytes,
      rowCount: chunkRowCount,
      final: message.final,
    } as const;

    if (!message.final) {
      active.expectedSequence = message.sequence + 1;
      this.post(encoded);
      return;
    }

    const complete = {
      kind: "csv:complete",
      taskId: message.taskId,
      rowCount: active.rowCount,
      byteLength: active.byteLength,
    } as const;
    this.activeTask = null;
    this.post(encoded);
    this.post(complete);
  }

  private handleCancel(message: CsvCancelRequest): void {
    if (this.activeTask?.taskId !== message.taskId) return;
    this.activeTask = null;
    this.post({ kind: "csv:cancelled", taskId: message.taskId });
  }

  private postError(taskId: number, code: CsvWorkerErrorCode): void {
    const response: CsvErrorResponse = {
      kind: "csv:error",
      taskId,
      code,
      message: ERROR_MESSAGES[code],
    };
    this.post(response);
  }
}
