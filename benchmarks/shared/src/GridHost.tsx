import type { CSSProperties, ReactNode, Ref } from "react";

import { GRID_HOST_STYLE } from "./viewport.ts";

type GridHostProps = {
  readonly children?: ReactNode;
  readonly label: string;
  readonly hostRef?: Ref<HTMLDivElement>;
};

const hostStyle: CSSProperties = {
  width: GRID_HOST_STYLE.width,
  height: GRID_HOST_STYLE.height,
  overflow: "hidden",
  position: "relative",
  background: "#fff",
  color: "#111",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
};

export function GridHost({ children, label, hostRef }: GridHostProps) {
  return (
    <div
      ref={hostRef}
      className="benchmark-grid-host"
      data-benchmark-host={label}
      style={hostStyle}
    >
      {children}
    </div>
  );
}
