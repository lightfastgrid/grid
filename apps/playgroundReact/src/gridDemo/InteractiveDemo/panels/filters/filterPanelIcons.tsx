type IconProps = { className?: string };

export function IconFilterDrag({ className }: IconProps) {
  return (
    <svg
      width={10}
      height={14}
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="3" cy="2" r="1.15" />
      <circle cx="7" cy="2" r="1.15" />
      <circle cx="3" cy="7" r="1.15" />
      <circle cx="7" cy="7" r="1.15" />
      <circle cx="3" cy="12" r="1.15" />
      <circle cx="7" cy="12" r="1.15" />
    </svg>
  );
}

export function IconClearFilters({ className }: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

export function IconFloatingFilters({ className }: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}
