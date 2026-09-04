export const REPORT_SCHEMA_VERSION = "1.0";
export const RECEIPT_SCHEMA_VERSION = "2.0";

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

export interface Finding {
  id: string;
  ruleId: string;
  category: string;
  action: FindingAction;
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
  findings: Finding[];
  parseErrorCount: number;
}

export interface AnalysisReport {
  schemaVersion: string;
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

export interface FixReceipt {
  schemaVersion: string;
  findingIds: string[];
  relativePath: string;
  analysisScope: Scope;
  writeTarget: "worktree";
  appliedAt: string;
  beforeFileHash: string;
  afterFileHash: string;
  nonCommentTokenHash: string;
  syntaxTreeHash: string;
  protectedCommentHash: string;
}
