import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "repofit-package-smoke-"));
const buildRoot = join(temporaryRoot, "clean-build");

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
  cpSync(join(root, "schemas"), join(buildRoot, "schemas"), { recursive: true });
  symlinkSync(
    join(root, "node_modules"),
    join(buildRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const npm = npmInvocation();
  const packed = JSON.parse(
    run(
      npm.command,
      [
        ...npm.prefix,
        "pack",
        "--json",
        "--pack-destination",
        temporaryRoot,
      ],
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
    ...listFiles(join(buildRoot, "schemas"), "schemas"),
  ].sort();
  assert.deepEqual(packagedPaths, expectedPaths, "tarball file list differs from clean build");

  const tarball = join(temporaryRoot, manifest.filename);
  const registryInstall = process.env.REPOFIT_PACKAGE_SMOKE_REGISTRY === "1";
  run(
    process.execPath,
    [join(root, "scripts", "installed-smoke.mjs"), tarball],
    temporaryRoot,
    registryInstall
      ? {}
      : {
          npm_config_offline: "true",
          REPOFIT_SMOKE_LOCAL_DEPENDENCIES: [
            join(root, "node_modules", "typescript"),
            join(root, "node_modules", "web-tree-sitter"),
            join(root, "node_modules", "tree-sitter-wasms"),
          ].join(process.platform === "win32" ? ";" : ":"),
        },
  );

  process.stdout.write(
    `Package smoke passed for ${manifest.filename} on ${process.platform}/${process.arch} with Node ${process.version} (${registryInstall ? "registry dependency resolution" : "local exact runtime dependency"}).\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
