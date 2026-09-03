# RepoFit Comments MVP status

Date: 2026-09-03

## Current classification

**Published and locally verified public GitHub Alpha. Not an npm package or production release.**

## Implemented

- TypeScript and TSX comment extraction using TypeScript AST comment ranges, including comments after template literals and JSX comment blocks.
- Git scopes for staged, worktree, and merge-base-to-HEAD changes.
- Changed-comment-only analysis.
- Protected-comment filtering for legal, tooling, generated, tracking, rationale, safety, compatibility, numeric-contract, and possible commented-code cases.
- Deterministic findings for decorative headings, bare step labels, nearby duplicates, and narrow code restatements.
- Suggestion-only findings for action-by-action narration, meta narration, tutorial tone, density outliers, and repository-language drift.
- Repository style profile from unchanged tracked files in `HEAD`.
- Terminal and JSON reports with stable finding IDs.
- One-finding dry run/application plus single-file batch transactions for deterministic `remove-safe` and `rewrite-safe` findings.
- In-memory validation before writing: parse diagnostics, non-comment token hash, comment-free syntax-tree hash, protected-comment hash, and file hash.
- Atomic file replacement, concurrent-edit refusal, no staging or commit behavior, and a local verification receipt under `.git/repofit-comments/`.

## Locally verified

- Strict TypeScript check passes.
- 30 automated tests pass.
- Node's experimental coverage run reports 87.72% overall line coverage and 75.00% branch coverage; subprocess-rendered terminal paths are not fully attributed to the parent coverage report.
- End-to-end tests cover staged, worktree, and base scopes; dry-run; one-finding apply; single-file batch apply; receipt verification; and concurrent edit refusal.
- Edge tests cover strings and template literals containing comment-like text, changed-line filtering, protected directives, legal and rationale comments, rationale-preserving step-prefix rewrites, numeric constraints, CRLF, TSX block comments, parse ranges, token equivalence, syntax-tree equivalence, symbolic-link refusal, and style-profile readiness.
- Runtime dependency audit reports 0 known vulnerabilities at the time of validation.
- Package dry run excludes tests and development sources from the installable file list.
- A packed tarball installs in a clean temporary prefix; its `repofit --help` command and a scan of the cleaned Grok fixture both run successfully through the installed binary.
- The initial public `main` push completed its Ubuntu/Node.js 22 GitHub Actions workflow successfully.

## Live model-generated evaluation

Grok 4.5 with low reasoning generated four TypeScript/test files in a separate fixture repository. The requested Composer 2.5 model was not available in the installed Grok CLI catalog, so the user explicitly approved the lower-cost available model.

- Raw generation: 493 inserted lines and 9 deleted lines across four files.
- Baseline scan: 38 changed comments, 26 protected comments, four deterministic `Step N:` prefix rewrites, zero suggestion-only findings, and zero parse diagnostics.
- One batch transaction applied all four safe rewrites in `src/pricing.ts`.
- The receipt verified identical non-comment token, syntax-tree, and protected-rationale hashes.
- The generated project passed strict type checking and all four functional tests before and after cleanup.
- A post-cleanup scan reported zero remaining findings.

See [evidence/grok-4.5-eval-2026-09-03.md](./evidence/grok-4.5-eval-2026-09-03.md).

## Public-repository smoke evidence

Read-only historical scans were run on two public repositories after the deterministic test suite passed:

- [`IntranetFactory/claude-artifacts-runner`](https://github.com/IntranetFactory/claude-artifacts-runner), commit [`1cf5dc9`](https://github.com/IntranetFactory/claude-artifacts-runner/commit/1cf5dc9c8a5ee5633f2f444a45d233bbb6ca6dbd): one added TSX file contained ten changed comments. RepoFit protected six comments and produced review-only suggestions for four standalone action-narration comments, plus one grouped density observation. It produced no automatic change.
- The same repository, commit [`e1b1245`](https://github.com/IntranetFactory/claude-artifacts-runner/commit/e1b124571b1770dd668f9e111445a1359eb965aa): six changed comments across six files produced four direct action-narration suggestions and one grouped density observation, including an inline import narration. It produced no automatic deletion.
- Mature-code control: [`sindresorhus/ky`](https://github.com/sindresorhus/ky), range [`eaf0b80..33682a7`](https://github.com/sindresorhus/ky/compare/eaf0b80b23b7b85e4040f525a12521d727395420...33682a7749c197fdb3e851d2efe99b67c7b8f89f). Across 32 changed TypeScript files and 174 changed comments, RepoFit protected 127 comments and emitted zero findings after density and rationale calibration.

These are useful smoke cases, not a statistically valid precision or recall study. They do not replace the planned multi-repository corpus and maintainer blind review.

## Not yet externally verified

- The planned corpus of at least five independent repositories and fifty real AI-assisted diffs has not been collected.
- Maintainer blind A/B preference, real-world precision, recall, false-positive, and suggestion-acceptance thresholds have not been measured.
- The source is public at [`TAOMA-06/repofit-comments`](https://github.com/TAOMA-06/repofit-comments). No public npm package, Homebrew formula, signed release, or production distribution has been created.
- Node.js 22 on macOS is the verified runtime in this workspace; other Node and operating-system combinations have not been run here.
- Automatic rewriting of suggestion-only comments, variable renaming, structural cleanup, and languages other than TypeScript/TSX remain out of scope.

## Local commands

```bash
npm install
npm run check
npm test
npm run build
node dist/src/cli.js --help
```

The next release gate is external corpus and maintainer evaluation. Until that passes, `remove-safe` means the patch preserved the declared syntax/token/protected-comment invariants; it does not prove that every reviewer will consider the removed comment low-value.
