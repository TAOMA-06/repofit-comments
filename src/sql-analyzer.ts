export interface SqlCommentRange {
  readonly start: number;
  readonly end: number;
}

export interface SqlScanResult {
  readonly comments: readonly SqlCommentRange[];
  readonly errorCount: number;
}

function consumeQuoted(
  text: string,
  start: number,
  delimiter: string,
): { end: number; closed: boolean } {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] !== delimiter) {
      index += 1;
      continue;
    }
    if (text[index + 1] === delimiter) {
      index += 2;
      continue;
    }
    return { end: index + 1, closed: true };
  }
  return { end: text.length, closed: false };
}

function dollarDelimiterAt(text: string, index: number): string | undefined {
  const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(text.slice(index));
  return match?.[0];
}

export function scanSql(text: string): SqlScanResult {
  const comments: SqlCommentRange[] = [];
  let errorCount = 0;
  let index = 0;

  while (index < text.length) {
    const current = text[index];
    if (current === "'" || current === '"' || current === "`") {
      const quoted = consumeQuoted(text, index, current);
      if (!quoted.closed) errorCount += 1;
      index = quoted.end;
      continue;
    }
    if (current === "[") {
      const close = text.indexOf("]", index + 1);
      if (close < 0) {
        errorCount += 1;
        break;
      }
      index = close + 1;
      continue;
    }
    if (current === "$") {
      const delimiter = dollarDelimiterAt(text, index);
      if (delimiter) {
        const close = text.indexOf(delimiter, index + delimiter.length);
        if (close < 0) {
          errorCount += 1;
          break;
        }
        index = close + delimiter.length;
        continue;
      }
    }
    if ((current === "-" && text[index + 1] === "-") || current === "#") {
      const end = text.indexOf("\n", index);
      comments.push({ start: index, end: end < 0 ? text.length : end });
      index = end < 0 ? text.length : end;
      continue;
    }
    if (current === "/" && text[index + 1] === "*") {
      const start = index;
      index += 2;
      let depth = 1;
      while (index < text.length && depth > 0) {
        if (text[index] === "/" && text[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (text[index] === "*" && text[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) errorCount += 1;
      comments.push({ start, end: index });
      continue;
    }
    index += 1;
  }

  return { comments, errorCount };
}
