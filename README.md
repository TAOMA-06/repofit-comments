# RepoFit Comments

[![CI](https://github.com/TAOMA-06/repofit-comments/actions/workflows/ci.yml/badge.svg)](https://github.com/TAOMA-06/repofit-comments/actions/workflows/ci.yml)

RepoFit Comments 是一个本地终端工具，用来检查当前 TypeScript/TSX Git Diff 中显眼的生成式注释写法，并在可证明不改变代码时进行保守清理。

It focuses on presentation patterns such as numbered steps, decorative headings, nearby duplicates, narrow line-by-line restatements, tutorial tone, and generation-process narration. It does **not** determine who wrote code, falsify authorship, remove a hidden model watermark, or promise to bypass an AI detector.

See [STATUS.md](./STATUS.md) for the exact evidence boundary. The public-history smoke cases are in [evidence/public-smoke-2026-09-03.md](./evidence/public-smoke-2026-09-03.md), and the live Grok 4.5 evaluation is in [evidence/grok-4.5-eval-2026-09-03.md](./evidence/grok-4.5-eval-2026-09-03.md).

Formal-product work is governed by the [V1 product specification](./docs/product/V1_PRODUCT_SPEC.md), [execution plan](./docs/product/V1_EXECUTION_PLAN.md), and [release strategy](./docs/product/V1_RELEASE_STRATEGY.md).

## Current safety contract

- TypeScript family only: `.ts`, `.tsx`, `.mts`, and `.cts`.
- Current Git diff only; staged changes are the default.
- Read-only and offline during `check`, `preview`, and `profile`.
- Automatic changes require `--worktree` and are limited to one safe finding or one file's safe findings at a time.
- A patch is built and validated in memory before writing.
- Non-comment tokens and the comment-free syntax-tree shape must stay identical.
- Protected comments must remain byte-for-byte identical and in order. A `Step N:` prefix may be removed while its protected rationale remains identical.
- No staging, commits, pushes, dependency changes, or repository scripts.

## Install for local development

Requires Node.js 22 or newer.

```bash
git clone https://github.com/TAOMA-06/repofit-comments.git
cd repofit-comments
npm install
npm run build
```

You can either run `npm link` to create the `repofit` command, or call the included local wrapper from inside a target Git repository:

```bash
/absolute/path/to/repofit-comments/repofit comments check --staged
```

After linking, the shorter commands are:

```bash
repofit comments check --staged
repofit comments check --worktree
repofit comments preview --staged
repofit comments explain <finding-id> --staged
repofit comments fix <finding-id> --worktree --dry-run
repofit comments fix <finding-id> --worktree --apply
repofit comments fix --all-safe --file src/example.ts --worktree --dry-run
repofit comments fix --all-safe --file src/example.ts --worktree --apply
repofit comments verify
repofit comments verify --staged
```

`--all-safe` is deliberately file-scoped. If safe findings span multiple files, RepoFit refuses to choose for you and requires `--file`.

Staged and base scopes are read-only. After a worktree fix, run `verify`, stage the repaired file yourself, then run `verify --staged` to prove that the Git index contains the repaired bytes.

Use `--format json` with `check`, `profile`, or `explain` for machine-readable output.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed and no actionable finding or verification failure remains. |
| `1` | `check` or `preview` found one or more findings. |
| `2` | Command arguments are invalid. |
| `3` | Analysis, Git, parsing, encoding, or another runtime step failed. |
| `4` | A saved fix receipt did not verify against the selected target. |
| `5` | A requested write was refused or could not be safely applied. |

With `--format json`, failures are written to stderr as a versioned JSON error object. Human terminal errors escape repository-controlled control characters.

## Finding actions

| Action | Meaning |
| --- | --- |
| `remove-safe` | A narrow deterministic rule can remove this standalone line comment. Writing requires an explicit finding ID, or a single-file `--all-safe` transaction, plus `--apply`. |
| `rewrite-safe` | A deterministic comment-only rewrite is available, such as removing a numbered `Step N:` prefix while preserving the rest of the sentence. |
| `rewrite-suggested` | The comment looks verbose or mismatched, but RepoFit will not write the suggestion automatically. |
| `keep-protected` | Legal, tooling, API, safety, compatibility, tracking, or other important comment. Never automatically changed. |
| `uncertain` | Evidence is insufficient. Hidden by default. |

## Protected comments

The protection pass runs before style rules. It protects, among other things:

- copyright, SPDX, license, authorship, and attribution;
- JSDoc, block comments, and leading file/module comments;
- ESLint, Prettier, TypeScript, coverage, source-map, and bundler directives;
- generated-file markers, URLs, issue IDs, TODO/FIXME/HACK markers;
- rationale, constraints, security, privacy, concurrency, compatibility, schema, units, versions, and migration notes;
- possible commented-out code;
- generated headers and generated/vendor/minified/fixture/migration/snapshot/declaration paths, which protect the entire file before comment rules run.

When unsure, RepoFit keeps the comment.

## Repository style profile

RepoFit samples unchanged tracked files from `HEAD`, prioritizing the same directory and top-level module. Repository-specific style conclusions are enabled only with at least five reference files and thirty ordinary comments. Otherwise the report says `insufficient-style-baseline`; deterministic removals and clearly labeled review-only heuristics may still appear.

The profile is deliberately small: comment density, average length, dominant language, common phrases, and a few nearby examples. It is not an authorship model.

## Development

```bash
npm run check
npm test
```

The package remains marked `private` so a source release cannot be mistaken for an npm release. Package publication, signing, and production support remain separate decisions.

## License

MIT. See [LICENSE](./LICENSE).
