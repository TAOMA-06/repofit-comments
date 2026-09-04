import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { decodeUtf8Bytes } from "./encoding.js";
import { pathIncluded, type RepoFitConfig } from "./config.js";
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

function gitArguments(args: string[]): string[] {
  return [
    "--no-pager",
    "--no-optional-locks",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "diff.external=",
    ...args,
  ];
}

function spawnGit(root: string, args: string[]): GitProcessResult {
  const result = spawnSync(
    "git",
    gitArguments(args),
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
    stdout: decodeUtf8Bytes(result.stdout, `git ${args[0] ?? "command"} stdout`),
    stderr: decodeUtf8Bytes(result.stderr, `git ${args[0] ?? "command"} stderr`),
  };
}

function spawnGitBytes(root: string, args: string[], input: Uint8Array): Uint8Array {
  const result = spawnSync("git", gitArguments(args), {
    cwd: root,
    env: gitEnvironment(),
    input,
    killSignal: "SIGKILL",
    maxBuffer: MAX_GIT_OUTPUT,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === "ETIMEDOUT") {
      throw new Error(`git ${args[0] ?? "command"} timed out after ${GIT_TIMEOUT_MS}ms.`);
    }
    throw new Error(`Unable to run git: ${error.message}`);
  }
  if (result.status !== 0 || result.signal) {
    const detail = decodeUtf8Bytes(
      result.stderr,
      `git ${args[0] ?? "command"} stderr`,
    ).trim();
    throw new Error(`git ${args[0] ?? "command"} failed: ${detail || "unknown error"}`);
  }
  return result.stdout;
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

export function getGitVersion(root: string): string {
  return runGit(root, ["--version"]).trim();
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

export function listScopedPaths(
  root: string,
  scope: Scope,
  config?: RepoFitConfig,
): string[] {
  const output = runGit(root, [
    ...diffPrefix(root, scope),
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
    "--",
  ]);

  return splitNullTerminated(output)
    .filter(isSupportedSourcePath)
    .filter((path) => config === undefined || pathIncluded(config, path))
    .sort();
}

export function readScopedFileContent(
  root: string,
  scope: Scope,
  relativePath: string,
  maxBytes = MAX_GIT_OUTPUT,
): string {
  switch (scope.kind) {
    case "staged":
      return readIndexContent(root, relativePath);
    case "worktree":
      return readWorkingTreeContent(root, relativePath, maxBytes);
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

function readDiffRanges(
  root: string,
  scope: Scope,
  relativePaths: string[],
): Map<string, LineRange[]> {
  const ranges = new Map<string, LineRange[]>();
  const prefix = diffPrefix(root, scope);
  const chunkSize = 32;
  for (let offset = 0; offset < relativePaths.length; offset += chunkSize) {
    const paths = relativePaths.slice(offset, offset + chunkSize);
    const output = runGit(root, [
      ...prefix,
      "--unified=0",
      "--no-color",
      "--",
      ...paths,
    ]);
    const sections = output.split(/^diff --git /mu).slice(1);
    if (sections.length !== paths.length) {
      for (const relativePath of paths) {
        ranges.set(
          relativePath,
          parseAddedLineRanges(readFileDiff(root, scope, relativePath)),
        );
      }
      continue;
    }
    sections.forEach((section, index) => {
      const relativePath = paths[index];
      if (relativePath) ranges.set(relativePath, parseAddedLineRanges(section));
    });
  }
  return ranges;
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

export function collectScopedFiles(
  root: string,
  scope: Scope,
  config?: RepoFitConfig,
): ScopedFile[] {
  const paths = listScopedPaths(root, scope, config);
  if (config && paths.length > config.limits.maxFiles) {
    throw new Error(
      `The selected diff contains ${paths.length} supported files, above limits.maxFiles=${config.limits.maxFiles}.`,
    );
  }
  const sizes = readScopedSizes(root, scope, paths);
  let totalBytes = 0;
  for (const relativePath of paths) {
    const fileBytes = sizes.get(relativePath);
    if (fileBytes === undefined) {
      throw new Error(`Unable to determine source size for ${relativePath}.`);
    }
    if (config && fileBytes > config.limits.maxFileBytes) {
      throw new Error(
        `${relativePath} is ${fileBytes} bytes, above limits.maxFileBytes=${config.limits.maxFileBytes}.`,
      );
    }
    totalBytes += fileBytes;
    if (config && totalBytes > config.limits.maxTotalBytes) {
      throw new Error(
        `Selected source bytes exceed limits.maxTotalBytes=${config.limits.maxTotalBytes}.`,
      );
    }
  }
  const diffRanges = readDiffRanges(root, scope, paths);
  const totalChangedLines = [...diffRanges.values()].reduce(
    (total, fileRanges) =>
      total +
      fileRanges.reduce(
        (fileTotal, range) => fileTotal + range.end - range.start + 1,
        0,
      ),
    0,
  );
  if (config && totalChangedLines > config.limits.maxChangedLines) {
    throw new Error(
      `Selected changed lines exceed limits.maxChangedLines=${config.limits.maxChangedLines}.`,
    );
  }
  const scopedContents =
    scope.kind === "worktree"
      ? undefined
      : readObjectContents(
          root,
          paths.map((relativePath) => ({
            relativePath,
            objectName:
              scope.kind === "staged" ? `:${relativePath}` : `HEAD:${relativePath}`,
          })),
        );
  return paths.flatMap((relativePath) => {
    const content =
      scopedContents?.get(relativePath) ??
      readScopedFileContent(
        root,
        scope,
        relativePath,
        config?.limits.maxFileBytes,
      );
    if (wholeFileProtectionReason(relativePath, content) !== undefined) {
      return [];
    }
    const addedRanges = diffRanges.get(relativePath) ?? [];
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

function indexOfNull(bytes: Uint8Array, start: number): number {
  for (let index = start; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

function readObjectContents(
  root: string,
  objectNames: Array<{ relativePath: string; objectName: string }>,
): Map<string, string> {
  const contents = new Map<string, string>();
  const chunkSize = 16;
  for (let offset = 0; offset < objectNames.length; offset += chunkSize) {
    const objects = objectNames.slice(offset, offset + chunkSize);
    const input = Buffer.from(objects.map((item) => `${item.objectName}\0`).join(""), "utf8");
    const output = spawnGitBytes(root, ["cat-file", "--batch", "-Z"], input);
    let cursor = 0;
    for (const item of objects) {
      const headerEnd = indexOfNull(output, cursor);
      if (headerEnd < 0) throw new Error("git cat-file returned an incomplete header.");
      const header = decodeUtf8Bytes(
        output.subarray(cursor, headerEnd),
        `git cat-file header for ${item.relativePath}`,
      );
      cursor = headerEnd + 1;
      if (header.endsWith(" missing")) continue;
      const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
      if (!match) throw new Error(`Unexpected git cat-file header for ${item.relativePath}.`);
      const size = Number.parseInt(match[1] ?? "", 10);
      const end = cursor + size;
      if (!Number.isSafeInteger(size) || end >= output.byteLength || output[end] !== 0) {
        throw new Error(`git cat-file returned invalid content framing for ${item.relativePath}.`);
      }
      contents.set(
        item.relativePath,
        decodeUtf8Bytes(
          output.subarray(cursor, end),
          `Git object ${item.objectName}`,
        ),
      );
      cursor = end + 1;
    }
    if (cursor !== output.byteLength) {
      throw new Error("git cat-file returned unexpected trailing bytes.");
    }
  }
  return contents;
}

export function readHeadContents(
  root: string,
  relativePaths: string[],
): Map<string, string> {
  return readObjectContents(
    root,
    relativePaths.map((relativePath) => ({
      relativePath,
      objectName: `HEAD:${relativePath}`,
    })),
  );
}

function readObjectSizes(
  root: string,
  objectNames: Array<{ relativePath: string; objectName: string }>,
): Map<string, number> {
  const sizes = new Map<string, number>();
  const chunkSize = 64;
  for (let offset = 0; offset < objectNames.length; offset += chunkSize) {
    const objects = objectNames.slice(offset, offset + chunkSize);
    const input = Buffer.from(objects.map((item) => `${item.objectName}\0`).join(""), "utf8");
    const output = spawnGitBytes(root, ["cat-file", "--batch-check", "-Z"], input);
    let cursor = 0;
    for (const item of objects) {
      const headerEnd = indexOfNull(output, cursor);
      if (headerEnd < 0) throw new Error("git cat-file returned an incomplete size header.");
      const header = decodeUtf8Bytes(
        output.subarray(cursor, headerEnd),
        `git cat-file size header for ${item.relativePath}`,
      );
      cursor = headerEnd + 1;
      if (header.endsWith(" missing")) continue;
      const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
      const size = Number.parseInt(match?.[1] ?? "", 10);
      if (!match || !Number.isSafeInteger(size) || size < 0) {
        throw new Error(`Unexpected git cat-file size for ${item.relativePath}.`);
      }
      sizes.set(item.relativePath, size);
    }
    if (cursor !== output.byteLength) {
      throw new Error("git cat-file returned unexpected trailing size bytes.");
    }
  }
  return sizes;
}

export function readHeadSizes(root: string, relativePaths: string[]): Map<string, number> {
  return readObjectSizes(
    root,
    relativePaths.map((relativePath) => ({
      relativePath,
      objectName: `HEAD:${relativePath}`,
    })),
  );
}

function workingTreeFileSize(root: string, relativePath: string): number {
  const path = assertSafeWorkingTreePath(root, relativePath);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing to read or rewrite a non-regular source file: ${relativePath}`);
  }
  return metadata.size;
}

function readScopedSizes(
  root: string,
  scope: Scope,
  relativePaths: string[],
): Map<string, number> {
  if (scope.kind === "worktree") {
    return new Map(
      relativePaths.map((relativePath) => [
        relativePath,
        workingTreeFileSize(root, relativePath),
      ]),
    );
  }
  return readObjectSizes(
    root,
    relativePaths.map((relativePath) => ({
      relativePath,
      objectName: scope.kind === "staged" ? `:${relativePath}` : `HEAD:${relativePath}`,
    })),
  );
}

function readFileBytesBounded(path: string, maximumBytes: number): Uint8Array {
  const descriptor = openSync(path, "r");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new Error(`Source file exceeds the ${maximumBytes}-byte read limit.`);
    }
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1));
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        throw new Error(`Source file grew beyond the ${maximumBytes}-byte read limit.`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    closeSync(descriptor);
  }
  return Buffer.concat(chunks, total);
}

export function readWorkingTreeContent(
  root: string,
  relativePath: string,
  maxBytes = MAX_GIT_OUTPUT,
): string {
  const absolutePath = assertSafeWorkingTreePath(root, relativePath);
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing to read or rewrite a non-regular source file: ${relativePath}`);
  }
  return decodeUtf8Bytes(
    readFileBytesBounded(absolutePath, maxBytes),
    `Working-tree file ${relativePath}`,
  );
}

export function resolveSafeWorkingTreePath(root: string, relativePath: string): string {
  return assertSafeWorkingTreePath(root, relativePath);
}
