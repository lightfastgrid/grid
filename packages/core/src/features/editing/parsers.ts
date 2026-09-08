import type { CellParseResult, NormalizedCellEditorConfig, SelectOption } from "./editingTypes";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, day] = value.split("-").map(Number) as [number, number, number];
  const d = new Date(y, m - 1, day);
  return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day;
}

export function parseText(raw: string): CellParseResult<string> {
  return { ok: true, value: raw };
}

export function parseNumber(raw: string): CellParseResult<number | null> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, reason: "Invalid number" };
  return { ok: true, value: n };
}

export function parseDate(raw: string): CellParseResult<string | null> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!isValidDateString(trimmed)) {
    return { ok: false, reason: DATE_RE.test(trimmed) ? "Invalid calendar date" : "Invalid date format (expected YYYY-MM-DD)" };
  }
  return { ok: true, value: trimmed };
}

export function parseCheckbox(checked: boolean): CellParseResult<boolean> {
  return { ok: true, value: checked };
}

export function parseSelect(
  selected: string,
  options: readonly SelectOption[],
): CellParseResult<unknown> {
  const match = options.find((o) => String(o.value) === selected);
  if (!match) return { ok: false, reason: `Unknown option: ${selected}` };
  return { ok: true, value: match.value };
}

export function parseEditorValue(
  raw: string,
  config: NormalizedCellEditorConfig,
): CellParseResult {
  switch (config.kind) {
    case "text":
      return parseText(raw);
    case "number":
      return parseNumber(raw);
    case "date":
      return parseDate(raw);
    case "checkbox":
      return parseCheckbox(raw === "true");
    case "select":
      return parseSelect(raw, config.options);
  }
}
