import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const actionScript = fileURLToPath(
  new URL("../../scripts/action-run.mjs", import.meta.url),
);

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

test("consumer Action runner writes SARIF inside the workspace and reports outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-action-script-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Action Test"]);
    const path = join(root, "sample.ts");
    const baseline = "export function value(): number {\n  return 1;\n}\n";
    writeFileSync(path, baseline);
    git(root, ["add", "sample.ts"]);
    git(root, ["commit", "-qm", "baseline"]);
    const base = git(root, ["rev-parse", "HEAD"]).trim();
    writeFileSync(path, baseline.replace("  return 1;", "  // Main Logic\n  return 1;"));
    git(root, ["add", "sample.ts"]);
    git(root, ["commit", "-qm", "narrated change"]);
    const githubOutput = join(root, "github-output.txt");

    const result = spawnSync(process.execPath, [actionScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_WORKSPACE: root,
        GITHUB_OUTPUT: githubOutput,
        INPUT_BASE: base,
        INPUT_OUTPUT: "repofit.sarif",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const sarif = JSON.parse(readFileSync(join(root, "repofit.sarif"), "utf8"));
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].results.length, 1);
    assert.match(readFileSync(githubOutput, "utf8"), /findings=1/);

    const escaped = spawnSync(process.execPath, [actionScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_WORKSPACE: root,
        INPUT_BASE: base,
        INPUT_OUTPUT: "../outside.sarif",
      },
    });
    assert.notEqual(escaped.status, 0);
    assert.equal(existsSync(join(root, "..", "outside.sarif")), false);

    const outside = join(root, "..", `repofit-hardlink-${process.pid}.sarif`);
    const linked = join(root, "linked.sarif");
    writeFileSync(outside, "preserve me\n");
    linkSync(outside, linked);
    const commonEnvironment = {
      ...process.env,
      GITHUB_WORKSPACE: root,
      INPUT_BASE: base,
    };
    for (const blockedOutput of ["package.json", ".git/result.sarif", "bad\tname.sarif", "linked.sarif"]) {
      const blocked = spawnSync(process.execPath, [actionScript], {
        encoding: "utf8",
        env: { ...commonEnvironment, INPUT_OUTPUT: blockedOutput },
      });
      assert.notEqual(blocked.status, 0, blockedOutput);
    }
    assert.equal(readFileSync(outside, "utf8"), "preserve me\n");
    rmSync(outside);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
