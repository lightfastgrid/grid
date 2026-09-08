import "./errorOverlay.css";

/** Vanilla port of React GridErrorOverlay. */
export function mountGridErrorOverlay(
  host: HTMLElement,
  message: string,
): () => void {
  const body = document.createElement("div");
  body.className = "grid-demo-error-overlay-body";

  const title = document.createElement("p");
  title.className = "grid-demo-error-overlay-title";
  title.textContent = "Failed to load dataset";

  const detail = document.createElement("p");
  detail.className = "grid-demo-error-overlay-message";
  detail.textContent = message;

  body.append(title, detail);
  host.append(body);

  return () => {
    body.remove();
  };
}
