import { useRef } from 'react';

/** Keeps the latest callback/value without widening hook dependency arrays. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
