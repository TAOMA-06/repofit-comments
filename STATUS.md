# RepoFit Comments product status

Date: 2026-09-06

## Current classification

**Public PR `#2` contains the `1.1.0-alpha.1` three-batch language expansion and its cross-platform CI is green. It is not yet merged or released. Public `v1.0.0-rc.1` remains the TypeScript-family draft prerelease.**

## Implemented

- A 19-language registry across three batches. TypeScript/JavaScript use TypeScript AST; Python, Go, Rust, Swift, Java, Kotlin, C#, C, C++, PHP, Ruby, Dart, Lua, and Shell use local Tree-sitter WASM; Vue/Svelte use component script adapters; SQL uses a dialect-aware review-only scanner.
- Native `//`, `#`, and `--` rewrite prefixes, language-specific tooling protection, Vue/Svelte markup-comment protection, `.h` C/C++ selection, and the `repofit languages` capability command.
- Git scopes for staged, worktree, and merge-base-to-HEAD changes.
- Changed-comment-only analysis.
- Protected-comment filtering for legal, tooling, generated, tracking, rationale, safety, compatibility, numeric-contract, and possible commented-code cases.
- Deterministic findings for decorative headings, bare step labels, nearby duplicates, and narrow code restatements.
- Suggestion-only findings for action-by-action narration, meta narration, tutorial tone, density outliers, and repository-language drift.
- Repository style profile from unchanged tracked files in `HEAD`.
- Terminal and JSON reports with stable finding IDs.
- Stable cross-snapshot fingerprints, configured levels/fail thresholds, SARIF 2.1, visible protected-comment reasons, and reason-required inline suppressions.
- Static `.repofit.json` configuration with strict schema/rule-pack gates, include/exclude, additive protection, rule controls, display defaults, and bounded analysis/recovery resources.
- Top-level v1 commands plus Alpha command-group compatibility, `init`, `doctor`, `--print-config`, `--no-color`, and real unified-diff previews.
- Shipped JSON Schemas for configuration and machine outputs.
- One-finding dry run/application plus single-file batch transactions for deterministic `remove-safe` and `rewrite-safe` findings.
- In-memory validation before writing: parse diagnostics, non-comment token hash, comment-free syntax-tree hash, protected-comment hash, and file hash.
- Durable, recoverable no-clobber replacement, concurrent-edit refusal, no staging or commit behavior, and receipt/backup history under `.git/repofit-comments/` with enforced private modes on POSIX. Windows automatic writes are explicitly disabled. The source path has a documented brief absence window; this is not an atomic-rename claim.
- Hardened Git execution disables external diff/textconv, environment-based Git configuration injection, lazy fetching, prompts, optional locks, replace objects, fsmonitor, and pagers; every Git subprocess has a timeout.
- Automatic fixes are worktree-only. `verify --staged` checks that the user-staged blob exactly matches the repaired receipt.
- Generated headers and generated/vendor/fixture/migration/snapshot/declaration paths protect the whole file from findings and writes.
- Each fix uses a repository-wide process lock and no-clobber replacement, then writes a private recovery journal and byte-exact backup before replacing source; `verify` accepts only an applied state, `recover` explicitly reconciles interrupted states, and one-level `undo` restores the latest journal only when hash, mode, token, AST, and protected-comment checks pass.
- Schema 2 Alpha state is preserved under a private legacy archive before schema 3 starts; automatic writes are fail-closed above 2 MiB per backup, 200 receipts, or 64 MiB of recovery data.
- Dry-run-first history list/prune protects latest and non-terminal receipts and resumes interrupted paired deletion from durable markers.
- Profile blobs are read in NUL-framed Git batches; file, byte, changed-line, finding, profile, backup, history, and recovery limits are enforced.
- Consumer Action and RC workflows are present with pinned official Action SHAs, build-once tarball smoke, SPDX SBOM, SHA256SUMS, release manifest, attestations, and optional npm staged publishing.

## Locally verified

- Strict TypeScript check passes.
- 140 automated tests pass on the current multi-language branch.
- Node's experimental coverage run reports 94.11% overall line coverage, 81.89% branch coverage, and 97.41% function coverage; subprocess-rendered terminal paths are not fully attributed to the parent coverage report.
- The final local performance gate scans a 10,000-changed-line fixture in 330.2 ms and a 100-file fixture in 374.5 ms on this workspace, below the 10-second and 5-second thresholds respectively. Cold `repofit languages --format json` startup was 0.20 seconds. These are single-run local measurements, not remote P95 evidence.
- End-to-end tests cover staged, worktree, and base scopes; worktree-only apply; staged-fix refusal; staged receipt verification; dry-run; one-finding apply; single-file batch apply; and concurrent edit refusal.
- Edge tests cover strings and template literals containing comment-like text, changed-line filtering, protected directives, legal and rationale comments, rationale-preserving step-prefix rewrites, numeric constraints, CRLF, TSX block comments, MTS/CTS, whole-file generated protection, parse ranges, token equivalence, syntax-tree equivalence, symbolic-link refusal, and style-profile readiness.
- Adversarial Git tests prove inherited/configured external diff commands, attribute-selected diff drivers, textconv drivers, and `GIT_CONFIG_COUNT` injection are not executed.
- Terminal tests prove repository-controlled C0/C1, ANSI/OSC, zero-width, and bidirectional formatting characters are rendered as visible escapes.
- Encoding/path tests reject invalid UTF-8 in the worktree and index, preserve a UTF-8 BOM through an applied fix, and reject parent symlink/junction paths that resolve outside the repository.
- CLI contract tests reject irrelevant arguments, source `--version` from `package.json`, and distinguish usage, runtime, verification, and write-refusal exit categories; JSON failures use a versioned stderr envelope.
- Recovery tests cover private receipt/backup/directory modes on the current POSIX host, repository identity, exact byte and mode restoration, active/stale locks, hard-link refusal, ordinary last-moment edit capture, coordinated backup/receipt tampering, history isolation, and injected interruption before, during, and after source replacement and undo.
- The 2026-09-06 online runtime dependency audit, including TypeScript, web-tree-sitter, tree-sitter-wasms, and the dedicated current Bash grammar, reported 0 known vulnerabilities.
- Package smoke builds in an isolated clean directory, checks an exact tarball allowlist, and excludes tests, development sources, product-status documents, and evaluation evidence.
- The `1.1.0-alpha.1` tarball passed both offline exact-dependency installation and fresh npm-registry dependency resolution; the installed CLI listed all 19 adapters and completed TypeScript plus Python analysis/fix checks.
- Multi-language tests cover all 19 adapters in one Git diff, native prefix rewriting for every automatic-fix language, string/raw-string/heredoc false positives, CRLF and Unicode offsets, syntax-error refusal, component boundaries, SQL quoted forms, language directives, and an applied/verified Python transaction.
- A live Hermes Muse Spark 1.3 contributor-free evaluation changed 19 tracked synthetic files across all batches. RepoFit found all 38 numbered narration comments with zero string-marker false positives and zero parse errors, applied 36 safe rewrites across 18 files with per-file verification, kept SQL review-only, and passed the available native tests before and after cleanup. The fixture exposed an incompatible legacy Bash WASM before release; the adapter now uses the current `tree-sitter-bash` WASM and has a regression test.
- A packed tarball built from an isolated clean directory installs in a clean prefix; its installed binary completes version reporting, one-finding and Grok four-finding batch apply, worktree/staged verification, exact undo without index mutation, post-cleanup zero-finding scan, the Grok fixture's 4/4 tests, and internal-import blocking. Local smoke also supports the exact installed TypeScript runtime offline.
- Historical v1 evidence: PR `#1` merged as `7c65297`; tag `v1.0.0-rc.1`, main/tag CI, build-once release workflow `33878935406`, six installed-tarball jobs, online audit, SBOM, checksums, attestations, and a GitHub draft prerelease all passed.
- [GitHub Actions run 34010327234](https://github.com/TAOMA-06/repofit-comments/actions/runs/34010327234) passed on multi-language implementation head `ab714f0`: Node 22/24 on Ubuntu, macOS, and Windows all completed strict checking, 140 tests, and fresh-registry package smoke; the benchmark also passed.

## Live model-generated evaluation

Grok 4.5 with low reasoning generated four TypeScript/test files in a separate fixture repository. The requested Composer 2.5 model was not available in the installed Grok CLI catalog, so the user explicitly approved the lower-cost available model.

- Raw generation: 493 inserted lines and 9 deleted lines across four files.
- Baseline scan: 38 changed comments, 26 protected comments, four deterministic `Step N:` prefix rewrites, zero suggestion-only findings, and zero parse diagnostics.
- One batch transaction applied all four safe rewrites in `src/pricing.ts`.
- The receipt verified identical non-comment token, syntax-tree, and protected-rationale hashes.
- The generated project passed strict type checking and all four functional tests before and after cleanup.
- A post-cleanup scan reported zero remaining findings.
- The v0.2 Trusted Fix Core replay additionally verified worktree apply, staged verification, exact undo without index mutation, re-apply, and the same 4/4 functional tests.
- The final installed `1.0.0-rc.1` tarball repeated the frozen raw Grok commit replay: 38 comments, 26 protected comments, four safe rewrites, worktree/staged verification, exact undo with index isolation, re-apply, zero remaining findings across the staged/worktree split, and 4/4 tests. A request for a brand-new Grok sample was blocked by HTTP 402 exhausted usage; it was not substituted or counted as new model evidence.

See [evidence/grok-4.5-eval-2026-09-03.md](./evidence/grok-4.5-eval-2026-09-03.md) and [evidence/trusted-fix-core-2026-09-04.md](./evidence/trusted-fix-core-2026-09-04.md).

The current v1 technical-candidate checks, exact artifact identities, and external blockers are recorded in [evidence/v1-technical-candidate-2026-09-04.md](./evidence/v1-technical-candidate-2026-09-04.md).

## Public-repository smoke evidence

Read-only historical scans were run on two public repositories after the deterministic test suite passed:

- [`IntranetFactory/claude-artifacts-runner`](https://github.com/IntranetFactory/claude-artifacts-runner), commit [`1cf5dc9`](https://github.com/IntranetFactory/claude-artifacts-runner/commit/1cf5dc9c8a5ee5633f2f444a45d233bbb6ca6dbd): one added TSX file contained ten changed comments. RepoFit protected six comments and produced review-only suggestions for four standalone action-narration comments, plus one grouped density observation. It produced no automatic change.
- The same repository, commit [`e1b1245`](https://github.com/IntranetFactory/claude-artifacts-runner/commit/e1b124571b1770dd668f9e111445a1359eb965aa): six changed comments across six files produced four direct action-narration suggestions and one grouped density observation, including an inline import narration. It produced no automatic deletion.
- Mature-code control: [`sindresorhus/ky`](https://github.com/sindresorhus/ky), range [`eaf0b80..33682a7`](https://github.com/sindresorhus/ky/compare/eaf0b80b23b7b85e4040f525a12521d727395420...33682a7749c197fdb3e851d2efe99b67c7b8f89f). Across 32 changed TypeScript files and 174 changed comments, RepoFit protected 127 comments and emitted zero findings after density and rationale calibration.

These are useful smoke cases, not a statistically valid precision or recall study. They do not replace the planned multi-repository corpus and maintainer blind review.

## Not yet externally verified

- The v1 corpus of at least twenty independent repositories and two hundred real development diffs has not been collected.
- Maintainer blind A/B preference, real-world precision, recall, false-positive, and suggestion-acceptance thresholds have not been measured.
- The source and TypeScript-family RC tag are public at [`TAOMA-06/repofit-comments`](https://github.com/TAOMA-06/repofit-comments). The RC Release remains draft; no npm package, Homebrew formula, stable release, or production distribution has been created.
- Node.js 22/24 on macOS, Ubuntu, and Windows are verified for both the TypeScript-family RC and the `1.1.0-alpha.1` multi-language implementation. The first alpha run exposed a Node 24 V8 WASM Zone OOM; the CLI/test launcher now starts Node 24 WASM work with `--liftoff-only`, and the replacement matrix passed.
- The multi-language corpus has not yet been replayed on independent real repositories. Current evidence is deterministic fixture coverage, so no cross-language precision/recall or maintainer-preference claim is made.
- SQL automatic writes, suggestion-only rewriting, variable renaming, and structural cleanup remain out of scope.

## Local commands

```bash
npm install
npm run check
npm test
npm run build
npm run test:package
npm run benchmark
node dist/src/cli.js --help
```

The next release gate is external corpus and maintainer evaluation. Until that passes, `remove-safe` means the patch preserved the declared syntax/token/protected-comment invariants; it does not prove that every reviewer will consider the removed comment low-value.
