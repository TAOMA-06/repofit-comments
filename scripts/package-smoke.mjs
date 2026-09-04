import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temporaryRoot = mkdtempSync(join(tmpdir(), "repofit-package-smoke-"));
const buildRoot = join(temporaryRoot, "clean-build");

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

function listFiles(directory, packagePrefix) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const packagedPath = `${packagePrefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(path, packagedPath));
    else if (entry.isFile()) files.push(packagedPath);
    else throw new Error(`clean build produced a non-regular entry: ${packagedPath}`);
  }
  return files;
}

try {
  mkdirSync(buildRoot);
  for (const path of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
  ]) {
    cpSync(join(root, path), join(buildRoot, path));
  }
  cpSync(join(root, "src"), join(buildRoot, "src"), { recursive: true });
  symlinkSync(
    join(root, "node_modules"),
    join(buildRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const packed = JSON.parse(
    run(
      npm,
      ["pack", "--json", "--pack-destination", temporaryRoot],
      buildRoot,
    ),
  );
  assert.equal(Array.isArray(packed), true);
  assert.equal(packed.length, 1);
  const manifest = packed[0];
  assert.equal(typeof manifest.filename, "string");
  const packagedPaths = manifest.files.map((file) => file.path).sort();
  const expectedPaths = [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "package.json",
    ...listFiles(join(buildRoot, "dist", "src"), "dist/src"),
  ].sort();
  assert.deepEqual(packagedPaths, expectedPaths, "tarball file list differs from clean build");

  const tarball = join(temporaryRoot, manifest.filename);
  const installRoot = join(temporaryRoot, "install");
  mkdirSync(installRoot);
  const registryInstall = process.env.REPOFIT_PACKAGE_SMOKE_REGISTRY === "1";
  const installSources = [tarball];
  if (!registryInstall) installSources.push(join(root, "node_modules", "typescript"));
  run(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      ...installSources,
    ],
    temporaryRoot,
    registryInstall ? {} : { npm_config_offline: "true" },
  );

  const binary = join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "repofit.cmd" : "repofit",
  );
  const packageVersion = JSON.parse(
    readFileSync(join(buildRoot, "package.json"), "utf8"),
  ).version;
  const version = runCli(binary, ["--version"], temporaryRoot);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageVersion);
  const internalImport = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "import('repofit-comments/dist/src/patch.js')",
    ],
    { cwd: installRoot, encoding: "utf8" },
  );
  assert.notEqual(internalImport.status, 0);
  assert.match(internalImport.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);

  const fixture = join(temporaryRoot, "fixture with spaces");
  mkdirSync(fixture);
  run("git", ["init", "-q"], fixture);
  run("git", ["config", "user.email", "repofit@example.invalid"], fixture);
  run("git", ["config", "user.name", "RepoFit Package Smoke"], fixture);
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

  const checked = runCli(
    binary,
    ["comments", "check", "--worktree", "--format", "json"],
    fixture,
  );
  assert.equal(checked.status, 1, checked.stderr);
  const report = JSON.parse(checked.stdout);
  const finding = report.findings.find(
    (candidate) => candidate.ruleId === "comments.decorative-heading",
  );
  assert.ok(finding);

  const applied = runCli(
    binary,
    ["comments", "fix", finding.id, "--worktree", "--apply"],
    fixture,
  );
  assert.equal(applied.status, 0, applied.stderr);
  assert.doesNotMatch(readFileSync(sourcePath, "utf8"), /Main Logic/);
  assert.equal(runCli(binary, ["comments", "verify"], fixture).status, 0);

  run("git", ["add", "sample.ts"], fixture);
  assert.equal(
    runCli(binary, ["comments", "verify", "--staged"], fixture).status,
    0,
  );
  const undone = runCli(binary, ["comments", "undo"], fixture);
  assert.equal(undone.status, 0, undone.stderr);
  assert.equal(readFileSync(sourcePath, "utf8"), changed);
  assert.doesNotMatch(run("git", ["show", ":sample.ts"], fixture), /Main Logic/);

  process.stdout.write(
    `Package smoke passed for ${manifest.filename} on ${process.platform}/${process.arch} with Node ${process.version} (${registryInstall ? "registry dependency resolution" : "local exact runtime dependency"}).\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
