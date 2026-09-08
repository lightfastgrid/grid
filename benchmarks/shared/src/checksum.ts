import { createHash } from "node:crypto";

import type { BenchmarkRow, NeutralColumn } from "./benchmarkProtocol.ts";

export function checksumColumnSchema(columns: readonly NeutralColumn[]): string {
  const hash = createHash("sha256");
  hash.update(String(columns.length));
  hash.update("|");
  for (const column of columns) {
    hash.update(column.field);
    hash.update(":");
    hash.update(column.kind);
    hash.update(":");
    hash.update(String(column.width));
    hash.update(":");
    hash.update(column.headerName);
    hash.update(";");
  }
  return hash.digest("hex");
}

export function checksumDataset(
  rows: readonly BenchmarkRow[],
  columns: readonly NeutralColumn[],
): string {
  const hash = createHash("sha256");
  hash.update(String(rows.length));
  hash.update("|");
  hash.update(String(columns.length));
  hash.update("|");
  for (const column of columns) {
    hash.update(column.field);
    hash.update(":");
    hash.update(column.kind);
    hash.update(";");
  }
  for (const row of rows) {
    for (const column of columns) {
      hash.update(String(row[column.field] ?? ""));
      hash.update("\t");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}
