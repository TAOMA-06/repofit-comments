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
- Version new receipts as schema 2.0 and record their analysis scope and write target.
- Recognize `.mts` and `.cts` as TypeScript-family source files.
- Reject irrelevant command arguments and publish stable exit categories with versioned JSON error output.
- Read the CLI version from `package.json` instead of maintaining a second hard-coded value.

### Documentation

- Add the v1 product specification, execution plan, evidence gates, and release strategy.

## 0.1.0 - 2026-09-03

- Publish the first GitHub Alpha of the TypeScript/TSX comment-cleanup CLI.
- Add changed-comment analysis, protection rules, repository style profiling, deterministic safe fixes, atomic single-file writes, receipts, and terminal/JSON reports.
- Validate the Alpha with 30 automated tests, public-history smoke cases, and a Grok 4.5 generated-code fixture.
