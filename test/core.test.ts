import assert from "node:assert/strict";
import test from "node:test";

import {
  extractComments,
  nonCommentTokenHash,
  parseErrorCount,
  syntaxTreeHash,
} from "../src/analyzer.js";
import { parseAddedLineRanges } from "../src/git.js";
import { sha256 } from "../src/hash.js";
import type { StyleProfile } from "../src/model.js";
import { verifyCandidate } from "../src/patch.js";
import { protectedReason } from "../src/protection.js";
import { analyzeComments } from "../src/rules.js";

const sparseProfile: StyleProfile = {
  status: "insufficient-style-baseline",
  sampleFileCount: 1,
  commentCount: 2,
  codeLineCount: 20,
  commentDensity: 0.1,
  averageCommentLength: 18,
  dominantLanguage: "en",
  commonPhrases: {},
  examples: [],
};

function sampleSource(comment: string, nextLine = "value++;"): string {
  return [
    "export function update(value: number): number {",
    "  const one = 1;",
    "  const two = 2;",
    "  const three = one + two;",
    "  value += three;",
    `  ${comment}`,
    `  ${nextLine}`,
    "  return value;",
    "}",
    "",
  ].join("\n");
}

test("extractComments ignores comment-looking text inside strings", () => {
  const source = [
    'const url = "https://example.com/a//b";',
    'const marker = "// Step 1";',
    "// Main Logic",
    "const value = 1;",
    "",
  ].join("\n");
  const comments = extractComments("sample.ts", source);

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.content, "Main Logic");
});

test("extractComments limits results to added lines", () => {
  const source = ["// old", "const value = 1;", "// new", "value++;", ""].join("\n");
  const comments = extractComments("sample.ts", source, [{ start: 3, end: 4 }]);

  assert.deepEqual(
    comments.map((comment) => comment.content),
    ["new"],
  );
});

test("protection runs before style rules", () => {
  const source = sampleSource("// TODO(PROJ-42): remove after migration");
  const comment = extractComments("sample.ts", source)[0];

  assert.ok(comment);
  const reason = protectedReason(comment);
  assert.ok(reason);
  assert.match(reason, /TODO|issue|maintenance/i);
  const result = analyzeComments([comment], "source-hash", sparseProfile, 2);
  assert.equal(result.protectedCount, 1);
  assert.equal(result.findings.length, 0);
});

test("tooling, rationale, legal, and tracking comments are protected", () => {
  const protectedSamples = [
    "// eslint-disable-next-line no-console",
    "// @ts-expect-error legacy package has incorrect types",
    "// SPDX-License-Identifier: MIT",
    "// Keep this order because the protocol requires it",
    "// Workaround for https://example.com/issues/42",
    "// Retry 500ms before reconnecting",
    "// TODO(APP-42): remove after migration",
    "// Falls through intentionally",
    "// Preserve deletion markers so removed parameters are not resurrected",
    "// Clone nested arrays so hooks can mutate them without leaking request state",
    "// Re-validate the resolved item so partial updates still enforce rules",
  ];

  for (const raw of protectedSamples) {
    const source = sampleSource(raw);
    const comment = extractComments("sample.ts", source)[0];
    assert.ok(comment, raw);
    assert.ok(protectedReason(comment), raw);
  }
});

test("decorative and exact restatement comments are remove-safe", () => {
  const decorativeSource = sampleSource("// Main Logic");
  const decorativeComment = extractComments("sample.ts", decorativeSource)[0];
  assert.ok(decorativeComment);
  const decorative = analyzeComments(
    [decorativeComment],
    "decorative-hash",
    sparseProfile,
    2,
  ).findings[0];
  assert.equal(decorative?.ruleId, "comments.decorative-heading");
  assert.equal(decorative?.action, "remove-safe");

  const restatementSource = sampleSource("// Increment value");
  const restatementComment = extractComments("sample.ts", restatementSource)[0];
  assert.ok(restatementComment);
  const restatement = analyzeComments(
    [restatementComment],
    "restatement-hash",
    sparseProfile,
    2,
  ).findings[0];
  assert.equal(restatement?.ruleId, "comments.code-restatement");
  assert.equal(restatement?.action, "remove-safe");
});

test("bare generated step labels are removable, while numeric constraints stay protected", () => {
  const stepSource = sampleSource("// Step 1");
  const stepComment = extractComments("sample.ts", stepSource)[0];
  assert.ok(stepComment);
  assert.equal(protectedReason(stepComment), undefined);
  const stepFinding = analyzeComments(
    [stepComment],
    "step-hash",
    sparseProfile,
    2,
  ).findings[0];
  assert.equal(stepFinding?.ruleId, "comments.step-label");
  assert.equal(stepFinding?.action, "remove-safe");

  const constraintSource = sampleSource("// Retry 3 times to tolerate the upstream timeout");
  const constraintComment = extractComments("sample.ts", constraintSource)[0];
  assert.ok(constraintComment);
  assert.match(protectedReason(constraintComment) ?? "", /value|unit|version|standards/i);
});

test("numbered step narration gets a deterministic comment-only rewrite", () => {
  const source = sampleSource(
    "// Step 1: sum immutable line totals into the subtotal",
    "const subtotal = value + 100;",
  );
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  const finding = analyzeComments([comment], "step-narration-hash", sparseProfile, 2)
    .findings[0];

  assert.equal(finding?.ruleId, "comments.step-narration");
  assert.equal(finding?.action, "rewrite-safe");
  assert.equal(
    finding?.suggestedReplacement,
    "// Sum immutable line totals into the subtotal",
  );
});

test("step-prefix rewrite preserves a rationale that becomes protected", () => {
  const source = sampleSource(
    "// Step 2: apply discount without allowing a negative taxable amount",
    "const taxable = value - 100;",
  );
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  assert.ok(protectedReason(comment));
  const finding = analyzeComments([comment], "rationale-step-hash", sparseProfile, 2)
    .findings[0];
  assert.equal(finding?.action, "rewrite-safe");
  assert.equal(
    finding?.suggestedReplacement,
    "// Apply discount without allowing a negative taxable amount",
  );
  const candidate =
    source.slice(0, finding.commentStart) +
    finding.suggestedReplacement +
    source.slice(finding.commentEnd);
  const verification = verifyCandidate("sample.ts", source, candidate);
  assert.equal(verification.valid, true, verification.reasons.join(" "));
});

test("meta narration is suggestion-only", () => {
  const source = sampleSource("// Here we increment the value");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  const finding = analyzeComments([comment], "meta-hash", sparseProfile, 2).findings[0];

  assert.equal(finding?.ruleId, "comments.meta-narration");
  assert.equal(finding?.action, "rewrite-suggested");
  assert.equal(finding?.suggestedReplacement, "// increment the value");
});

test("action-by-action narration is suggested, not automatically removed", () => {
  const samples = [
    sampleSource("// Create a formatter for local time", "const formatter = new Intl.DateTimeFormat();"),
    sampleSource("// Calculate rotation angles", "const angle = value * 6;"),
    sampleSource("// 计算当前旋转角度", "const angle = value * 6;"),
  ];

  for (const source of samples) {
    const comment = extractComments("sample.ts", source)[0];
    assert.ok(comment);
    const finding = analyzeComments([comment], "action-hash", sparseProfile, 2).findings[0];
    assert.equal(finding?.ruleId, "comments.action-narration");
    assert.equal(finding?.action, "rewrite-suggested");
  }
});

test("inline action narration is suggestion-only and cites the inline code", () => {
  const source = [
    "import value from './value.js';",
    "export function run() {",
    "  const one = 1;",
    "  const two = 2;",
    "  const three = one + two;",
    "  return value + three; // Calculate the final value",
    "}",
    "",
  ].join("\n");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  assert.equal(comment.standalone, false);
  const finding = analyzeComments([comment], "inline-hash", sparseProfile, 1).findings[0];

  assert.equal(finding?.ruleId, "comments.action-narration");
  assert.equal(finding?.action, "rewrite-suggested");
  assert.ok(finding?.evidence.some((item) => item.includes("return value + three")));
});

test("generated new/existing labels are suggestion-only", () => {
  const source = sampleSource(
    "// New SKU: append a frozen copy to the cart",
    "items.push(Object.freeze({ sku: 'A' }));",
  );
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  const finding = analyzeComments([comment], "label-hash", sparseProfile, 2).findings[0];

  assert.equal(finding?.ruleId, "comments.action-narration");
  assert.equal(finding?.action, "rewrite-suggested");
});

test("action comments with an explicit rationale remain protected", () => {
  const source = sampleSource(
    "// Calculate the checksum according to RFC 1952",
    "const checksum = crc32(value);",
  );
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  assert.ok(protectedReason(comment));

  const result = analyzeComments([comment], "rationale-hash", sparseProfile, 2);
  assert.equal(result.findings.length, 0);
});

test("repository-common headings are not changed", () => {
  const source = sampleSource("// Main Logic");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  const profile: StyleProfile = {
    ...sparseProfile,
    status: "ready",
    sampleFileCount: 6,
    commentCount: 40,
    commonPhrases: { "main logic": 4 },
  };

  const result = analyzeComments([comment], "common-hash", profile, 2);
  assert.equal(result.findings.length, 0);
});

test("meaningful short section labels are not automatically removed", () => {
  const source = sampleSource("// Validation");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);

  const result = analyzeComments([comment], "validation-hash", sparseProfile, 2);
  assert.equal(result.findings.length, 0);
});

test("comment-only deletion preserves tokens and syntax tree", () => {
  const source = sampleSource("// Main Logic");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  const candidate = source.slice(0, comment.removeStart) + source.slice(comment.removeEnd);
  const verification = verifyCandidate("sample.ts", source, candidate);

  assert.equal(parseErrorCount("sample.ts", source), 0);
  assert.equal(verification.valid, true, verification.reasons.join(" "));
  assert.equal(nonCommentTokenHash("sample.ts", source), nonCommentTokenHash("sample.ts", candidate));
  assert.equal(syntaxTreeHash("sample.ts", source), syntaxTreeHash("sample.ts", candidate));
});

test("a code-token change is rejected", () => {
  const source = sampleSource("// Main Logic");
  const candidate = source.replace("value++;", "value += 2;");
  const verification = verifyCandidate("sample.ts", source, candidate);

  assert.equal(verification.valid, false);
  assert.ok(verification.reasons.some((reason) => reason.includes("Non-comment token")));
});

test("removing a protected comment is rejected even when code tokens are unchanged", () => {
  const source = sampleSource("// Must retain this invariant for callers");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  assert.ok(protectedReason(comment));
  const candidate = source.slice(0, comment.removeStart) + source.slice(comment.removeEnd);
  const verification = verifyCandidate("sample.ts", source, candidate);

  assert.equal(verification.valid, false);
  assert.ok(verification.reasons.some((reason) => reason.includes("protected comment")));
});

test("CRLF comment removal preserves code tokens and parses", () => {
  const source = sampleSource("// Main Logic").replaceAll("\n", "\r\n");
  const comment = extractComments("sample.ts", source)[0];
  assert.ok(comment);
  const candidate = source.slice(0, comment.removeStart) + source.slice(comment.removeEnd);
  const verification = verifyCandidate("sample.ts", source, candidate);

  assert.equal(verification.valid, true, verification.reasons.join(" "));
  assert.match(candidate, /\r\n/);
});

test("TSX block comments are protected from automatic changes", () => {
  const source = [
    "export function View() {",
    "  const value = 1;",
    "  return (",
    "    <main>",
    "      <span>{value}</span>",
    "      {/* Main Logic */}",
    "    </main>",
    "  );",
    "}",
    "",
  ].join("\n");
  const comment = extractComments("View.tsx", source).find((item) => item.raw.includes("Main Logic"));

  assert.ok(comment);
  assert.equal(comment.kind, "block");
  assert.ok(protectedReason(comment));
});

test("parseAddedLineRanges handles added, replaced, and deletion-only hunks", () => {
  const diff = [
    "@@ -1,0 +2,3 @@",
    "+one",
    "+two",
    "+three",
    "@@ -10 +14 @@",
    "+replacement",
    "@@ -20,2 +24,0 @@",
    "-gone",
    "",
  ].join("\n");

  assert.deepEqual(parseAddedLineRanges(diff), [
    { start: 2, end: 4 },
    { start: 14, end: 14 },
  ]);
});

test("finding fingerprints survive unrelated source and line movement while IDs remain snapshot-bound", () => {
  const firstSource = [
    "export function value(): number {",
    "  // Step 1",
    "  return 1;",
    "}",
    "",
  ].join("\n");
  const secondSource = `\n${firstSource.replace("return 1", "return 1")}`;
  const first = analyzeComments(
    extractComments("sample.ts", firstSource),
    sha256(firstSource),
    sparseProfile,
    5,
  ).findings[0];
  const second = analyzeComments(
    extractComments("sample.ts", secondSource),
    sha256(secondSource),
    sparseProfile,
    6,
  ).findings[0];
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.id, second.id);
});

test("reasoned inline suppression is visible and never turns into an automatic finding", () => {
  const source = [
    "export function value(): number {",
    "  // repofit-ignore-next-line comments.step-label -- mirrors the numbered protocol in docs",
    "  // Step 1",
    "  return 1;",
    "}",
    "",
  ].join("\n");
  const result = analyzeComments(
    extractComments("sample.ts", source),
    sha256(source),
    sparseProfile,
    6,
  );
  assert.equal(result.findings.length, 0);
  assert.equal(result.suppressions.length, 1);
  assert.equal(result.suppressions[0]?.ruleId, "comments.step-label");
  assert.match(result.suppressions[0]?.reason ?? "", /numbered protocol/);
  assert.ok(result.protections.some((record) => /directive/.test(record.reason)));
});

test("a suppression without a reason does not hide the following finding", () => {
  const source = [
    "export function value(): number {",
    "  // repofit-ignore-next-line comments.step-label",
    "  // Step 1",
    "  return 1;",
    "}",
    "",
  ].join("\n");
  const result = analyzeComments(
    extractComments("sample.ts", source),
    sha256(source),
    sparseProfile,
    6,
  );
  assert.equal(result.findings[0]?.ruleId, "comments.step-label");
  assert.equal(result.suppressions.length, 0);
});
