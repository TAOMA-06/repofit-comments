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

test("CLI checks, previews, applies, and verifies one worktree comment fix", () => {
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
    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(checked.status, 1, checked.stderr);
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    assert.ok(report.summary.removeSafeCount >= 2);
    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "comments.decorative-heading",
    );
    assert.ok(finding);

    const jsonDryRun = spawnSync(
      process.execPath,
      [
        cliPath,
        "comments",
        "fix",
        finding.id,
        "--worktree",
        "--dry-run",
        "--format",
        "json",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(jsonDryRun.status, 0, jsonDryRun.stderr);
    const preview = JSON.parse(jsonDryRun.stdout) as {
      type: string;
      write: boolean;
      findings: Array<{ id: string }>;
    };
    assert.equal(preview.type, "fix-preview");
    assert.equal(preview.write, false);
    assert.equal(preview.findings[0]?.id, finding.id);
    assert.equal(readFileSync(path, "utf8"), changed);

    const dryRun = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--worktree", "--dry-run"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /remove comment/);
    assert.equal(readFileSync(path, "utf8"), changed);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--worktree", "--apply"],
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

    const notYetStaged = spawnSync(
      process.execPath,
      [cliPath, "comments", "verify", "--staged"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(notYetStaged.status, 4, notYetStaged.stderr || notYetStaged.stdout);
    assert.match(notYetStaged.stdout, /no longer matches the applied patch receipt/);

    git(root, ["add", "counter.ts"]);
    const stagedVerified = spawnSync(
      process.execPath,
      [cliPath, "comments", "verify", "--staged"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(stagedVerified.status, 0, stagedVerified.stderr || stagedVerified.stdout);
    assert.match(stagedVerified.stdout, /\(staged; journal=applied\)/);
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
    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(checked.status, 1, checked.stderr);
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    const finding = report.findings.find((candidate) => candidate.action === "rewrite-safe");
    assert.ok(finding);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--worktree", "--apply"],
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
    const dryRun = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", "--all-safe", "--file", "pricing.ts", "--worktree"],
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
        "--worktree",
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
    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    const finding = report.findings.find((candidate) => candidate.action === "rewrite-suggested");
    assert.ok(finding);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--worktree", "--apply"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 5);
    assert.match(applied.stderr, /not eligible for an automatic comment fix/);
    assert.equal(readFileSync(path, "utf8"), changed);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI refuses staged automatic fixes so the index cannot retain stale comments", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-staged-fix-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const path = join(root, "staged.ts");
    const baseline = [
      "export function value(): number {",
      "  const answer = 42;",
      "  return answer;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "staged.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const changed = baseline.replace("  return answer;", "  // Main Logic\n  return answer;");
    writeFileSync(path, changed);
    git(root, ["add", "staged.ts"]);

    const checked = spawnSync(
      process.execPath,
      [cliPath, "comments", "check", "--staged", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    const report = JSON.parse(checked.stdout) as AnalysisReport;
    const finding = report.findings[0];
    assert.ok(finding);

    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", finding.id, "--staged", "--apply"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 2);
    assert.match(applied.stderr, /require --worktree/);
    assert.equal(readFileSync(path, "utf8"), changed);
    assert.equal(git(root, ["show", ":staged.ts"]), changed);
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

test("CLI rejects irrelevant flags and positional arguments", () => {
  const irrelevantFlag = spawnSync(
    process.execPath,
    [cliPath, "comments", "check", "--apply"],
    { encoding: "utf8" },
  );
  assert.equal(irrelevantFlag.status, 2);
  assert.match(irrelevantFlag.stderr, /only valid with comments fix/);

  const extraPosition = spawnSync(
    process.execPath,
    [cliPath, "comments", "verify", "unexpected"],
    { encoding: "utf8" },
  );
  assert.equal(extraPosition.status, 2);
  assert.match(extraPosition.stderr, /does not accept positional arguments/);

  const extraFinding = spawnSync(
    process.execPath,
    [cliPath, "comments", "fix", "one", "two", "--worktree"],
    { encoding: "utf8" },
  );
  assert.equal(extraFinding.status, 2);
  assert.match(extraFinding.stderr, /exactly one finding ID/);

  const scopedRecover = spawnSync(
    process.execPath,
    [cliPath, "comments", "recover", "--staged"],
    { encoding: "utf8" },
  );
  assert.equal(scopedRecover.status, 2);
  assert.match(scopedRecover.stderr, /does not accept a Git scope/);

  const basedVerify = spawnSync(
    process.execPath,
    [cliPath, "comments", "verify", "--base", "HEAD"],
    { encoding: "utf8" },
  );
  assert.equal(basedVerify.status, 2);
  assert.match(basedVerify.stderr, /supports only --worktree or --staged/);
});

test("CLI emits versioned JSON errors with stable exit categories", () => {
  const usage = spawnSync(
    process.execPath,
    [cliPath, "comments", "check", "unexpected", "--format", "json"],
    { encoding: "utf8" },
  );
  assert.equal(usage.status, 2);
  const usagePayload = JSON.parse(usage.stderr) as {
    schemaVersion: string;
    type: string;
    toolVersion: string;
    error: { code: string; message: string };
    exitCode: number;
  };
  assert.equal(usagePayload.schemaVersion, "1.0");
  assert.equal(usagePayload.type, "error");
  assert.match(usagePayload.toolVersion, /^\d+\.\d+\.\d+/);
  assert.equal(usagePayload.error.code, "invalid-arguments");
  assert.equal(usagePayload.exitCode, 2);

  const runtime = spawnSync(
    process.execPath,
    [cliPath, "comments", "check", "--format", "json"],
    { cwd: tmpdir(), encoding: "utf8" },
  );
  assert.equal(runtime.status, 3);
  const runtimePayload = JSON.parse(runtime.stderr) as {
    error: { code: string };
    exitCode: number;
  };
  assert.equal(runtimePayload.error.code, "analysis-failed");
  assert.equal(runtimePayload.exitCode, 3);
});

test("CLI version comes from package.json", () => {
  const result = spawnSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  });
  const packageManifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
  ) as { version: string };

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageManifest.version);
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
