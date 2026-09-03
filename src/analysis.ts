import { extractComments, parseErrorCount } from "./analyzer.js";
import { collectScopedFiles } from "./git.js";
import type { AnalysisReport, FileAnalysis, Scope } from "./model.js";
import { REPORT_SCHEMA_VERSION } from "./model.js";
import { buildStyleProfile } from "./profile.js";
import { analyzeComments } from "./rules.js";

const DISPLAYED_FINDING_LIMIT = 5;

export function analyzeRepository(root: string, scope: Scope): AnalysisReport {
  const files = collectScopedFiles(root, scope);
  const profile = buildStyleProfile(
    root,
    files.map((file) => file.relativePath),
  );
  const analyses: FileAnalysis[] = files.map((file) => {
    const comments = extractComments(file.relativePath, file.content, file.addedRanges);
    const changedLineCount = file.addedRanges.reduce(
      (total, range) => total + range.end - range.start + 1,
      0,
    );
    const result = analyzeComments(comments, file.sourceHash, profile, changedLineCount);
    return {
      file,
      comments,
      protectedCount: result.protectedCount,
      findings: result.findings,
      parseErrorCount: parseErrorCount(file.relativePath, file.content),
    };
  });

  const findings = analyses.flatMap((analysis) => analysis.findings);
  const changedCommentCount = analyses.reduce(
    (total, analysis) => total + analysis.comments.length,
    0,
  );
  const protectedCommentCount = analyses.reduce(
    (total, analysis) => total + analysis.protectedCount,
    0,
  );
  const parseErrors = analyses.reduce(
    (total, analysis) => total + analysis.parseErrorCount,
    0,
  );

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repositoryRoot: root,
    scope,
    profile,
    files: analyses.map((analysis) => ({
      relativePath: analysis.file.relativePath,
      changedCommentCount: analysis.comments.length,
      protectedCommentCount: analysis.protectedCount,
      parseErrorCount: analysis.parseErrorCount,
    })),
    findings,
    summary: {
      analyzedFileCount: analyses.length,
      changedCommentCount,
      protectedCommentCount,
      removeSafeCount: findings.filter((finding) => finding.action === "remove-safe").length,
      rewriteSafeCount: findings.filter((finding) => finding.action === "rewrite-safe").length,
      rewriteSuggestedCount: findings.filter(
        (finding) => finding.action === "rewrite-suggested",
      ).length,
      parseErrorCount: parseErrors,
      displayedFindingLimit: DISPLAYED_FINDING_LIMIT,
    },
  };
}
