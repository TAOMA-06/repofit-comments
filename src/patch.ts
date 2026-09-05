import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";

import {
  extractComments,
  nonCommentTokenHash,
  parseErrorCount,
  syntaxTreeHash,
} from "./analyzer.js";
import {
  readIndexContent,
  readWorkingTreeContent,
  resolveSafeWorkingTreePath,
} from "./git.js";
import { decodeUtf8Bytes } from "./encoding.js";
import { sha256 } from "./hash.js";
import { supportsAutomaticFixes } from "./language-registry.js";
import type { Finding, FixReceipt, PreparedFixReceipt, Scope } from "./model.js";
import { RECEIPT_SCHEMA_VERSION } from "./model.js";
import { protectedCommentHash } from "./protection.js";
import { automaticWriteBlockReason } from "./platform.js";
import {
  acquireRepositoryWriteLock,
  assertCanCreateRecoveryRecord,
  createReceiptStore,
  initializeReceiptStoreForWrite,
  openReceiptStore,
  readBackup,
  readLatestReceipt,
  writeBackup,
  writeReceiptState,
  type RecoveryAdmissionLimits,
  type ReceiptStoreContext,
} from "./receipt-store.js";
import {
  markAborted,
  markApplied,
  markUndone,
  prepareUndo,
  recoverAborted,
  recoverApplied,
  recoverUndone,
} from "./receipt.js";
import {
  reconcileInterruptedReplacement,
  replaceExpectedSource,
  type RecoveryPlan,
  type SourceTransactionFaultStage,
} from "./source-transaction.js";
import { sanitizeTerminalText } from "./terminal.js";

type PatchFaultStage =
  | "after-journal"
  | "after-source-displaced"
  | "after-candidate-installed"
  | "after-source-write"
  | "after-undo-journal"
  | "after-undo-write";

interface PatchExecutionOptions {
  faultStage?: PatchFaultStage;
  beforeSourceReplacement?: () => void;
  beforeUndoReplacement?: () => void;
  recoveryLimits?: RecoveryAdmissionLimits;
}

interface VerifyExecutionOptions {
  afterReceiptRead?: () => void;
}

function assertAutomaticWritesSupported(): void {
  const reason = automaticWriteBlockReason();
  if (reason) throw new Error(reason);
}

export interface CandidateVerification {
  valid: boolean;
  reasons: string[];
  candidate: string;
  beforeTokenHash: string;
  afterTokenHash: string;
  beforeSyntaxTreeHash: string;
  afterSyntaxTreeHash: string;
  beforeProtectedCommentHash: string;
  afterProtectedCommentHash: string;
}

interface FindingEdit {
  finding: Finding;
  start: number;
  end: number;
  replacement: string;
}

function editForFinding(content: string, finding: Finding): FindingEdit {
  if (finding.action !== "remove-safe" && finding.action !== "rewrite-safe") {
    throw new Error(`Finding ${finding.id} is not eligible for an automatic comment fix.`);
  }
  if (content.slice(finding.commentStart, finding.commentEnd) !== finding.original) {
    throw new Error(`Finding ${finding.id} no longer matches the source comment.`);
  }
  if (finding.action === "remove-safe") {
    return {
      finding,
      start: finding.removeStart,
      end: finding.removeEnd,
      replacement: "",
    };
  }
  if (!finding.suggestedReplacement) {
    throw new Error(`Finding ${finding.id} has no deterministic replacement.`);
  }
  return {
    finding,
    start: finding.commentStart,
    end: finding.commentEnd,
    replacement: finding.suggestedReplacement,
  };
}

export function buildCandidateForFindings(
  content: string,
  findings: Finding[],
): string {
  if (findings.length === 0) {
    throw new Error("At least one safe finding is required.");
  }

  const edits = findings
    .map((finding) => editForFinding(content, finding))
    .sort((left, right) => left.start - right.start);

  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1];
    const current = edits[index];
    if (previous && current && previous.end > current.start) {
      throw new Error(
        `Findings ${previous.finding.id} and ${current.finding.id} overlap; nothing was written.`,
      );
    }
  }

  let candidate = content;
  for (const edit of [...edits].reverse()) {
    candidate =
      candidate.slice(0, edit.start) + edit.replacement + candidate.slice(edit.end);
  }
  return candidate;
}

export function verifyCandidate(
  relativePath: string,
  original: string,
  candidate: string,
): CandidateVerification {
  const reasons: string[] = [];
  const beforeTokenHash = nonCommentTokenHash(relativePath, original);
  const afterTokenHash = nonCommentTokenHash(relativePath, candidate);
  const beforeSyntaxTreeHash = syntaxTreeHash(relativePath, original);
  const afterSyntaxTreeHash = syntaxTreeHash(relativePath, candidate);
  const beforeProtectedCommentHash = protectedCommentHash(
    extractComments(relativePath, original),
  );
  const afterProtectedCommentHash = protectedCommentHash(
    extractComments(relativePath, candidate),
  );

  if (parseErrorCount(relativePath, original) !== 0) {
    reasons.push("The original file has parse diagnostics; automatic writing is disabled.");
  }
  if (parseErrorCount(relativePath, candidate) !== 0) {
    reasons.push("The candidate file has parse diagnostics.");
  }
  if (beforeTokenHash !== afterTokenHash) {
    reasons.push("Non-comment token sequence changed.");
  }
  if (beforeSyntaxTreeHash !== afterSyntaxTreeHash) {
    reasons.push("Syntax tree changed after ignoring comments and trivia.");
  }
  if (beforeProtectedCommentHash !== afterProtectedCommentHash) {
    reasons.push("A protected comment changed, moved in order, or disappeared.");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    candidate,
    beforeTokenHash,
    afterTokenHash,
    beforeSyntaxTreeHash,
    afterSyntaxTreeHash,
    beforeProtectedCommentHash,
    afterProtectedCommentHash,
  };
}

export function previewFinding(finding: Finding): string {
  const replacement =
    finding.action === "remove-safe" ? "(remove comment)" : finding.suggestedReplacement;
  return [
    `--- ${sanitizeTerminalText(finding.relativePath)}:${finding.line}`,
    `+++ ${sanitizeTerminalText(finding.relativePath)}:${finding.line}`,
    `- ${sanitizeTerminalText(finding.original)}`,
    `+ ${sanitizeTerminalText(replacement ?? "(no automatic replacement)")}`,
  ].join("\n");
}

export function previewFindings(findings: Finding[]): string {
  return findings.map((finding) => previewFinding(finding)).join("\n\n");
}

function currentFileMode(root: string, relativePath: string): number {
  return statSync(resolveSafeWorkingTreePath(root, relativePath)).mode & 0o777;
}

function readVerifiedBackup(
  store: ReceiptStoreContext,
  receipt: FixReceipt,
  appliedContent: string,
): Uint8Array {
  const bytes = readBackup(store, receipt);
  const beforeContent = decodeUtf8Bytes(
    bytes,
    `Backup for receipt ${receipt.receiptId}`,
  );
  const verification = verifyCandidate(
    receipt.relativePath,
    appliedContent,
    beforeContent,
  );
  if (!verification.valid) {
    throw new Error(
      `Backup for receipt ${receipt.receiptId} is not semantically reversible: ${verification.reasons.join(" ")}`,
    );
  }
  return bytes;
}

export function applyFindings(
  root: string,
  findings: Finding[],
  analysisScope: Scope = { kind: "worktree" },
  options: PatchExecutionOptions = {},
): FixReceipt {
  if (analysisScope.kind !== "worktree") {
    throw new Error(
      "Automatic fixes only support --worktree. Staged and base scopes are read-only.",
    );
  }
  assertAutomaticWritesSupported();
  const first = findings[0];
  if (!first) {
    throw new Error("At least one safe finding is required.");
  }
  const findingIds = new Set(findings.map((finding) => finding.id));
  if (findingIds.size !== findings.length) {
    throw new Error("Duplicate finding IDs are not allowed.");
  }
  if (findings.some((finding) => finding.relativePath !== first.relativePath)) {
    throw new Error("A batch fix must target exactly one file.");
  }
  if (findings.some((finding) => finding.sourceHash !== first.sourceHash)) {
    throw new Error("A batch fix must come from one analysis snapshot.");
  }
  if (!supportsAutomaticFixes(first.relativePath)) {
    throw new Error(
      `Automatic fixes are unavailable for the ${first.relativePath} language adapter.`,
    );
  }

  const receiptId = randomUUID();
  const store = createReceiptStore(root);
  const releaseLock = acquireRepositoryWriteLock(store, first.relativePath, receiptId);
  try {
    const repositoryId = initializeReceiptStoreForWrite(store);
    const current = readWorkingTreeContent(root, first.relativePath);
    if (sha256(current) !== first.sourceHash) {
      throw new Error(
        `File changed after analysis: ${first.relativePath}. Re-run check before applying.`,
      );
    }

    const candidate = buildCandidateForFindings(current, findings);
    const verification = verifyCandidate(first.relativePath, current, candidate);
    if (!verification.valid) {
      throw new Error(`Patch verification refused: ${verification.reasons.join(" ")}`);
    }

    const fileMode = currentFileMode(root, first.relativePath);
    const beforeBytes = Buffer.from(current, "utf8");
    const afterBytes = Buffer.from(candidate, "utf8");
    const preparedReceipt: PreparedFixReceipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      receiptId,
      repositoryId,
      status: "prepared",
      findingIds: findings.map((finding) => finding.id),
      relativePath: first.relativePath,
      analysisScope,
      writeTarget: "worktree",
      preparedAt: new Date().toISOString(),
      fileMode,
      beforeFileHash: sha256(beforeBytes),
      afterFileHash: sha256(afterBytes),
      nonCommentTokenHash: verification.beforeTokenHash,
      syntaxTreeHash: verification.beforeSyntaxTreeHash,
      protectedCommentHash: verification.beforeProtectedCommentHash,
    };
    assertCanCreateRecoveryRecord(store, beforeBytes.byteLength, options.recoveryLimits);
    writeBackup(store, receiptId, beforeBytes);
    writeReceiptState(store, preparedReceipt);
    if (options.faultStage === "after-journal") {
      throw new Error("Injected failure after the recovery journal was written.");
    }

    if (
      sha256(readWorkingTreeContent(root, first.relativePath)) !== first.sourceHash ||
      currentFileMode(root, first.relativePath) !== fileMode
    ) {
      const abortedReceipt = markAborted(
        preparedReceipt,
        new Date().toISOString(),
        "The source file or its mode changed before replacement.",
      );
      writeReceiptState(store, abortedReceipt);
      throw new Error(
        `File changed while preparing the patch: ${first.relativePath}. Nothing was written.`,
      );
    }

    options.beforeSourceReplacement?.();
    const sourceFaultStage: SourceTransactionFaultStage | undefined =
      options.faultStage === "after-source-displaced" ||
      options.faultStage === "after-candidate-installed"
        ? options.faultStage
        : undefined;
    replaceExpectedSource(
      root,
      first.relativePath,
      afterBytes,
      preparedReceipt.beforeFileHash,
      fileMode,
      receiptId,
      sourceFaultStage,
    );
    if (options.faultStage === "after-source-write") {
      throw new Error("Injected failure after the source file was replaced.");
    }
    const receipt = markApplied(preparedReceipt, new Date().toISOString());
    writeReceiptState(store, receipt);
    return receipt;
  } finally {
    releaseLock();
  }
}

export function applyFinding(
  root: string,
  finding: Finding,
  analysisScope: Scope = { kind: "worktree" },
  options: PatchExecutionOptions = {},
): FixReceipt {
  return applyFindings(root, [finding], analysisScope, options);
}

export function undoLastFix(
  root: string,
  options: PatchExecutionOptions = {},
): FixReceipt {
  assertAutomaticWritesSupported();
  const store = openReceiptStore(root);
  const operationId = randomUUID();
  const releaseLock = acquireRepositoryWriteLock(store, "<latest-receipt>", operationId);
  try {
    const receipt = readLatestReceipt(store);
    if (receipt.status === "undone") {
      throw new Error(`Receipt ${receipt.receiptId} has already been undone.`);
    }
    if (receipt.status === "aborted") {
      throw new Error(`Receipt ${receipt.receiptId} was aborted; no applied fix can be undone.`);
    }
    if (receipt.status !== "applied") {
      throw new Error(
        `Receipt ${receipt.receiptId} is ${receipt.status}; run recover before undo.`,
      );
    }

    const current = readWorkingTreeContent(root, receipt.relativePath);
    const currentHash = sha256(Buffer.from(current, "utf8"));
    if (currentHash !== receipt.afterFileHash) {
      throw new Error(
        `File changed after receipt ${receipt.receiptId}; undo refused to protect newer edits.`,
      );
    }
    if (currentFileMode(root, receipt.relativePath) !== receipt.fileMode) {
      throw new Error(
        `File mode changed after receipt ${receipt.receiptId}; undo refused to overwrite it.`,
      );
    }

    const beforeBytes = readVerifiedBackup(store, receipt, current);
    const undoPreparedReceipt = prepareUndo(
      receipt,
      operationId,
      new Date().toISOString(),
    );
    writeReceiptState(store, undoPreparedReceipt);
    if (options.faultStage === "after-undo-journal") {
      throw new Error("Injected failure after the undo journal was written.");
    }

    if (
      sha256(Buffer.from(readWorkingTreeContent(root, receipt.relativePath), "utf8")) !==
        receipt.afterFileHash ||
      currentFileMode(root, receipt.relativePath) !== receipt.fileMode
    ) {
      throw new Error(
        `File changed while preparing undo for receipt ${receipt.receiptId}; nothing was written.`,
      );
    }
    options.beforeUndoReplacement?.();
    const sourceFaultStage: SourceTransactionFaultStage | undefined =
      options.faultStage === "after-source-displaced" ||
      options.faultStage === "after-candidate-installed"
        ? options.faultStage
        : undefined;
    replaceExpectedSource(
      root,
      receipt.relativePath,
      beforeBytes,
      receipt.afterFileHash,
      receipt.fileMode,
      operationId,
      sourceFaultStage,
    );
    if (options.faultStage === "after-undo-write") {
      throw new Error("Injected failure after the original bytes were restored.");
    }

    const undoneReceipt = markUndone(undoPreparedReceipt, new Date().toISOString());
    writeReceiptState(store, undoneReceipt);
    return undoneReceipt;
  } finally {
    releaseLock();
  }
}

export function recoverLastFix(root: string): FixReceipt {
  assertAutomaticWritesSupported();
  const store = openReceiptStore(root);
  const operationId = randomUUID();
  const releaseLock = acquireRepositoryWriteLock(
    store,
    "<latest-receipt>",
    operationId,
    true,
  );
  try {
    const receipt = readLatestReceipt(store);
    if (receipt.status !== "prepared" && receipt.status !== "undo-prepared") {
      throw new Error(
        `Receipt ${receipt.receiptId} is ${receipt.status} and does not need recovery.`,
      );
    }

    const recoveryPlan: RecoveryPlan = {
      receiptId: receipt.receiptId,
      relativePath: receipt.relativePath,
      operationId:
        receipt.status === "prepared" ? receipt.receiptId : receipt.undoOperationId,
      capturedHash:
        receipt.status === "prepared" ? receipt.beforeFileHash : receipt.afterFileHash,
      installedHash:
        receipt.status === "prepared" ? receipt.afterFileHash : receipt.beforeFileHash,
      expectedMode: receipt.fileMode,
    };
    reconcileInterruptedReplacement(root, recoveryPlan);
    const current = readWorkingTreeContent(root, receipt.relativePath);
    const currentHash = sha256(Buffer.from(current, "utf8"));
    const currentMode = currentFileMode(root, receipt.relativePath);
    if (currentMode !== receipt.fileMode) {
      throw new Error(
        `File mode does not match receipt ${receipt.receiptId}; recovery refused.`,
      );
    }

    const validateAppliedSide = (): void => {
      readVerifiedBackup(store, receipt, current);
    };

    const recoveredAt = new Date().toISOString();
    let recovered: FixReceipt;
    if (receipt.status === "prepared" && currentHash === receipt.beforeFileHash) {
      recovered = recoverAborted(
        receipt,
        recoveredAt,
        "Recovery confirmed the source replacement never occurred.",
      );
    } else if (receipt.status === "prepared" && currentHash === receipt.afterFileHash) {
      validateAppliedSide();
      recovered = recoverApplied(receipt, recoveredAt);
    } else if (
      receipt.status === "undo-prepared" &&
      currentHash === receipt.beforeFileHash
    ) {
      recovered = recoverUndone(receipt, recoveredAt);
    } else if (
      receipt.status === "undo-prepared" &&
      currentHash === receipt.afterFileHash
    ) {
      validateAppliedSide();
      recovered = recoverApplied(receipt, recoveredAt);
    } else {
      throw new Error(
        `File bytes match neither side of receipt ${receipt.receiptId}; recovery refused.`,
      );
    }

    writeReceiptState(store, recovered);
    return recovered;
  } finally {
    releaseLock();
  }
}

export function verifyLastFix(
  root: string,
  target: "worktree" | "staged" = "worktree",
  options: VerifyExecutionOptions = {},
): { valid: boolean; reasons: string[]; receipt: FixReceipt; target: "worktree" | "staged" } {
  const store = openReceiptStore(root);
  const receipt = readLatestReceipt(store);
  const receiptSnapshotHash = sha256(JSON.stringify(receipt));
  options.afterReceiptRead?.();
  const current =
    target === "staged"
      ? readIndexContent(root, receipt.relativePath)
      : readWorkingTreeContent(root, receipt.relativePath);
  const initialMode =
    target === "worktree" ? currentFileMode(root, receipt.relativePath) : undefined;
  const reasons: string[] = [];

  if (receipt.status !== "applied") {
    reasons.push(
      `Only an applied receipt can verify; the latest journal is ${receipt.status}. Run recover for an interrupted state.`,
    );
  }

  if (sha256(current) !== receipt.afterFileHash) {
    reasons.push("The file no longer matches the applied patch receipt.");
  }
  if (nonCommentTokenHash(receipt.relativePath, current) !== receipt.nonCommentTokenHash) {
    reasons.push("The non-comment token sequence differs from the pre-fix sequence.");
  }
  if (syntaxTreeHash(receipt.relativePath, current) !== receipt.syntaxTreeHash) {
    reasons.push("The syntax tree differs from the pre-fix tree.");
  }
  if (
    protectedCommentHash(extractComments(receipt.relativePath, current)) !==
    receipt.protectedCommentHash
  ) {
    reasons.push("Protected comments differ from the pre-fix sequence.");
  }
  if (parseErrorCount(receipt.relativePath, current) !== 0) {
    reasons.push("The current file has parse diagnostics.");
  }
  if (
    target === "worktree" &&
    initialMode !== receipt.fileMode
  ) {
    reasons.push("The working-tree file mode differs from the applied fix receipt.");
  }

  const latestAfterVerification = readLatestReceipt(store);
  if (sha256(JSON.stringify(latestAfterVerification)) !== receiptSnapshotHash) {
    reasons.push("The latest fix receipt changed during verification.");
  }
  const currentAfterVerification =
    target === "staged"
      ? readIndexContent(root, receipt.relativePath)
      : readWorkingTreeContent(root, receipt.relativePath);
  if (
    sha256(Buffer.from(currentAfterVerification, "utf8")) !==
    sha256(Buffer.from(current, "utf8"))
  ) {
    reasons.push("The verification target changed during verification.");
  }
  if (
    target === "worktree" &&
    currentFileMode(root, receipt.relativePath) !== initialMode
  ) {
    reasons.push("The working-tree file mode changed during verification.");
  }

  return { valid: reasons.length === 0, reasons, receipt, target };
}
