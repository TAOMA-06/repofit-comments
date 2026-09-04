import { posix } from "node:path";

import { decodeUtf8Bytes } from "./encoding.js";
import {
  RECEIPT_SCHEMA_VERSION,
  type AbortedFixReceipt,
  type AppliedFixReceipt,
  type FixReceipt,
  type PreparedFixReceipt,
  type UndoneFixReceipt,
  type UndoPreparedFixReceipt,
} from "./model.js";

type ReceiptBaseData = Omit<PreparedFixReceipt, "status">;

const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "receiptId",
  "repositoryId",
  "status",
  "findingIds",
  "relativePath",
  "analysisScope",
  "writeTarget",
  "preparedAt",
  "appliedAt",
  "undoPreparedAt",
  "undoOperationId",
  "undoneAt",
  "abortedAt",
  "abortReason",
  "recoveredAt",
  "recoveryAction",
  "fileMode",
  "beforeFileHash",
  "afterFileHash",
  "nonCommentTokenHash",
  "syntaxTreeHash",
  "protectedCommentHash",
]);
const LEGACY_SCHEMA_2_KEYS = new Set([
  "schemaVersion",
  "findingIds",
  "relativePath",
  "analysisScope",
  "writeTarget",
  "appliedAt",
  "beforeFileHash",
  "afterFileHash",
  "nonCommentTokenHash",
  "syntaxTreeHash",
  "protectedCommentHash",
]);

export const MAX_RECEIPT_BYTES = 64 * 1024;

export function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !posix.isAbsolute(value) &&
    posix.normalize(value) === value &&
    value !== "." &&
    !value.startsWith("../")
  );
}

function malformed(path: string): never {
  throw new Error(`Malformed fix receipt: ${path}`);
}

function parseReceiptJson(
  serialized: string | Uint8Array,
  path: string,
): Record<string, unknown> {
  const bytes =
    typeof serialized === "string"
      ? Buffer.byteLength(serialized, "utf8")
      : serialized.byteLength;
  if (bytes > MAX_RECEIPT_BYTES) {
    throw new Error(`Fix receipt exceeds the ${MAX_RECEIPT_BYTES}-byte safety limit: ${path}`);
  }
  const text =
    typeof serialized === "string"
      ? serialized
      : decodeUtf8Bytes(serialized, `Fix receipt ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return malformed(path);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) malformed(path);
  return raw as Record<string, unknown>;
}

export function readReceiptSchemaVersion(
  serialized: string | Uint8Array,
  path: string,
): unknown {
  return parseReceiptJson(serialized, path).schemaVersion;
}

export interface LegacySchema2Receipt {
  schemaVersion: "2.0";
  findingIds: string[];
  relativePath: string;
  analysisScope: { kind: "worktree" };
  writeTarget: "worktree";
  appliedAt: string;
  beforeFileHash: string;
  afterFileHash: string;
  nonCommentTokenHash: string;
  syntaxTreeHash: string;
  protectedCommentHash: string;
}

export function decodeLegacySchema2Receipt(
  serialized: string | Uint8Array,
  path: string,
): LegacySchema2Receipt {
  const value = parseReceiptJson(serialized, path);
  const analysisScope = value.analysisScope;
  const validScope =
    typeof analysisScope === "object" &&
    analysisScope !== null &&
    !Array.isArray(analysisScope) &&
    Object.keys(analysisScope).length === 1 &&
    (analysisScope as { kind?: unknown }).kind === "worktree";
  if (
    Object.keys(value).some((key) => !LEGACY_SCHEMA_2_KEYS.has(key)) ||
    value.schemaVersion !== "2.0" ||
    !Array.isArray(value.findingIds) ||
    value.findingIds.length === 0 ||
    value.findingIds.some((findingId) => typeof findingId !== "string" || !findingId) ||
    !validRelativePath(value.relativePath) ||
    !validScope ||
    value.writeTarget !== "worktree" ||
    !validTimestamp(value.appliedAt) ||
    !validHash(value.beforeFileHash) ||
    !validHash(value.afterFileHash) ||
    !validHash(value.nonCommentTokenHash) ||
    !validHash(value.syntaxTreeHash) ||
    !validHash(value.protectedCommentHash)
  ) {
    throw new Error(
      `Existing RepoFit state is neither a valid schema 2 receipt nor a repository-bound schema 3 store: ${path}. It was preserved and automatic writing was refused.`,
    );
  }
  return {
    schemaVersion: "2.0",
    findingIds: [...value.findingIds] as string[],
    relativePath: value.relativePath,
    analysisScope: { kind: "worktree" },
    writeTarget: "worktree",
    appliedAt: value.appliedAt,
    beforeFileHash: value.beforeFileHash,
    afterFileHash: value.afterFileHash,
    nonCommentTokenHash: value.nonCommentTokenHash,
    syntaxTreeHash: value.syntaxTreeHash,
    protectedCommentHash: value.protectedCommentHash,
  };
}

export function decodeReceipt(
  serialized: string | Uint8Array,
  path: string,
  repositoryId: string,
  expectedReceiptId?: string,
): FixReceipt {
  const value = parseReceiptJson(serialized, path);
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new Error(`Fix receipt contains unknown fields: ${path}`);
  }
  if (value.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported fix receipt schema: ${String(value.schemaVersion ?? "(missing)")}. Re-run the fix with this RepoFit version.`,
    );
  }

  const analysisScope = value.analysisScope;
  const validScope =
    typeof analysisScope === "object" &&
    analysisScope !== null &&
    !Array.isArray(analysisScope) &&
    Object.keys(analysisScope).length === 1 &&
    (analysisScope as { kind?: unknown }).kind === "worktree";
  if (
    !validUuid(value.receiptId) ||
    (expectedReceiptId !== undefined && value.receiptId !== expectedReceiptId) ||
    value.repositoryId !== repositoryId ||
    !validTimestamp(value.preparedAt) ||
    !validRelativePath(value.relativePath) ||
    !Array.isArray(value.findingIds) ||
    value.findingIds.length === 0 ||
    value.findingIds.some((findingId) => typeof findingId !== "string" || !findingId) ||
    !validScope ||
    value.writeTarget !== "worktree" ||
    !Number.isInteger(value.fileMode) ||
    (value.fileMode as number) < 0 ||
    (value.fileMode as number) > 0o777 ||
    !validHash(value.beforeFileHash) ||
    !validHash(value.afterFileHash) ||
    !validHash(value.nonCommentTokenHash) ||
    !validHash(value.syntaxTreeHash) ||
    !validHash(value.protectedCommentHash)
  ) {
    malformed(path);
  }

  const base: ReceiptBaseData = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptId: value.receiptId,
    repositoryId,
    findingIds: [...value.findingIds] as string[],
    relativePath: value.relativePath,
    analysisScope: { kind: "worktree" } as const,
    writeTarget: "worktree" as const,
    preparedAt: value.preparedAt,
    fileMode: value.fileMode as number,
    beforeFileHash: value.beforeFileHash,
    afterFileHash: value.afterFileHash,
    nonCommentTokenHash: value.nonCommentTokenHash,
    syntaxTreeHash: value.syntaxTreeHash,
    protectedCommentHash: value.protectedCommentHash,
  };

  switch (value.status) {
    case "prepared":
      if (
        value.appliedAt !== undefined ||
        value.undoPreparedAt !== undefined ||
        value.undoOperationId !== undefined ||
        value.undoneAt !== undefined ||
        value.abortedAt !== undefined ||
        value.abortReason !== undefined ||
        value.recoveredAt !== undefined ||
        value.recoveryAction !== undefined
      ) {
        malformed(path);
      }
      return { ...base, status: "prepared" };

    case "applied": {
      const hasRecovery =
        validTimestamp(value.recoveredAt) && value.recoveryAction === "mark-applied";
      if (
        !validTimestamp(value.appliedAt) ||
        value.undoPreparedAt !== undefined ||
        value.undoOperationId !== undefined ||
        value.undoneAt !== undefined ||
        value.abortedAt !== undefined ||
        value.abortReason !== undefined ||
        ((value.recoveredAt !== undefined || value.recoveryAction !== undefined) &&
          !hasRecovery)
      ) {
        malformed(path);
      }
      const applied: AppliedFixReceipt = {
        ...base,
        status: "applied",
        appliedAt: value.appliedAt,
      };
      return hasRecovery
        ? {
            ...applied,
            recoveredAt: value.recoveredAt as string,
            recoveryAction: "mark-applied",
          }
        : applied;
    }

    case "undo-prepared":
      if (
        !validTimestamp(value.appliedAt) ||
        !validTimestamp(value.undoPreparedAt) ||
        !validUuid(value.undoOperationId) ||
        value.undoneAt !== undefined ||
        value.abortedAt !== undefined ||
        value.abortReason !== undefined ||
        value.recoveredAt !== undefined ||
        value.recoveryAction !== undefined
      ) {
        malformed(path);
      }
      return {
        ...base,
        status: "undo-prepared",
        appliedAt: value.appliedAt,
        undoPreparedAt: value.undoPreparedAt,
        undoOperationId: value.undoOperationId,
      };

    case "undone": {
      const hasRecovery =
        validTimestamp(value.recoveredAt) && value.recoveryAction === "mark-undone";
      if (
        !validTimestamp(value.appliedAt) ||
        !validTimestamp(value.undoPreparedAt) ||
        !validUuid(value.undoOperationId) ||
        !validTimestamp(value.undoneAt) ||
        value.abortedAt !== undefined ||
        value.abortReason !== undefined ||
        ((value.recoveredAt !== undefined || value.recoveryAction !== undefined) &&
          !hasRecovery)
      ) {
        malformed(path);
      }
      const undone: UndoneFixReceipt = {
        ...base,
        status: "undone",
        appliedAt: value.appliedAt,
        undoPreparedAt: value.undoPreparedAt,
        undoOperationId: value.undoOperationId,
        undoneAt: value.undoneAt,
      };
      return hasRecovery
        ? {
            ...undone,
            recoveredAt: value.recoveredAt as string,
            recoveryAction: "mark-undone",
          }
        : undone;
    }

    case "aborted": {
      const hasRecovery =
        validTimestamp(value.recoveredAt) && value.recoveryAction === "mark-aborted";
      if (
        value.appliedAt !== undefined ||
        value.undoPreparedAt !== undefined ||
        value.undoOperationId !== undefined ||
        value.undoneAt !== undefined ||
        !validTimestamp(value.abortedAt) ||
        typeof value.abortReason !== "string" ||
        value.abortReason.length === 0 ||
        ((value.recoveredAt !== undefined || value.recoveryAction !== undefined) &&
          !hasRecovery)
      ) {
        malformed(path);
      }
      const aborted: AbortedFixReceipt = {
        ...base,
        status: "aborted",
        abortedAt: value.abortedAt,
        abortReason: value.abortReason,
      };
      return hasRecovery
        ? {
            ...aborted,
            recoveredAt: value.recoveredAt as string,
            recoveryAction: "mark-aborted",
          }
        : aborted;
    }

    default:
      return malformed(path);
  }
}

export function encodeReceipt(receipt: FixReceipt): string {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  decodeReceipt(serialized, "generated receipt", receipt.repositoryId, receipt.receiptId);
  return serialized;
}

function baseFrom(receipt: FixReceipt): ReceiptBaseData {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptId: receipt.receiptId,
    repositoryId: receipt.repositoryId,
    findingIds: [...receipt.findingIds],
    relativePath: receipt.relativePath,
    analysisScope: { kind: "worktree" } as const,
    writeTarget: "worktree" as const,
    preparedAt: receipt.preparedAt,
    fileMode: receipt.fileMode,
    beforeFileHash: receipt.beforeFileHash,
    afterFileHash: receipt.afterFileHash,
    nonCommentTokenHash: receipt.nonCommentTokenHash,
    syntaxTreeHash: receipt.syntaxTreeHash,
    protectedCommentHash: receipt.protectedCommentHash,
  };
}

export function markApplied(
  receipt: PreparedFixReceipt,
  appliedAt: string,
): AppliedFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "applied",
    appliedAt,
  };
}

export function recoverApplied(
  receipt: PreparedFixReceipt | UndoPreparedFixReceipt,
  recoveredAt: string,
): AppliedFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "applied",
    appliedAt:
      receipt.status === "undo-prepared" ? receipt.appliedAt : recoveredAt,
    recoveredAt,
    recoveryAction: "mark-applied",
  };
}

export function prepareUndo(
  receipt: AppliedFixReceipt,
  undoOperationId: string,
  undoPreparedAt: string,
): UndoPreparedFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "undo-prepared",
    appliedAt: receipt.appliedAt,
    undoPreparedAt,
    undoOperationId,
  };
}

export function markUndone(
  receipt: UndoPreparedFixReceipt,
  undoneAt: string,
): UndoneFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "undone",
    appliedAt: receipt.appliedAt,
    undoPreparedAt: receipt.undoPreparedAt,
    undoOperationId: receipt.undoOperationId,
    undoneAt,
  };
}

export function recoverUndone(
  receipt: UndoPreparedFixReceipt,
  recoveredAt: string,
): UndoneFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "undone",
    appliedAt: receipt.appliedAt,
    undoPreparedAt: receipt.undoPreparedAt,
    undoOperationId: receipt.undoOperationId,
    undoneAt: recoveredAt,
    recoveredAt,
    recoveryAction: "mark-undone",
  };
}

export function markAborted(
  receipt: PreparedFixReceipt,
  abortedAt: string,
  abortReason: string,
): AbortedFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "aborted",
    abortedAt,
    abortReason,
  };
}

export function recoverAborted(
  receipt: PreparedFixReceipt,
  recoveredAt: string,
  abortReason: string,
): AbortedFixReceipt {
  return {
    ...baseFrom(receipt),
    status: "aborted",
    abortedAt: recoveredAt,
    abortReason,
    recoveredAt,
    recoveryAction: "mark-aborted",
  };
}
