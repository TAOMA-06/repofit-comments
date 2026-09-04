import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeRepository } from "../src/analysis.js";
import { listFixHistory, pruneFixHistory } from "../src/history.js";
import { applyFinding, undoLastFix } from "../src/patch.js";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function createFixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "repofit@example.invalid"]);
  git(root, ["config", "user.name", "RepoFit History Test"]);
  const path = join(root, "sample.ts");
  const baseline = [
    "export function answer(): number {",
    "  return 42;",
    "}",
    "",
  ].join("\n");
  const changed = baseline.replace("  return 42;", "  // Main Logic\n  return 42;");
  writeFileSync(path, baseline);
  git(root, ["add", "sample.ts"]);
  git(root, ["commit", "-qm", "baseline"]);
  writeFileSync(path, changed);
  const finding = analyzeRepository(root, { kind: "worktree" }).findings[0];
  assert.ok(finding);
  return { root, path, changed, finding };
}

function createUndoneHistory(fixture: ReturnType<typeof createFixture>, count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    ids.push(receipt.receiptId);
    undoLastFix(fixture.root);
  }
  return ids;
}

test("history list and prune preserve the latest receipt and delete paired terminal records", {
  skip: process.platform === "win32",
}, () => {
  const fixture = createFixture("repofit-history-prune-");
  try {
    createUndoneHistory(fixture, 3);
    const before = listFixHistory(fixture.root);
    assert.equal(before.entries.length, 3);
    assert.equal(before.entries.filter((entry) => entry.latest).length, 1);
    assert.ok(before.entries.every((entry) => entry.backupPresent));

    const dryRun = pruneFixHistory(fixture.root, 1);
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.prunedReceiptIds.length, 2);
    assert.equal(listFixHistory(fixture.root).entries.length, 3);

    const applied = pruneFixHistory(fixture.root, 1, { apply: true });
    assert.equal(applied.applied, true);
    assert.equal(applied.prunedReceiptIds.length, 2);
    const after = listFixHistory(fixture.root);
    assert.equal(after.entries.length, 1);
    assert.equal(after.entries[0]?.latest, true);
    assert.equal(after.pendingPruneOperations, 0);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    assert.equal(readdirSync(join(gitDirectory, "repofit-comments", "receipts")).length, 1);
    assert.equal(readdirSync(join(gitDirectory, "repofit-comments", "backups")).length, 1);
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an interrupted prune resumes from its marker before pruning more history", {
  skip: process.platform === "win32",
}, () => {
  const fixture = createFixture("repofit-history-recovery-");
  try {
    createUndoneHistory(fixture, 3);
    assert.throws(
      () =>
        pruneFixHistory(fixture.root, 1, {
          apply: true,
          faultAfterReceiptStage: true,
        }),
      /Injected failure/,
    );
    assert.equal(listFixHistory(fixture.root).pendingPruneOperations, 1);
    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /interrupted history prune/,
    );

    const resumed = pruneFixHistory(fixture.root, 1, { apply: true });
    assert.equal(resumed.recoveredOperations.length, 1);
    const after = listFixHistory(fixture.root);
    assert.equal(after.entries.length, 1);
    assert.equal(after.pendingPruneOperations, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("history pruning never selects a non-terminal or latest journal", {
  skip: process.platform === "win32",
}, () => {
  const fixture = createFixture("repofit-history-nonterminal-");
  try {
    createUndoneHistory(fixture, 2);
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-journal",
        }),
      /Injected failure/,
    );
    const history = listFixHistory(fixture.root);
    const latest = history.entries.find((entry) => entry.latest);
    assert.equal(latest?.status, "prepared");
    const planned = pruneFixHistory(fixture.root, 1);
    assert.equal(planned.prunedReceiptIds.includes(history.latestReceiptId), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
