import {
  existsSync,
  opendirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  assertPrivateRegularFileIfPresent,
  ensurePrivateDirectory,
  syncDirectory,
  writeNewFileDurably,
} from "./durable-file.js";
import { decodeUtf8Bytes } from "./encoding.js";
import { sha256 } from "./hash.js";
import type { FixReceipt, FixReceiptStatus } from "./model.js";
import { automaticWriteBlockReason } from "./platform.js";
import {
  acquireRepositoryWriteLock,
  backupPath,
  openReceiptStore,
  readBackup,
  readLatestReceipt,
  type ReceiptStoreContext,
} from "./receipt-store.js";
import { decodeReceipt, validUuid } from "./receipt.js";

const MAX_HISTORY_ENTRIES = 512;
const MAX_PRUNE_MARKER_BYTES = 16 * 1024;

export interface FixHistoryEntry {
  receiptId: string;
  status: FixReceiptStatus;
  relativePath: string;
  preparedAt: string;
  latest: boolean;
  backupPresent: boolean;
  backupBytes: number;
}

export interface FixHistoryReport {
  schemaVersion: "1.0";
  type: "fix-history";
  latestReceiptId: string;
  pendingPruneOperations: number;
  entries: FixHistoryEntry[];
}

interface DetailedHistoryEntry extends FixHistoryEntry {
  receipt: FixReceipt;
  receiptPath: string;
  backupPath: string;
}

interface PruneMarker {
  schemaVersion: "1.0";
  receiptId: string;
  status: Exclude<FixReceiptStatus, "prepared" | "undo-prepared">;
  receiptHash: string;
  backupHash: string;
  startedAt: string;
}

export interface HistoryPruneResult {
  schemaVersion: "1.0";
  type: "history-prune";
  applied: boolean;
  keep: number;
  recoveredOperations: string[];
  prunedReceiptIds: string[];
  retainedReceiptIds: string[];
}

interface PruneOptions {
  apply?: boolean;
  faultAfterReceiptStage?: boolean;
}

function repositoryId(store: ReceiptStoreContext): string {
  if (!store.repositoryId) {
    throw new Error("RepoFit repository identity is unavailable for history inspection.");
  }
  return store.repositoryId;
}

function historyPath(store: ReceiptStoreContext, receiptId: string): string {
  return join(store.receipts, `${receiptId}.json`);
}

function countPruneMarkers(store: ReceiptStoreContext): number {
  if (!existsSync(store.prune)) return 0;
  let count = 0;
  const handle = opendirSync(store.prune);
  try {
    let entry = handle.readSync();
    while (entry !== null) {
      if (entry.isFile() && entry.name.endsWith(".marker.json")) count += 1;
      entry = handle.readSync();
    }
  } finally {
    handle.closeSync();
  }
  return count;
}

function loadHistory(store: ReceiptStoreContext): {
  latest: FixReceipt;
  entries: DetailedHistoryEntry[];
} {
  const latest = readLatestReceipt(store);
  const entries: DetailedHistoryEntry[] = [];
  const handle = opendirSync(store.receipts);
  try {
    let entry = handle.readSync();
    while (entry !== null) {
      if (entries.length >= MAX_HISTORY_ENTRIES) {
        throw new Error(`RepoFit history exceeds the ${MAX_HISTORY_ENTRIES}-entry read limit.`);
      }
      const match = /^([0-9a-f-]{36})\.json$/i.exec(entry.name);
      if (!entry.isFile() || !match || !validUuid(match[1])) {
        throw new Error(`Unexpected RepoFit history entry: ${entry.name}`);
      }
      const receiptId = match[1];
      const receiptPath = join(store.receipts, entry.name);
      assertPrivateRegularFileIfPresent(receiptPath);
      const receipt = decodeReceipt(
        readFileSync(receiptPath),
        receiptPath,
        repositoryId(store),
        receiptId,
      );
      const storedBackupPath = backupPath(store, receiptId);
      const backupMetadata = assertPrivateRegularFileIfPresent(storedBackupPath);
      entries.push({
        receiptId,
        status: receipt.status,
        relativePath: receipt.relativePath,
        preparedAt: receipt.preparedAt,
        latest: receiptId === latest.receiptId,
        backupPresent: backupMetadata !== undefined,
        backupBytes: backupMetadata?.size ?? 0,
        receipt,
        receiptPath,
        backupPath: storedBackupPath,
      });
      entry = handle.readSync();
    }
  } finally {
    handle.closeSync();
  }
  entries.sort(
    (left, right) =>
      right.preparedAt.localeCompare(left.preparedAt) ||
      right.receiptId.localeCompare(left.receiptId),
  );
  return { latest, entries };
}

export function listFixHistory(root: string): FixHistoryReport {
  const store = openReceiptStore(root);
  const { latest, entries } = loadHistory(store);
  return {
    schemaVersion: "1.0",
    type: "fix-history",
    latestReceiptId: latest.receiptId,
    pendingPruneOperations: countPruneMarkers(store),
    entries: entries.map((entry) => ({
      receiptId: entry.receiptId,
      status: entry.status,
      relativePath: entry.relativePath,
      preparedAt: entry.preparedAt,
      latest: entry.latest,
      backupPresent: entry.backupPresent,
      backupBytes: entry.backupBytes,
    })),
  };
}

function validateKeep(keep: number): void {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 200) {
    throw new Error("History retention --keep must be an integer from 1 through 200.");
  }
}

function pruneCandidates(
  latestReceiptId: string,
  entries: DetailedHistoryEntry[],
  keep: number,
): { candidates: DetailedHistoryEntry[]; retained: DetailedHistoryEntry[] } {
  const alwaysRetained = new Set(
    entries
      .filter(
        (entry) =>
          entry.receiptId === latestReceiptId ||
          entry.status === "prepared" ||
          entry.status === "undo-prepared",
      )
      .map((entry) => entry.receiptId),
  );
  for (const entry of entries.slice(0, keep)) alwaysRetained.add(entry.receiptId);
  return {
    candidates: entries.filter((entry) => !alwaysRetained.has(entry.receiptId)),
    retained: entries.filter((entry) => alwaysRetained.has(entry.receiptId)),
  };
}

function markerPath(store: ReceiptStoreContext, receiptId: string): string {
  return join(store.prune, `${receiptId}.marker.json`);
}

function stagedReceiptPath(store: ReceiptStoreContext, receiptId: string): string {
  return join(store.prune, `${receiptId}.receipt`);
}

function stagedBackupPath(store: ReceiptStoreContext, receiptId: string): string {
  return join(store.prune, `${receiptId}.backup`);
}

function encodeMarker(marker: PruneMarker): string {
  return `${JSON.stringify(marker, null, 2)}\n`;
}

function decodeMarker(path: string): PruneMarker {
  const metadata = assertPrivateRegularFileIfPresent(path);
  if (!metadata || metadata.size > MAX_PRUNE_MARKER_BYTES) {
    throw new Error(`Invalid RepoFit prune marker: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(
      decodeUtf8Bytes(readFileSync(path), `RepoFit prune marker ${path}`),
    ) as unknown;
  } catch {
    throw new Error(`Invalid RepoFit prune marker: ${path}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Invalid RepoFit prune marker: ${path}`);
  }
  const value = raw as Record<string, unknown>;
  const allowed = new Set([
    "schemaVersion",
    "receiptId",
    "status",
    "receiptHash",
    "backupHash",
    "startedAt",
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== "1.0" ||
    !validUuid(value.receiptId) ||
    !["applied", "undone", "aborted"].includes(String(value.status)) ||
    typeof value.receiptHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.receiptHash) ||
    typeof value.backupHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.backupHash) ||
    typeof value.startedAt !== "string" ||
    Number.isNaN(Date.parse(value.startedAt))
  ) {
    throw new Error(`Invalid RepoFit prune marker: ${path}`);
  }
  return {
    schemaVersion: "1.0",
    receiptId: value.receiptId,
    status: value.status as PruneMarker["status"],
    receiptHash: value.receiptHash,
    backupHash: value.backupHash,
    startedAt: value.startedAt,
  };
}

function moveExpected(
  source: string,
  staged: string,
  expectedHash: string,
  sourceDirectory: string,
  pruneDirectory: string,
): void {
  if (existsSync(staged)) {
    assertPrivateRegularFileIfPresent(staged);
    if (sha256(readFileSync(staged)) !== expectedHash || existsSync(source)) {
      throw new Error(`Prune staging state is inconsistent: ${staged}`);
    }
    return;
  }
  if (!existsSync(source)) return;
  assertPrivateRegularFileIfPresent(source);
  if (sha256(readFileSync(source)) !== expectedHash) {
    throw new Error(`Prune source hash changed: ${source}`);
  }
  renameSync(source, staged);
  syncDirectory(sourceDirectory);
  syncDirectory(pruneDirectory);
}

function finishMarker(
  store: ReceiptStoreContext,
  marker: PruneMarker,
  currentLatestReceiptId: string,
): void {
  if (marker.receiptId === currentLatestReceiptId) {
    throw new Error(`Refusing to prune the latest receipt ${marker.receiptId}.`);
  }
  moveExpected(
    historyPath(store, marker.receiptId),
    stagedReceiptPath(store, marker.receiptId),
    marker.receiptHash,
    store.receipts,
    store.prune,
  );
  moveExpected(
    backupPath(store, marker.receiptId),
    stagedBackupPath(store, marker.receiptId),
    marker.backupHash,
    store.backups,
    store.prune,
  );
  for (const path of [
    stagedReceiptPath(store, marker.receiptId),
    stagedBackupPath(store, marker.receiptId),
  ]) {
    if (existsSync(path)) unlinkSync(path);
  }
  const path = markerPath(store, marker.receiptId);
  if (existsSync(path)) unlinkSync(path);
  syncDirectory(store.prune);
}

function resumePruneOperations(
  store: ReceiptStoreContext,
  latestReceiptId: string,
): string[] {
  if (!existsSync(store.prune)) return [];
  const markerPaths: string[] = [];
  const handle = opendirSync(store.prune);
  try {
    let entry = handle.readSync();
    while (entry !== null) {
      if (entry.isFile() && entry.name.endsWith(".marker.json")) {
        markerPaths.push(join(store.prune, entry.name));
      }
      entry = handle.readSync();
    }
  } finally {
    handle.closeSync();
  }
  const recovered: string[] = [];
  for (const path of markerPaths.sort()) {
    const marker = decodeMarker(path);
    finishMarker(store, marker, latestReceiptId);
    recovered.push(marker.receiptId);
  }
  return recovered;
}

function beginPrune(
  store: ReceiptStoreContext,
  entry: DetailedHistoryEntry,
  faultAfterReceiptStage: boolean,
): void {
  if (entry.status === "prepared" || entry.status === "undo-prepared" || entry.latest) {
    throw new Error(`Receipt ${entry.receiptId} is not eligible for pruning.`);
  }
  const backup = readBackup(store, entry.receipt);
  const receiptBytes = readFileSync(entry.receiptPath);
  const marker: PruneMarker = {
    schemaVersion: "1.0",
    receiptId: entry.receiptId,
    status: entry.status,
    receiptHash: sha256(receiptBytes),
    backupHash: sha256(backup),
    startedAt: new Date().toISOString(),
  };
  const path = markerPath(store, entry.receiptId);
  if (existsSync(path)) throw new Error(`Prune marker already exists: ${path}`);
  writeNewFileDurably(path, encodeMarker(marker), 0o600);
  syncDirectory(store.prune);
  moveExpected(
    entry.receiptPath,
    stagedReceiptPath(store, entry.receiptId),
    marker.receiptHash,
    store.receipts,
    store.prune,
  );
  if (faultAfterReceiptStage) {
    throw new Error("Injected failure after staging a receipt for pruning.");
  }
  finishMarker(store, marker, readLatestReceipt(store).receiptId);
}

export function pruneFixHistory(
  root: string,
  keep: number,
  options: PruneOptions = {},
): HistoryPruneResult {
  validateKeep(keep);
  const store = openReceiptStore(root);
  const initial = loadHistory(store);
  const planned = pruneCandidates(initial.latest.receiptId, initial.entries, keep);
  if (!options.apply) {
    return {
      schemaVersion: "1.0",
      type: "history-prune",
      applied: false,
      keep,
      recoveredOperations: [],
      prunedReceiptIds: planned.candidates.map((entry) => entry.receiptId),
      retainedReceiptIds: planned.retained.map((entry) => entry.receiptId),
    };
  }
  const platformBlock = automaticWriteBlockReason();
  if (platformBlock) throw new Error(platformBlock);
  ensurePrivateDirectory(store.prune);
  const operationId = randomUUID();
  const releaseLock = acquireRepositoryWriteLock(store, "<history-prune>", operationId);
  try {
    const latestBeforeRecovery = readLatestReceipt(store);
    const recoveredOperations = resumePruneOperations(
      store,
      latestBeforeRecovery.receiptId,
    );
    const current = loadHistory(store);
    const selection = pruneCandidates(current.latest.receiptId, current.entries, keep);
    const prunedReceiptIds: string[] = [];
    for (const [index, entry] of selection.candidates.entries()) {
      beginPrune(store, entry, options.faultAfterReceiptStage === true && index === 0);
      prunedReceiptIds.push(entry.receiptId);
    }
    return {
      schemaVersion: "1.0",
      type: "history-prune",
      applied: true,
      keep,
      recoveredOperations,
      prunedReceiptIds,
      retainedReceiptIds: selection.retained.map((entry) => entry.receiptId),
    };
  } finally {
    releaseLock();
  }
}
