#!/usr/bin/env node
/**
 * Static production-asset check. This script fetches built HTML and JS over
 * Vite Preview HTTP. It does not mount a grid, run `window.__GRID_BENCHMARK__`,
 * or execute application logic. Browser execution is `pnpm benchmark:runtime`.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import { APP_IDS, BUILD_MODES, appDir, appDistDir } from "./lib/paths.mjs";
import { resolveViteCli } from "../tests/performance/fixtures/previewServer.ts";

const modes = process.argv.slice(2).filter((value) => BUILD_MODES.includes(value));
const previewModes = modes.length > 0 ? modes : BUILD_MODES;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertDistHtml(id, buildMode) {
  const distDir = appDistDir(id, buildMode);
  const htmlPath = join(distDir, "index.html");
  if (!existsSync(htmlPath)) {
    fail(`${id} ${buildMode} missing dist/${buildMode}/index.html`);
  }
  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes("assets/")) {
    fail(`${id} ${buildMode} dist HTML does not reference generated assets`);
  }
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  const assetRefs = refs.filter((ref) => ref.includes("assets/") && !ref.startsWith("http"));
  if (assetRefs.length === 0) {
    fail(`${id} ${buildMode} dist HTML has no generated asset references`);
  }
  for (const ref of assetRefs) {
    const filePath = resolve(distDir, ref.replace(/^\//, "./"));
    if (!existsSync(filePath)) {
      fail(`${id} ${buildMode} HTML references missing asset ${ref} (${filePath})`);
    }
    if (statSync(filePath).size === 0) {
      fail(`${id} ${buildMode} asset ${ref} is empty`);
    }
  }
  const manifestPath = join(distDir, ".vite/manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`${id} ${buildMode} missing Vite manifest at ${manifestPath}`);
  }
  return assetRefs;
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
    server.on("error", reject);
  });
}

async function fetchWithRetry(url, attempts = 40) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw lastError;
}

function stopChild(child) {
  return new Promise((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveStop();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, 2000);
    child.on("exit", finish);
    child.kill("SIGTERM");
  });
}

async function previewApp(id, buildMode) {
  const assetRefs = assertDistHtml(id, buildMode);
  const port = await getFreePort();
  const child = spawn(
    process.execPath,
    [
      resolveViteCli(id),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
      "--outDir",
      `dist/${buildMode}`,
    ],
    {
      cwd: appDir(id),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += buf.toString();
  });
  try {
    const response = await fetchWithRetry(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    if (!html.includes("assets/") || html.trim().length < 50) {
      fail(`${id} ${buildMode} static preview returned a blank or asset-less document`);
    }
    const firstJs = assetRefs.find((ref) => ref.endsWith(".js"));
    if (!firstJs) {
      fail(`${id} ${buildMode} production HTML has no JavaScript asset`);
    }
    const jsUrl = firstJs.startsWith("/")
      ? `http://127.0.0.1:${port}${firstJs}`
      : `http://127.0.0.1:${port}/${firstJs.replace(/^\.\//, "")}`;
    const jsResponse = await fetchWithRetry(jsUrl);
    const js = await jsResponse.text();
    if (js.trim().length === 0) {
      fail(`${id} ${buildMode} static preview JavaScript asset is empty`);
    }
    console.log(
      `${id} ${buildMode}: static HTML/JS assets served on :${port} (grid/protocol not executed)`,
    );
  } catch (error) {
    fail(
      `${id} ${buildMode} static preview failed: ${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`,
    );
  } finally {
    await stopChild(child);
  }
}

for (const id of APP_IDS) {
  for (const mode of previewModes) {
    await previewApp(id, mode);
  }
}

console.log(
  "Static preview verification passed. This does not prove that a grid mounted or that the runtime protocol works.",
);
process.exit(0);
