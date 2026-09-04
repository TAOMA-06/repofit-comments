import {
  existsSync,
  linkSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { syncDirectory, writeNewFileDurably } from "./durable-file.js";
import { resolveSafeWorkingTreePath } from "./git.js";
import { sha256 } from "./hash.js";

export type SourceTransactionFaultStage =
  | "after-source-displaced"
  | "after-candidate-installed";

export interface RecoveryPlan {
  receiptId: string;
  relativePath: string;
  operationId: string;
  capturedHash: string;
  installedHash: string;
  expectedMode: number;
}

function restoreCapturedSource(sourcePath: string, displacedPath: string): boolean {
  try {
    linkSync(displacedPath, sourcePath);
    unlinkSync(displacedPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

function transactionPaths(
  root: string,
  relativePath: string,
  operationId: string,
): {
  path: string;
  directory: string;
  candidatePath: string;
  displacedPath: string;
  probePath: string;
  conflictPath: string;
} {
  const path = resolveSafeWorkingTreePath(root, relativePath);
  const directory = dirname(path);
  const prefix = `.${basename(path)}.repofit-${operationId}`;
  return {
    path,
    directory,
    candidatePath: join(directory, `${prefix}.candidate`),
    displacedPath: join(directory, `${prefix}.displaced`),
    probePath: join(directory, `${prefix}.probe`),
    conflictPath: join(directory, `${prefix}.concurrent`),
  };
}

export function replaceExpectedSource(
  root: string,
  relativePath: string,
  content: string | Uint8Array,
  expectedHash: string,
  expectedMode: number,
  operationId: string,
  faultStage?: SourceTransactionFaultStage,
): void {
  const { path, directory, candidatePath, displacedPath, probePath, conflictPath } =
    transactionPaths(root, relativePath, operationId);
  const sourceMetadata = lstatSync(path);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
    throw new Error("Refusing to replace a symbolic link or non-regular file.");
  }
  if (sourceMetadata.nlink !== 1) {
    throw new Error("Refusing to replace a source file with multiple hard links.");
  }
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    sourceMetadata.uid !== process.getuid()
  ) {
    throw new Error("Refusing to replace a source file owned by another user.");
  }
  if ((sourceMetadata.mode & 0o200) === 0) {
    throw new Error("Refusing to replace a source file without owner-write permission.");
  }
  for (const reservedPath of [candidatePath, displacedPath, probePath, conflictPath]) {
    if (existsSync(reservedPath)) {
      throw new Error(`Refusing to reuse an existing transaction path: ${reservedPath}`);
    }
  }

  writeNewFileDurably(candidatePath, content, expectedMode);
  try {
    // Confirm no-clobber hard-link installation is supported before displacing source.
    linkSync(candidatePath, probePath);
    unlinkSync(probePath);

    // This creates a short, documented absence window for concurrent readers.
    renameSync(path, displacedPath);
    syncDirectory(directory);
    if (faultStage === "after-source-displaced") {
      throw new Error("Injected failure after the source was displaced.");
    }
    const capturedMetadata = lstatSync(displacedPath);
    const capturedBytes = readFileSync(displacedPath);
    if (
      !capturedMetadata.isFile() ||
      capturedMetadata.isSymbolicLink() ||
      sha256(capturedBytes) !== expectedHash ||
      (capturedMetadata.mode & 0o777) !== expectedMode
    ) {
      const restored = restoreCapturedSource(path, displacedPath);
      syncDirectory(directory);
      throw new Error(
        restored
          ? `Source changed at replacement time: ${relativePath}. The captured bytes were restored.`
          : `Source changed at replacement time: ${relativePath}. A concurrent file was preserved and captured bytes remain at ${displacedPath}.`,
      );
    }

    try {
      linkSync(candidatePath, path);
    } catch (error) {
      const restored = restoreCapturedSource(path, displacedPath);
      syncDirectory(directory);
      throw new Error(
        restored
          ? `Source installation failed for ${relativePath}; the original bytes were restored.`
          : `A concurrent file appeared at ${relativePath}; it was preserved and the original bytes remain at ${displacedPath}.`,
        { cause: error },
      );
    }
    unlinkSync(candidatePath);
    syncDirectory(directory);

    const installedMetadata = lstatSync(path);
    const installedBytes = readFileSync(path);
    if (
      !installedMetadata.isFile() ||
      installedMetadata.isSymbolicLink() ||
      sha256(installedBytes) !== sha256(content) ||
      (installedMetadata.mode & 0o777) !== expectedMode
    ) {
      renameSync(path, conflictPath);
      const restored = restoreCapturedSource(path, displacedPath);
      syncDirectory(directory);
      throw new Error(
        `Installed source changed during verification for ${relativePath}. The concurrent bytes were preserved at ${conflictPath}${restored ? " and the original was restored" : ""}.`,
      );
    }

    if (faultStage === "after-candidate-installed") {
      throw new Error("Injected failure after the candidate was installed.");
    }

    unlinkSync(displacedPath);
    syncDirectory(directory);
  } finally {
    if (existsSync(candidatePath)) rmSync(candidatePath);
    if (existsSync(probePath)) rmSync(probePath);
  }
}

function removeTransactionFileIfExpected(path: string, expectedHash: string): void {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    sha256(readFileSync(path)) !== expectedHash
  ) {
    throw new Error(`Refusing to remove an unexpected transaction artifact: ${path}`);
  }
  unlinkSync(path);
}

export function reconcileInterruptedReplacement(
  root: string,
  plan: RecoveryPlan,
): void {
  const { path, directory, candidatePath, displacedPath, probePath, conflictPath } =
    transactionPaths(root, plan.relativePath, plan.operationId);

  if (existsSync(conflictPath)) {
    throw new Error(
      `A preserved concurrent-write artifact requires manual review: ${conflictPath}`,
    );
  }
  if (!existsSync(path) && !existsSync(displacedPath)) {
    throw new Error(
      `Source and displaced transaction file are both missing for ${plan.relativePath}; the private backup was preserved for manual recovery.`,
    );
  }

  if (existsSync(displacedPath)) {
    const displacedMetadata = lstatSync(displacedPath);
    if (
      displacedMetadata.isSymbolicLink() ||
      !displacedMetadata.isFile() ||
      sha256(readFileSync(displacedPath)) !== plan.capturedHash ||
      (displacedMetadata.mode & 0o777) !== plan.expectedMode
    ) {
      throw new Error(
        `Interrupted transaction artifact does not match receipt ${plan.receiptId}; recovery refused.`,
      );
    }

    if (!existsSync(path)) {
      if (!restoreCapturedSource(path, displacedPath)) {
        throw new Error(`A concurrent source appeared while recovering ${plan.relativePath}.`);
      }
      syncDirectory(directory);
    } else {
      const sourceMetadata = lstatSync(path);
      if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
        throw new Error(`Recovered source path is not a regular file: ${plan.relativePath}`);
      }
      const sourceHash = sha256(readFileSync(path));
      const sameCapturedInode =
        sourceMetadata.dev === displacedMetadata.dev &&
        sourceMetadata.ino === displacedMetadata.ino;
      if (sourceHash === plan.installedHash) {
        unlinkSync(displacedPath);
        syncDirectory(directory);
      } else if (sourceHash === plan.capturedHash && sameCapturedInode) {
        unlinkSync(displacedPath);
        syncDirectory(directory);
      } else {
        throw new Error(
          `A concurrent source exists at ${plan.relativePath}; transaction artifacts were preserved for manual recovery.`,
        );
      }
    }
  }

  removeTransactionFileIfExpected(candidatePath, plan.installedHash);
  removeTransactionFileIfExpected(probePath, plan.installedHash);
  syncDirectory(directory);
}
