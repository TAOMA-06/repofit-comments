# Trusted Fix Core local verification

Date: 2026-09-04

Branch: `product/v1-foundation`

Status: local evidence only; not a public Beta or cross-platform release claim

## Purpose

Verify the first formal-product safety slice after an audit found that the public Alpha could inherit Git external-diff behavior and could write a worktree fix while leaving stale staged content.

## Implemented controls

- All Git subprocesses use one hardened runner with external diff and text conversion disabled, dangerous Git environment injection removed, lazy fetching and prompts disabled, optional locks disabled, and a 30-second timeout.
- Automatic fixes accept only `--worktree`; staged and base scopes are read-only.
- `verify --staged` proves the Git index contains the repaired bytes.
- Invalid UTF-8 is rejected; UTF-8 BOM bytes are preserved.
- Parent symlink or junction paths resolving outside the repository are rejected.
- Generated headers and generated/vendor/fixture/migration/snapshot/declaration paths protect the entire file.
- Repository-controlled terminal control and bidirectional formatting characters are escaped.
- CLI arguments are strict; error JSON and exit categories are versioned.
- Every source replacement has a repository-wide writer lock, no-clobber installation, write-ahead journal, byte-exact backup, repository-bound receipt history, explicit `recover`, and hash/AST/token-guarded `undo`. The current macOS verification observed mode `0600`; Windows DACL privacy remains unverified.

## Automated verification

- Strict TypeScript check: passed.
- Automated tests: 85 passed, 0 failed.
- Coverage: 92.68% lines and 81.62% branches; subprocess terminal rendering is not fully attributed to the parent process.
- Runtime dependencies were unchanged. The local npm audit cache reported 0 vulnerabilities, while a bounded online refresh timed out; the most recent successful online audit remains the 0-vulnerability result from 2026-09-03.
- Adversarial Git fixtures first proved that raw Git would execute each marker, then proved RepoFit did not execute inherited/configured external diff, attribute-selected diff command, textconv, or `GIT_CONFIG_COUNT` injection markers.
- Fault injection covered interruption after the apply journal, after source displacement, after candidate installation, after completed source replacement, after the undo journal, and after byte restoration.
- Recovery tests covered exact byte/mode restoration, staged-index isolation, active/stale locks, hard-link refusal, last-moment edit capture, repository identity, history isolation, and coordinated backup/receipt tampering.

## Live Grok fixture replay

An isolated checkout used the original human stub commit `681fa1d` as `HEAD` and restored the raw Grok 4.5 generation from `007756c` into the worktree.

Observed scan:

- 4 analyzed files
- 38 changed comments
- 26 protected comments
- 4 safe `Step N:` rewrites
- 0 suggestion-only findings
- 0 parse diagnostics

Observed workflow:

1. A single-file batch applied all four rewrites to `src/pricing.ts`.
2. Worktree receipt verification passed with journal status `applied`.
3. After explicitly staging the file, `verify --staged` passed.
4. `undo` restored the exact raw Grok bytes without changing the staged repaired blob.
5. A second safe apply returned the worktree to the repaired state and both worktree and staged verification passed.
6. The generated project passed strict type checking and all 4 functional tests after the final apply.

After the final receipt/store and migration hardening, a new 57,640-byte tarball was built from an isolated clean directory, checked against an exact allowlist, and installed into a clean prefix. Its installed binary repeated the full Grok workflow: the raw snapshot again produced 38 changed comments, 26 protected comments, four safe rewrites, and zero parse errors; one batch applied all four rewrites; worktree and staged verification passed; undo restored the exact raw blob while preserving the staged repaired blob; a second apply restored the repaired worktree; the post-cleanup scan had zero findings; and all 4 fixture tests passed. The generic package smoke also verified version reporting, one-finding apply, exact undo without index mutation, and blocked internal-module imports. Local package smoke uses the exact already-installed TypeScript runtime dependency in offline mode and an isolated cache; the GitHub Actions matrix is configured to exercise fresh registry resolution, but that remote matrix has not run yet.

## Mature-project control replay

The frozen [`sindresorhus/ky`](https://github.com/sindresorhus/ky) range `eaf0b80..33682a7` was scanned again through the hardened build:

- 32 analyzed TypeScript files
- 174 changed comments
- 127 protected comments
- 0 safe changes
- 0 suggestions
- 0 parse diagnostics

## Remaining boundary

This evidence proves the safety slice on the current macOS machine and selected fixtures. It does not prove Windows/Linux behavior, large-corpus precision, maintainer preference, npm distribution, or formal v1 readiness. Those remain release gates in `docs/product/V1_EXECUTION_PLAN.md`.
