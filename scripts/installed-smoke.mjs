import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const tarballArgument = process.argv[2];
if (!tarballArgument) throw new Error("Usage: installed-smoke.mjs <package.tgz>");
const resolvedInput = resolve(tarballArgument);
const tarball = statSync(resolvedInput).isDirectory()
  ? (() => {
      const tarballs = readdirSync(resolvedInput)
        .filter((name) => name.endsWith(".tgz"))
        .map((name) => join(resolvedInput, name));
      if (tarballs.length !== 1) {
        throw new Error(`Expected exactly one .tgz in ${resolvedInput}.`);
      }
      return tarballs[0];
    })()
  : resolvedInput;
if (!tarball) throw new Error("Unable to resolve the package tarball.");
const temporaryRoot = mkdtempSync(join(tmpdir(), "repofit-installed-smoke-"));

function npmInvocation() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find((candidate) => candidate && existsSync(candidate));
  return cli
    ? { command: process.execPath, prefix: [cli] }
    : { command: process.platform === "win32" ? "npm.cmd" : "npm", prefix: [] };
}

function run(command, args, cwd, environment = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_cache: join(temporaryRoot, "npm-cache"),
      npm_config_fund: "false",
      npm_config_prefer_offline: "true",
      ...environment,
    },
  });
}

function runCli(binary, args, cwd) {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", binary, ...args], {
      cwd,
      encoding: "utf8",
    });
  }
  return spawnSync(binary, args, { cwd, encoding: "utf8" });
}

try {
  const installRoot = join(temporaryRoot, "install");
  mkdirSync(installRoot);
  const localRuntime = process.env.REPOFIT_SMOKE_LOCAL_TYPESCRIPT;
  const installSources = [tarball, ...(localRuntime ? [localRuntime] : [])];
  const npm = npmInvocation();
  run(
    npm.command,
    [
      ...npm.prefix,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      ...installSources,
    ],
    temporaryRoot,
    localRuntime ? { npm_config_offline: "true" } : {},
  );

  const binary = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "repofit.cmd" : "repofit",
  );
  const installedManifest = JSON.parse(
    readFileSync(
      join(installRoot, "node_modules", "repofit-comments", "package.json"),
      "utf8",
    ),
  );
  const installedSchema = JSON.parse(
    readFileSync(
      join(
        installRoot,
        "node_modules",
        "repofit-comments",
        "schemas",
        "config.schema.json",
      ),
      "utf8",
    ),
  );
  assert.equal(installedSchema.properties.schemaVersion.const, "1.0");
  const version = runCli(binary, ["--version"], temporaryRoot);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), installedManifest.version);
  const internalImport = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "import('repofit-comments/dist/src/patch.js')"],
    { cwd: installRoot, encoding: "utf8" },
  );
  assert.notEqual(internalImport.status, 0);
  assert.match(internalImport.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);

  const fixture = join(temporaryRoot, "fixture with spaces");
  mkdirSync(fixture);
  run("git", ["init", "-q"], fixture);
  run("git", ["config", "user.email", "repofit@example.invalid"], fixture);
  run("git", ["config", "user.name", "RepoFit Installed Smoke"], fixture);
  const sourcePath = join(fixture, "sample.ts");
  const baseline = [
    "export function answer(): number {",
    "  const value = 42;",
    "  return value;",
    "}",
    "",
  ].join("\n");
  writeFileSync(sourcePath, baseline);
  run("git", ["add", "sample.ts"], fixture);
  run("git", ["commit", "-qm", "baseline"], fixture);
  const changed = baseline.replace("  return value;", "  // Main Logic\n  return value;");
  writeFileSync(sourcePath, changed);

  const doctor = runCli(binary, ["doctor", "--format", "json"], fixture);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).type, "doctor");
  const checked = runCli(binary, ["check", "--worktree", "--format", "json"], fixture);
  assert.equal(checked.status, 1, checked.stderr);
  const finding = JSON.parse(checked.stdout).findings.find(
    (candidate) => candidate.ruleId === "comments.decorative-heading",
  );
  assert.ok(finding);
  const sarif = runCli(binary, ["check", "--worktree", "--format", "sarif"], fixture);
  assert.equal(sarif.status, 1, sarif.stderr);
  assert.equal(JSON.parse(sarif.stdout).version, "2.1.0");

  const applied = runCli(binary, ["fix", finding.id, "--worktree", "--apply"], fixture);
  if (process.platform === "win32") {
    assert.equal(applied.status, 5, applied.stderr);
    assert.match(applied.stderr, /disabled on Windows/);
    assert.equal(readFileSync(sourcePath, "utf8"), changed);
  } else {
    assert.equal(applied.status, 0, applied.stderr);
    assert.doesNotMatch(readFileSync(sourcePath, "utf8"), /Main Logic/);
    assert.equal(runCli(binary, ["verify"], fixture).status, 0);
    run("git", ["add", "sample.ts"], fixture);
    assert.equal(runCli(binary, ["verify", "--staged"], fixture).status, 0);
    const undone = runCli(binary, ["undo"], fixture);
    assert.equal(undone.status, 0, undone.stderr);
    assert.equal(readFileSync(sourcePath, "utf8"), changed);
    assert.doesNotMatch(run("git", ["show", ":sample.ts"], fixture), /Main Logic/);
  }

  process.stdout.write(
    `Installed smoke passed for ${basename(tarball)} on ${process.platform}/${process.arch} with Node ${process.version}.\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
