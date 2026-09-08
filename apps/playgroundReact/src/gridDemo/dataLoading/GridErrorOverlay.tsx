import "./errorOverlay.css";

export function GridErrorOverlay({ message }: { message: string }) {
  return (
    <div className="grid-demo-error-overlay-body">
      <p className="grid-demo-error-overlay-title">Failed to load dataset</p>
      <p className="grid-demo-error-overlay-message">{message}</p>
    </div>
  );
}
