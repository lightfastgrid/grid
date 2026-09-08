import { CSS as LFG_CSS } from "../../../rendering/const/css-classes";

/**
 * Elements that receive `role="rowgroup"`.
 *
 * Attributes-only by contract: the accessibility plugin never restructures the
 * grid DOM (see the no-structural-mutation guard test). The header container is
 * an existing renderer-owned element, so setting the role on it is safe.
 *
 * There is deliberately **no body rowgroup**: the scroll container holds the
 * header and the pooled body rows as siblings, so no existing element wraps
 * only the body rows — and `rowgroup` is optional in the ARIA grid pattern
 * (`grid` may own `row`s directly). A body rowgroup would require a
 * renderer-owned wrapper (a core change), never a plugin-inserted one — the
 * plugin re-parenting pooled rows previously broke the renderer's pool
 * management, which assumes rows are direct children of the scroll container.
 */
export interface RowgroupRoleHost {
  readonly headerGroup: HTMLElement;
}

/** Apply `role="rowgroup"` to the header container. */
export function applyRowgroupRoles(host: RowgroupRoleHost): void {
  host.headerGroup.setAttribute("role", "rowgroup");
}

/** Remove the header `role="rowgroup"`. */
export function clearRowgroupRoles(host: RowgroupRoleHost): void {
  host.headerGroup.removeAttribute("role");
}

/** Resolve the header container, or `null` before the grid skeleton mounts. */
export function resolveRowgroupRoleHost(
  root: HTMLElement,
): RowgroupRoleHost | null {
  const headerGroup = root.querySelector<HTMLElement>(
    `:scope .${LFG_CSS.HEADER}`,
  );
  return headerGroup === null ? null : { headerGroup };
}
