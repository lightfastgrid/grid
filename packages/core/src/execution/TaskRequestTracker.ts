import type { ExecutionOperationName } from "./operations/types";

export class TaskRequestTracker {
  private counters = new Map<ExecutionOperationName, number>();

  next(kind: ExecutionOperationName): number {
    const id = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, id);
    return id;
  }

  isLatest(kind: ExecutionOperationName, requestId: number): boolean {
    return (this.counters.get(kind) ?? 0) === requestId;
  }

  cancel(kind: ExecutionOperationName): void {
    const current = this.counters.get(kind) ?? 0;
    this.counters.set(kind, current + 1);
  }
}
