import type { ReactNode } from "react";

type BenchmarkShellProps = {
  readonly title: string;
  readonly status: string;
  readonly children: ReactNode;
};

export function BenchmarkShell({ title, status, children }: BenchmarkShellProps) {
  return (
    <main className="benchmark-shell">
      <p className="benchmark-status">
        <strong>{title}</strong>
        <br />
        {status}
      </p>
      {children}
    </main>
  );
}
