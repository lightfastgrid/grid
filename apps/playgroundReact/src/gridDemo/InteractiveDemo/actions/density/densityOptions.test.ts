import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEMO_DENSITY_STORAGE_KEY,
  readStoredDemoDensity,
  writeStoredDemoDensity,
} from "./demoDensityStorage.ts";
import {
  DEMO_DENSITY_OPTIONS,
  densityOptionLabel,
  isGridThemeDensity,
} from "./densityOptions.ts";

describe("densityOptions", () => {
  it("lists compact, standard, comfortable", () => {
    assert.deepEqual(
      DEMO_DENSITY_OPTIONS.map((option) => option.value),
      ["compact", "standard", "comfortable"],
    );
  });

  it("validates density strings", () => {
    assert.equal(isGridThemeDensity("standard"), true);
    assert.equal(isGridThemeDensity("wide"), false);
    assert.equal(densityOptionLabel("comfortable"), "Comfortable");
  });
});

describe("demoDensityStorage", () => {
  it("reads and writes valid density", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    assert.equal(readStoredDemoDensity(storage), null);
    writeStoredDemoDensity("compact", storage);
    assert.equal(store.get(DEMO_DENSITY_STORAGE_KEY), "compact");
    assert.equal(readStoredDemoDensity(storage), "compact");
  });

  it("ignores invalid stored values", () => {
    const storage = {
      getItem: () => "huge",
      setItem: () => {},
    };
    assert.equal(readStoredDemoDensity(storage), null);
  });
});
