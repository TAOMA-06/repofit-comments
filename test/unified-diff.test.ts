import assert from "node:assert/strict";
import test from "node:test";

import {
  renderUnifiedDiff,
  renderUnifiedDiffForTerminal,
} from "../src/unified-diff.js";

test("renderUnifiedDiff produces a real contextual replacement hunk", () => {
  const before = ["export function value() {", "  // Step 1", "  return 1;", "}", ""].join("\n");
  const after = ["export function value() {", "  return 1;", "}", ""].join("\n");
  const diff = renderUnifiedDiff("src/value.ts", before, after);

  assert.match(diff, /^--- a\/src\/value\.ts\n\+\+\+ b\/src\/value\.ts/m);
  assert.match(diff, /@@ -1,4 \+1,3 @@/);
  assert.match(diff, /-  \/\/ Step 1/);
  assert.match(diff, /   return 1;/);
});

test("renderUnifiedDiff handles separated hunks and additions", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].join("\n");
  const after = ["a", "B", "c", "d", "e", "f", "g", "H", "i", "j"].join("\n");
  const diff = renderUnifiedDiff("sample.ts", before, after, 1);

  assert.equal((diff.match(/^@@/gm) ?? []).length, 2);
  assert.match(diff, /-b\n\+B/);
  assert.match(diff, /-h\n-i\n\\ No newline at end of file\n\+H\n\+i\n\+j/);
});

test("renderUnifiedDiff is empty for identical content and sanitizes control text", () => {
  assert.equal(renderUnifiedDiff("same.ts", "a\n", "a\n"), "");
  const diff = renderUnifiedDiff("unsafe\u001b.ts", "a\n", "b\n", 0);
  assert.match(diff, /unsafe\\033\.ts/);
  assert.doesNotMatch(diff, /\u001b/);
});

test("raw patches preserve tabs while terminal display escapes them", () => {
  const raw = renderUnifiedDiff("tabs.ts", "\t// Step 1\n\treturn;\n", "\treturn;\n");
  assert.match(raw, /^-\t\/\/ Step 1/m);
  const terminal = renderUnifiedDiffForTerminal(raw);
  assert.match(terminal, /^-\\t\/\/ Step 1/m);
  assert.doesNotMatch(terminal, /\t/);
});

test("renderUnifiedDiff validates context bounds", () => {
  assert.throws(() => renderUnifiedDiff("a.ts", "a", "b", 21), /context/);
});

test("renderUnifiedDiff handles CRLF, pure additions, and missing final newlines", () => {
  const crlf = renderUnifiedDiff("crlf.ts", "a\r\n// Step 1\r\nb", "a\r\nb");
  assert.match(crlf, /-\/\/ Step 1/);
  const addition = renderUnifiedDiff("new.ts", "", "export const value = 1;");
  assert.match(addition, /@@ -0,0 \+1 @@/);
  assert.match(addition, /\+export const value = 1;/);
  const deletion = renderUnifiedDiff("old.ts", "export const value = 1;", "");
  assert.match(deletion, /@@ -1 \+0,0 @@/);
});
