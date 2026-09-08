/** Pure copy helpers for Export panel disable/subtitle states. */

export function selectedRowsExportHint(rowCount: number): string {
  if (rowCount <= 0) return "No rows selected";
  return rowCount === 1 ? "1 row selected" : `${rowCount} rows selected`;
}

export function selectedColumnsExportHint(columnCount: number): string {
  if (columnCount <= 0) return "No columns selected";
  return columnCount === 1
    ? "1 column selected"
    : `${columnCount} columns selected`;
}
