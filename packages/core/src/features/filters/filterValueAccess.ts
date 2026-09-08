import type { RowData } from "../../types";
import { resolveFieldValue } from "../../utils/resolveDotPath";

export type GetCellValue = (row: RowData, sourceIndex: number, field: string) => unknown;

export const defaultGetCellValue: GetCellValue = (row, _sourceIndex, field) => resolveFieldValue(row, field);

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function padTwo(n: number): string {
  return n < 10 ? "0" + String(n) : String(n);
}

function dateToYMD(d: Date): string {
  return String(d.getUTCFullYear()) + "-" + padTwo(d.getUTCMonth() + 1) + "-" + padTwo(d.getUTCDate());
}

export function isStrictDateString(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  return dateToYMD(d) === v;
}

export function toDateString(v: unknown): string | null {
  if (typeof v === "string") {
    return isStrictDateString(v) ? v : null;
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return dateToYMD(v);
  }
  return null;
}

const MS_PER_DAY = 86_400_000;

export function dateStringToEpochDay(s: string): number {
  return Math.floor(new Date(s + "T00:00:00Z").getTime() / MS_PER_DAY);
}

export function toEpochDay(v: unknown): number | null {
  if (typeof v === "string") {
    if (!isStrictDateString(v)) return null;
    return dateStringToEpochDay(v);
  }
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const ymd = dateToYMD(v);
    return dateStringToEpochDay(ymd);
  }
  return null;
}

export function toBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}
