// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  addAriaDescribedByToken,
  removeAriaDescribedByToken,
  replaceOwnedAriaDescribedByTokens,
} from "../ariaIdReferenceTokens";

describe("ariaIdReferenceTokens", () => {
  it("adds one token without duplicating existing relationships", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "aria-describedby",
      "application-help   secondary-help",
    );

    expect(addAriaDescribedByToken(element, "lfg-tooltip-1")).toBe(true);
    expect(addAriaDescribedByToken(element, "lfg-tooltip-1")).toBe(false);
    expect(element.getAttribute("aria-describedby")).toBe(
      "application-help   secondary-help lfg-tooltip-1",
    );

    removeAriaDescribedByToken(element, "lfg-tooltip-1");
    expect(element.getAttribute("aria-describedby")).toBe(
      "application-help   secondary-help",
    );
  });

  it("removes only the exact owned token", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "aria-describedby",
      "help lfg-tooltip-1 helper lfg-tooltip-1",
    );

    removeAriaDescribedByToken(element, "lfg-tooltip-1");

    expect(element.getAttribute("aria-describedby")).toBe("help helper");
  });

  it("replaces prior owned tokens while preserving unowned token order", () => {
    const element = document.createElement("div");
    element.setAttribute(
      "aria-describedby",
      "external old-help lfg-tooltip-1 tail",
    );

    replaceOwnedAriaDescribedByTokens(
      element,
      "old-help",
      "new-help extra-help",
    );

    expect(element.getAttribute("aria-describedby")).toBe(
      "external new-help extra-help lfg-tooltip-1 tail",
    );
  });

  it("preserves exact authored spacing when there is no foreign owner", () => {
    const element = document.createElement("div");
    element.setAttribute("aria-describedby", "old-one   old-two");

    replaceOwnedAriaDescribedByTokens(
      element,
      "old-one   old-two",
      "new-one   new-two",
    );

    expect(element.getAttribute("aria-describedby")).toBe(
      "new-one   new-two",
    );
  });

  it("removes the attribute only when no relationship remains", () => {
    const element = document.createElement("div");
    element.setAttribute("aria-describedby", "owned");

    replaceOwnedAriaDescribedByTokens(element, "owned", undefined);

    expect(element.hasAttribute("aria-describedby")).toBe(false);
  });

  it("rejects empty and whitespace-containing single tokens before mutation", () => {
    const element = document.createElement("div");
    element.setAttribute("aria-describedby", "application-help");

    expect(() => addAriaDescribedByToken(element, "")).toThrow();
    expect(() => removeAriaDescribedByToken(element, "two tokens")).toThrow();
    expect(element.getAttribute("aria-describedby")).toBe("application-help");
  });
});
