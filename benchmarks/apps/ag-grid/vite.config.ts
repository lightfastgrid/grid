import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { createBenchmarkViteBuild } from "../../shared/vite.app.mjs";

export default defineConfig(({ mode }) =>
  createBenchmarkViteBuild({
    mode,
    rootUrl: import.meta.url,
    appId: "ag-grid",
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  }),
);
