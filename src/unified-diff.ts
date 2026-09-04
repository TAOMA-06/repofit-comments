import { sanitizeTerminalText } from "./terminal.js";

type DiffOperation =
  | { type: "equal"; line: string }
  | { type: "remove"; line: string }
  | { type: "add"; line: string };

type PositionedOperation = DiffOperation & {
  oldLine: number;
  newLine: number;
};

function splitLines(content: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") continue;
    const raw = content.slice(start, index);
    lines.push(`${raw.endsWith("\r") ? raw.slice(0, -1) : raw}\n`);
    start = index + 1;
  }
  if (start < content.length) {
    const raw = content.slice(start);
    lines.push(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
  }
  return lines;
}

function visibleLine(line: string): { text: string; hasNewline: boolean } {
  return line.endsWith("\n")
    ? { text: line.slice(0, -1), hasNewline: true }
    : { text: line, hasNewline: false };
}

function quoteGitPath(prefix: "a" | "b", relativePath: string): string {
  const path = `${prefix}/${relativePath}`;
  if (!/[\u0000-\u001f\u007f"\\]/u.test(path)) return path;
  const escaped = [...path]
    .map((character) => {
      if (character === "\\") return "\\\\";
      if (character === '"') return '\\"';
      if (character === "\t") return "\\t";
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 0x20 || codePoint === 0x7f
        ? `\\${codePoint.toString(8).padStart(3, "0")}`
        : character;
    })
    .join("");
  return `"${escaped}"`;
}

function coordinate(map: Map<number, number>, diagonal: number): number {
  return map.get(diagonal) ?? Number.NEGATIVE_INFINITY;
}

function backtrack(
  trace: Array<Map<number, number>>,
  before: string[],
  after: string[],
  distance: number,
): DiffOperation[] {
  let x = before.length;
  let y = after.length;
  const reversed: DiffOperation[] = [];

  for (let depth = distance; depth >= 0; depth -= 1) {
    const frontier = trace[depth];
    if (!frontier) throw new Error("Unified diff backtracking state is incomplete.");
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -depth ||
      (diagonal !== depth &&
        coordinate(frontier, diagonal - 1) < coordinate(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = depth === 0 ? 0 : coordinate(frontier, previousDiagonal);
    if (!Number.isFinite(previousX)) {
      throw new Error("Unified diff backtracking coordinate is invalid.");
    }
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      const line = before[x - 1];
      if (line === undefined) throw new Error("Unified diff source coordinate is invalid.");
      reversed.push({ type: "equal", line });
      x -= 1;
      y -= 1;
    }
    if (depth === 0) break;
    if (x === previousX) {
      const line = after[y - 1];
      if (line === undefined) throw new Error("Unified diff addition coordinate is invalid.");
      reversed.push({ type: "add", line });
      y -= 1;
    } else {
      const line = before[x - 1];
      if (line === undefined) throw new Error("Unified diff removal coordinate is invalid.");
      reversed.push({ type: "remove", line });
      x -= 1;
    }
  }

  return reversed.reverse();
}

function diffLines(before: string[], after: string[]): DiffOperation[] {
  const maximumDistance = before.length + after.length;
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= maximumDistance; distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x: number;
      if (
        diagonal === -distance ||
        (diagonal !== distance &&
          coordinate(frontier, diagonal - 1) < coordinate(frontier, diagonal + 1))
      ) {
        x = coordinate(frontier, diagonal + 1);
      } else {
        x = coordinate(frontier, diagonal - 1) + 1;
      }
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        return backtrack(trace, before, after, distance);
      }
    }
  }
  throw new Error("Unable to construct a unified diff.");
}

function positionOperations(operations: DiffOperation[]): PositionedOperation[] {
  let oldLine = 1;
  let newLine = 1;
  return operations.map((operation) => {
    const positioned = { ...operation, oldLine, newLine };
    if (operation.type !== "add") oldLine += 1;
    if (operation.type !== "remove") newLine += 1;
    return positioned;
  });
}

function formatRange(start: number, count: number): string {
  if (count === 1) return String(start);
  return `${start},${count}`;
}

export function renderUnifiedDiff(
  relativePath: string,
  beforeContent: string,
  afterContent: string,
  contextLines = 3,
): string {
  if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 20) {
    throw new Error("Unified diff context must be an integer from 0 through 20.");
  }
  if (beforeContent === afterContent) return "";
  const operations = positionOperations(
    diffLines(splitLines(beforeContent), splitLines(afterContent)),
  );
  const changed = operations.flatMap((operation, index) =>
    operation.type === "equal" ? [] : [index],
  );
  const groups: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(operations.length, index + contextLines + 1);
    const previous = groups[groups.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else groups.push({ start, end });
  }

  const lines = [
    `--- ${quoteGitPath("a", relativePath)}`,
    `+++ ${quoteGitPath("b", relativePath)}`,
  ];
  for (const group of groups) {
    const segment = operations.slice(group.start, group.end);
    const first = segment[0];
    if (!first) continue;
    const oldCount = segment.filter((operation) => operation.type !== "add").length;
    const newCount = segment.filter((operation) => operation.type !== "remove").length;
    const oldStart = oldCount === 0 ? Math.max(0, first.oldLine - 1) : first.oldLine;
    const newStart = newCount === 0 ? Math.max(0, first.newLine - 1) : first.newLine;
    lines.push(
      `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`,
    );
    for (const operation of segment) {
      const prefix = operation.type === "equal" ? " " : operation.type === "remove" ? "-" : "+";
      const visible = visibleLine(operation.line);
      lines.push(`${prefix}${visible.text}`);
      if (!visible.hasNewline && operation.type !== "equal") {
        lines.push("\\ No newline at end of file");
      }
    }
  }
  return lines.join("\n");
}

export function renderUnifiedDiffForTerminal(diff: string): string {
  return diff
    .split("\n")
    .map((line) => sanitizeTerminalText(line))
    .join("\n");
}
