import type { FindingAction, FindingLevel } from "./model.js";

export type RulePrecision = "very-high" | "high" | "medium" | "low";

export interface RuleDefinition {
  id: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  defaultAction: FindingAction;
  defaultLevel: FindingLevel;
  precision: RulePrecision;
}

export const RULE_CATALOG = [
  {
    id: "comments.action-narration",
    name: "action-narration",
    shortDescription: "Action-by-action comment narration",
    fullDescription:
      "Reports comments that narrate an adjacent implementation action and may be redundant when the code is already clear.",
    defaultAction: "rewrite-suggested",
    defaultLevel: "info",
    precision: "medium",
  },
  {
    id: "comments.code-restatement",
    name: "code-restatement",
    shortDescription: "Comment restates adjacent code",
    fullDescription:
      "Reports a narrow standalone comment that only repeats the meaning of the adjacent code.",
    defaultAction: "remove-safe",
    defaultLevel: "warning",
    precision: "very-high",
  },
  {
    id: "comments.decorative-heading",
    name: "decorative-heading",
    shortDescription: "Decorative comment heading",
    fullDescription:
      "Reports a standalone heading that adds layout or process narration without repository-specific intent.",
    defaultAction: "remove-safe",
    defaultLevel: "warning",
    precision: "very-high",
  },
  {
    id: "comments.density-outlier",
    name: "density-outlier",
    shortDescription: "Changed comment density is unusually high",
    fullDescription:
      "Reports a changed region whose unprotected comment density exceeds the applicable review threshold.",
    defaultAction: "rewrite-suggested",
    defaultLevel: "info",
    precision: "medium",
  },
  {
    id: "comments.language-drift",
    name: "language-drift",
    shortDescription: "Changed comments differ from the repository language",
    fullDescription:
      "Reports a group of changed comments whose language differs from a sufficiently strong repository baseline.",
    defaultAction: "rewrite-suggested",
    defaultLevel: "info",
    precision: "medium",
  },
  {
    id: "comments.meta-narration",
    name: "meta-narration",
    shortDescription: "Comment narrates the generation process",
    fullDescription:
      "Reports a comment that describes the act of producing the code instead of repository-specific intent.",
    defaultAction: "rewrite-suggested",
    defaultLevel: "info",
    precision: "medium",
  },
  {
    id: "comments.nearby-duplicate",
    name: "nearby-duplicate",
    shortDescription: "Nearby duplicate comment",
    fullDescription:
      "Reports a standalone comment that duplicates an earlier comment in the same nearby code block.",
    defaultAction: "remove-safe",
    defaultLevel: "warning",
    precision: "very-high",
  },
  {
    id: "comments.step-label",
    name: "step-label",
    shortDescription: "Generated step label",
    fullDescription:
      "Reports a standalone numbered or transitional step marker that contains no implementation rationale.",
    defaultAction: "remove-safe",
    defaultLevel: "warning",
    precision: "very-high",
  },
  {
    id: "comments.step-narration",
    name: "step-narration",
    shortDescription: "Numbered implementation narration",
    fullDescription:
      "Reports a numbered step prefix that can be removed while preserving the comment's substantive text.",
    defaultAction: "rewrite-safe",
    defaultLevel: "warning",
    precision: "very-high",
  },
  {
    id: "comments.tutorial-tone",
    name: "tutorial-tone",
    shortDescription: "Tutorial-style comment explanation",
    fullDescription:
      "Reports a comment that teaches or narrates basic code instead of documenting a non-obvious reason.",
    defaultAction: "rewrite-suggested",
    defaultLevel: "info",
    precision: "medium",
  },
] as const satisfies readonly RuleDefinition[];

export type RuleId = (typeof RULE_CATALOG)[number]["id"];
export const RULE_IDS = RULE_CATALOG.map((rule) => rule.id) as RuleId[];

export function ruleDefinition(ruleId: string): RuleDefinition | undefined {
  return RULE_CATALOG.find((rule) => rule.id === ruleId);
}
