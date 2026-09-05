# Multi-language alpha local evidence

Date: 2026-09-06

Version: `1.1.0-alpha.1`

Branch: `product/multilang-batches`

Status: local implementation evidence. The branch has not been pushed and the multi-language matrix has not run remotely.

## Implemented batches

- Batch 1: TypeScript, JavaScript, Python, Go, Rust, and Swift.
- Batch 2: Java, Kotlin, C#, C, C++, PHP, Ruby, Dart, and Lua.
- Batch 3: Vue, Svelte, Shell, and SQL.
- Eighteen adapters expose scan plus safe automatic fixes. SQL exposes scan plus review because the lexical adapter cannot establish one dialect-independent syntax-tree invariant.

## Parser and write boundary

- TypeScript and JavaScript use the TypeScript parser.
- Fourteen ordinary language families use locked web-tree-sitter and tree-sitter-wasms runtime dependencies.
- Vue and Svelte parse JavaScript/TypeScript script regions; markup comments stay protected.
- Automatic rewrites preserve each language's native `//`, `#`, or `--` prefix.
- Existing token, syntax-tree, protected-comment, source-hash, no-clobber, receipt, verify, recover, and undo gates apply to every automatic-fix adapter.
- SQL safe-looking findings are downgraded to review suggestions before they can reach the writer, and the writer independently rejects scan-only adapters.

## Verification

- Strict TypeScript check passed.
- 139 automated tests passed with no failures or skips on the current POSIX host.
- Coverage: 94.01% lines, 81.65% branches, and 97.40% functions.
- One Git worktree diff containing all 19 adapters produced one expected finding per file, 18 safe rewrites, one SQL review suggestion, and zero parser errors.
- Parser fixtures exclude fake comment markers in ordinary strings, raw strings, multiline strings, heredocs, Lua long strings, SQL quoted strings, PostgreSQL dollar strings, and nested SQL block comments.
- Safety fixtures cover CRLF plus Unicode offsets, malformed-source refusal, native-prefix preservation, component markup protection, language-specific tool directives, and multi-line Ruby/Lua comment protection.
- A Python finding completed the existing byte-exact recoverable write transaction and verified successfully.
- The isolated `1.1.0-alpha.1` package passed exact local dependency installation and fresh npm-registry dependency resolution. Its installed CLI loaded all grammars, listed 19 adapters, and exercised TypeScript and Python findings.
- Online production-dependency audit reported 0 known vulnerabilities.
- Local benchmarks: 10,000 changed lines in 324.7 ms; 100 changed files in 355.2 ms; cold `languages --format json` startup in 0.37 seconds.

## Evidence not yet obtained

- No independent real-repository corpus has been evaluated for the new language families.
- Node 22/24 by macOS/Linux/Windows CI has not run for this branch.
- Windows automatic writes remain disabled by the existing product boundary.
- SQL automatic writing remains disabled.
- No multi-language tag, GitHub Release, npm package, or Homebrew distribution has been created.
