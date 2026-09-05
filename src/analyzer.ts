import { createRequire } from "node:module";

import {
  Language,
  Parser,
  type Node as SyntaxNode,
} from "web-tree-sitter";

import { sha256 } from "./hash.js";
import {
  LANGUAGE_DEFINITIONS,
  languageForPath,
  type LanguageDefinition,
} from "./language-registry.js";
import type { LineRange, SourceComment } from "./model.js";
import { scanSql } from "./sql-analyzer.js";
import {
  extractTypeScriptComments,
  typeScriptNonCommentTokenHash,
  typeScriptParseErrorCount,
  typeScriptSyntaxTreeHash,
} from "./typescript-analyzer.js";

interface CommentRange {
  readonly start: number;
  readonly end: number;
}

interface ScriptRegion {
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly languagePath: string;
}

const COMMENT_NODE_TYPES = new Set([
  "comment",
  "line_comment",
  "block_comment",
  "doc_comment",
  "documentation_comment",
  "multiline_comment",
]);

const require = createRequire(import.meta.url);
const languageCache = new Map<string, Language>();

await Parser.init();
for (const definition of LANGUAGE_DEFINITIONS) {
  if (definition.parser !== "tree-sitter" || !definition.grammarFile) continue;
  if (languageCache.has(definition.grammarFile)) continue;
  const grammarPath = require.resolve(
    `tree-sitter-wasms/out/${definition.grammarFile}`,
  );
  languageCache.set(definition.grammarFile, await Language.load(grammarPath));
}

function definitionFor(relativePath: string, text: string): LanguageDefinition {
  const definition = languageForPath(relativePath, text);
  if (!definition) throw new Error(`Unsupported source language: ${relativePath}`);
  return definition;
}

function withTree<T>(
  definition: LanguageDefinition,
  text: string,
  inspect: (root: SyntaxNode) => T,
): T {
  const grammar = definition.grammarFile
    ? languageCache.get(definition.grammarFile)
    : undefined;
  if (!grammar) throw new Error(`Parser grammar is unavailable for ${definition.label}.`);
  const parser = new Parser();
  parser.setLanguage(grammar);
  const tree = parser.parse(text);
  if (!tree) {
    parser.delete();
    throw new Error(`${definition.label} parser returned no syntax tree.`);
  }
  try {
    return inspect(tree.rootNode);
  } finally {
    tree.delete();
    parser.delete();
  }
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => boolean | void): void {
  if (callback(node) === false) return;
  for (const child of node.children) {
    if (child) visit(child, callback);
  }
}

function treeSitterCommentRanges(
  definition: LanguageDefinition,
  text: string,
): CommentRange[] {
  return withTree(definition, text, (root) => {
    const ranges: CommentRange[] = [];
    visit(root, (node) => {
      if (!COMMENT_NODE_TYPES.has(node.type)) return;
      ranges.push({ start: node.startIndex, end: node.endIndex });
      return false;
    });
    return ranges;
  });
}

function lineBounds(text: string, position: number): {
  start: number;
  end: number;
  endWithBreak: number;
} {
  const previousBreak = text.lastIndexOf("\n", Math.max(0, position - 1));
  const start = previousBreak < 0 ? 0 : previousBreak + 1;
  const nextBreak = text.indexOf("\n", position);
  const end = nextBreak < 0 ? text.length : nextBreak;
  return { start, end, endWithBreak: nextBreak < 0 ? text.length : nextBreak + 1 };
}

function lineStartsFor(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineNumberAt(lineStarts: readonly number[], position: number): number {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= position) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

function commentKind(raw: string): SourceComment["kind"] {
  if (/^(?:\/\/[/!]|\/\*[*!])/u.test(raw)) return "doc";
  if (raw.includes("\n") || /^(?:\/\*|<!--|--\[(?:=*)\[|=begin\b)/u.test(raw)) {
    return "block";
  }
  return "line";
}

function commentContent(raw: string): string {
  if (raw.startsWith("<!--")) return raw.slice(4, raw.endsWith("-->") ? -3 : undefined).trim();
  if (raw.startsWith("--[[")) return raw.slice(4, raw.endsWith("]]" ) ? -2 : undefined).trim();
  if (raw.startsWith("/*")) {
    return raw.slice(raw.startsWith("/**") ? 3 : 2, raw.endsWith("*/") ? -2 : undefined).trim();
  }
  return raw.replace(/^(?:\/\/[/!]?|#|--)/u, "").trim();
}

function overlapsRanges(startLine: number, endLine: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => startLine <= range.end && endLine >= range.start);
}

function commentProjection(text: string, ranges: readonly CommentRange[]): string {
  const characters = text.split("");
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
    }
  }
  return characters.join("");
}

function nextCodeLine(
  text: string,
  projection: string,
  end: number,
  lineStarts: readonly number[],
): { text: string; line?: number } {
  let cursor = lineBounds(text, Math.max(0, end - 1)).endWithBreak;
  while (cursor < text.length) {
    const bounds = lineBounds(text, cursor);
    if (projection.slice(bounds.start, bounds.end).trim()) {
      return {
        text: text.slice(bounds.start, bounds.end).trim(),
        line: lineNumberAt(lineStarts, bounds.start),
      };
    }
    cursor = bounds.endWithBreak;
  }
  return { text: "" };
}

function sourceCommentsFromRanges(
  relativePath: string,
  text: string,
  inputRanges: readonly CommentRange[],
): SourceComment[] {
  const ranges = [...new Map(
    inputRanges.map((range) => {
      const end =
        range.end > range.start &&
        text.charCodeAt(range.end - 1) === 13 &&
        text.charCodeAt(range.end) === 10
          ? range.end - 1
          : range.end;
      const normalized = { start: range.start, end };
      return [`${normalized.start}:${normalized.end}`, normalized] as const;
    }),
  ).values()].sort((left, right) => left.start - right.start);
  const projection = commentProjection(text, ranges);
  const firstCodePosition = projection.search(/\S/u);
  const lineStarts = lineStartsFor(text);

  return ranges.map((range) => {
    const raw = text.slice(range.start, range.end);
    const startBounds = lineBounds(text, range.start);
    const endBounds = lineBounds(text, Math.max(range.start, range.end - 1));
    const prefix = text.slice(startBounds.start, range.start);
    const suffix = text.slice(range.end, endBounds.end);
    const standalone = !prefix.trim() && !suffix.trim();
    const following = nextCodeLine(text, projection, range.end, lineStarts);
    const nextCodeLineNumber = following.line;
    return {
      relativePath,
      kind: commentKind(raw),
      raw,
      content: commentContent(raw),
      start: range.start,
      end: range.end,
      line: lineNumberAt(lineStarts, range.start),
      endLine: lineNumberAt(lineStarts, Math.max(range.start, range.end - 1)),
      standalone,
      leadingFileComment: firstCodePosition < 0 || range.start < firstCodePosition,
      removeStart: standalone ? startBounds.start : range.start,
      removeEnd: standalone ? endBounds.endWithBreak : range.end,
      sourceLine: text.slice(startBounds.start, endBounds.end).trim(),
      nextCodeLine: following.text,
      ...(nextCodeLineNumber === undefined ? {} : { nextCodeLineNumber }),
    };
  });
}

function componentScriptRegions(relativePath: string, text: string): ScriptRegion[] {
  const regions: ScriptRegion[] = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const full = match[0];
    const attributes = match[1] ?? "";
    const openEnd = full.indexOf(">");
    const closeStart = full.toLowerCase().lastIndexOf("</script");
    if (openEnd < 0 || closeStart < 0) continue;
    const contentStart = match.index + openEnd + 1;
    const contentEnd = match.index + closeStart;
    regions.push({
      contentStart,
      contentEnd,
      languagePath: /\blang\s*=\s*["']ts["']/iu.test(attributes)
        ? `${relativePath}.ts`
        : `${relativePath}.js`,
    });
  }
  return regions;
}

function shiftComment(
  comment: SourceComment,
  relativePath: string,
  text: string,
  offset: number,
  lineStarts: readonly number[],
): SourceComment {
  const { nextCodeLineNumber: localNextCodeLineNumber, ...base } = comment;
  const start = comment.start + offset;
  const end = comment.end + offset;
  const startBounds = lineBounds(text, start);
  const endBounds = lineBounds(text, Math.max(start, end - 1));
  return {
    ...base,
    relativePath,
    start,
    end,
    line: lineNumberAt(lineStarts, start),
    endLine: lineNumberAt(lineStarts, Math.max(start, end - 1)),
    leadingFileComment: false,
    removeStart: comment.removeStart + offset,
    removeEnd: comment.removeEnd + offset,
    sourceLine: text.slice(startBounds.start, endBounds.end).trim(),
    ...(localNextCodeLineNumber === undefined
      ? {}
      : { nextCodeLineNumber: lineNumberAt(lineStarts, offset) + localNextCodeLineNumber - 1 }),
  };
}

function componentComments(relativePath: string, text: string): SourceComment[] {
  const comments: SourceComment[] = [];
  const lineStarts = lineStartsFor(text);
  for (const match of text.matchAll(/<!--[\s\S]*?-->/gu)) {
    if (match.index !== undefined) {
      comments.push(...sourceCommentsFromRanges(relativePath, text, [{
        start: match.index,
        end: match.index + match[0].length,
      }]));
    }
  }
  for (const region of componentScriptRegions(relativePath, text)) {
    const content = text.slice(region.contentStart, region.contentEnd);
    comments.push(
      ...extractTypeScriptComments(region.languagePath, content).map((comment) =>
        shiftComment(comment, relativePath, text, region.contentStart, lineStarts),
      ),
    );
  }
  return comments.sort((left, right) => left.start - right.start);
}

function treeErrorCount(definition: LanguageDefinition, text: string): number {
  return withTree(definition, text, (root) => {
    let errors = 0;
    visit(root, (node) => {
      if (node.type === "ERROR" || node.isMissing) errors += 1;
    });
    return errors;
  });
}

function treeTokenHash(definition: LanguageDefinition, text: string): string {
  return withTree(definition, text, (root) => {
    const tokens: string[] = [];
    visit(root, (node) => {
      if (COMMENT_NODE_TYPES.has(node.type)) return false;
      const children = node.children.filter((child): child is SyntaxNode => child !== null);
      if (children.length === 0) tokens.push(`${node.type}:${text.slice(node.startIndex, node.endIndex)}`);
    });
    return sha256(tokens.join("\u0000"));
  });
}

function treeSyntaxHash(definition: LanguageDefinition, text: string): string {
  return withTree(definition, text, (root) => {
    const kinds: string[] = [];
    visit(root, (node) => {
      if (COMMENT_NODE_TYPES.has(node.type)) return false;
      kinds.push(node.type);
    });
    return sha256(kinds.join("\u0000"));
  });
}

function componentHash(relativePath: string, text: string, syntaxOnly: boolean): string {
  const regions = componentScriptRegions(relativePath, text);
  const parts: string[] = [];
  let cursor = 0;
  for (const region of regions) {
    parts.push(text.slice(cursor, region.contentStart));
    const content = text.slice(region.contentStart, region.contentEnd);
    parts.push(
      syntaxOnly
        ? typeScriptSyntaxTreeHash(region.languagePath, content)
        : typeScriptNonCommentTokenHash(region.languagePath, content),
    );
    cursor = region.contentEnd;
  }
  parts.push(text.slice(cursor));
  return sha256(parts.join("\u0000"));
}

export function filterCommentsByRanges(
  comments: SourceComment[],
  ranges: LineRange[],
): SourceComment[] {
  return comments.filter((comment) => overlapsRanges(comment.line, comment.endLine, ranges));
}

export function extractComments(
  relativePath: string,
  text: string,
  changedRanges?: LineRange[],
): SourceComment[] {
  const definition = definitionFor(relativePath, text);
  let comments: SourceComment[];
  if (definition.parser === "typescript") {
    comments = extractTypeScriptComments(relativePath, text);
  } else if (definition.parser === "tree-sitter") {
    comments = sourceCommentsFromRanges(
      relativePath,
      text,
      treeSitterCommentRanges(definition, text),
    );
  } else if (definition.parser === "component") {
    comments = componentComments(relativePath, text);
  } else {
    comments = sourceCommentsFromRanges(relativePath, text, scanSql(text).comments);
  }
  return changedRanges ? filterCommentsByRanges(comments, changedRanges) : comments;
}

export function parseErrorCount(relativePath: string, text: string): number {
  const definition = definitionFor(relativePath, text);
  if (definition.parser === "typescript") return typeScriptParseErrorCount(relativePath, text);
  if (definition.parser === "tree-sitter") return treeErrorCount(definition, text);
  if (definition.parser === "sql") return scanSql(text).errorCount;
  return componentScriptRegions(relativePath, text).reduce(
    (total, region) =>
      total + typeScriptParseErrorCount(
        region.languagePath,
        text.slice(region.contentStart, region.contentEnd),
      ),
    0,
  );
}

export function nonCommentTokenHash(relativePath: string, text: string): string {
  const definition = definitionFor(relativePath, text);
  if (definition.parser === "typescript") return typeScriptNonCommentTokenHash(relativePath, text);
  if (definition.parser === "tree-sitter") return treeTokenHash(definition, text);
  if (definition.parser === "component") return componentHash(relativePath, text, false);
  const scan = scanSql(text);
  return sha256(commentProjection(text, scan.comments).replace(/\s+/gu, " ").trim());
}

export function syntaxTreeHash(relativePath: string, text: string): string {
  const definition = definitionFor(relativePath, text);
  if (definition.parser === "typescript") return typeScriptSyntaxTreeHash(relativePath, text);
  if (definition.parser === "tree-sitter") return treeSyntaxHash(definition, text);
  if (definition.parser === "component") return componentHash(relativePath, text, true);
  return nonCommentTokenHash(relativePath, text);
}

export function countCodeLines(text: string, relativePath = "sample.ts"): number {
  const comments = extractComments(relativePath, text);
  const projection = commentProjection(
    text,
    comments.map((comment) => ({ start: comment.start, end: comment.end })),
  );
  return projection.split(/\r?\n/u).filter((line) => line.trim()).length;
}
