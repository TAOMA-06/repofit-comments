import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { AnalysisReport } from "../src/model.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function createChangedRepository(prefix: string, attributes?: string): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "repofit@example.invalid"]);
  git(root, ["config", "user.name", "RepoFit Test"]);

  if (attributes !== undefined) {
    writeFileSync(join(root, ".gitattributes"), attributes, "utf8");
  }

  const sourcePath = join(root, "sample.ts");
  const baseline = [
    "export function answer(): number {",
    "  return 42;",
    "}",
    "",
  ].join("\n");
  writeFileSync(sourcePath, baseline, "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  writeFileSync(
    sourcePath,
    baseline.replace("  return 42;", "  // Step 1\n  return 42;"),
    "utf8",
  );

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function gitShellCommand(executable: string, programPath: string): string {
  const portableExecutable = executable.replaceAll("\\", "/");
  const portableProgramPath = programPath.replaceAll("\\", "/");
  return `"${portableExecutable}" "${portableProgramPath}"`;
}

function createMarkerProgram(root: string, name: string): {
  markerPath: string;
  programPath: string;
  command: string;
} {
  const markerPath = join(root, `${name}.marker`);
  const programPath = join(root, `${name}.cjs`);
  writeFileSync(
    programPath,
    [
      "#!/usr/bin/env node",
      'const { existsSync, readFileSync, writeFileSync } = require("node:fs");',
      `writeFileSync(${JSON.stringify(markerPath)}, "executed", "utf8");`,
      "const inputPath = process.argv[2];",
      "if (inputPath && existsSync(inputPath)) process.stdout.write(readFileSync(inputPath));",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  chmodSync(programPath, 0o755);
  return {
    markerPath,
    programPath,
    command: gitShellCommand(process.execPath, programPath),
  };
}

function runWorktreeCheck(root: string, environment: NodeJS.ProcessEnv = process.env): AnalysisReport {
  const result = spawnSync(
    process.execPath,
    [cliPath, "comments", "check", "--worktree", "--format", "json"],
    { cwd: root, encoding: "utf8", env: environment },
  );
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as AnalysisReport;
  assert.ok(report.findings.some((finding) => finding.ruleId === "comments.step-label"));
  return report;
}

function proveUnhardenedDiffWouldRunMarker(
  root: string,
  markerPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync("git", ["diff", "--", "sample.ts"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(markerPath), true, "security fixture did not activate its marker");
  rmSync(markerPath, { force: true });
}

test("Git runner ignores inherited GIT_EXTERNAL_DIFF while normal analysis still works", () => {
  const fixture = createChangedRepository("repofit-git-external-env-");
  try {
    const marker = createMarkerProgram(fixture.root, "environment-external-diff");
    const hostileEnvironment = {
      ...process.env,
      GIT_EXTERNAL_DIFF: marker.command,
    };
    proveUnhardenedDiffWouldRunMarker(fixture.root, marker.markerPath, hostileEnvironment);
    runWorktreeCheck(fixture.root, hostileEnvironment);
    assert.equal(existsSync(marker.markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("Git runner disables a repository-configured external diff command", () => {
  const fixture = createChangedRepository("repofit-git-external-config-");
  try {
    const marker = createMarkerProgram(fixture.root, "configured-external-diff");
    git(fixture.root, ["config", "diff.external", marker.command]);
    proveUnhardenedDiffWouldRunMarker(fixture.root, marker.markerPath);
    runWorktreeCheck(fixture.root);
    assert.equal(existsSync(marker.markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("Git runner disables an attribute-selected external diff driver", () => {
  const fixture = createChangedRepository(
    "repofit-git-driver-config-",
    "*.ts diff=repofit-command\n",
  );
  try {
    const marker = createMarkerProgram(fixture.root, "configured-external-driver");
    git(fixture.root, ["config", "diff.repofit-command.command", marker.command]);
    proveUnhardenedDiffWouldRunMarker(fixture.root, marker.markerPath);
    runWorktreeCheck(fixture.root);
    assert.equal(existsSync(marker.markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("Git runner disables a repository-configured textconv driver", () => {
  const fixture = createChangedRepository(
    "repofit-git-textconv-config-",
    "*.ts diff=repofit-marker\n",
  );
  try {
    const marker = createMarkerProgram(fixture.root, "configured-textconv");
    git(fixture.root, ["config", "diff.repofit-marker.textconv", marker.command]);
    proveUnhardenedDiffWouldRunMarker(fixture.root, marker.markerPath);
    runWorktreeCheck(fixture.root);
    assert.equal(existsSync(marker.markerPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("Git runner discards GIT_CONFIG_COUNT command injection", () => {
  const fixture = createChangedRepository("repofit-git-config-env-");
  try {
    const marker = createMarkerProgram(fixture.root, "environment-config-external-diff");
    const hostileEnvironment = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "diff.external",
      GIT_CONFIG_VALUE_0: marker.command,
    };
    proveUnhardenedDiffWouldRunMarker(fixture.root, marker.markerPath, hostileEnvironment);
    runWorktreeCheck(fixture.root, hostileEnvironment);
    assert.equal(existsSync(marker.markerPath), false);
  } finally {
    fixture.cleanup();
  }
});
