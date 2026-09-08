type IconProps = { className?: string };

export function IconSortDrag({ className }: IconProps) {
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

export function IconClearSort({ className }: IconProps) {
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
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
