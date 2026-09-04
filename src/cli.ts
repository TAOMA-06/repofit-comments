#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeRepository } from "./analysis.js";
import { formatConfig, resolveConfig } from "./config.js";
import { createDoctorReport, renderDoctor } from "./doctor.js";
import {
  discoverRepositoryRoot,
  readScopedFileContent,
} from "./git.js";
import {
  REPORT_SCHEMA_VERSION,
  RULE_PACK_VERSION,
  type Finding,
  type FixReceipt,
  type Scope,
} from "./model.js";
import {
  applyFinding,
  applyFindings,
  buildCandidateForFindings,
  recoverLastFix,
  undoLastFix,
  verifyLastFix,
} from "./patch.js";
import { renderFinding, renderProfile, renderReport } from "./report.js";
import { renderSarif } from "./sarif.js";
import { initializeRepositoryConfig } from "./initialize.js";
import { listFixHistory, pruneFixHistory } from "./history.js";
import { sanitizeTerminalText } from "./terminal.js";
import {
  renderUnifiedDiff,
  renderUnifiedDiffForTerminal,
} from "./unified-diff.js";

const PACKAGE_MANIFEST = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version?: unknown };
if (typeof PACKAGE_MANIFEST.version !== "string") {
  throw new Error("package.json does not contain a valid version.");
}
const VERSION = PACKAGE_MANIFEST.version;
const ERROR_SCHEMA_VERSION = "1.0";
const EXIT_USAGE = 2;
const EXIT_RUNTIME = 3;
const EXIT_VERIFY_FAILED = 4;
const EXIT_WRITE_REFUSED = 5;

type CliErrorCode = "invalid-arguments" | "analysis-failed" | "write-refused";

class CliError extends Error {
  constructor(
    readonly code: CliErrorCode,
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

function usageError(message: string): never {
  throw new CliError("invalid-arguments", EXIT_USAGE, message);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeRefused(error: unknown): never {
  throw new CliError("write-refused", EXIT_WRITE_REFUSED, messageFrom(error));
}

function wantsJsonOutput(argv: string[]): boolean {
  return argv.some(
    (argument, index) => argument === "--format" && argv[index + 1] === "json",
  );
}

const HELP = `RepoFit Comments ${VERSION}

Usage:
  repofit profile [scope]
  repofit check [scope] [--format terminal|json|sarif]
  repofit preview [scope]
  repofit explain <finding-id> [scope]
  repofit fix <finding-id> --worktree [--dry-run|--apply]
  repofit fix --all-safe [--file <path>] --worktree [--dry-run|--apply]
  repofit verify [--worktree|--staged]
  repofit recover
  repofit undo
  repofit init
  repofit doctor
  repofit history list
  repofit history prune [--keep <count>] [--dry-run|--apply]

Compatibility:
  The Alpha form, repofit comments <command>, remains supported.

Analysis scopes (mutually exclusive; default for profile/check/preview/explain: --staged):
  --staged             Analyze the Git index
  --worktree           Analyze unstaged working-tree changes
  --base <ref>         Analyze merge-base(ref, HEAD)..HEAD

Command-specific scope:
  fix                   Requires --worktree
  verify                Accepts --worktree or --staged; defaults to --worktree
  recover/undo          Use the latest worktree journal and accept no scope flag

Other options:
  --format <value>     terminal, json, or sarif (check/preview only)
  --print-config       Print the resolved static configuration and exit
  --no-color           Disable color (accepted for stable automation; output is currently plain)
  --cwd <directory>    Run against another Git working directory
  --all-safe           Fix every safe finding in one file as one transaction
  --file <path>        Limit --all-safe to this repository-relative file
  --keep <count>       Retain at least this many newest history records (default: 20)
  --help               Show this help
  --version            Show the version

Safety:
  profile/check/preview/explain/verify are read-only and offline. fix --apply changes one
  worktree file after writing recovery data. recover may reconcile an interrupted source
  replacement and updates its journal. undo restores the latest applied journal to the
  worktree. No command stages, commits, or pushes; verify --staged only reads the index.
`;

interface CommonArguments {
  format: "terminal" | "json" | "sarif";
  formatExplicit: boolean;
  cwd: string;
  printConfig: boolean;
  noColor: boolean;
}

type ScopedCommand<Name extends "profile" | "check" | "preview"> =
  CommonArguments & { command: Name; scope: Scope };
type JournalCommand<Name extends "recover" | "undo" | "init" | "doctor"> = CommonArguments & {
  command: Name;
};

type ParsedArguments =
  | ScopedCommand<"profile">
  | ScopedCommand<"check">
  | ScopedCommand<"preview">
  | (CommonArguments & {
      command: "explain";
      scope: Scope;
      findingId: string;
    })
  | (CommonArguments & {
      command: "fix";
      scope: { kind: "worktree" };
      findingId: string | undefined;
      apply: boolean;
      allSafe: boolean;
      file: string | undefined;
    })
  | (CommonArguments & {
      command: "verify";
      target: "worktree" | "staged";
    })
  | JournalCommand<"recover">
  | JournalCommand<"undo">
  | JournalCommand<"init">
  | JournalCommand<"doctor">
  | (CommonArguments & {
      command: "history";
      action: "list" | "prune";
      keep: number;
      apply: boolean;
    });

type Command = ParsedArguments["command"];

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArguments(argv: string[]): ParsedArguments {
  if (argv.includes("--help") || argv.length === 0) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  const compatibilityGroup = argv[0] === "comments";
  const rawCommand = argv[compatibilityGroup ? 1 : 0];
  if (!rawCommand || !["profile", "check", "preview", "explain", "fix", "verify", "recover", "undo", "init", "doctor", "history"].includes(rawCommand)) {
    throw new Error(`Unknown or missing comments command: ${rawCommand ?? "(missing)"}`);
  }
  const command = rawCommand as Command;

  let staged = false;
  let worktree = false;
  let base: string | undefined;
  let format: ParsedArguments["format"] = "terminal";
  let formatExplicit = false;
  let cwd = process.cwd();
  let printConfig = false;
  let noColor = false;
  let apply = false;
  let dryRun = false;
  let allSafe = false;
  let file: string | undefined;
  let keep = 20;
  let keepExplicit = false;
  const positional: string[] = [];

  for (let index = compatibilityGroup ? 2 : 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;

    switch (argument) {
      case "--staged":
        staged = true;
        break;
      case "--worktree":
        worktree = true;
        break;
      case "--base":
        base = valueAfter(argv, index, argument);
        index += 1;
        break;
      case "--format": {
        const value = valueAfter(argv, index, argument);
        if (value !== "terminal" && value !== "json" && value !== "sarif") {
          throw new Error("--format must be terminal, json, or sarif.");
        }
        format = value;
        formatExplicit = true;
        index += 1;
        break;
      }
      case "--print-config":
        printConfig = true;
        break;
      case "--no-color":
        noColor = true;
        break;
      case "--cwd":
        cwd = resolve(valueAfter(argv, index, argument));
        index += 1;
        break;
      case "--apply":
        apply = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--all-safe":
        allSafe = true;
        break;
      case "--file":
        file = valueAfter(argv, index, argument);
        index += 1;
        break;
      case "--keep": {
        const value = valueAfter(argv, index, argument);
        keep = Number.parseInt(value, 10);
        if (!/^\d+$/.test(value) || keep < 1 || keep > 200) {
          throw new Error("--keep must be an integer from 1 through 200.");
        }
        keepExplicit = true;
        index += 1;
        break;
      }
      default:
        if (argument.startsWith("--")) {
          throw new Error(`Unknown option: ${argument}`);
        }
        positional.push(argument);
    }
  }

  const selectedScopes = Number(staged) + Number(worktree) + Number(base !== undefined);
  if (selectedScopes > 1) {
    throw new Error("--staged, --worktree, and --base are mutually exclusive.");
  }
  if (apply && dryRun) {
    throw new Error("--apply and --dry-run are mutually exclusive.");
  }
  if ((allSafe || file !== undefined) && command !== "fix") {
    throw new Error("--all-safe and --file are only valid with comments fix.");
  }
  if ((apply || dryRun) && command !== "fix" && command !== "history") {
    throw new Error("--apply and --dry-run are only valid with fix or history prune.");
  }
  if (file !== undefined && !allSafe) {
    throw new Error("--file requires --all-safe.");
  }
  if (allSafe && positional.length > 0) {
    throw new Error("--all-safe cannot be combined with a finding ID.");
  }
  if (command === "fix" && !allSafe && positional.length !== 1) {
    throw new Error("comments fix requires exactly one finding ID or --all-safe.");
  }
  if (command === "explain" && positional.length !== 1) {
    throw new Error("comments explain requires exactly one finding ID.");
  }
  if (command === "history") {
    if (
      positional.length !== 1 ||
      (positional[0] !== "list" && positional[0] !== "prune")
    ) {
      throw new Error("history requires exactly one action: list or prune.");
    }
    if (positional[0] === "list" && (apply || dryRun || keepExplicit)) {
      throw new Error("history list does not accept --apply, --dry-run, or --keep.");
    }
  } else if (
    command !== "fix" &&
    command !== "explain" &&
    positional.length !== 0
  ) {
    throw new Error(`comments ${command} does not accept positional arguments.`);
  }
  if (
    (command === "recover" ||
      command === "undo" ||
      command === "init" ||
      command === "doctor" ||
      command === "history") &&
    selectedScopes !== 0
  ) {
    throw new Error(
      `comments ${command} does not accept a Git scope; it uses the latest worktree receipt.`,
    );
  }

  const scope: Scope =
    base !== undefined
      ? { kind: "base", ref: base }
      : worktree
        ? { kind: "worktree" }
        : { kind: "staged" };
  if (format === "sarif" && command !== "check" && command !== "preview") {
    throw new Error("--format sarif is only valid with comments check or preview.");
  }
  const common = { format, formatExplicit, cwd, printConfig, noColor };
  switch (command) {
    case "profile":
    case "check":
    case "preview":
      return { ...common, command, scope };
    case "explain":
      return { ...common, command, scope, findingId: positional[0] as string };
    case "fix":
      if (!worktree || selectedScopes !== 1) {
        throw new Error(
          "Automatic fixes require --worktree. Staged and base scopes are read-only.",
        );
      }
      return {
        ...common,
        command,
        scope: { kind: "worktree" },
        findingId: positional[0],
        apply,
        allSafe,
        file,
      };
    case "verify":
      if (base !== undefined) {
        throw new Error("comments verify supports only --worktree or --staged.");
      }
      return {
        ...common,
        command,
        target: staged ? "staged" : "worktree",
      };
    case "recover":
    case "undo":
    case "init":
    case "doctor":
      return { ...common, command };
    case "history":
      return {
        ...common,
        command,
        action: positional[0] as "list" | "prune",
        keep,
        apply,
      };
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function reportForJson(report: ReturnType<typeof analyzeRepository>) {
  return { ...report, toolVersion: VERSION };
}

interface PatchPreview {
  relativePath: string;
  findingIds: string[];
  diff: string;
}

function isSafeFinding(
  finding: Finding,
): finding is Finding & { action: "remove-safe" | "rewrite-safe" } {
  return finding.action === "remove-safe" || finding.action === "rewrite-safe";
}

function createPatchPreviews(
  root: string,
  scope: Scope,
  findings: Finding[],
): PatchPreview[] {
  const byPath = new Map<string, Finding[]>();
  for (const finding of findings.filter(isSafeFinding)) {
    const existing = byPath.get(finding.relativePath) ?? [];
    existing.push(finding);
    byPath.set(finding.relativePath, existing);
  }
  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, fileFindings]) => {
      const before = readScopedFileContent(root, scope, relativePath);
      const after = buildCandidateForFindings(before, fileFindings);
      return {
        relativePath,
        findingIds: fileFindings.map((finding) => finding.id),
        diff: renderUnifiedDiff(relativePath, before, after),
      };
    });
}

function printFixPreviewJson(
  findings: Finding[],
  patches: PatchPreview[],
): void {
  printJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    type: "fix-preview",
    toolVersion: VERSION,
    rulePackVersion: RULE_PACK_VERSION,
    write: false,
    findings,
    patches,
  });
}

function renderPatchPreviews(patches: PatchPreview[]): string {
  if (patches.length === 0) return "No deterministic patch is available.";
  return patches
    .map((patch) => renderUnifiedDiffForTerminal(patch.diff))
    .join("\n\n");
}

function reportFails(
  findings: Finding[],
  failOn: "never" | "info" | "warning" | "error",
): boolean {
  if (failOn === "never") return false;
  const rank = { info: 1, warning: 2, error: 3 } as const;
  return findings.some((finding) => rank[finding.level] >= rank[failOn]);
}

function renderHistory(report: ReturnType<typeof listFixHistory>): string {
  const lines = [
    `RepoFit fix history (${report.entries.length} records)`,
    `Latest: ${sanitizeTerminalText(report.latestReceiptId)}`,
    `Pending prune recovery: ${report.pendingPruneOperations}`,
  ];
  for (const entry of report.entries) {
    lines.push(
      `${entry.latest ? "*" : " "} ${sanitizeTerminalText(entry.receiptId)} ${entry.status} ${sanitizeTerminalText(entry.relativePath)} ${entry.backupBytes} bytes`,
    );
  }
  return lines.join("\n");
}

function renderHistoryPrune(result: ReturnType<typeof pruneFixHistory>): string {
  return [
    result.applied ? "History prune applied." : "History prune dry run.",
    `Would prune/pruned: ${result.prunedReceiptIds.length}`,
    `Retained: ${result.retainedReceiptIds.length}`,
    `Recovered interrupted prune operations: ${result.recoveredOperations.length}`,
  ].join("\n");
}

function run(argv: string[]): number {
  let parsed: ParsedArguments;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    if (error instanceof CliError) throw error;
    usageError(messageFrom(error));
  }
  const root = discoverRepositoryRoot(parsed.cwd);
  if (parsed.command === "init") {
    if (parsed.printConfig) usageError("comments init cannot be combined with --print-config.");
    let path: string;
    try {
      path = initializeRepositoryConfig(root);
    } catch (error) {
      writeRefused(error);
    }
    if (parsed.format === "json") {
      printJson({
        schemaVersion: "1.0",
        type: "config-initialized",
        toolVersion: VERSION,
        path,
      });
    } else {
      process.stdout.write(`Created ${sanitizeTerminalText(path)}.\n`);
    }
    return 0;
  }
  if (parsed.printConfig) {
    const resolvedConfig = resolveConfig(root);
    process.stdout.write(formatConfig(resolvedConfig));
    return 0;
  }

  if (parsed.command === "history") {
    if (parsed.action === "list") {
      const history = listFixHistory(root);
      if (parsed.format === "json") printJson(history);
      else process.stdout.write(`${renderHistory(history)}\n`);
      return 0;
    }
    let result: ReturnType<typeof pruneFixHistory>;
    try {
      result = pruneFixHistory(root, parsed.keep, { apply: parsed.apply });
    } catch (error) {
      writeRefused(error);
    }
    if (parsed.format === "json") printJson(result);
    else process.stdout.write(`${renderHistoryPrune(result)}\n`);
    return 0;
  }

  if (parsed.command === "undo") {
    let receipt: FixReceipt;
    try {
      receipt = undoLastFix(root);
    } catch (error) {
      writeRefused(error);
    }
    if (parsed.format === "json") printJson(receipt);
    else {
      process.stdout.write(
        `Restored ${sanitizeTerminalText(receipt.relativePath)} from receipt ${sanitizeTerminalText(receipt.receiptId)}. The Git index was not changed.\n`,
      );
    }
    return 0;
  }

  if (parsed.command === "recover") {
    let receipt: FixReceipt;
    try {
      receipt = recoverLastFix(root);
    } catch (error) {
      writeRefused(error);
    }
    if (parsed.format === "json") printJson(receipt);
    else {
      process.stdout.write(
        `Recovered receipt ${sanitizeTerminalText(receipt.receiptId)} as ${receipt.status} (${"recoveryAction" in receipt ? receipt.recoveryAction : "no transition"}).\n`,
      );
    }
    return 0;
  }

  const resolvedConfig = resolveConfig(root);
  const configuredFormat = resolvedConfig.config.display.format;
  const outputFormat = parsed.formatExplicit
    ? parsed.format
    : configuredFormat === "sarif" &&
        parsed.command !== "check" &&
        parsed.command !== "preview"
      ? "terminal"
      : configuredFormat;
  void parsed.noColor;

  if (parsed.command === "doctor") {
    const doctor = createDoctorReport(root, resolvedConfig, VERSION);
    if (outputFormat === "json") printJson(doctor);
    else {
      process.stdout.write(
        `${renderDoctor(doctor, resolvedConfig.config.display.language === "zh" ? "zh" : "en")}\n`,
      );
    }
    return doctor.status === "fail" ? EXIT_RUNTIME : 0;
  }

  if (parsed.command === "verify") {
    const verification = verifyLastFix(root, parsed.target);
    if (outputFormat === "json") {
      printJson(verification);
    } else if (verification.valid) {
      process.stdout.write(
        `Verified ${verification.receipt.findingIds.map(sanitizeTerminalText).join(", ")} in ${sanitizeTerminalText(verification.receipt.relativePath)} (${verification.target}; journal=${verification.receipt.status}).\n`,
      );
    } else {
      process.stdout.write(`Verification failed:\n- ${verification.reasons.join("\n- ")}\n`);
    }
    return verification.valid ? 0 : EXIT_VERIFY_FAILED;
  }

  const report = analyzeRepository(root, parsed.scope, resolvedConfig.config);
  const terminalLanguage =
    resolvedConfig.config.display.language === "zh" ||
    (resolvedConfig.config.display.language === "auto" &&
      report.profile.dominantLanguage === "zh")
      ? "zh"
      : "en";

  if (parsed.command === "profile") {
    if (outputFormat === "json") {
      printJson({
        schemaVersion: REPORT_SCHEMA_VERSION,
        type: "profile",
        toolVersion: VERSION,
        rulePackVersion: RULE_PACK_VERSION,
        profile: report.profile,
      });
    }
    else process.stdout.write(`${renderProfile(report.profile, terminalLanguage)}\n`);
    return 0;
  }

  if (parsed.command === "check") {
    if (outputFormat === "sarif") process.stdout.write(renderSarif(reportForJson(report)));
    else if (outputFormat === "json") printJson(reportForJson(report));
    else process.stdout.write(`${renderReport(report, false, terminalLanguage)}\n`);
    if (report.summary.parseErrorCount > 0) return EXIT_RUNTIME;
    return reportFails(report.findings, resolvedConfig.config.failOn) ? 1 : 0;
  }

  if (parsed.command === "preview") {
    const patches = createPatchPreviews(root, parsed.scope, report.findings);
    if (outputFormat === "sarif") process.stdout.write(renderSarif(reportForJson(report)));
    else if (outputFormat === "json") printJson({ ...reportForJson(report), patches });
    else {
      process.stdout.write(`${renderReport(report, false, terminalLanguage)}\n`);
      process.stdout.write(`\nPatches:\n${renderPatchPreviews(patches)}\n`);
    }
    if (report.summary.parseErrorCount > 0) return EXIT_RUNTIME;
    return reportFails(report.findings, resolvedConfig.config.failOn) ? 1 : 0;
  }

  if (parsed.command === "fix" && parsed.allSafe) {
    const safeFindings = report.findings.filter(
      (candidate) =>
        (candidate.action === "remove-safe" || candidate.action === "rewrite-safe") &&
        (parsed.file === undefined || candidate.relativePath === parsed.file),
    );
    if (safeFindings.length === 0) {
      writeRefused(
        parsed.file === undefined
          ? "No safe findings are available in the current diff."
          : `No safe findings are available for ${parsed.file} in the current diff.`,
      );
    }
    const files = new Set(safeFindings.map((finding) => finding.relativePath));
    if (files.size > 1) {
      usageError(
        `Safe findings span ${files.size} files. Re-run with --file <path> to choose one file.`,
      );
    }
    if (!parsed.apply) {
      const patches = createPatchPreviews(root, parsed.scope, safeFindings);
      if (outputFormat === "json") printFixPreviewJson(safeFindings, patches);
      else {
        process.stdout.write(`${renderPatchPreviews(patches)}\n`);
        process.stdout.write(
          `Dry run only. Re-run with --apply to write these ${safeFindings.length} findings as one transaction.\n`,
        );
      }
      return 0;
    }
    let receipt: FixReceipt;
    try {
      receipt = applyFindings(root, safeFindings, parsed.scope, {
        recoveryLimits: resolvedConfig.config.limits,
      });
    } catch (error) {
      writeRefused(error);
    }
    if (outputFormat === "json") printJson(receipt);
    else {
      process.stdout.write(
        `Applied ${receipt.findingIds.length} safe findings to ${sanitizeTerminalText(receipt.relativePath)}. The file was not staged or committed.\n`,
      );
      process.stdout.write(
        "Run `repofit comments verify`, then stage the file and run `repofit comments verify --staged`.\n",
      );
    }
    return 0;
  }

  const findingId = parsed.findingId;
  if (!findingId) usageError(`${parsed.command} requires a finding ID.`);
  const finding = report.findings.find((candidate) => candidate.id === findingId);
  if (!finding) {
    const message = `Finding not found in the current ${parsed.scope.kind} diff: ${findingId}`;
    if (parsed.command === "fix") writeRefused(message);
    usageError(message);
  }

  if (parsed.command === "explain") {
    if (outputFormat === "json") {
      printJson({
        schemaVersion: REPORT_SCHEMA_VERSION,
        type: "finding-explanation",
        toolVersion: VERSION,
        rulePackVersion: RULE_PACK_VERSION,
        finding,
      });
    }
    else {
      process.stdout.write(`${renderFinding(finding, false, terminalLanguage)}\n`);
      if (isSafeFinding(finding)) {
        const patches = createPatchPreviews(root, parsed.scope, [finding]);
        process.stdout.write(`\nPatch:\n${renderPatchPreviews(patches)}\n`);
      }
    }
    return 0;
  }

  if (parsed.command === "fix") {
    if (!isSafeFinding(finding)) {
      writeRefused(`Finding ${finding.id} is not eligible for an automatic comment fix.`);
    }
    if (!parsed.apply) {
      const patches = createPatchPreviews(root, parsed.scope, [finding]);
      if (outputFormat === "json") printFixPreviewJson([finding], patches);
      else {
        process.stdout.write(`${renderPatchPreviews(patches)}\n`);
        process.stdout.write("Dry run only. Re-run with --apply to write this one finding.\n");
      }
      return 0;
    }
    let receipt: FixReceipt;
    try {
      receipt = applyFinding(root, finding, parsed.scope, {
        recoveryLimits: resolvedConfig.config.limits,
      });
    } catch (error) {
      writeRefused(error);
    }
    if (outputFormat === "json") printJson(receipt);
    else {
      process.stdout.write(
        `Applied ${sanitizeTerminalText(finding.id)} to ${sanitizeTerminalText(finding.relativePath)}. The file was not staged or committed.\n`,
      );
      process.stdout.write(
        "Run `repofit comments verify`, then stage the file and run `repofit comments verify --staged`.\n",
      );
    }
    return 0;
  }

  throw new CliError(
    "analysis-failed",
    EXIT_RUNTIME,
    "Unhandled command state.",
  );
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  const cliError =
    error instanceof CliError
      ? error
      : new CliError("analysis-failed", EXIT_RUNTIME, messageFrom(error));
  if (wantsJsonOutput(process.argv.slice(2))) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: ERROR_SCHEMA_VERSION,
        type: "error",
        tool: "repofit-comments",
        toolVersion: VERSION,
        error: { code: cliError.code, message: cliError.message },
        exitCode: cliError.exitCode,
      })}\n`,
    );
  } else {
    process.stderr.write(`RepoFit error: ${sanitizeTerminalText(cliError.message)}\n`);
  }
  process.exitCode = cliError.exitCode;
}
