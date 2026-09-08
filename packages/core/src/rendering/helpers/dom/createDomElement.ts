/**
 * Create a div with a class, optional role, and optional attributes.
 */

export function createDiv(
  className: string,
  role?: string,
  attrs?: Record<string, string>,
): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  if (role) el.setAttribute("role", role);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  return el;
}
