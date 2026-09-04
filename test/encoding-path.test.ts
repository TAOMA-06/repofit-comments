import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeRepository } from "../src/analysis.js";
import { readWorkingTreeContent } from "../src/git.js";
import { applyFinding, verifyLastFix } from "../src/patch.js";

const writeTest = process.platform === "win32" ? test.skip : test;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function createRepository(prefix: string): { root: string; path: string; baseline: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "repofit@example.invalid"]);
  git(root, ["config", "user.name", "RepoFit Test"]);
  const path = join(root, "sample.ts");
  const baseline = [
    "export function answer(): number {",
    "  return 42;",
    "}",
    "",
  ].join("\n");
  writeFileSync(path, baseline);
  git(root, ["add", "sample.ts"]);
  git(root, ["commit", "-qm", "baseline"]);
  return { root, path, baseline };
}

test("worktree analysis refuses invalid UTF-8 bytes", () => {
  const fixture = createRepository("repofit-invalid-utf8-worktree-");
  try {
    const prefix = Buffer.from(fixture.baseline.replace("  return 42;", "  // Step 1\n  return "));
    writeFileSync(fixture.path, Buffer.concat([prefix, Buffer.from([0xff]), Buffer.from(";") ]));

    assert.throws(
      () => analyzeRepository(fixture.root, { kind: "worktree" }),
      /not valid UTF-8/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("staged analysis refuses invalid UTF-8 blobs", () => {
  const fixture = createRepository("repofit-invalid-utf8-index-");
  try {
    writeFileSync(
      fixture.path,
      Buffer.concat([Buffer.from("// Step 1\nexport const value = "), Buffer.from([0xff])]),
    );
    git(fixture.root, ["add", "sample.ts"]);

    assert.throws(
      () => analyzeRepository(fixture.root, { kind: "staged" }),
      /not valid UTF-8/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a UTF-8 BOM survives a verified automatic fix byte for byte", () => {
  const fixture = createRepository("repofit-utf8-bom-");
  try {
    const changed = `\uFEFF${fixture.baseline.replace("  return 42;", "  // Main Logic\n  return 42;")}`;
    writeFileSync(fixture.path, changed, "utf8");
    const report = analyzeRepository(fixture.root, { kind: "worktree" });
    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "comments.decorative-heading",
    );
    assert.ok(finding);

    applyFinding(fixture.root, finding, { kind: "worktree" });
    const bytes = readFileSync(fixture.path);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.doesNotMatch(bytes.toString("utf8"), /Main Logic/);
    assert.equal(verifyLastFix(fixture.root).valid, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("working-tree reads refuse a parent symlink or junction that escapes the repository", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-parent-link-root-"));
  const outside = mkdtempSync(join(tmpdir(), "repofit-parent-link-outside-"));
  try {
    writeFileSync(join(outside, "escape.ts"), "export const escaped = true;\n");
    mkdirSync(join(root, "inside"));
    symlinkSync(
      outside,
      join(root, "inside", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.throws(
      () => readWorkingTreeContent(root, "inside/linked/escape.ts"),
      /parent resolves outside repository/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
