# RepoFit Comments

[![CI](https://github.com/TAOMA-06/repofit-comments/actions/workflows/ci.yml/badge.svg)](https://github.com/TAOMA-06/repofit-comments/actions/workflows/ci.yml)

RepoFit Comments 是一个本地终端工具，用来检查当前 TypeScript 家族（`.ts`、`.tsx`、`.mts`、`.cts`）Git Diff 中显眼的生成式注释写法，并在可证明不改变代码时进行保守清理。

It focuses on presentation patterns such as numbered steps, decorative headings, nearby duplicates, narrow line-by-line restatements, tutorial tone, and generation-process narration. It does **not** determine who wrote code, falsify authorship, remove a hidden model watermark, or promise to bypass an AI detector.

See [STATUS.md](./STATUS.md) for the exact evidence boundary. The public-history smoke cases are in [evidence/public-smoke-2026-09-03.md](./evidence/public-smoke-2026-09-03.md), and the live Grok 4.5 evaluation is in [evidence/grok-4.5-eval-2026-09-03.md](./evidence/grok-4.5-eval-2026-09-03.md).

The source manifest is now `1.0.0-rc.1`. The Node 22/24 × macOS/Linux/Windows CI matrix is green, but that is not proof of npm publication, the build-once release workflow, maintainer evaluation, or stable `1.0.0` release gates. See [STATUS.md](./STATUS.md).

Formal-product work is governed by the [V1 product specification](./docs/product/V1_PRODUCT_SPEC.md), [execution plan](./docs/product/V1_EXECUTION_PLAN.md), and [release strategy](./docs/product/V1_RELEASE_STRATEGY.md).

## Current safety contract

- TypeScript family only: `.ts`, `.tsx`, `.mts`, and `.cts`.
- Current Git diff only; staged changes are the default.
- Read-only and offline during `check`, `preview`, `profile`, `explain`, and `doctor`.
- Static repository policy comes only from `.repofit.json`; executable configuration is never loaded.
- Reports include stable fingerprints, rule levels, protection reasons, reasoned suppressions, JSON, and SARIF 2.1.
- Automatic changes require `--worktree`, are limited to one safe finding or one file's safe findings at a time, and are disabled on Windows until its write-security evidence gate passes.
- A patch is built and validated in memory before writing.
- A private write-ahead journal and byte-exact backup are persisted before source replacement.
- Non-comment tokens and the comment-free syntax-tree shape must stay identical.
- Protected comments must remain byte-for-byte identical and in order. A `Step N:` prefix may be removed while its protected rationale remains identical.
- No staging, commits, pushes, dependency changes, or repository scripts.

## Install for local development

Requires Node.js 22.14 or newer.

```bash
git clone https://github.com/TAOMA-06/repofit-comments.git
cd repofit-comments
npm install
npm run build
```

You can either run `npm link` to create the `repofit` command, or call the included local wrapper from inside a target Git repository:

```bash
/absolute/path/to/repofit-comments/repofit check --staged
```

After linking, the shorter commands are:

```bash
repofit init
repofit doctor
repofit check --staged
repofit check --worktree --format json
repofit check --base origin/main --format sarif
repofit preview --staged
repofit explain <finding-id> --staged
repofit fix <finding-id> --worktree --dry-run
repofit fix <finding-id> --worktree --apply
repofit fix --all-safe --file src/example.ts --worktree --apply
repofit verify
repofit verify --staged
repofit recover
repofit undo
repofit history list
repofit history prune --keep 20
repofit history prune --keep 20 --apply
```

The Alpha form `repofit comments <command>` remains compatible.

## Repository configuration

`repofit init` creates a complete, deterministic `.repofit.json`. It supports include/exclude globs, additional protected phrases and paths, rule levels, `failOn`, resource limits, and terminal/JSON/SARIF defaults. Unknown fields, executable config files, symlinks, invalid UTF-8, unsupported schema versions, and limits above the built-in safety ceilings are rejected.

```json
{
  "schemaVersion": "1.0",
  "rulePackVersion": "1.0.0",
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["**/generated/**"],
  "protect": {
    "phrases": ["backward-compatible wire format"],
    "paths": ["src/protocol/**"]
  },
  "rules": {
    "comments.step-label": "warning",
    "comments.tutorial-tone": "info"
  },
  "failOn": "warning",
  "display": { "language": "auto", "format": "terminal" }
}
```

One finding can be suppressed only with a reason:

```ts
// repofit-ignore-next-line comments.step-label -- mirrors the numbered protocol in docs
// Step 1
```

The directive and reason are shown in machine and terminal output. Configuration can add protection or disable reporting, but it cannot promote suggestion-only rules into automatic writes.

## GitHub Action and schemas

The repository includes a consumer [Action definition](./action.yml) and a [version-pinned example workflow](./examples/github-action.yml). The Action emits SARIF but does not upload it itself; the calling workflow controls the `security-events: write` permission and upload step.

Versioned schemas for configuration, reports, errors, fix previews, receipts, doctor, and history are shipped under [`schemas/`](./schemas/). SARIF follows version 2.1.0.

`--all-safe` is deliberately file-scoped. If safe findings span multiple files, RepoFit refuses to choose for you and requires `--file`.

Staged and base scopes are read-only. After a worktree fix, run `verify`, stage the repaired file yourself, then run `verify --staged` to prove that the Git index contains the repaired bytes.

Every applied fix stores a byte-exact receipt and backup under `.git/repofit-comments/`; on POSIX systems the directories use mode `0700` and files use mode `0600`. Windows DACL privacy is not yet verified, so Windows automatic writes remain outside the current local evidence claim. A repository-wide writer lock and recoverable no-clobber transaction prevent RepoFit operations from interleaving and capture ordinary last-moment edits instead of overwriting them. The source path can be briefly absent between displacement and candidate installation; this is not marketed as an atomic rename. `verify` succeeds only for an `applied` journal; after an interrupted operation, `recover` reconciles the journal with the two known byte states. `undo` is deliberately one level: it restores the latest journal only when that journal is still `applied` and its hash and mode match. It does not search older history past an aborted or already-undone journal. Neither command changes the Git index, so a previously staged repaired blob remains staged until you update it yourself.

Schema 3 upgrades preserve a schema 2 Alpha receipt in `.git/repofit-comments/legacy/`, tighten the data directory on POSIX, and then start new recoverable history. Schema 2 can be inspected but cannot be undone because the Alpha did not store a byte-exact backup.

Automatic fixes currently accept source files up to 2 MiB. Admission of a new fix is fail-closed at 200 receipt records or 64 MiB of recovery data; transitions needed to recover an already-admitted journal are not blocked by that quota. `history prune` is dry-run-first, never selects the latest or a non-terminal journal, deletes receipt/backup pairs under the repository lock, and resumes an interrupted prune from its private marker.

Use `--format json` for machine-readable command output and `--format sarif` with `check` or `preview`. Versioned schemas are shipped in [`schemas/`](./schemas/).

## Repository configuration

`repofit init` creates a complete static `.repofit.json`. It supports include/exclude paths, additional protected phrases/paths, per-rule `off|info|warning|error`, `failOn`, display language/format, and hard-bounded analysis/recovery resources. Unknown fields, versions, symlinks, invalid UTF-8, traversal patterns, and values above product ceilings are rejected.

Inline suppression requires a reason and is visible in reports:

```ts
// repofit-ignore-next-line comments.step-label -- mirrors the numbered protocol in docs
// Step 1
runProtocol();
```

Configuration can only remove or lower findings; it cannot promote suggestion-only rules into automatic writes or disable built-in legal/tooling/security/rationale protection.

## GitHub Action

The repository includes a consumer `action.yml` and a version-pinned example at [`examples/github-action.yml`](./examples/github-action.yml). The Action scans a base-to-HEAD diff and emits SARIF without treating findings as proof of AI authorship. Uploading SARIF requires the caller's explicit `security-events: write` permission.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed and no actionable finding or verification failure remains. |
| `1` | `check` or `preview` met the configured `failOn` threshold. |
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
npm run test:package
npm run benchmark
```

The package export map blocks internal library subpaths because the supported contract is CLI-only. The RC workflow builds one tarball, tests those same bytes across the configured matrix, generates SPDX SBOM/checksums, and prepares attestations. Running that workflow, staging npm, approving with 2FA, tagging, and publishing a GitHub Release remain separate external actions.

## License

MIT. See [LICENSE](./LICENSE).
