/**
 * Generic execution-operation parity tests.
 *
 * For every registered operation with a worker path and parity
 * fixtures, asserts that the main-thread output and the worker-payload
 * output normalize to the same result. Iterates the operation registry
 * so newly registered operations are covered automatically.
 */

import { describe, expect, it } from "vitest";

import { executionOperations } from "../registry";
import type {
  RowIndexExecutionResult,
  WorkerEligibility,
} from "../types";

// ── Type-erased operation surface ────────────────────────────────────
//
// Iterating a heterogeneous `[sortOp, filterOp, …] as const` registry
// produces a union type. TypeScript cannot prove that a fixture's
// `.input` (covariant) matches the same element's `.execute(input)`
// (contravariant) — the classic "correlated-union" problem.
//
// This interface erases the per-operation Input/MainOutput/Payload/
// Eligibility type parameters to `unknown`, keeping only the parts
// the parity test observes: fixture names, the execute→normalize
// pipeline, and the `RowIndexExecutionResult` output.
//
// Each concrete operation is cast to this interface once at the loop
// boundary. The cast is safe because every fixture's input was
// produced by the same operation whose methods consume it.

interface ParityTestableOperation {
  name: string;
  mainThread: { execute(input: unknown): unknown };
  worker?: {
    resolveEligibility(input: unknown): WorkerEligibility;
    buildPayload(input: unknown, eligibility: WorkerEligibility): unknown;
    executePayload(payload: unknown): unknown;
  };
  normalizeMainOutput(
    output: unknown,
    input: unknown,
  ): RowIndexExecutionResult;
  normalizeWorkerOutput(
    output: unknown,
    input: unknown,
  ): RowIndexExecutionResult;
  parityFixtures?: readonly { name: string; input: unknown }[];
}

// ── Helpers ───────────────────────────────────────────────────────────

function assertOperationParity(
  operation: ParityTestableOperation,
  normalizeForExpect: (result: RowIndexExecutionResult) => unknown,
): void {
  const worker = operation.worker;
  const fixtures = operation.parityFixtures;

  if (!worker || !fixtures) {
    it(`${operation.name} has no worker parity coverage yet`, () => {
      expect(worker).toBeUndefined();
    });
    return;
  }

  it(`${operation.name} declares a worker path and parity fixtures`, () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe(operation.name, () => {
    for (const fixture of fixtures) {
      it(fixture.name, () => {
        const mainOutput = operation.mainThread.execute(fixture.input);

        const eligibility = worker.resolveEligibility(fixture.input);
        expect(eligibility.eligible).toBe(true);

        const payload = worker.buildPayload(fixture.input, eligibility);
        expect(payload).not.toBeNull();

        const workerOutput = worker.executePayload(payload!);

        const normalizedMain = operation.normalizeMainOutput(
          mainOutput,
          fixture.input,
        );
        const normalizedWorker = operation.normalizeWorkerOutput(
          workerOutput,
          fixture.input,
        );

        expect(normalizeForExpect(normalizedWorker)).toEqual(
          normalizeForExpect(normalizedMain),
        );
      });
    }
  });
}

/** Convert a row-index result into a plain deep-equal-friendly value. */
function normalizeRowIndexResultForExpect(
  result: RowIndexExecutionResult,
): unknown {
  return result.kind === "identity"
    ? { kind: "identity", rowCount: result.rowCount }
    : { kind: "indexes", indexes: Array.from(result.indexes) };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("execution operation parity", () => {
  for (const operation of executionOperations) {
    // Safe: each operation's fixtures carry inputs that match its own
    // methods. The cast erases the per-operation type parameters so
    // the generic loop compiles; see ParityTestableOperation above.
    const op = operation as unknown as ParityTestableOperation;
    assertOperationParity(op, normalizeRowIndexResultForExpect);
  }
});
