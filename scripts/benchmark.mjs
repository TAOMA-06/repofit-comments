import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "dist", "src", "launcher.js");
const fixture = mkdtempSync(join(tmpdir(), "repofit-benchmark-"));
const manyFilesFixture = mkdtempSync(join(tmpdir(), "repofit-benchmark-files-"));

function git(args) {
  return execFileSync("git", args, { cwd: fixture, encoding: "utf8" });
}

try {
  git(["init", "-q"]);
  git(["config", "user.email", "repofit@example.invalid"]);
  git(["config", "user.name", "RepoFit Benchmark"]);
  const baselineLines = Array.from(
    { length: 9_999 },
    (_, index) => `export const value${index} = ${index};`,
  );
  const changedLines = baselineLines.map((_, index) =>
    index === 0
      ? `export const value${index} = ${index + 1};\n// Main Logic`
      : `export const value${index} = ${index + 1};`,
  );
  const path = join(fixture, "benchmark.ts");
  writeFileSync(path, `${baselineLines.join("\n")}\n`);
  git(["add", "benchmark.ts"]);
  git(["commit", "-qm", "baseline"]);
  writeFileSync(path, `${changedLines.join("\n")}\n`);

  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [cli, "check", "--worktree", "--format", "json"],
    { cwd: fixture, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const elapsedMs = performance.now() - started;
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.length, 1);
  assert.ok(elapsedMs < 10_000, `10,000-line benchmark took ${elapsedMs.toFixed(1)}ms`);

  const config = {
    schemaVersion: "1.0",
    rulePackVersion: "1.0.0",
    limits: { maxChangedLines: 9_999 },
  };
  writeFileSync(join(fixture, ".repofit.json"), `${JSON.stringify(config)}\n`);
  const refused = spawnSync(
    process.execPath,
    [cli, "check", "--worktree", "--format", "json"],
    { cwd: fixture, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /maxChangedLines=9999/);

  execFileSync("git", ["init", "-q"], { cwd: manyFilesFixture });
  execFileSync("git", ["config", "user.email", "repofit@example.invalid"], {
    cwd: manyFilesFixture,
  });
  execFileSync("git", ["config", "user.name", "RepoFit Benchmark"], {
    cwd: manyFilesFixture,
  });
  for (let index = 0; index < 100; index += 1) {
    writeFileSync(
      join(manyFilesFixture, `file-${index}.ts`),
      `export function value${index}(): number {\n  return ${index};\n}\n`,
    );
  }
  execFileSync("git", ["add", "."], { cwd: manyFilesFixture });
  execFileSync("git", ["commit", "-qm", "100-file baseline"], {
    cwd: manyFilesFixture,
  });
  for (let index = 0; index < 100; index += 1) {
    writeFileSync(
      join(manyFilesFixture, `file-${index}.ts`),
      `export function value${index}(): number {\n  // Main Logic\n  return ${index};\n}\n`,
    );
  }
  const manyStarted = performance.now();
  const manyResult = spawnSync(
    process.execPath,
    [cli, "check", "--worktree", "--format", "json"],
    { cwd: manyFilesFixture, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const manyElapsedMs = performance.now() - manyStarted;
  assert.equal(manyResult.status, 1, manyResult.stderr);
  assert.equal(JSON.parse(manyResult.stdout).findings.length, 100);
  assert.ok(manyElapsedMs < 5_000, `100-file benchmark took ${manyElapsedMs.toFixed(1)}ms`);
  process.stdout.write(
    `${JSON.stringify({ changedLines: { count: 10_000, elapsedMs: Number(elapsedMs.toFixed(1)), thresholdMs: 10_000 }, files: { count: 100, elapsedMs: Number(manyElapsedMs.toFixed(1)), thresholdMs: 5_000 } })}\n`,
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(manyFilesFixture, { recursive: true, force: true });
}
