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

export function IconGroupedHeaders({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M12 12 4 8" />
      <path d="m12 12 8-4" />
      <path d="M12 12v10" />
    </svg>
  );
}

export function IconFloatingFilters({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="M3.3 7 12 12l8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

export function IconPagination({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M12 2 4 6l8 4 8-4-8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 18 8 4 8-4" />
    </svg>
  );
}

export function IconThemeLight({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.9 19.1 1.4-1.4" />
      <path d="m17.7 6.3 1.4-1.4" />
    </svg>
  );
}

export function IconThemeDark({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z" />
    </svg>
  );
}

export function IconThemeSystem({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
      <path d="M12 3a9 9 0 0 1 0 18" />
    </svg>
  );
}

export function IconResetDemo({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}
