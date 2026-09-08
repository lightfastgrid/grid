import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { QuickSearchDirtySourceAccumulator } from "../quickSearchDirtySourceAccumulator";

const here = dirname(fileURLToPath(import.meta.url));
const accumulatorSource = readFileSync(
  join(here, "../quickSearchDirtySourceAccumulator.ts"),
  "utf8",
);

function sorted(indexes: ReadonlySet<number>): number[] {
  return [...indexes].sort((a, b) => a - b);
}

describe("QuickSearchDirtySourceAccumulator", () => {
  it("unions indexes across records and deduplicates", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1, 3], true);
    acc.record([3, 5], true);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 3, 5]);
  });

  it("snapshot returns a stable copy, not the mutable internal set", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([0], true);
    const first = acc.snapshot();
    const second = acc.snapshot();
    expect(first.indexes).not.toBe(second.indexes);
    expect(first.indexes).toEqual(second.indexes);

    acc.record([2], true);
    expect(first.indexes.has(2)).toBe(false);
    expect(acc.snapshot().indexes.has(2)).toBe(true);
  });

  it("clear removes indexes and restores completeness", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([0], false);
    expect(acc.snapshot().complete).toBe(false);
    acc.clear();
    const snap = acc.snapshot();
    expect(snap.indexes.size).toBe(0);
    expect(snap.complete).toBe(true);
  });

  it("marks incomplete when coverageComplete is false", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([0], false);
    expect(acc.snapshot().complete).toBe(false);
    expect([...acc.snapshot().indexes]).toEqual([0]);
  });

  it("incomplete coverage remains sticky across later complete records", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([0], false);
    expect(acc.snapshot().complete).toBe(false);
    acc.record([2], true);
    const snap = acc.snapshot();
    expect(snap.complete).toBe(false);
    expect(sorted(snap.indexes)).toEqual([0, 2]);
  });

  it("complete records keep completeness true", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([4, 7], true);
    const snap = acc.snapshot();
    expect(snap.complete).toBe(true);
    expect(sorted(snap.indexes)).toEqual([4, 7]);
  });

  it("record never removes previously retained indexes", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1, 2], true);
    acc.record([], true);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 2]);
  });

  it("begin transfers pending ownership without losing snapshot visibility", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1, 2], true);
    const transfer = acc.beginTransfer();
    expect(transfer.transferId).toBe(1);
    expect(sorted(transfer.indexes)).toEqual([1, 2]);
    expect(transfer.complete).toBe(true);
    // Snapshot still shows in-flight indexes.
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 2]);
  });

  it("record after begin remains pending and visible in union snapshot", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const transfer = acc.beginTransfer();
    acc.record([3], true);
    expect(sorted(transfer.indexes)).toEqual([1]);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 3]);
  });

  it("same-index edit after begin survives acknowledgement", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const transfer = acc.beginTransfer();
    acc.record([1], true);
    expect(acc.acknowledgeTransferPosted(transfer.transferId)).toBe(true);
    expect(sorted(acc.snapshot().indexes)).toEqual([1]);
    expect(acc.snapshot().complete).toBe(true);
  });

  it("different-index edit after begin survives acknowledgement", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const transfer = acc.beginTransfer();
    acc.record([5], true);
    expect(acc.acknowledgeTransferPosted(transfer.transferId)).toBe(true);
    expect(sorted(acc.snapshot().indexes)).toEqual([5]);
  });

  it("cancel restores in-flight indexes", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1, 2], true);
    const transfer = acc.beginTransfer();
    acc.record([9], true);
    expect(acc.cancelTransfer(transfer.transferId)).toBe(true);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 2, 9]);
  });

  it("superseding begin unions old in-flight and new pending indexes", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const first = acc.beginTransfer();
    acc.record([2], true);
    const second = acc.beginTransfer();
    expect(first.transferId).not.toBe(second.transferId);
    expect(sorted(second.indexes)).toEqual([1, 2]);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 2]);
  });

  it("incomplete state survives cancel and supersession", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], false);
    const first = acc.beginTransfer();
    expect(first.complete).toBe(false);
    acc.record([2], true);
    expect(acc.cancelTransfer(first.transferId)).toBe(true);
    expect(acc.snapshot().complete).toBe(false);

    const second = acc.beginTransfer();
    expect(second.complete).toBe(false);
    acc.record([3], true);
    const third = acc.beginTransfer();
    expect(third.complete).toBe(false);
    expect(sorted(third.indexes)).toEqual([1, 2, 3]);
  });

  it("incomplete transfer acknowledgement is rejected without mutation", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], false);
    const transfer = acc.beginTransfer();
    expect(transfer.complete).toBe(false);

    expect(acc.acknowledgeTransferPosted(transfer.transferId)).toBe(false);
    expect(acc.snapshot().complete).toBe(false);
    expect(sorted(acc.snapshot().indexes)).toEqual([1]);

    // Empty incomplete transfer must not become empty+complete via ack.
    acc.clear();
    acc.record([], false);
    const emptyIncomplete = acc.beginTransfer();
    expect(emptyIncomplete.complete).toBe(false);
    expect(emptyIncomplete.indexes.size).toBe(0);
    expect(acc.acknowledgeTransferPosted(emptyIncomplete.transferId)).toBe(false);
    expect(acc.snapshot().complete).toBe(false);
    expect(acc.snapshot().indexes.size).toBe(0);

    expect(acc.cancelTransfer(emptyIncomplete.transferId)).toBe(true);
    expect(acc.snapshot().complete).toBe(false);
  });

  it("full-snapshot coverage ack drops incomplete in-flight and preserves pending", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], false);
    const transfer = acc.beginTransfer();
    expect(transfer.complete).toBe(false);
    acc.record([2], true);

    expect(
      acc.acknowledgeTransferCoveredByFullSnapshot(transfer.transferId),
    ).toBe(true);
    expect(sorted(acc.snapshot().indexes)).toEqual([2]);
    expect(acc.snapshot().complete).toBe(true);

    // Stale coverage ack is a no-op.
    expect(
      acc.acknowledgeTransferCoveredByFullSnapshot(transfer.transferId),
    ).toBe(false);
    expect(sorted(acc.snapshot().indexes)).toEqual([2]);
  });

  it("beginTransfer returns the same ReadonlySet reference retained as ownership", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1, 2], true);
    const transfer = acc.beginTransfer();
    // Snapshot union still includes in-flight indexes; ownership set is stable.
    expect(transfer.indexes.has(1)).toBe(true);
    expect(transfer.indexes.has(2)).toBe(true);
    expect(acc.acknowledgeTransferPosted(transfer.transferId)).toBe(true);
  });

  it("beginTransferIfNeeded returns undefined for empty + complete without allocating an ID", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    expect(acc.beginTransferIfNeeded()).toBeUndefined();
    acc.record([1], true);
    const first = acc.beginTransferIfNeeded();
    expect(first).toBeDefined();
    expect(first!.transferId).toBe(1);
    expect(acc.acknowledgeTransferPosted(first!.transferId)).toBe(true);
    expect(acc.beginTransferIfNeeded()).toBeUndefined();
    // Next real begin still uses monotonic IDs (undefined path did not bump).
    acc.record([2], true);
    expect(acc.beginTransfer()!.transferId).toBe(2);
  });

  it("beginTransferIfNeeded creates a transfer for empty + incomplete coverage", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([], false);
    const transfer = acc.beginTransferIfNeeded();
    expect(transfer).toBeDefined();
    expect(transfer!.indexes.size).toBe(0);
    expect(transfer!.complete).toBe(false);
  });

  it("beginTransferIfNeeded unions existing in-flight with pending", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const first = acc.beginTransfer();
    acc.record([2], true);
    const second = acc.beginTransferIfNeeded();
    expect(second).toBeDefined();
    expect(second!.transferId).not.toBe(first.transferId);
    expect(sorted(second!.indexes)).toEqual([1, 2]);
  });

  it("acknowledgement removes only matching in-flight state", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const transfer = acc.beginTransfer();
    acc.record([2], true);
    expect(acc.acknowledgeTransferPosted(transfer.transferId)).toBe(true);
    expect(sorted(acc.snapshot().indexes)).toEqual([2]);
  });

  it("stale cancel/ack cannot alter active or newer transfer", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const first = acc.beginTransfer();
    acc.record([2], true);
    const second = acc.beginTransfer();

    expect(acc.cancelTransfer(first.transferId)).toBe(false);
    expect(acc.acknowledgeTransferPosted(first.transferId)).toBe(false);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 2]);
    expect(second.transferId).toBe(2);

    expect(acc.acknowledgeTransferPosted(second.transferId)).toBe(true);
    expect(acc.snapshot().indexes.size).toBe(0);
  });

  it("clear invalidates active transfer", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const transfer = acc.beginTransfer();
    acc.clear();
    expect(acc.cancelTransfer(transfer.transferId)).toBe(false);
    expect(acc.acknowledgeTransferPosted(transfer.transferId)).toBe(false);
    expect(acc.snapshot().indexes.size).toBe(0);
    expect(acc.snapshot().complete).toBe(true);
  });

  it("transfer IDs stay monotonic across clear", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    const first = acc.beginTransfer();
    acc.clear();
    acc.record([2], true);
    const second = acc.beginTransfer();
    expect(second.transferId).toBeGreaterThan(first.transferId);
  });

  it("snapshot is a stable copy of pending ∪ in-flight", () => {
    const acc = new QuickSearchDirtySourceAccumulator();
    acc.record([1], true);
    acc.beginTransfer();
    acc.record([2], true);
    const snap = acc.snapshot();
    expect(sorted(snap.indexes)).toEqual([1, 2]);
    acc.record([3], true);
    expect(sorted(snap.indexes)).toEqual([1, 2]);
    expect(sorted(acc.snapshot().indexes)).toEqual([1, 2, 3]);
  });

  it("beginTransferIfNeeded avoids snapshot preflight and Set-copy before deciding", () => {
    expect(accumulatorSource).toMatch(/beginTransferIfNeeded\(\):/);
    const method = accumulatorSource.match(
      /beginTransferIfNeeded\(\)[\s\S]*?^ {2}[a-zA-Z]/m,
    )?.[0];
    expect(method).toBeDefined();
    expect(method!).not.toMatch(/\.snapshot\(/);
    expect(method!).not.toMatch(/new Set\(/);
  });

  it("does not perform row-ID lookup or rows scan", () => {
    expect(accumulatorSource).not.toMatch(/rowIdToSourceIndex/);
    expect(accumulatorSource).not.toMatch(/sourceRows/);
    expect(accumulatorSource).not.toMatch(/for\s*\(.*of\s+.*rows/);
    expect(accumulatorSource).not.toMatch(/RowStoreDirtyMetadata/);
    expect(accumulatorSource).not.toMatch(/patchId/);
    expect(accumulatorSource).not.toMatch(/generation/);
  });
});
