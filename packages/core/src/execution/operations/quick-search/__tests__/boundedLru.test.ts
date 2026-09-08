import { describe, expect, it } from 'vitest';

import { BoundedLruMap } from '../boundedLru';

describe('BoundedLruMap', () => {
  it('stores and retrieves values', () => {
    const lru = new BoundedLruMap<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    expect(lru.get('b')).toBe(2);
    expect(lru.get('missing')).toBeUndefined();
    expect(lru.size).toBe(2);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('missing')).toBe(false);
  });

  it('evicts the least-recently-used entry at capacity', () => {
    const lru = new BoundedLruMap<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.has('a')).toBe(false);
    expect(lru.has('b')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.size).toBe(2);
  });

  it('get refreshes recency so the read entry survives eviction', () => {
    const lru = new BoundedLruMap<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('c')).toBe(true);
  });

  it('set on an existing key updates value and recency without eviction', () => {
    const lru = new BoundedLruMap<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('a', 10);
    expect(lru.size).toBe(2);
    expect(lru.get('a')).toBe(10);
    // 'a' is most recent, so adding 'c' evicts 'b'.
    lru.set('c', 3);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
  });

  it('delete and clear work', () => {
    const lru = new BoundedLruMap<string, number>(2);
    lru.set('a', 1);
    expect(lru.delete('a')).toBe(true);
    expect(lru.delete('a')).toBe(false);
    lru.set('b', 2);
    lru.clear();
    expect(lru.size).toBe(0);
  });

  it('rejects non-positive capacity', () => {
    expect(() => new BoundedLruMap<string, number>(0)).toThrow();
    expect(() => new BoundedLruMap<string, number>(-1)).toThrow();
    expect(() => new BoundedLruMap<string, number>(1.5)).toThrow();
  });
});
