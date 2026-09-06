import ts from "typescript";

import { sha256 } from "./hash.js";
import type { LineRange, SourceComment } from "./model.js";

function scriptKindFor(relativePath: string): ts.ScriptKind {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function languageVariantFor(relativePath: string): ts.LanguageVariant {
  return /\.(?:tsx|jsx)$/i.test(relativePath)
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
}

function lineBounds(text: string, position: number): { start: number; end: number; endWithBreak: number } {
  const previousBreak = text.lastIndexOf("\n", Math.max(0, position - 1));
  const start = previousBreak < 0 ? 0 : previousBreak + 1;
  const nextBreak = text.indexOf("\n", position);
  const end = nextBreak < 0 ? text.length : nextBreak;
  const endWithBreak = nextBreak < 0 ? text.length : nextBreak + 1;
  return { start, end, endWithBreak };
}

function overlapsRanges(startLine: number, endLine: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => startLine <= range.end && endLine >= range.start);
}

export function filterCommentsByRanges(
  comments: SourceComment[],
  ranges: LineRange[],
): SourceComment[] {
  return comments.filter((comment) =>
    overlapsRanges(comment.line, comment.endLine, ranges),
  );
}

function nextCodeLine(
  text: string,
  position: number,
  relativePath: string,
  sourceFile: ts.SourceFile,
): {
  text: string;
  line?: number;
} {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    languageVariantFor(relativePath),
    text,
  );
  scanner.setTextPos(position);
  const token = scanner.scan();
  if (token === ts.SyntaxKind.EndOfFileToken) {
    return { text: "" };
  }

  const tokenPosition = scanner.getTokenPos();
  const bounds = lineBounds(text, tokenPosition);
  return {
    text: text.slice(bounds.start, bounds.end).trim(),
    line: sourceFile.getLineAndCharacterOfPosition(tokenPosition).line + 1,
  };
}

export function extractTypeScriptComments(
  relativePath: string,
  text: string,
  changedRanges?: LineRange[],
): SourceComment[] {
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relativePath),
  );
  const codeScanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    languageVariantFor(relativePath),
    text,
  );
  const firstCodeToken = codeScanner.scan();
  const firstCodePosition =
    firstCodeToken === ts.SyntaxKind.EndOfFileToken ? text.length : codeScanner.getTokenPos();
  const comments: SourceComment[] = [];
  const ranges = new Map<string, ts.CommentRange>();
  const addRanges = (items: readonly ts.CommentRange[] | undefined): void => {
    for (const item of items ?? []) {
      ranges.set(`${item.pos}:${item.end}`, item);
    }
  };
  const collectRanges = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(text, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(text, node.end));
    if (ts.isJsxExpression(node) && node.expression === undefined) {
      const jsxText = text.slice(node.pos, node.end);
      const commentStart = jsxText.indexOf("/*");
      const commentEnd = jsxText.lastIndexOf("*/");
      if (commentStart >= 0 && commentEnd >= commentStart) {
        const pos = node.pos + commentStart;
        const end = node.pos + commentEnd + 2;
        ranges.set(`${pos}:${end}`, {
          pos,
          end,
          kind: ts.SyntaxKind.MultiLineCommentTrivia,
        });
      }
    }
    ts.forEachChild(node, collectRanges);
  };
  collectRanges(sourceFile);

  for (const range of [...ranges.values()].sort((left, right) => left.pos - right.pos)) {
    const start = range.pos;
    const end = range.end;
    const raw = text.slice(start, end);
    const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
    const endLocation = sourceFile.getLineAndCharacterOfPosition(Math.max(start, end - 1));
    const line = startLocation.line + 1;
    const endLine = endLocation.line + 1;

    if (changedRanges && !overlapsRanges(line, endLine, changedRanges)) {
      continue;
    }

    const startBounds = lineBounds(text, start);
    const endBounds = lineBounds(text, Math.max(start, end - 1));
    const prefix = text.slice(startBounds.start, start);
    const suffix = text.slice(end, endBounds.end);
    const standalone = prefix.trim().length === 0 && suffix.trim().length === 0;
    const isLine = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
    const isDoc = raw.startsWith("///") || raw.startsWith("/**");
    const content = isLine
      ? raw.replace(/^\/{2,3}/, "").trim()
      : raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "").trim();
    const following = nextCodeLine(text, end, relativePath, sourceFile);

    comments.push({
      relativePath,
      kind: isDoc ? "doc" : isLine ? "line" : "block",
      raw,
      content,
      start,
      end,
      line,
      endLine,
      standalone,
      leadingFileComment: start < firstCodePosition,
      removeStart: standalone ? startBounds.start : start,
      removeEnd: standalone ? endBounds.endWithBreak : end,
      sourceLine: text.slice(startBounds.start, endBounds.end).trim(),
      nextCodeLine: following.text,
      ...(following.line === undefined ? {} : { nextCodeLineNumber: following.line }),
    });
  }

  return comments;
}

export function typeScriptParseErrorCount(relativePath: string, text: string): number {
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relativePath),
  ) as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
  return sourceFile.parseDiagnostics?.length ?? 0;
}

export function typeScriptNonCommentTokenHash(relativePath: string, text: string): string {
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relativePath),
  );
  const tokens: string[] = [];

  const visit = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      if (node.kind <= ts.SyntaxKind.LastToken && node.kind !== ts.SyntaxKind.EndOfFileToken) {
        tokens.push(`${node.kind}:${text.slice(node.getStart(sourceFile, false), node.end)}`);
      }
      return;
    }
    for (const child of children) {
      visit(child);
    }
  };
  visit(sourceFile);

  return sha256(tokens.join("\u0000"));
}

export function typeScriptSyntaxTreeHash(relativePath: string, text: string): string {
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relativePath),
  );
  const kinds: number[] = [];

  const visit = (node: ts.Node): void => {
    kinds.push(node.kind);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return sha256(kinds.join(","));
}

export function typeScriptCodeLineCount(text: string): number {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("//")).length;
}
