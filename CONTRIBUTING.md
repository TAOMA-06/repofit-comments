# Contributing

RepoFit favors false negatives over unsafe or noisy automatic edits.

Before opening a pull request:

1. Keep automatic changes limited to comments.
2. Add both a positive test and a human-written/protected counterexample for every rule.
3. Run `npm run check`, `npm test`, `npm run test:package`, and `npm run benchmark`.
4. For rule changes, replay at least one generated-code sample and one mature-project control.
5. Do not add telemetry, network access, repository script execution, staging, commits, or pushes to analysis/fix commands.

Changes to a rule must update the central rule catalog, positive and protected-negative fixtures, SARIF metadata expectations, and any affected shipped schema. Changes to configuration, receipt state, recovery, or pruning must include malformed-input and interruption tests. Windows automatic writes intentionally remain disabled until their DACL and filesystem transaction evidence is added.

Bug reports should include a minimal, non-sensitive example. Do not upload private source code merely to reproduce a comment rule.
