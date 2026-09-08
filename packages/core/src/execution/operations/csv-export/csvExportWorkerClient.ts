/**
 * CSV Export V1 - main-thread Worker transport client (Stage 4C).
 *
 * Owns one logical task, one unacknowledged projection chunk, strict response
 * validation, byte-acceptance backpressure, and terminal callback ownership.
 * Projection planning, sink implementations, fallback execution, Worker
 * creation, and Grid integration remain outside this transport layer.
 */

import type {
  CsvChunkRequest,
  CsvCompleteResponse,
  CsvStartRequest,
  CsvWorkerEncodingOptions,
  CsvWorkerRequest,
  CsvWorkerResponse,
} from "./csvExportProtocol";
import {
  getCsvChunkTransferList,
  isCsvWorkerRequest,
  isCsvWorkerResponse,
} from "./csvExportProtocol";
import { isCsvExportTaskId } from "./csvExportTaskId";

export interface CsvExportWorkerTransport {
  post(message: CsvWorkerRequest, transfer?: Transferable[]): void;
  subscribe(handler: (message: unknown) => void): () => void;
  subscribeError?(handler: (error: unknown) => void): () => void;
  terminate?(): void;
}

export type CsvExportWorkerOutputType =
  | "download"
  | "text"
  | "blob"
  | "stream";

export type CsvExportWorkerFailureKind = "worker" | "protocol" | "sink";

export interface CsvExportWorkerChunkAccepted {
  sequence: number;
  rowCount: number;
  byteLength: number;
  final: boolean;
}

export interface CsvExportWorkerFailure {
  error: Error;
  kind: CsvExportWorkerFailureKind;
  canRestartOnMain: boolean;
}

export interface CsvExportWorkerCallbacks {
  acceptBytes(bytes: Uint8Array<ArrayBuffer>): void | Promise<void>;
  onReady(): void;
  onChunkAccepted(result: CsvExportWorkerChunkAccepted): void;
  onComplete(result: CsvCompleteResponse): void;
  onFailure(failure: CsvExportWorkerFailure): void;
  onCancelled(): void;
}

export interface CsvExportWorkerStartConfig {
  taskId: number;
  plannedColumnCount: number;
  encoding: CsvWorkerEncodingOptions;
  outputType: CsvExportWorkerOutputType;
  callbacks: CsvExportWorkerCallbacks;
}

export interface CsvExportWorkerTaskHandle {
  postChunk(chunk: CsvChunkRequest): boolean;
  cancel(): void;
}

interface InFlightChunk {
  sequence: number;
  final: boolean;
  acceptanceStarted: boolean;
  rowCount: number;
  byteLength: number;
}

interface LogicalTaskToken {
  readonly identity: symbol;
}

interface ActiveWorkerTask {
  token: LogicalTaskToken;
  taskId: number;
  outputType: CsvExportWorkerOutputType;
  callbacks: CsvExportWorkerCallbacks;
  ready: boolean;
  finalPosted: boolean;
  finalAccepted: boolean;
  inFlight: InFlightChunk | null;
  pendingComplete: CsvCompleteResponse | null;
  acceptedRowCount: number;
  acceptedByteLength: number;
}

const INACTIVE_HANDLE: CsvExportWorkerTaskHandle = {
  postChunk: () => false,
  cancel() {},
};

function saturatingAdd(left: number, right: number): number {
  if (left >= Number.MAX_SAFE_INTEGER - right) return Number.MAX_SAFE_INTEGER;
  return left + right;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getResponseTaskId(response: unknown): number | null {
  if (typeof response !== "object" || response === null) return null;
  if (!("taskId" in response)) return null;
  return isCsvExportTaskId(response.taskId) ? response.taskId : null;
}

function isValidCsvChunkRequest(value: unknown): value is CsvChunkRequest {
  return isCsvWorkerRequest(value) && value.kind === "csv:chunk";
}

export class CsvExportWorkerClient {
  private readonly unsubscribe: () => void;
  private readonly unsubscribeError: (() => void) | null;
  private latestStartAttempt: LogicalTaskToken | null = null;
  private lastStartedTaskId: number | null = null;
  private activeTask: ActiveWorkerTask | null = null;
  private destroyed = false;

  constructor(private readonly transport: CsvExportWorkerTransport) {
    this.unsubscribe = transport.subscribe((response) =>
      this.handleResponse(response),
    );
    this.unsubscribeError =
      transport.subscribeError?.((error) => this.handleTransportError(error)) ??
      null;
  }

  start(config: CsvExportWorkerStartConfig): CsvExportWorkerTaskHandle {
    if (this.destroyed) {
      config.callbacks.onFailure({
        error: new Error("CsvExportWorkerClient destroyed"),
        kind: "worker",
        canRestartOnMain: true,
      });
      return INACTIVE_HANDLE;
    }

    if (
      !isCsvExportTaskId(config.taskId) ||
      (this.lastStartedTaskId !== null &&
        config.taskId <= this.lastStartedTaskId)
    ) {
      config.callbacks.onFailure({
        error: new Error("CSV Worker taskId must increase for each start"),
        kind: "protocol",
        canRestartOnMain: true,
      });
      return INACTIVE_HANDLE;
    }

    const token: LogicalTaskToken = { identity: Symbol() };
    this.latestStartAttempt = token;
    this.lastStartedTaskId = config.taskId;
    this.cancelActiveTask();
    if (
      this.isDestroyed() ||
      this.latestStartAttempt !== token
    ) {
      config.callbacks.onCancelled();
      return INACTIVE_HANDLE;
    }

    const active: ActiveWorkerTask = {
      token,
      taskId: config.taskId,
      outputType: config.outputType,
      callbacks: config.callbacks,
      ready: false,
      finalPosted: false,
      finalAccepted: false,
      inFlight: null,
      pendingComplete: null,
      acceptedRowCount: 0,
      acceptedByteLength: 0,
    };
    this.activeTask = active;

    const request: CsvStartRequest = {
      kind: "csv:start",
      taskId: config.taskId,
      plannedColumnCount: config.plannedColumnCount,
      encoding: config.encoding,
    };
    try {
      this.transport.post(request);
    } catch (error) {
      this.fail(active, "worker", toError(error));
    }

    return {
      postChunk: (chunk) => this.postChunk(token, chunk),
      cancel: () => this.cancelToken(token),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelActiveTask();
    try {
      this.unsubscribe();
    } finally {
      try {
        this.unsubscribeError?.();
      } finally {
        this.transport.terminate?.();
      }
    }
  }

  private postChunk(
    token: LogicalTaskToken,
    chunk: CsvChunkRequest,
  ): boolean {
    const active = this.activeTask;
    if (
      active === null ||
      active.token !== token ||
      !active.ready ||
      active.inFlight !== null ||
      active.finalPosted ||
      chunk.taskId !== active.taskId ||
      !isValidCsvChunkRequest(chunk)
    ) {
      return false;
    }

    const inFlight: InFlightChunk = {
      sequence: chunk.sequence,
      final: chunk.final,
      acceptanceStarted: false,
      rowCount: 0,
      byteLength: 0,
    };
    active.inFlight = inFlight;
    if (chunk.final) active.finalPosted = true;

    try {
      this.transport.post(chunk, getCsvChunkTransferList(chunk));
      return true;
    } catch (error) {
      this.fail(active, "worker", toError(error));
      return false;
    }
  }

  private handleResponse(response: unknown): void {
    const active = this.activeTask;
    if (active === null) return;

    if (!isCsvWorkerResponse(response)) {
      const taskId = getResponseTaskId(response);
      if (taskId === active.taskId) {
        this.fail(
          active,
          "protocol",
          new Error("Invalid CSV Worker response"),
        );
      }
      return;
    }
    if (response.taskId !== active.taskId) return;

    switch (response.kind) {
      case "csv:ready":
        this.handleReady(active);
        return;
      case "csv:encodedChunk":
        this.handleEncodedChunk(active, response);
        return;
      case "csv:complete":
        this.handleComplete(active, response);
        return;
      case "csv:error":
        this.fail(
          active,
          "worker",
          new Error(`[${response.code}] ${response.message}`),
        );
        return;
      case "csv:cancelled":
        this.activeTask = null;
        active.callbacks.onCancelled();
    }
  }

  private handleReady(active: ActiveWorkerTask): void {
    if (active.ready || active.inFlight !== null) {
      this.fail(active, "protocol", new Error("Duplicate CSV Worker ready"));
      return;
    }
    active.ready = true;
    active.callbacks.onReady();
  }

  private handleEncodedChunk(
    active: ActiveWorkerTask,
    response: Extract<CsvWorkerResponse, { kind: "csv:encodedChunk" }>,
  ): void {
    const inFlight = active.inFlight;
    if (
      inFlight === null ||
      inFlight.sequence !== response.sequence ||
      inFlight.final !== response.final ||
      inFlight.acceptanceStarted
    ) {
      this.fail(
        active,
        "protocol",
        new Error("Unexpected CSV Worker encoded chunk"),
      );
      return;
    }

    inFlight.acceptanceStarted = true;
    inFlight.rowCount = response.rowCount;
    inFlight.byteLength = response.bytes.byteLength;

    let acceptance: void | Promise<void>;
    try {
      acceptance = active.callbacks.acceptBytes(response.bytes);
    } catch (error) {
      this.fail(active, "sink", toError(error));
      return;
    }

    if (acceptance === undefined) {
      this.completeByteAcceptance(active, inFlight);
      return;
    }

    void acceptance.then(
      () => this.completeByteAcceptance(active, inFlight),
      (error: unknown) => this.fail(active, "sink", toError(error)),
    );
  }

  private completeByteAcceptance(
    active: ActiveWorkerTask,
    inFlight: InFlightChunk,
  ): void {
    if (this.activeTask !== active || active.inFlight !== inFlight) return;

    active.acceptedRowCount = saturatingAdd(
      active.acceptedRowCount,
      inFlight.rowCount,
    );
    active.acceptedByteLength = saturatingAdd(
      active.acceptedByteLength,
      inFlight.byteLength,
    );
    active.inFlight = null;
    if (inFlight.final) active.finalAccepted = true;

    active.callbacks.onChunkAccepted({
      sequence: inFlight.sequence,
      rowCount: inFlight.rowCount,
      byteLength: inFlight.byteLength,
      final: inFlight.final,
    });

    if (this.activeTask !== active || !inFlight.final) return;
    const complete = active.pendingComplete;
    if (complete !== null) this.finishComplete(active, complete);
  }

  private handleComplete(
    active: ActiveWorkerTask,
    response: CsvCompleteResponse,
  ): void {
    if (active.pendingComplete !== null) {
      this.fail(
        active,
        "protocol",
        new Error("Duplicate CSV Worker completion"),
      );
      return;
    }

    const inFlight = active.inFlight;
    if (inFlight !== null) {
      if (!inFlight.final || !inFlight.acceptanceStarted) {
        this.fail(
          active,
          "protocol",
          new Error("CSV Worker completed before its final encoded chunk"),
        );
        return;
      }
      active.pendingComplete = response;
      return;
    }

    if (!active.finalAccepted) {
      this.fail(
        active,
        "protocol",
        new Error("CSV Worker completed without accepted final bytes"),
      );
      return;
    }
    this.finishComplete(active, response);
  }

  private finishComplete(
    active: ActiveWorkerTask,
    response: CsvCompleteResponse,
  ): void {
    if (
      response.rowCount !== active.acceptedRowCount ||
      response.byteLength !== active.acceptedByteLength
    ) {
      this.fail(
        active,
        "protocol",
        new Error("CSV Worker completion totals do not match accepted chunks"),
      );
      return;
    }

    this.activeTask = null;
    active.pendingComplete = null;
    active.callbacks.onComplete(response);
  }

  private handleTransportError(error: unknown): void {
    const active = this.activeTask;
    if (active === null) return;
    this.fail(active, "worker", toError(error));
  }

  private cancelToken(token: LogicalTaskToken): void {
    const active = this.activeTask;
    if (active === null || active.token !== token) return;
    this.cancelActiveTask();
  }

  private cancelActiveTask(): void {
    const active = this.activeTask;
    if (active === null) return;
    this.activeTask = null;
    this.postCancelBestEffort(active.taskId);
    active.callbacks.onCancelled();
  }

  private fail(
    active: ActiveWorkerTask,
    kind: CsvExportWorkerFailureKind,
    error: Error,
  ): void {
    if (this.activeTask !== active) return;
    const streamOutputMayBeVisible =
      active.acceptedByteLength > 0 ||
      active.inFlight?.acceptanceStarted === true;
    const canRestartOnMain =
      kind !== "sink" &&
      (active.outputType !== "stream" || !streamOutputMayBeVisible);
    this.activeTask = null;
    this.postCancelBestEffort(active.taskId);
    active.callbacks.onFailure({ error, kind, canRestartOnMain });
  }

  private postCancelBestEffort(taskId: number): void {
    try {
      this.transport.post({ kind: "csv:cancel", taskId });
    } catch {
      // The logical terminal callback already owns the outcome.
    }
  }

  private isDestroyed(): boolean {
    return this.destroyed;
  }
}
