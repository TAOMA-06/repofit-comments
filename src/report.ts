import type { AnalysisReport, Finding, StyleProfile } from "./model.js";
import { scopeLabel } from "./git.js";
import { previewFinding } from "./patch.js";
import { sanitizeTerminalText } from "./terminal.js";

export function renderProfile(profile: StyleProfile): string {
  const density = (profile.commentDensity * 100).toFixed(1);
  return [
    `Style baseline: ${profile.status}`,
    `Reference files: ${profile.sampleFileCount}`,
    `Reference comments: ${profile.commentCount}`,
    `Comment density: ${density} per 100 code lines`,
    `Average comment length: ${profile.averageCommentLength.toFixed(1)} characters`,
    `Dominant comment language: ${profile.dominantLanguage}`,
  ].join("\n");
}

export function renderFinding(finding: Finding, includePreview = false): string {
  const lines = [
    `[${sanitizeTerminalText(finding.action)}] ${sanitizeTerminalText(finding.id)} ${sanitizeTerminalText(finding.ruleId)}`,
    `  at ${sanitizeTerminalText(finding.relativePath)}:${finding.line}`,
    `  ${sanitizeTerminalText(finding.original)}`,
    `  Why: ${sanitizeTerminalText(finding.reason)}`,
  ];

  if (finding.suggestedReplacement) {
    lines.push(`  Suggestion: ${sanitizeTerminalText(finding.suggestedReplacement)}`);
  }
  for (const evidence of finding.evidence.slice(0, 2)) {
    lines.push(`  Evidence: ${sanitizeTerminalText(evidence)}`);
  }
  if (includePreview) {
    lines.push("", previewFinding(finding));
  }
  return lines.join("\n");
}

export function renderReport(report: AnalysisReport, includePreview = false): string {
  const limit = report.summary.displayedFindingLimit;
  const displayed = report.findings.slice(0, limit);
  const lines = [
    "RepoFit Comments",
    "AI-style means a presentation pattern, not proof of authorship.",
    `Scope: ${sanitizeTerminalText(scopeLabel(report.scope))}`,
    `Files analyzed: ${report.summary.analyzedFileCount}`,
    `Changed comments: ${report.summary.changedCommentCount}`,
    `Protected comments: ${report.summary.protectedCommentCount}`,
    `Safe removals: ${report.summary.removeSafeCount}`,
    `Safe rewrites: ${report.summary.rewriteSafeCount}`,
    `Rewrite suggestions: ${report.summary.rewriteSuggestedCount}`,
    `Parse diagnostics: ${report.summary.parseErrorCount}`,
    "",
    renderProfile(report.profile),
  ];

  if (displayed.length === 0) {
    lines.push("", "No actionable comment-style traces found in the selected diff.");
    return lines.join("\n");
  }

  lines.push("", "Findings:");
  for (const finding of displayed) {
    lines.push("", renderFinding(finding, includePreview));
  }

  if (report.findings.length > displayed.length) {
    lines.push(
      "",
      `${report.findings.length - displayed.length} additional finding(s) omitted from terminal output; use --format json for all results.`,
    );
  }

  return lines.join("\n");
}
