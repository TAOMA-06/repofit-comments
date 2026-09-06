import {
  extractComments,
  filterCommentsByRanges,
  parseErrorCount,
} from "./analyzer.js";
import {
  DEFAULT_CONFIG,
  type RepoFitConfig,
  type RuleId,
} from "./config.js";
import { collectScopedFiles } from "./git.js";
import { supportsAutomaticFixes } from "./language-registry.js";
import type { AnalysisReport, FileAnalysis, Scope } from "./model.js";
import { REPORT_SCHEMA_VERSION } from "./model.js";
import { buildStyleProfile } from "./profile.js";
import { analyzeComments } from "./rules.js";

const DISPLAYED_FINDING_LIMIT = 5;

export function analyzeRepository(
  root: string,
  scope: Scope,
  config: RepoFitConfig = DEFAULT_CONFIG,
): AnalysisReport {
  const files = collectScopedFiles(root, scope, config);
  const profile = buildStyleProfile(
    root,
    files.map((file) => file.relativePath),
    config,
  );
  const analyses: FileAnalysis[] = [];
  let findingCount = 0;
  for (const file of files) {
    const allComments = extractComments(file.relativePath, file.content);
    const comments = filterCommentsByRanges(allComments, file.addedRanges);
    const changedLineCount = file.addedRanges.reduce(
      (total, range) => total + range.end - range.start + 1,
      0,
    );
    const result = analyzeComments(comments, file.sourceHash, profile, changedLineCount, {
      protectPhrases: config.protect.phrases,
      suppressionComments: allComments,
    });
    const automaticFixes = supportsAutomaticFixes(file.relativePath, file.content);
    const findings = result.findings.flatMap((finding) => {
      const level = config.rules[finding.ruleId as RuleId];
      if (level === "off") return [];
      if (
        !automaticFixes &&
        (finding.action === "remove-safe" || finding.action === "rewrite-safe")
      ) {
        return [{
          ...finding,
          action: "rewrite-suggested" as const,
          level,
          reason: `${finding.reason} Automatic fixes are unavailable for this language adapter.`,
          evidence: [...finding.evidence, "This language currently supports scan and review only."],
        }];
      }
      return [{ ...finding, level }];
    });
    findingCount += findings.length;
    if (findingCount > config.limits.maxFindings) {
      throw new Error(
        `Analysis produced more than limits.maxFindings=${config.limits.maxFindings}; refine the scope or configuration.`,
      );
    }
    analyses.push({
      file,
      comments,
      protectedCount: result.protectedCount,
      protections: result.protections,
      suppressions: result.suppressions,
      findings,
      parseErrorCount: parseErrorCount(file.relativePath, file.content),
    });
  }

  const findings = analyses.flatMap((analysis) => analysis.findings);
  const protections = analyses.flatMap((analysis) => analysis.protections);
  const suppressions = analyses.flatMap((analysis) => analysis.suppressions);
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
    rulePackVersion: config.rulePackVersion,
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
    protections,
    suppressions,
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
