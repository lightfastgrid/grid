#!/usr/bin/env node
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

import { BENCHMARKS_ROOT, run } from "./lib/paths.mjs";

const executable = chromium.executablePath();
if (!existsSync(executable)) {
  console.log("Installing Playwright Chromium...");
  run("pnpm", ["exec", "playwright", "install", "chromium"], BENCHMARKS_ROOT);
} else {
  console.log(`Playwright Chromium already installed: ${executable}`);
}
