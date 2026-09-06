# Multi-language alpha local evidence

Date: 2026-09-06

Version: `1.1.0-alpha.1`

Branch: `product/multilang-batches`

Implementation commit: `98ae321`

Verified source snapshot: `be534e17afe08e104e27e6dda1b1af2d992058c3`

Status: local implementation evidence. The branch has not been pushed and the multi-language matrix has not run remotely.

## Implemented batches

- Batch 1: TypeScript, JavaScript, Python, Go, Rust, and Swift.
- Batch 2: Java, Kotlin, C#, C, C++, PHP, Ruby, Dart, and Lua.
- Batch 3: Vue, Svelte, Shell, and SQL.
- Eighteen adapters expose scan plus safe automatic fixes. SQL exposes scan plus review because the lexical adapter cannot establish one dialect-independent syntax-tree invariant.

## Parser and write boundary

- TypeScript and JavaScript use the TypeScript parser.
- Thirteen ordinary language families use locked web-tree-sitter and tree-sitter-wasms runtime dependencies; Shell uses the current standalone `tree-sitter-bash@0.25.1` WASM.
- Vue and Svelte parse JavaScript/TypeScript script regions; markup comments stay protected.
- Automatic rewrites preserve each language's native `//`, `#`, or `--` prefix.
- Existing token, syntax-tree, protected-comment, source-hash, no-clobber, receipt, verify, recover, and undo gates apply to every automatic-fix adapter.
- SQL safe-looking findings are downgraded to review suggestions before they can reach the writer, and the writer independently rejects scan-only adapters.

## Verification

- Strict TypeScript check passed.
- 140 automated tests passed with no failures or skips on the current POSIX host.
- Coverage: 94.11% lines, 81.89% branches, and 97.41% functions.
- One Git worktree diff containing all 19 adapters produced one expected finding per file, 18 safe rewrites, one SQL review suggestion, and zero parser errors.
- Parser fixtures exclude fake comment markers in ordinary strings, raw strings, multiline strings, heredocs, Lua long strings, SQL quoted strings, PostgreSQL dollar strings, and nested SQL block comments.
- Safety fixtures cover CRLF plus Unicode offsets, malformed-source refusal, native-prefix preservation, component markup protection, language-specific tool directives, and multi-line Ruby/Lua comment protection.
- A Python finding completed the existing byte-exact recoverable write transaction and verified successfully.
- The isolated `1.1.0-alpha.1` package passed exact local dependency installation and fresh npm-registry dependency resolution. Its installed CLI loaded all grammars, listed 19 adapters, and exercised TypeScript and Python findings.
- Online production-dependency audit reported 0 known vulnerabilities.
- Local benchmarks: 10,000 changed lines in 330.2 ms; 100 changed files in 374.5 ms; cold `languages --format json` startup in 0.20 seconds.
- The clean source snapshot produced `repofit-comments-1.1.0-alpha.1.tgz` with SHA-256 `0a4d2473b9233111ed845d3c0964360b80e471c6239a609f9a1c0e00e465fd56` and npm integrity `sha512-RKYl+6YN0CfFoP4Wtfp/wpkHNLD/9kwnvbSTqZoA1V+GD3Oh52drgZQUiF2ANwuQl4N6QgM9KQMs+bLQ9mtNfQ==`.
- The release verifier accepted the manifest, exact allowlist, checksums, SPDX application metadata, and all three runtime dependencies; the exact tarball then passed installed smoke.

## Evidence not yet obtained

- No independent real-repository corpus has been evaluated for the new language families.
- Node 22/24 by macOS/Linux/Windows CI has not run for this branch.
- Windows automatic writes remain disabled by the existing product boundary.
- SQL automatic writing remains disabled.
- No multi-language tag, GitHub Release, npm package, or Homebrew distribution has been created.

## Hermes Muse Spark 1.3 live evaluation

Hermes ran `muse-spark-1.3-contributor-free` with low reasoning in a temporary Git repository containing only synthetic stubs. The contributor-tier training acknowledgement was enabled only in a temporary Hermes home; no RepoFit source, credential, or user data was included in the prompts.

- Successful generation sessions: `20260906_112649_bfdd9e` (Batch 1), `20260906_112820_b3e42e` (Batch 2), and `20260906_113039_4ab264` (Batch 3).
- The model changed 19 tracked files with 374 insertions and 22 deletions. Every file contained two numbered narration comments, a meaningful because/must rationale, an in-string fake comment marker, and self-tests or an executable example.
- Available native checks passed before cleanup: TypeScript, JavaScript, Python, Rust (4 tests), Swift, Java, C, C++, Ruby, Dart, Shell, and SQLite. Go, Kotlin, C#, PHP, and Lua compilers/interpreters were unavailable; their files were checked by the corresponding parser and structural hashes.
- The first 19-file RepoFit run failed at the Shell file with `resolved is not a function`. Isolation showed that the legacy bundled Bash WASM used an incompatible dynamic-linking format. Switching only Shell to the current standalone Bash WASM closed the failure and added a regression.
- Final raw scan: 19 files, 64 changed comments, 20 protected comments, 36 safe rewrites, 2 SQL review suggestions, 0 fake-string findings, and 0 parse errors. All 38 `Step 1/2` comments were identified.
- RepoFit applied two safe rewrites to each of 18 files. Every applied receipt verified. SQL remained unchanged and review-only.
- Post-cleanup scan: 0 safe findings, 30 review suggestions, 0 non-SQL `Step N:` prefixes, and 0 parse errors. The remaining two `Step N:` prefixes belong to SQL's review-only adapter.
- Shell undo restored SHA-256 `78d9b3ec23f59c0968eba362560214af0bf8a39d5db88a516b641dc416cd3642`; re-apply returned SHA-256 `63531272ace3ee90b60fd1a2e9dfed0d554c17fc9de879f41684d1e5156660da` and verified again.
- All available native checks passed again after cleanup.
