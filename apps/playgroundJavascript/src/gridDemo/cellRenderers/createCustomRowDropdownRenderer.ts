import type { ActionCustomCellRenderer } from "@lightfastgrid/core";

import { mountCustomRowDropdown } from "./CustomRowDropdown.ts";
import { getGridDemoRowActionHost } from "./rowActionHost.ts";
import { toGridDemoRowRecord } from "./rowActionTransactions.ts";

/**
 * Custom-mode row action renderer (`mode: "custom"`).
 */
export function createCustomRowDropdownRenderer(): ActionCustomCellRenderer {
  return {
    kind: "actions",
    mode: "custom",
    render({ host, row, rowIndex, rowId, close }) {
      return mountCustomRowDropdown({
        host,
        row,
        rowIndex,
        rowId,
        close,
        onView: () => {
          const actionHost = getGridDemoRowActionHost();
          actionHost?.openDialog({
            mode: "view",
            record: toGridDemoRowRecord(row, rowId),
            row,
          });
          close();
        },
      });
    },
  };
}
