import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { isSupportedSourcePath, wholeFileProtectionReason } from "./file-policy.js";
import { sha256 } from "./hash.js";
import type { LineRange, Scope, ScopedFile } from "./model.js";

const MAX_GIT_OUTPUT = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;

const BLOCKED_GIT_ENVIRONMENT_KEYS = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_ASKPASS",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_DIFF_OPTS",
  "GIT_DIR",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PROXY_COMMAND",
  "GIT_REPLACE_REF_BASE",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_WORK_TREE",
  "SSH_ASKPASS",
]);

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    const normalizedKey = key.toUpperCase();
    if (
      BLOCKED_GIT_ENVIRONMENT_KEYS.has(normalizedKey) ||
      normalizedKey.startsWith("GIT_CONFIG_") ||
      normalizedKey.startsWith("GIT_TRACE")
    ) {
      continue;
    }
    environment[key] = value;
  }

  return {
    ...environment,
    GIT_LITERAL_PATHSPECS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "cat",
  };
}

interface GitProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function decodeUtf8(value: Uint8Array, context: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    throw new Error(`${context} is not valid UTF-8; RepoFit refused to analyze it.`);
  }
}

function spawnGit(root: string, args: string[]): GitProcessResult {
  const result = spawnSync(
    "git",
    [
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.external=",
      ...args,
    ],
    {
      cwd: root,
      env: gitEnvironment(),
      killSignal: "SIGKILL",
      maxBuffer: MAX_GIT_OUTPUT,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    },
  );

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === "ETIMEDOUT") {
      throw new Error(
        `git ${args[0] ?? "command"} timed out after ${GIT_TIMEOUT_MS}ms. Retry with a smaller diff or check Git repository health.`,
      );
    }
    throw new Error(`Unable to run git: ${error.message}`);
  }

  if (result.signal) {
    throw new Error(`git ${args[0] ?? "command"} was terminated by ${result.signal}.`);
  }

  return {
    status: result.status,
    signal: result.signal,
    stdout: decodeUtf8(result.stdout, `git ${args[0] ?? "command"} stdout`),
    stderr: decodeUtf8(result.stderr, `git ${args[0] ?? "command"} stderr`),
  };
}

function runGit(root: string, args: string[]): string {
  const result = spawnGit(root, args);
  if (result.status !== 0) {
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
      return ["diff", "--no-ext-diff", "--no-textconv", "--cached"];
    case "worktree":
      return ["diff", "--no-ext-diff", "--no-textconv"];
    case "base":
      return [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        resolveBase(root, scope.ref),
        "HEAD",
      ];
  }
}

function splitNullTerminated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function assertRepositoryPath(root: string, relativePath: string): string {
  const absolutePath = resolve(root, relativePath);
  const relativeToRoot = relative(resolve(root), absolutePath);
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Refusing path outside repository: ${relativePath}`);
  }
  return absolutePath;
}

function assertSafeWorkingTreePath(root: string, relativePath: string): string {
  const absolutePath = assertRepositoryPath(root, relativePath);
  const realRoot = realpathSync(root);
  const realParent = realpathSync(dirname(absolutePath));
  const parentFromRoot = relative(realRoot, realParent);
  if (
    parentFromRoot === ".." ||
    parentFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(parentFromRoot)
  ) {
    throw new Error(`Refusing path whose parent resolves outside repository: ${relativePath}`);
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

  return splitNullTerminated(output).filter(isSupportedSourcePath).sort();
}

function readScopedContent(root: string, scope: Scope, relativePath: string): string {
  switch (scope.kind) {
    case "staged":
      return readIndexContent(root, relativePath);
    case "worktree":
      return readWorkingTreeContent(root, relativePath);
    case "base":
      return runGit(root, ["show", `HEAD:${relativePath}`]);
  }
}

export function readIndexContent(root: string, relativePath: string): string {
  assertRepositoryPath(root, relativePath);
  return runGit(root, ["show", `:${relativePath}`]);
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
    if (wholeFileProtectionReason(relativePath, content) !== undefined) {
      return [];
    }
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
    .filter(isSupportedSourcePath)
    .sort();
}

export function readHeadContent(root: string, relativePath: string): string | undefined {
  const result = spawnGit(root, ["show", `HEAD:${relativePath}`]);

  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout ?? "";
}

export function readWorkingTreeContent(root: string, relativePath: string): string {
  const absolutePath = assertSafeWorkingTreePath(root, relativePath);
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing to read or rewrite a non-regular source file: ${relativePath}`);
  }
  return decodeUtf8(
    readFileSync(absolutePath),
    `Working-tree file ${relativePath}`,
  );
}

export function resolveSafeWorkingTreePath(root: string, relativePath: string): string {
  return assertSafeWorkingTreePath(root, relativePath);
}
