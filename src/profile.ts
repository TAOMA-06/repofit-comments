import { dirname } from "node:path";

import { countCodeLines, extractComments } from "./analyzer.js";
import { listTrackedSourceFiles, readHeadContent } from "./git.js";
import type { StyleProfile } from "./model.js";
import { commentLanguage, normalizeComment, protectedReason } from "./protection.js";

const MAX_PROFILE_FILES = 200;

function pathPriority(path: string, changedPaths: string[]): number {
  const directory = dirname(path);
  if (changedPaths.some((changed) => dirname(changed) === directory)) {
    return 0;
  }

  const rootSegment = path.split("/")[0];
  if (rootSegment && changedPaths.some((changed) => changed.split("/")[0] === rootSegment)) {
    return 1;
  }
  return 2;
}

export function buildStyleProfile(root: string, changedPaths: string[]): StyleProfile {
  const changed = new Set(changedPaths);
  const candidates = listTrackedSourceFiles(root)
    .filter((path) => !changed.has(path))
    .sort((left, right) => {
      const priority = pathPriority(left, changedPaths) - pathPriority(right, changedPaths);
      return priority === 0 ? left.localeCompare(right) : priority;
    })
    .slice(0, MAX_PROFILE_FILES);

  let sampleFileCount = 0;
  let commentCount = 0;
  let codeLineCount = 0;
  let totalCommentLength = 0;
  let chineseCount = 0;
  let englishCount = 0;
  const commonPhrases: Record<string, number> = {};
  const examples: StyleProfile["examples"] = [];

  for (const relativePath of candidates) {
    const content = readHeadContent(root, relativePath);
    if (content === undefined) {
      continue;
    }

    sampleFileCount += 1;
    codeLineCount += countCodeLines(content);
    const comments = extractComments(relativePath, content).filter(
      (comment) => protectedReason(comment) === undefined,
    );
    commentCount += comments.length;

    for (const comment of comments) {
      totalCommentLength += comment.content.length;
      const language = commentLanguage(comment.content);
      if (language === "zh") chineseCount += 1;
      if (language === "en") englishCount += 1;

      const normalized = normalizeComment(comment.content);
      if (normalized) {
        commonPhrases[normalized] = (commonPhrases[normalized] ?? 0) + 1;
      }

      if (
        examples.length < 8 &&
        comment.content.length >= 8 &&
        comment.content.length <= 120
      ) {
        examples.push({ relativePath, line: comment.line, text: comment.raw });
      }
    }
  }

  let dominantLanguage: StyleProfile["dominantLanguage"] = "unknown";
  const languageTotal = chineseCount + englishCount;
  if (languageTotal > 0) {
    if (chineseCount / languageTotal >= 0.7) dominantLanguage = "zh";
    else if (englishCount / languageTotal >= 0.7) dominantLanguage = "en";
    else dominantLanguage = "mixed";
  }

  return {
    status:
      sampleFileCount >= 5 && commentCount >= 30
        ? "ready"
        : "insufficient-style-baseline",
    sampleFileCount,
    commentCount,
    codeLineCount,
    commentDensity: codeLineCount === 0 ? 0 : commentCount / codeLineCount,
    averageCommentLength: commentCount === 0 ? 0 : totalCommentLength / commentCount,
    dominantLanguage,
    commonPhrases,
    examples: examples.slice(0, 3),
  };
}
