import type { Unsubscribe } from '../types';

export type EventHandler<T> = (payload: T) => void;

/**
 * Strongly typed pub/sub.
 *
 * Parametrized by an event map (name → payload). Handlers registered via
 * `on` receive typed payloads; `emit` requires a matching payload type.
 * A thrown handler is logged and isolated so siblings still run.
 */
export class EventBus<Events extends { [K in keyof Events]: unknown }> {
  // Internally erased; generic type is recovered at the on/emit call sites.
  private listeners = new Map<keyof Events, Set<EventHandler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const erased = handler as EventHandler<unknown>;
    set.add(erased);
    return () => {
      this.listeners.get(event)?.delete(erased);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K] | undefined): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot so handlers that unsubscribe during dispatch do not mutate iteration.
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<Events[K]>)(payload ?? {} as Events[K]);
      } catch (err) {
        console.error(`[EventBus] handler for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
