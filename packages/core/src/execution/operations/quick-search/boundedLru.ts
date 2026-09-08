/**
 * Small bounded LRU map for quick-search caches (source-scoped result
 * LRU and full-match LRU). Local to the quick-search operation — not a
 * shared utility.
 *
 * Uses Map insertion order for recency: get()/set() move the entry to
 * the back; eviction removes the front (least recently used).
 */

export class BoundedLruMap<K, V> {
  private readonly map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error(`BoundedLruMap maxSize must be a positive integer, got ${maxSize}`);
    }
    this.maxSize = maxSize;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Returns the value and refreshes its recency. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Inserts or updates; either way the entry becomes most recent. */
  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
