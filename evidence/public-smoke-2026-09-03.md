# Public repository smoke check

- Date: 2026-09-03
- Tool build: RepoFit Comments 0.1.0
- Runtime: Node.js 22.22.3, TypeScript 6.0.3
- Mode: read-only historical Git comparison

## Purpose

Check whether the MVP can surface conspicuous narration in public TypeScript history while staying quiet on a mature-code control. This is a smoke check, not a precision/recall benchmark and not proof of AI authorship.

## Case A: generated-artifact repository

Repository: [`IntranetFactory/claude-artifacts-runner`](https://github.com/IntranetFactory/claude-artifacts-runner)

Commit: [`1cf5dc9`](https://github.com/IntranetFactory/claude-artifacts-runner/commit/1cf5dc9c8a5ee5633f2f444a45d233bbb6ca6dbd)

Observed result:

- 1 changed TSX file
- 10 changed comments
- 6 protected comments, including the JSX block comment
- 4 action-narration suggestions
- 1 grouped density observation
- 0 automatic change candidates
- 0 parse diagnostics

Representative comments surfaced for review:

- `Create a formatter for San Francisco time`
- `Update time every second`
- `Cleanup interval on component unmount`
- `Calculate rotation angles for clock hands`

## Case B: generated-artifact repository, separate historical change

Repository: [`IntranetFactory/claude-artifacts-runner`](https://github.com/IntranetFactory/claude-artifacts-runner)

Commit: [`e1b1245`](https://github.com/IntranetFactory/claude-artifacts-runner/commit/e1b124571b1770dd668f9e111445a1359eb965aa)

Observed result:

- 6 changed TypeScript/TSX comments across 6 changed source files
- 4 direct action-narration suggestions
- 1 grouped density observation
- 0 automatic deletion candidates
- 0 parse diagnostics

Representative comments surfaced for review:

- `Create a Layout component` on an import line
- `Add the default route explicitly`
- `Generate routes`
- `Import the DefaultPage component explicitly`

## Control: mature TypeScript repository

Repository: [`sindresorhus/ky`](https://github.com/sindresorhus/ky)

Range: [`eaf0b80..33682a7`](https://github.com/sindresorhus/ky/compare/eaf0b80b23b7b85e4040f525a12521d727395420...33682a7749c197fdb3e851d2efe99b67c7b8f89f)

Observed result:

- 32 changed TypeScript files
- 174 changed comments
- 127 protected comments
- 0 automatic change candidates
- 0 rewrite suggestions after density calibration
- 0 parse diagnostics

The first control run produced five density suggestions, including comments that clearly carried rationale. That result was treated as a failed calibration. A later AST-based extraction pass found more valid comments and exposed one additional action-rule false positive on a `without leaking state` rationale. Density now considers only unprotected comments, uses a stricter multiplier when the style baseline is sparse, and protects explicit rationale connectors. The same frozen comparison then produced zero findings.

## Evidence boundary

This smoke check demonstrates:

- the CLI works against real public Git history;
- review-only action narration catches the intended visible pattern in two selected historical changes;
- the control-driven calibration removed an observed false-positive group;
- no public sample was automatically modified.

It does not demonstrate:

- statistically valid precision or recall;
- that every surfaced comment should be removed;
- that the source was written by a particular model or by AI at all;
- cross-language or cross-platform performance;
- maintainer preference for the proposed cleanup.
