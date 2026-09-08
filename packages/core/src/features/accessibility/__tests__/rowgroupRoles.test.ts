// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  applyRowgroupRoles,
  clearRowgroupRoles,
  resolveRowgroupRoleHost,
} from "../utils/rowgroupRoles";

function buildRoot(): { root: HTMLDivElement; headerGroup: HTMLDivElement } {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  viewport.className = "lfg-viewport";
  const scrollContainer = document.createElement("div");
  scrollContainer.className = "lfg-scroll-container";
  const headerGroup = document.createElement("div");
  headerGroup.className = "lfg-header";
  scrollContainer.appendChild(headerGroup);
  viewport.appendChild(scrollContainer);
  root.appendChild(viewport);
  return { root, headerGroup };
}

describe("rowgroupRoles (attributes-only)", () => {
  it("applies role=rowgroup to the header container", () => {
    const { headerGroup } = buildRoot();
    applyRowgroupRoles({ headerGroup });
    expect(headerGroup.getAttribute("role")).toBe("rowgroup");
  });

  it("clears the header role on teardown", () => {
    const { headerGroup } = buildRoot();
    applyRowgroupRoles({ headerGroup });
    clearRowgroupRoles({ headerGroup });
    expect(headerGroup.getAttribute("role")).toBeNull();
  });

  it("never wraps or re-parents body rows (no DOM restructuring)", () => {
    const { root, headerGroup } = buildRoot();
    const scrollContainer = root.querySelector<HTMLElement>(
      ".lfg-scroll-container",
    )!;
    const row = document.createElement("div");
    row.className = "lfg-row";
    scrollContainer.appendChild(row);

    applyRowgroupRoles({ headerGroup });

    // Rows stay direct children — the renderer's `:scope > .lfg-row` contract
    // is preserved.
    expect(scrollContainer.querySelector(":scope > .lfg-row")).toBe(row);
    expect(row.parentElement).toBe(scrollContainer);
  });

  it("resolves the header container from the root", () => {
    const { root, headerGroup } = buildRoot();
    expect(resolveRowgroupRoleHost(root)).toEqual({ headerGroup });
  });

  it("resolves to null before the header exists", () => {
    expect(resolveRowgroupRoleHost(document.createElement("div"))).toBeNull();
  });
});
