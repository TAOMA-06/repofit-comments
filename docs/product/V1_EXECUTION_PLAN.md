# RepoFit Comments v1 execution plan

Date: 2026-09-04

Status: working productization baseline

Owner: TAOMA-06

## Decision

RepoFit Comments will become a focused **comment integrity product**, not a general AI-slop scanner and not an authorship detector.

Product promise:

> Clean comment noise from the diff you are about to ship, with proof that code and protected intent stayed untouched.

The stable name remains **RepoFit Comments**. The shorter `RepoFit` name is not treated as an exclusive brand because unrelated repositories and products already use it.

## Why this position

General AI-code-quality products already compete on detector count, languages, scores, agent hooks, MCP, CI, and hosted review:

- [aislop](https://github.com/scanaislop/aislop) supports broad scanning, safe fixes, changed-file scopes, agent repair, SARIF, hooks, and multiple languages.
- [slop-scan](https://github.com/modem-dev/slop-scan) provides normalized metrics, delta reports, plugins, and pinned public benchmarks.
- [vibecop](https://github.com/bhvbhushan/vibecop) integrates deterministic checks into many coding agents and exposes a GitHub Action and MCP server.
- [CodeRabbit](https://docs.coderabbit.ai/cli/index) is a paid, cloud-assisted local and pull-request review product.

Competing on breadth would erase RepoFit's clearest advantage. RepoFit already has a narrower trust primitive: a proposed edit is rejected unless non-comment tokens, syntax-tree shape, and protected-comment evidence remain valid. The product should make that proof understandable and independently repeatable.

## Primary user and job

Primary user: a developer using Codex, Claude Code, Cursor, Copilot, or another coding agent who is about to review or commit a generated diff.

Core job:

1. Inspect only the comments changed in the intended Git scope.
2. Separate obvious process narration from comments that preserve rationale or contracts.
3. Preview an exact patch.
4. Apply only deterministic, reversible comment edits.
5. Prove the working tree and staged commit contain the reviewed result.

Secondary user: a maintainer or small team that wants a repeatable pull-request policy without sending source code to a service.

## v1 boundaries

### Included

- Local, offline CLI with zero telemetry by default.
- Git worktree, staged, base, and pull-request-oriented read scopes.
- Automatic writes to the worktree only; RepoFit never stages, commits, or pushes user code.
- TypeScript-family files after each extension passes the same parser and safety suite: `.ts`, `.tsx`, `.mts`, and `.cts`.
- Deterministic `remove-safe` and `rewrite-safe` rules only.
- Project configuration, inline suppression with a required reason, JSON, SARIF, and human terminal output.
- A versioned, recoverable receipt for every applied file and an exact `undo` flow.
- npm/npx distribution and a version-pinned GitHub Action.

### Excluded

- AI authorship probability, plagiarism claims, watermark removal, or detector-evasion promises.
- General security, complexity, dead-code, dependency, or architecture scanning.
- Automatic variable renaming, structural refactoring, or LLM-written code changes.
- Cloud source upload, hosted dashboards, accounts, billing, IDE extensions, MCP, and desktop apps in v1.
- JavaScript/JSX, Python, Go, Rust, Swift, Java, and other parser families until the TypeScript safety and adoption gates pass.

## Release phases

### Phase A — v0.2 Trusted Fix Core

Goal: make the existing safety claim true under hostile repositories and ordinary staging workflows.

P0 requirements:

- Harden every Git subprocess: disable external diff and text conversion, neutralize dangerous environment injection, disable lazy fetch and prompts, prevent optional locks, and enforce timeouts.
- Keep `check --staged` read-only; allow `fix` only with `--worktree`.
- Add `verify --staged` so users can prove the index contains the repaired bytes before committing.
- Reject invalid UTF-8 and unsafe path resolution, including parent symlinks and Windows junction escapes.
- Treat generated, vendored, snapshot, migration, and declaration files as whole-file protected.
- Write a recovery journal and byte-exact backup before replacing a source file; add hash-guarded `undo`.
- Escape terminal control and bidirectional characters from repository-controlled paths, comments, and code excerpts.
- Replace ambiguous CLI failures with versioned JSON errors and documented exit codes.

Exit gate:

- Adversarial tests prove no external diff/textconv runs.
- Fault injection at every write phase leaves either the original file or a recoverable journal.
- A staged fix attempt changes neither index nor worktree.
- `verify --staged` fails before staging and passes only when the repaired bytes are in the index.
- Protected/generated fixtures produce zero automatic findings.

### Phase B — v0.3 Installable Beta

Goal: let a new user get a trustworthy result in under two minutes.

Requirements:

- Simplify the stable command surface while preserving compatibility with the Alpha commands.
- Add a pure-data, versioned `.repofit.yml` schema with include/exclude, protection patterns, rule levels, `fail-on`, and resource limits.
- Add `init`, `doctor`, `--print-config`, `--no-color`, and real unified-diff previews.
- Separate stable finding fingerprints from source snapshot hashes.
- Add JSON Schema and SARIF 2.1 output with stable rule metadata.
- Eliminate per-comment reparsing and batch Git object reads; add explicit file/diff limits.
- Add `.mts` and `.cts` only after positive, negative, template, CRLF, and generated-file fixtures pass.
- Test the real packed tarball on Linux, macOS, and Windows with Node.js 22 and 24.

Exit gate:

- `npx repofit-comments@next check --staged` works from a clean public package.
- Median first install-to-result time is under two minutes in five fresh environments.
- A 10,000 changed-line benchmark completes within ten seconds on the reference machine or exits before work with a documented limit.
- All machine-readable success and error outputs pass their published schemas.

### Phase C — v0.5 Evidence Beta

Goal: prove that the rules help maintainers rather than merely lowering a detector score.

Dataset:

- At least 20 independent TypeScript/React repositories.
- At least 200 real AI-assisted diffs.
- At least 50 high-quality human diffs as a do-not-change control.
- Maintainer labels for keep, rewrite, and remove, stored by repository split.
- A hidden acceptance set that is never used to tune rules.

Comparison set:

- RepoFit Comments.
- `aislop fix --safe`.
- slop-scan.
- vibecop.
- slopscore comment fixes where applicable.

Exit gate:

- Non-comment token or syntax-tree changes: zero.
- Identified protected-comment loss: zero.
- Parse failures caused by fixes: zero.
- Per-rule automatic-fix precision: at least 95%.
- Automatic-fix acceptance: at least 85%.
- High-quality human control diffs with no proposed automatic change: at least 95%.
- Cleanup preferred in blind maintainer review: at least 70%.

### Phase D — v1.0 Release Candidate and stable release

Goal: prove installation, operation, release, and rollback as one reproducible system.

Requirements:

- Ten maintainers use the RC on real work for at least one week.
- At least 60% use it again after the first successful run.
- Linux, macOS, and Windows release matrices are green on every supported Node LTS major.
- npm trusted publishing uses GitHub-hosted OIDC and produces provenance; no long-lived write token remains.
- A GitHub Release carries the exact npm tarball, SPDX SBOM, SHA-256 manifest, and artifact attestation.
- A failed-release exercise demonstrates dist-tag rollback, deprecation, and patch-forward without reusing a version or tag.
- All known high or critical runtime vulnerabilities are closed or the release is blocked.

Only after these gates pass may the package move from an RC dist-tag to `latest` and be described as v1.0.

## Distribution decision

Primary channel: npm/npx. Public packages can use npm trusted publishing with GitHub Actions OIDC and automatic provenance; current npm requirements and setup are documented in [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/).

Release record: one immutable GitHub Release per version. Build artifacts can carry GitHub attestations using the official [artifact attestation workflow](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

Later channel: an official self-maintained Homebrew tap after stable v1. Homebrew requires a stable tagged release, immutable checksums, licensing, and formula audits; see the [Formula Cookbook](https://docs.brew.sh/Formula-Cookbook).

Deferred: standalone binaries. They add platform signing and bundled-runtime maintenance before user demand proves that installing Node is a meaningful blocker.

## Commercial model

The v1 CLI remains MIT and free. Charging for the local safety primitive before adoption would weaken trust and distribution.

Potential paid product, only after demand is measured:

- shared team policies and approved exceptions;
- organization audit trails and retention;
- cross-repository rule governance;
- hosted dashboards that store findings, not source code;
- enterprise support, SSO, and self-hosted control plane.

No SaaS work begins until at least five teams ask for shared policy or audit features and at least three agree to a paid pilot.

## Product metrics

- Activation: first valid report within two minutes of install.
- Trust: percentage of users who inspect and accept an automatic patch.
- Safety: protected-intent loss and non-comment changes, both hard-zero metrics.
- Value: accepted fixes per analyzed diff and blind preference for the cleaned version.
- Retention: weekly repeat use after the first successful run.
- Friction: undo rate, disabled-rule rate, configuration time, and failed installs.

## Go, pivot, stop

Go to stable v1 when all Phase C and D gates pass.

Pivot to a plugin or rule pack for an existing scanner when either condition holds:

- maintainers do not value the proof receipt or staged verification;
- fewer than half of labeled AI-assisted diffs contain an actionable comment change.

Stop independent product work when automatic-fix acceptance remains below 50% after two calibration rounds, or when protected-intent loss cannot be held at zero.

## Current next action

The Phase A implementation is locally green. The next action is to push the product branch only after explicit user authorization, open a reviewable pull request, and require the six-job operating-system/Node matrix. Do not publish an npm package, tag, GitHub Release, or Homebrew formula until that remote gate is green and the user separately authorizes the release action.

Current Phase A implementation status:

- [x] Harden Git diff execution against external diff, textconv, environment injection, lazy fetch, prompts, optional locks, and unbounded execution.
- [x] Restrict automatic fixes to `--worktree` and add `verify --staged`.
- [x] Protect generated, vendored, fixture, migration, snapshot, and declaration files at whole-file scope.
- [x] Add strict UTF-8 byte handling, BOM preservation, and realpath/junction containment checks.
- [x] Add a repository-wide writer lock, no-clobber replacement, a write-ahead recovery journal, repository-bound receipts, byte-exact mode-preserving backup, explicit interruption recovery, and hash/AST/token-guarded `undo`.
- [x] Add a controlled schema 2-to-3 upgrade path plus fail-closed per-file, record-count, and total recovery-storage limits.
- [x] Split the safety state machine into receipt, store, durable-file, source-transaction, and orchestration boundaries.
- [x] Build the npm tarball from a clean isolated tree and validate its exact file allowlist.
- [x] Escape terminal control and bidirectional characters.
- [x] Publish versioned JSON errors, strict command arguments, a package-derived CLI version, and a stable exit-code contract.
