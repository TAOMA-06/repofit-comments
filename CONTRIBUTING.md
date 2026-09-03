# Contributing

RepoFit favors false negatives over unsafe or noisy automatic edits.

Before opening a pull request:

1. Keep automatic changes limited to comments.
2. Add both a positive test and a human-written/protected counterexample for every rule.
3. Run `npm run check` and `npm test`.
4. For rule changes, replay at least one generated-code sample and one mature-project control.
5. Do not add telemetry, network access, repository script execution, staging, commits, or pushes to analysis/fix commands.

Bug reports should include a minimal, non-sensitive example. Do not upload private source code merely to reproduce a comment rule.
