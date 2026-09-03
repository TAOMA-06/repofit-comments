import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { analyzeRepository } from "../src/analysis.js";
import { readWorkingTreeContent } from "../src/git.js";
import type { AnalysisReport } from "../src/model.js";
import { applyFinding } from "../src/patch.js";

const cliPath =
  process.env.REPOFIT_CLI_PATH ?? fileURLToPath(new URL("../src/cli.js", import.meta.url));

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

test("CLI checks, previews, applies, and verifies one staged comment fix", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);

    const path = join(root, "counter.ts");
    const baseline = [
      "export function increment(value: number): number {",
      "  const offset = 1;",
      "  const result = value + offset;",
      "  if (result < 0) return 0;",
      "  return result;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "counter.ts"]);
    git(root, ["commit", "-qm", "baseline"]);

    const changed = baseline.replace(
      "  return result;",
      "  // Main Logic\n  // Increment value\n  value++;\n  return result;",
    );
    writeFileSync(path, changed);
    git(root, ["add", "counter.ts"]);

    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--staged", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(checked.status, 1, checked.stderr);
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    assert.ok(report.summary.removeSafeCount >= 2);
    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "comments.decorative-heading",
    );
    assert.ok(finding);

    const dryRun = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--staged", "--dry-run"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /remove comment/);
    assert.equal(readFileSync(path, "utf8"), changed);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--staged", "--apply"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    const updated = readFileSync(path, "utf8");
    assert.doesNotMatch(updated, /Main Logic/);
    assert.match(updated, /Increment value/);
    assert.match(updated, /value\+\+;/);

    const verified = spawnSync(process.execPath, [cliPath, "comments", "verify"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    assert.match(verified.stdout, /Verified/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI applies a deterministic step-prefix rewrite without changing code", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-rewrite-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const path = join(root, "pricing.ts");
    const baseline = [
      "export function total(values: readonly number[]): number {",
      "  const start = 0;",
      "  const one = 1;",
      "  const two = one + one;",
      "  void two;",
      "  return values.reduce((sum, value) => sum + value, start);",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "pricing.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const changed = baseline.replace(
      "  return values.reduce",
      "  // Step 1: sum all values into the total.\n  return values.reduce",
    );
    writeFileSync(path, changed);
    git(root, ["add", "pricing.ts"]);

    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--staged", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(checked.status, 1, checked.stderr);
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    const finding = report.findings.find((candidate) => candidate.action === "rewrite-safe");
    assert.ok(finding);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--staged", "--apply"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    const updated = readFileSync(path, "utf8");
    assert.doesNotMatch(updated, /Step 1:/);
    assert.match(updated, /\/\/ Sum all values into the total\./);
    assert.match(updated, /return values\.reduce/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI applies every safe finding in one file as one verified transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-batch-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const path = join(root, "pricing.ts");
    const baseline = [
      "export function total(values: readonly number[]): number {",
      "  const start = 0;",
      "  const one = 1;",
      "  const two = one + one;",
      "  void two;",
      "  const subtotal = values.reduce((sum, value) => sum + value, start);",
      "  return subtotal;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "pricing.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const changed = baseline
      .replace(
        "  const subtotal =",
        "  // Step 1: sum immutable line totals.\n  const subtotal =",
      )
      .replace("  return subtotal;", "  // Step 2: return the subtotal.\n  return subtotal;");
    writeFileSync(path, changed);
    git(root, ["add", "pricing.ts"]);

    const dryRun = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", "--all-safe", "--file", "pricing.ts", "--staged"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /these 2 findings as one transaction/);
    assert.equal(readFileSync(path, "utf8"), changed);

    const applied = spawnSync(
      process.execPath,
      [
        cliPath,
        "comments",
        "fix",
        "--all-safe",
        "--file",
        "pricing.ts",
        "--staged",
        "--apply",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Applied 2 safe findings/);
    const updated = readFileSync(path, "utf8");
    assert.doesNotMatch(updated, /Step [12]:/);
    assert.match(updated, /\/\/ Sum immutable line totals\./);
    assert.match(updated, /\/\/ Return the subtotal\./);

    const verified = spawnSync(process.execPath, [cliPath, "comments", "verify"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    assert.match(verified.stdout, /Verified .+, .+ in pricing\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI supports worktree and base scopes", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-scope-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const path = join(root, "scope.ts");
    const baseline = [
      "export function compute(value: number): number {",
      "  const a = 1;",
      "  const b = 2;",
      "  const c = a + b;",
      "  value += c;",
      "  return value;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "scope.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const baselineCommit = git(root, ["rev-parse", "HEAD"]).trim();

    writeFileSync(path, baseline.replace("  return value;", "  // Step 1\n  return value;"));
    const worktree = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(worktree.status, 1, worktree.stderr);
    const worktreeReport = JSON.parse(worktree.stdout) as AnalysisReport;
    assert.equal(worktreeReport.findings[0]?.ruleId, "comments.step-label");

    git(root, ["add", "scope.ts"]);
    git(root, ["commit", "-qm", "add narrated change"]);
    const base = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--base", baselineCommit, "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(base.status, 1, base.stderr);
    const baseReport = JSON.parse(base.stdout) as AnalysisReport;
    assert.equal(baseReport.findings[0]?.ruleId, "comments.step-label");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyFinding refuses to overwrite a concurrent working-tree edit", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-conflict-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const path = join(root, "conflict.ts");
    const baseline = [
      "export function compute(value: number): number {",
      "  const a = 1;",
      "  const b = 2;",
      "  const c = a + b;",
      "  value += c;",
      "  return value;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "conflict.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const changed = baseline.replace("  return value;", "  // Main Logic\n  return value;");
    writeFileSync(path, changed);

    const report = analyzeRepository(root, { kind: "worktree" });
    const finding = report.findings[0];
    assert.ok(finding);
    const concurrent = `${changed}\n// user edit after analysis\n`;
    writeFileSync(path, concurrent);

    assert.throws(() => applyFinding(root, finding), /changed after analysis/);
    assert.equal(readFileSync(path, "utf8"), concurrent);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI refuses to apply suggestion-only findings", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-suggestion-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const path = join(root, "suggestion.ts");
    const baseline = [
      "export function update(value: number): number {",
      "  const one = 1;",
      "  const two = 2;",
      "  const three = one + two;",
      "  value += three;",
      "  return value;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "suggestion.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const changed = baseline.replace(
      "  return value;",
      "  // Here we return the computed value\n  return value;",
    );
    writeFileSync(path, changed);
    git(root, ["add", "suggestion.ts"]);

    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--staged", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    const finding = report.findings.find((candidate) => candidate.action === "rewrite-suggested");
    assert.ok(finding);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--staged", "--apply"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 2);
    assert.match(applied.stderr, /not eligible for an automatic comment fix/);
    assert.equal(readFileSync(path, "utf8"), changed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejects mutually exclusive scope flags before reading a repository", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "comments", "check", "--staged", "--worktree"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /mutually exclusive/);
});

test("working-tree reads refuse symbolic links", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-symlink-test-"));
  const outside = join(root, "outside.txt");
  try {
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(root, "linked.ts"));

    assert.throws(
      () => readWorkingTreeContent(root, "linked.ts"),
      /non-regular source file/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
