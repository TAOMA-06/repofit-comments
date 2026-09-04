import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONFIG_FILE_NAME,
  CONFIG_LIMIT_CEILINGS,
  CONFIG_SCHEMA_VERSION,
  ConfigError,
  DEFAULT_CONFIG,
  formatConfig,
  INITIAL_CONFIG_CONTENT,
  MAX_CONFIG_BYTES,
  parseConfig,
  printableConfig,
  resolveConfig,
  RULE_IDS,
  RULE_PACK_VERSION,
} from "../src/config.js";

function temporaryRepository(prefix: string): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function minimumDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    rulePackVersion: RULE_PACK_VERSION,
    ...overrides,
  };
}

function expectConfigError(
  callback: () => unknown,
  code: ConfigError["code"] = "invalid-config",
): ConfigError {
  let captured: unknown;
  try {
    callback();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof ConfigError);
  assert.equal(captured.code, code);
  return captured;
}

test("resolveConfig returns independent immutable defaults when the file is absent", () => {
  const fixture = temporaryRepository("repofit-config-defaults-");
  try {
    const first = resolveConfig(fixture.root);
    const second = resolveConfig(fixture.root);

    assert.equal(first.source, "defaults");
    assert.equal(first.path, join(fixture.root, CONFIG_FILE_NAME));
    assert.deepEqual(printableConfig(first), printableConfig(DEFAULT_CONFIG));
    assert.notEqual(first.config, second.config);
    assert.notEqual(first.config.include, second.config.include);
    assert.equal(Object.isFrozen(first.config), true);
    assert.equal(Object.isFrozen(first.config.rules), true);
  } finally {
    fixture.cleanup();
  }
});

test("repository JSON overrides supported fields and inherits all other defaults", () => {
  const fixture = temporaryRepository("repofit-config-valid-");
  try {
    const document = minimumDocument({
      include: ["src/**/*.ts"],
      exclude: [],
      protect: {
        phrases: ["Keep this protocol rationale"],
        paths: ["src/generated/**"],
      },
      rules: {
        "comments.step-label": "off",
        "comments.meta-narration": "info",
      },
      failOn: "error",
      limits: {
        maxFiles: 42,
        maxFileBytes: 1_024,
        maxRecoveryRecords: 25,
      },
      display: { language: "zh", format: "json" },
    });
    writeFileSync(
      join(fixture.root, CONFIG_FILE_NAME),
      `${JSON.stringify(document, null, 2)}\n`,
      "utf8",
    );

    const resolved = resolveConfig(fixture.root);
    assert.equal(resolved.source, "repository");
    assert.deepEqual(resolved.config.include, ["src/**/*.ts"]);
    assert.deepEqual(resolved.config.exclude, []);
    assert.deepEqual(resolved.config.protect.phrases, ["Keep this protocol rationale"]);
    assert.deepEqual(resolved.config.protect.paths, ["src/generated/**"]);
    assert.equal(resolved.config.rules["comments.step-label"], "off");
    assert.equal(resolved.config.rules["comments.meta-narration"], "info");
    assert.equal(resolved.config.rules["comments.code-restatement"], "warning");
    assert.equal(resolved.config.failOn, "error");
    assert.equal(resolved.config.limits.maxFiles, 42);
    assert.equal(resolved.config.limits.maxFileBytes, 1_024);
    assert.equal(resolved.config.limits.maxRecoveryRecords, 25);
    assert.equal(resolved.config.limits.maxProfileFiles, DEFAULT_CONFIG.limits.maxProfileFiles);
    assert.deepEqual(resolved.config.display, { language: "zh", format: "json" });
  } finally {
    fixture.cleanup();
  }
});

test("strict schema rejects unknown root, nested, and rule fields", () => {
  for (const document of [
    minimumDocument({ unexpected: true }),
    minimumDocument({ protect: { phrases: [], unknown: [] } }),
    minimumDocument({ limits: { maxFiles: 2, unknown: 3 } }),
    minimumDocument({ display: { language: "en", color: true } }),
    minimumDocument({ rules: { "comments.not-a-rule": "warning" } }),
  ]) {
    expectConfigError(() => parseConfig(JSON.stringify(document)));
  }
});

test("schema and rule-pack versions are explicit compatibility gates", () => {
  expectConfigError(
    () => parseConfig(JSON.stringify({ rulePackVersion: RULE_PACK_VERSION })),
    "unsupported-schema",
  );
  expectConfigError(
    () =>
      parseConfig(
        JSON.stringify({ schemaVersion: CONFIG_SCHEMA_VERSION, rulePackVersion: "future" }),
      ),
    "unsupported-rule-pack",
  );
});

test("rule levels, failOn, display values, and list entries are validated", () => {
  const invalidDocuments = [
    minimumDocument({ rules: { "comments.step-label": "safe" } }),
    minimumDocument({ failOn: "fatal" }),
    minimumDocument({ display: { language: "fr" } }),
    minimumDocument({ display: { format: "yaml" } }),
    minimumDocument({ include: [" src/**"] }),
    minimumDocument({ exclude: ["src/**", "src/**"] }),
    minimumDocument({ protect: { phrases: [""], paths: [] } }),
    minimumDocument({ protect: { phrases: [], paths: ["bad\0path"] } }),
    minimumDocument({ include: ["../outside/**"] }),
    minimumDocument({ exclude: ["src\\generated\\**"] }),
    minimumDocument({ protect: { phrases: [], paths: ["/absolute/**"] } }),
  ];

  for (const document of invalidDocuments) {
    expectConfigError(() => parseConfig(JSON.stringify(document)));
  }
});

test("resource limits require positive safe integers within hard ceilings", () => {
  for (const [name, ceiling] of Object.entries(CONFIG_LIMIT_CEILINGS)) {
    expectConfigError(
      () => parseConfig(JSON.stringify(minimumDocument({ limits: { [name]: 0 } }))),
    );
    expectConfigError(
      () =>
        parseConfig(
          JSON.stringify(minimumDocument({ limits: { [name]: ceiling + 1 } })),
        ),
    );
    expectConfigError(
      () => parseConfig(JSON.stringify(minimumDocument({ limits: { [name]: 1.5 } }))),
    );
  }
  expectConfigError(() =>
    parseConfig(
      JSON.stringify(
        minimumDocument({ limits: { maxFileBytes: 2_048, maxTotalBytes: 1_024 } }),
      ),
    ),
  );
});

test("configuration input is size-bounded, valid UTF-8 JSON", () => {
  expectConfigError(() => parseConfig(Buffer.from([0xff])));
  expectConfigError(() => parseConfig("{"));
  expectConfigError(() => parseConfig(" ".repeat(MAX_CONFIG_BYTES + 1)));

  const withBom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(minimumDocument())),
  ]);
  assert.equal(parseConfig(withBom).schemaVersion, CONFIG_SCHEMA_VERSION);
});

test("resolveConfig refuses a symlinked configuration", {
  skip: process.platform === "win32",
}, () => {
  const fixture = temporaryRepository("repofit-config-path-");
  try {
    const target = join(fixture.root, "config-target.json");
    writeFileSync(target, JSON.stringify(minimumDocument()), "utf8");
    symlinkSync(target, join(fixture.root, CONFIG_FILE_NAME));
    expectConfigError(() => resolveConfig(fixture.root));
  } finally {
    fixture.cleanup();
  }
});

test("resolveConfig refuses a directory in place of the configuration file", () => {
  const directoryFixture = temporaryRepository("repofit-config-directory-");
  try {
    mkdirSync(join(directoryFixture.root, CONFIG_FILE_NAME));
    expectConfigError(() => resolveConfig(directoryFixture.root));
  } finally {
    directoryFixture.cleanup();
  }
});

test("only the static JSON filename is discovered", () => {
  const fixture = temporaryRepository("repofit-config-static-");
  try {
    const marker = join(fixture.root, "executed.marker");
    writeFileSync(
      join(fixture.root, ".repofit.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed")`,
      "utf8",
    );

    const resolved = resolveConfig(fixture.root);
    assert.equal(resolved.source, "defaults");
    assert.equal(existsSync(marker), false);
  } finally {
    fixture.cleanup();
  }
});

test("initialization and printable output are deterministic complete JSON", () => {
  const initialized = parseConfig(INITIAL_CONFIG_CONTENT);
  assert.deepEqual(printableConfig(initialized), printableConfig(DEFAULT_CONFIG));
  assert.equal(formatConfig(initialized), INITIAL_CONFIG_CONTENT);
  assert.deepEqual(Object.keys(initialized.rules), [...RULE_IDS]);

  const printable = printableConfig(initialized);
  (printable.include as string[]).push("temporary/**");
  assert.equal(DEFAULT_CONFIG.include.includes("temporary/**"), false);
});
