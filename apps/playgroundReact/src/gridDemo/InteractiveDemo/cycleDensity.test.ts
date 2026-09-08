import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cycleDensity, densityLabel } from "./cycleDensity.ts";

describe("cycleDensity", () => {
  it("cycles compact → standard → comfortable → compact", () => {
    assert.equal(cycleDensity("compact"), "standard");
    assert.equal(cycleDensity("standard"), "comfortable");
    assert.equal(cycleDensity("comfortable"), "compact");
  });
});

describe("densityLabel", () => {
  it("returns readable labels", () => {
    assert.equal(densityLabel("compact"), "Compact");
    assert.equal(densityLabel("standard"), "Standard");
    assert.equal(densityLabel("comfortable"), "Comfortable");
  });
});
