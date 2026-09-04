import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname } from "node:path";

export function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertOwnedByCurrentUser(path: string): Stats {
  const metadata = lstatSync(path);
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    metadata.uid !== process.getuid()
  ) {
    throw new Error(`Refusing RepoFit path owned by another user: ${path}`);
  }
  return metadata;
}

export function validateOwnedDirectory(path: string): Stats {
  const metadata = assertOwnedByCurrentUser(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing unsafe RepoFit data directory: ${path}`);
  }
  return metadata;
}

export function validatePrivateDirectory(path: string): Stats {
  const metadata = validateOwnedDirectory(path);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Refusing group/other-accessible RepoFit data directory: ${path}`);
  }
  return metadata;
}

export function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  validatePrivateDirectory(path);
}

export function tightenLegacyDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { mode: 0o700 });
    validatePrivateDirectory(path);
    return;
  }
  const metadata = assertOwnedByCurrentUser(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing unsafe RepoFit data directory: ${path}`);
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    chmodSync(path, 0o700);
  }
  validatePrivateDirectory(path);
}

export function assertPrivateRegularFileIfPresent(path: string): Stats | undefined {
  if (!existsSync(path)) return;
  const metadata = assertOwnedRegularFileIfPresent(path);
  if (!metadata) return;
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error(`Refusing group/other-accessible RepoFit data file: ${path}`);
  }
  return metadata;
}

export function assertOwnedRegularFileIfPresent(path: string): Stats | undefined {
  if (!existsSync(path)) return;
  const metadata = assertOwnedByCurrentUser(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing unsafe RepoFit data file: ${path}`);
  }
  return metadata;
}

export function writeNewFileDurably(
  path: string,
  content: string | Uint8Array,
  mode: number,
): void {
  let descriptor: number | undefined;
  let completed = false;
  try {
    descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, content);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    completed = true;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (!completed && existsSync(path)) {
      rmSync(path);
      syncDirectory(dirname(path));
    }
  }
}
