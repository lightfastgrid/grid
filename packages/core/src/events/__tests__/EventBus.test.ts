import { describe, expect, it, vi } from 'vitest';

import { EventBus } from '../EventBus';

interface M {
  'a': { n: number };
  'b': Record<string, never>;
}

describe('EventBus', () => {
  it('invokes handlers with typed payload', () => {
    const bus = new EventBus<M>();
    const spy = vi.fn();
    bus.on('a', spy);
    bus.emit('a', { n: 1 });
    expect(spy).toHaveBeenCalledWith({ n: 1 });
  });

  it('on returns an unsubscribe', () => {
    const bus = new EventBus<M>();
    const spy = vi.fn();
    const off = bus.on('a', spy);
    off();
    bus.emit('a', { n: 2 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('clear removes all listeners across events', () => {
    const bus = new EventBus<M>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('a', a);
    bus.on('b', b);
    bus.clear();
    bus.emit('a', { n: 3 });
    bus.emit('b', {});
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('isolates a thrown handler from siblings and logs the error', () => {
    const bus = new EventBus<M>();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sibling = vi.fn();
    bus.on('a', () => {
      throw new Error('boom');
    });
    bus.on('a', sibling);
    bus.emit('a', { n: 1 });
    expect(sibling).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('unsubscribing during emit does not skip remaining handlers', () => {
    const bus = new EventBus<M>();
    const second = vi.fn();
    let off: (() => void) | null = null;
    off = bus.on('a', () => {
      off?.();
    });
    bus.on('a', second);
    bus.emit('a', { n: 1 });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('defers subscribers added during dispatch until the next emit', () => {
    const bus = new EventBus<M>();
    const added = vi.fn();
    bus.on('a', () => {
      bus.on('a', added);
    });

    bus.emit('a', { n: 1 });
    expect(added).not.toHaveBeenCalled();

    bus.emit('a', { n: 2 });
    expect(added).toHaveBeenCalledTimes(1);
    expect(added).toHaveBeenCalledWith({ n: 2 });
  });

  it('keeps outer payloads intact across reentrant dispatch', () => {
    const bus = new EventBus<M>();
    const seen: number[] = [];
    bus.on('a', (payload) => {
      seen.push(payload.n);
      if (payload.n === 1) bus.emit('a', { n: 2 });
      seen.push(payload.n);
    });

    bus.emit('a', { n: 1 });

    expect(seen).toEqual([1, 2, 2, 1]);
  });
});
