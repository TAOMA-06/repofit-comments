import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "release");
const manifest = JSON.parse(readFileSync(join(directory, "release-manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, "1.0");
assert.match(manifest.version, /^1\.\d+\.\d+-(?:alpha|beta|rc)\.\d+$/);
assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
assert.equal(manifest.nodeVersion.startsWith("v"), true);
assert.equal(manifest.npmVersion, "11.19.1");
assert.match(manifest.npmIntegrity, /^sha512-/);
assert.ok(Array.isArray(manifest.files));
const checksumLines = readFileSync(join(directory, "SHA256SUMS"), "utf8")
  .trim()
  .split("\n");
for (const file of manifest.files) {
  assert.equal(basename(file.name), file.name);
  assert.match(file.sha256, /^[0-9a-f]{64}$/);
  const actual = createHash("sha256")
    .update(readFileSync(join(directory, file.name)))
    .digest("hex");
  assert.equal(actual, file.sha256, file.name);
  assert.ok(checksumLines.includes(`${file.sha256}  ${file.name}`));
}
const tarballs = readdirSync(directory).filter((name) => name.endsWith(".tgz"));
assert.equal(tarballs.length, 1);
assert.ok(tarballs[0]?.includes(manifest.version));
const expectedDirectoryEntries = [
  "SHA256SUMS",
  "release-manifest.json",
  ...manifest.files.map((file) => file.name),
].sort();
assert.deepEqual(readdirSync(directory).sort(), expectedDirectoryEntries);
const sbomFile = manifest.files.find((file) => file.name.endsWith(".spdx.json"));
assert.ok(sbomFile);
const sbom = JSON.parse(readFileSync(join(directory, sbomFile.name), "utf8"));
assert.match(sbom.spdxVersion, /^SPDX-2\./);
assert.equal(sbom.dataLicense, "CC0-1.0");
assert.ok(
  sbom.packages.some(
    (item) =>
      item.name === manifest.package &&
      item.versionInfo === manifest.version &&
      item.primaryPackagePurpose === "APPLICATION",
  ),
);
for (const dependency of [
  "typescript",
  "web-tree-sitter",
  "tree-sitter-wasms",
  "tree-sitter-bash",
]) {
  assert.ok(
    sbom.packages.some((item) => item.name === dependency),
    `SBOM is missing runtime dependency ${dependency}`,
  );
}
process.stdout.write(`Verified release ${manifest.version} from ${manifest.sourceCommit}.\n`);
