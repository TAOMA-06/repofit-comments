import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_SCHEMA_VERSION,
  RULE_PACK_VERSION,
  type AnalysisReport,
  type Finding,
  type FindingAction,
} from "../src/model.js";
import { renderSarif, toSarif } from "../src/sarif.js";

function createFinding(
  id: string,
  ruleId: string,
  action: FindingAction,
  overrides: Partial<Finding> = {},
): Finding {
  return {
    id,
    fingerprint: `RF-FP-${id.slice(-12)}`,
    ruleId,
    category: "Template step label",
    action,
    level:
      action === "remove-safe" || action === "rewrite-safe"
        ? "warning"
        : action === "rewrite-suggested"
          ? "info"
          : "info",
    relativePath: "src/example.ts",
    line: 4,
    endLine: 4,
    original: "// Step 1",
    reason: "This generated step marker contains no implementation rationale.",
    evidence: ["Repository style baseline is incomplete."],
    sourceHash: "a".repeat(64),
    commentStart: 10,
    commentEnd: 19,
    removeStart: 8,
    removeEnd: 20,
    ...overrides,
  };
}

function createReport(
  findings: Finding[],
  generatedAt = "2026-09-04T00:00:00.000Z",
  repositoryRoot = "/private/machine-specific/repository",
): AnalysisReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    rulePackVersion: RULE_PACK_VERSION,
    generatedAt,
    repositoryRoot,
    scope: { kind: "staged" },
    profile: {
      status: "insufficient-style-baseline",
      sampleFileCount: 0,
      commentCount: 0,
      codeLineCount: 0,
      commentDensity: 0,
      averageCommentLength: 0,
      dominantLanguage: "unknown",
      commonPhrases: {},
      examples: [],
    },
    files: [],
    findings,
    protections: [],
    suppressions: [],
    summary: {
      analyzedFileCount: 0,
      changedCommentCount: 0,
      protectedCommentCount: 0,
      removeSafeCount: findings.filter((finding) => finding.action === "remove-safe")
        .length,
      rewriteSafeCount: findings.filter((finding) => finding.action === "rewrite-safe")
        .length,
      rewriteSuggestedCount: findings.filter(
        (finding) => finding.action === "rewrite-suggested",
      ).length,
      parseErrorCount: 0,
      displayedFindingLimit: 5,
    },
  };
}

test("empty reports produce a valid SARIF 2.1.0 run without time or machine paths", () => {
  const report = createReport([]);
  report.toolVersion = "1.0.0-rc.1";
  const sarif = toSarif(report);

  assert.equal(sarif.$schema, "https://json.schemastore.org/sarif-2.1.0.json");
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0]?.tool.driver.name, "RepoFit Comments");
  assert.equal(sarif.runs[0]?.tool.driver.semanticVersion, "1.0.0-rc.1");
  assert.equal(
    sarif.runs[0]?.tool.driver.properties["repofit.rulePackVersion"],
    RULE_PACK_VERSION,
  );
  assert.deepEqual(sarif.runs[0]?.results, []);
  assert.equal(sarif.runs[0]?.tool.driver.rules.length, 10);

  const rendered = renderSarif(report);
  assert.equal(rendered, `${JSON.stringify(sarif, null, 2)}\n`);
  assert.doesNotMatch(rendered, /2026-09-04T00:00:00\.000Z/);
  assert.doesNotMatch(rendered, /private\/machine-specific/);
});

test("results encode repository paths, messages, 1-based regions, IDs, and evidence", () => {
  const finding = createFinding(
    "RF-COM-PATH00000001",
    "comments.step-narration",
    "rewrite-safe",
    {
      category: "Generated step narration",
      relativePath: "src/space #/测试.ts",
      line: 7,
      endLine: 9,
      original: "// Step 1: keep the useful text",
      reason: "The numbered prefix is removable while the useful text is preserved.",
      evidence: ["First observation.", "第二条证据。"],
      suggestedReplacement: "// Keep the useful text",
    },
  );
  const sarif = toSarif(createReport([finding]));
  const result = sarif.runs[0]?.results[0];

  assert.equal(result?.ruleId, "comments.step-narration");
  assert.equal(
    result?.message.text,
    "Generated step narration: The numbered prefix is removable while the useful text is preserved.",
  );
  assert.equal(
    result?.locations[0]?.physicalLocation.artifactLocation.uri,
    "src/space%20%23/%E6%B5%8B%E8%AF%95.ts",
  );
  assert.deepEqual(result?.locations[0]?.physicalLocation.artifactLocation, {
    uri: "src/space%20%23/%E6%B5%8B%E8%AF%95.ts",
  });
  assert.deepEqual(result?.locations[0]?.physicalLocation.region, {
    startLine: 7,
    endLine: 9,
  });
  assert.equal(
    result?.partialFingerprints["repofitFingerprint/v1"],
    finding.fingerprint,
  );
  assert.deepEqual(result?.properties, {
    findingId: finding.id,
    fingerprint: finding.fingerprint,
    action: "rewrite-safe",
    category: "Generated step narration",
    originalComment: "// Step 1: keep the useful text",
    evidence: ["First observation.", "第二条证据。"],
    sourceHash: "a".repeat(64),
    suggestedReplacement: "// Keep the useful text",
  });
});

test("finding actions map to conservative SARIF levels", () => {
  const findings: Finding[] = [
    createFinding("RF-COM-REMOVE000001", "comments.step-label", "remove-safe"),
    createFinding("RF-COM-REWRITE00001", "comments.step-narration", "rewrite-safe"),
    createFinding(
      "RF-COM-SUGGEST00001",
      "comments.tutorial-tone",
      "rewrite-suggested",
    ),
    createFinding(
      "RF-COM-PROTECT00001",
      "comments.future-protected",
      "keep-protected",
    ),
    createFinding("RF-COM-UNKNOWN00001", "comments.future-uncertain", "uncertain"),
  ];
  const results = toSarif(createReport(findings)).runs[0]?.results ?? [];
  const levels = new Map(
    results.map((result) => [result.properties.action, result.level]),
  );

  assert.deepEqual(Object.fromEntries(levels), {
    "keep-protected": "none",
    "remove-safe": "warning",
    "rewrite-safe": "warning",
    "rewrite-suggested": "note",
    uncertain: "none",
  });
  assert.deepEqual(
    Object.fromEntries(
      results.map((result) => [result.properties.action, result.kind]),
    ),
    {
      "keep-protected": "review",
      "remove-safe": "fail",
      "rewrite-safe": "fail",
      "rewrite-suggested": "fail",
      uncertain: "review",
    },
  );
});

test("rule metadata and result ordering are stable across finding order and input time", () => {
  const laterPath = createFinding(
    "RF-COM-LATER000001",
    "comments.decorative-heading",
    "remove-safe",
    { relativePath: "zeta.ts", line: 20, endLine: 20 },
  );
  const earlierPath = createFinding(
    "RF-COM-EARLIER0001",
    "comments.step-narration",
    "rewrite-safe",
    { relativePath: "alpha.ts", line: 2, endLine: 2 },
  );
  const first = createReport([laterPath, earlierPath], "2026-09-04T01:00:00.000Z", "/one");
  const second = createReport([earlierPath, laterPath], "2030-01-01T00:00:00.000Z", "/two");

  assert.equal(renderSarif(first), renderSarif(second));

  const run = toSarif(first).runs[0];
  assert.ok(run);
  const ruleIds = run.tool.driver.rules.map((rule) => rule.id);
  assert.deepEqual(ruleIds, [...ruleIds].sort());
  assert.deepEqual(
    run.results.map((result) => result.properties.findingId),
    [earlierPath.id, laterPath.id],
  );

  const stepRuleIndex = ruleIds.indexOf("comments.step-narration");
  const stepRule = run.tool.driver.rules[stepRuleIndex];
  assert.ok(stepRule);
  assert.equal(stepRule.name, "step-narration");
  assert.equal(stepRule.defaultConfiguration.level, "warning");
  assert.equal(stepRule.properties.precision, "very-high");
  assert.deepEqual(stepRule.properties.tags, ["maintainability", "comments"]);
  assert.equal(
    run.results.find((result) => result.ruleId === stepRule.id)?.ruleIndex,
    stepRuleIndex,
  );
});
