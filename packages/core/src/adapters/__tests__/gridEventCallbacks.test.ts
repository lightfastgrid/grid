// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { EventBus } from "../../events/EventBus";
import type { GridEventMap } from "../../events/GridEventMap";
import type { GridEventCallbacks, Unsubscribe } from "../../types";
import {
  captureGridEventCallbacks,
  type GridEventSource,
  subscribeGridEventCallbacks,
} from "../gridEventCallbacks";

class RecordingSource implements GridEventSource {
  readonly events: Array<keyof GridEventMap> = [];
  readonly unsubscribes: Array<ReturnType<typeof vi.fn<[], void>>> = [];

  on<K extends keyof GridEventMap>(
    event: K,
    _handler: (payload: GridEventMap[K]) => void,
  ): Unsubscribe {
    this.events.push(event);
    const unsubscribe = vi.fn<[], void>();
    this.unsubscribes.push(unsubscribe);
    return unsubscribe;
  }
}

class FailingSource extends RecordingSource {
  private callCount = 0;

  constructor(private readonly failure: Error) {
    super();
  }

  override on<K extends keyof GridEventMap>(
    event: K,
    handler: (payload: GridEventMap[K]) => void,
  ): Unsubscribe {
    this.callCount += 1;
    if (this.callCount === 4) throw this.failure;
    return super.on(event, handler);
  }
}

class ThrowingUnsubscribeSource extends RecordingSource {
  override on<K extends keyof GridEventMap>(
    event: K,
    handler: (payload: GridEventMap[K]) => void,
  ): Unsubscribe {
    const unsubscribe = super.on(event, handler);
    if (this.events.length !== 2) return unsubscribe;
    const failure = new Error("unsubscribe failed");
    const throwingUnsubscribe = vi.fn<[], void>(() => {
      unsubscribe();
      throw failure;
    });
    this.unsubscribes[this.unsubscribes.length - 1] = throwingUnsubscribe;
    return throwingUnsubscribe;
  }
}

const EXPECTED_EVENTS: ReadonlyArray<keyof GridEventMap> = [
  "grid:mounted",
  "column:resized",
  "selection:changed",
  "column-selection:changed",
  "column-order:changed",
  "row-order:changed",
  "sort:changed",
  "filter:changed",
  "column-pin:changed",
  "row-pin:changed",
  "column-visibility:changed",
  "pagination:changed",
  "focused-cell:changed",
  "cell-shell:action",
  "cell-value:changed",
  "row-data:updated",
  "quick-filter:changed",
  "quick-search-pending:changed",
  "async-transactions:flushed",
  "csv-export:progress",
  "csv-export:completed",
  "csv-export:cancelled",
  "csv-export:error",
];

describe("subscribeGridEventCallbacks", () => {
  it("captures callbacks without retaining wider Grid options", () => {
    const onGridReady = vi.fn();
    const rows = [{ id: "row-1" }];
    const source = {
      columns: [{ field: "id" }],
      rows,
      onGridReady,
    };

    const captured = captureGridEventCallbacks(source);
    source.onGridReady = vi.fn();

    expect(captured.onGridReady).toBe(onGridReady);
    expect("rows" in captured).toBe(false);
    expect("columns" in captured).toBe(false);
  });

  it("subscribes the complete callback event set once", () => {
    const source = new RecordingSource();

    subscribeGridEventCallbacks(source, () => ({}));

    expect(source.events).toEqual(EXPECTED_EVENTS);
    expect(new Set(source.events).size).toBe(source.events.length);
  });

  it("reads the current callback at delivery time and supports clearing", () => {
    const bus = new EventBus<GridEventMap>();
    const first = vi.fn();
    const second = vi.fn();
    let callbacks: GridEventCallbacks = { onSortChanged: first };
    subscribeGridEventCallbacks(bus, () => callbacks);
    const payload: GridEventMap["sort:changed"] = {
      sortModel: [{ field: "name", sort: "asc" }],
      source: "api",
    };

    bus.emit("sort:changed", payload);
    callbacks = { onSortChanged: second };
    bus.emit("sort:changed", payload);
    callbacks = {};
    bus.emit("sort:changed", payload);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(payload);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(payload);
  });

  it("preserves the no-argument onGridReady callback", () => {
    const bus = new EventBus<GridEventMap>();
    const onGridReady = vi.fn();
    subscribeGridEventCallbacks(bus, () => ({ onGridReady }));

    bus.emit("grid:mounted", { container: document.createElement("div") });

    expect(onGridReady).toHaveBeenCalledTimes(1);
    expect(onGridReady.mock.calls[0]).toEqual([]);
  });

  it("returns an idempotent aggregate unsubscribe in reverse order", () => {
    const source = new RecordingSource();
    const unsubscribe = subscribeGridEventCallbacks(source, () => ({}));

    unsubscribe();
    unsubscribe();

    for (const listenerUnsubscribe of source.unsubscribes) {
      expect(listenerUnsubscribe).toHaveBeenCalledTimes(1);
    }
    const lastUnsubscribe =
      source.unsubscribes[source.unsubscribes.length - 1]!;
    expect(lastUnsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      source.unsubscribes[0]!.mock.invocationCallOrder[0]!,
    );
  });

  it("rolls back earlier subscriptions when installation fails", () => {
    const failure = new Error("subscribe failed");
    const source = new FailingSource(failure);

    expect(() => subscribeGridEventCallbacks(source, () => ({}))).toThrow(
      failure,
    );
    expect(source.unsubscribes).toHaveLength(3);
    for (const unsubscribe of source.unsubscribes) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("attempts every cleanup when one unsubscribe throws", () => {
    const source = new ThrowingUnsubscribeSource();
    const unsubscribe = subscribeGridEventCallbacks(source, () => ({}));

    expect(() => unsubscribe()).toThrow("unsubscribe failed");
    for (const listenerUnsubscribe of source.unsubscribes) {
      expect(listenerUnsubscribe).toHaveBeenCalledTimes(1);
    }
    expect(() => unsubscribe()).not.toThrow();
  });
});
