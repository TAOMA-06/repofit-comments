#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

if (major < 24) {
  await import("./cli.js");
} else {
  const result = spawnSync(
    process.execPath,
    ["--liftoff-only", cliPath, ...process.argv.slice(2)],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`RepoFit CLI was terminated by ${result.signal}.`);
  }
  process.exitCode = result.status ?? 1;
}
