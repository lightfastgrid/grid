import { APP_IDS, appDir, run } from "./lib/paths.mjs";

export function typecheckBenchmarkApps() {
  for (const id of APP_IDS) {
    run("pnpm", ["exec", "tsc", "--noEmit"], appDir(id));
  }
}
