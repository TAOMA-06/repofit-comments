# v1 technical candidate local evidence

Date: 2026-09-04

Latest implementation commit under test: `0b2ecba`

Version: `1.0.0-rc.1`

Host: macOS arm64, Node.js `22.22.3`

Status: local technical-candidate evidence only. This is not npm publication, a GitHub Release, a remote operating-system matrix, or stable `1.0.0` evidence.

## Verification

- TypeScript strict check passed.
- 126 automated tests passed with zero failures or skips.
- Node experimental coverage reported 93.76% lines, 81.46% branches, and 97.92% functions.
- The final performance fixture completed 10,000 changed lines in 371.5 ms and 100 changed files in 386.0 ms, below the local 10-second and 5-second gates. These are single local runs, not P95 measurements.
- The isolated package smoke built an allowlisted tarball, installed it into a clean prefix with an isolated npm cache, ran the installed CLI, blocked internal module imports, and exercised check, SARIF, apply, worktree/staged verification, and undo without index mutation.
- Regression coverage includes reason-required suppressions, exact Node `>=22.14.0` doctor behavior, invalid UTF-8, BOM/CRLF, non-final newline patches, symlink/junction and hard-link refusal, Action output clobber/Git-metadata refusal, and Unicode path ordering across batched Git diffs.

## Build-once release artifact

The clean code commit was built with npm `11.19.1`. `verify-release.mjs` accepted the manifest, exact directory contents, SHA256SUMS, npm integrity, SPDX metadata, package identity, and runtime TypeScript dependency. `installed-smoke.mjs` then passed against that exact tarball.

- tarball: `repofit-comments-1.0.0-rc.1.tgz`
- tarball SHA-256: `d42d7ec924d94c4edefc96f6a74609cfde764b2d3f57a47c91b3a74a2a913f66`
- npm integrity: `sha512-TX0Nj1yz46FrMC2Y5bdEJCIK/B6JOVrsYXkeeGMRmhjMN2i4CVor/OlhAGoCGb+O+UK7V8kiBGrZBx6CKcLvzg==`

The evidence document and composite Action implementation are not included in the npm tarball, so adding this record and tightening Action output confinement do not alter the package bytes. The final run-specific SPDX hash remains recorded in the generated release manifest rather than recursively embedded here.

## Model-generated fixture boundary

The previously frozen Grok 4.5 low-effort fixture remains the live model-generated evidence: 38 changed comments, 26 protected comments, four safe `Step N:` rewrites, verified tokens/AST/protected rationale, zero remaining findings, and 4/4 project tests. That replay is documented in `grok-4.5-eval-2026-09-03.md` and `trusted-fix-core-2026-09-04.md`.

A fresh Grok 4.5 generation was attempted for this RC in a new isolated fixture. The CLI reached the service but returned HTTP 402 `Grok Build usage balance exhausted`; therefore no new model output or RC-specific Grok replay is claimed. The current installed-tarball smoke is real, but it is not relabeled as a Grok result.

## External gates not claimed

- The Node 22/24 by macOS/Linux/Windows workflow matrix has not run on the current commit.
- Windows automatic writes remain intentionally disabled; the configured gate verifies read-only behavior and explicit write refusal.
- The online npm audit refresh timed out without a result. The release workflow contains a fail-closed online runtime audit gate, but it has not run remotely.
- No tag, GitHub draft/release, artifact attestation, npm staged publish, 2FA approval, trusted-publisher binding, or Homebrew distribution was performed.
- The planned multi-repository corpus and maintainer blind evaluation are still required before stable `1.0.0`.
