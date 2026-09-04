#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeRepository } from "./analysis.js";
import { discoverRepositoryRoot } from "./git.js";
import {
  REPORT_SCHEMA_VERSION,
  type Finding,
  type FixReceipt,
  type Scope,
} from "./model.js";
import {
  applyFinding,
  applyFindings,
  previewFinding,
  previewFindings,
  recoverLastFix,
  undoLastFix,
  verifyLastFix,
} from "./patch.js";
import { renderFinding, renderProfile, renderReport } from "./report.js";
import { sanitizeTerminalText } from "./terminal.js";

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
  repofit comments profile [scope]
  repofit comments check [scope] [--format terminal|json]
  repofit comments preview [scope]
  repofit comments explain <finding-id> [scope]
  repofit comments fix <finding-id> --worktree [--dry-run|--apply]
  repofit comments fix --all-safe [--file <path>] --worktree [--dry-run|--apply]
  repofit comments verify [--worktree|--staged]
  repofit comments recover
  repofit comments undo

Analysis scopes (mutually exclusive; default for profile/check/preview/explain: --staged):
  --staged             Analyze the Git index
  --worktree           Analyze unstaged working-tree changes
  --base <ref>         Analyze merge-base(ref, HEAD)..HEAD

Command-specific scope:
  fix                   Requires --worktree
  verify                Accepts --worktree or --staged; defaults to --worktree
  recover/undo          Use the latest worktree journal and accept no scope flag

Other options:
  --format <value>     terminal (default) or json
  --cwd <directory>    Run against another Git working directory
  --all-safe           Fix every safe finding in one file as one transaction
  --file <path>        Limit --all-safe to this repository-relative file
  --help               Show this help
  --version            Show the version

Safety:
  profile/check/preview/explain/verify are read-only and offline. fix --apply changes one
  worktree file after writing recovery data. recover may reconcile an interrupted source
  replacement and updates its journal. undo restores the latest applied journal to the
  worktree. No command stages, commits, or pushes; verify --staged only reads the index.
`;

interface CommonArguments {
  format: "terminal" | "json";
  cwd: string;
}

type ScopedCommand<Name extends "profile" | "check" | "preview"> =
  CommonArguments & { command: Name; scope: Scope };
type JournalCommand<Name extends "recover" | "undo"> = CommonArguments & {
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
  | JournalCommand<"undo">;

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
  if (argv[0] !== "comments") {
    throw new Error("RepoFit exposes the `comments` command group. Run with --help.");
  }

  const rawCommand = argv[1];
  if (!rawCommand || !["profile", "check", "preview", "explain", "fix", "verify", "recover", "undo"].includes(rawCommand)) {
    throw new Error(`Unknown or missing comments command: ${rawCommand ?? "(missing)"}`);
  }
  const command = rawCommand as Command;

  let staged = false;
  let worktree = false;
  let base: string | undefined;
  let format: ParsedArguments["format"] = "terminal";
  let cwd = process.cwd();
  let apply = false;
  let dryRun = false;
  let allSafe = false;
  let file: string | undefined;
  const positional: string[] = [];

  for (let index = 2; index < argv.length; index += 1) {
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
        if (value !== "terminal" && value !== "json") {
          throw new Error("--format must be terminal or json.");
        }
        format = value;
        index += 1;
        break;
      }
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
  if ((apply || dryRun) && command !== "fix") {
    throw new Error("--apply and --dry-run are only valid with comments fix.");
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
  if (
    command !== "fix" &&
    command !== "explain" &&
    positional.length !== 0
  ) {
    throw new Error(`comments ${command} does not accept positional arguments.`);
  }
  if ((command === "recover" || command === "undo") && selectedScopes !== 0) {
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
  const common = { format, cwd };
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
      return { ...common, command };
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printFixPreviewJson(findings: Finding[]): void {
  printJson({
    schemaVersion: REPORT_SCHEMA_VERSION,
    type: "fix-preview",
    write: false,
    findings,
  });
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

  if (parsed.command === "verify") {
    const verification = verifyLastFix(root, parsed.target);
    if (parsed.format === "json") {
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

  const report = analyzeRepository(root, parsed.scope);

  if (parsed.command === "profile") {
    if (parsed.format === "json") printJson(report.profile);
    else process.stdout.write(`${renderProfile(report.profile)}\n`);
    return 0;
  }

  if (parsed.command === "check" || parsed.command === "preview") {
    if (parsed.format === "json") printJson(report);
    else process.stdout.write(`${renderReport(report, parsed.command === "preview")}\n`);
    if (report.summary.parseErrorCount > 0) return EXIT_RUNTIME;
    return report.findings.length > 0 ? 1 : 0;
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
      if (parsed.format === "json") printFixPreviewJson(safeFindings);
      else {
        process.stdout.write(`${previewFindings(safeFindings)}\n`);
        process.stdout.write(
          `Dry run only. Re-run with --apply to write these ${safeFindings.length} findings as one transaction.\n`,
        );
      }
      return 0;
    }
    let receipt: FixReceipt;
    try {
      receipt = applyFindings(root, safeFindings, parsed.scope);
    } catch (error) {
      writeRefused(error);
    }
    if (parsed.format === "json") printJson(receipt);
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
    if (parsed.format === "json") printJson(finding);
    else process.stdout.write(`${renderFinding(finding, true)}\n`);
    return 0;
  }

  if (parsed.command === "fix") {
    if (!parsed.apply) {
      if (parsed.format === "json") printFixPreviewJson([finding]);
      else {
        process.stdout.write(`${previewFinding(finding)}\n`);
        process.stdout.write("Dry run only. Re-run with --apply to write this one finding.\n");
      }
      return 0;
    }
    let receipt: FixReceipt;
    try {
      receipt = applyFinding(root, finding, parsed.scope);
    } catch (error) {
      writeRefused(error);
    }
    if (parsed.format === "json") printJson(receipt);
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
