type IconProps = { className?: string };

const svgProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

export function IconShowAllColumns({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

export function IconHideSelectedColumns({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h8" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
      <path d="m18 16 4 4" />
      <path d="m22 16-4 4" />
    </svg>
  );
}

export function IconAutoSizeColumns({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M8 3v18" />
      <path d="M16 3v18" />
      <path d="m3 12 3-3 3 3" />
      <path d="M6 15V9" />
      <path d="m15 12 3-3 3 3" />
      <path d="M18 15V9" />
    </svg>
  );
}

export function IconFitColumns({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M15 4v16" />
    </svg>
  );
}

export function IconResetColumnWidths({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function IconClearPinning({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 17v5" />
      <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
      <path d="m2 2 20 20" />
      <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
    </svg>
  );
}
