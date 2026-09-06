import { dirname } from "node:path";

import { countCodeLines, extractComments } from "./analyzer.js";
import { pathIncluded, type RepoFitConfig } from "./config.js";
import { wholeFileProtectionReason } from "./file-policy.js";
import { listTrackedSourceFiles, readHeadContents, readHeadSizes } from "./git.js";
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

export function buildStyleProfile(
  root: string,
  changedPaths: string[],
  config?: RepoFitConfig,
): StyleProfile {
  const changed = new Set(changedPaths);
  const candidates = listTrackedSourceFiles(root)
    .filter((path) => !changed.has(path))
    .filter((path) => config === undefined || pathIncluded(config, path))
    .sort((left, right) => {
      const priority = pathPriority(left, changedPaths) - pathPriority(right, changedPaths);
      return priority === 0 ? left.localeCompare(right) : priority;
    })
    .slice(0, config?.limits.maxProfileFiles ?? MAX_PROFILE_FILES);
  const sizes = readHeadSizes(root, candidates);
  let selectedBytes = 0;
  const eligibleCandidates = candidates.filter((relativePath) => {
    const size = sizes.get(relativePath);
    if (size === undefined) return false;
    if (config && size > config.limits.maxFileBytes) return false;
    if (config && selectedBytes + size > config.limits.maxTotalBytes) return false;
    selectedBytes += size;
    return true;
  });

  let sampleFileCount = 0;
  let commentCount = 0;
  let codeLineCount = 0;
  let totalCommentLength = 0;
  let chineseCount = 0;
  let englishCount = 0;
  const commonPhrases: Record<string, number> = {};
  const examples: StyleProfile["examples"] = [];

  for (let offset = 0; offset < eligibleCandidates.length; offset += 16) {
    const batchPaths = eligibleCandidates.slice(offset, offset + 16);
    const headContents = readHeadContents(root, batchPaths);
    for (const relativePath of batchPaths) {
      const content = headContents.get(relativePath);
      if (content === undefined) continue;
      if (wholeFileProtectionReason(relativePath, content) !== undefined) {
        continue;
      }

      sampleFileCount += 1;
      codeLineCount += countCodeLines(content, relativePath);
      const comments = extractComments(relativePath, content).filter(
        (comment) =>
          protectedReason(comment, config?.protect.phrases ?? []) === undefined,
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
