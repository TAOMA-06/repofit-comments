#!/usr/bin/env node

import { resolve } from "node:path";

import { analyzeRepository } from "./analysis.js";
import { discoverRepositoryRoot } from "./git.js";
import type { Scope } from "./model.js";
import {
  applyFinding,
  applyFindings,
  previewFinding,
  previewFindings,
  verifyLastFix,
} from "./patch.js";
import { renderFinding, renderProfile, renderReport } from "./report.js";

const VERSION = "0.1.0";

const HELP = `RepoFit Comments ${VERSION}

Usage:
  repofit comments profile [scope]
  repofit comments check [scope] [--format terminal|json]
  repofit comments preview [scope]
  repofit comments explain <finding-id> [scope]
  repofit comments fix <finding-id> [scope] [--dry-run|--apply]
  repofit comments fix --all-safe [--file <path>] [scope] [--dry-run|--apply]
  repofit comments verify

Scopes (mutually exclusive; default: --staged):
  --staged             Analyze the Git index
  --worktree           Analyze unstaged working-tree changes
  --base <ref>         Analyze merge-base(ref, HEAD)..HEAD

Other options:
  --format <value>     terminal (default) or json
  --cwd <directory>    Run against another Git working directory
  --all-safe           Fix every safe finding in one file as one transaction
  --file <path>        Limit --all-safe to this repository-relative file
  --help               Show this help
  --version            Show the version

Safety:
  check/preview are read-only and offline. fix writes either one deterministic finding or
  one file's safe findings, verifies the full candidate in memory, and never stages or commits.
`;

interface ParsedArguments {
  command: string;
  positional: string[];
  scope: Scope;
  format: "terminal" | "json";
  cwd: string;
  apply: boolean;
  dryRun: boolean;
  allSafe: boolean;
  file: string | undefined;
}

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
    throw new Error("The MVP exposes the `comments` command group. Run with --help.");
  }

  const command = argv[1];
  if (!command || !["profile", "check", "preview", "explain", "fix", "verify"].includes(command)) {
    throw new Error(`Unknown or missing comments command: ${command ?? "(missing)"}`);
  }

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
  if (file !== undefined && !allSafe) {
    throw new Error("--file requires --all-safe.");
  }
  if (allSafe && positional.length > 0) {
    throw new Error("--all-safe cannot be combined with a finding ID.");
  }

  const scope: Scope = base !== undefined ? { kind: "base", ref: base } : worktree ? { kind: "worktree" } : { kind: "staged" };
  return { command, positional, scope, format, cwd, apply, dryRun, allSafe, file };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function run(argv: string[]): number {
  const parsed = parseArguments(argv);
  const root = discoverRepositoryRoot(parsed.cwd);

  if (parsed.command === "verify") {
    const verification = verifyLastFix(root);
    if (parsed.format === "json") {
      printJson(verification);
    } else if (verification.valid) {
      process.stdout.write(
        `Verified ${verification.receipt.findingIds.join(", ")} in ${verification.receipt.relativePath}.\n`,
      );
    } else {
      process.stdout.write(`Verification failed:\n- ${verification.reasons.join("\n- ")}\n`);
    }
    return verification.valid ? 0 : 4;
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
    if (report.summary.parseErrorCount > 0) return 2;
    return report.findings.length > 0 ? 1 : 0;
  }

  if (parsed.command === "fix" && parsed.allSafe) {
    const safeFindings = report.findings.filter(
      (candidate) =>
        (candidate.action === "remove-safe" || candidate.action === "rewrite-safe") &&
        (parsed.file === undefined || candidate.relativePath === parsed.file),
    );
    if (safeFindings.length === 0) {
      throw new Error(
        parsed.file === undefined
          ? "No safe findings are available in the current diff."
          : `No safe findings are available for ${parsed.file} in the current diff.`,
      );
    }
    const files = new Set(safeFindings.map((finding) => finding.relativePath));
    if (files.size > 1) {
      throw new Error(
        `Safe findings span ${files.size} files. Re-run with --file <path> to choose one file.`,
      );
    }
    if (!parsed.apply) {
      process.stdout.write(`${previewFindings(safeFindings)}\n`);
      process.stdout.write(
        `Dry run only. Re-run with --apply to write these ${safeFindings.length} findings as one transaction.\n`,
      );
      return 0;
    }
    const receipt = applyFindings(root, safeFindings);
    if (parsed.format === "json") printJson(receipt);
    else {
      process.stdout.write(
        `Applied ${receipt.findingIds.length} safe findings to ${receipt.relativePath}. The file was not staged or committed.\n`,
      );
      process.stdout.write("Run `repofit comments verify` to verify the saved receipt.\n");
    }
    return 0;
  }

  const findingId = parsed.positional[0];
  if (!findingId) {
    throw new Error(`${parsed.command} requires a finding ID.`);
  }
  const finding = report.findings.find((candidate) => candidate.id === findingId);
  if (!finding) {
    throw new Error(`Finding not found in the current ${parsed.scope.kind} diff: ${findingId}`);
  }

  if (parsed.command === "explain") {
    if (parsed.format === "json") printJson(finding);
    else process.stdout.write(`${renderFinding(finding, true)}\n`);
    return 0;
  }

  if (parsed.command === "fix") {
    if (!parsed.apply) {
      process.stdout.write(`${previewFinding(finding)}\n`);
      process.stdout.write("Dry run only. Re-run with --apply to write this one finding.\n");
      return 0;
    }
    const receipt = applyFinding(root, finding);
    if (parsed.format === "json") printJson(receipt);
    else {
      process.stdout.write(
        `Applied ${finding.id} to ${finding.relativePath}. The file was not staged or committed.\n`,
      );
      process.stdout.write("Run `repofit comments verify` to verify the saved receipt.\n");
    }
    return 0;
  }

  throw new Error(`Unhandled command: ${parsed.command}`);
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`RepoFit error: ${message}\n`);
  process.exitCode = 2;
}
