import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  opendirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  assertOwnedRegularFileIfPresent,
  assertPrivateRegularFileIfPresent,
  ensurePrivateDirectory,
  syncDirectory,
  tightenLegacyDirectory,
  validateOwnedDirectory,
  validatePrivateDirectory,
  writeNewFileDurably,
} from "./durable-file.js";
import { decodeUtf8Bytes } from "./encoding.js";
import { getAbsoluteGitDirectory } from "./git.js";
import { sha256 } from "./hash.js";
import type { FixReceipt } from "./model.js";
import {
  decodeReceipt,
  decodeLegacySchema2Receipt,
  encodeReceipt,
  MAX_RECEIPT_BYTES,
  readReceiptSchemaVersion,
  validUuid,
} from "./receipt.js";

export const MAX_BACKUP_BYTES_PER_FILE = 2 * 1024 * 1024;
export const MAX_RECOVERY_RECORDS = 200;
export const MAX_RECOVERY_BYTES = 64 * 1024 * 1024;
const MAX_RECOVERY_SCAN_ENTRIES = 512;

export interface ReceiptStoreContext {
  readonly root: string;
  readonly gitDirectory: string;
  readonly data: string;
  readonly receipts: string;
  readonly backups: string;
  readonly locks: string;
  readonly legacy: string;
  readonly prune: string;
  repositoryId: string | undefined;
  legacySchema2: boolean;
}

export interface RecoveryAdmissionLimits {
  maxBackupBytes: number;
  maxRecoveryRecords: number;
  maxRecoveryBytes: number;
}

function contextForRoot(root: string): ReceiptStoreContext {
  const gitDirectory = getAbsoluteGitDirectory(root);
  const data = join(gitDirectory, "repofit-comments");
  return {
    root,
    gitDirectory,
    data,
    receipts: join(data, "receipts"),
    backups: join(data, "backups"),
    locks: join(data, "locks"),
    legacy: join(data, "legacy"),
    prune: join(data, "prune"),
    repositoryId: undefined,
    legacySchema2: false,
  };
}

function repositoryIdPath(store: ReceiptStoreContext): string {
  return join(store.data, "repository-id");
}

function latestReceiptPath(store: ReceiptStoreContext): string {
  return join(store.data, "last-fix.json");
}

function historyReceiptPath(store: ReceiptStoreContext, receiptId: string): string {
  return join(store.receipts, `${receiptId}.json`);
}

export function backupPath(store: ReceiptStoreContext, receiptId: string): string {
  return join(store.backups, `${receiptId}.before`);
}

interface StoredReceipt {
  kind: "legacy-schema-2" | "schema-3";
  bytes: Uint8Array;
}

function inspectStoredReceipt(path: string): StoredReceipt | undefined {
  if (!existsSync(path)) return undefined;
  const metadata = assertOwnedRegularFileIfPresent(path);
  if (!metadata) return undefined;
  if (metadata.size > MAX_RECEIPT_BYTES) {
    throw new Error(
      `Existing RepoFit state exceeds the ${MAX_RECEIPT_BYTES}-byte receipt limit. It was preserved and automatic writing was refused: ${path}`,
    );
  }
  const bytes = readFileSync(path);
  let schemaVersion: unknown;
  try {
    schemaVersion = readReceiptSchemaVersion(bytes, path);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(
      `Existing RepoFit state could not be recognized. It was preserved and automatic writing was refused: ${path}.${detail}`,
      { cause: error },
    );
  }
  if (schemaVersion === "2.0") {
    decodeLegacySchema2Receipt(bytes, path);
    return { kind: "legacy-schema-2", bytes };
  }
  if (schemaVersion === "3.0") return { kind: "schema-3", bytes };
  throw new Error(
    `Existing RepoFit state is neither a valid schema 2 receipt nor a repository-bound schema 3 store: ${path}. It was preserved and automatic writing was refused.`,
  );
}

function readRepositoryId(store: ReceiptStoreContext): string {
  if (store.repositoryId !== undefined) return store.repositoryId;
  const path = repositoryIdPath(store);
  if (!existsSync(path)) {
    throw new Error("RepoFit repository identity is missing; no current receipt can be trusted.");
  }
  assertPrivateRegularFileIfPresent(path);
  const repositoryId = decodeUtf8Bytes(
    readFileSync(path),
    "RepoFit repository identity",
  ).trim();
  if (!validUuid(repositoryId)) {
    throw new Error("RepoFit repository identity is malformed.");
  }
  store.repositoryId = repositoryId;
  return repositoryId;
}

function ensureRepositoryId(store: ReceiptStoreContext): string {
  const path = repositoryIdPath(store);
  if (existsSync(path)) return readRepositoryId(store);
  const repositoryId = randomUUID();
  const candidatePath = join(store.data, `.repository-id.${randomUUID()}.tmp`);
  writeNewFileDurably(candidatePath, `${repositoryId}\n`, 0o600);
  try {
    try {
      linkSync(candidatePath, path);
      syncDirectory(store.data);
      store.repositoryId = repositoryId;
      return repositoryId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return readRepositoryId(store);
    }
  } finally {
    if (existsSync(candidatePath)) unlinkSync(candidatePath);
  }
}

function archiveLegacyReceipt(store: ReceiptStoreContext): void {
  const latest = latestReceiptPath(store);
  const stored = inspectStoredReceipt(latest);
  if (!stored || stored.kind !== "legacy-schema-2") return;
  const { bytes } = stored;
  if (process.platform !== "win32") chmodSync(latest, 0o600);
  ensurePrivateDirectory(store.legacy);
  const destination = join(store.legacy, `last-fix-v2-${sha256(bytes)}.json`);
  if (!existsSync(destination)) {
    writeNewFileDurably(destination, bytes, 0o600);
    syncDirectory(store.legacy);
  } else {
    assertPrivateRegularFileIfPresent(destination);
    if (sha256(readFileSync(destination)) !== sha256(bytes)) {
      throw new Error("The archived schema 2 receipt does not match the legacy receipt.");
    }
  }
}

export function createReceiptStore(root: string): ReceiptStoreContext {
  const store = contextForRoot(root);
  if (existsSync(store.data)) validateOwnedDirectory(store.data);
  const hasRepositoryId = existsSync(repositoryIdPath(store));
  const stored = inspectStoredReceipt(latestReceiptPath(store));
  if (stored?.kind === "schema-3" && !hasRepositoryId) {
    throw new Error(
      "A schema 3 receipt exists without its repository identity. The state was preserved and automatic writing was refused.",
    );
  }
  const legacySchema2 = stored?.kind === "legacy-schema-2";
  if (legacySchema2) tightenLegacyDirectory(store.data);
  else ensurePrivateDirectory(store.data);
  ensurePrivateDirectory(store.receipts);
  ensurePrivateDirectory(store.backups);
  ensurePrivateDirectory(store.locks);
  ensurePrivateDirectory(store.prune);
  store.legacySchema2 = legacySchema2;
  return store;
}

export function initializeReceiptStoreForWrite(store: ReceiptStoreContext): string {
  if (existsSync(store.prune)) {
    const handle = opendirSync(store.prune);
    try {
      let entry = handle.readSync();
      while (entry !== null) {
        if (entry.isFile() && entry.name.endsWith(".marker.json")) {
          throw new Error(
            "An interrupted history prune must be resumed with history prune --apply before applying another fix.",
          );
        }
        entry = handle.readSync();
      }
    } finally {
      handle.closeSync();
    }
  }
  if (store.legacySchema2) {
    archiveLegacyReceipt(store);
    return ensureRepositoryId(store);
  }
  const repositoryId = ensureRepositoryId(store);
  if (existsSync(latestReceiptPath(store))) {
    const latest = readLatestReceipt(store);
    if (latest.status === "prepared" || latest.status === "undo-prepared") {
      throw new Error(
        `Receipt ${latest.receiptId} is ${latest.status}; run recover before applying another fix.`,
      );
    }
  }
  return repositoryId;
}

export function openReceiptStore(root: string): ReceiptStoreContext {
  const store = contextForRoot(root);
  if (!existsSync(store.data)) {
    throw new Error("No RepoFit fix receipt found in this repository.");
  }
  validateOwnedDirectory(store.data);
  const hasRepositoryId = existsSync(repositoryIdPath(store));
  const stored = inspectStoredReceipt(latestReceiptPath(store));
  if (stored?.kind === "schema-3" && !hasRepositoryId) {
    throw new Error(
      "A schema 3 receipt exists without its repository identity. The state was preserved.",
    );
  }
  store.legacySchema2 = stored?.kind === "legacy-schema-2";
  if (store.legacySchema2 && !hasRepositoryId) return store;
  validatePrivateDirectory(store.data);
  validatePrivateDirectory(store.receipts);
  validatePrivateDirectory(store.backups);
  validatePrivateDirectory(store.locks);
  if (existsSync(store.prune)) validatePrivateDirectory(store.prune);
  store.repositoryId = readRepositoryId(store);
  if (store.legacySchema2) return store;
  return store;
}

function writePrivateFileAtomically(
  path: string,
  content: string | Uint8Array,
): void {
  assertPrivateRegularFileIfPresent(path);
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    writeNewFileDurably(temporaryPath, content, 0o600);
    renameSync(temporaryPath, path);
    syncDirectory(dirname(path));
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

interface RecoveryUsage {
  bytes: number;
  receiptCount: number;
}

function scanRecoveryUsage(store: ReceiptStoreContext): RecoveryUsage {
  let bytes = 0;
  let receiptCount = 0;
  let entryCount = 0;
  const addFile = (path: string, countAsReceipt: boolean): void => {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Refusing unsafe RepoFit recovery entry: ${path}`);
    }
    if (
      process.platform !== "win32" &&
      ((typeof process.getuid === "function" && metadata.uid !== process.getuid()) ||
        (metadata.mode & 0o077) !== 0)
    ) {
      throw new Error(`Refusing non-private RepoFit recovery entry: ${path}`);
    }
    entryCount += 1;
    if (entryCount > MAX_RECOVERY_SCAN_ENTRIES) {
      throw new Error(
        `RepoFit recovery storage contains more than ${MAX_RECOVERY_SCAN_ENTRIES} entries; automatic writing was refused without scanning the remainder.`,
      );
    }
    bytes += metadata.size;
    if (bytes > MAX_RECOVERY_BYTES) {
      throw new Error(
        `RepoFit recovery data already exceeds ${MAX_RECOVERY_BYTES} bytes; automatic writing was refused.`,
      );
    }
    if (countAsReceipt) {
      receiptCount += 1;
      if (receiptCount >= MAX_RECOVERY_RECORDS) {
        throw new Error(
          `RepoFit recovery history reached ${MAX_RECOVERY_RECORDS} records. Review and manually archive old terminal receipts before applying another fix; RepoFit never deletes recovery data automatically.`,
        );
      }
    }
  };
  const scanFlatDirectory = (directory: string, countAsReceipt: boolean): void => {
    validatePrivateDirectory(directory);
    const handle = opendirSync(directory);
    try {
      let entry = handle.readSync();
      while (entry !== null) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          throw new Error(`Refusing nested or linked RepoFit recovery entry: ${path}`);
        }
        addFile(path, countAsReceipt);
        entry = handle.readSync();
      }
    } finally {
      handle.closeSync();
    }
  };

  validatePrivateDirectory(store.data);
  const knownDirectories = new Map([
    ["receipts", { path: store.receipts, countAsReceipt: true }],
    ["backups", { path: store.backups, countAsReceipt: false }],
    ["locks", { path: store.locks, countAsReceipt: false }],
    ["legacy", { path: store.legacy, countAsReceipt: false }],
    ["prune", { path: store.prune, countAsReceipt: false }],
  ]);
  const rootHandle = opendirSync(store.data);
  try {
    let entry = rootHandle.readSync();
    while (entry !== null) {
      const path = join(store.data, entry.name);
      if (entry.isDirectory()) {
        entryCount += 1;
        if (entryCount > MAX_RECOVERY_SCAN_ENTRIES) {
          throw new Error(
            `RepoFit recovery storage contains more than ${MAX_RECOVERY_SCAN_ENTRIES} entries; automatic writing was refused without scanning the remainder.`,
          );
        }
        if (!knownDirectories.has(entry.name)) {
          throw new Error(`Refusing unknown RepoFit recovery directory: ${path}`);
        }
      } else {
        addFile(path, false);
      }
      entry = rootHandle.readSync();
    }
  } finally {
    rootHandle.closeSync();
  }
  for (const directory of knownDirectories.values()) {
    if (existsSync(directory.path)) {
      scanFlatDirectory(directory.path, directory.countAsReceipt);
    }
  }
  return { bytes, receiptCount };
}

export function assertCanCreateRecoveryRecord(
  store: ReceiptStoreContext,
  backupBytes: number,
  limits: RecoveryAdmissionLimits = {
    maxBackupBytes: MAX_BACKUP_BYTES_PER_FILE,
    maxRecoveryRecords: MAX_RECOVERY_RECORDS,
    maxRecoveryBytes: MAX_RECOVERY_BYTES,
  },
): void {
  const maxBackupBytes = Math.min(
    limits.maxBackupBytes,
    MAX_BACKUP_BYTES_PER_FILE,
  );
  const maxRecoveryRecords = Math.min(
    limits.maxRecoveryRecords,
    MAX_RECOVERY_RECORDS,
  );
  const maxRecoveryBytes = Math.min(
    limits.maxRecoveryBytes,
    MAX_RECOVERY_BYTES,
  );
  if (backupBytes > maxBackupBytes) {
    throw new Error(
      `Automatic fixes refuse files larger than ${maxBackupBytes} bytes because their recovery backup would exceed the configured per-file limit.`,
    );
  }
  const usage = scanRecoveryUsage(store);
  if (usage.receiptCount >= maxRecoveryRecords) {
    throw new Error(
      `RepoFit recovery history reached ${maxRecoveryRecords} records. Review and prune old terminal receipts before applying another fix; RepoFit never deletes recovery data automatically.`,
    );
  }
  if (
    usage.bytes + backupBytes + MAX_RECEIPT_BYTES * 2 >
    maxRecoveryBytes
  ) {
    throw new Error(
      `RepoFit recovery data would exceed ${maxRecoveryBytes} bytes. Review and prune old terminal receipts before applying another fix; RepoFit never deletes recovery data automatically.`,
    );
  }
}

export function writeBackup(
  store: ReceiptStoreContext,
  receiptId: string,
  bytes: Uint8Array,
): void {
  const path = backupPath(store, receiptId);
  if (existsSync(path)) throw new Error(`Receipt backup already exists: ${receiptId}`);
  writeNewFileDurably(path, bytes, 0o600);
  syncDirectory(store.backups);
}

export function writeReceiptState(
  store: ReceiptStoreContext,
  receipt: FixReceipt,
): void {
  const repositoryId = readRepositoryId(store);
  if (receipt.repositoryId !== repositoryId) {
    throw new Error(`Receipt ${receipt.receiptId} belongs to a different repository identity.`);
  }
  const serialized = encodeReceipt(receipt);
  writePrivateFileAtomically(historyReceiptPath(store, receipt.receiptId), serialized);
  writePrivateFileAtomically(latestReceiptPath(store), serialized);
  store.legacySchema2 = false;
}

function readReceiptFile(
  path: string,
  repositoryId: string,
  expectedReceiptId?: string,
): FixReceipt {
  assertPrivateRegularFileIfPresent(path);
  return decodeReceipt(readFileSync(path), path, repositoryId, expectedReceiptId);
}

export function readLatestReceipt(store: ReceiptStoreContext): FixReceipt {
  if (store.legacySchema2) {
    throw new Error(
      "The latest receipt uses legacy schema 2 and has no recovery backup. It remains available for manual inspection; a new v0.2 fix will archive it and start the recoverable schema 3 history.",
    );
  }
  const latestPath = latestReceiptPath(store);
  if (!existsSync(latestPath)) {
    throw new Error("No RepoFit fix receipt found in this repository.");
  }
  const repositoryId = readRepositoryId(store);
  const pointerReceipt = readReceiptFile(latestPath, repositoryId);
  return readReceiptFile(
    historyReceiptPath(store, pointerReceipt.receiptId),
    repositoryId,
    pointerReceipt.receiptId,
  );
}

export function readBackup(
  store: ReceiptStoreContext,
  receipt: FixReceipt,
): Uint8Array {
  const path = backupPath(store, receipt.receiptId);
  if (!existsSync(path)) {
    throw new Error(`Backup is missing for receipt ${receipt.receiptId}.`);
  }
  assertPrivateRegularFileIfPresent(path);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== receipt.beforeFileHash) {
    throw new Error(`Backup hash mismatch for receipt ${receipt.receiptId}.`);
  }
  return bytes;
}

interface OperationLock {
  operationId: string;
  relativePath: string;
  pid: number;
  startedAt: string;
}

function decodeOperationLock(path: string): OperationLock {
  assertPrivateRegularFileIfPresent(path);
  let raw: unknown;
  try {
    raw = JSON.parse(
      decodeUtf8Bytes(readFileSync(path), "RepoFit repository lock"),
    ) as unknown;
  } catch {
    throw new Error(`The RepoFit repository lock is malformed; inspect it before removing it manually.`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`The RepoFit repository lock is malformed; inspect it before removing it manually.`);
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    keys.some((key) => !["operationId", "relativePath", "pid", "startedAt"].includes(key)) ||
    !validUuid(value.operationId) ||
    typeof value.relativePath !== "string" ||
    value.relativePath.length === 0 ||
    !Number.isInteger(value.pid) ||
    (value.pid as number) <= 0 ||
    typeof value.startedAt !== "string" ||
    Number.isNaN(Date.parse(value.startedAt))
  ) {
    throw new Error(`The RepoFit repository lock is malformed; inspect it before removing it manually.`);
  }
  return {
    operationId: value.operationId,
    relativePath: value.relativePath,
    pid: value.pid as number,
    startedAt: value.startedAt,
  };
}

export function acquireRepositoryWriteLock(
  store: ReceiptStoreContext,
  relativePath: string,
  operationId: string,
  allowStaleRecovery = false,
): () => void {
  const path = join(store.locks, "operation.lock");
  const candidatePath = join(store.locks, `.operation.${operationId}.tmp`);
  writeNewFileDurably(
    candidatePath,
    `${JSON.stringify({ operationId, relativePath, pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    0o600,
  );
  let lockLinked = false;
  try {
    linkSync(candidatePath, path);
    lockLinked = true;
    unlinkSync(candidatePath);
    syncDirectory(store.locks);
  } catch (error) {
    if (existsSync(candidatePath)) {
      unlinkSync(candidatePath);
      syncDirectory(store.locks);
    }
    if (lockLinked && existsSync(path)) {
      const linkedLock = decodeOperationLock(path);
      if (linkedLock.operationId === operationId) unlinkSync(path);
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const lock = decodeOperationLock(path);
      let ownerAlive = true;
      try {
        process.kill(lock.pid, 0);
      } catch (processError) {
        ownerAlive = (processError as NodeJS.ErrnoException).code !== "ESRCH";
      }
      if (!ownerAlive && allowStaleRecovery) {
        unlinkSync(path);
        syncDirectory(store.locks);
        return acquireRepositoryWriteLock(store, relativePath, operationId, false);
      }
      throw new Error(
        `Another RepoFit operation holds the global write lock for ${lock.relativePath} (pid ${lock.pid}).`,
      );
    }
    throw error;
  }

  return () => {
    if (!existsSync(path)) return;
    const lock = decodeOperationLock(path);
    if (lock.operationId !== operationId) {
      throw new Error(`RepoFit lock ownership changed for ${relativePath}; it was preserved.`);
    }
    unlinkSync(path);
    syncDirectory(store.locks);
  };
}
