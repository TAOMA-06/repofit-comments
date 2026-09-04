export const REPORT_SCHEMA_VERSION = "2.0";
export const RECEIPT_SCHEMA_VERSION = "3.0";
export const RULE_PACK_VERSION = "1.0.0";

export type Scope =
  | { kind: "staged" }
  | { kind: "worktree" }
  | { kind: "base"; ref: string };

export type CommentKind = "line" | "block" | "doc";

export interface LineRange {
  start: number;
  end: number;
}

export interface ScopedFile {
  relativePath: string;
  absolutePath: string;
  content: string;
  sourceHash: string;
  addedRanges: LineRange[];
}

export interface SourceComment {
  relativePath: string;
  kind: CommentKind;
  raw: string;
  content: string;
  start: number;
  end: number;
  line: number;
  endLine: number;
  standalone: boolean;
  leadingFileComment: boolean;
  removeStart: number;
  removeEnd: number;
  sourceLine: string;
  nextCodeLine: string;
  nextCodeLineNumber?: number;
}

export type FindingAction =
  | "remove-safe"
  | "rewrite-safe"
  | "rewrite-suggested"
  | "keep-protected"
  | "uncertain";

export type FindingLevel = "info" | "warning" | "error";

export interface Finding {
  id: string;
  fingerprint: string;
  ruleId: string;
  category: string;
  action: FindingAction;
  level: FindingLevel;
  relativePath: string;
  line: number;
  endLine: number;
  original: string;
  reason: string;
  evidence: string[];
  suggestedReplacement?: string;
  sourceHash: string;
  commentStart: number;
  commentEnd: number;
  removeStart: number;
  removeEnd: number;
}

export interface ProtectionRecord {
  action: "keep-protected";
  fingerprint: string;
  relativePath: string;
  line: number;
  endLine: number;
  original: string;
  reason: string;
}

export interface SuppressionRecord {
  relativePath: string;
  directiveLine: number;
  targetLine: number;
  ruleId: string;
  reason: string;
}

export interface StyleProfile {
  status: "ready" | "insufficient-style-baseline";
  sampleFileCount: number;
  commentCount: number;
  codeLineCount: number;
  commentDensity: number;
  averageCommentLength: number;
  dominantLanguage: "zh" | "en" | "mixed" | "unknown";
  commonPhrases: Record<string, number>;
  examples: Array<{ relativePath: string; line: number; text: string }>;
}

export interface FileAnalysis {
  file: ScopedFile;
  comments: SourceComment[];
  protectedCount: number;
  protections: ProtectionRecord[];
  suppressions: SuppressionRecord[];
  findings: Finding[];
  parseErrorCount: number;
}

export interface AnalysisReport {
  schemaVersion: string;
  toolVersion?: string;
  rulePackVersion: string;
  generatedAt: string;
  repositoryRoot: string;
  scope: Scope;
  profile: StyleProfile;
  files: Array<{
    relativePath: string;
    changedCommentCount: number;
    protectedCommentCount: number;
    parseErrorCount: number;
  }>;
  findings: Finding[];
  protections: ProtectionRecord[];
  suppressions: SuppressionRecord[];
  summary: {
    analyzedFileCount: number;
    changedCommentCount: number;
    protectedCommentCount: number;
    removeSafeCount: number;
    rewriteSafeCount: number;
    rewriteSuggestedCount: number;
    parseErrorCount: number;
    displayedFindingLimit: number;
  };
}

export type FixReceiptStatus =
  | "prepared"
  | "applied"
  | "undo-prepared"
  | "undone"
  | "aborted";

interface FixReceiptBase {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  repositoryId: string;
  findingIds: string[];
  relativePath: string;
  analysisScope: { kind: "worktree" };
  writeTarget: "worktree";
  preparedAt: string;
  fileMode: number;
  beforeFileHash: string;
  afterFileHash: string;
  nonCommentTokenHash: string;
  syntaxTreeHash: string;
  protectedCommentHash: string;
}

export interface PreparedFixReceipt extends FixReceiptBase {
  status: "prepared";
}

interface AppliedFixReceiptBase extends FixReceiptBase {
  status: "applied";
  appliedAt: string;
}

type RecoveryFields<Action extends string> =
  | { recoveredAt?: never; recoveryAction?: never }
  | { recoveredAt: string; recoveryAction: Action };

export type AppliedFixReceipt = AppliedFixReceiptBase &
  RecoveryFields<"mark-applied">;

export interface UndoPreparedFixReceipt extends FixReceiptBase {
  status: "undo-prepared";
  appliedAt: string;
  undoPreparedAt: string;
  undoOperationId: string;
}

interface UndoneFixReceiptBase extends FixReceiptBase {
  status: "undone";
  appliedAt: string;
  undoPreparedAt: string;
  undoOperationId: string;
  undoneAt: string;
}

export type UndoneFixReceipt = UndoneFixReceiptBase &
  RecoveryFields<"mark-undone">;

interface AbortedFixReceiptBase extends FixReceiptBase {
  status: "aborted";
  abortedAt: string;
  abortReason: string;
}

export type AbortedFixReceipt = AbortedFixReceiptBase &
  RecoveryFields<"mark-aborted">;

export type FixReceipt =
  | PreparedFixReceipt
  | AppliedFixReceipt
  | UndoPreparedFixReceipt
  | UndoneFixReceipt
  | AbortedFixReceipt;
