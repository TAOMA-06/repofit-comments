import { shortHash } from "./hash.js";
import type {
  Finding,
  FindingLevel,
  ProtectionRecord,
  SourceComment,
  StyleProfile,
  SuppressionRecord,
} from "./model.js";
import {
  commentLanguage,
  lineCommentPrefix,
  LEADING_COMMENT_PROTECTION_REASON,
  normalizeComment,
  protectedReason,
  RATIONALE_PROTECTION_REASON,
  stepNarrationReplacement,
} from "./protection.js";
import { ruleDefinition } from "./rule-catalog.js";

const GENERIC_HEADING_PATTERN = /^(?:(?:main|core|business|implementation|validation|processing|error handling)\s+logic|(?:helper|utility)\s+(?:functions?|methods?)|主要逻辑|核心逻辑|辅助函数|处理逻辑)$/i;
const DECORATION_ONLY_PATTERN = /^(?:[-=*_#~]{3,}|[\u2500-\u257f]{3,})$/u;
const STEP_ONLY_PATTERN = /^(?:(?:step|phase|part)\s*(?:\d+|one|two|three|four|five)?|next|then|finally|first|second|third|步骤\s*[一二三四五六七八九十\d]*|下一步|接下来|最后|首先|然后)[:：.\-\s]*$/i;
const META_PREFIX_PATTERN = /^(?:we\s+(?:need|want|will|can|should)\s+to|here\s+we|now\s+we|this\s+(?:function|method|code|block)\s+(?:will|is\s+used\s+to|is\s+responsible\s+for)|for\s+simplicity[,\s]*|in\s+production[,\s]*(?:you\s+)?(?:may|might|should)(?:\s+want\s+to)?|我们需要|接下来我们|这里我们|这个函数将|为了简化)[,:：\s-]*/i;
const TUTORIAL_PATTERN = /\b(?:this means that|as you can see|in other words|essentially|basically|simply put|the following code|this line of code|note that)\b|(?:也就是说|如你所见|简单来说|下面的代码|这行代码|需要注意的是)/i;
const ACTION_NARRATION_PATTERN = /^(?:(?:create|update|clean\s*up|calculate|compute|generate|initialize|set|add|append|remove|check|validate|re-?validate|process|handle|render|fetch|parse|convert|build|define|import|export|call|iterate|loop|sort|filter|map|merge|materialize|copy|clone|freeze)\b|(?:创建|更新|清理|计算|生成|初始化|设置|添加|追加|删除|检查|校验|重新校验|处理|渲染|获取|解析|转换|构建|定义|导入|导出|调用|遍历|排序|过滤|映射|合并|具象化|复制|克隆|冻结))/i;
const LABEL_NARRATION_PATTERN = /^(?:new|existing|current|final)\s+[A-Za-z_$][\w$ ]{0,40}\s*:\s*\S+/i;
const SUPPRESSION_PATTERN = /^repofit-ignore-next-line(?:\s+(comments\.[a-z0-9-]+|\*))?\s+--\s+(\S.*)$/i;

function defaultLevel(action: Finding["action"]): FindingLevel {
  return action === "remove-safe" || action === "rewrite-safe"
    ? "error"
    : action === "rewrite-suggested"
      ? "warning"
      : "info";
}

function repoUsesPhrase(profile: StyleProfile, normalized: string): boolean {
  return (profile.commonPhrases[normalized] ?? 0) >= 3;
}

function baseEvidence(profile: StyleProfile): string[] {
  if (profile.status !== "ready") {
    return [
      `Repository style baseline is incomplete (${profile.sampleFileCount} files, ${profile.commentCount} ordinary comments); repository-specific conclusions are disabled, while deterministic removals and review-only heuristics may still appear.`,
    ];
  }

  const evidence = [
    `Repository baseline: ${(profile.commentDensity * 100).toFixed(1)} comments per 100 code lines; average comment length ${profile.averageCommentLength.toFixed(1)} characters.`,
  ];
  const example = profile.examples[0];
  if (example) {
    evidence.push(`Nearby repository example: ${example.relativePath}:${example.line} ${example.text}`);
  }
  return evidence;
}

function createFinding(
  comment: SourceComment,
  sourceHash: string,
  profile: StyleProfile,
  details: {
    ruleId: string;
    category: string;
    action: Finding["action"];
    reason: string;
    suggestedReplacement?: string;
    evidence?: string[];
  },
): Finding {
  const stableIdentity = [
    comment.relativePath,
    details.ruleId,
    normalizeComment(comment.content),
    normalizeComment(comment.nextCodeLine),
    comment.standalone ? "standalone" : "inline",
  ].join("\u0000");
  const fingerprint = `RF-FP-${shortHash(stableIdentity).toUpperCase()}`;
  const snapshotIdentity = [
    fingerprint,
    sourceHash,
    comment.line,
    comment.start,
    comment.end,
  ].join("\u0000");

  return {
    id: `RF-COM-${shortHash(snapshotIdentity).toUpperCase()}`,
    fingerprint,
    ruleId: details.ruleId,
    category: details.category,
    action: details.action,
    level: ruleDefinition(details.ruleId)?.defaultLevel ?? defaultLevel(details.action),
    relativePath: comment.relativePath,
    line: comment.line,
    endLine: comment.endLine,
    original: comment.raw,
    reason: details.reason,
    evidence: [...(details.evidence ?? []), ...baseEvidence(profile)],
    ...(details.suggestedReplacement === undefined
      ? {}
      : { suggestedReplacement: details.suggestedReplacement }),
    sourceHash,
    commentStart: comment.start,
    commentEnd: comment.end,
    removeStart: comment.removeStart,
    removeEnd: comment.removeEnd,
  };
}

function simpleRestatement(comment: SourceComment): string | undefined {
  const words = normalizeComment(comment.content);
  const code = comment.nextCodeLine.trim();

  const returnMatch = /^return\s+([A-Za-z_$][\w$]*)\s*;?$/.exec(code);
  if (returnMatch) {
    const name = returnMatch[1]?.toLowerCase();
    if (
      name &&
      (words === `return ${name}` ||
        words === `returns ${name}` ||
        words === `return the ${name}` ||
        words === `返回${name}` ||
        words === `返回 ${name}`)
    ) {
      return `The comment only restates the following \`return ${name}\` statement.`;
    }
  }

  const counterMatch = /^([A-Za-z_$][\w$]*)\s*(\+\+|--)\s*;?$/.exec(code);
  if (counterMatch) {
    const name = counterMatch[1]?.toLowerCase();
    const verb = counterMatch[2] === "++" ? "increment" : "decrement";
    const chineseVerb = counterMatch[2] === "++" ? "增加" : "减少";
    if (
      name &&
      (words === `${verb} ${name}` ||
        words === `${verb} the ${name}` ||
        words === `${chineseVerb}${name}` ||
        words === `${chineseVerb} ${name}`)
    ) {
      return `The comment only restates the following \`${name}${counterMatch[2]}\` operation.`;
    }
  }

  return undefined;
}

function shortenedMetaComment(comment: SourceComment): string | undefined {
  const shortened = comment.content.replace(META_PREFIX_PATTERN, "").trim();
  if (!shortened || shortened === comment.content) {
    return undefined;
  }
  return `${lineCommentPrefix(comment.raw)} ${shortened}`;
}

export function analyzeComments(
  comments: SourceComment[],
  sourceHash: string,
  profile: StyleProfile,
  changedLineCount: number,
  options: {
    protectPhrases?: readonly string[];
    suppressionComments?: readonly SourceComment[];
  } = {},
): {
  findings: Finding[];
  protections: ProtectionRecord[];
  suppressions: SuppressionRecord[];
  protectedCount: number;
} {
  const findings: Finding[] = [];
  const protections: ProtectionRecord[] = [];
  const suppressions: SuppressionRecord[] = [];
  const recentPhrases = new Map<string, SourceComment>();
  const protectionByComment = new Map(
    comments.map((comment) => [
      comment,
      protectedReason(comment, options.protectPhrases ?? []),
    ]),
  );
  const suppressionByLine = new Map<
    number,
    { directiveLine: number; ruleId: string; reason: string }
  >();
  for (const comment of options.suppressionComments ?? comments) {
    const match = SUPPRESSION_PATTERN.exec(comment.content.trim());
    const reason = match?.[2]?.trim();
    if (match && reason) {
      suppressionByLine.set(comment.endLine + 1, {
        directiveLine: comment.line,
        ruleId: match[1] ?? "*",
        reason,
      });
    }
  }
  const pushFinding = (finding: Finding): void => {
    const suppression = suppressionByLine.get(finding.line);
    if (
      suppression &&
      (suppression.ruleId === "*" || suppression.ruleId === finding.ruleId)
    ) {
      suppressions.push({
        relativePath: finding.relativePath,
        directiveLine: suppression.directiveLine,
        targetLine: finding.line,
        ruleId: finding.ruleId,
        reason: suppression.reason,
      });
      return;
    }
    findings.push(finding);
  };

  for (const comment of comments) {
    const protection = protectionByComment.get(comment);
    const stepReplacement = stepNarrationReplacement(comment);
    const canStripStepPrefix =
      stepReplacement !== undefined &&
      (protection === undefined ||
        protection === RATIONALE_PROTECTION_REASON ||
        protection === LEADING_COMMENT_PROTECTION_REASON);
    if (protection && !canStripStepPrefix) {
      protections.push({
        action: "keep-protected",
        fingerprint: `RF-PRO-${shortHash(
          [comment.relativePath, normalizeComment(comment.content), protection].join("\u0000"),
        ).toUpperCase()}`,
        relativePath: comment.relativePath,
        line: comment.line,
        endLine: comment.endLine,
        original: comment.raw,
        reason: protection,
      });
      continue;
    }

    const normalized = normalizeComment(comment.content);
    if (!normalized || repoUsesPhrase(profile, normalized)) {
      continue;
    }

    const previous = recentPhrases.get(normalized);
    if (previous && comment.line - previous.endLine <= 5 && comment.standalone) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.nearby-duplicate",
          category: "Repeated narration",
          action: "remove-safe",
          reason: "The same standalone comment already appears in the nearby code block.",
          evidence: [`Previous identical comment: line ${previous.line}.`],
        }),
      );
      continue;
    }
    recentPhrases.set(normalized, comment);

    if (
      comment.standalone &&
      (DECORATION_ONLY_PATTERN.test(comment.content.trim()) ||
        GENERIC_HEADING_PATTERN.test(normalized))
    ) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.decorative-heading",
          category: "Decorative section heading",
          action: "remove-safe",
          reason: "This standalone heading adds layout or process narration but no repository-specific intent.",
        }),
      );
      continue;
    }

    if (comment.standalone && STEP_ONLY_PATTERN.test(comment.content.trim())) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.step-label",
          category: "Template step label",
          action: "remove-safe",
          reason: "This comment is only a generated step marker and carries no implementation rationale.",
        }),
      );
      continue;
    }

    if (canStripStepPrefix) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.step-narration",
          category: "Generated step narration",
          action: "rewrite-safe",
          reason: "The numbered step narrates implementation order instead of preserving a non-obvious repository constraint.",
          suggestedReplacement: stepReplacement,
        }),
      );
      continue;
    }

    const restatement = simpleRestatement(comment);
    if (comment.standalone && restatement) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.code-restatement",
          category: "Line-by-line restatement",
          action: "remove-safe",
          reason: restatement,
          evidence: [`Following code at line ${comment.nextCodeLineNumber ?? "?"}: ${comment.nextCodeLine}`],
        }),
      );
      continue;
    }

    if (META_PREFIX_PATTERN.test(comment.content)) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.meta-narration",
          category: "Generated meta-narration",
          action: "rewrite-suggested",
          reason: "The comment narrates the generation process instead of recording repository-specific intent.",
          suggestedReplacement: shortenedMetaComment(comment) ?? "Remove after confirming it contains no unique rationale.",
        }),
      );
      continue;
    }

    if (
      ACTION_NARRATION_PATTERN.test(comment.content.trim()) ||
      LABEL_NARRATION_PATTERN.test(comment.content.trim())
    ) {
      const adjacentCode = comment.standalone
        ? `Following code at line ${comment.nextCodeLineNumber ?? "?"}: ${comment.nextCodeLine}`
        : `Inline code at line ${comment.line}: ${comment.sourceLine.replace(comment.raw, "").trim()}`;
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.action-narration",
          category: "Action-by-action narration",
          action: "rewrite-suggested",
          reason: "The comment narrates the adjacent implementation action and may be redundant when the code is already clear.",
          suggestedReplacement:
            "Remove it if the adjacent code is self-explanatory; otherwise retain only a non-obvious reason, constraint, or invariant.",
          evidence: [adjacentCode],
        }),
      );
      continue;
    }

    if (TUTORIAL_PATTERN.test(comment.content)) {
      pushFinding(
        createFinding(comment, sourceHash, profile, {
          ruleId: "comments.tutorial-tone",
          category: "Tutorial-style explanation",
          action: "rewrite-suggested",
          reason: "The comment teaches or narrates basic code instead of documenting a non-obvious reason.",
          suggestedReplacement: "Keep only the non-obvious constraint or rationale, if one exists.",
        }),
      );
    }
  }

  const densityEligibleComments = comments.filter(
    (comment) => protectionByComment.get(comment) === undefined,
  );
  if (densityEligibleComments.length >= 4 && changedLineCount > 0) {
    const changedDensity = densityEligibleComments.length / changedLineCount;
    const repositoryDensityUsable =
      profile.status === "ready" ||
      (profile.sampleFileCount >= 10 && profile.codeLineCount >= 500);
    const densityMultiplier = profile.status === "ready" ? 2.5 : 8;
    const threshold = repositoryDensityUsable
      ? Math.max(profile.commentDensity * densityMultiplier, 0.03)
      : 0.4;
    if (changedDensity > threshold) {
      const anchor = densityEligibleComments[0];
      if (anchor) {
        pushFinding(
          createFinding(anchor, sourceHash, profile, {
            ruleId: "comments.density-outlier",
            category: "Comment density outlier",
            action: "rewrite-suggested",
            reason: `The changed region contains ${(changedDensity * 100).toFixed(1)} comments per 100 changed lines, above the ${(
              threshold * 100
            ).toFixed(1)} review threshold.`,
            suggestedReplacement: "Review this group and retain comments that explain why, constraints, or invariants.",
          }),
        );
      }
    }
  }

  if (profile.status === "ready" && profile.dominantLanguage !== "mixed" && profile.dominantLanguage !== "unknown") {
    const unprotected = comments.filter(
      (comment) => protectionByComment.get(comment) === undefined,
    );
    const mismatches = unprotected.filter((comment) => {
      const language = commentLanguage(comment.content);
      return language !== "unknown" && language !== "mixed" && language !== profile.dominantLanguage;
    });
    if (mismatches.length >= 3 && mismatches.length / Math.max(1, unprotected.length) >= 0.7) {
      const anchor = mismatches[0];
      if (anchor) {
        pushFinding(
          createFinding(anchor, sourceHash, profile, {
            ruleId: "comments.language-drift",
            category: "Repository language drift",
            action: "rewrite-suggested",
            reason: `Most changed comments use a different language from the repository baseline (${profile.dominantLanguage}).`,
            suggestedReplacement: "Rewrite selected comments in the local module's dominant language.",
          }),
        );
      }
    }
  }

  const actionPriority: Record<Finding["action"], number> = {
    "remove-safe": 0,
    "rewrite-safe": 1,
    "rewrite-suggested": 2,
    "keep-protected": 3,
    uncertain: 4,
  };
  findings.sort(
    (left, right) =>
      actionPriority[left.action] - actionPriority[right.action] ||
      left.relativePath.localeCompare(right.relativePath) ||
      left.line - right.line,
  );

  return {
    findings,
    protections,
    suppressions,
    protectedCount: protections.length,
  };
}
