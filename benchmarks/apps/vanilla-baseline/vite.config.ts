import { defineConfig } from "vite";

import { createBenchmarkViteBuild } from "../../shared/vite.app.mjs";

export default defineConfig(({ mode }) =>
  createBenchmarkViteBuild({
    mode,
    rootUrl: import.meta.url,
    appId: "vanilla-baseline",
  }),
);
