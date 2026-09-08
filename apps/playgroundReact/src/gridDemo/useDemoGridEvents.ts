import type { ReactLightFastGridProps } from "@lightfastgrid/react";
import { useMemo, useState } from "react";

type DemoGridEventProps = Pick<
  ReactLightFastGridProps,
  "onFilterChanged" | "onSortChanged"
>;

export function useDemoGridEvents(): {
  gridEvents: DemoGridEventProps;
  activeFilterCount: number;
  activeSortCount: number;
} {
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  const [activeSortCount, setActiveSortCount] = useState(0);
  const gridEvents = useMemo<DemoGridEventProps>(
    () => ({
      onFilterChanged: (event) => {
        setActiveFilterCount(event.activeFilterCount);
      },
      onSortChanged: (event) => {
        setActiveSortCount(event.sortModel.length);
      },
    }),
    [],
  );
  return { gridEvents, activeFilterCount, activeSortCount };
}
