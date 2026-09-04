import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { analyzeRepository } from "../src/analysis.js";
import { sha256 } from "../src/hash.js";
import {
  applyFinding,
  recoverLastFix,
  undoLastFix,
  verifyLastFix,
} from "../src/patch.js";
import {
  MAX_BACKUP_BYTES_PER_FILE,
  MAX_RECOVERY_RECORDS,
} from "../src/receipt-store.js";

const writeTest = process.platform === "win32" ? test.skip : test;

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function createFixture(prefix: string): {
  root: string;
  path: string;
  changed: string;
  finding: ReturnType<typeof analyzeRepository>["findings"][number];
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "repofit@example.invalid"]);
  git(root, ["config", "user.name", "RepoFit Test"]);
  const path = join(root, "sample.ts");
  const baseline = [
    "export function answer(): number {",
    "  const value = 42;",
    "  return value;",
    "}",
    "",
  ].join("\n");
  writeFileSync(path, baseline);
  git(root, ["add", "sample.ts"]);
  git(root, ["commit", "-qm", "baseline"]);
  const changed = baseline.replace("  return value;", "  // Main Logic\n  return value;");
  writeFileSync(path, changed);
  const finding = analyzeRepository(root, { kind: "worktree" }).findings[0];
  assert.ok(finding);
  return { root, path, changed, finding };
}

function schema2ReceiptFor(fixture: ReturnType<typeof createFixture>) {
  return {
    schemaVersion: "2.0",
    findingIds: [fixture.finding.id],
    relativePath: fixture.finding.relativePath,
    analysisScope: { kind: "worktree" },
    writeTarget: "worktree",
    appliedAt: "2026-09-03T00:00:00.000Z",
    beforeFileHash: fixture.finding.sourceHash,
    afterFileHash: fixture.finding.sourceHash,
    nonCommentTokenHash: "0".repeat(64),
    syntaxTreeHash: "0".repeat(64),
    protectedCommentHash: "0".repeat(64),
  };
}

writeTest("applied fixes create private history and undo restores exact bytes and mode", () => {
  const fixture = createFixture("repofit-journal-undo-");
  try {
    chmodSync(fixture.path, 0o744);
    const before = readFileSync(fixture.path);
    const mode = statSync(fixture.path).mode & 0o777;
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });

    assert.equal(receipt.status, "applied");
    assert.equal(statSync(fixture.path).mode & 0o777, mode);
    assert.equal(verifyLastFix(fixture.root).valid, true);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const historyPath = join(
      gitDirectory,
      "repofit-comments",
      "receipts",
      `${receipt.receiptId}.json`,
    );
    const backupPath = join(
      gitDirectory,
      "repofit-comments",
      "backups",
      `${receipt.receiptId}.before`,
    );
    assert.equal(existsSync(historyPath), true);
    assert.equal(existsSync(backupPath), true);
    if (process.platform !== "win32") {
      assert.equal(statSync(historyPath).mode & 0o777, 0o600);
      assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    }

    const undone = undoLastFix(fixture.root);
    assert.equal(undone.status, "undone");
    assert.deepEqual(readFileSync(fixture.path), before);
    assert.equal(statSync(fixture.path).mode & 0o777, mode);
    assert.equal(verifyLastFix(fixture.root).valid, false);
    assert.throws(() => undoLastFix(fixture.root), /already been undone/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a failure after journaling leaves the original source unchanged", () => {
  const fixture = createFixture("repofit-journal-before-write-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-journal",
        }),
      /Injected failure/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
    assert.equal(verifyLastFix(fixture.root).valid, false);
    assert.throws(() => undoLastFix(fixture.root), /run recover/);
    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "aborted");
    assert.equal(recovered.recoveryAction, "mark-aborted");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a prepared journal can undo a source replacement after an interrupted apply", () => {
  const fixture = createFixture("repofit-journal-after-write-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-source-write",
        }),
      /Injected failure/,
    );
    assert.doesNotMatch(readFileSync(fixture.path, "utf8"), /Main Logic/);
    const verification = verifyLastFix(fixture.root);
    assert.equal(verification.valid, false);
    assert.equal(verification.receipt.status, "prepared");

    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "applied");
    assert.equal(recovered.recoveryAction, "mark-applied");
    assert.equal(verifyLastFix(fixture.root).valid, true);
    assert.equal(undoLastFix(fixture.root).status, "undone");
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("recover restores a source displaced by an interrupted apply", () => {
  const fixture = createFixture("repofit-journal-apply-displaced-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-source-displaced",
        }),
      /Injected failure/,
    );
    assert.equal(existsSync(fixture.path), false);

    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "aborted");
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("recover reports a missing source while preserving its private backup", () => {
  const fixture = createFixture("repofit-journal-missing-source-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-journal",
        }),
      /Injected failure/,
    );
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const latest = JSON.parse(
      readFileSync(join(gitDirectory, "repofit-comments", "last-fix.json"), "utf8"),
    ) as { receiptId: string };
    rmSync(fixture.path);

    assert.throws(() => recoverLastFix(fixture.root), /private backup was preserved/);
    assert.equal(
      existsSync(
        join(gitDirectory, "repofit-comments", "backups", `${latest.receiptId}.before`),
      ),
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("recover finalizes an apply interrupted after candidate installation", () => {
  const fixture = createFixture("repofit-journal-apply-installed-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-candidate-installed",
        }),
      /Injected failure/,
    );
    assert.doesNotMatch(readFileSync(fixture.path, "utf8"), /Main Logic/);

    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "applied");
    assert.equal(verifyLastFix(fixture.root).valid, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("an interrupted undo is finalized deterministically on retry", () => {
  const fixture = createFixture("repofit-journal-undo-recovery-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    assert.throws(
      () => undoLastFix(fixture.root, { faultStage: "after-undo-write" }),
      /Injected failure/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
    assert.equal(verifyLastFix(fixture.root).valid, false);

    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "undone");
    assert.equal(recovered.recoveryAction, "mark-undone");
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("an undo interrupted after journaling safely resumes on retry", () => {
  const fixture = createFixture("repofit-journal-undo-before-write-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const repaired = readFileSync(fixture.path, "utf8");
    assert.throws(
      () => undoLastFix(fixture.root, { faultStage: "after-undo-journal" }),
      /Injected failure/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), repaired);

    const recoveredApply = recoverLastFix(fixture.root);
    assert.equal(recoveredApply.status, "applied");
    assert.equal(recoveredApply.recoveryAction, "mark-applied");
    const recoveredUndo = undoLastFix(fixture.root);
    assert.equal(recoveredUndo.status, "undone");
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("recover restores a source displaced by an interrupted undo", () => {
  const fixture = createFixture("repofit-journal-undo-displaced-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    assert.throws(
      () => undoLastFix(fixture.root, { faultStage: "after-source-displaced" }),
      /Injected failure/,
    );
    assert.equal(existsSync(fixture.path), false);

    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "applied");
    assert.doesNotMatch(readFileSync(fixture.path, "utf8"), /Main Logic/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("recover finalizes an undo interrupted after original installation", () => {
  const fixture = createFixture("repofit-journal-undo-installed-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    assert.throws(
      () => undoLastFix(fixture.root, { faultStage: "after-candidate-installed" }),
      /Injected failure/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);

    const recovered = recoverLastFix(fixture.root);
    assert.equal(recovered.status, "undone");
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("undo refuses to overwrite a newer working-tree edit", () => {
  const fixture = createFixture("repofit-journal-newer-edit-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const newer = `${readFileSync(fixture.path, "utf8")}\n// user edit\n`;
    writeFileSync(fixture.path, newer);

    assert.throws(() => undoLastFix(fixture.root), /protect newer edits/);
    assert.equal(readFileSync(fixture.path, "utf8"), newer);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("apply captures and preserves an edit made immediately before replacement", () => {
  const fixture = createFixture("repofit-journal-apply-race-");
  try {
    const newer = `${fixture.changed}\n// user edit during apply\n`;
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          beforeSourceReplacement: () => writeFileSync(fixture.path, newer),
        }),
      /changed at replacement time/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), newer);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("undo captures and preserves an edit made immediately before restoration", () => {
  const fixture = createFixture("repofit-journal-undo-race-");
  try {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const newer = `${readFileSync(fixture.path, "utf8")}\n// user edit during undo\n`;
    assert.throws(
      () =>
        undoLastFix(fixture.root, {
          beforeUndoReplacement: () => writeFileSync(fixture.path, newer),
        }),
      /changed at replacement time/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), newer);
    assert.equal(receipt.status, "applied");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a repository-wide operation lock blocks a second writer without changing source", () => {
  const fixture = createFixture("repofit-journal-lock-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    undoLastFix(fixture.root);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const lockPath = join(
      gitDirectory,
      "repofit-comments",
      "locks",
      "operation.lock",
    );
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        operationId: randomUUID(),
        relativePath: "sample.ts",
        pid: process.pid,
        startedAt: new Date().toISOString(),
      })}\n`,
      { mode: 0o600 },
    );

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /holds the global write lock/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("automatic replacement refuses a source with multiple hard links", () => {
  const fixture = createFixture("repofit-journal-hardlink-");
  try {
    const aliasPath = join(fixture.root, "alias.ts");
    linkSync(fixture.path, aliasPath);

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /multiple hard links/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
    assert.equal(readFileSync(aliasPath, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("automatic replacement respects a read-only source file", { skip: process.platform === "win32" }, () => {
  const fixture = createFixture("repofit-journal-readonly-");
  try {
    chmodSync(fixture.path, 0o444);

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /without owner-write permission/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    chmodSync(fixture.path, 0o644);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a lock whose owner process no longer exists is recovered once", () => {
  const fixture = createFixture("repofit-journal-stale-lock-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    undoLastFix(fixture.root);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const lockPath = join(
      gitDirectory,
      "repofit-comments",
      "locks",
      "operation.lock",
    );
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        operationId: randomUUID(),
        relativePath: "sample.ts",
        pid: 2_147_483_647,
        startedAt: "2000-01-01T00:00:00.000Z",
      })}\n`,
      { mode: 0o600 },
    );

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /holds the global write lock/,
    );
    assert.throws(() => recoverLastFix(fixture.root), /does not need recovery/);
    assert.equal(existsSync(lockPath), false);
    const reapplied = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    assert.equal(reapplied.status, "applied");
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("undo refuses a tampered backup", () => {
  const fixture = createFixture("repofit-journal-tampered-backup-");
  try {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const backupPath = join(
      gitDirectory,
      "repofit-comments",
      "backups",
      `${receipt.receiptId}.before`,
    );
    const applied = readFileSync(fixture.path);
    writeFileSync(backupPath, "tampered");

    assert.throws(() => undoLastFix(fixture.root), /Backup hash mismatch/);
    assert.deepEqual(readFileSync(fixture.path), applied);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("receipt validation rejects a tampered receipt identifier before path construction", () => {
  const fixture = createFixture("repofit-journal-tampered-receipt-");
  try {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const historyPath = join(
      gitDirectory,
      "repofit-comments",
      "receipts",
      `${receipt.receiptId}.json`,
    );
    const payload = JSON.parse(readFileSync(historyPath, "utf8")) as Record<string, unknown>;
    payload.receiptId = "../../outside";
    writeFileSync(historyPath, `${JSON.stringify(payload)}\n`);

    assert.throws(() => undoLastFix(fixture.root), /Malformed fix receipt/);
    assert.equal(existsSync(join(gitDirectory, "outside.json")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("receipt decoder rejects unknown fields, non-canonical paths, and mixed states", () => {
  const fixture = createFixture("repofit-journal-strict-schema-");
  try {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const historyPath = join(
      gitDirectory,
      "repofit-comments",
      "receipts",
      `${receipt.receiptId}.json`,
    );
    const original = JSON.parse(readFileSync(historyPath, "utf8")) as Record<string, unknown>;
    const mutations: Array<Record<string, unknown>> = [
      { ...original, injected: "must-not-be-echoed" },
      { ...original, relativePath: "../outside.ts" },
      { ...original, undoneAt: new Date().toISOString() },
    ];

    for (const mutation of mutations) {
      writeFileSync(historyPath, `${JSON.stringify(mutation)}\n`);
      assert.throws(() => verifyLastFix(fixture.root), /receipt/i);
    }
    writeFileSync(historyPath, `${JSON.stringify(original)}\n`);
    assert.equal(verifyLastFix(fixture.root).valid, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("repository identity prevents a receipt from being replayed in another identity", () => {
  const fixture = createFixture("repofit-journal-repository-id-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const applied = readFileSync(fixture.path);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    writeFileSync(
      join(gitDirectory, "repofit-comments", "repository-id"),
      `${randomUUID()}\n`,
    );

    assert.throws(() => undoLastFix(fixture.root), /Malformed fix receipt/);
    assert.deepEqual(readFileSync(fixture.path), applied);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a corrupted non-current history entry cannot hijack the latest receipt", () => {
  const fixture = createFixture("repofit-journal-history-isolation-");
  try {
    const first = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    undoLastFix(fixture.root);
    const second = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    writeFileSync(
      join(
        gitDirectory,
        "repofit-comments",
        "receipts",
        `${first.receiptId}.json`,
      ),
      "not-json\n",
    );

    const verification = verifyLastFix(fixture.root);
    assert.equal(verification.valid, true, verification.reasons.join(" "));
    assert.equal(verification.receipt.receiptId, second.receiptId);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("coordinated receipt and backup tampering cannot restore different code tokens", () => {
  const fixture = createFixture("repofit-journal-coordinated-tamper-");
  try {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const applied = readFileSync(fixture.path);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const historyPath = join(
      gitDirectory,
      "repofit-comments",
      "receipts",
      `${receipt.receiptId}.json`,
    );
    const backupPath = join(
      gitDirectory,
      "repofit-comments",
      "backups",
      `${receipt.receiptId}.before`,
    );
    const malicious = fixture.changed.replace("42", "99");
    writeFileSync(backupPath, malicious);
    const payload = JSON.parse(readFileSync(historyPath, "utf8")) as Record<string, unknown>;
    payload.beforeFileHash = sha256(Buffer.from(malicious));
    writeFileSync(historyPath, `${JSON.stringify(payload)}\n`);

    assert.throws(() => undoLastFix(fixture.root), /not semantically reversible/);
    assert.deepEqual(readFileSync(fixture.path), applied);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("unsafe receipt directory permissions are rejected", { skip: process.platform === "win32" }, () => {
  const fixture = createFixture("repofit-journal-permissions-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const dataDirectory = join(gitDirectory, "repofit-comments");
    chmodSync(dataDirectory, 0o777);

    assert.throws(() => undoLastFix(fixture.root), /group\/other-accessible/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a schema 2 Alpha store is tightened and archived before the next recoverable fix", () => {
  const fixture = createFixture("repofit-journal-schema2-migration-");
  try {
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const dataDirectory = join(gitDirectory, "repofit-comments");
    mkdirSync(dataDirectory, { mode: 0o755 });
    const legacyReceipt = schema2ReceiptFor(fixture);
    writeFileSync(
      join(dataDirectory, "last-fix.json"),
      `${JSON.stringify(legacyReceipt, null, 2)}\n`,
      { mode: 0o600 },
    );

    assert.throws(() => verifyLastFix(fixture.root), /legacy schema 2/);
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    assert.equal(receipt.status, "applied");
    const archived = readdirSync(join(dataDirectory, "legacy"));
    assert.equal(archived.length, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(join(dataDirectory, "legacy", archived[0] as string), "utf8")),
      legacyReceipt,
    );
    if (process.platform !== "win32") {
      assert.equal(statSync(dataDirectory).mode & 0o777, 0o700);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("schema 2 migration resumes after identity creation without losing the legacy receipt", () => {
  const fixture = createFixture("repofit-journal-schema2-resume-");
  try {
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const dataDirectory = join(gitDirectory, "repofit-comments");
    const legacyDirectory = join(dataDirectory, "legacy");
    mkdirSync(dataDirectory, { mode: 0o700 });
    mkdirSync(legacyDirectory, { mode: 0o700 });
    const legacyReceipt = schema2ReceiptFor(fixture);
    const legacyBytes = Buffer.from(`${JSON.stringify(legacyReceipt, null, 2)}\n`, "utf8");
    writeFileSync(join(dataDirectory, "last-fix.json"), legacyBytes, { mode: 0o600 });
    writeFileSync(join(dataDirectory, "repository-id"), `${randomUUID()}\n`, {
      mode: 0o600,
    });
    writeFileSync(
      join(legacyDirectory, `last-fix-v2-${sha256(legacyBytes)}.json`),
      legacyBytes,
      { mode: 0o600 },
    );

    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    assert.equal(receipt.status, "applied");
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(legacyDirectory, `last-fix-v2-${sha256(legacyBytes)}.json`),
          "utf8",
        ),
      ),
      legacyReceipt,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("an unrecognized pre-identity receipt is preserved and blocks migration", () => {
  const fixture = createFixture("repofit-journal-invalid-legacy-");
  try {
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const dataDirectory = join(gitDirectory, "repofit-comments");
    const latestPath = join(dataDirectory, "last-fix.json");
    mkdirSync(dataDirectory, { mode: 0o755 });
    const invalidState = Buffer.from('{"schemaVersion":"future"}\n', "utf8");
    writeFileSync(latestPath, invalidState, { mode: 0o600 });

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /neither a valid schema 2 receipt nor a repository-bound schema 3 store/,
    );
    assert.deepEqual(readFileSync(latestPath), invalidState);
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a non-terminal journal must be recovered before another fix can start", () => {
  const fixture = createFixture("repofit-journal-nonterminal-guard-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-journal",
        }),
      /Injected failure/,
    );
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const latestPath = join(gitDirectory, "repofit-comments", "last-fix.json");
    const beforeRetry = readFileSync(latestPath);

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /run recover before applying another fix/,
    );
    assert.deepEqual(readFileSync(latestPath), beforeRetry);
    const receipts = join(gitDirectory, "repofit-comments", "receipts");
    for (let index = 1; index < MAX_RECOVERY_RECORDS; index += 1) {
      writeFileSync(join(receipts, `filled-after-journal-${index}.json`), "{}\n", {
        mode: 0o600,
      });
    }
    assert.equal(recoverLastFix(fixture.root).status, "aborted");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("receipt storage rejects invalid UTF-8 instead of replacing bytes", () => {
  const fixture = createFixture("repofit-journal-invalid-utf8-");
  try {
    const receipt = applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const applied = readFileSync(fixture.path);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const historyPath = join(
      gitDirectory,
      "repofit-comments",
      "receipts",
      `${receipt.receiptId}.json`,
    );
    writeFileSync(historyPath, Buffer.from([0xff]));

    assert.throws(() => verifyLastFix(fixture.root), /not valid UTF-8/);
    assert.deepEqual(readFileSync(fixture.path), applied);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("automatic fixes refuse a backup larger than the per-file recovery limit", () => {
  const fixture = createFixture("repofit-journal-backup-limit-");
  try {
    const oversized = `${fixture.changed}${" ".repeat(MAX_BACKUP_BYTES_PER_FILE)}`;
    writeFileSync(fixture.path, oversized);
    const finding = { ...fixture.finding, sourceHash: sha256(oversized) };

    assert.throws(
      () => applyFinding(fixture.root, finding, { kind: "worktree" }),
      /per-file limit/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), oversized);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("automatic fixes fail closed when recovery history reaches its record limit", () => {
  const fixture = createFixture("repofit-journal-record-limit-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    undoLastFix(fixture.root);
    const gitDirectory = git(fixture.root, ["rev-parse", "--absolute-git-dir"]).trim();
    const receipts = join(gitDirectory, "repofit-comments", "receipts");
    for (let index = 1; index < MAX_RECOVERY_RECORDS; index += 1) {
      writeFileSync(join(receipts, `capacity-${index}.json`), "{}\n", { mode: 0o600 });
    }

    assert.throws(
      () => applyFinding(fixture.root, fixture.finding, { kind: "worktree" }),
      /recovery history reached/,
    );
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("a persistent mode mismatch is not mislabeled as a verification-time race", { skip: process.platform === "win32" }, () => {
  const fixture = createFixture("repofit-verify-mode-label-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    chmodSync(fixture.path, 0o600);

    const verification = verifyLastFix(fixture.root);
    assert.equal(verification.valid, false);
    assert.ok(
      verification.reasons.includes(
        "The working-tree file mode differs from the applied fix receipt.",
      ),
    );
    assert.equal(
      verification.reasons.includes(
        "The working-tree file mode changed during verification.",
      ),
      false,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("undo is one-level and does not skip an aborted latest journal", () => {
  const fixture = createFixture("repofit-undo-one-level-");
  try {
    applyFinding(fixture.root, fixture.finding, { kind: "worktree" });
    const firstAppliedBytes = readFileSync(fixture.path, "utf8");
    const secondPath = join(fixture.root, "second.ts");
    const secondBaseline = [
      "export function second(): number {",
      "  return 2;",
      "}",
      "",
    ].join("\n");
    writeFileSync(secondPath, secondBaseline);
    git(fixture.root, ["add", "second.ts"]);
    git(fixture.root, ["commit", "-qm", "add second baseline", "--", "second.ts"]);
    writeFileSync(
      secondPath,
      secondBaseline.replace("  return 2;", "  // Main Logic\n  return 2;"),
    );
    const secondFinding = analyzeRepository(fixture.root, { kind: "worktree" }).findings.find(
      (finding) => finding.relativePath === "second.ts",
    );
    assert.ok(secondFinding);

    assert.throws(
      () =>
        applyFinding(fixture.root, secondFinding, { kind: "worktree" }, {
          faultStage: "after-journal",
        }),
      /Injected failure/,
    );
    assert.equal(recoverLastFix(fixture.root).status, "aborted");
    assert.throws(() => undoLastFix(fixture.root), /was aborted/);
    assert.equal(readFileSync(fixture.path, "utf8"), firstAppliedBytes);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("CLI undo restores the worktree without changing a staged repaired blob", () => {
  const fixture = createFixture("repofit-cli-undo-");
  try {
    const applied = spawnSync(
      process.execPath,
      [cliPath, "comments", "fix", fixture.finding.id, "--worktree", "--apply"],
      { cwd: fixture.root, encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    const repaired = readFileSync(fixture.path, "utf8");
    assert.doesNotMatch(repaired, /Main Logic/);
    git(fixture.root, ["add", "sample.ts"]);

    const undone = spawnSync(process.execPath, [cliPath, "comments", "undo"], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(undone.status, 0, undone.stderr);
    assert.match(undone.stdout, /The Git index was not changed/);
    assert.equal(readFileSync(fixture.path, "utf8"), fixture.changed);
    assert.equal(git(fixture.root, ["show", ":sample.ts"]), repaired);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("CLI recover explicitly finalizes an interrupted apply before verification", () => {
  const fixture = createFixture("repofit-cli-recover-");
  try {
    assert.throws(
      () =>
        applyFinding(fixture.root, fixture.finding, { kind: "worktree" }, {
          faultStage: "after-source-write",
        }),
      /Injected failure/,
    );
    const beforeRecovery = verifyLastFix(fixture.root);
    assert.equal(beforeRecovery.valid, false);

    const recovered = spawnSync(process.execPath, [cliPath, "comments", "recover"], {
      cwd: fixture.root,
      encoding: "utf8",
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /as applied \(mark-applied\)/);
    assert.equal(verifyLastFix(fixture.root).valid, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

writeTest("verification fails when another RepoFit write changes the latest receipt", () => {
  const fixture = createFixture("repofit-verify-snapshot-");
  try {
    const secondPath = join(fixture.root, "second.ts");
    const secondBaseline = [
      "export function second(): number {",
      "  const value = 2;",
      "  return value;",
      "}",
      "",
    ].join("\n");
    writeFileSync(secondPath, secondBaseline);
    git(fixture.root, ["add", "second.ts"]);
    git(fixture.root, ["commit", "-qm", "add second baseline", "--", "second.ts"]);
    writeFileSync(
      secondPath,
      secondBaseline.replace("  return value;", "  // Main Logic\n  return value;"),
    );
    const report = analyzeRepository(fixture.root, { kind: "worktree" });
    const firstFinding = report.findings.find(
      (finding) => finding.relativePath === "sample.ts",
    );
    const secondFinding = report.findings.find(
      (finding) => finding.relativePath === "second.ts",
    );
    assert.ok(firstFinding);
    assert.ok(secondFinding);
    applyFinding(fixture.root, firstFinding, { kind: "worktree" });

    const racedVerification = verifyLastFix(fixture.root, "worktree", {
      afterReceiptRead: () =>
        applyFinding(fixture.root, secondFinding, { kind: "worktree" }),
    });
    assert.equal(racedVerification.valid, false);
    assert.ok(
      racedVerification.reasons.includes(
        "The latest fix receipt changed during verification.",
      ),
    );
    assert.equal(verifyLastFix(fixture.root).valid, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
