import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  Ajv2020,
  type AnySchema,
  type ErrorObject,
} from "ajv/dist/2020.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemasDirectory = join(repositoryRoot, "schemas");
const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat(
    "uuid",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  ajv.addFormat("date-time", (value: string) => !Number.isNaN(Date.parse(value)));
  for (const name of readdirSync(schemasDirectory).filter((entry) => entry.endsWith(".json"))) {
    ajv.addSchema(
      JSON.parse(readFileSync(join(schemasDirectory, name), "utf8")) as AnySchema,
    );
  }
  return ajv;
}

function schemaId(name: string): string {
  return `https://github.com/TAOMA-06/repofit-comments/schemas/${name}.schema.json`;
}

function validate(
  ajv: ReturnType<typeof createValidator>,
  name: string,
  value: unknown,
): void {
  const validator = ajv.getSchema(schemaId(name));
  assert.ok(validator, `missing compiled schema ${name}`);
  assert.equal(
    validator(value),
    true,
    JSON.stringify(validator.errors as ErrorObject[] | null, null, 2),
  );
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function runJson(root: string, args: string[], expectedStatus: number): unknown {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--format", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(expectedStatus >= 2 ? result.stderr : result.stdout) as unknown;
}

test("Ajv 2020 compiles every shipped schema and validates real CLI envelopes", () => {
  const ajv = createValidator();
  const root = mkdtempSync(join(tmpdir(), "repofit-schema-contract-"));
  try {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "repofit@example.invalid"]);
    git(root, ["config", "user.name", "RepoFit Schema Test"]);
    validate(ajv, "config-initialized", runJson(root, ["init"], 0));
    validate(
      ajv,
      "config",
      JSON.parse(readFileSync(join(root, ".repofit.json"), "utf8")),
    );
    validate(ajv, "doctor", runJson(root, ["doctor"], 0));

    const path = join(root, "sample.ts");
    const baseline = "export function value(): number {\n  return 1;\n}\n";
    writeFileSync(path, baseline);
    git(root, ["add", "sample.ts", ".repofit.json"]);
    git(root, ["commit", "-qm", "baseline"]);
    writeFileSync(path, baseline.replace("  return 1;", "  // Main Logic\n  return 1;"));
    const report = runJson(root, ["check", "--worktree"], 1) as {
      findings: Array<{ id: string }>;
    };
    validate(ajv, "analysis-report", report);
    const findingId = report.findings[0]?.id;
    assert.ok(findingId);
    validate(ajv, "profile", runJson(root, ["profile", "--worktree"], 0));
    validate(
      ajv,
      "finding-explanation",
      runJson(root, ["explain", findingId, "--worktree"], 0),
    );
    validate(
      ajv,
      "fix-preview",
      runJson(root, ["fix", findingId, "--worktree", "--dry-run"], 0),
    );
    validate(
      ajv,
      "error",
      runJson(root, ["check", "unexpected"], 2),
    );

    if (process.platform !== "win32") {
      const receipt = runJson(root, ["fix", findingId, "--worktree", "--apply"], 0);
      validate(ajv, "fix-receipt", receipt);
      validate(ajv, "verification", runJson(root, ["verify"], 0));
      validate(ajv, "fix-receipt", runJson(root, ["undo"], 0));
      validate(ajv, "history", runJson(root, ["history", "list"], 0));
      validate(
        ajv,
        "history-prune",
        runJson(root, ["history", "prune", "--keep", "1"], 0),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("receipt schema rejects mixed runtime states and unpaired recovery fields", () => {
  const ajv = createValidator();
  const validator = ajv.getSchema(schemaId("fix-receipt"));
  assert.ok(validator);
  const hash = "a".repeat(64);
  const prepared = {
    schemaVersion: "3.0",
    receiptId: "123e4567-e89b-42d3-a456-426614174000",
    repositoryId: "123e4567-e89b-42d3-a456-426614174001",
    status: "prepared",
    findingIds: ["RF-COM-ABC"],
    relativePath: "a.ts",
    analysisScope: { kind: "worktree" },
    writeTarget: "worktree",
    preparedAt: "2026-09-04T00:00:00.000Z",
    fileMode: 420,
    beforeFileHash: hash,
    afterFileHash: hash,
    nonCommentTokenHash: hash,
    syntaxTreeHash: hash,
    protectedCommentHash: hash,
  };
  assert.equal(validator(prepared), true);
  assert.equal(validator({ ...prepared, appliedAt: prepared.preparedAt }), false);
  assert.equal(
    validator({
      ...prepared,
      status: "applied",
      appliedAt: prepared.preparedAt,
      recoveredAt: prepared.preparedAt,
    }),
    false,
  );
});
