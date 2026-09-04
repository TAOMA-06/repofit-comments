import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CONFIG_FILE_NAME,
  DEFAULT_CONFIG,
  printableConfig,
} from "../src/config.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function repository(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "repofit@example.invalid"]);
  git(root, ["config", "user.name", "RepoFit V1 Test"]);
  return root;
}

test("top-level init, print-config, and doctor form a complete offline setup loop", () => {
  const root = repository("repofit-v1-init-");
  try {
    const initialized = spawnSync(
      process.execPath,
      [cliPath, "init", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(initialized.status, 0, initialized.stderr);
    const initialization = JSON.parse(initialized.stdout) as {
      type: string;
      path: string;
    };
    assert.equal(initialization.type, "config-initialized");
    assert.equal(initialization.path.endsWith(`/${CONFIG_FILE_NAME}`), true);
    assert.doesNotThrow(() => JSON.parse(readFileSync(initialization.path, "utf8")));

    const printed = spawnSync(
      process.execPath,
      [cliPath, "check", "--print-config", "--no-color"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(JSON.parse(printed.stdout).schemaVersion, "1.0");

    const doctor = spawnSync(
      process.execPath,
      [cliPath, "doctor", "--format", "json", "--no-color"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout) as {
      type: string;
      configuration: { source: string };
      capabilities: { readOnlyAnalysis: boolean; automaticWrites: boolean };
    };
    assert.equal(report.type, "doctor");
    assert.equal(report.configuration.source, "repository");
    assert.equal(report.capabilities.readOnlyAnalysis, true);
    assert.equal(report.capabilities.automaticWrites, process.platform !== "win32");

    const repeated = spawnSync(process.execPath, [cliPath, "init"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(repeated.status, 5);
    assert.match(repeated.stderr, /refused to overwrite/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository configuration controls paths, protection, rule level, and fail threshold", () => {
  const root = repository("repofit-v1-config-integration-");
  try {
    const source = join(root, "source.ts");
    const ignored = join(root, "ignored.ts");
    const baseline = [
      "export function answer(): number {",
      "  return 42;",
      "}",
      "",
    ].join("\n");
    writeFileSync(source, baseline);
    writeFileSync(ignored, baseline);
    git(root, ["add", "source.ts", "ignored.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    writeFileSync(source, baseline.replace("  return 42;", "  // Step 1\n  return 42;"));
    writeFileSync(ignored, baseline.replace("  return 42;", "  // Step 2\n  return 42;"));

    const config = printableConfig(DEFAULT_CONFIG);
    (config.exclude as string[]).push("ignored.ts");
    (config.protect.phrases as string[]).push("Step 1");
    writeFileSync(join(root, CONFIG_FILE_NAME), `${JSON.stringify(config, null, 2)}\n`);
    const protectedRun = spawnSync(
      process.execPath,
      [cliPath, "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(protectedRun.status, 0, protectedRun.stderr);
    const protectedReport = JSON.parse(protectedRun.stdout) as {
      findings: unknown[];
      protections: Array<{ reason: string; relativePath: string }>;
      files: Array<{ relativePath: string }>;
    };
    assert.deepEqual(protectedReport.findings, []);
    assert.deepEqual(protectedReport.files.map((file) => file.relativePath), ["source.ts"]);
    assert.match(protectedReport.protections[0]?.reason ?? "", /configured protected phrase/);

    const informationalConfig = {
      ...config,
      protect: { ...config.protect, phrases: [] },
      rules: { ...config.rules, "comments.step-label": "info" },
      failOn: "error",
      display: { language: "zh", format: "terminal" },
    };
    writeFileSync(
      join(root, CONFIG_FILE_NAME),
      `${JSON.stringify(informationalConfig, null, 2)}\n`,
    );
    const informational = spawnSync(
      process.execPath,
      [cliPath, "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(informational.status, 0, informational.stderr);
    const informationalReport = JSON.parse(informational.stdout) as {
      findings: Array<{ level: string; relativePath: string }>;
    };
    assert.equal(informationalReport.findings.length, 1);
    assert.equal(informationalReport.findings[0]?.level, "info");
    assert.equal(informationalReport.findings[0]?.relativePath, "source.ts");
    const chinese = spawnSync(process.execPath, [cliPath, "check", "--worktree"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(chinese.status, 0, chinese.stderr);
    assert.match(chinese.stdout, /已分析文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI emits deterministic SARIF and a real patch accepted by git apply --check", () => {
  const root = repository("repofit-v1-output-");
  try {
    const relativePath = "src value.ts";
    const path = join(root, relativePath);
    const baseline = [
      "export function value(): number {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", relativePath]);
    git(root, ["commit", "-qm", "baseline"]);
    writeFileSync(path, baseline.replace("  return 1;", "  // Main Logic\n  return 1;"));

    const sarifRun = spawnSync(
      process.execPath,
      [cliPath, "check", "--worktree", "--format", "sarif"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(sarifRun.status, 1, sarifRun.stderr);
    const sarif = JSON.parse(sarifRun.stdout) as {
      version: string;
      runs: Array<{ results: Array<{ partialFingerprints: object }> }>;
    };
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results.length, 1);

    const preview = spawnSync(
      process.execPath,
      [cliPath, "preview", "--worktree", "--no-color"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(preview.status, 1, preview.stderr);
    const patch = preview.stdout.split("\nPatches:\n")[1];
    assert.ok(patch);
    const patchPath = join(root, "repofit.patch");
    writeFileSync(patchPath, patch);
    assert.doesNotThrow(() =>
      execFileSync("git", ["apply", "--check", patchPath], {
        cwd: root,
        stdio: "pipe",
      }),
    );
    const gitDirectory = git(root, ["rev-parse", "--absolute-git-dir"]).trim();
    assert.equal(existsSync(join(gitDirectory, "repofit-comments")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("top-level history list and prune expose a dry-run-first retention workflow", {
  skip: process.platform === "win32",
}, () => {
  const root = repository("repofit-v1-history-cli-");
  try {
    const path = join(root, "sample.ts");
    const baseline = [
      "export function value(): number {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const changed = baseline.replace("  return 1;", "  // Main Logic\n  return 1;");
    writeFileSync(path, baseline);
    git(root, ["add", "sample.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    writeFileSync(path, changed);

    for (let index = 0; index < 2; index += 1) {
      const checked = spawnSync(
        process.execPath,
        [cliPath, "check", "--worktree", "--format", "json"],
        { cwd: root, encoding: "utf8" },
      );
      const findingId = (JSON.parse(checked.stdout) as { findings: Array<{ id: string }> })
        .findings[0]?.id;
      assert.ok(findingId);
      assert.equal(
        spawnSync(
          process.execPath,
          [cliPath, "fix", findingId, "--worktree", "--apply"],
          { cwd: root, encoding: "utf8" },
        ).status,
        0,
      );
      assert.equal(
        spawnSync(process.execPath, [cliPath, "undo"], {
          cwd: root,
          encoding: "utf8",
        }).status,
        0,
      );
    }

    const listed = spawnSync(
      process.execPath,
      [cliPath, "history", "list", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal((JSON.parse(listed.stdout) as { entries: unknown[] }).entries.length, 2);
    const dryRun = spawnSync(
      process.execPath,
      [cliPath, "history", "prune", "--keep", "1", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal((JSON.parse(dryRun.stdout) as { applied: boolean }).applied, false);
    const applied = spawnSync(
      process.execPath,
      [
        cliPath,
        "history",
        "prune",
        "--keep",
        "1",
        "--apply",
        "--format",
        "json",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal((JSON.parse(applied.stdout) as { applied: boolean }).applied, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("analysis limits fail before rule evaluation and never create recovery state", () => {
  const root = repository("repofit-v1-limits-");
  try {
    for (const name of ["one.ts", "two.ts"]) {
      writeFileSync(join(root, name), "export const value = 1;\n");
    }
    git(root, ["add", "one.ts", "two.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    for (const name of ["one.ts", "two.ts"]) {
      writeFileSync(join(root, name), "// Step 1\nexport const value = 2;\n");
    }
    const config = {
      ...printableConfig(DEFAULT_CONFIG),
      limits: { ...DEFAULT_CONFIG.limits, maxFiles: 1 },
    };
    writeFileSync(join(root, CONFIG_FILE_NAME), `${JSON.stringify(config)}\n`);
    const result = spawnSync(
      process.execPath,
      [cliPath, "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 3);
    assert.match(result.stderr, /maxFiles=1/);
    const gitDirectory = git(root, ["rev-parse", "--absolute-git-dir"]).trim();
    assert.equal(existsSync(join(gitDirectory, "repofit-comments")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unified preview applies to a CRLF file without a final newline", () => {
  const root = repository("repofit-v1-crlf-preview-");
  try {
    const path = join(root, "crlf.ts");
    const baseline = "export function value(): number {\r\n  return 1;\r\n}";
    const changed = baseline.replace("  return 1;", "  // Main Logic\r\n  return 1;");
    writeFileSync(path, baseline);
    git(root, ["add", "crlf.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    writeFileSync(path, changed);

    const preview = spawnSync(
      process.execPath,
      [cliPath, "preview", "--worktree"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(preview.status, 1, preview.stderr);
    const patch = preview.stdout.split("\nPatches:\n")[1];
    assert.ok(patch);
    const patchPath = join(root, "crlf.patch");
    writeFileSync(patchPath, patch);
    assert.doesNotThrow(() =>
      execFileSync("git", ["apply", "--check", "--ignore-space-change", patchPath], {
        cwd: root,
        stdio: "pipe",
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unchanged reasoned suppression controls a newly added comment", () => {
  const root = repository("repofit-v1-suppression-");
  try {
    const path = join(root, "suppressed.ts");
    const baseline = [
      "export function value(): number {",
      "  // repofit-ignore-next-line comments.step-label -- external protocol uses numbered phases",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    writeFileSync(path, baseline);
    git(root, ["add", "suppressed.ts"]);
    git(root, ["commit", "-qm", "baseline suppression"]);
    writeFileSync(
      path,
      baseline.replace("  return 1;", "  // Step 1\n  return 1;"),
    );

    const result = spawnSync(
      process.execPath,
      [cliPath, "check", "--worktree", "--format", "json"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      findings: unknown[];
      suppressions: Array<{ directiveLine: number; targetLine: number }>;
    };
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.suppressions, [{
      relativePath: "suppressed.ts",
      directiveLine: 2,
      targetLine: 3,
      ruleId: "comments.step-label",
      reason: "external protocol uses numbered phases",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
