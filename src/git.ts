import { lstatSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { sha256 } from "./hash.js";
import type { LineRange, Scope, ScopedFile } from "./model.js";

const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

function runGit(root: string, args: string[], allowFailure = false): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
  });

  if (result.error) {
    throw new Error(`Unable to run git: ${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "unknown git error").trim();
    throw new Error(`git ${args[0] ?? "command"} failed: ${detail}`);
  }

  return result.stdout ?? "";
}

export function discoverRepositoryRoot(startDirectory = process.cwd()): string {
  const root = runGit(startDirectory, ["rev-parse", "--show-toplevel"]).trim();
  if (!root) {
    throw new Error("No Git repository found.");
  }
  return root;
}

export function getAbsoluteGitDirectory(root: string): string {
  return runGit(root, ["rev-parse", "--absolute-git-dir"]).trim();
}

export function scopeLabel(scope: Scope): string {
  if (scope.kind === "base") {
    return `base:${scope.ref}`;
  }
  return scope.kind;
}

function resolveBase(root: string, ref: string): string {
  return runGit(root, ["merge-base", ref, "HEAD"]).trim();
}

function diffPrefix(root: string, scope: Scope): string[] {
  switch (scope.kind) {
    case "staged":
      return ["diff", "--cached"];
    case "worktree":
      return ["diff"];
    case "base":
      return ["diff", resolveBase(root, scope.ref), "HEAD"];
  }
}

function isSupportedPath(relativePath: string): boolean {
  if (!/\.tsx?$/i.test(relativePath) || /\.d\.ts$/i.test(relativePath)) {
    return false;
  }

  return !/(^|\/)(?:node_modules|vendor|dist|build|coverage|generated|fixtures?)(?:\/|$)/i.test(
    relativePath,
  ) && !/(?:\.generated|\.min)\.tsx?$/i.test(relativePath);
}

function splitNullTerminated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function assertRepositoryPath(root: string, relativePath: string): string {
  const absolutePath = resolve(root, relativePath);
  const expectedPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolutePath !== root && !absolutePath.startsWith(expectedPrefix)) {
    throw new Error(`Refusing path outside repository: ${relativePath}`);
  }
  return absolutePath;
}

export function listScopedPaths(root: string, scope: Scope): string[] {
  const output = runGit(root, [
    ...diffPrefix(root, scope),
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
    "--",
  ]);

  return splitNullTerminated(output).filter(isSupportedPath).sort();
}

function readScopedContent(root: string, scope: Scope, relativePath: string): string {
  switch (scope.kind) {
    case "staged":
      return runGit(root, ["show", `:${relativePath}`]);
    case "worktree":
      return readWorkingTreeContent(root, relativePath);
    case "base":
      return runGit(root, ["show", `HEAD:${relativePath}`]);
  }
}

function readFileDiff(root: string, scope: Scope, relativePath: string): string {
  return runGit(root, [
    ...diffPrefix(root, scope),
    "--unified=0",
    "--no-color",
    "--",
    relativePath,
  ]);
}

export function parseAddedLineRanges(diff: string): LineRange[] {
  const ranges: LineRange[] = [];
  const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

  for (const line of diff.split(/\r?\n/)) {
    const match = hunkPattern.exec(line);
    if (!match) {
      continue;
    }

    const start = Number.parseInt(match[1] ?? "0", 10);
    const count = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
    if (count > 0) {
      ranges.push({ start, end: start + count - 1 });
    }
  }

  return ranges;
}

export function collectScopedFiles(root: string, scope: Scope): ScopedFile[] {
  return listScopedPaths(root, scope).flatMap((relativePath) => {
    const content = readScopedContent(root, scope, relativePath);
    const addedRanges = parseAddedLineRanges(readFileDiff(root, scope, relativePath));
    if (addedRanges.length === 0) {
      return [];
    }

    return [
      {
        relativePath,
        absolutePath: assertRepositoryPath(root, relativePath),
        content,
        sourceHash: sha256(content),
        addedRanges,
      },
    ];
  });
}

export function listTrackedSourceFiles(root: string): string[] {
  return splitNullTerminated(runGit(root, ["ls-files", "-z", "--"]))
    .filter(isSupportedPath)
    .sort();
}

export function readHeadContent(root: string, relativePath: string): string | undefined {
  const result = spawnSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
  });

  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout ?? "";
}

export function readWorkingTreeContent(root: string, relativePath: string): string {
  const absolutePath = assertRepositoryPath(root, relativePath);
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing to read or rewrite a non-regular source file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}
