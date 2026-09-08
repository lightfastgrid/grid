import type { IndexPredicate } from "../../../features/filters/filterPredicateCore";
import { compileCachedColumnPredicate } from "../../../features/filters/filterPredicateCore";

import type { WorkerFilterFieldEntry,WorkerFilterPayload } from "./filterWorkerPayload";

export interface WorkerFilterAlgorithmResult {
  indexes: Uint32Array;
}

function compileFieldPredicate(
  entry: WorkerFilterFieldEntry,
): IndexPredicate | null {
  return compileCachedColumnPredicate(entry.model, entry.cache);
}

export function executeWorkerFilterPayload(
  payload: WorkerFilterPayload,
): WorkerFilterAlgorithmResult {
  const { rowCount, sourceIndexes, fields } = payload;

  const columnPreds: IndexPredicate[] = [];
  for (const entry of fields) {
    const pred = compileFieldPredicate(entry);
    if (pred !== null) columnPreds.push(pred);
  }

  const hasSource = sourceIndexes !== null;
  const scanLength = hasSource ? sourceIndexes.length : rowCount;

  if (columnPreds.length === 0) {
    if (hasSource) {
      return { indexes: new Uint32Array(sourceIndexes) };
    }
    const all = new Uint32Array(rowCount);
    for (let i = 0; i < rowCount; i++) all[i] = i;
    return { indexes: all };
  }

  const predCount = columnPreds.length;
  const buf = new Uint32Array(scanLength);
  let count = 0;

  for (let i = 0; i < scanLength; i++) {
    const idx = hasSource ? sourceIndexes[i]! : i;
    let pass = true;
    for (let p = 0; p < predCount; p++) {
      if (!columnPreds[p]!(idx)) {
        pass = false;
        break;
      }
    }
    if (pass) {
      buf[count++] = idx;
    }
  }

  return { indexes: count === scanLength ? buf : buf.slice(0, count) };
}
