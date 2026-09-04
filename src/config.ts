import { lstatSync, readFileSync } from "node:fs";
import { matchesGlob, posix, resolve } from "node:path";

import { decodeUtf8Bytes } from "./encoding.js";
import { RULE_PACK_VERSION } from "./model.js";
import {
  RULE_CATALOG,
  RULE_IDS,
  type RuleId,
} from "./rule-catalog.js";

export { RULE_PACK_VERSION } from "./model.js";
export { RULE_IDS, type RuleId } from "./rule-catalog.js";

export const CONFIG_FILE_NAME = ".repofit.json";
export const CONFIG_SCHEMA_VERSION = "1.0";
export const MAX_CONFIG_BYTES = 256 * 1024;

export type RuleLevel = "off" | "info" | "warning" | "error";
export type FailOnLevel = "never" | "info" | "warning" | "error";
export type DisplayLanguage = "auto" | "en" | "zh";
export type DisplayFormat = "terminal" | "json" | "sarif";

export interface ProtectionConfig {
  readonly phrases: readonly string[];
  readonly paths: readonly string[];
}

export interface ResourceLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxChangedLines: number;
  readonly maxFindings: number;
  readonly maxProfileFiles: number;
  readonly maxBackupBytes: number;
  readonly maxRecoveryRecords: number;
  readonly maxRecoveryBytes: number;
}

export interface DisplayConfig {
  readonly language: DisplayLanguage;
  readonly format: DisplayFormat;
}

export interface RepoFitConfig {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  readonly rulePackVersion: typeof RULE_PACK_VERSION;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly protect: ProtectionConfig;
  readonly rules: Readonly<Record<RuleId, RuleLevel>>;
  readonly failOn: FailOnLevel;
  readonly limits: ResourceLimits;
  readonly display: DisplayConfig;
}

export interface ResolvedConfig {
  readonly source: "defaults" | "repository";
  readonly path: string;
  readonly config: RepoFitConfig;
}

export type ConfigErrorCode =
  | "config-io"
  | "invalid-config"
  | "unsupported-schema"
  | "unsupported-rule-pack";

export class ConfigError extends Error {
  constructor(
    readonly code: ConfigErrorCode,
    readonly configPath: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${message} (${configPath})`, options);
    this.name = "ConfigError";
  }
}

const DEFAULT_RULE_LEVELS = Object.fromEntries(
  RULE_CATALOG.map((rule) => [rule.id, rule.defaultLevel]),
) as Record<RuleId, RuleLevel>;

export const CONFIG_LIMIT_CEILINGS: Readonly<ResourceLimits> = Object.freeze({
  maxFiles: 1_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxChangedLines: 100_000,
  maxFindings: 10_000,
  maxProfileFiles: 1_000,
  maxBackupBytes: 2 * 1024 * 1024,
  maxRecoveryRecords: 200,
  maxRecoveryBytes: 64 * 1024 * 1024,
});

const DEFAULT_LIMITS: ResourceLimits = {
  maxFiles: 200,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxChangedLines: 10_000,
  maxFindings: 1_000,
  maxProfileFiles: 200,
  maxBackupBytes: 2 * 1024 * 1024,
  maxRecoveryRecords: 200,
  maxRecoveryBytes: 64 * 1024 * 1024,
};

const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/vendors/**",
  "**/third_party/**",
  "**/third-party/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/generated/**",
  "**/__generated__/**",
  "**/fixture/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/migration/**",
  "**/migrations/**",
  "**/__migrations__/**",
  "**/snapshot/**",
  "**/snapshots/**",
  "**/__snapshots__/**",
  "**/*.generated.*",
  "**/*.gen.*",
  "**/*.min.*",
  "**/*.d.ts",
  "**/*.d.mts",
  "**/*.d.cts",
];

function freezeConfig(config: RepoFitConfig): RepoFitConfig {
  Object.freeze(config.include);
  Object.freeze(config.exclude);
  Object.freeze(config.protect.phrases);
  Object.freeze(config.protect.paths);
  Object.freeze(config.protect);
  Object.freeze(config.rules);
  Object.freeze(config.limits);
  Object.freeze(config.display);
  return Object.freeze(config);
}

function createDefaultConfig(): RepoFitConfig {
  return freezeConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    rulePackVersion: RULE_PACK_VERSION,
    include: [...DEFAULT_INCLUDE],
    exclude: [...DEFAULT_EXCLUDE],
    protect: { phrases: [], paths: [] },
    rules: { ...DEFAULT_RULE_LEVELS },
    failOn: "warning",
    limits: { ...DEFAULT_LIMITS },
    display: { language: "auto", format: "terminal" },
  });
}

export const DEFAULT_CONFIG = createDefaultConfig();

function configError(
  code: ConfigErrorCode,
  configPath: string,
  message: string,
  cause?: unknown,
): never {
  throw new ConfigError(
    code,
    configPath,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function strictObject(
  value: unknown,
  configPath: string,
  field: string,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return configError("invalid-config", configPath, `${field} must be an object.`);
  }
  const object = value as Record<string, unknown>;
  const unknownKey = Object.keys(object).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    return configError(
      "invalid-config",
      configPath,
      `${field} contains unknown field ${JSON.stringify(unknownKey)}.`,
    );
  }
  return object;
}

function stringList(
  value: unknown,
  fallback: readonly string[],
  configPath: string,
  field: string,
  maximumItems = 256,
  maximumLength = 512,
): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length > maximumItems) {
    return configError(
      "invalid-config",
      configPath,
      `${field} must be an array with at most ${maximumItems} entries.`,
    );
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.length === 0 ||
      item.length > maximumLength ||
      item.includes("\0") ||
      item.trim() !== item
    ) {
      return configError(
        "invalid-config",
        configPath,
        `${field} entries must be non-empty, trimmed strings of at most ${maximumLength} characters.`,
      );
    }
    if (seen.has(item)) {
      return configError(
        "invalid-config",
        configPath,
        `${field} contains duplicate entry ${JSON.stringify(item)}.`,
      );
    }
    seen.add(item);
    values.push(item);
  }
  return values;
}

function enumValue<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[],
  configPath: string,
  field: string,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return configError(
      "invalid-config",
      configPath,
      `${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

function pathPatternList(
  value: unknown,
  fallback: readonly string[],
  configPath: string,
  field: string,
): string[] {
  const patterns = stringList(value, fallback, configPath, field);
  for (const pattern of patterns) {
    if (
      pattern.includes("\\") ||
      posix.isAbsolute(pattern) ||
      /^[A-Za-z]:/.test(pattern) ||
      pattern.split("/").includes("..")
    ) {
      return configError(
        "invalid-config",
        configPath,
        `${field} entries must be repository-relative POSIX-style patterns without parent traversal.`,
      );
    }
  }
  return patterns;
}

function positiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  configPath: string,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return configError(
      "invalid-config",
      configPath,
      `${field} must be an integer between 1 and ${maximum}.`,
    );
  }
  return value as number;
}

function parseDocument(raw: unknown, configPath: string): RepoFitConfig {
  const root = strictObject(
    raw,
    configPath,
    "configuration",
    new Set([
      "schemaVersion",
      "rulePackVersion",
      "include",
      "exclude",
      "protect",
      "rules",
      "failOn",
      "limits",
      "display",
    ]),
  );

  if (root.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return configError(
      "unsupported-schema",
      configPath,
      `schemaVersion must be ${JSON.stringify(CONFIG_SCHEMA_VERSION)}.`,
    );
  }
  if (root.rulePackVersion !== RULE_PACK_VERSION) {
    return configError(
      "unsupported-rule-pack",
      configPath,
      `rulePackVersion must be ${JSON.stringify(RULE_PACK_VERSION)}.`,
    );
  }

  const protect =
    root.protect === undefined
      ? undefined
      : strictObject(root.protect, configPath, "protect", new Set(["phrases", "paths"]));
  const rules =
    root.rules === undefined
      ? undefined
      : strictObject(root.rules, configPath, "rules", new Set(RULE_IDS));
  const limits =
    root.limits === undefined
      ? undefined
      : strictObject(
          root.limits,
          configPath,
          "limits",
          new Set(Object.keys(DEFAULT_LIMITS)),
        );
  const display =
    root.display === undefined
      ? undefined
      : strictObject(root.display, configPath, "display", new Set(["language", "format"]));

  const resolvedRules = { ...DEFAULT_RULE_LEVELS };
  for (const ruleId of RULE_IDS) {
    resolvedRules[ruleId] = enumValue(
      rules?.[ruleId],
      resolvedRules[ruleId],
      ["off", "info", "warning", "error"],
      configPath,
      `rules.${ruleId}`,
    );
  }

  const resolvedLimits = { ...DEFAULT_LIMITS };
  for (const name of Object.keys(DEFAULT_LIMITS) as Array<keyof ResourceLimits>) {
    resolvedLimits[name] = positiveInteger(
      limits?.[name],
      resolvedLimits[name],
      CONFIG_LIMIT_CEILINGS[name],
      configPath,
      `limits.${name}`,
    );
  }
  if (resolvedLimits.maxFileBytes > resolvedLimits.maxTotalBytes) {
    return configError(
      "invalid-config",
      configPath,
      "limits.maxFileBytes cannot exceed limits.maxTotalBytes.",
    );
  }

  return freezeConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    rulePackVersion: RULE_PACK_VERSION,
    include: pathPatternList(root.include, DEFAULT_INCLUDE, configPath, "include"),
    exclude: pathPatternList(root.exclude, DEFAULT_EXCLUDE, configPath, "exclude"),
    protect: {
      phrases: stringList(protect?.phrases, [], configPath, "protect.phrases", 256, 256),
      paths: pathPatternList(protect?.paths, [], configPath, "protect.paths"),
    },
    rules: resolvedRules,
    failOn: enumValue(
      root.failOn,
      DEFAULT_CONFIG.failOn,
      ["never", "info", "warning", "error"],
      configPath,
      "failOn",
    ),
    limits: resolvedLimits,
    display: {
      language: enumValue(
        display?.language,
        DEFAULT_CONFIG.display.language,
        ["auto", "en", "zh"],
        configPath,
        "display.language",
      ),
      format: enumValue(
        display?.format,
        DEFAULT_CONFIG.display.format,
        ["terminal", "json", "sarif"],
        configPath,
        "display.format",
      ),
    },
  });
}

function decodeConfig(serialized: string | Uint8Array, configPath: string): string {
  const byteLength =
    typeof serialized === "string"
      ? Buffer.byteLength(serialized, "utf8")
      : serialized.byteLength;
  if (byteLength > MAX_CONFIG_BYTES) {
    return configError(
      "invalid-config",
      configPath,
      `Configuration exceeds the ${MAX_CONFIG_BYTES}-byte limit.`,
    );
  }
  if (typeof serialized === "string") return serialized;
  try {
    const decoded = decodeUtf8Bytes(serialized, `Configuration ${configPath}`);
    return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
  } catch (error) {
    return configError("invalid-config", configPath, "Configuration is not valid UTF-8.", error);
  }
}

export function parseConfig(
  serialized: string | Uint8Array,
  configPath = CONFIG_FILE_NAME,
): RepoFitConfig {
  const text = decodeConfig(serialized, configPath);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    return configError("invalid-config", configPath, "Configuration is not valid JSON.", error);
  }
  return parseDocument(raw, configPath);
}

function cloneConfig(config: RepoFitConfig): RepoFitConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    rulePackVersion: RULE_PACK_VERSION,
    include: [...config.include],
    exclude: [...config.exclude],
    protect: {
      phrases: [...config.protect.phrases],
      paths: [...config.protect.paths],
    },
    rules: { ...config.rules },
    failOn: config.failOn,
    limits: { ...config.limits },
    display: { ...config.display },
  };
}

export function printableConfig(value: RepoFitConfig | ResolvedConfig): RepoFitConfig {
  return cloneConfig("config" in value ? value.config : value);
}

export function formatConfig(value: RepoFitConfig | ResolvedConfig): string {
  return `${JSON.stringify(printableConfig(value), null, 2)}\n`;
}

export const INITIAL_CONFIG_CONTENT = formatConfig(DEFAULT_CONFIG);

export function pathMatchesAny(
  relativePath: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => matchesGlob(relativePath, pattern));
}

export function pathIncluded(config: RepoFitConfig, relativePath: string): boolean {
  return (
    pathMatchesAny(relativePath, config.include) &&
    !pathMatchesAny(relativePath, config.exclude) &&
    !pathMatchesAny(relativePath, config.protect.paths)
  );
}

export function resolveConfig(repositoryRoot: string): ResolvedConfig {
  const configPath = resolve(repositoryRoot, CONFIG_FILE_NAME);
  let metadata;
  try {
    metadata = lstatSync(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        source: "defaults",
        path: configPath,
        config: createDefaultConfig(),
      };
    }
    return configError("config-io", configPath, "Unable to inspect configuration.", error);
  }

  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    return configError(
      "invalid-config",
      configPath,
      "Configuration must be a regular file, not a symlink or directory.",
    );
  }
  if (metadata.size > MAX_CONFIG_BYTES) {
    return configError(
      "invalid-config",
      configPath,
      `Configuration exceeds the ${MAX_CONFIG_BYTES}-byte limit.`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(configPath);
  } catch (error) {
    return configError("config-io", configPath, "Unable to read configuration.", error);
  }
  return {
    source: "repository",
    path: configPath,
    config: parseConfig(bytes, configPath),
  };
}
