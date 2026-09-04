# Changelog

All notable changes to RepoFit Comments are documented here. Versions follow Semantic Versioning once the public package contract is frozen.

## Unreleased

### Security

- Harden Git subprocesses against external diff, textconv, environment configuration injection, lazy fetching, prompts, optional locks, replace objects, fsmonitor, and pager execution.
- Protect generated, vendored, fixture, migration, snapshot, minified, and declaration files at whole-file scope.
- Render repository-controlled terminal control and bidirectional formatting characters as visible escapes.
- Reject invalid UTF-8, preserve UTF-8 BOM bytes, and refuse parent paths that resolve outside the repository.

### Changed

- Restrict automatic fixes to `--worktree`; staged and base scopes remain read-only.
- Add `verify --staged` so users can prove the repaired bytes are present in the Git index.
- Version new receipts as schema 3.0 and record their repository identity, analysis scope, state, and write target.
- Recognize `.mts` and `.cts` as TypeScript-family source files.
- Reject irrelevant command arguments and publish stable exit categories with versioned JSON error output.
- Read the CLI version from `package.json` instead of maintaining a second hard-coded value.
- Store repository-bound, fully validated receipt history and a private byte-exact backup before each automatic source replacement.
- Add a repository-wide operation lock and a hard-link-based no-clobber replacement transaction that captures last-moment source changes instead of overwriting them.
- Add explicit `comments recover`; incomplete journals never pass `verify`.
- Add hash-, mode-, token-, AST-, and protected-comment-guarded `comments undo`, including deterministic recovery from interrupted apply and undo stages.
- Preserve schema 2 Alpha receipts during a controlled schema 3 migration and tighten legacy POSIX data-directory permissions.
- Fail closed above a 2 MiB per-backup limit, 200 receipt records, or 64 MiB of repository recovery data; no history is deleted automatically.
- Split receipt state/codec, private storage, durable-file primitives, and source transactions out of patch orchestration, and model receipt states as a discriminated union.
- Document the brief source-path absence window accurately as a recoverable no-clobber transaction rather than an atomic rename.
- Make command-specific scopes explicit: analysis defaults to staged, `fix` requires worktree, `verify` defaults to worktree, and `recover`/`undo` accept no scope.
- Block package consumers from deep-importing internal fault-injection and transaction modules; the supported package surface remains CLI-only.
- Keep product status and evaluation evidence in the source repository without shipping them in the runtime npm tarball.

### Documentation

- Add the v1 product specification, execution plan, evidence gates, and release strategy.

### CI

- Pin official GitHub Actions to immutable commit SHAs.
- Test Node.js 22 and 24 across Ubuntu, macOS, and Windows.
- Build one real npm tarball from an isolated clean build directory per matrix job, verify its exact file allowlist, install it into a clean prefix, and exercise check, fix, worktree/staged verification, and undo through the installed binary.

## 0.1.0 - 2026-09-03

- Publish the first GitHub Alpha of the TypeScript/TSX comment-cleanup CLI.
- Add changed-comment analysis, protection rules, repository style profiling, deterministic safe fixes, atomic single-file writes, receipts, and terminal/JSON reports.
- Validate the Alpha with 30 automated tests, public-history smoke cases, and a Grok 4.5 generated-code fixture.
