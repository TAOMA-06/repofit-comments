import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildStyleProfile } from "../src/profile.js";
import { readHeadContents } from "../src/git.js";

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

test("style profile requires and summarizes an unchanged repository baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-profile-test-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    mkdirSync(join(root, "src"));

    for (let index = 0; index < 6; index += 1) {
      const source = [
        `export function sample${index}(value: number): number {`,
        "  const offset = 1;",
        "  // Normalize the local input",
        "  const normalized = value + offset;",
        "  // Build the local result",
        "  const result = normalized * 2;",
        "  // Format the local output",
        "  const output = result + 1;",
        "  // Return the local value",
        "  const finalValue = output;",
        "  // Complete the local operation",
        "  return finalValue;",
        "}",
        "",
      ].join("\n");
      writeFileSync(join(root, "src", `sample-${index}.ts`), source);
    }
    git(root, ["add", "src"]);
    git(root, ["commit", "-qm", "baseline"]);

    const profile = buildStyleProfile(root, []);
    assert.equal(profile.status, "ready");
    assert.equal(profile.sampleFileCount, 6);
    assert.equal(profile.commentCount, 30);
    assert.equal(profile.dominantLanguage, "en");
    assert.equal(profile.commonPhrases["normalize the local input"], 6);
    assert.ok(profile.examples.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("HEAD profile contents are read in a NUL-framed batch", {
  skip: process.platform === "win32",
}, () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-comments-profile-batch-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Test"]);
    const names = ["space name.ts", "line\nbreak.ts"];
    writeFileSync(join(root, names[0] as string), "export const one = 1;\n");
    writeFileSync(join(root, names[1] as string), "export const two = 2;\n");
    git(root, ["add", "--", ...names]);
    git(root, ["commit", "-qm", "batch paths"]);

    const contents = readHeadContents(root, [...names, "missing.ts"]);
    assert.equal(contents.get(names[0] as string), "export const one = 1;\n");
    assert.equal(contents.get(names[1] as string), "export const two = 2;\n");
    assert.equal(contents.has("missing.ts"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
