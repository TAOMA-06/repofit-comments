import type { AnalysisReport, Finding, StyleProfile } from "./model.js";
import { scopeLabel } from "./git.js";
import { previewFinding } from "./patch.js";
import { sanitizeTerminalText } from "./terminal.js";

export function renderProfile(
  profile: StyleProfile,
  language: "en" | "zh" = "en",
): string {
  const density = (profile.commentDensity * 100).toFixed(1);
  if (language === "zh") {
    return [
      `风格基线：${profile.status}`,
      `参考文件：${profile.sampleFileCount}`,
      `参考注释：${profile.commentCount}`,
      `注释密度：每 100 行代码 ${density} 条`,
      `平均注释长度：${profile.averageCommentLength.toFixed(1)} 个字符`,
      `主要注释语言：${profile.dominantLanguage}`,
    ].join("\n");
  }
  return [
    `Style baseline: ${profile.status}`,
    `Reference files: ${profile.sampleFileCount}`,
    `Reference comments: ${profile.commentCount}`,
    `Comment density: ${density} per 100 code lines`,
    `Average comment length: ${profile.averageCommentLength.toFixed(1)} characters`,
    `Dominant comment language: ${profile.dominantLanguage}`,
  ].join("\n");
}

export function renderFinding(
  finding: Finding,
  includePreview = false,
  language: "en" | "zh" = "en",
): string {
  const locationLabel = language === "zh" ? "位置" : "at";
  const fingerprintLabel = language === "zh" ? "稳定指纹" : "Fingerprint";
  const whyLabel = language === "zh" ? "原因" : "Why";
  const suggestionLabel = language === "zh" ? "建议" : "Suggestion";
  const evidenceLabel = language === "zh" ? "证据" : "Evidence";
  const lines = [
    `[${sanitizeTerminalText(finding.level)}/${sanitizeTerminalText(finding.action)}] ${sanitizeTerminalText(finding.id)} ${sanitizeTerminalText(finding.ruleId)}`,
    `  ${fingerprintLabel}: ${sanitizeTerminalText(finding.fingerprint)}`,
    `  ${locationLabel} ${sanitizeTerminalText(finding.relativePath)}:${finding.line}`,
    `  ${sanitizeTerminalText(finding.original)}`,
    `  ${whyLabel}: ${sanitizeTerminalText(finding.reason)}`,
  ];

  if (finding.suggestedReplacement) {
    lines.push(`  ${suggestionLabel}: ${sanitizeTerminalText(finding.suggestedReplacement)}`);
  }
  for (const evidence of finding.evidence.slice(0, 2)) {
    lines.push(`  ${evidenceLabel}: ${sanitizeTerminalText(evidence)}`);
  }
  if (includePreview) {
    lines.push("", previewFinding(finding));
  }
  return lines.join("\n");
}

export function renderReport(
  report: AnalysisReport,
  includePreview = false,
  language: "en" | "zh" = "en",
): string {
  const limit = report.summary.displayedFindingLimit;
  const displayed = report.findings.slice(0, limit);
  const lines = language === "zh" ? [
    "RepoFit Comments",
    "AI 风格表示表达模式，不代表作者身份判断。",
    `范围：${sanitizeTerminalText(scopeLabel(report.scope))}`,
    `已分析文件：${report.summary.analyzedFileCount}`,
    `变更注释：${report.summary.changedCommentCount}`,
    `受保护注释：${report.summary.protectedCommentCount}`,
    `已抑制发现：${report.suppressions.length}`,
    `安全删除：${report.summary.removeSafeCount}`,
    `安全改写：${report.summary.rewriteSafeCount}`,
    `改写建议：${report.summary.rewriteSuggestedCount}`,
    `解析诊断：${report.summary.parseErrorCount}`,
    "",
    renderProfile(report.profile, language),
  ] : [
    "RepoFit Comments",
    "AI-style means a presentation pattern, not proof of authorship.",
    `Scope: ${sanitizeTerminalText(scopeLabel(report.scope))}`,
    `Files analyzed: ${report.summary.analyzedFileCount}`,
    `Changed comments: ${report.summary.changedCommentCount}`,
    `Protected comments: ${report.summary.protectedCommentCount}`,
    `Suppressed findings: ${report.suppressions.length}`,
    `Safe removals: ${report.summary.removeSafeCount}`,
    `Safe rewrites: ${report.summary.rewriteSafeCount}`,
    `Rewrite suggestions: ${report.summary.rewriteSuggestedCount}`,
    `Parse diagnostics: ${report.summary.parseErrorCount}`,
    "",
    renderProfile(report.profile, language),
  ];

  if (displayed.length === 0) {
    lines.push(
      "",
      language === "zh"
        ? "所选变更中没有可处理的注释表达痕迹。"
        : "No actionable comment-style traces found in the selected diff.",
    );
    const protectedExamples = report.protections.slice(0, 3);
    if (protectedExamples.length > 0) {
      lines.push("", language === "zh" ? "受保护示例：" : "Protected examples:");
      for (const protection of protectedExamples) {
        lines.push(
          `  ${sanitizeTerminalText(protection.relativePath)}:${protection.line} ${sanitizeTerminalText(protection.reason)}`,
        );
      }
    }
    return lines.join("\n");
  }

  lines.push("", language === "zh" ? "发现：" : "Findings:");
  for (const finding of displayed) {
    lines.push("", renderFinding(finding, includePreview, language));
  }

  if (report.findings.length > displayed.length) {
    lines.push(
      "",
      language === "zh"
        ? `终端省略了 ${report.findings.length - displayed.length} 条发现；使用 --format json 查看全部结果。`
        : `${report.findings.length - displayed.length} additional finding(s) omitted from terminal output; use --format json for all results.`,
    );
  }

  const protectedExamples = report.protections.slice(0, 3);
  if (protectedExamples.length > 0) {
    lines.push("", language === "zh" ? "受保护示例：" : "Protected examples:");
    for (const protection of protectedExamples) {
      lines.push(
        `  ${sanitizeTerminalText(protection.relativePath)}:${protection.line} ${sanitizeTerminalText(protection.reason)}`,
      );
    }
  }

  if (report.suppressions.length > 0) {
    lines.push("", language === "zh" ? "已应用抑制：" : "Applied suppressions:");
    for (const suppression of report.suppressions.slice(0, 3)) {
      lines.push(
        `  ${sanitizeTerminalText(suppression.relativePath)}:${suppression.directiveLine} ${sanitizeTerminalText(suppression.ruleId)} -- ${sanitizeTerminalText(suppression.reason)}`,
      );
    }
  }

  return lines.join("\n");
}
