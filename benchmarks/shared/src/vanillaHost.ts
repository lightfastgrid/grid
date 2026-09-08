import { GRID_HOST_STYLE } from "./viewport.ts";

export type VanillaBenchmarkChrome = {
  readonly root: HTMLElement;
  readonly host: HTMLElement;
  setStatus(status: string): void;
  destroy(): void;
};

function applyHostStyle(host: HTMLDivElement): void {
  host.style.width = `${GRID_HOST_STYLE.width}px`;
  host.style.height = `${GRID_HOST_STYLE.height}px`;
  host.style.overflow = "hidden";
  host.style.position = "relative";
  host.style.background = "#fff";
  host.style.color = "#111";
  host.style.fontFamily = "system-ui, sans-serif";
  host.style.fontSize = "13px";
}

function renderStatus(
  statusEl: HTMLParagraphElement,
  title: string,
  status: string,
): void {
  const strong = document.createElement("strong");
  strong.textContent = title;
  statusEl.replaceChildren(strong, document.createElement("br"), document.createTextNode(status));
}

export function mountVanillaBenchmarkChrome(
  container: HTMLElement,
  options: {
    readonly title: string;
    readonly label: string;
    readonly status: string;
  },
): VanillaBenchmarkChrome {
  container.replaceChildren();

  const shell = document.createElement("main");
  shell.className = "benchmark-shell";

  const statusEl = document.createElement("p");
  statusEl.className = "benchmark-status";
  renderStatus(statusEl, options.title, options.status);

  const host = document.createElement("div");
  host.className = "benchmark-grid-host";
  host.dataset.benchmarkHost = options.label;
  applyHostStyle(host);

  shell.append(statusEl, host);
  container.append(shell);

  return {
    root: shell,
    host,
    setStatus(status) {
      renderStatus(statusEl, options.title, status);
    },
    destroy() {
      container.replaceChildren();
    },
  };
}
