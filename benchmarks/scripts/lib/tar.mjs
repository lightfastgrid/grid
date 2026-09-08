import { run } from "./paths.mjs";

export function readTarballPackageJson(tarballPath) {
  const output = run("tar", ["-xOf", tarballPath, "package/package.json"], process.cwd(), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}
