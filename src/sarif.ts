import type { AnalysisReport, Finding, FindingAction } from "./model.js";
import { RULE_CATALOG, type RuleDefinition } from "./rule-catalog.js";

const SARIF_SCHEMA_URI = "https://json.schemastore.org/sarif-2.1.0.json";
const SARIF_VERSION = "2.1.0";

export type SarifLevel = "none" | "note" | "warning" | "error";

interface SarifMessage {
  text: string;
}

interface SarifRuleProperties {
  tags: string[];
  precision: "very-high" | "high" | "medium" | "low";
  "problem.severity": "error" | "warning" | "recommendation";
  "repofit.defaultAction": FindingAction;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  fullDescription: SarifMessage;
  defaultConfiguration: {
    level: Exclude<SarifLevel, "none">;
  };
  help: SarifMessage;
  properties: SarifRuleProperties;
}

interface SarifResultProperties {
  findingId: string;
  fingerprint: string;
  action: FindingAction;
  category: string;
  originalComment: string;
  evidence: string[];
  sourceHash: string;
  suggestedReplacement?: string;
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  kind: "fail" | "review";
  level: SarifLevel;
  message: SarifMessage;
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
      region: {
        startLine: number;
        endLine: number;
      };
    };
  }>;
  partialFingerprints: {
    "repofitFingerprint/v1": string;
  };
  properties: SarifResultProperties;
}

export interface SarifLog {
  $schema: typeof SARIF_SCHEMA_URI;
  version: typeof SARIF_VERSION;
  runs: Array<{
    tool: {
      driver: {
        name: "RepoFit Comments";
        informationUri: "https://github.com/TAOMA-06/repofit-comments";
        version: string;
        semanticVersion: string;
        properties: { "repofit.rulePackVersion": string };
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFindings(left: Finding, right: Finding): number {
  return (
    compareText(left.relativePath, right.relativePath) ||
    left.line - right.line ||
    left.endLine - right.endLine ||
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.id, right.id) ||
    compareText(left.action, right.action) ||
    compareText(left.reason, right.reason) ||
    compareText(left.original, right.original) ||
    compareText(left.evidence.join("\u0000"), right.evidence.join("\u0000"))
  );
}

function ruleLevel(action: FindingAction): Exclude<SarifLevel, "none"> {
  return action === "remove-safe" || action === "rewrite-safe" ? "warning" : "note";
}

function findingLevel(finding: Finding): SarifLevel {
  if (finding.action === "keep-protected" || finding.action === "uncertain") {
    return "none";
  }
  return finding.level === "error"
    ? "error"
    : finding.level === "warning"
      ? "warning"
      : "note";
}

function problemSeverity(
  action: FindingAction,
): SarifRuleProperties["problem.severity"] {
  return action === "remove-safe" || action === "rewrite-safe"
    ? "warning"
    : "recommendation";
}

function descriptorFor(definition: RuleDefinition): SarifRule {
  return {
    id: definition.id,
    name: definition.name,
    shortDescription: { text: definition.shortDescription },
    fullDescription: { text: definition.fullDescription },
    defaultConfiguration: { level: ruleLevel(definition.defaultAction) },
    help: { text: definition.fullDescription },
    properties: {
      tags: ["maintainability", "comments"],
      precision: definition.precision,
      "problem.severity": problemSeverity(definition.defaultAction),
      "repofit.defaultAction": definition.defaultAction,
    },
  };
}

function fallbackDefinition(ruleId: string): RuleDefinition {
  const suffix = ruleId.split(".").at(-1) ?? ruleId;
  const name = suffix.replace(/[^A-Za-z0-9_-]+/g, "-") || "unknown-rule";
  return {
    id: ruleId,
    name,
    shortDescription: `RepoFit finding from ${ruleId}`,
    fullDescription: `Reports a RepoFit Comments finding produced by the ${ruleId} rule.`,
    defaultAction: "uncertain",
    defaultLevel: "info",
    precision: "low",
  };
}

function rulesFor(findings: readonly Finding[]): SarifRule[] {
  const definitions = new Map<string, RuleDefinition>(
    RULE_CATALOG.map((definition) => [definition.id, definition]),
  );
  for (const finding of findings) {
    if (!finding.ruleId) throw new Error("SARIF conversion requires a non-empty rule ID.");
    if (!definitions.has(finding.ruleId)) {
      definitions.set(finding.ruleId, fallbackDefinition(finding.ruleId));
    }
  }
  return [...definitions.values()]
    .sort((left, right) => compareText(left.id, right.id))
    .map(descriptorFor);
}

function encodeUriSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function relativeFileUri(relativePath: string): string {
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    relativePath.includes("\u0000") ||
    relativePath.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`SARIF conversion requires a canonical repository-relative path: ${relativePath}`);
  }
  return segments.map(encodeUriSegment).join("/");
}

function regionFor(finding: Finding): { startLine: number; endLine: number } {
  if (
    !Number.isInteger(finding.line) ||
    finding.line < 1 ||
    !Number.isInteger(finding.endLine) ||
    finding.endLine < finding.line
  ) {
    throw new Error(`SARIF conversion requires a valid 1-based region for ${finding.id}.`);
  }
  return { startLine: finding.line, endLine: finding.endLine };
}

function resultFor(finding: Finding, ruleIndex: number): SarifResult {
  if (!finding.id) throw new Error("SARIF conversion requires a non-empty finding ID.");
  const level = findingLevel(finding);
  return {
    ruleId: finding.ruleId,
    ruleIndex,
    kind: level === "none" ? "review" : "fail",
    level,
    message: { text: `${finding.category}: ${finding.reason}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: relativeFileUri(finding.relativePath),
          },
          region: regionFor(finding),
        },
      },
    ],
    partialFingerprints: {
      "repofitFingerprint/v1": finding.fingerprint,
    },
    properties: {
      findingId: finding.id,
      fingerprint: finding.fingerprint,
      action: finding.action,
      category: finding.category,
      originalComment: finding.original,
      evidence: [...finding.evidence],
      sourceHash: finding.sourceHash,
      ...(finding.suggestedReplacement === undefined
        ? {}
        : { suggestedReplacement: finding.suggestedReplacement }),
    },
  };
}

export function toSarif(report: AnalysisReport): SarifLog {
  const findings = [...report.findings].sort(compareFindings);
  const rules = rulesFor(findings);
  const ruleIndexes = new Map(rules.map((rule, index) => [rule.id, index]));
  const results = findings.map((finding) => {
    const ruleIndex = ruleIndexes.get(finding.ruleId);
    if (ruleIndex === undefined) {
      throw new Error(`SARIF rule metadata is missing for ${finding.ruleId}.`);
    }
    return resultFor(finding, ruleIndex);
  });

  return {
    $schema: SARIF_SCHEMA_URI,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "RepoFit Comments",
            informationUri: "https://github.com/TAOMA-06/repofit-comments",
            version: report.toolVersion ?? report.rulePackVersion,
            semanticVersion: report.toolVersion ?? report.rulePackVersion,
            properties: { "repofit.rulePackVersion": report.rulePackVersion },
            rules,
          },
        },
        results,
      },
    ],
  };
}

export function renderSarif(report: AnalysisReport): string {
  return `${JSON.stringify(toSarif(report), null, 2)}\n`;
}
