import assert from "node:assert/strict";
import test from "node:test";

import type { Finding } from "../src/model.js";
import { previewFinding } from "../src/patch.js";
import { renderFinding } from "../src/report.js";
import { sanitizeTerminalText } from "../src/terminal.js";

test("terminal text escapes control, OSC, and bidirectional formatting characters", () => {
  const hostile = "path\nnext\t\u001b]52;c;payload\u0007\u202Ecod.ts";
  const sanitized = sanitizeTerminalText(hostile);

  assert.equal(
    sanitized,
    "path\\nnext\\t\\u{1B}]52;c;payload\\u{7}\\u{202E}cod.ts",
  );
  assert.doesNotMatch(sanitized, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/u);
});

test("terminal finding and preview never emit repository-controlled control characters", () => {
  const finding: Finding = {
    id: "RF-COM-SAFE",
    fingerprint: "RF-FP-SAFE",
    ruleId: "comments.step-label",
    category: "Template step label",
    action: "remove-safe",
    level: "error",
    relativePath: "src/evil\u001b[2J\u202E.ts",
    line: 4,
    endLine: 4,
    original: "// Step 1\nInjected",
    reason: "Generated label.",
    evidence: ["Code\u001b]52;c;payload\u0007"],
    sourceHash: "source",
    commentStart: 0,
    commentEnd: 9,
    removeStart: 0,
    removeEnd: 10,
  };

  for (const output of [renderFinding(finding, true), previewFinding(finding)]) {
    assert.doesNotMatch(output, /\u001b|\u0007|\u202e/u);
    assert.match(output, /\\u\{1B\}/);
    assert.match(output, /\\u\{202E\}/);
    assert.match(output, /\\nInjected/);
  }
});
