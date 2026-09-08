import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type {
  CsvExportWorkerTransport,
} from "../csvExportWorkerClient";
import { CsvExportWorkerClientOwner } from "../csvExportWorkerClientOwner";

class OwnerTransport implements CsvExportWorkerTransport {
  unsubscribeCount = 0;
  unsubscribeErrorCount = 0;
  terminateCount = 0;

  constructor(private readonly failSubscribe = false) {}

  post(): void {}

  subscribe(): () => void {
    if (this.failSubscribe) throw new Error("subscribe failed");
    return () => {
      this.unsubscribeCount++;
    };
  }

  subscribeError(): () => void {
    return () => {
      this.unsubscribeErrorCount++;
    };
  }

  terminate(): void {
    this.terminateCount++;
  }
}

describe("csvExportWorkerClientOwner - lazy reusable ownership", () => {
  it("constructs lazily and getWorkerClientIfCreated never calls the factory", () => {
    const createTransport = vi.fn(() => new OwnerTransport());
    const owner = new CsvExportWorkerClientOwner(createTransport);

    expect(createTransport).not.toHaveBeenCalled();
    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("creates once and reuses the same client", () => {
    const transport = new OwnerTransport();
    const createTransport = vi.fn(() => transport);
    const owner = new CsvExportWorkerClientOwner(createTransport);

    const first = owner.getOrCreateWorkerClient();
    const second = owner.getOrCreateWorkerClient();

    expect(first).toBe(second);
    expect(owner.getWorkerClientIfCreated()).toBe(first);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(transport.terminateCount).toBe(0);
  });

  it("does not cache failed construction and permits retry", () => {
    const failed = new OwnerTransport(true);
    const recovered = new OwnerTransport();
    const createTransport = vi
      .fn<[], CsvExportWorkerTransport>()
      .mockReturnValueOnce(failed)
      .mockReturnValueOnce(recovered);
    const owner = new CsvExportWorkerClientOwner(createTransport);

    expect(() => owner.getOrCreateWorkerClient()).toThrow("subscribe failed");
    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(failed.terminateCount).toBe(1);

    const client = owner.getOrCreateWorkerClient();
    expect(client).toBe(owner.getWorkerClientIfCreated());
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it("invalidates once and permits one fresh client", () => {
    const transports = [new OwnerTransport(), new OwnerTransport()];
    let index = 0;
    const owner = new CsvExportWorkerClientOwner(() => transports[index++]!);
    const first = owner.getOrCreateWorkerClient();

    owner.invalidateWorkerClient();
    owner.invalidateWorkerClient();
    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(transports[0]!.unsubscribeCount).toBe(1);
    expect(transports[0]!.unsubscribeErrorCount).toBe(1);
    expect(transports[0]!.terminateCount).toBe(1);

    const second = owner.getOrCreateWorkerClient();
    expect(second).not.toBe(first);
    expect(transports[1]!.terminateCount).toBe(0);
  });

  it("destroy before creation remains lazy and terminal", () => {
    const createTransport = vi.fn(() => new OwnerTransport());
    const owner = new CsvExportWorkerClientOwner(createTransport);

    owner.destroy();
    owner.destroy();

    expect(createTransport).not.toHaveBeenCalled();
    expect(owner.getWorkerClientIfCreated()).toBeNull();
    expect(() => owner.getOrCreateWorkerClient()).toThrow(
      "CSV Worker client owner destroyed",
    );
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("destroy after creation terminates exactly once and forbids recreation", () => {
    const transport = new OwnerTransport();
    const createTransport = vi.fn(() => transport);
    const owner = new CsvExportWorkerClientOwner(createTransport);
    owner.getOrCreateWorkerClient();

    owner.destroy();
    owner.destroy();
    owner.invalidateWorkerClient();

    expect(transport.unsubscribeCount).toBe(1);
    expect(transport.unsubscribeErrorCount).toBe(1);
    expect(transport.terminateCount).toBe(1);
    expect(() => owner.getOrCreateWorkerClient()).toThrow(
      "CSV Worker client owner destroyed",
    );
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it("contains no eager or out-of-factory Worker construction", () => {
    const ownerSource = readFileSync(
      new URL("../csvExportWorkerClientOwner.ts", import.meta.url),
      "utf8",
    );
    const transportSource = readFileSync(
      new URL("../csvExportWorkerTransport.ts", import.meta.url),
      "utf8",
    );

    expect(ownerSource).not.toContain("new Worker(");
    expect(transportSource.match(/new Worker\(/gu)).toHaveLength(1);
    expect(transportSource).toContain(
      'new URL("./csvExportWorker.ts", import.meta.url)',
    );
    expect(transportSource).toContain('{ type: "module" }');
    expect(transportSource.indexOf("new Worker(")).toBeGreaterThan(
      transportSource.indexOf("function createBrowserWorker"),
    );
  });
});
