import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
const base = process.env.INPUT_BASE;
const output = process.env.INPUT_OUTPUT ?? "repofit-results.sarif";
if (!base || base.length > 256 || base.includes("\0") || base.includes("\n")) {
  throw new Error("RepoFit Action requires a valid base commit or ref.");
}
if (
  !output ||
  /[\u0000-\u001f\u007f]/u.test(output) ||
  isAbsolute(output) ||
  !output.endsWith(".sarif")
) {
  throw new Error("RepoFit Action output must be a control-free repository-relative .sarif path.");
}
const outputSegments = output.split(/[\\/]/u);
if (outputSegments.length !== 1) {
  throw new Error("RepoFit Action output must be a top-level SARIF filename.");
}
const outputPath = resolve(workspace, output);
const fromWorkspace = relative(workspace, outputPath);
if (fromWorkspace === ".." || fromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
  throw new Error("RepoFit Action output cannot escape the repository workspace.");
}
const realWorkspace = realpathSync(workspace);
const realOutputParent = realpathSync(dirname(outputPath));
const realParentFromWorkspace = relative(realWorkspace, realOutputParent);
if (
  realParentFromWorkspace === ".." ||
  realParentFromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
) {
  throw new Error("RepoFit Action output parent resolves outside the repository workspace.");
}
if (existsSync(outputPath)) throw new Error("RepoFit Action refuses to overwrite an existing output file.");
const cliPath = fileURLToPath(new URL("../dist/src/cli.js", import.meta.url));
const result = spawnSync(
  process.execPath,
  [cliPath, "check", "--base", base, "--format", "sarif", "--cwd", workspace],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (result.status !== 0 && result.status !== 1) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 3);
}
const sarif = JSON.parse(result.stdout);
const findings = sarif.runs?.[0]?.results?.length;
assert.equal(typeof findings, "number");
writeFileSync(outputPath, `${JSON.stringify(sarif, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o644,
});
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `sarif-path=${output}\nfindings=${findings}\n`,
    "utf8",
  );
}
