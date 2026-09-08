type DemoStatusProps = {
  message: string;
};

/** Status region with aria-live only on the changing text. */
export function DemoStatus({ message }: DemoStatusProps) {
  return (
    <p className="demo-status" role="status">
      <span aria-live="polite">{message}</span>
    </p>
  );
}
