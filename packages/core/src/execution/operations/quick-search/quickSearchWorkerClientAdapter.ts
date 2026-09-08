/**
 * Adapter from {@link QuickSearchWorkerClient} to the generic
 * {@link OperationWorkerClient} interface expected by
 * {@link WorkerTaskExecutor}.
 *
 * The existing `QuickSearchWorkerClient` manages snapshot sync,
 * query posting, and cancellation — this adapter translates the
 * callback-based API to the `execute(requestId, payload, onSuccess,
 * onError)` contract.
 *
 * `payload.transfer` is adapter-only main-thread metadata: it is
 * forwarded into {@link QuickSearchWorkerClient.execute} unchanged and
 * is never serialized to Worker.postMessage. If handoff fails before
 * `client.execute()`, the unconsumed transfer is cancelled exactly once.
 */

import type { CooperativeHandle } from "../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";
import type { OperationWorkerClient } from "../types";

import type {
  SnapshotSyncConfig,
  SnapshotTransferInput,
} from "./QuickSearchSnapshotClient";
import {
  QuickSearchWorkerClient,
  type QuickSearchWorkerTransport,
} from "./QuickSearchWorkerClient";
import type { QuickSearchWorkerPayload } from "./quickSearchWorkerPayload";

const NOOP_HANDLE: CooperativeHandle = { cancel() {} };

function cancelUnconsumedTransfer(
  transfer: SnapshotTransferInput | undefined,
): void {
  if (transfer === undefined) return;
  transfer.onDisposition({
    kind: "cancelled",
    transferId: transfer.transferId,
  });
}

export class QuickSearchWorkerClientAdapter
  implements OperationWorkerClient<QuickSearchWorkerPayload, Uint32Array>
{
  private client: QuickSearchWorkerClient | null = null;
  private destroyed = false;
  private readonly prewarmScheduler = new CooperativeScheduler();

  private ensureClient(): QuickSearchWorkerClient {
    if (this.client) return this.client;
    if (typeof Worker === "undefined") {
      throw new Error("Worker unavailable");
    }
    const worker = new Worker(
      new URL("./quickSearchWorker.ts", import.meta.url),
      { type: "module" },
    );
    const transport: QuickSearchWorkerTransport = {
      post: (msg, transfer) => worker.postMessage(msg, transfer ?? []),
      subscribe: (handler) => {
        const listener = (event: MessageEvent) => handler(event.data);
        worker.addEventListener("message", listener);
        return () => worker.removeEventListener("message", listener);
      },
      terminate: () => worker.terminate(),
    };
    this.client = new QuickSearchWorkerClient(transport);
    return this.client;
  }

  execute(
    requestId: number,
    payload: QuickSearchWorkerPayload,
    onSuccess: (requestId: number, output: Uint32Array) => void,
    onError: (requestId: number, error: Error) => void,
  ): void {
    if (this.destroyed) {
      cancelUnconsumedTransfer(payload.transfer);
      onError(requestId, new Error("QuickSearchWorkerClientAdapter destroyed"));
      return;
    }

    let client: QuickSearchWorkerClient;
    try {
      client = this.ensureClient();
    } catch (err) {
      cancelUnconsumedTransfer(payload.transfer);
      onError(requestId, err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Handoff complete — SnapshotClient owns disposition from here.
    client.execute(
      {
        rows: payload.rows,
        descriptors: payload.descriptors,
        fieldsSignature: payload.fieldsSignature,
        normalizedText: payload.normalizedText,
        sourceIndexes: payload.sourceIndexes,
        sourceVersion: payload.sourceVersion,
        cacheMode: payload.cacheMode,
        sourceLayoutRevision: payload.sourceLayoutRevision,
        searchableDataRevision: payload.searchableDataRevision,
        transfer: payload.transfer,
      },
      {
        onSuccess: (indexes) => onSuccess(requestId, indexes),
        onFallback: (error) => onError(requestId, error),
      },
    );
  }

  /** Background snapshot sync — never posts a query. */
  prewarmSnapshot(config: SnapshotSyncConfig): CooperativeHandle {
    if (this.destroyed) return NOOP_HANDLE;

    if (this.client) {
      try {
        return this.client.prewarm(config);
      } catch {
        return NOOP_HANDLE;
      }
    }

    let innerHandle: CooperativeHandle | null = null;
    let cancelled = false;

    const bootstrapHandle = this.prewarmScheduler.schedule(() => {
      if (cancelled || this.destroyed) return;
      try {
        const client = this.ensureClient();
        innerHandle = client.prewarm(config);
      } catch {
        // Worker unavailable — prewarm is optional.
      }
    }, { priority: "background" });

    return {
      cancel: () => {
        cancelled = true;
        bootstrapHandle.cancel();
        innerHandle?.cancel();
      },
    };
  }

  cancel(): void {
    this.client?.cancelQuery();
  }

  /**
   * Drop the worker snapshot (and any active query). Used on explicit
   * quick-filter disable so a later re-enable starts a fresh generation
   * and can never reuse a pre-disable snapshot (§9).
   */
  clearSnapshot(): void {
    this.client?.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.client?.destroy();
    this.client = null;
    this.destroyed = true;
  }
}
