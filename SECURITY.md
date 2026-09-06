# Security policy

RepoFit rewrites source files, so incorrect path handling or comment classification can be security-relevant.

The supported trust assumptions, write transaction, concurrency limits, filesystem metadata limits, and recovery-data privacy model are documented in [docs/SECURITY_MODEL.md](./docs/SECURITY_MODEL.md).

Please avoid public issues for vulnerabilities. Use the repository's private GitHub security-advisory form when available and include the smallest non-sensitive reproduction you can. Never attach proprietary repositories, credentials, tokens, `.env` files, or production data.

The current source branch is `1.1.0-alpha.1`; the public supported prerelease remains `v1.0.0-rc.1`. Until a fix is available, use `check`, `preview`, and dry-run without `--apply` as a safe mitigation.

Automatic fixes keep byte-exact recovery backups under `.git/repofit-comments/backups/`. POSIX implementations enforce private directory/file modes. Windows DACL privacy has not yet been verified, so the RC disables `fix --apply`, `undo`, `recover`, and history pruning on Windows while retaining read-only analysis and SARIF. These files are local Git metadata and are not staged or committed, but they can contain proprietary source text. Automatic writes stop at the documented per-file, record-count, and total-storage limits. `history prune` is dry-run-first, never selects the latest or non-terminal journal, and uses recovery markers for paired receipt/backup deletion.
