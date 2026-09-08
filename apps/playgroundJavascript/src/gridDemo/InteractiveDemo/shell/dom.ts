/** DOM helpers for InteractiveDemo shell / panels. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgIcon(
  paths: string[],
  options?: { width?: number; height?: number; className?: string },
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const width = options?.width ?? 14;
  const height = options?.height ?? 14;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (options?.className) svg.setAttribute("class", options.className);
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export function svgRectIcon(
  rects: Array<{ x: string; y: string; width: string; height: string; rx?: string }>,
  className?: string,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  for (const rect of rects) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    node.setAttribute("x", rect.x);
    node.setAttribute("y", rect.y);
    node.setAttribute("width", rect.width);
    node.setAttribute("height", rect.height);
    if (rect.rx) node.setAttribute("rx", rect.rx);
    svg.append(node);
  }
  return svg;
}
