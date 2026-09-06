import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractComments,
  parseErrorCount,
} from "../src/analyzer.js";
import { analyzeRepository } from "../src/analysis.js";
import {
  LANGUAGE_DEFINITIONS,
  languageForPath,
  supportsAutomaticFixes,
} from "../src/language-registry.js";
import { applyFinding, verifyCandidate } from "../src/patch.js";
import { protectedReason, stepNarrationReplacement } from "../src/protection.js";
import { analyzeComments } from "../src/rules.js";
import type { StyleProfile } from "../src/model.js";

interface LanguageSample {
  readonly path: string;
  readonly source: string;
}

const SAMPLES: readonly LanguageSample[] = [
  { path: "sample.ts", source: 'const marker = "// no";\n// Step 1: return value\nexport const value = 1;\n' },
  { path: "sample.jsx", source: 'const marker = "// no";\n// Step 1: return value\nexport const view = <div />;\n' },
  { path: "sample.py", source: 'marker = "# no"\n# Step 1: return value\ndef value():\n    return 1\n' },
  { path: "sample.go", source: 'package sample\nvar marker = "// no"\n// Step 1: return value\nfunc value() int { return 1 }\n' },
  { path: "sample.rs", source: 'const MARKER: &str = "// no";\n// Step 1: return value\nfn value() -> i32 { 1 }\n' },
  { path: "sample.swift", source: 'let marker = "// no"\n// Step 1: return value\nfunc value() -> Int { 1 }\n' },
  { path: "Sample.java", source: 'class Sample {\nString marker = "// no";\n// Step 1: return value\nint value() { return 1; }\n}\n' },
  { path: "sample.kt", source: 'val marker = "// no"\n// Step 1: return value\nfun value(): Int = 1\n' },
  { path: "Sample.cs", source: 'class Sample {\nstring marker = "// no";\n// Step 1: return value\nint Value() => 1;\n}\n' },
  { path: "sample.c", source: 'const char *marker = "// no";\n// Step 1: return value\nint value(void) { return 1; }\n' },
  { path: "sample.cpp", source: 'const char *marker = "// no";\n// Step 1: return value\nint value() { return 1; }\n' },
  { path: "sample.php", source: '<?php\necho "// no";\n// Step 1: return value\nfunction value(): int { return 1; }\n' },
  { path: "sample.rb", source: 'marker = "# no"\n# Step 1: return value\ndef value\n  1\nend\n' },
  { path: "sample.dart", source: 'const marker = "// no";\n// Step 1: return value\nint value() => 1;\n' },
  { path: "sample.lua", source: 'local marker = "-- no"\n-- Step 1: return value\nlocal function value() return 1 end\n' },
  { path: "Sample.vue", source: '<script setup>\nconst marker = "// no"\n// Step 1: return value\nconst value = 1\n</script>\n<template><div /></template>\n' },
  { path: "Sample.svelte", source: '<script lang="ts">\nconst marker = "// no";\n// Step 1: return value\nconst value = 1;\n</script>\n<div>{value}</div>\n' },
  { path: "sample.sh", source: 'marker="# no"\n# Step 1: return value\nvalue() { printf 1; }\n' },
  { path: "sample.sql", source: "select '-- no';\n-- Step 1: return value\nselect 1;\n" },
] as const;

const sparseProfile: StyleProfile = {
  status: "insufficient-style-baseline",
  sampleFileCount: 0,
  commentCount: 0,
  codeLineCount: 0,
  commentDensity: 0,
  averageCommentLength: 0,
  dominantLanguage: "unknown",
  commonPhrases: {},
  examples: [],
};

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

test("the three language batches expose explicit scan and fix capabilities", () => {
  assert.equal(LANGUAGE_DEFINITIONS.length, 19);
  assert.deepEqual(
    [...new Set(LANGUAGE_DEFINITIONS.map((definition) => definition.batch))],
    [1, 2, 3],
  );
  assert.equal(languageForPath("src/main.py")?.id, "python");
  assert.equal(languageForPath("Sources/App.swift")?.id, "swift");
  assert.equal(languageForPath("src/App.vue")?.id, "vue");
  assert.equal(supportsAutomaticFixes("query.sql"), false);
  assert.equal(supportsAutomaticFixes("script.sh"), true);
});

test("all language adapters ignore comment markers in strings and isolate real comments", () => {
  for (const sample of SAMPLES) {
    const comments = extractComments(sample.path, sample.source);
    assert.equal(comments.length, 1, sample.path);
    assert.match(comments[0]?.content ?? "", /^Step 1:/u, sample.path);
    assert.equal(parseErrorCount(sample.path, sample.source), 0, sample.path);
  }
});

test("language-specific raw strings and heredocs do not become comments", () => {
  const samples = [
    ["raw.py", 'text = """# Step 9: fake"""\n# Step 1: real\nvalue = 1\n'],
    ["raw.go", 'package sample\nvar text = `// Step 9: fake`\n// Step 1: real\nvar value = 1\n'],
    ["raw.rs", 'const TEXT: &str = r#"// Step 9: fake"#;\n// Step 1: real\nconst VALUE: i32 = 1;\n'],
    ["raw.swift", 'let text = """\n// Step 9: fake\n"""\n// Step 1: real\nlet value = 1\n'],
    ["raw.rb", 'text = <<~TEXT\n# Step 9: fake\nTEXT\n# Step 1: real\nvalue = 1\n'],
    ["raw.lua", 'local text = [[-- Step 9: fake]]\n-- Step 1: real\nlocal value = 1\n'],
    ["raw.sh", "cat <<'TEXT'\n# Step 9: fake\nTEXT\n# Step 1: real\nvalue=1\n"],
  ] as const;

  for (const [path, source] of samples) {
    const steps = extractComments(path, source).filter((comment) =>
      comment.content.startsWith("Step"),
    );
    assert.deepEqual(steps.map((comment) => comment.content), ["Step 1: real"], path);
    assert.equal(parseErrorCount(path, source), 0, path);
  }
});

test("Unicode and CRLF offsets remain byte-exact for a Python rewrite", () => {
  const source = 'marker = "💡# fake"\r\n# Step 1: return value\r\ndef value():\r\n    return 1\r\n';
  const comment = extractComments("unicode.py", source)[0];
  assert.ok(comment);
  assert.equal(source.slice(comment.start, comment.end), comment.raw);
  const replacement = stepNarrationReplacement(comment);
  assert.equal(replacement, "# Return value");
  const candidate = source.slice(0, comment.start) + replacement + source.slice(comment.end);
  assert.equal(verifyCandidate("unicode.py", source, candidate).valid, true);
  assert.match(candidate, /💡# fake/u);
  assert.match(candidate, /\r\n# Return value\r\n/u);
});

test("syntax errors keep non-TypeScript automatic fixes fail-closed", () => {
  const source = 'marker = "# fake"\n# Step 1: return value\ndef value(\n';
  const comment = extractComments("broken.py", source)[0];
  assert.ok(comment);
  const replacement = stepNarrationReplacement(comment);
  assert.ok(replacement);
  const candidate = source.slice(0, comment.start) + replacement + source.slice(comment.end);
  const verification = verifyCandidate("broken.py", source, candidate);
  assert.equal(verification.valid, false);
  assert.match(verification.reasons.join(" "), /original file has parse diagnostics/u);
});

test("component markup comments stay protected while script comments are fixable", () => {
  for (const path of ["Component.vue", "Component.svelte"]) {
    const source = [
      "<!-- Step 9: public markup contract -->",
      '<script lang="ts">',
      'const marker = "// fake";',
      "// Step 1: return value",
      "const value = 1;",
      "</script>",
      "<div>{value}</div>",
      "",
    ].join("\n");
    const comments = extractComments(path, source);
    assert.equal(comments.length, 2, path);
    assert.match(protectedReason(comments[0]!) ?? "", /Block/u, path);
    const scriptComment = comments[1];
    assert.ok(scriptComment);
    assert.equal(stepNarrationReplacement(scriptComment), "// Return value");
  }
});

test("multi-line language comments are always protected as blocks", () => {
  const samples = [
    ["sample.rb", "value = 1\n=begin\nStep 1: generated explanation\n=end\nputs value\n"],
    ["sample.lua", "local value = 1\n--[=[Step 1: generated explanation]=]\nprint(value)\n"],
  ] as const;
  for (const [path, source] of samples) {
    const comment = extractComments(path, source)[0];
    assert.ok(comment, path);
    assert.equal(comment.kind, "block", path);
    assert.match(protectedReason(comment) ?? "", /Block/u, path);
  }
});

test("leading step narration loses only its prefix while ordinary headers stay protected", () => {
  const source = "# Step 1: calculate the result\n# Copyright 2026 Example\nvalue = 1\n";
  const comments = extractComments("leading.py", source);
  const result = analyzeComments(comments, "source-hash", sparseProfile, 3);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.action, "rewrite-safe");
  assert.equal(result.findings[0]?.suggestedReplacement, "# Calculate the result");
  assert.equal(result.protections.length, 1);
  const finding = result.findings[0];
  assert.ok(finding);
  const candidate =
    source.slice(0, finding.commentStart) +
    finding.suggestedReplacement +
    source.slice(finding.commentEnd);
  assert.equal(verifyCandidate("leading.py", source, candidate).valid, true);
});

test("SQL scanning handles quoted, dollar-quoted, and nested-comment content", () => {
  const source = [
    "select '-- Step 9: fake';",
    "select $$-- Step 8: fake$$;",
    "/* outer /* nested */ protected */",
    "-- Step 1: real",
    "select 1;",
    "",
  ].join("\n");
  const comments = extractComments("query.sql", source);
  assert.deepEqual(
    comments.map((comment) => comment.content),
    ["outer /* nested */ protected", "Step 1: real"],
  );
  assert.equal(parseErrorCount("query.sql", source), 0);
});

test("automatic-fix languages preserve their native marker and structural hashes", () => {
  for (const sample of SAMPLES.filter((candidate) =>
    supportsAutomaticFixes(candidate.path, candidate.source),
  )) {
    const comment = extractComments(sample.path, sample.source)[0];
    assert.ok(comment, sample.path);
    const replacement = stepNarrationReplacement(comment);
    assert.ok(replacement, sample.path);
    const finding = analyzeComments(
      [comment],
      "source-hash",
      sparseProfile,
      2,
    ).findings[0];
    assert.equal(finding?.action, "rewrite-safe", sample.path);
    assert.equal(finding?.suggestedReplacement, replacement, sample.path);
    assert.equal(replacement.startsWith(comment.raw.slice(0, 2).trim()), true, sample.path);
    const candidate =
      sample.source.slice(0, comment.start) +
      replacement +
      sample.source.slice(comment.end);
    const verification = verifyCandidate(sample.path, sample.source, candidate);
    assert.equal(verification.valid, true, `${sample.path}: ${verification.reasons.join(", ")}`);
  }
});

test("language-specific compiler and formatter directives remain protected", () => {
  const directives = [
    ["sample.py", "value = 1\n# type: ignore[assignment]\nvalue = bad\n"],
    ["sample.go", "package sample\n//go:generate stringer -type=Kind\ntype Kind int\n"],
    ["sample.rs", "const V: i32 = 1;\n// rustfmt::skip\nfn value() -> i32 { 1 }\n"],
    ["sample.cs", "class A {\n// NOLINT: generated interop\nint Value => 1;\n}\n"],
    ["sample.php", "<?php\necho 1;\n// phpstan-ignore-next-line\necho missing();\n"],
    ["sample.rb", "value = 1\n# rubocop:disable Metrics/MethodLength\nputs value\n"],
    ["sample.sh", "value=1\n# shellcheck disable=SC2086\nprintf '%s' $value\n"],
    ["sample.sql", "select 1;\n-- sqlfluff: disable=L016\nselect 2;\n"],
  ] as const;

  for (const [path, source] of directives) {
    const comment = extractComments(path, source)[0];
    assert.ok(comment, path);
    assert.match(protectedReason(comment) ?? "", /Tool|compiler|formatter|coverage/u, path);
  }
});

const writeTest = process.platform === "win32" ? test.skip : test;

writeTest("a Python finding completes the existing recoverable fix transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-python-fix-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Multi-language Test"]);
    const path = join(root, "sample.py");
    const baseline = "def value():\n    return 1\n";
    writeFileSync(path, baseline);
    git(root, ["add", "sample.py"]);
    git(root, ["commit", "-qm", "baseline"]);
    const changed = 'marker = "# not a comment"\n# Step 1: return value\ndef value():\n    return 1\n';
    writeFileSync(path, changed);

    const report = analyzeRepository(root, { kind: "worktree" });
    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "comments.step-narration",
    );
    assert.ok(finding);
    assert.equal(finding.suggestedReplacement, "# Return value");
    const receipt = applyFinding(root, finding, { kind: "worktree" });
    assert.equal(receipt.status, "applied");
    assert.match(readFileSync(path, "utf8"), /^# Return value$/mu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SQL findings remain review-only until a dialect parser is available", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-sql-scan-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Multi-language Test"]);
    const path = join(root, "query.sql");
    writeFileSync(path, "select 1;\n");
    git(root, ["add", "query.sql"]);
    git(root, ["commit", "-qm", "baseline"]);
    writeFileSync(path, "select '-- not a comment';\n-- Step 1: return value\nselect 1;\n");

    const report = analyzeRepository(root, { kind: "worktree" });
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]?.action, "rewrite-suggested");
    assert.match(report.findings[0]?.reason ?? "", /unavailable/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one Git diff analyzes every registered language in its declared batch", () => {
  const root = mkdtempSync(join(tmpdir(), "repofit-all-languages-diff-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Multi-language Test"]);
    for (const sample of SAMPLES) {
      writeFileSync(
        join(root, sample.path),
        sample.source.replace(/^.*Step 1: return value.*(?:\r?\n|$)/mu, ""),
      );
    }
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "multi-language baseline"]);
    for (const sample of SAMPLES) writeFileSync(join(root, sample.path), sample.source);

    const report = analyzeRepository(root, { kind: "worktree" });
    assert.equal(report.summary.analyzedFileCount, SAMPLES.length);
    assert.equal(report.summary.rewriteSafeCount, SAMPLES.length - 1);
    assert.equal(report.summary.rewriteSuggestedCount, 1);
    assert.equal(report.summary.parseErrorCount, 0);
    assert.deepEqual(
      report.findings.map((finding) => finding.relativePath).sort(),
      SAMPLES.map((sample) => sample.path).sort(),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
