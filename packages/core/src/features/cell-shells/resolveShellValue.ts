import type { RowData } from "../../types";

import type {
  CellShellBaseValueSource,
  CellShellValueSource,
} from "./cellShellTypes";

export interface ShellValueContext {
  value: unknown;
  formattedValue: string;
  row: RowData;
}

/**
 * A plain object: prototype is exactly `Object.prototype` or `null`. Rejects
 * arrays, `Date`/`Map`/`Set` and other class instances, functions, primitives,
 * and `null`.
 *
 * Runtime guard: the declared types say these values are always plain records,
 * but shell config can arrive from JSON or a server payload. Failing closed
 * here is required by the architecture (malformed config degrades to
 * fallback/empty, silently). Allocation-free.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Whether a value-source is a mapped source: a plain object carrying an own
 * `map` property. Pure and allocation-free — the dispatch predicate on the
 * pooled shell-value hot path (architecture §36 guard).
 */
function isMappedSource(source: unknown): boolean {
  return (
    isPlainObject(source) &&
    Object.prototype.hasOwnProperty.call(source, "map")
  );
}

/**
 * Own-property, string-valued lookup on a validated plain map. Never matches
 * inherited members such as `toString`, so no value can leak in from a
 * prototype chain.
 */
function lookupMapEntry(
  map: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!isPlainObject(map)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  const entry = map[key];
  return typeof entry === "string" ? entry : undefined;
}

/** Read a base source without stringifying, so callers can test for nullish. */
function readBaseValue(
  source: unknown,
  ctx: ShellValueContext,
): unknown {
  if (source === "value") return ctx.value;
  if (source === "formattedValue") return ctx.formattedValue;
  // Runtime JSON/Reflect may supply values outside the declared union.
  if (isPlainObject(source)) {
    if (Object.prototype.hasOwnProperty.call(source, "literal")) {
      return (source as { literal: string }).literal;
    }
    if (Object.prototype.hasOwnProperty.call(source, "field")) {
      return ctx.row[(source as { field: string }).field];
    }
  }
  return ctx.formattedValue;
}

/**
 * Resolve a mapped source. `from` defaults to `"value"`.
 *
 * A `null`/`undefined` base bypasses the map entirely — there is deliberately
 * no `"null"`/`"undefined"` key lookup. A missing or non-string entry, and a
 * malformed `map`, all fail safe to `fallback` (or `""`) without warning.
 */
function resolveMappedSource(
  source: Record<string, unknown>,
  ctx: ShellValueContext,
): string {
  const from = Reflect.get(source, "from");
  const fallbackValue = Reflect.get(source, "fallback");
  const fallback = typeof fallbackValue === "string" ? fallbackValue : "";
  const base = readBaseValue(from ?? "value", ctx);
  if (base === null || base === undefined) {
    return fallback;
  }
  const map = Reflect.get(source, "map");
  const entry = isPlainObject(map)
    ? lookupMapEntry(map, String(base))
    : undefined;
  return entry ?? fallback;
}

export function resolveShellValue(
  source: CellShellValueSource | undefined,
  ctx: ShellValueContext,
): string {
  if (source === undefined || source === "formattedValue") {
    return ctx.formattedValue;
  }
  if (source === "value") {
    const v = ctx.value;
    return v === null || v === undefined ? "" : String(v);
  }
  // `typeof null === "object"` — require non-null before any member probe.
  // A whole source supplied as null (e.g. via JSON) must fail closed to the
  // formatted-value fallback without throw or warning.
  //
  // "Never throws" here is scoped to JSON-safe malformed value-source inputs.
  // Hostile Proxy traps and throwing getters are outside the trusted
  // configuration contract and are not recovered from.
  //
  // Runtime null is outside the declared union but reachable via Reflect.set /
  // JSON config; the null check is required despite the type checker.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof source === "object" && source !== null) {
    const plain = isPlainObject(source);
    if (isMappedSource(source)) {
      return resolveMappedSource(source as Record<string, unknown>, ctx);
    }
    // Base `{ literal }` / `{ field }` shapes require a plain object with an
    // own property — same boundary as mapped wrappers. Arrays and other
    // non-plain objects fail closed to formattedValue even if they carry an
    // own `literal`/`field` slot (architecture Test 27 whole-source rule).
    if (plain) {
      if (Object.prototype.hasOwnProperty.call(source, "literal")) {
        return (source as { literal: string }).literal;
      }
      if (Object.prototype.hasOwnProperty.call(source, "field")) {
        const field = (source as { field: string }).field;
        const v = ctx.row[field];
        return v === null || v === undefined ? "" : String(v);
      }
    }
  }
  return ctx.formattedValue;
}

/**
 * Resolve a tone slug.
 *
 * Tone keeps its own inline shape and its own effective default base of
 * `formattedValue` — deliberately different from a generic mapped source,
 * whose base defaults to `value`. `from` is typed as a base source so a mapped
 * source can never nest here. Behavior is otherwise unchanged from V1.
 */
export function resolveShellTone(
  config: {
    from?: CellShellBaseValueSource;
    map?: Record<string, string>;
    fallback?: string;
  },
  ctx: ShellValueContext,
): string {
  const raw = config.from !== undefined
    ? resolveShellValue(config.from, ctx)
    : ctx.formattedValue;

  if (config.map !== undefined) {
    const mapped = config.map[raw];
    if (mapped !== undefined) return mapped;
  }

  if (config.fallback !== undefined) return config.fallback;

  return raw.toLowerCase().replace(/[\s_]+/g, "-");
}
