import type { ReactActionCustomCellRenderer } from "@lightfastgrid/react";

import { CustomRowDropdown } from "./CustomRowDropdown.tsx";
import { getGridDemoRowActionHost } from "./rowActionHost.ts";
import { toGridDemoRowRecord } from "./rowActionTransactions.ts";

/**
 * Custom-mode row action renderer (`mode: "custom"`).
 */
export function createCustomRowDropdownRenderer(): ReactActionCustomCellRenderer {
  return {
    kind: "actions",
    mode: "custom",
    render: ({ row, rowIndex, rowId, close }) => (
      <CustomRowDropdown
        row={row}
        rowIndex={rowIndex}
        rowId={rowId}
        close={close}
        onView={() => {
          const host = getGridDemoRowActionHost();
          host?.openDialog({
            mode: "view",
            record: toGridDemoRowRecord(row, rowId),
            row,
          });
          close();
        }}
      />
    ),
  };
}
