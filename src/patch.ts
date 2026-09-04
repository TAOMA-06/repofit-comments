import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import {
  extractComments,
  nonCommentTokenHash,
  parseErrorCount,
  syntaxTreeHash,
} from "./analyzer.js";
import {
  getAbsoluteGitDirectory,
  readIndexContent,
  readWorkingTreeContent,
  resolveSafeWorkingTreePath,
} from "./git.js";
import { sha256 } from "./hash.js";
import type { Finding, FixReceipt, Scope } from "./model.js";
import { RECEIPT_SCHEMA_VERSION } from "./model.js";
import { protectedCommentHash } from "./protection.js";
import { sanitizeTerminalText } from "./terminal.js";

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

function candidateForFindings(content: string, findings: Finding[]): string {
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

function receiptPath(root: string): string {
  return join(getAbsoluteGitDirectory(root), "repofit-comments", "last-fix.json");
}

function writeReceipt(root: string, receipt: FixReceipt): void {
  const path = receiptPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function atomicWrite(root: string, relativePath: string, content: string): void {
  const path = resolveSafeWorkingTreePath(root, relativePath);
  const directory = dirname(path);
  const temporaryPath = join(
    directory,
    `.${basename(path)}.repofit-${process.pid}-${Date.now()}.tmp`,
  );
  const sourceMetadata = lstatSync(path);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
    throw new Error("Refusing to replace a symbolic link or non-regular file.");
  }
  const mode = statSync(path).mode;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", mode);
    writeFileSync(descriptor, content, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath);
    }
  }
}

export function applyFindings(
  root: string,
  findings: Finding[],
  analysisScope: Scope = { kind: "worktree" },
): FixReceipt {
  if (analysisScope.kind !== "worktree") {
    throw new Error(
      "Automatic fixes only support --worktree. Staged and base scopes are read-only.",
    );
  }
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

  const current = readWorkingTreeContent(root, first.relativePath);
  if (sha256(current) !== first.sourceHash) {
    throw new Error(
      `File changed after analysis: ${first.relativePath}. Re-run check before applying.`,
    );
  }

  const candidate = candidateForFindings(current, findings);
  const verification = verifyCandidate(first.relativePath, current, candidate);
  if (!verification.valid) {
    throw new Error(`Patch verification refused: ${verification.reasons.join(" ")}`);
  }

  // Re-check immediately before the atomic replacement to avoid overwriting an intervening edit.
  if (sha256(readWorkingTreeContent(root, first.relativePath)) !== first.sourceHash) {
    throw new Error(
      `File changed while preparing the patch: ${first.relativePath}. Nothing was written.`,
    );
  }

  atomicWrite(root, first.relativePath, candidate);
  const receipt: FixReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    findingIds: findings.map((finding) => finding.id),
    relativePath: first.relativePath,
    analysisScope,
    writeTarget: "worktree",
    appliedAt: new Date().toISOString(),
    beforeFileHash: first.sourceHash,
    afterFileHash: sha256(candidate),
    nonCommentTokenHash: verification.beforeTokenHash,
    syntaxTreeHash: verification.beforeSyntaxTreeHash,
    protectedCommentHash: verification.beforeProtectedCommentHash,
  };
  writeReceipt(root, receipt);
  return receipt;
}

export function applyFinding(
  root: string,
  finding: Finding,
  analysisScope: Scope = { kind: "worktree" },
): FixReceipt {
  return applyFindings(root, [finding], analysisScope);
}

export function verifyLastFix(
  root: string,
  target: "worktree" | "staged" = "worktree",
): { valid: boolean; reasons: string[]; receipt: FixReceipt; target: "worktree" | "staged" } {
  const path = receiptPath(root);
  if (!existsSync(path)) {
    throw new Error("No RepoFit fix receipt found in this repository.");
  }
  const receipt = JSON.parse(readFileSync(path, "utf8")) as FixReceipt;
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported fix receipt schema: ${receipt.schemaVersion ?? "(missing)"}. Re-run the fix with this RepoFit version.`,
    );
  }
  const current =
    target === "staged"
      ? readIndexContent(root, receipt.relativePath)
      : readWorkingTreeContent(root, receipt.relativePath);
  const reasons: string[] = [];

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

  return { valid: reasons.length === 0, reasons, receipt, target };
}
