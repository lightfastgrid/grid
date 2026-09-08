import type { CellShellConfig, CellShellKind } from "./cellShellTypes";

export function normalizeCellShell(
  cellShell: CellShellKind | CellShellConfig | undefined,
): CellShellConfig | undefined {
  if (cellShell === undefined) return undefined;
  if (typeof cellShell === "string") return { kind: cellShell };
  return cellShell;
}
