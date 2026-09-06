import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputArgument = process.argv[2];
if (!outputArgument) throw new Error("Usage: build-release.mjs <new-output-directory>");
const outputDirectory = resolve(outputArgument);
const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.equal(manifest.private, false, "release builds require private=false");
assert.match(manifest.version, /^1\.\d+\.\d+-(?:alpha|beta|rc)\.\d+$/);
assert.equal(lockfile.version, manifest.version, "package-lock top-level version mismatch");
assert.equal(lockfile.packages?.[""]?.version, manifest.version, "package-lock root version mismatch");
const requiredNpmVersion = String(manifest.packageManager).replace(/^npm@/, "");
assert.equal(runNpmVersion(), requiredNpmVersion, "release npm version mismatch");
if (process.env.GITHUB_REF_NAME) {
  assert.equal(process.env.GITHUB_REF_NAME, `v${manifest.version}`, "Git tag/version mismatch");
}

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" });
}

function runNpmVersion() {
  return execFileSync(npm, ["--version"], { cwd: root, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function listFiles(directory, packagePrefix) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const packagedPath = `${packagePrefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(path, packagedPath));
    else if (entry.isFile()) files.push(packagedPath);
    else throw new Error(`release build contains a non-regular entry: ${packagedPath}`);
  }
  return files;
}

const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
if (process.env.GITHUB_SHA) {
  assert.equal(sourceCommit, process.env.GITHUB_SHA, "GitHub SHA/source commit mismatch");
}
const status = run("git", ["status", "--porcelain"]).trim();
assert.equal(status, "", "release builds require a clean working tree");
mkdirSync(outputDirectory);
const packed = JSON.parse(
  run(npm, ["pack", "--json", "--pack-destination", outputDirectory]),
);
assert.equal(packed.length, 1);
const packageRecord = packed[0];
const tarballName = packageRecord.filename;
const packagedPaths = packageRecord.files.map((file) => file.path).sort();
const expectedPaths = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "package.json",
  ...listFiles(join(root, "dist", "src"), "dist/src"),
  ...listFiles(join(root, "schemas"), "schemas"),
].sort();
assert.deepEqual(packagedPaths, expectedPaths, "release tarball allowlist mismatch");
assert.equal(run(process.execPath, ["dist/src/launcher.js", "--version"]).trim(), manifest.version);
const tarballPath = resolve(outputDirectory, tarballName);
const sbomName = `${manifest.name}-${manifest.version}.spdx.json`;
const sbomPath = resolve(outputDirectory, sbomName);
const sbom = run(npm, [
  "sbom",
  "--package-lock-only",
  "--omit",
  "dev",
  "--sbom-format",
  "spdx",
  "--sbom-type",
  "application",
]);
JSON.parse(sbom);
writeFileSync(sbomPath, `${sbom.trim()}\n`, "utf8");

const files = [tarballPath, sbomPath].map((path) => ({
  name: basename(path),
  sha256: sha256(readFileSync(path)),
}));
writeFileSync(
  resolve(outputDirectory, "SHA256SUMS"),
  `${files.map((file) => `${file.sha256}  ${file.name}`).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  resolve(outputDirectory, "release-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      package: manifest.name,
      version: manifest.version,
      sourceCommit,
      nodeVersion: process.version,
      npmVersion: runNpmVersion(),
      npmIntegrity: packageRecord.integrity,
      files,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(`${tarballName}\n`);
