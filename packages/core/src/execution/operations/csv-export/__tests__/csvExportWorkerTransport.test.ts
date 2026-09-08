import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CsvWorkerRequest } from "../csvExportProtocol";
import {
  createCsvExportWorkerTransport,
  type CsvExportBrowserWorker,
  type CsvExportBrowserWorkerFactory,
} from "../csvExportWorkerTransport";

interface PostedMessage {
  message: CsvWorkerRequest;
  transfer: Transferable[] | undefined;
}

class FakeBrowserWorker extends EventTarget implements CsvExportBrowserWorker {
  readonly posted: PostedMessage[] = [];
  terminateCount = 0;

  postMessage(message: CsvWorkerRequest, transfer?: Transferable[]): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminateCount++;
  }
}

class NodeErrorEvent extends Event {
  readonly error: unknown;
  readonly message: string;

  constructor(
    type: string,
    init: { error?: unknown; message?: string } = {},
  ) {
    super(type);
    this.error = init.error;
    this.message = init.message ?? "";
  }
}

const originalErrorEvent = globalThis.ErrorEvent;

beforeAll(() => {
  Object.defineProperty(globalThis, "ErrorEvent", {
    configurable: true,
    writable: true,
    value: NodeErrorEvent,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "ErrorEvent", {
    configurable: true,
    writable: true,
    value: originalErrorEvent,
  });
});

function cancelRequest(taskId: number): CsvWorkerRequest {
  return { kind: "csv:cancel", taskId };
}

describe("csvExportWorkerTransport - browser module Worker ownership", () => {
  it("constructs only through the injected Worker factory", () => {
    const worker = new FakeBrowserWorker();
    let callCount = 0;
    const factory: CsvExportBrowserWorkerFactory = () => {
      callCount++;
      return worker;
    };

    createCsvExportWorkerTransport(factory);

    expect(callCount).toBe(1);
  });

  it("forwards messages and the exact transfer-list identity", () => {
    const worker = new FakeBrowserWorker();
    const transport = createCsvExportWorkerTransport(() => worker);
    const message = cancelRequest(7);
    const transfer = [new ArrayBuffer(4)];

    transport.post(message, transfer);
    transport.post(cancelRequest(8));

    expect(worker.posted[0]?.message).toBe(message);
    expect(worker.posted[0]?.transfer).toBe(transfer);
    expect(worker.posted[1]?.transfer).toBeUndefined();
  });

  it("forwards the underlying ErrorEvent error by identity", () => {
    const worker = new FakeBrowserWorker();
    const transport = createCsvExportWorkerTransport(() => worker);
    const errors: unknown[] = [];
    const underlying = new Error("worker exploded");
    transport.subscribeError!((error) => errors.push(error));

    worker.dispatchEvent(
      new ErrorEvent("error", {
        error: underlying,
        message: "outer message",
      }),
    );

    expect(errors).toEqual([underlying]);
    expect(errors[0]).toBe(underlying);
  });

  it("creates an Error from an ErrorEvent message when error is absent", () => {
    const worker = new FakeBrowserWorker();
    const transport = createCsvExportWorkerTransport(() => worker);
    const errors: unknown[] = [];
    transport.subscribeError!((error) => errors.push(error));

    worker.dispatchEvent(
      new ErrorEvent("error", { message: "worker message only" }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]).toMatchObject({ message: "worker message only" });
  });

  it("forwards a plain Event as the conservative fallback", () => {
    const worker = new FakeBrowserWorker();
    const transport = createCsvExportWorkerTransport(() => worker);
    const errors: unknown[] = [];
    const event = new Event("error");
    transport.subscribeError!((error) => errors.push(error));

    worker.dispatchEvent(event);

    expect(errors).toEqual([event]);
    expect(errors[0]).toBe(event);
  });

  it("supports independent unsubscribe and makes late events inert", () => {
    const worker = new FakeBrowserWorker();
    const transport = createCsvExportWorkerTransport(() => worker);
    const messages: unknown[] = [];
    const errors: unknown[] = [];
    const unsubscribeMessage = transport.subscribe((message) =>
      messages.push(message),
    );
    const unsubscribeError = transport.subscribeError!((error) =>
      errors.push(error),
    );
    const firstMessage = { kind: "csv:ready", taskId: 1 };
    const firstError = new Event("error");

    worker.dispatchEvent(new MessageEvent("message", { data: firstMessage }));
    worker.dispatchEvent(firstError);
    expect(messages).toEqual([firstMessage]);
    expect(errors).toEqual([firstError]);

    unsubscribeMessage();
    unsubscribeMessage();
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: { kind: "csv:ready", taskId: 2 },
      }),
    );
    worker.dispatchEvent(new Event("error"));
    expect(messages).toEqual([firstMessage]);
    expect(errors).toHaveLength(2);

    transport.terminate!();
    transport.terminate!();
    unsubscribeError();
    worker.dispatchEvent(
      new MessageEvent("message", {
        data: { kind: "csv:ready", taskId: 3 },
      }),
    );
    worker.dispatchEvent(new Event("error"));

    expect(messages).toEqual([firstMessage]);
    expect(errors).toHaveLength(2);
    expect(worker.terminateCount).toBe(1);
    expect(() => transport.post(cancelRequest(9))).toThrow(
      "CSV Worker transport terminated",
    );
  });

  it("does not subscribe handlers after termination", () => {
    const worker = new FakeBrowserWorker();
    const transport = createCsvExportWorkerTransport(() => worker);
    const messageHandler = vi.fn();
    const errorHandler = vi.fn();
    transport.terminate!();

    const unsubscribeMessage = transport.subscribe(messageHandler);
    const unsubscribeError = transport.subscribeError!(errorHandler);
    worker.dispatchEvent(new MessageEvent("message", { data: "late" }));
    worker.dispatchEvent(new Event("error"));
    unsubscribeMessage();
    unsubscribeError();

    expect(messageHandler).not.toHaveBeenCalled();
    expect(errorHandler).not.toHaveBeenCalled();
  });
});
