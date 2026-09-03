# Grok 4.5 live generation and cleanup evaluation

- Date: 2026-09-03
- RepoFit build: 0.1.0 Alpha candidate
- Generator: Grok 4.5, low reasoning effort, interactive terminal session
- Runtime: Node.js 22.22.3, TypeScript 6.0.3

## Model selection boundary

The requested `grok-composer-2.5-fast` identifier was rejected by the installed Grok CLI as unknown. Its live model catalog exposed Grok 4.6 and Grok 4.5. The user explicitly approved using a cheaper available model, so this evaluation used Grok 4.5 with low reasoning effort. It must not be described as a Composer 2.5 result.

## Fixture

A separate Git repository contained stubs and a task for a small immutable shopping-cart library. Grok was instructed to implement only these existing files, include comments around key decisions, avoid detector-oriented optimization, and leave dependency installation and Git operations to the evaluator.

The frozen history was:

- `681fa1d`: human-authored stubs and task
- `007756c`: raw Grok generation
- `471decc`: RepoFit-cleaned result

The raw model commit changed four files with 493 insertions and 9 deletions. Strict TypeScript checking and four functional tests passed before cleanup.

## RepoFit result

The final rule set scanned the raw generation against `681fa1d` and reported:

- 4 analyzed files
- 38 changed comments
- 26 protected comments
- 4 deterministic safe rewrites
- 0 automatic removals
- 0 suggestion-only findings
- 0 parse diagnostics

All four findings were numbered process prefixes in `src/pricing.ts`. A dry run showed this shape:

```diff
- // Step 1: sum immutable line totals into the pre-discount subtotal.
+ // Sum immutable line totals into the pre-discount subtotal.

- // Step 2: apply discount without allowing a negative taxable amount.
+ // Apply discount without allowing a negative taxable amount.
```

`fix --all-safe --file src/pricing.ts --apply` applied all four edits as one file transaction. RepoFit's receipt then verified that the non-comment token hash, syntax-tree hash, and protected-rationale hash matched the pre-fix state.

Strict TypeScript checking and all four functional tests passed again after cleanup. A repeat scan against the original stub baseline found 38 comments, 27 protected comments, zero safe findings, zero suggestions, and zero parse diagnostics.

## Interpretation

This is a positive end-to-end example: the tool found a conspicuous numbered narration pattern, removed only the template prefixes, retained the useful explanations, and left executable behavior unchanged under the declared structural checks and project tests.

It is one deliberately elicited model sample, not a representative benchmark. It does not prove AI authorship, detector evasion, real-world precision/recall, cross-language support, or maintainer preference.
